// Local website-review tool (never deployed). Usage: npm run review  ->  http://localhost:8791
// A person confirms rubric items 3 to 7 for each government. Saves to data/manual/website-checks.csv
// and asks the Internet Archive for a dated copy of every confirmed link (slow background queue).
import http from "node:http";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { p, readJSON, writeJSON, readText, csvObjects, toCSV } from "../lib/util.mjs";

const PORT = 8791;
// Stamp checks with the reviewer's local calendar date, not UTC (late-evening checks would show tomorrow).
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const CHECKS = p("data", "manual", "website-checks.csv");
const OVERRIDES = p("data", "manual", "website-overrides.csv");
const ARCHIVE_Q = p("data", "review", "archive-queue.json");
const HEAD = ["entity_id", "item", "result", "url", "archive_url", "checked_on", "checked_by", "note"];
const ITEMS = [
  { key: "website", n: 3, label: "Official website", hint: "The government's own site. Not a placeholder or a parked domain. A Facebook page does not count here." },
  { key: "budget", n: 4, label: "Current budget online", hint: "The adopted budget for the year in progress. Last year's still counts until this year's legal posting window closes (Florida: 30 days after adoption). A draft in a meeting packet counts only inside that window. Town meeting results or minutes count when they show the amounts voted; a warrant alone does not." },
  { key: "audit_online", n: 5, label: "Latest due audit on its own website", hint: "The most recent audit or annual financial report that is due (not just any old one), on its own site or linked from it. A newer one counts too. Partial (half points) if one of the last 3 due years is missing from the site: say which in the note." },
  { key: "minutes", n: 6, label: "Agendas or minutes online", hint: "Agendas or minutes dated within the last 12 months. A Facebook page counts for this item." },
  { key: "records_contact", n: 7, label: "Records-request contact online", hint: "The site must say who handles public records or FOAA requests: an officer, email or form. A contact page that only names the clerk does not count. Maine: public access officer. Florida: records custodian." },
];

const OFFICIALS = p("data", "manual", "officials-confirmed.csv");
const OFF_HEAD = ["state", "entity_id", "role", "name", "decision", "url", "archive_url", "checked_on", "checked_by"];
const readOfficials = () => fs.existsSync(OFFICIALS) ? csvObjects(readText(OFFICIALS)) : [];
const writeOfficials = rows => fs.writeFileSync(OFFICIALS, toCSV([OFF_HEAD, ...rows.map(r => OFF_HEAD.map(h => r[h] ?? ""))]));
const readChecks = () => fs.existsSync(CHECKS) ? csvObjects(readText(CHECKS)) : [];
const writeChecks = rows => fs.writeFileSync(CHECKS, toCSV([HEAD, ...rows.map(r => HEAD.map(h => r[h] ?? ""))]));
const queue = () => {
  const q = readJSON(p("data", "review", "queue.json")).queue;
  if (fs.existsSync(OVERRIDES)) { const ov = new Map(csvObjects(readText(OVERRIDES)).map(r => [r.entity_id, r.website])); for (const e of q) if (ov.has(e.id)) { e.website = ov.get(e.id) || null; e.websiteSource = "entered by reviewer"; } }
  return q;
};
// The crawler may be writing this file at the same moment; if a read catches it half-written, use the last good copy.
let lastSuggestions = {};
const suggestions = () => { try { if (fs.existsSync(p("data", "review", "suggestions.json"))) lastSuggestions = readJSON(p("data", "review", "suggestions.json")); } catch {} return lastSuggestions; };
const body = req => new Promise(r => { let s = ""; req.on("data", c => s += c); req.on("end", () => { try { r(JSON.parse(s || "{}")); } catch { r({}); } }); });
const send = (res, code, obj, type = "application/json") => { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(type === "application/json" ? JSON.stringify(obj) : obj); };

// ---------- Internet Archive queue: one Save Page Now request every 20 seconds ----------
const aq = () => fs.existsSync(ARCHIVE_Q) ? readJSON(ARCHIVE_Q) : [];
function enqueueArchive(url) { const q = aq(); if (!q.includes(url)) { q.push(url); writeJSON(ARCHIVE_Q, q); } }
async function archiveOne() {
  const q = aq(); if (!q.length) return;
  const url = q[0];
  try {
    const res = await fetch(`https://web.archive.org/save/${url}`, { redirect: "follow", headers: { "User-Agent": "WheresOurAudit-review/0.1 (+https://wheresouraudit.pages.dev)" } });
    const snap = /web\.archive\.org\/web\/\d{14}/.test(res.url) ? res.url : (res.headers.get("content-location") ? `https://web.archive.org${res.headers.get("content-location")}` : null);
    if (snap) {
      const rows = readChecks();
      for (const r of rows) if (r.url === url && !r.archive_url) r.archive_url = snap;
      writeChecks(rows);
      const off = readOfficials();
      if (off.some(r => r.url === url && !r.archive_url)) { for (const r of off) if (r.url === url && !r.archive_url) r.archive_url = snap; writeOfficials(off); }
      writeJSON(ARCHIVE_Q, aq().filter(u => u !== url));
      console.log(`archived ${url} -> ${snap}`);
    } else if (res.status === 429) console.log("archive: rate limited, will retry");
    else { console.log(`archive: no snapshot for ${url} (HTTP ${res.status}), moving to the back of the queue`); writeJSON(ARCHIVE_Q, [...aq().filter(u => u !== url), url]); }
  } catch (e) { console.log(`archive error ${e.message}`); }
}
if (process.env.REVIEW_NO_ARCHIVE) console.log("archiving is OFF (REVIEW_NO_ARCHIVE set): passes are queued but not sent");
else setInterval(archiveOne, 20000);

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname === "/") return send(res, 200, readText(p("scripts", "review", "ui.html")), "text/html; charset=utf-8");

  // ---------- elected officials: a person confirms each candidate on the government's own website ----------
  if (u.pathname === "/mayors") return send(res, 200, readText(p("scripts", "review", "mayors.html")), "text/html; charset=utf-8");
  if (u.pathname === "/api/mayors") {
    const cand = fs.existsSync(p("data", "review", "fl-mayors-candidates.csv")) ? csvObjects(readText(p("data", "review", "fl-mayors-candidates.csv"))) : [];
    const done = new Map(readOfficials().map(r => [r.entity_id, r]));
    const q = new Map(queue().map(e => [e.id, e]));
    return send(res, 200, cand.map(c => { const id = `fl-${c.dfs_id}`; return { ...c, entity_id: id, website: q.get(id)?.website || null, page: q.get(id)?.url || null, decision: done.get(id) || null }; }));
  }
  if (u.pathname === "/api/official" && req.method === "POST") {
    const b = await body(req);
    if (!b.entity_id || !["confirmed", "corrected", "rejected"].includes(b.decision)) return send(res, 400, { error: "entity_id and decision are required" });
    if (b.decision !== "rejected" && (!/^https?:\/\//.test(b.url || "") || !b.name || !b.role)) return send(res, 400, { error: "a confirmed or corrected official needs a name, role and the official page that shows it" });
    const rows = readOfficials().filter(r => r.entity_id !== b.entity_id);
    rows.push({ state: "FL", entity_id: b.entity_id, role: b.role || "", name: (b.name || "").trim(), decision: b.decision, url: b.url || "", archive_url: "", checked_on: localDate(), checked_by: (b.checked_by || "NH").slice(0, 20) });
    writeOfficials(rows);
    if (b.decision !== "rejected") enqueueArchive(b.url);
    return send(res, 200, { ok: true });
  }
  // ---------- Maine town boards: a person confirms the whole board on the town's own website ----------
  if (u.pathname === "/boards") return send(res, 200, readText(p("scripts", "review", "boards.html")), "text/html; charset=utf-8");
  if (u.pathname === "/api/boards") {
    const group = (file, key = "entity_id") => { const m = new Map(); if (fs.existsSync(file)) for (const r of csvObjects(readText(file))) m.set(r[key], [...(m.get(r[key]) || []), r]); return m; };
    const cand = group(p("data", "review", "me-officials-candidates.csv"));
    const links = group(p("data", "review", "me-board-links.csv"));
    const done = group(OFFICIALS);
    return send(res, 200, queue().filter(e => e.state === "ME" && e.type !== "county").map(e => ({
      entity_id: e.id, name: e.name, typeLabel: e.typeLabel, website: e.website, page: e.url,
      candidates: (cand.get(e.id) || []).map(r => ({ name: r.name, role: r.role, source: r.source, source_url: r.source_url })),
      links: [...new Set((links.get(e.id) || []).map(r => r.url))],
      decision: done.get(e.id) || null,
    })));
  }
  if (u.pathname === "/api/board" && req.method === "POST") {
    const b = await body(req);
    if (!queue().some(e => e.id === b.entity_id && e.state === "ME" && e.type !== "county")) return send(res, 400, { error: "unknown Maine town" });
    if (!["confirmed", "rejected"].includes(b.decision)) return send(res, 400, { error: "decision must be confirmed or rejected" });
    const stamp = { state: "ME", entity_id: b.entity_id, archive_url: "", checked_on: localDate(), checked_by: String(b.checked_by || "NH").slice(0, 20) };
    let add;
    if (b.decision === "rejected") add = [{ ...stamp, role: "", name: "", decision: "rejected", url: "" }];
    else {
      const m = Array.isArray(b.members) ? b.members.map(x => ({ name: String(x.name || "").trim(), role: String(x.role || "").trim() })) : [];
      if (!/^https?:\/\//.test(b.url || "")) return send(res, 400, { error: "paste the town's own page that lists the board" });
      if (m.length < 1 || m.length > 15) return send(res, 400, { error: "a board needs 1 to 15 members" });
      // Names and titles only: nothing that looks like an email, phone number or address.
      const bad = m.find(x => x.name.length < 3 || x.name.length > 60 || /[@\d]/.test(x.name) || !x.role || x.role.length > 60 || /@|\d{3}/.test(x.role));
      if (bad) return send(res, 400, { error: `check this line: "${bad.name}, ${bad.role}" (each line is Name, Title; no emails or phone numbers)` });
      add = m.map(x => ({ ...stamp, ...x, decision: "confirmed", url: b.url }));
      enqueueArchive(b.url);
    }
    writeOfficials([...readOfficials().filter(r => r.entity_id !== b.entity_id), ...add]);
    return send(res, 200, { ok: true });
  }
  if (u.pathname === "/api/queue") {
    const done = new Map(); for (const c of readChecks()) done.set(c.entity_id, (done.get(c.entity_id) || new Set()).add(c.item));
    const s = suggestions();
    return send(res, 200, queue().filter(e => e.gradable).map(e => ({ id: e.id, name: e.name, state: e.state, group: e.group, website: e.website, checked: done.get(e.id)?.size || 0, crawled: !!s[e.id], blocked: !!s[e.id]?.blocked })));
  }
  if (u.pathname.startsWith("/api/entity/")) {
    const id = decodeURIComponent(u.pathname.split("/").pop());
    const e = queue().find(x => x.id === id);
    if (!e) return send(res, 404, { error: "not found" });
    return send(res, 200, { entity: e, crawl: suggestions()[id] || null, checks: readChecks().filter(c => c.entity_id === id), items: ITEMS, archiveQueue: aq().length });
  }
  if (u.pathname === "/api/check" && req.method === "POST") {
    const b = await body(req);
    if (!b.entity_id || !ITEMS.some(i => i.key === b.item) || !["pass", "fail", "partial"].includes(b.result)) return send(res, 400, { error: "entity_id, item and result (pass, fail or partial) are required" });
    if (b.result === "partial" && (b.item !== "audit_online" || !String(b.note || "").trim())) return send(res, 400, { error: "partial is only for item 5, with a note naming the missing year" });
    if (b.result !== "fail" && !/^https?:\/\//.test(b.url || "")) return send(res, 400, { error: "a pass needs the link that shows it" });
    const rows = readChecks();
    rows.push({ entity_id: b.entity_id, item: b.item, result: b.result, url: b.url || "", archive_url: "", checked_on: localDate(), checked_by: (b.checked_by || "NH").slice(0, 20), note: (b.note || "").slice(0, 300) });
    writeChecks(rows);
    if (b.result !== "fail") enqueueArchive(b.url);
    return send(res, 200, { ok: true });
  }
  if (u.pathname === "/api/website" && req.method === "POST") {
    const b = await body(req);
    const rows = fs.existsSync(OVERRIDES) ? csvObjects(readText(OVERRIDES)).filter(r => r.entity_id !== b.entity_id) : [];
    rows.push({ entity_id: b.entity_id, website: b.website || "", entered_on: localDate() });
    fs.writeFileSync(OVERRIDES, toCSV([["entity_id", "website", "entered_on"], ...rows.map(r => [r.entity_id, r.website, r.entered_on])]));
    if (!b.website) return send(res, 200, { ok: true });
    // Re-scan just this government with the new website.
    const child = spawn(process.execPath, [p("scripts", "review", "crawl.mjs"), `--ids=${b.entity_id}`, "--redo"], { cwd: p() });
    child.on("close", code => send(res, 200, { ok: code === 0 }));
    return;
  }
  send(res, 404, { error: "not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`review tool (this PC only) on http://localhost:${PORT} (archive queue: ${aq().length})`));
