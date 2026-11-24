// Safety brake + status log, shared by every data build.
// Compares per-year statuses with the last published run, stored in a small committed file
// (data/derived/<scope>-status.json), so it also works on a fresh checkout in GitHub Actions.
// Stops the build (exit 2) if more than 10% of entities changed, unless approved.
// Logs every status change (feeds "Audits that showed up") and the first date each year was flagged.
import fs from "node:fs";
import { p, readJSON, writeJSON, toCSV } from "./util.mjs";

const sig = e => e.years.map(y => `${y.fy}:${y.status}`).join(",");

export function brakeAndLog({ scope, snapshot, entities, approve, overdueKey = "overdue" }) {
  const statusFile = p("data", "derived", `${scope}-status.json`);
  const prev = fs.existsSync(statusFile) ? readJSON(statusFile) : null;
  if (prev && prev.snapshot !== snapshot) {
    const before = prev.status;
    // Compare only fiscal years present in both runs. Once a year a source adds a new year and drops the
    // oldest one; that changes every entity's list of years but is not a change in anyone's status.
    const parse = s => Object.fromEntries(String(s || "").split(",").filter(Boolean).map(x => x.split(":")));
    const differs = e => { const was = parse(before[e.id]); return e.years.some(y => was[y.fy] !== undefined && was[y.fy] !== y.status); };
    const changed = entities.filter(e => before[e.id] !== undefined && differs(e)).length;
    const share = changed / Math.max(1, entities.length);
    console.log(`[${scope}] changed since ${prev.snapshot}: ${changed} of ${entities.length} (${(share * 100).toFixed(1)}%)`);
    if (share > 0.10 && !approve) {
      console.error(`SAFETY BRAKE [${scope}]: more than 10% of statuses changed. Review the source, then rerun with --approve.`);
      process.exit(2);
    }
    const logFile = p("data", "derived", "status-log.csv");
    const lines = fs.existsSync(logFile) ? [] : [["date", "entity_id", "fiscal_year", "from", "to"]];
    for (const e of entities) {
      const was = Object.fromEntries((before[e.id] || "").split(",").filter(Boolean).map(s => s.split(":")));
      for (const y of e.years) if (was[y.fy] && was[y.fy] !== y.status) lines.push([snapshot, e.id, y.fy, was[y.fy], y.status]);
    }
    if (lines.length > (fs.existsSync(logFile) ? 0 : 1)) fs.appendFileSync(logFile, toCSV(lines));
  }
  writeJSON(statusFile, { snapshot, status: Object.fromEntries(entities.map(e => [e.id, sig(e)])) });

  const ffFile = p("data", "derived", "first-flagged.json");
  const firstFlagged = fs.existsSync(ffFile) ? readJSON(ffFile) : {};
  for (const e of entities) for (const y of e.years) if (y.status === overdueKey) { const k = `${e.id}|${y.fy}`; if (!firstFlagged[k]) firstFlagged[k] = snapshot; }
  writeJSON(ffFile, firstFlagged);
}
