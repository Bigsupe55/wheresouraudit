# Where's Our Audit?

See if your town filed its audit. If it didn't, ask for it in one click.

A free, static website. For every local government it shows:

- whether its annual audit is public
- a report card on how much of its money information is online
- a ready-to-send public records request letter, which the resident sends themselves

Stage 1 covers Maine. Florida and nationwide federal audit status come next. The plan and every decision behind it live in `civic-chain-docs/wayfinder/citizen-watch/` (spec.md is the summary).

## Run it

Requires Node 20 or newer. There are no dependencies to install.

```
npm run fetch:maine   # copy the State Auditor's tables into data/raw/maine/<today>/
npm run build         # data/derived/maine.json, then dist/
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

MIT for the code. The source records are public records from the State of Maine and the US Census Bureau.
