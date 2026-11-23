// Safety brake + status log, shared by every state's data build.
// Stops the build if more than 10% of statuses changed since the last published data (unless approved),
// logs every status change (feeds "Audits that showed up"), and records the first date each year was flagged.
import fs from "node:fs";
import { p, readJSON, writeJSON, toCSV } from "./util.mjs";

const sig = e => e.years.map(y => y.fy + y.status).join();

export function brakeAndLog({ outFile, snapshot, entities, approve, overdueKey = "overdue" }) {
  if (fs.existsSync(outFile)) {
    const prev = readJSON(outFile);
    if (prev.snapshot !== snapshot) {
      const before = new Map(prev.entities.map(e => [e.id, sig(e)]));
      const changed = entities.filter(e => before.has(e.id) && before.get(e.id) !== sig(e)).length;
      const share = changed / Math.max(1, entities.length);
      console.log(`changed since ${prev.snapshot}: ${changed} of ${entities.length} (${(share * 100).toFixed(1)}%)`);
      if (share > 0.10 && !approve) {
        console.error("SAFETY BRAKE: more than 10% of statuses changed. Review the source, then rerun with --approve.");
        process.exit(2);
      }
      const logFile = p("data", "derived", "status-log.csv");
      const lines = fs.existsSync(logFile) ? [] : [["date", "entity_id", "fiscal_year", "from", "to"]];
      const prevYears = new Map(prev.entities.map(e => [e.id, new Map(e.years.map(y => [y.fy, y.status]))]));
      for (const e of entities) for (const y of e.years) {
        const was = prevYears.get(e.id)?.get(y.fy);
        if (was && was !== y.status) lines.push([snapshot, e.id, y.fy, was, y.status]);
      }
      if (lines.length) fs.appendFileSync(logFile, toCSV(lines));
    }
  }
  const ffFile = p("data", "derived", "first-flagged.json");
  const firstFlagged = fs.existsSync(ffFile) ? readJSON(ffFile) : {};
  for (const e of entities) for (const y of e.years) if (y.status === overdueKey) { const k = `${e.id}|${y.fy}`; if (!firstFlagged[k]) firstFlagged[k] = snapshot; }
  writeJSON(ffFile, firstFlagged);
}
