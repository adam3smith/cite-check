# cite-check

A browser-based tool for validating academic reference lists. Paste a reference list, and cite-check looks up each entry against academic databases, scores the match, and reports which references are verified, likely matched, or not found — with detail on any discrepancies.

Designed for author-date citation styles (Chicago, APA). Works with numbered lists, hanging-indent, and blank-line separated entries.

**Live app:** https://adam3smith.github.io/cite-check/

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

For journal articles, the likely-match bar is raised to 0.80 (weak-match becomes 0.70–0.79): CrossRef/OpenAlex index nearly all published journal articles, so a 70–79% match is more often a real discrepancy worth a closer look than the online-first/print-date noise that explains most sub-90% scores for other reference types.

### APIs used

| Reference type | Primary | Fallback |
|---|---|---|
| Journal article (with DOI) | CrossRef DOI lookup | — |
| Journal article (no DOI) | CrossRef title search | OpenAlex |
| Book | Google Books | OpenLibrary |
| Book chapter | CrossRef search | OpenAlex |
| Website | Browser fetch probe | — |

All queries are made directly from your browser. No data passes through any intermediary server.

### AI Assist (optional)

If you add your own Anthropic API key under "AI Assist" on the input screen, two extra features appear:

- **AI Fix Line Breaks** — asks Claude to re-join lines broken mid-entry by PDF copy-paste, as an alternative to the built-in heuristic.
- **AI Double-Check** — for references the pipeline couldn't verify, asks Claude (with web search) to judge whether the citation is a real work cited with errors, a fabricated/hallucinated citation, or a real match the databases above just don't index — and to suggest a corrected citation when it finds one.

This is entirely optional and off by default. Your key is stored only in your browser's local storage and sent directly from your browser to Anthropic's API — never through any server this app controls, the same trust model as pasting your own Google Books key. Without a key, the app behaves exactly as described above.

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
- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) for the optional AI Assist features (loaded lazily — only fetched if a user supplies an API key)

### Project structure

```
cite-check/
├── public/
│   └── csl/chicago-author-date.csl   # CSL template (local copy)
├── src/
│   ├── main.ts                        # entry point
│   ├── app.ts                         # Alpine component factory
│   ├── config.ts                      # contact email and other site-wide settings
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
│       ├── rate-limiter.ts            # token bucket (1 req/sec per domain)
│       ├── llm-models.ts              # Claude model catalog + pricing
│       ├── llm-client.ts              # lazy-loaded Anthropic SDK wrapper (BYOK)
│       └── llm-tasks.ts               # AI Fix Line Breaks + AI Double-Check prompts
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

## Setting up your own instance

### 1. Fork and clone

Fork the repository on GitHub, then clone it locally:

```bash
git clone https://github.com/YOUR_USERNAME/cite-check.git
cd cite-check
```

### 2. Install dependencies

Requires [Node.js](https://nodejs.org/en/download/current) 20 or later. Install dependencies with:

```bash
npm install
```

### 4. Update the API contact email

CrossRef and OpenAlex ask that clients identify themselves via a mailto parameter, which grants access to their faster "polite" API pools. Set `CONTACT_EMAIL` in `src/config.ts` to your own address, replacing mine ('karcher@u.northwestern.edu').

### 5. Google Books API key (optional)

Without an API key, Google Books requests use the shared anonymous quota, which is exhausted quickly. To use your own quota:

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/) and enable the Books API.
2. Create an API key under **APIs & Services → Credentials**. This will allow for up to 1,000 Google book queries/day
3. Create a `.env` file at the project root:

```
VITE_GOOGLE_BOOKS_API_KEY=your_key_here
```

The `.env` file is gitignored. For the GitHub Actions deploy, add the key as a repository secret named `VITE_GOOGLE_BOOKS_API_KEY` under **Settings → Secrets and variables → Actions**.

### 6. Enable GitHub Pages

1. In your fork's settings, go to **Pages** and set the source to **GitHub Actions**.
2. Update `vite.config.ts`: change `base: '/cite-check/'` to `base: '/YOUR_REPO_NAME/'`.
3. Push to `main`. The Actions workflow runs tests, builds, and deploys automatically.

Your instance will be live at `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`.

---

## License

MIT. Created by [Sebastian Karcher](https://github.com/adam3smith) with [Claude Code](https://claude.ai/code).
