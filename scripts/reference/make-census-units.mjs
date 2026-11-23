// One-off: slim copy of the Census of Governments 2022 general-purpose government list
// (counties, municipalities, townships: 38,736 units) as data/reference/census-govt-units-2022.csv.
// Source: https://www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP
// Usage: node scripts/reference/make-census-units.mjs
import { p, writeFile, toCSV } from "../lib/util.mjs";
import { unzip, readXlsx } from "../lib/xlsx.mjs";

const URL = "https://www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP";
const zip = unzip(Buffer.from(await (await fetch(URL)).arrayBuffer()));
const [head, ...rows] = readXlsx(zip["Govt_Units_2022_Final.xlsx"]);
const KEEP = ["CENSUS_ID_PID6", "UNIT_NAME", "UNIT_TYPE", "CITY", "STATE", "ZIP", "WEB_ADDRESS", "POPULATION", "FIPS_STATE", "FIPS_COUNTY", "FIPS_PLACE", "COUNTY_AREA_NAME", "IS_ACTIVE"];
const ix = KEEP.map(k => head.indexOf(k));
writeFile(p("data", "reference", "census-govt-units-2022.csv"), toCSV([KEEP, ...rows.map(r => ix.map(i => r[i] ?? ""))]));
console.log(`${rows.length} general-purpose governments`);
