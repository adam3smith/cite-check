/**
 * Canonical test reference strings covering all 5 reference types.
 * Used across stage1, stage2, and stage4 tests.
 *
 * Each fixture has:
 *   raw        — the pasted string as-is
 *   type       — expected classification
 *   fields     — expected extracted field values (partial; undefined = don't test)
 */

export interface ReferenceFixture {
  id: string
  raw: string
  type: 'journal-article' | 'book' | 'book-chapter' | 'website' | 'other'
  confidence?: 'high' | 'medium' | 'low'
  fields?: {
    authorLastNames?: string[]
    year?: string
    title?: string
    container?: string
    doi?: string
    url?: string
    isbn?: string
    volume?: string
    issue?: string
    pages?: string
  }
}

export const fixtures: ReferenceFixture[] = [
  // ── Journal articles ─────────────────────────────────────────────────────

  {
    id: 'article-with-doi',
    raw: 'Acemoglu, Daron, Simon Johnson, and James A. Robinson. 2001. "The Colonial Origins of Comparative Development: An Empirical Investigation." American Economic Review 91 (5): 1369–1401. https://doi.org/10.1257/aer.91.5.1369',
    type: 'journal-article',
    fields: {
      authorLastNames: ['Acemoglu', 'Johnson', 'Robinson'],
      year: '2001',
      title: 'The Colonial Origins of Comparative Development: An Empirical Investigation',
      container: 'American Economic Review',
      doi: '10.1257/aer.91.5.1369',
      volume: '91',
      issue: '5',
      pages: '1369–1401',
    },
  },

  {
    id: 'article-no-doi-chicago',
    raw: 'Pierson, Paul. 2000. "Increasing Returns, Path Dependence, and the Study of Politics." American Political Science Review 94 (2): 251–267.',
    type: 'journal-article',
    fields: {
      authorLastNames: ['Pierson'],
      year: '2000',
      title: 'Increasing Returns, Path Dependence, and the Study of Politics',
      container: 'American Political Science Review',
      volume: '94',
      issue: '2',
      pages: '251–267',
    },
  },

  {
    id: 'article-apa-style',
    raw: 'Putnam, R. D. (1993). Making democracy work: Civic traditions in modern Italy. Journal of Democracy, 4(3), 35–49.',
    type: 'journal-article',
    fields: {
      authorLastNames: ['Putnam'],
      year: '1993',
      container: 'Journal of Democracy',
      volume: '4',
      issue: '3',
      pages: '35–49',
    },
  },

  {
    id: 'article-wrong-year',
    raw: 'North, Douglass C. 1992. "Institutions." Journal of Economic Perspectives 5 (1): 97–112.',
    type: 'journal-article',
    // year is wrong (1992 vs 1991) — used to test discrepancy detection
    fields: {
      authorLastNames: ['North'],
      year: '1992',
      title: 'Institutions',
      container: 'Journal of Economic Perspectives',
      volume: '5',
      issue: '1',
      pages: '97–112',
    },
  },

  // ── Books ─────────────────────────────────────────────────────────────────

  {
    id: 'book-chicago',
    raw: 'Thelen, Kathleen. 2004. How Institutions Evolve: The Political Economy of Skills in Germany, Britain, the United States, and Japan. Cambridge University Press.',
    type: 'book',
    fields: {
      authorLastNames: ['Thelen'],
      year: '2004',
      title: 'How Institutions Evolve: The Political Economy of Skills in Germany, Britain, the United States, and Japan',
      container: 'Cambridge University Press',
    },
  },

  {
    id: 'book-with-isbn',
    raw: 'North, Douglass C. 1990. Institutions, Institutional Change and Economic Performance. Cambridge University Press. ISBN: 978-0-521-39734-6.',
    type: 'book',
    fields: {
      authorLastNames: ['North'],
      year: '1990',
      title: 'Institutions, Institutional Change and Economic Performance',
      container: 'Cambridge University Press',
      isbn: '9780521397346',
    },
  },

  {
    id: 'book-two-authors',
    raw: 'Hall, Peter A., and David Soskice. 2001. Varieties of Capitalism: The Institutional Foundations of Comparative Advantage. Oxford University Press.',
    type: 'book',
    fields: {
      authorLastNames: ['Hall', 'Soskice'],
      year: '2001',
      title: 'Varieties of Capitalism: The Institutional Foundations of Comparative Advantage',
      container: 'Oxford University Press',
    },
  },

  // ── Book chapters ─────────────────────────────────────────────────────────

  {
    id: 'chapter-chicago',
    raw: 'Mahoney, James, and Kathleen Thelen. 2010. "A Theory of Gradual Institutional Change." In Explaining Institutional Change: Ambiguity, Agency, and Power, edited by James Mahoney and Kathleen Thelen, 1–37. Cambridge University Press.',
    type: 'book-chapter',
    fields: {
      authorLastNames: ['Mahoney', 'Thelen'],
      year: '2010',
      title: 'A Theory of Gradual Institutional Change',
      pages: '1–37',
    },
  },

  {
    id: 'chapter-apa',
    raw: 'Pierson, P. (2000). Not just what, but when: Timing and sequence in political processes. In P. Pierson (Ed.), The new politics of the welfare state (pp. 54–78). Oxford University Press.',
    type: 'book-chapter',
    fields: {
      authorLastNames: ['Pierson'],
      year: '2000',
      title: 'Not just what, but when: Timing and sequence in political processes',
      pages: '54–78',
    },
  },

  // ── Websites ──────────────────────────────────────────────────────────────

  {
    id: 'website-accessed',
    raw: 'World Bank. 2023. "World Development Indicators." Accessed January 15, 2024. https://databank.worldbank.org/source/world-development-indicators.',
    type: 'website',
    fields: {
      year: '2023',
      url: 'https://databank.worldbank.org/source/world-development-indicators',
    },
  },

  {
    id: 'website-broken-url',
    raw: 'Smith, John. 2020. "Some Policy Brief." Policy Institute. https://www.example-policy-institute.org/briefs/this-does-not-exist-404.',
    type: 'website',
    fields: {
      authorLastNames: ['Smith'],
      year: '2020',
      url: 'https://www.example-policy-institute.org/briefs/this-does-not-exist-404',
    },
  },

  // ── Other / edge cases ────────────────────────────────────────────────────

  {
    id: 'other-report',
    raw: 'International Monetary Fund. 2022. World Economic Outlook: Countering the Cost-of-Living Crisis. IMF.',
    type: 'other',
    fields: {
      year: '2022',
      title: 'World Economic Outlook: Countering the Cost-of-Living Crisis',
    },
  },

  {
    id: 'other-working-paper',
    raw: 'Acemoglu, Daron. 2003. "Why Not a Political Coase Theorem?" NBER Working Paper No. 9377.',
    type: 'other',
    fields: {
      authorLastNames: ['Acemoglu'],
      year: '2003',
      title: 'Why Not a Political Coase Theorem?',
    },
  },

  // ── APA year-disambiguator (a/b) + non-standard publication status ─────────

  {
    id: 'article-online-first',
    raw: 'Bernardi, L., Rico, G., & Anduiza, E. (2024b). Not in the mood for party: Symptoms of depression reduce the weight of partisanship on vote choice. Political Psychology. Online first.',
    type: 'journal-article',
    fields: {
      authorLastNames: ['Bernardi', 'Rico', 'Anduiza'],
      year: '2024',
      title: 'Not in the mood for party: Symptoms of depression reduce the weight of partisanship on vote choice',
      container: 'Political Psychology',
    },
  },

  {
    id: 'article-volume-only',
    raw: 'Bernardi, L., Sala, G., & Gotlib, I. H. (2024a). A cognitive model of depression and political attitudes. Electoral Studies, 87.',
    type: 'journal-article',
    fields: {
      authorLastNames: ['Bernardi', 'Sala', 'Gotlib'],
      year: '2024',
      title: 'A cognitive model of depression and political attitudes',
      container: 'Electoral Studies',
      volume: '87',
    },
  },
]

/** Numbered list format for testing splitting logic */
export const numberedListText = `1. Acemoglu, Daron, Simon Johnson, and James A. Robinson. 2001. "The Colonial Origins of Comparative Development." American Economic Review 91 (5): 1369–1401.
2. Pierson, Paul. 2000. "Increasing Returns, Path Dependence, and the Study of Politics." American Political Science Review 94 (2): 251–267.
3. Thelen, Kathleen. 2004. How Institutions Evolve. Cambridge University Press.`

/** Blank-line separated format */
export const blankLineSeparatedText = `Acemoglu, Daron, Simon Johnson, and James A. Robinson. 2001. "The Colonial Origins of Comparative Development." American Economic Review 91 (5): 1369–1401.

Pierson, Paul. 2000. "Increasing Returns, Path Dependence, and the Study of Politics." American Political Science Review 94 (2): 251–267.

Thelen, Kathleen. 2004. How Institutions Evolve. Cambridge University Press.`

/** Hanging-indent format (continuation lines indented) */
export const hangingIndentText = `Acemoglu, Daron, Simon Johnson, and James A. Robinson. 2001. "The Colonial Origins of Comparative
    Development." American Economic Review 91 (5): 1369–1401.
Pierson, Paul. 2000. "Increasing Returns, Path Dependence, and the Study of Politics." American
    Political Science Review 94 (2): 251–267.
Thelen, Kathleen. 2004. How Institutions Evolve. Cambridge University Press.`

/** All fixture raws as a single blank-line separated block */
export const allFixturesText = fixtures.map((f) => f.raw).join('\n\n')
