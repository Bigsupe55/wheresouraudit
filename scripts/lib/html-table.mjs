// Parse the first <table> on a State Auditor page into header names and rows of {text, href} cells.
import { stripTags, decodeEntities } from "./util.mjs";

export function parseFirstTable(html) {
  const start = html.indexOf("<table"), end = html.indexOf("</table>", start);
  if (start < 0 || end < 0) throw new Error("No <table> found");
  const tb = html.slice(start, end);
  const headers = [...tb.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => stripTags(m[1]));
  const rows = [];
  for (const tr of tb.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
    if (!tds.length) continue;
    rows.push(tds.map(td => {
      const a = /href="([^"]+)"/.exec(td);
      return { text: stripTags(td), href: a ? decodeEntities(a[1]) : "" };
    }));
  }
  return { headers, rows };
}
