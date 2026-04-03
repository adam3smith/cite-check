# cite-check

A browser-based tool for validating academic reference lists. Paste a reference list, and cite-check looks up each entry against academic databases, scores the match, and reports which references are verified, likely matched, or not found — with detail on any discrepancies.

Designed for author-date citation styles (Chicago, APA). Works with numbered lists, hanging-indent, and blank-line separated entries.

**Live app:** https://karchlab.github.io/cite-check/

## How it works

cite-check processes each reference through a four-stage pipeline:

1. **Parse** — splits the input into individual entries and classifies each as journal article, book, book chapter, website, or other.
2. **Extract** — pulls out authors, year, title, journal or publisher, DOI, URL, and ISBN.
3. **Look up** — queries external APIs based on type (see below). Results stream into the UI as they arrive.
4. **Verify** — scores the retrieved record against the input using weighted field matching and flags discrepancies.

### Scoring

Fields are compared using Jaro-Winkler string similarity (authors, container, pages) and a combined Jaro-Winkler / token Jaccard score for titles. Year matching allows a ±1 tolerance for online-first / print date discrepancies.

Weighted total: title 40%, author 30%, year 15%, journal/publisher 10%, pages 5%.

| Score | Status |
|---|---|
| ≥ 0.90 | Verified |
| 0.70–0.89 | Likely match |
| 0.50–0.69 | Weak match |
| < 0.50 | Not found |

### APIs used

| Reference type | Primary | Fallback |
|---|---|---|
| Journal article (with DOI) | CrossRef DOI lookup | — |
| Journal article (no DOI) | CrossRef title search | OpenAlex |
| Book | Google Books | OpenLibrary |
| Book chapter | CrossRef search | OpenAlex |
| Website | Browser fetch probe | — |

All queries are made directly from your browser. No data passes through any intermediary server.

### Citation formatting

Verified references are formatted as Chicago Author-Date bibliography entries using [citation.js](https://citation.js.org/) with the Chicago 17th edition CSL template.

## Privacy

cite-check sends reference metadata (titles, authors, DOIs) to the APIs listed above in order to look up records. No data is stored or logged by this application.

---

## Developer notes

### Tech stack

- [Vite](https://vitejs.dev/) + TypeScript
- [Alpine.js](https://alpinejs.dev/) (CDN) for reactive UI
- [citation.js](https://citation.js.org/) for Chicago Author-Date formatting
- [Vitest](https://vitest.dev/) for unit tests

### Project structure

```
cite-check/
├── public/
│   └── csl/chicago-author-date.csl   # CSL template (local copy)
├── src/
│   ├── main.ts                        # entry point
│   ├── app.ts                         # Alpine component factory
│   ├── types.ts                       # shared TypeScript interfaces
│   ├── declarations.d.ts              # type stubs for untyped packages
│   ├── stages/
│   │   ├── stage1-parse.ts            # split + classify reference entries
│   │   ├── stage2-extract.ts          # extract bibliographic fields
│   │   ├── stage3-lookup.ts           # API routing and rate limiting
│   │   └── stage4-verify.ts           # score, format, find discrepancies
│   ├── api/
│   │   ├── crossref.ts
│   │   ├── openalex.ts
│   │   ├── openlibrary.ts
│   │   ├── googlebooks.ts
│   │   └── url-check.ts
│   └── lib/
│       ├── string-distance.ts         # Jaro-Winkler, token Jaccard, field scoring
│       ├── citation-format.ts         # citation.js wrapper
│       └── rate-limiter.ts            # token bucket (1 req/sec per domain)
├── tests/
│   ├── fixtures/references.ts         # canonical test reference strings
│   ├── stage1-parse.test.ts
│   ├── stage2-extract.test.ts
│   ├── string-distance.test.ts
│   └── stage4-verify.test.ts
├── index.html
├── style.css
└── vite.config.ts
```

### Running locally

```bash
npm install
npm run dev       # dev server at http://localhost:5173/cite-check/
npm test          # run unit tests (Vitest)
npm run build     # production build → dist/
```

### Deployment

The app is deployed to GitHub Pages via GitHub Actions. On every push to `main`, CI runs `npm test` and then `npm run build`. Deployment is skipped if tests fail.

The base path is `/cite-check/` (configured in `vite.config.ts`).

### Adding test fixtures

Canonical reference strings live in `tests/fixtures/references.ts`. Each fixture has an `id`, the `raw` reference string, and expected field values used across multiple test files. When adding new reference types or edge cases, add a fixture there first.

## License

MIT. Created by [Sebastian Karcher](https://github.com/karchlab) with [Claude Code](https://claude.ai/code).
