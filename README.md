# Where's Our Audit?

See if your town filed its audit. If it didn't, ask for it in one click.

A free, static website. For every local government it shows:

- whether its annual audit is public
- a report card on how much of its money information is online
- a ready-to-send public records request letter, which the resident sends themselves

Stage 1 covers Maine, stage 2 Florida, and stage 3 federal single audit status for local governments in every other state. How every status and grade is worked out is on the site's "How we grade" page (`/how-we-grade/`), and `scripts/check.mjs` enforces the main wording and data rules on every build.

## Run it

Requires Node 22 or newer (the weekly job uses Node 24). Run `npm ci` once: the only dependency is `@resvg/resvg-js` (development only), which draws the 1200 x 630 share images. Images use the bundled Source Serif 4 font (SIL Open Font License, `assets/fonts/LICENSE.md`) and are generated on every build, not committed.

```
npm run fetch:maine   # copy the State Auditor's tables into data/raw/maine/<today>/
npm run fetch:florida # copy 5 years of Florida DFS LOGERx reports into data/raw/florida/<today>/
npm run fetch:us      # filter the Federal Audit Clearinghouse general.csv (about 270 MB) into data/raw/us/<today>/
npm run build         # data/derived/{maine,florida,us}.json, then dist/
npm run check         # rule checks: banned words, em dashes, footer, flag parts, file count
npm run serve         # http://localhost:8790
```

`npm run build` uses the newest dated snapshot. If more than 10% of statuses changed since the last build, it stops. Review the change, then run `node scripts/build-maine-data.mjs --approve`.

## Folders

| Path | What it holds |
|---|---|
| `data/raw/maine/<date>/` | Dated copies of the source pages, as fetched. Each flag cites one. |
| `data/reference/` | Census 2024 Gazetteer (names and GEOIDs), Maine Secretary of State clerk list, town shapes (Census TIGER/Line, simplified). |
| `data/manual/` | Hand-entered files: website checks, aliases, own-site audits, official replies, corrections. |
| `data/derived/` | Built data, the status-change log, and the first date each audit was flagged. |
| `scripts/` | Fetch, build, check, serve. |
| `src/` | Page CSS and the small browser script (search and letter). |

## Hand-entered data (`data/manual/`)

- `website-checks.csv`: one row per rubric item checked live by a person (items 3 to 7). A government gets a grade only when all 7 items are known.
- `aliases-me.csv`: confirmed name matches the exact-match rule missed. Never add a guess.
- `own-site-audits.csv`: audits found on a government's own website, with the earliest archived date.
- `replies.csv`: official replies, shown word for word (300 words max).

## Rules this code enforces

- Maine flags say "not posted", never "not filed". The 12-month line is labelled as our rule unless a statute sets it.
- No banned words on any page (`scripts/lib/rubric.mjs`). Flags name governments, never people.
- The disclosure footer appears on every page.
- This repo must never contain Civic-Chain sales data.

## License

MIT for the code. The data comes from public sources: the Maine State Auditor, Maine Department of Education and Maine Secretary of State; the Florida Department of Financial Services, Florida Auditor General and FloridaCommerce; the Federal Audit Clearinghouse; and the US Census Bureau. Three association directories (Florida Court Clerks and Comptrollers, Maine County Commissioners Association and Florida Association of Counties) supply office contacts and county board names. The Source Serif 4 font is under the SIL Open Font License (`assets/fonts/LICENSE.md`).

## Weekly refresh (GitHub Actions)

`.github/workflows/refresh.yml` runs `scripts/refresh.mjs` every Monday at 11:00 UTC. It fetches every source, rebuilds, runs the checks, commits the new dated copies, and deploys to Cloudflare Pages.

- **Safety brake:** if more than 10% of statuses change, nothing is committed or deployed. The job opens an issue with the summary instead. After reviewing, run the workflow by hand with "approve" ticked.
- **Stored status:** the brake compares against `data/derived/*-status.json`, which are committed, so it works on a fresh checkout.
- **Storage:** only the newest federal copy (about 17 MB) is kept in git. Every Maine and Florida copy is kept.
- **Deploys:** they need two repository secrets, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and a Cloudflare Pages project named `wheresouraudit`. Without them, the job still refreshes and commits the data.
- **Run it locally:** `node scripts/refresh.mjs` (add `--skip-fetch` to rebuild from the copies you already have).

## Website review tool (local only)

Grades need a person to check rubric items 3 to 7 (website, budget, audit online, minutes, records contact) on each government's live website. The review tool makes that quick. It is never deployed.

```
npm run review:queue                 # order: all of Maine, then Florida counties and cities, then Florida districts
npm run review:crawl -- --group=1    # suggest links (slow and polite, about 1 request every 2 seconds; resumable)
npm run review                       # open http://localhost:8791 (/mayors for Florida mayors, /boards for Maine town boards)
```

- **Websites:** from the Census of Governments 2022 list and FloridaCommerce's district list. Many are stale, so the crawler warns on errors, on redirects to another domain, and on pages that don't mention the government's name. Paste the right address and rescan.
- **Suggestions are only hints.** Every Pass needs the link that shows it.
- **Saving:** checks go to `data/manual/website-checks.csv`, with the date and the reviewer's initials. A government is graded on the next build, once all 5 items are checked.
- **Archive copies:** each passed link is sent to the Internet Archive's Save Page Now, one every 20 seconds, and the snapshot address is saved. Set `REVIEW_NO_ARCHIVE=1` to turn this off while testing.

## Yearly: Florida Auditor General late-filer report

Each November or December the Florida Auditor General publishes a report listing local governments whose audits were missing or late. After it comes out, run once (needs `pdftotext` from poppler):

```
node scripts/reference/make-fl-auditor-general.mjs <report number> <status date>   # e.g. 2026-049 2025-10-10
```

The script refuses to write the CSV unless every exhibit's count matches the report's own totals. Add the new report's totals to `EXPECT` in the script first. Each matched entry becomes a dated flag on the Florida page. When the report and the state finance department disagree, both dates are shown. Names that match nothing go on the "Records we couldn't match" page.

## Confirming officials

City mayors are never published straight from a dataset. `node scripts/reference/make-fl-mayors.mjs` builds candidates from Wikidata and Open States into `data/review/` (not committed). Then a person opens `http://localhost:8791/mayors`, checks each one on the city's own website, and confirms it, corrects it, or rejects it. Only confirmed and corrected names, each with the page that shows it, go in `data/manual/officials-confirmed.csv` and on the site.

Maine town boards work the same way. `node scripts/reference/make-me-officials.mjs --limit=0` scans town websites for board pages and suggests names (into `data/review/`, not committed). At `http://localhost:8791/boards` a person types the board as it is today, one `Name, Title` per line, and pastes the town page that lists it. The whole board is saved with that page and date, one row per person.
