// One-off: build data/reference/fl-counties.geojson from the Census cartographic boundary file (KML).
// Source: https://www2.census.gov/geo/tiger/GENZ2023/kml/cb_2023_us_county_20m.zip
// Usage: node scripts/reference/make-fl-counties.mjs
import { p, writeJSON } from "../lib/util.mjs";
import { unzip } from "../lib/xlsx.mjs";

const URL = "https://www2.census.gov/geo/tiger/GENZ2023/kml/cb_2023_us_county_20m.zip";
const buf = Buffer.from(await (await fetch(URL)).arrayBuffer());
const files = unzip(buf);
const kml = Object.entries(files).find(([n]) => n.endsWith(".kml"))[1].toString("utf8");
const features = [];
for (const m of kml.matchAll(/<Placemark[^>]*>([\s\S]*?)<\/Placemark>/g)) {
  const pm = m[1];
  // Attributes sit in an HTML table inside the description: <th>NAME</th><td>value</td>
  const field = k => new RegExp(`<th>${k}</th>\\s*<td>([^<]*)</td>`).exec(pm)?.[1];
  if (field("STATEFP") !== "12") continue;
  const polys = [...pm.matchAll(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)]
    .map(c => [c[1].trim().split(/\s+/).map(pt => pt.split(",").slice(0, 2).map(Number))]);
  features.push({ type: "Feature", properties: { GEOID: field("GEOID"), NAME: field("NAME") }, geometry: { type: "MultiPolygon", coordinates: polys } });
}
writeJSON(p("data", "reference", "fl-counties.geojson"), { type: "FeatureCollection", source: URL, features });
console.log(`${features.length} Florida counties`);
