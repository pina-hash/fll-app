---
title: "2026-08-25 -- A second measured ground: dark mode, and the pairings it exposed on the first one"
date: 2026-08-25
branches: []
migrations: []
subsystems: ["Visual theme, brand"]
record_order: 12
---

Code only. **No migration.** `teams.accent` keeps the same eleven enum values,
the ground preference lives in `localStorage`, and nothing in `supabase/`
changed.

### What this is, and what it deliberately is not

0018 made the ground white because it was forced to: the FIRST and FIRST LEGO
League accents measure 8.94, 5.91, 4.38 and 3.19 against white and 1.82, 2.76,
3.72 and 5.10 against the brand's own black, so on a dark ground three of the
four cannot carry text at all. This bundle does not invert that ground, and it
does not bring back the bioluminescent theme 0018 removed: there is no radial
backdrop, no coloured glow, and no tinted elevation anywhere. It DERIVES a
second ground and measures every pairing on it.

- **The dark page is FIRST black (#231F20)**, and the two surfaces above it are
  that black mixed toward the brand gray in linear light (#353233, #413F40) --
  the mirror of the white ground's own construction, so no new hue enters the
  system on either side. The ink is white mixed toward the same gray
  (#F3F3F3 / #CDCCCD / #B0AEB0), and `--text-3` clears 4.5 on all three dark
  surfaces exactly as it does on all three light ones.
- **Purple and blue stay official and become FILLS.** A purple fill with white
  ink measures 8.94 whatever is behind it, so the primary action does not move.
  What moved is purple and blue AS TEXT, which on this ground measure 1.82 and
  2.76.
- **Five new declared FUNCTIONAL colours**, in the category 0018 opened for
  `--success-text`, `--danger-text` and `--warning`: `--accent-text` #CC95FE,
  `--link` / `--focus-ring` #65B1FE, `--success-text` #03C662, `--danger-text`
  #FF8B7F, `--warning` #E59E2D, each 7.2 / 5.6 / 4.6 on the three dark
  surfaces. None is a tint, a screen or a lightened brand colour presented as
  the brand colour, which is the thing the guidelines forbid outright; each is
  a separate value that is never used as brand expression and never appears on
  or near a mark. The nearest any of them comes to the official colour it
  replaces is dE 13.9.
- **`scripts/derive-dark-palette.ts` is where every number comes from.** It
  reproduces 0018's own recorded figures (8.94 / 5.91 / 4.38 / 3.19 on white,
  1.82 / 2.76 / 3.72 / 5.10 on FIRST black) from the official hex values, which
  is the control on its own arithmetic, and `tests/theme-contrast.test.ts`
  re-measures the SHIPPED stylesheets rather than trusting the comments.

### The eleven team accents: all eleven failed, all eleven were re-derived, none was dropped

Measured against the dark page, the set 0018 shipped ran from **1.81 (olive) to
3.38 (orange, purple)**. Not one of them could carry text there, because every
one of them was built to be dark enough for white. Dropping the failures would
have meant dropping all eleven and orphaning whatever colour a team had already
chosen, so each got a dark-ground variant at the SAME HUE (each ground held
within 3 degrees of 0018's value, measured in sRGB, which is the space the
launch-area exclusions are written in), lifted until it clears 4.5 on all three
dark surfaces and on its own wash, taking the brand black as its ink.

**Red and blue stay excluded on both grounds**, for 0018's reason: the mat's
launch areas are red and blue. That exclusion is why the hue is held rather
than lifted freely -- an unconstrained lift walked magenta from hue 326 to 336,
straight into the red band, and it walked violet onto the edge of the blue one.

The variant is the CLOSEST valid colour to the light one, not the most
separated. Maximising separation instead produced a near-white "magenta" and a
beige "orange": a different palette wearing the same names.

Separation, CIE76 dE over the eleven: light closest pair green/sage at 21.87,
dark closest pair violet/orchid at 21.87. 0018 measured its closest pair at
21.4 and rejected a twelfth colour for dropping that to 17.3, so both grounds
are at or above the bar it set.

### The light ground moved too, because measuring it properly showed it had to

0018 measured the eleven against the PAGE only. Measured against the two raised
surfaces and against their own washes -- which is where the app actually sets
accent-coloured text, on `.chip--on`, `.tk__tag--mine`, `.btn2--pick` and
`.bp--here` -- **five of them did not clear 4.5**: orange, lime, sage, purple
and magenta landed between 4.02 and 4.75 on `--surface-2`. They are nudged
darker, by at most dE 5. `green` moved further (8.37 to 10.88) because sage
moving darker squeezed the green/sage pair, which was already the closest in
the set.

### How the ground is chosen, and why the dark palette is written down once

Three states -- system, light, dark -- resolved to a concrete `light` or `dark`
before first paint by a blocking script at the top of `src/app.html`, and
stored per device in `localStorage` (with `system` stored as an ABSENCE, so a
device that was never told anything and a device told to follow its system are
the same device). CSS only ever sees `:root[data-theme='dark']`.

- **The dark palette is ONE block.** A `prefers-color-scheme` copy of it would
  be a second statement of the same rule, and two copies drift within a season.
  The cost is that a browser with JavaScript disabled gets the light ground
  whatever its system says; this app does not run without JavaScript anyway
  (IndexedDB write queue, realtime board, two browser clocks).
- **`@media screen` around the dark block is what makes print always light**,
  with not one token restated. Every `@media print` rule in the repo now only
  defeats the browser's "do not print backgrounds" default; the literal
  palettes those blocks used to carry (`#ffffff`, `#000000`, `#333333`,
  `#999999`, and NotebookPrint's private `#1a2330` / `#4a5768` / `#c6cdd6`) are
  gone.
- **`[data-ground='light']` forces a ground on a SUBTREE.** The notebook's
  paper preview and the route planner's mat use it.

### The three surfaces with their own problem

- **PRINT.** Verified in print media on both system schemes: `--surface-0`
  resolves to white, `color-scheme` to light, and the marks show their
  full-colour files, with `data-theme='dark'` still on `<html>`.
- **THE ROUTE PLANNER'S MAT IS A LIGHT PLATE ON BOTH GROUNDS.** The decision
  and its cost are argued at length in `MatCanvas.svelte`. The short version:
  the scrim is `--surface-0`, a real field layout is a LIGHT drawing, so on the
  white ground "dim" means "fade the picture toward white until the plan reads"
  and it works because the plan is dark ink. Let the scrim follow a dark ground
  and the same slider fades a light drawing toward black -- glare at 0%, a
  black rectangle at 90%, and somewhere in the middle the picture passes
  through the lightness of the ink on top of it and the labels vanish into it.
  A control that makes its subject less readable in the middle of its own range
  is worse than no control. The cost, stated: on the dark ground the planner is
  a light rectangle in dark chrome.
- **THE TEAM BOARD KIOSK WAS MEASURED, NOT ASSUMED.** At the iPad's real
  viewports, both orientations: 41 text runs, headings at 52 and 32.4px
  landscape, 40.5 and 24.3px portrait. Worst contrast **5.00 on the light
  ground and 5.76 on the dark one** -- so dark is not worse, and neither is
  merely adequate. The limiting factor is the same on both grounds and is not a
  colour: supporting labels ("nobody in this seat", "All done") render at 15 to
  17px, which is small at a metre. Unchanged by this bundle, and written down
  rather than fixed.

### The FIRST marks: the ground swaps the ASSET

Nothing is recoloured, filtered, inverted or blended. `BrandLogo` renders BOTH
supplied files and the ground's own tokens display exactly one, which is what
makes the right mark correct in the first painted frame instead of one
hydration later. The `variant` prop is GONE: once the page has two grounds a
caller cannot know which one its mark will land on.

- The official downloads supply a reverse file for the FIRST horizontal logo,
  the FIRST vertical logo and the FLL Challenge horizontal stacked lockup.
  Those three swap file. **The other three FLL lockups are supplied in full
  colour only, so they get a WHITE PLATE**: square, no border, no radius, no
  shadow, extending past the mark's full clear space, which is the background
  that artwork is specified for rather than the artwork altered to suit a
  ground. Said out loud here because it is a judgement call.
- The cost, stated: both files are fetched, about 225 KB more across the
  footer's two marks, once, then cached.
- The accessible name moved from the image to the wrapper (`role="img"`), because
  a `display:none` image's alt text is announced by nothing and the mark would
  have had no name on one of the two grounds.
- `ancestorHazard` still walks, and still catches the brand harness's
  deliberate `hue-rotate` on both grounds.

### Broken things found while sweeping, and fixed

Every one of these was a defect on the SHIPPED light ground, found because the
sweep measured every text pairing on every surface instead of sampling.

- **`.error` set the words of an error in the official FIRST red**, 4.38 on
  white, at semibold, which is not "large" at any size this app uses. It was a
  failing pairing before a second ground existed.
- **`.btn2--done` on the student screen was white on FLL green at 3.19**, on
  both grounds. It used `--accent-ink` (white, the ink for the PURPLE fill) on
  a green fill; green's ink is the brand black, at 5.10.
- **`--team-accent-ink` used as TEXT, in four places** (`.nb__tab--on`,
  `.nb__h`, `.nb__statn`, `.nbp__name`, `.mnb__team--on`). The ink token is
  what sits ON a filled accent chip; these are accent-coloured labels on a card
  or on the accent WASH, so the token put **white text on a near-white
  surface** -- measured 1.09, 1.20. With a team accent set, a notebook heading
  was invisible on the shipped light ground.
- **`.rp__delete` set "Delete launch" in the official red**, 4.02 on
  `--surface-1`.
- **`.btn--danger`'s border was the official red**, which is 3.50 against
  `--surface-2` on the light ground and 2.39 on the dark one, under the 3:1
  floor `--boundary` is held to.
- **`BrandLogo`'s dev-only refusal note inherited its background**, so on the
  brand harness the explanation of a refusal measured 1.11. It carries its own
  ground now, because a refusal appears wherever a mark was going to.
- **`tcard-loud` pulsed a 1.5rem amber glow in a hard-coded rgba** -- the
  bioluminescent theme's last survivor on the console, and the one thing the
  guidelines are most explicit about not putting near a mark. The inset rule
  thickens instead.
- **`ds-breathe` in motion.css** pulsed a hard-coded mint halo and had no call
  site. Removed.
- **`NotebookPrint` still carried `var(--surface-0, #0b1016)` fallbacks** to the
  pre-0018 dark theme, plus a private print palette of six literals.
- **The dev route-planner fixture picture was DARK**, so the harness tested the
  easy case: a real field layout is printed line art on a light ground, and a
  dark fixture let every overlay sit on it comfortably. It is a light drawing
  now, still drawn by this repo and still not a crop of anyone's artwork.
- **A comment in `src/app.html` named `%sveltekit.head%`.** The placeholders are
  substituted by a plain string replace, comments included, and the markup
  SvelteKit injects for the head carries comments of its own whose closing
  delimiter ended the outer comment early -- putting a paragraph of build notes
  at the top of every screen. Caught by the sweep, which reported the same
  stray text as a text run on all 27 routes. A test now asserts each
  placeholder appears exactly once.

### The one bug this bundle created and then caught

**A forced-light subtree kept the outer ground's team accent.** The first
version of the dark accents was a second table keyed on
`:root[data-theme='dark'] [data-accent]`. The `data-accent` attribute sits on an
ANCESTOR of the mat plate, so the dark value was selected outside the plate and
inherited straight in: a teal team's mat drawn in the dark ground's pale teal,
on white, with mission labels at 1.37. Two lessons, both now written into
`team-accents.css`:

- A `var()` resolves on the element that DECLARES it, so a ground that can be
  forced on a subtree has to re-declare the selection on the ground element
  itself. Each accent therefore states BOTH of its triples and the ground picks
  one; a plate cannot know which accent it is inside, but it can always ask for
  "the light one of whatever pair this is".
- `color` is an inherited VALUE, already resolved on `<body>`. A subtree that
  redefines only custom properties keeps the outer ground's ink for anything
  relying on inheritance -- which is why `[data-ground]` now also sets `color`.

### Measured

- **`tests/theme-contrast.test.ts`, 76 assertions**, parsing the shipped
  `colors.css` and `team-accents.css` and measuring every foreground against
  all three surfaces of its own ground, every fill against its ink, every
  accent against its wash, plus the launch-area hue exclusions, the separation
  floors, and that the six official values are byte-identical on both grounds.
  Its negative control asserts FIRST blue on the dark page is BELOW 4.5, which
  is the case the ground had to solve.
- **`tests/theme-toggle.test.ts`, 16 assertions**, which pull the boot script
  out of `src/app.html`, run it in a VM against a stubbed document,
  localStorage and matchMedia for all six combinations of the three preferences
  and the two system settings, and assert it is a bare `<script>` in `<head>`
  ahead of the head placeholder. Controls: a manual override must actually
  override the system, an unknown stored value must be ignored, and storage
  that THROWS (Safari private window, "block all cookies") must still leave a
  ground on the page.
- **A browser sweep of 27 routes x 2 grounds x 2 widths (375 and 1440) = 108
  page loads**, walking every rendered text node, resolving its effective
  foreground and background through the ancestor stack (and, in SVG, through
  the sibling shape a label is drawn on), and reporting every pairing under
  4.5, or 3 at large-bold sizes. **0 failing pairings, 0px horizontal overflow
  on every page at both widths, 0 ground mismatches.** Repeated as a STUDENT
  principal (8 routes, 32 loads) and as a BOARD DEVICE (2 routes, 8 loads), and
  under print media (5 routes, 20 loads, both system schemes).
- **Negative control on the contrast measurement.** `body`'s ink was set to
  `--surface-1` on both grounds; the sweep reported 20 failing pairings across
  6 distinct pairs, at 1.09 and 1.00 on light and 1.28 and 1.00 on dark.
  Restored, md5 `802dea3caf2cf0748cddfffb57424cde` before and after.
- **Negative control on the overflow measurement.** `min-width: 1800px` on
  `.board__legend`; the sweep reported 1441px of overflow at 375 and 376px at
  1440, on both grounds. Restored, md5 `2e2d0526e79b6ef308a604f845b7ece4`
  before and after.
- **No flash of the wrong ground, proved by looking at the frames the browser
  painted.** An ordering measurement against first-contentful-paint is too
  loose in dev mode: the app is module-driven, FCP lands long after anything in
  the document, and moving the boot script to the end of `<body>` still
  "passed" it. So a CDP screencast captures every painted frame and classifies
  it. With the script in `<head>`: no frame of the wrong ground on any
  route/scheme combination. **Negative control:** with the script moved to the
  end of `<body>` (`src/app.html` restored to md5
  `e13dd1dd30d69a4371000a92cddda24e`), a white frame is painted before the dark
  ground on every dark-scheme route.
- **A cold tab shows one white frame before the navigation commits**, on either
  ground. It is Chromium compositing the outgoing blank document, not this app:
  a warmed-up navigation between two app pages shows no such frame. Page code
  cannot influence it.
- **The toggle exercised in a browser**: all three states, both system schemes,
  `aria-checked` and the stored value after each click, and the ground after a
  full reload with `dark` stored.
- **The mark swap confirmed per ground and per medium**: reverse files shown and
  full-colour files hidden on the dark ground, the reverse on light and in
  print, `filter: none` on every mark in all six combinations.
- `npx svelte-check`: **0 errors, 0 warnings, 666 files.**

### Not verified

- **The DB-backed suite did not run, and neither did anything against a
  database.** This session's environment blocks Docker image layer downloads at
  the network policy (`production.cloudfront.docker.com` and the public-ECR
  CDN both answer 403 to CONNECT), so `supabase start` cannot pull an image and
  there is no local stack. **31 of the 40 test files need one.** The 9 that do
  not -- including both new files -- pass: 199 tests. Nothing in this bundle
  touches SQL, RLS, an RPC or a policy, so the risk is a regression this bundle
  could not have caused; run `npx vitest run` on a machine with Docker before
  trusting that.
- **Nothing was pushed to the linked Supabase project, because there is nothing
  to push.** No migration file was created; `supabase/` is byte-identical.
  Production remains at 0020, and this bundle does not change that.
- **The console, student and kiosk surfaces were reached through a stand-in
  PostgREST and GoTrue**, not the real stack: a small mock answers `auth_whoami`
  and `board_live_summary` with plausible shapes so the SCREENS render. That is
  sound for a contrast and overflow sweep, which measures CSS, and it is NOT
  evidence about any query, policy or RPC.
- **Print was checked in print media in a headless browser**, not on paper.
- **`npm run build`** was not run.
- **The guideline PDFs are not in this checkout.** `local-assets/` is gitignored
  and absent, so the reasoning about tints and screens of brand colours rests on
  the clauses quoted verbatim in `src/lib/brand/rules.ts` and `colors.css`, and
  on the strictest reading of them: no tint, no screen, no lightened brand
  colour presented as the brand colour. Nothing beyond those clauses was
  assumed.
- **No real iPad, and no dim room.** The kiosk figures are a headless Chromium
  at the iPad's CSS viewport. The "readable at a metre" judgement is arithmetic
  about type size, not an observation.

### Deferred

- **The kiosk's 15 to 17px supporting labels.** Equally small on both grounds,
  and a layout change rather than a colour one.
- **A `prefers-contrast: more` ground.** Both palettes clear AA; neither is
  built for AAA, and a third ground is a third set of measurements.
- **The dark ground has no counterpart to the light one's `--boundary`
  headroom.** 3.22 against `--surface-2` versus 3.65 on light. Both clear 3:1;
  the dark one has less room if a future surface is added above `--surface-2`.

