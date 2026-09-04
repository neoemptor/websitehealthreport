---
name: Website Health Report
description: Dark instrument on screen, light inspection report on paper, both in the D S Bailey Freelancer identity.
colors:
  brand-orange: '#fdb118'
  brand-orange-warm: '#f7931e'
  brand-orange-pressed: '#e67e0d'
  brand-orange-ink: '#b86307'
  page-black: '#0a0a0a'
  card-black: '#1a1a1a'
  paper-white: '#ffffff'
  ink: '#1a1a1a'
  ink-secondary: '#4b5563'
  ink-muted: '#6b7280'
  label-grey: '#9ca3af'
  paper-rule: '#e5e7eb'
  ok-print: '#2e7d5b'
  ok-screen: '#4fb37f'
  fail-print: '#b3401f'
  fail-screen: '#e0663f'
  text-on-dark: 'rgba(255,255,255,0.7)'
  text-on-dark-secondary: 'rgba(255,255,255,0.6)'
  text-on-dark-muted: 'rgba(255,255,255,0.5)'
  text-on-dark-disabled: 'rgba(255,255,255,0.4)'
  field-border: 'rgba(255,255,255,0.2)'
  hairline: 'rgba(255,255,255,0.1)'
  card-edge: 'rgba(255,255,255,0.05)'
typography:
  display:
    fontFamily: 'Poppins, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    fontSize: '30px'
    fontWeight: 700
    lineHeight: 1.25
  headline:
    fontFamily: 'Poppins, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    fontSize: '28px'
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: 'Poppins, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    fontSize: '21px'
    fontWeight: 700
    lineHeight: 1.5
  check-heading:
    fontFamily: 'Poppins, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    fontSize: '19px'
    fontWeight: 600
    lineHeight: 1.5
  figure:
    fontFamily: 'Poppins, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    fontSize: '20px'
    fontWeight: 700
    lineHeight: 1
  body:
    fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.625
  body-paper:
    fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    fontSize: '12.5px'
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    fontSize: '11px'
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: '0.08em'
  caption:
    fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    fontSize: '10.5px'
    fontWeight: 400
    lineHeight: 1.5
  reading:
    fontFamily: 'ui-monospace, Cascadia Mono, SF Mono, Consolas, Liberation Mono, monospace'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: 1.5
  button:
    fontFamily: 'Poppins, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    fontSize: '15px'
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: '0.5px'
rounded:
  field: '8px'
  btn: '10px'
  card: '16px'
  pill: '9999px'
spacing:
  xs: '6px'
  sm: '12px'
  md: '16px'
  lg: '20px'
  xl: '28px'
  2xl: '32px'
  3xl: '36px'
  rail: '224px'
  logo: '25mm'
components:
  button-primary:
    backgroundColor: '{colors.brand-orange}'
    textColor: '#000000'
    typography: '{typography.button}'
    rounded: '{rounded.btn}'
    padding: '14px 32px'
  button-primary-hover:
    backgroundColor: '{colors.brand-orange-warm}'
    textColor: '#000000'
  button-primary-active:
    backgroundColor: '{colors.brand-orange-pressed}'
    textColor: '#000000'
  button-primary-disabled:
    backgroundColor: '{colors.ink-secondary}'
    textColor: '{colors.text-on-dark-disabled}'
  button-quiet:
    backgroundColor: 'transparent'
    textColor: '{colors.brand-orange}'
    typography: '{typography.button}'
    rounded: '{rounded.btn}'
    padding: '14px 32px'
  button-quiet-hover:
    backgroundColor: '{colors.brand-orange}'
    textColor: '#000000'
  field:
    backgroundColor: '{colors.page-black}'
    textColor: '#ffffff'
    typography: '{typography.reading}'
    rounded: '{rounded.field}'
    padding: '12px 16px'
  card:
    backgroundColor: '{colors.card-black}'
    textColor: '{colors.text-on-dark}'
    rounded: '{rounded.card}'
    padding: '14px 20px'
  nav-link:
    backgroundColor: 'transparent'
    textColor: '{colors.text-on-dark}'
    typography: '{typography.body}'
    rounded: '{rounded.field}'
    padding: '8px 12px'
  nav-link-active:
    backgroundColor: 'transparent'
    textColor: '{colors.brand-orange}'
  chip:
    backgroundColor: 'transparent'
    typography: '{typography.label}'
  alert:
    backgroundColor: '{colors.card-black}'
    textColor: '{colors.fail-screen}'
    typography: '{typography.reading}'
    rounded: '{rounded.field}'
    padding: '12px 16px'
  paper:
    backgroundColor: '{colors.paper-white}'
    textColor: '{colors.ink}'
    typography: '{typography.body-paper}'
    padding: '44px 48px'
---

# Design System: Website Health Report

## Overview

**Creative North Star: "The Inspection Report"**

Two registers, one identity. The tool screens are a dark instrument: page black, card black, white body at 70%, hairlines at 10% white, with brand orange kept for the active nav item, the progress bar, the one primary button and the caret. The client report is the same identity's light stationery: white stock, near-black ink, orange only on the check headings, the header rule, the logo and the status marks. The report is rendered as paper on screen too (a white sheet on the dark page, under the app's only shadow), because on screen it is a preview of a printed artefact and not a fourth tool screen.

The document reads the way a buyer reads a house inspection. Every check opens with an orange heading and a severity word in the right-hand result column, then a two-line plain-English finding, and only then the readings. Nothing on the page is other than a measurement, a name, or a gloss. Status is always a glyph plus a word plus a colour, never colour alone, because these reports are printed in black and white. Controls are the brand guide's shape, weight and tracking with none of its lift, glow or shine: flat at rest, a colour change on hover, nothing that moves.

Density is unhurried. Screen copy sits in a 224px left rail and a content column capped between 672px and 896px; the paper sheet is 820px wide with 48px side margins on screen and A4 with 16mm margins in print. Rejected outright: the SaaS dashboard (score gauges, tile grids, KPI cards), the marketing site (hero, gradient, glow), and the generic PDF export (a screen printed as-is).

**Key Characteristics:**

- Dark-first tool screens; the report alone is white, on screen and on paper.
- Single accent: brand orange, black text on it, never body copy on white.
- Poppins 600–800 for headings, figures and buttons; Inter 400–700 for everything read; the system mono stack for measured values only.
- Status is glyph + word + colour; the five marks are authored SVG masks that take `currentColor`.
- One right-hand result column rules the report page; no tiles, no gauges.
- Flat surfaces; one authored motion (the run grid filling in).

## Colors

A one-accent palette: brand orange over black on screen, brand orange over white on paper, with green and red admitted sparingly and only as status.

### Primary

- **Brand Orange** (`brand-orange`): the accent everywhere. On screen: primary button fill, active nav link, hover text on nav links, quiet-button border and text, the progress bar, the stat figure on the run screen, focus ring, caret, selection. On paper: the logo, the 2px header rule, the 0.5pt footer rule. Text on it is always black.
- **Warm Orange** (`brand-orange-warm`): the primary button's hover fill only.
- **Pressed Orange** (`brand-orange-pressed`): the primary button's active fill only.
- **Orange Ink** (`brand-orange-ink`): the only orange permitted as type on white. Used for the 19px check headings and the 20px "Needs work" score figures; both clear the guide's 14pt floor. Never used on screen.

### Neutral

- **Page Black** (`page-black`): the screen page and the field fill.
- **Card Black** (`card-black`): the left rail, cards, list surfaces, the alert. Also serves as **Ink** on paper: the same hex is the report's body text and headings.
- **Ink Secondary** (`ink-secondary`): the report's lead sentence and finding text; also the disabled primary button's fill on screen.
- **Ink Muted** (`ink-muted`): paper metadata, glosses, legend text, "n/a" and "not run" chips, table headings on paper, field placeholders on screen, the PDF footer.
- **Label Grey** (`label-grey`): uppercase field labels and table heads on the dark screens.
- **Paper Rule** (`paper-rule`): every horizontal rule on the report other than the orange header rule: legend borders, domain underlines, table row borders.
- **White at 70 / 60 / 50 / 40** (`text-on-dark*`): body, secondary, tertiary and disabled text on the dark screens. The steps are alpha, not separate greys, so they sit correctly on both page and card black.
- **White at 20 / 10 / 5** (`field-border`, `hairline`, `card-edge`): field border, row dividers and table borders, card edge and row hover fill.

### Status

- **OK** (`ok-print` on paper, `ok-screen` on the dark screens) and **Fail** (`fail-print`, `fail-screen`): two steps each so the colour clears 4.5:1 on white and on page black respectively. They appear on status chips, severity words, score figures and band words, the "unused" keyword count, and the export confirmation line. Nowhere else.

### Named Rules

**The Black-on-Orange Rule.** Text on any orange surface is black. There is no white-on-orange anywhere in the system.

**The 14pt Floor Rule.** Orange type on white is `brand-orange-ink` and at least 19px (14pt). Anything smaller on paper is ink, muted ink, or a status colour; "warn" severity words are plain ink for exactly this reason.

**The Never-Colour-Alone Rule.** Every state carries a glyph and a word before it carries a colour. If a status would vanish on a greyscale print, it is not finished.

**The Screen/Paper Step Rule.** OK and fail each have a print step and a screen step. Use `*-print` on white, `*-screen` on black; never the reverse.

## Typography

**Display Font:** Poppins (with system-ui, Segoe UI, Roboto, sans-serif), weights 600/700/800, bundled via @fontsource.
**Body Font:** Inter (with system-ui, Segoe UI, Roboto, sans-serif), weights 400/500/600/700, bundled via @fontsource.
**Label/Mono Font:** the system mono stack (ui-monospace, Cascadia Mono, SF Mono, Consolas, Liberation Mono). No brand mono exists; the stack is used only for measured values and stays small.

**Character:** Poppins carries names, verdicts and figures with a geometric heaviness; Inter carries everything meant to be read. The pairing is plain-spoken rather than typographic: no italics, no display sizes beyond 30px, no tracking on running text.

### Hierarchy

- **Display** (Poppins 700, 30px, tight): the client domain at the head of the report. Breaks words only when a domain is longer than a line.
- **Headline** (Poppins 700, 28px, tight): the screen page titles ("New report", "Runs", the run's domain).
- **Title** (Poppins 700, 21px): each domain's heading in the report, paired with its 10px tracked role tag.
- **Check heading** (Poppins 600, 19px, `brand-orange-ink`): each check's heading in the report. This is the smallest orange type on white.
- **Figure** (Poppins 700, 20px on paper / 26px on screen, line-height 1, tabular): Lighthouse scores and the settled/total count. Coloured by band on paper, orange on screen.
- **Body** (Inter 400, 14px screen / 13px lead and 12.5px findings on paper, line-height 1.625): running copy. Findings are capped at 62ch. Print sets the root at 10.5pt.
- **Label** (Inter 600, 11px, uppercase, 0.08em): field labels, table heads, chip words, the run status. Paper table heads drop to 10px at 0.1em; the domain role tag is 10px at 0.12em.
- **Caption** (Inter 400, 10.5px): plain-English glosses beneath every technical label, letterhead contact lines, "out of 100" and "target under" notes.
- **Reading** (mono 400, 12–14px, tabular): domains, keywords, vital values, dates, file paths, error text. The mono face marks "this was measured or typed", never "this is technical".
- **Button** (Poppins 600, 15px, 0.5px tracking): both button variants.

### Named Rules

**The Gloss Rule.** Every technical label on paper is followed by a 10.5px muted-ink plain-English line. A label without its gloss is incomplete.

**The Mono-Is-Data Rule.** The mono stack is reserved for values the tool measured or the operator typed: domains, counts, times, dates, paths. It is never used for headings, labels or prose.

## Layout

Screen: a fixed 224px left rail (card black, right hairline) beside a main column padded 40px horizontally and 32px vertically. Content is capped per screen: 672px for the setup form, 768px for run history, 896px for the run grid, 820px for the report sheet. Vertical rhythm on screen is 28px between form groups and 28–32px before a list or action row; list rows are 20px horizontal, 14–16px vertical, divided by hairlines.

Paper: the sheet is 820px wide on screen with 48px/44px padding and a shadow; in print it fills A4 with 16mm margins (20mm at the foot for the injected footer). The letterhead runs full width with the 25mm logo right and the contact block left, held 25mm apart, and 25mm of clear space beneath (plus 9mm above in print, which with the page margin makes the clear space above equal to the logo height). Domains flow continuously, 36px between sections; each check sits 28px below the previous. A domain heading and its first content, a check heading and its finding, a short table, and every table row are kept whole across page breaks; a whole check is not, so a long check never lifts off a half-empty page.

The result column: every reading, score, band word and severity word is right-aligned into one column at the right edge of the sheet. Scores are rows in that column, not a tile grid.

Responsive: the report sheet is `max-width`, so it narrows below 820px; the run grid scrolls horizontally inside its card rather than reflowing. There is no mobile navigation; the rail is always present on screen and removed in print.

## Elevation & Depth

Flat, with tonal layering. On screen, depth is card black on page black, edged by a 5% white border and divided by 10% white hairlines; hover is a 5% white wash. No surface lifts, glows or sweeps. The single shadow in the system belongs to the report sheet on screen (`0 2px 24px rgba(0,0,0,0.5)`), which exists to read as a sheet of paper lying on the dark page; it is removed in print.

### Named Rules

**The No-Lift Rule.** Controls change colour on hover and active; they never translate, scale, glow or gain a shadow. The brand guide's lift and shine are deliberately not carried.

**The One Shadow Rule.** The only shadow is under the paper preview. Nothing on the dark screens casts one.

## Shapes

Three radii, the guide's own: 8px for fields, nav links, the alert and the raw-data block; 10px for buttons; 16px for cards and list surfaces. The progress bar is a full pill. Borders are 1px hairlines on cards and rows (20% white on fields, 2px orange on the quiet button); on paper, 1px `paper-rule` lines and one 2px orange rule under the subject header. The five status marks share a 12px grid and a 1.5px stroke: filled disc (ok), open ring (n/a), cross (fail), small dot (pending), half-filled ring (running). The logo is stroked, never filled, and always vector at `currentColor`.

## Components

### Buttons

Refined and restrained: the guide's shape, weight and tracking, none of its lift.

- **Shape:** 10px radius (`btn`), 14px × 32px padding, Poppins 600 15px with 0.5px tracking. Colour transitions in 300ms.
- **Primary:** brand orange fill, black text. Hover warm orange, active pressed orange. Disabled goes neutral (`ink-secondary` fill, 40% white text) rather than dimming the orange, because 40% orange on black reads as mud.
- **Quiet:** transparent with a 2px brand-orange border and orange text; hover fills orange with black text. Disabled: `ink-secondary` border, 40% white text, no hover fill.
- **Focus:** the global ring, 2px brand orange offset 2px against page black.

### Chips (status)

- **Style:** inline, no background, 11px Inter 600 uppercase with wide tracking, a 6px gap, and an 11px mark before the word drawn as an SVG mask in `currentColor` with `print-color-adjust: exact`.
- **State:** `data-mark` selects ok / na / fail / pending / running. Colour comes from the text class: ok-screen / fail-screen / brand orange (running) / 40% white (pending) / label grey (n/a) on screen; ok-print / fail-print / ink-muted on paper. In the report's status rail the chip carries two words, the check name in ink and the state in muted ink.

### Cards / Containers

- **Corner Style:** 16px.
- **Background:** card black on page black.
- **Shadow Strategy:** none; see Elevation.
- **Border:** 1px 5% white edge; rows divided by 10% white hairlines; row hover 5% white wash.
- **Internal Padding:** rows 20px horizontal, 14–16px vertical; table cells 20px × 12px.

### Inputs / Fields

- **Style:** page-black fill, 1px 20% white border, 8px radius, 16px × 12px padding, mono 13px white text, muted-ink placeholder, orange caret. Labels sit above in the 11px uppercase label style in label grey.
- **Focus:** border turns brand orange (300ms); no ring, no glow.
- **Error:** the alert component below the field, never a red border.
- **Checkbox:** native, 16px, `accent-color` brand orange.

### Alert

A card-black panel, 8px radius, 16px × 12px padding, mono 12px in fail-screen, with the cross mark at 3px baseline offset before the message. No coloured edge stripe.

### Navigation

- **Style:** a 224px left rail in card black with a hairline right edge. Brand block at the top (32px orange mark, Poppins 600 13px name, 11px 60% white product line, hairline beneath). Links are 14px, 8px radius, 12px × 8px padding, 70% white; hover turns the text brand orange; active is orange and semibold. No background on hover or active. Hidden in print.

### Letterhead (signature)

Full-width stationery row on the report: business name in Poppins 600 13px ink, three contact lines in Inter 10.5px muted ink at 1.6 line-height, a 64px QR beneath in ink; the logo at 25mm on the right in brand orange, inlined so `currentColor` applies and the PDF cannot print before it lands. Clear space equal to the logo height on every side is supplied by the parent.

### Severity row (signature)

The inspection's device. A flex row: the check heading (Poppins 600 19px orange ink) left, the severity word (Poppins 700 12px uppercase 0.08em, ok-print / ink / fail-print / muted by tone) right in the result column; beneath it the finding in Inter 12.5px ink-secondary capped at 62ch. Heading and finding refuse a page break after them. Readings follow as tables with `paper-rule` row borders: label plus gloss left, value in the result column, band word plus target note at the far right in a 112px column.

### PDF footer

Injected by Chromium on every page: a 0.5pt brand-orange rule, 4mm above 7pt Inter in ink-muted; business name, phone, email and website left; run date and "Page n of m" right. The one place screen and print deliberately differ.

## Do's and Don'ts

### Do:

- **Do** put black text on every orange surface (`brand-orange` fill, `#000000` text).
- **Do** pair every status with its authored mark and a word; set colour through the text class so the mark inherits it.
- **Do** keep the report white on screen as well as in print, under the single `0 2px 24px rgba(0,0,0,0.5)` shadow.
- **Do** align every reading, score, band word and severity word into the right-hand result column.
- **Do** follow each technical label with a 10.5px plain-English gloss in `ink-muted`.
- **Do** use `ok-print`/`fail-print` on white and `ok-screen`/`fail-screen` on black.
- **Do** set the mono stack for domains, counts, times, dates and paths, and nothing else.
- **Do** keep controls flat: colour changes only, 300ms.
- **Do** keep the logo vector, at `currentColor`, no smaller than 25mm on paper with clear space equal to its height.
- **Do** write Australian English and `en-AU` dates in anything the client reads.

### Don't:

- **Don't** set orange type on white below 19px, or use `brand-orange` (rather than `brand-orange-ink`) as type on white at all.
- **Don't** render scores as tiles, gauges, rings or KPI cards; scores are rows in the result column.
- **Don't** add lift, glow, gradient, shine or translation to buttons, cards or links.
- **Don't** dim the orange for a disabled state; go neutral (`ink-secondary` fill, 40% white text).
- **Don't** signal an error with a coloured edge stripe or a red field border; use the alert panel.
- **Don't** use a Unicode character as a status glyph; the five marks are the SVG masks in `app.css`.
- **Don't** use orange for a "warn" severity word or any 10–12px band word on paper; the word is the state.
- **Don't** let a domain heading, a check heading or a finding strand at the foot of a page, or split a table row.
- **Don't** abbreviate "D S Bailey Freelancer" or vary the contact block.
