# Website Health Report

A desktop app for D S Bailey Freelancer. Enter a client's domain and, optionally, its competitors; the app runs a set of checks against every site and produces a client-facing report on screen and as a PDF, on the business letterhead, with a plain-English verdict per check and a letter grade per site.

Runs on Windows, Linux and Mac (Apple silicon). Built with Electron, SvelteKit and TypeScript.

## The checks

| Check                 | What it reads                                                                                                                               | Needs                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Lighthouse            | Performance, accessibility, best practices, SEO scores and Core Web Vitals                                                                  | Google Chrome installed                   |
| Keywords              | Declared meta keywords counted in the page text                                                                                             | Puppeteer's Chromium                      |
| Old SEO practices     | Hidden text and links, keyword stuffing, cloaking, duplicate and doorway pages, old habits, across the homepage and up to 10 internal pages | Puppeteer's Chromium                      |
| Wayback history       | How long the site has been archived and how often                                                                                           | Internet access                           |
| Security              | HTTPS, certificate validity and expiry, security headers, cookie flags. Passive: it reads, never probes                                     | Internet access                           |
| AI Agent Optimisation | How much of the page is readable without JavaScript, robots rules for AI crawlers, sitemap, llms.txt, structured data, headings             | Puppeteer's Chromium                      |
| SEO Quake             | Semrush rank, backlinks, linking domains from the SEO Quake browser extension                                                               | Chrome with SEO Quake installed           |
| Spelling and grammar  | Australian English spelling, offline. Grammar via LanguageTool only if switched on                                                          | Nothing for spelling                      |
| Traffic (estimated)   | Semrush organic traffic, keywords and traffic value for every site                                                                          | Semrush API key                           |
| Traffic (measured)    | The client's own Search Console and GA4 figures. Client site only, with the owner's permission                                              | Google OAuth client, the client's consent |

A check that cannot run on this machine reports **n/a** with a reason. A check that ran and broke reports **failed**. Neither is ever shown as a zero.

## Install

Prebuilt installers come from `npm run app:build` on each platform (see Building). To run from source:

```bash
npm install
npx puppeteer browsers install chrome
```

The second command downloads Puppeteer's own Chromium, used by Keywords, Old SEO practices, AI Agent Optimisation, Spelling and grammar, and SEO Quake.

### Per-check setup

- **Lighthouse**: install Google Chrome. The launcher finds it in the usual places.
- **SEO Quake**: install Google Chrome and the [SEO Quake extension](https://www.seoquake.com/) in the default Chrome profile. The app loads the extension into Puppeteer's Chromium, because Google Chrome 137 and later refuse to load extensions from the command line. Paths can be overridden in Settings if Chrome or the extension live somewhere unusual.
- **Grammar** (optional): off by default. In Settings choose the LanguageTool public API, which sends the client's page text to languagetool.org, or a LanguageTool server you run yourself.
- **Traffic (estimated)**: a Semrush Analytics API key, pasted in Settings. Stored encrypted; it never appears in reports, logs or settings files.
- **Traffic (measured)**: a Google Cloud project with the Search Console API and the Google Analytics Data API enabled, and an OAuth client of type **Desktop app**. Save its client ID and secret in Settings, then connect each client site: a Google sign-in window opens for the site owner to consent (read-only scopes for Search Console and Analytics; loopback redirect on port 8412). Add the site's GA4 property ID in the same section. Refresh tokens are stored encrypted per site and can be disconnected in Settings.
- **Competitor suggestions** (optional): the New report screen can ask Claude to suggest competitors. It uses the Claude Code command line on your own login, no API key. Install Claude Code and sign in with `claude` once; the panel shows whether it is available.

## Run

From source, without a dev server:

```bash
npm run electron:start
```

With live reload:

```bash
npm run electron:dev
```

Then: **New report**, enter the client domain, add competitors by hand or via Suggest competitors, tick the checks, Start run. Every run is kept; open it from **Runs**, then **View report** and **Export PDF**. PDFs are saved under the app's data directory in `reports/`.

## Reading the report

The report opens with a summary: one sentence placing the client among its competitors, a table of every site against every check, and a letter grade per site.

Grades: Good scores 2, Needs work 1, Poor 0, divided by the maximum across the checks that measured the site. **A** 95% and up, **B** 75%, **C** 50%, **D** 25%, **E** below. Any Poor check caps the grade at D. Checks that could not run, and context readings such as SEO Quake figures and traffic, are left out of the grade. Measured traffic is read only for the client, so it never tilts the comparison.

Each check then opens with a one-word verdict and a plain-English finding before its readings. Estimates are always labelled as estimates.

## Settings

Under **Settings**: grammar provider and endpoint, words to ignore when spelling, SEO Quake path overrides, pages to read for Old SEO practices, the Semrush key, the Google client, connected client sites and their GA4 property IDs.

Ordinary settings live in `settings.json` under the app's data directory. Credentials never do: they are encrypted with the operating system's keychain (Electron `safeStorage`) into a separate file that only the main process reads. The user interface can ask whether a credential exists, never what it is.

## Building

```bash
npm run app:build
```

Produces an NSIS installer on Windows, an AppImage on Linux and an arm64 DMG on Mac, under `dist/`. Each platform builds its own; there is no cross-compilation. The build is unsigned unless a certificate is configured for electron-builder.

## Development

```bash
npm run check      # svelte-check
npm run lint       # prettier + eslint
npm test           # vitest
npm run electron:compile
```

Layout: `electron/` is the main process (analyzers under `electron/analyzers/<id>/`, each with a pure parse half and an I/O half; `handlers.ts` holds the IPC handlers and must not import from `electron`; `ipc.ts` is the only file that does). `src/` is the SvelteKit renderer; `src/lib/report/` holds the report components, `severity.ts` (the verdict words) and `grade.ts`. Design and product context are recorded in `DESIGN.md` and `PRODUCT.md`; specs and plans under `docs/superpowers/`.

Adding a check: implement the `Analyzer` contract in `electron/analyzers/types.ts`, add the id to `AnalyzerId` in `src/lib/shared/types.ts`, register it in `handlers.ts`, list it on the New report screen, add a severity branch and a report component. A check without a component falls back to its raw readings, so the report never breaks.

## Privacy

Nothing leaves the machine except the requests each check makes to the site under test, the Internet Archive, Semrush, Google and, only if switched on, LanguageTool or Claude Code. Security analysis is passive. Owned traffic is read only with the site owner's consent.
