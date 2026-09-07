---
name: run-app
description: Use when running, launching, screenshotting or visually checking the Website Health Report Electron app — verifying a report route, analyzer output, PDF export or UI change in the real app rather than in tests.
---

# Running the Website Health Report app

Electron main process + a client-only SvelteKit renderer. Windows host, no
Playwright and no `pdftoppm` here, so the app is driven by a small Electron
script that reuses the app's own server, preload and IPC.

## Two ways in

| Goal | Command |
|---|---|
| The app as the operator sees it (window, clicking) | `npm run electron:start` |
| A specific report, captured as PNG or PDF | the seed + drive recipe below |

## Recipe: look at a report

```bash
cd /e/Projects/websitehealthreport
npm run build && npm run electron:compile
node .claude/skills/run-app/scripts/seed-run.cjs
npx electron .claude/skills/run-app/scripts/drive-report.cjs 2026-09-07T090000-example-com report.png
```

Then Read the PNG. `.pdf` as the output goes through the app's own
`exportRunPdf` instead — but **capture PNG when you need to look at it**:
`Read` cannot rasterise a PDF on this machine (no poppler).

`seed-run.cjs` writes a finished Lighthouse run (mobile + desktop, deliberately
mismatched) into run storage. Edit its `run` object to stage other analyzers or
states. A real run is minutes per domain — never wait on live analyzers just to
check rendering.

## Why not something simpler

- **`npm run dev` + a browser**: `/report/:id` calls `api().loadRun()`, which
  needs `window.api` from the preload. In a plain browser it throws
  "Preload API unavailable" and renders nothing.
- **`file://` the build**: the renderer is adapter-static with root-absolute
  asset paths and no file on disk for `/report/:id`. It needs the loopback
  static server (see `electron/server.ts`).
- **A fixed sleep before capturing**: the route sets `data-report-state`;
  poll that. A sleep captures "Loading…" and reports success.

## Gotchas

- **userData depends on how Electron started.** `npm run electron:start` uses
  `%APPDATA%\websitehealthreport`; a bare `npx electron <script>` uses
  `%APPDATA%\Electron`. The seed script writes both — if a run "cannot be
  loaded", check which root the process picked.
- **Run ids are validated.** `assertRunId` requires
  `YYYY-MM-DDTHHMMSS-<host>`; anything else is rejected at the IPC boundary.
- **`capturePage` is viewport-only.** Resize to `scrollHeight` first or the
  bottom of the report is missing from the screenshot.
- **Rebuild after renderer changes.** `npm run build` regenerates `build/`;
  the driver serves that, not your source.
- **Look at the image.** A blank or "Loading…" frame is a failed run, not a pass.
