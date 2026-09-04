# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the operator.** Darren Bailey, trading as D S Bailey Freelancer — an
Australian freelance web consultant. He runs the app himself on three machines
he owns: a Windows PC, a Linux PC and an Apple Silicon Mac. He is technical,
runs audits deliberately rather than continuously, and is the only person who
ever sees the tool screens.

**Secondary: the reader of the report.** Owners of small Australian businesses,
both prospects who have not hired him and clients who already have. They are
not technical. They meet the product only as an exported document, and often
read it alone with no one to explain it.

## Product Purpose

Audits a client's website across nine categories, runs the same measurements
against competitor domains, and produces a report the operator can send.

The report does double duty: it makes the case to a prospect that their site
needs work, and it reports state to an existing client who is already paying.
One document serves both, which means it has to persuade someone cold and also
hold up when run repeatedly against the same site over months.

Success is a document the operator is willing to put his business name on and
send to a paying client.

## Positioning

Three things a neighbouring tool would not truthfully combine:

- **Competitor context by default.** The same nine measurements run against the
  client and their competitors in one pass, so a number is never read alone.
- **A missing check explains itself.** "Not installed on this machine" is kept
  distinct from "ran and crashed" all the way through to the printed page. With
  nine independent sources, several fragile, a report that quietly showed a
  blank where a measurement failed would be worse than no report.
- **Local-first.** Runs execute on the operator's own machines and results stay
  there. Nothing is uploaded to a service, and client content only leaves the
  machine where the operator has explicitly configured a provider.

## Operating Context

- Runs are operator-initiated and take minutes, not seconds — a client plus
  three competitors across nine analyzers is thirty-six separate checks.
- External dependencies are installed by hand, per machine: Chrome, the SEO
  Quake browser extension, a Semrush API key, Google OAuth for Search Console
  and GA4. A machine missing one is the expected state, not an error.
- Every run is kept. Reports are re-run against the same client over time, so
  results are compared across runs as well as across competitors.
- The exported report reaches its reader four ways, all of them real: emailed
  as a PDF and read cold, presented by the operator on a call, printed on
  paper, and filed as a record for comparison against later runs.
- The operator edits the report before sending it. Today that happens outside
  the app, and no good route for it exists.

## Capabilities and Constraints

**Nine analyzers**, each independently available or unavailable: Lighthouse,
Keywords, SEO Quake, Wayback history, passive security headers, AI Agent
Optimisation, Australian spelling and grammar, measured traffic (Search Console
and GA4), and estimated traffic (Semrush). Two are built.

**Every result is one of three states** — `ok`, `unavailable` (a dependency is
missing here), or `failed` (it ran and threw). These are never collapsed, on
screen or in print.

**Constraints that future work must hold:**

- Runs on Windows, Linux and Apple Silicon macOS. No native Node modules —
  this is why run history is JSON files rather than a database.
- Credentials are encrypted at rest and never cross into the renderer. The
  renderer learns only that a credential exists, never its value.
- Security analysis is passive only. No active vulnerability scanning of a
  client's site, ever.
- Estimated traffic is labelled as estimated wherever it appears beside
  measured traffic. Owned traffic exists only for the client, never for
  competitors, and is presented as client-only rather than as a comparison
  with gaps in it.
- Australian date formats in client-facing output.

**Explicitly undecided:** there is no way to add commentary or trim sections
inside the app before exporting. The operator wants one; nothing is built.

## Brand Commitments

- **"D S Bailey Freelancer"** appears exactly as written. Not reworded, not
  abbreviated, not turned into an acronym.
- **Business contact details and website link appear in both the header and the
  footer** of the client-facing report. A QR code is permitted as part of that
  block. The confirmed values:

  |         |                                                 |
  | ------- | ----------------------------------------------- |
  | Website | `https://dsbaileyfreelancer.com.au`             |
  | Email   | `admin@dsbaileyfreelancer.com.au`               |
  | Mobile  | `+61430227786` — displayed as `+61 430 227 786` |

- **Australian English throughout** all client-facing output — spelling and
  date formats. The product ships an Australian grammar checker, so its own
  copy contradicting that would undercut the thing it sells.
- **Plain language, no jargon.** The reader is a small business owner. Technical
  measures always carry a plain-English gloss: "Largest Contentful Paint" is
  always accompanied by "time until the main content appears".

## Evidence on Hand

- `fixtures/lighthouse-cjsgaragedoors.json` — a real captured Lighthouse result
  for a live client domain, used as the parser's test fixture.
- `cjsgaragedoors.com.au` — a live client site, verified reachable and used
  throughout development as the real-data example.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — the design record
  and the four implementation plans for all nine analyzers.

**Absences future work must not fabricate:**

- No logo or supplied brand asset exists. The letterhead is set in type; there
  is no mark to place.
- No testimonials, customer names, pricing, case studies or benchmarks exist.
- `radscafe.com.au` appears in old code as a client domain. It no longer
  resolves — the domain is dead and must not be used as an example.

## Product Principles

1. **A gap explains itself.** Every check that did not produce a number says
   why, in words a client understands. Silence reads as sloppiness on a
   document carrying the operator's business name.
2. **A number alone means nothing.** Measurements are shown against a
   comparison — a competitor, a published threshold, or the same site's earlier
   run — or they are not worth printing.
3. **The export is a draft, not an artifact.** The operator shapes the document
   before a client sees it. Output that cannot be shaped is output that gets
   rebuilt somewhere else.
4. **Never overstate what was measured.** Estimates are labelled estimates.
   Measured data is labelled measured. The distinction survives to the page.
5. **The client's data stays on the operator's machine** unless he has
   explicitly configured a service to receive it, and he is told when he does.

## Accessibility & Inclusion

- The report is printed on paper, including in black and white. Status is never
  carried by colour alone — every state pairs a colour with a glyph and a word.
- The reader is non-technical by default. Any term borrowed from the web
  performance or SEO vocabulary carries a plain-English explanation in the same
  view.
