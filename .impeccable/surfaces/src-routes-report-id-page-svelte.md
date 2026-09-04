---
version: 1
slug: "src-routes-report-id-page-svelte"
primary_target: "src/routes/report/[id]/+page.svelte"
related_targets: ["src/routes/+page.svelte","src/routes/run/[id]/+page.svelte","src/routes/runs/+page.svelte","src/routes/+layout.svelte","src/lib/report/Letterhead.svelte","src/lib/report/Lighthouse.svelte","src/lib/report/Keywords.svelte","src/app.css","tailwind.config.cjs","electron/pdf.ts"]
---

# Surface brief: client report (`/report/:id`) — the whole-app rebrand's first surface

Scope: the client-facing report, on screen and as the printed PDF. Visitor mode: Read.
The three tool screens (setup, run grid, run history) inherit this world in its dark
register; they are Operate surfaces and carry no separate concept.

Audience: a non-technical Australian small-business owner, reading cold from an emailed
PDF or on paper, or re-reading months later. Job: understand their site's health beside
their competitors' and know what to do. Action: none on paper; on screen, Export PDF.
Proof/content: the run's measurements, competitor comparison, plain-English glosses.
Constraints: the dsbaileyfreelancer design guide is pinned; its light print variant on
paper; A4; status legible in greyscale; Australian English; orange never as body text on
white; logo at 25mm minimum with clear space equal to its height.

Unresolved: contact email — guide says sales@, operator supplied admin@ (admin@ in use).

## Direction contract

THESIS: One section per check — a severity word, the reading, a plain finding — read the
way a buyer reads a house inspection. It refuses the score-gauge dashboard.

OWN-WORLD: Brand-pinned. Paper: white, #1A1A1A text, #FDB118 only on headings, rules,
logo, icons. Screen: #0A0A0A page, #1A1A1A cards, white/70 body, white/10 hairlines,
orange for active states and CTAs with black text. Poppins 600–800 headings, Inter body.
Status is glyph + word + colour, never colour alone. Controls flat: no lift, no glow.

STORY: A cold prospect learns what was measured, what it means, and what to do; a
returning client sees what changed.

FIRST VIEWPORT: Letterhead top-right, logo at 25mm. Client domain top-left in Poppins 700,
date line beneath. One-line lead. First section: orange check heading with its severity
word, the reading in a right-hand result column, a two-line finding. Screen action:
Export PDF, orange, black text.

FORM: The Building Inspection — #1 of 7 on the ordered list, taken as the pick over the
assigned #5 (Test-and-Tag Register). Seed key f260b039, kind pick. Raises kept from the
hand: addressable rows; one status legend; aborted runs flag the last-completed row; a
single right-hand result column rules the page; nothing that is not a measurement, a
name, or a gloss; on screen the live grid filling in is the only motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
