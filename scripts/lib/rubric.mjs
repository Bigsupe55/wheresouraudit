// Rubric v1.1 (see the methodology page). One checklist for everyone.
export const RUBRIC_VERSION = "1.1";
export const ITEMS = [
  { n: 1, key: "latest_audit", label: "Latest due audit on time", max: 40 },
  { n: 2, key: "prior_audits", label: "The 3 years before it on time", max: 20 },
  { n: 3, key: "website", label: "Official website", max: 10 },
  { n: 4, key: "budget", label: "Current budget online", max: 10 },
  { n: 5, key: "audit_online", label: "Latest due audit on its own website", max: 10 },
  { n: 6, key: "minutes", label: "Agendas or minutes online", max: 5 },
  { n: 7, key: "records_contact", label: "Records-request contact online", max: 5 },
];
export const letterGrade = s => s >= 90 ? "A" : s >= 80 ? "B" : s >= 70 ? "C" : s >= 60 ? "D" : "F";

// Item 1 from the latest due year's status.
export const item1Points = st => st === "on_time" ? 40 : st === "late" ? 20 : 0;
// Item 2: 20 x (years on time / years counted). Late and missing both score 0.
export function item2Points(statuses) {
  if (!statuses.length) return null;
  return Math.round(20 * statuses.filter(s => s === "on_time").length / statuses.length);
}

// Allowed status labels (ticket 07). Keys are internal; labels are what the page says.
export const MAINE_LABELS = {
  on_time: "Posted",
  late: "Posted after 12 months",
  overdue: "Not posted yet, over 12 months",
  not_due: "Not due yet",
};
export const STATUS_CLASS = { on_time: "good", late: "warn", overdue: "bad", not_due: "none" };

// Words a page must never contain (ticket 07). The check script scans every built page for these.
export const BANNED = ["fraud", "corrupt", "stole", "hiding", "cover-up", "cover up", "scandal", "illegal", "broke the law", "violation", "violated", "failed", "refused"];
