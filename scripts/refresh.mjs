// Weekly refresh: fetch every source, rebuild data and site, run checks.
// Used by .github/workflows/refresh.yml and runnable locally: node scripts/refresh.mjs [--approve] [--skip-fetch]
// Exit codes: 0 ok, 1 a step failed, 2 the safety brake tripped (needs a person to review).
// Writes refresh-summary.md (for the commit message or the review issue).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { p, latestDir } from "./lib/util.mjs";

const args = new Set(process.argv.slice(2));
const approve = args.has("--approve") ? ["--approve"] : [];
const log = [];
const step = (label, script, extra = []) => {
  const t = Date.now();
  const r = spawnSync(process.execPath, [p("scripts", script), ...extra], { cwd: p(), encoding: "utf8" });
  const outText = (r.stdout || "") + (r.stderr || "");
  process.stdout.write(`\n== ${label} (exit ${r.status}, ${((Date.now() - t) / 1000).toFixed(0)}s)\n${outText}`);
  log.push({ label, status: r.status, out: outText.trim().split("\n").slice(-4).join("\n") });
  return r.status;
};
const finish = code => {
  const title = code === 0 ? "Weekly refresh" : code === 2 ? "Safety brake: review needed" : "Weekly refresh failed";
  fs.writeFileSync(p("refresh-summary.md"), `${title} (${new Date().toISOString().slice(0, 10)})\n\n${log.map(l => `- ${l.label}: exit ${l.status}\n\n  \`\`\`\n  ${l.out.replace(/\n/g, "\n  ")}\n  \`\`\``).join("\n")}\n`);
  process.exit(code);
};

if (!args.has("--skip-fetch")) {
  for (const [label, script] of [["Fetch Maine", "fetch-maine.mjs"], ["Fetch Florida", "fetch-florida.mjs"], ["Fetch federal audits", "fetch-us.mjs"]]) {
    if (step(label, script) !== 0) finish(1);
  }
}
for (const [label, script] of [["Maine data", "build-maine-data.mjs"], ["Florida data", "build-florida-data.mjs"], ["Federal data", "build-us-data.mjs"]]) {
  const s = step(label, script, approve);
  if (s === 2) finish(2);
  if (s !== 0) finish(1);
}
if (step("Build site", "build-site.mjs") !== 0) finish(1);
if (step("Checks", "check.mjs") !== 0) finish(1);

// Keep only the newest federal copy in git: each is about 17 MB, and federal flags link to fac.gov report pages,
// not to our copy. Maine and Florida copies are small and every one is kept.
const usDir = p("data", "raw", "us");
if (fs.existsSync(usDir)) {
  const keep = latestDir(usDir);
  for (const d of fs.readdirSync(usDir)) if (d !== keep && /^\d{4}-\d{2}-\d{2}$/.test(d)) fs.rmSync(p("data", "raw", "us", d), { recursive: true, force: true });
}
finish(0);
