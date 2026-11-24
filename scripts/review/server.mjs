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
  { key: "budget", n: 4, label: "Current budget online", hint: "The adopted budget for the year in progress. Last year's still counts until this year's legal posting window closes (Florida: 30 days after adoption). A draft in a meeting packet counts only inside that window." },
  { key: "audit_online", n: 5, label: "Latest due audit on its own website", hint: "The most recent audit or annual financial report that is due (not just any old one), on its own site or linked from it." },
  { key: "minutes", n: 6, label: "Agendas or minutes online", hint: "Recent agendas or minutes. A Facebook page counts for this item." },
  { key: "records_contact", n: 7, label: "Records-request contact online", hint: "Who to ask for public records: an office, email or form. Maine: public access officer. Florida: records custodian." },
];

const readChecks = () => fs.existsSync(CHECKS) ? csvObjects(readText(CHECKS)) : [];
const writeChecks = rows => fs.writeFileSync(CHECKS, toCSV([HEAD, ...rows.map(r => HEAD.map(h => r[h] ?? ""))]));
const queue = () => {
  const q = readJSON(p("data", "review", "queue.json")).queue;
  if (fs.existsSync(OVERRIDES)) { const ov = new Map(csvObjects(readText(OVERRIDES)).map(r => [r.entity_id, r.website])); for (const e of q) if (ov.has(e.id)) { e.website = ov.get(e.id) || null; e.websiteSource = "entered by reviewer"; } }
  return q;
};
const suggestions = () => fs.existsSync(p("data", "review", "suggestions.json")) ? readJSON(p("data", "review", "suggestions.json")) : {};
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
    if (!b.entity_id || !ITEMS.some(i => i.key === b.item) || !["pass", "fail"].includes(b.result)) return send(res, 400, { error: "entity_id, item and result (pass or fail) are required" });
    if (b.result === "pass" && !/^https?:\/\//.test(b.url || "")) return send(res, 400, { error: "a pass needs the link that shows it" });
    const rows = readChecks();
    rows.push({ entity_id: b.entity_id, item: b.item, result: b.result, url: b.url || "", archive_url: "", checked_on: localDate(), checked_by: (b.checked_by || "NH").slice(0, 20), note: (b.note || "").slice(0, 300) });
    writeChecks(rows);
    if (b.result === "pass") enqueueArchive(b.url);
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
}).listen(PORT, () => console.log(`review tool on http://localhost:${PORT} (archive queue: ${aq().length})`));
