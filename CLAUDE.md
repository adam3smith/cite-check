# cite-check — Claude guidance

## Project overview

A browser-based citation validator. Paste a reference list; the app classifies each entry, queries CrossRef / OpenAlex / Google Books / OpenLibrary, scores the match, and reports discrepancies.

Pipeline stages:
1. **stage1-parse** — split raw text into entries, classify type (journal-article / book / book-chapter / website / other)
2. **stage2-extract** — pull DOI, ISBN, URL, year, authors, title, container from the raw string
3. **stage3-lookup** — route each type to the right APIs; score candidates against `MIN_ACCEPT_SCORE` (0.65)
4. **stage4-verify** — compute field-level scores, derive verification status, collect discrepancies

## Testing

**Runner:** Vitest (`npm test`). All tests live in `tests/`.

**When to write tests:** Write or update tests whenever you change lookup routing logic (`stage3-lookup.ts`), scoring weights (`string-distance.ts`), field extractors (`stage2-extract.ts`), or type classification (`stage1-parse.ts`). Bug fixes should include a regression test that would have caught the bug.

**How stage3 tests work:** `stage3-lookup.ts` makes real HTTP calls through a rate-limiter, so tests mock everything:

```ts
// Bypass 1.1 s per-domain delay
vi.mock('../src/lib/rate-limiter', () => ({
  rateLimited: (_domain: string, fn: () => Promise<unknown>) => fn(),
}))
// Auto-mock all API modules
vi.mock('../src/api/crossref')
vi.mock('../src/api/openalex')
vi.mock('../src/api/openlibrary')
vi.mock('../src/api/googlebooks')
vi.mock('../src/api/url-check')
```

Use `vi.resetAllMocks()` in `beforeEach` and set defaults for every mock a test block touches. Test boundary conditions: above-threshold result returns immediately; below-threshold falls through to next API; all-fail returns `not-found`.

**Score arithmetic** (useful when writing test data):
- weights: author 0.30, title 0.40, year 0.15, container 0.10, pages 0.05
- `MIN_ACCEPT_SCORE` = 0.65
- A "good match" fixture should match author + title exactly → score ≈ 1.0
- A "bad match" fixture should differ on author and title but share the year → score ≈ 0.15 (well below threshold)

## Lookup routing

`lookupReference` in `stage3-lookup.ts` routes by `ref.type`:

| type | APIs tried (in order) |
|---|---|
| `journal-article` | CrossRef DOI → OpenAlex DOI → CrossRef search → OpenAlex search |
| `book` | OpenLibrary ISBN → Google Books search → OpenLibrary search |
| `book-chapter` | CrossRef search → OpenAlex search |
| `website` | URL probe only |
| `other` | CrossRef search → OpenAlex search → Google Books search → OpenLibrary search |

Citations that look like journal articles but lack the standard `vol(issue)` signal (e.g. law journals formatted as `73 : 839`) are often classified as `other` — the `lookupOther` path handles them by trying both journal and book APIs.

DOIs from non-CrossRef repositories (Harvard Dataverse, Zenodo) are handled by the OpenAlex DOI fallback in `lookupJournalArticle`.
