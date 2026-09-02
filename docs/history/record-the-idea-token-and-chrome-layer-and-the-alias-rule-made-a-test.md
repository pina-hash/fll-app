---
title: "2026-08-27 -- The IDEA token and chrome layer, and the alias rule made a test"
date: 2026-08-27
branches: []
migrations: []
subsystems: ["Visual theme, brand"]
record_order: 24
---

Students said the app looked archaic. It had no design system: every surface was
whatever the last session matched. This bundle installs a token and chrome layer
app-wide. It redesigns no page's structure.

### What was inherited, and what was not

Architecture came from `FRC_Design_System.md` v1.7 in the sibling `frc-app`
(`src/lib/design-system/docs/`), read at 644b809 rather than remembered. Ported:
a token layer as the single source of colour, ground scopes set by an attribute
on a root, and a four-transition motion library. NOT ported: any of Team 5669's
appearance. No Techmen gold, no 5669 seal, no Space Grotesk. The identity here
is the IDEA pathway.

### What landed

- **`colors.css` rewritten as a palette plus TWO GROUND SCOPES**, each declaring
  the complete semantic alias set (63 names) as LITERAL values. `:root` shares
  the dark block so a document with no ground attribute resolves the whole set
  rather than resolving partially, which is the dangerous state: the palette
  alone still paints green and looks almost right.
- **IDEA green is scarce on purpose.** In the whole console chrome it marks the
  season wordmark and the tab you are on. Content accents are brass, patina and
  copper; crimson is LIVE, REC and error only and never identity; the FIRST
  LEGO League values are the PROGRAM LAYER and colour program chrome only.
- **Chakra Petch (`--font-hero`, display only) and Rajdhani (`--font-body`,
  headings included)**, self-hosted via @fontsource rather than preconnected,
  for the same offline reason the rest of the app is local-first. There is
  deliberately no `--font-display` that reaches the hero face.
- **The four transitions** (`.ds-shutter`, `.ds-boot`, `.ds-banner`, `.ds-cut`)
  plus three entrances, every one gated behind `prefers-reduced-motion:
  no-preference` inside the library and inert outside a `.ds-run` container, so
  base styles remain the visible end state.
- **Chrome adopts the identity:** the header bar and nav sit on `--chrome-bg`,
  the active tab is the pathway green, the footer bookends it, and the sign-in
  screen leads with the BIOGLOW wordmark in the hero face, in `--season`, with
  the one rationed glow in the app.
- **The paper ground is ready and already earning its keep.** Printing a run
  sheet is coming; meanwhile the route planner's mat and its calibrator carry
  `[data-ground='light']`, and that is now the paper scope.

### The alias rule, and the bug that had already shipped here

Custom-property substitution resolves where a property is DECLARED. An alias
written once on `:root` computes there and inherits the already-resolved string
into every other scope, so a ground that forgets one keeps the dark value while
looking correctly themed. No error, no warning, no visual clue.

**FOUR INSTANCES WERE ALREADY IN THIS REPO.** `effects.css` declared
`--shadow-card`, `--shadow-raised`, `--backdrop-deep` and `--focus-outline` on
`:root`, each composed out of a ground-dependent `var()`. All four froze the
light ground's values into the dark one, and the planner's forced-light mat
plate was drawing a black shadow on a white sheet as a result. They are ground
aliases now, and they are literals. `effects.css` declares no colour at all.

`tests/design-tokens.test.ts` is the guard, and it reads the SHIPPED stylesheet
rather than a copy of it: the scopes must name the same aliases, no value may
contain `var(`, the paper scope must flatten every glow and may not carry mint,
and NOTHING outside the token folder may name a colour or a font family.

### Measured

- **`tests/design-tokens.test.ts`: 13 passed, including two controls.** Deleting
  one alias from the paper scope makes the comparison report exactly that alias;
  turning one literal into a `var()` makes the literals check see it. Without
  those, "every scope declares every alias" is a sentence that passes whether or
  not the check works.
- **The alias check found its first real bug immediately, in the test itself.**
  The paper scope was anchored on a PREFIX of its selector list, which also
  matches the palette block at the top of the file: it compared that block
  against itself and passed while 63 aliases were missing. Anchored on the full
  selector list, it went red, which is what a check that cannot fail looks like
  when you fix it.
- **32 screens walked, every rendered text node, ZERO pairings under the floor.**
  Every top-level route, both roles, at 375 and 1440: the effective foreground
  and background were resolved through the ancestor stack and compared at 4.5,
  or 3 at large-bold sizes.
- **32 route/width combinations rendered 200**, `--ground: dark`, page
  `rgb(19, 26, 19)`, body face Rajdhani, **0px horizontal overflow on every
  one**. The only console error anywhere was a `/favicon.ico` 404, pre-existing.
- **The forced-light plate resolves correctly inside a dark root**, checked in a
  live browser: `[data-ground='light']` computes `--ground: paper`, background
  `rgb(234, 230, 216)`, ink `rgb(19, 26, 19)`. That is the alias bug's original
  shape, proven fixed rather than argued fixed.
- **The eleven team accents re-measured on both new grounds.** All eleven dark
  variants clear 4.5 on the new ramp and improve (7.80 to 7.97 on the page,
  where the old ramp gave 7.18 to 7.33). Five light variants failed on the bone
  sheet (orange 4.45, lime 4.51, sage 4.42, purple 4.47, magenta 4.57) and were
  darkened with their hue held to within 0.3 degrees. The paper washes were
  re-tinted from the sheet at 5 percent so a label on its own wash still clears
  4.5.
- **Colour literals outside the token layer: 15, in 4 files, all four on the
  allowed list with a reason.** `qr.ts` (2: a themed QR code is an unscannable
  QR code), `brand/rules.ts` (1: the white plate FIRST full-colour artwork is
  specified for, which a ground must NOT be able to retint), and two dev
  fixtures drawn by this repo (`route-planner` 11, `notebook` 1) that stand in
  for copyrighted artwork and have to stay light drawings. Inside the token
  layer: 183 in `colors.css`, 66 in `team-accents.css`, zero in the other five.
- **One font literal was found and removed.** `NotebookPrint.svelte` named
  `Georgia, 'Times New Roman', serif` directly; it is `--font-paper` now.
- `npx svelte-check`: **0 errors, 0 warnings, 718 files.**
- **Full suite: 30 files failed, 16 passed, 323 tests passed, 0 test failures.**
  Every failing file fails at setup on GoTrue or PostgREST being absent. Last
  bundle was 30 and 15 with 293 passing; the extra passing file is the new
  token test and the extra 30 passes are its cases plus the retuned ones.

### Two judgements, stated rather than buried

- **`--dim #87947C` ships exactly as specified, and it does not clear 4.5
  everywhere.** It measures 5.53 / 4.99 / 4.35 / 3.60 against the four ramp
  steps. It is the metadata token for the page and a card; a raised `--plate`
  takes `--fg`. The app's running labels take `--text-3`, which is the same hue
  lifted to 5.75 / 5.18 / 4.52 so the three-step ink ladder keeps this repo's
  standing rule that every step clears 4.5 on all three surfaces.
- **The paper ground's accent separability floor is 18.8, not 0018's 21.3.** The
  bone sheet carries about four fifths of white's luminance, so five accents had
  to darken to clear 4.5, and darkening a set compresses it in Lab: olive/lime
  went from 22.80 to 18.88. A search over hue-holding candidates found NO lime
  that clears the sheet and stays 21.3 from the other ten. Moving olive or lime
  apart would change a colour a team chose by name, on a ground they will rarely
  see, to protect a floor derived on a third ground. The number is recorded and
  asserted instead. The dark ground, which is the one the app runs on, keeps
  21.3 and measures 21.87.

### Changed outside the token layer, and why

- **`resolveGround('system')` now answers `dark`.** The identity IS the dark
  ground, and a light-mode device following its own setting would open the app
  on the print sheet. `light` remains an explicit choice, resolves to paper, and
  is therefore a preview of the printout. The toggle's labels changed with it:
  "Match my device" was a sentence a nine-year-old could test and find untrue.
- **`CLAUDE.md`'s "Visual theme" and "FIRST branding" sections** were rewritten
  in place. They said the palette and the face were the official FIRST ones and
  the ground was white; both are now false. The FIRST rules that still govern
  (the marks, the name in text, team identification, no busy backgrounds) are
  untouched, and the FIRST palette survives as the program layer.

### Found, reported, NOT fixed

- **`FirstName.svelte` renders "LeagueChallenge" with no space**, and
  "FIRSTLEGO" in `textContent`. Confirmed PRE-EXISTING: that file has no diff in
  this bundle, and the defect is in Svelte's whitespace handling at the `{#if}`
  boundaries, not in any colour or face. It is visible in the console header on
  every mentor screen. It is a FIRST naming-rule violation and it is copy, which
  this bundle was told not to change, so it is written down here for the pass
  that owns it.
- **Nothing looked wrong purely from retinting.** No page needed a layout change
  and none was made.

### Not verified

- **GoTrue and PostgREST were not in the loop.** No container registry is
  reachable from this session. The browser sweep ran against the same local
  stand-in the previous bundle used and disclosed. What it establishes is a
  RENDERING claim: computed styles, resolved grounds, measured contrast and
  overflow, which do not depend on which server answered the data call.
- **No printed sheet was produced.** The `@media print` scope is asserted for
  alias completeness and read in the stylesheet; it has not been through a
  print dialog.
- **The four transitions have no call site yet.** They are the library, gated
  and inert; nothing in this bundle applies one, because applying one would be
  a structural change to a page.

