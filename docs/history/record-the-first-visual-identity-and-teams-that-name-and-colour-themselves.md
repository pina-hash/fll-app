---
title: "2026-08-24 -- The FIRST visual identity, and teams that name and colour themselves"
date: 2026-08-24
branches: []
migrations: ["0018"]
subsystems: ["Visual theme, brand"]
record_order: 10
---

Two changes that landed together because the second depends on the first. The
app's look was invented: a bioluminescent dark theme with colours and a
typeface nobody had checked against a guideline. It now reads as a FIRST LEGO
League Challenge tool, built from the official palettes, the official face and
the supplied marks, with the logo rules enforced by a component rather than
written down. And the four teams stopped being Red/Blue/Green/Gold with
assigned colours: they are Team 1 through Team 4, they choose their own colour
from a palette of eleven, and a colour is taken once.

### What changed

**The sources were read, not remembered.** The FIRST Branding & Design
Guidelines, the FIRST LEGO League Branding & Lockup Guidelines and the Policy
on the Use of FIRST Trademarks and Copyrighted Materials were downloaded to
`local-assets/brand/` (gitignored: they are FIRST's documents) and extracted
to text. `src/lib/brand/rules.ts` quotes the clause behind every rule with its
page number, so the next session can check a rule without the PDF.

- **The palette is the official one.** FIRST black `#231F20`, blue `#0066B3`,
  red `#ED1C24`, gray `#9A989A` (BG p9); FIRST LEGO League purple `#662D91`,
  green `#00A651`, red, black (FLL p12). FLL purple is the primary action
  because this is a FIRST LEGO League tool; FIRST blue is links and focus; the
  brand gray is the thin rule the FLL guidelines prescribe between a paired
  FIRST logo and a division lockup.
- **The face is Roboto, self-hosted, and nothing was substituted for it.**
  See "the font question" below.
- **`static/brand/` holds nine supplied files, byte for byte** -- the FIRST
  horizontal and vertical logos (full colour and reverse) and four FIRST LEGO
  League Challenge Challenge lockups. Nothing was recoloured, cropped, traced
  or re-exported.
- **`src/lib/brand/`**: `rules.ts` (the rules and the mark table),
  `BrandLogo.svelte` (renders a mark, or refuses), `FirstName.svelte` (the
  only thing that prints the names), `BrandSurface.svelte` and
  `BrandFooter.svelte` (mounted at the ROOT layout, so every surface carries
  the attribution and two full official logos), `context.ts` (the per-surface
  registers).
- **`supabase/migrations/0018_team_identity_and_accent_claim.sql`**: the four
  teams renamed to Team 1 to Team 4 (ids and join codes untouched); the accent
  enum rebuilt from four assigned colours to eleven chooseable ones; a partial
  unique index making a colour taken once across live teams; nullable accent,
  because a team that has not chosen has no colour; a proposal column trio; a
  `short_name` with a shape CHECK and a wordlist trigger; and five RPCs
  (`team_accent_options`, `team_propose_accent`, `team_confirm_accent`,
  `team_set_accent`, `team_set_short_name`).
- **`AccentPicker.svelte` and `TeamName.svelte`**, on the mentor team page and
  the student Team tab. Every swatch says free, ours, or which team holds it.

### Load-bearing decisions

- **THE GROUND IS WHITE, AND THAT IS THE BRAND-ACCURATE CHOICE AS WELL AS THE
  ACCESSIBLE ONE.** "Mainly black" in both palettes describes the INK, and the
  guidelines' preferred marks are the full-colour versions with the reverse
  versions reserved for dark grounds. Measured: the four brand accents are
  8.94 / 5.91 / 4.38 / 3.19 against white and 1.82 / 2.76 / 3.72 / 5.10
  against `#231F20`. On a black ground the brand's own accents cannot carry
  text at all. Every glow and the radial backdrop went with the dark theme: a
  mark may not sit on a busy background, and a halo in a brand accent is the
  nearest thing to recolouring one.
- **THE LOGO RULES ARE ENFORCED BY THE COMPONENT, NOT DOCUMENTED FOR IT.**
  `BrandLogo`'s only geometry prop is `height`; there is no width, rotation,
  crop, colour, radius, filter or background prop and no class/style
  passthrough, so a caller has no way to alter a mark. It refuses below the
  documented minimum, refuses a supporting mark with no full logo on the
  surface, and refuses the icon alone and the wordmark alone ALWAYS -- FIRST
  supplies no such file, and making one means cropping, which is forbidden
  outright. That last one is stricter than the guideline on purpose.
- **REFUSAL DOES NOT THROW.** A violating usage renders nothing, logs the rule
  and leaves `[data-brand-refused]` in the DOM, with the reason visible under
  `vite dev`. A brand mistake in a footer must not blank a mentor's console
  mid-meeting, and a rule enforced by taking the screen down is a rule someone
  will route around.
- **AN ANCESTOR FILTER IS THE HALF CSS CANNOT DEFEND, SO IT IS DETECTED.**
  The hostile-wrapper check in the harness found this: `all: initial` on the
  image stops inherited colour and page-level `img` rules, but an ancestor's
  `filter`, `opacity`, `mix-blend-mode` or rotation rasterises the whole
  subtree and no descendant declaration escapes it. The first draft of this
  component claimed protection it did not have. `ancestorHazard()` now walks
  the ancestors after mount and withdraws the mark, naming the element and
  the rule.
- **EVERY SURFACE IS A `BrandSurface`, KEYED ON THE PATH.** Both registers are
  per surface and are populated during component init. Carrying them across a
  client-side navigation would put the ® on the wrong page and let a mark be
  vouched for by a logo the reader can no longer see, so the root layout
  remounts on path change. The surfaces that own state are page components and
  already remount.
- **THE ATTRIBUTION IS QUOTED AND THE QUOTE WAS CHOSEN.** IP section IV.A's
  joint FIRST/LEGO trademark disclaimer, word for word. Under IP II.1 a
  registered team using its own marks is not required to post one at all; the
  other candidates in that section say the marks are "used by special
  permission", which this club has not been granted. The one used is true as
  written and names both owners.
- **THE MARKS ARE TRACKED IN A PUBLIC REPO, DELIBERATELY.** IP II.1 lets a
  currently registered team use the logos for its own team activities without
  permission or disclaimer, and BG p32 names websites explicitly, "as long as
  team identification (team name/number) appears in conjunction with the
  logo(s)" -- which is why the footer names the club and its teams and is not
  optional. This amends the previous bundle's blanket "no FIRST or LEGO
  artwork is ever tracked": that rule now says no SEASON OR GAME artwork, and
  the logos are the stated exception.
- **RED AND BLUE ARE EXCLUDED FROM THE TEAM PALETTE BECAUSE OF THE MAT.** The
  two launch areas are red and blue, and the route planner draws a team's
  route, waypoints and robot footprint in that team's accent on top of the
  mat. A team accent in either hue would have its own route read as a launch
  area, and it would look perfectly reasonable in code review. Every value
  sits outside hue [335, 25] and [200, 258]; 0018's header says so at length
  so nobody widens it back.
- **THE ENUM WAS REPLACED, NOT EXTENDED.** Postgres can add an enum value but
  never remove one, and `cyan` is squarely in the excluded blue band. Leaving
  it reachable would leave the collision one dropdown away. Existing rows were
  mapped (cyan to teal, chartreuse to lime, amber to orange, magenta stays)
  and then cleared: an assigned colour is not a chosen one.
- **THE RACE IS DECIDED BY A PARTIAL UNIQUE INDEX, NOT BY A SCREEN.** Twenty
  children on twenty phones can tap the same swatch in the same second. The
  loser gets a 23505 from Postgres, which `team_confirm_accent` catches and
  turns into a sentence naming the winner. Nothing depends on a refetch
  arriving in time. NOBODY holds an update grant on `teams.accent` any more,
  not even a mentor: the RPCs are the only door and each re-checks its caller.
- **WHO CONFIRMS IS `strategy_can_edit()`, NOT A SECOND VERSION OF IT.** The
  active Run Captain while a meeting has one, otherwise the assignment
  holders, plus any mentor. That rule already existed exactly, from 0012.
- **THE NAME FILTER NEEDED TWO LISTS.** One substring list refused
  "Passenger", "Class Act" and "Assemble" over "ass"; one whole-word list let
  "s h i t" and "fuuuck" through. So long unambiguous words match as
  substrings of the squashed text and short ambiguous ones only as whole
  tokens, over four normalisations (two leet foldings, each with repeated
  letters collapsed). It is in the DATABASE because the student runtime
  replays queued writes and a board device posts directly.
- **THREE FUNCTIONAL COLOURS ARE DECLARED NON-BRAND.** Green is 3.19 on white
  and red is 4.38; neither clears 4.5:1 as small text, and "blocked" has no
  brand equivalent at all. Darkening a brand colour and still calling it the
  brand colour is the thing the guidelines forbid, so `--success-text`,
  `--danger-text` and `--warning` are separate declared values, never brand
  expression and never near a mark -- the same category as a team accent.

### The font question

**Roboto, and nothing was substituted, because Roboto is freely licensed.**
The FIRST Branding & Design Guidelines name the Roboto family as the primary
font of the branding system (p29) and say in the same paragraph that the
weights "can be accessed free of charge along with additional font weights at
fonts.google.com/specimen/Roboto". It ships under the SIL Open Font License
1.1, which permits web use and self-hosting. Arial is the guide's own named
substitute (p30) and is the fallback in the stack. Roboto Condensed 700 is the
display face, which is the weight the brand system uses it for.

It is SELF-HOSTED via `@fontsource`, not hotlinked. The previous stylesheet
pulled Nunito and JetBrains Mono from `fonts.googleapis.com` at runtime; this
app is local-first by design, and a webfont request that never returns is a
screen of fallback metrics mid-meeting on a tablet in a gym. The mono face
(join codes, PINs, clocks) is not a brand concern and stays JetBrains Mono,
now self-hosted for the same reason.

### What was measured

- **The colour decision, not asserted**: brand accents against white are
  purple 8.94, blue 5.91, red 4.38, green 3.19; against `#231F20` they are
  1.82, 2.76, 3.72, 5.10. Every token in `colors.css` carries its measured
  ratio against all three grounds, and the ones that failed were moved:
  `--text-3` from the brand gray (2.86) to `#6B696A` (5.45 / 5.00 / 4.54, so
  it clears 4.5 even on a raised control), `--boundary` to `#7A787A`
  (4.38 / 4.02 / 3.65).
- **The team palette was derived, not picked.** Eleven colours, each binary
  searched to a target contrast, all clearing 4.5:1 on white in BOTH
  directions so one ink rule covers every swatch; every wash carries the ink
  at 13.6 or better. Closest pair, CIE76: green/sage at **21.4**. Closest any
  accent comes to an official brand colour: orchid to FLL purple at **27.9**.
  A twelfth in this gamut dropped the closest pair to 17.3, which is why there
  are eleven. The derivation script is in `local-assets/brand/`.
- **`tests/brand-rules.test.ts`, 29 tests**: every mark's minimum refused one
  pixel under and accepted at it; the icon alone and wordmark alone refused
  even on a surface holding a full logo; the vertical lockup refused alone and
  allowed beside a full logo; a supporting mark proved not to vouch for
  another; the attribution compared against the policy words character for
  character, including that it does NOT say "special permission"; the ancestor
  walk catching filter, blend, opacity and rotation, with a translate-only
  ancestor as the positive control.
- **`tests/team-identity-accent.test.ts`, 22 tests**: the seeded four are
  numbered and colourless with their join codes intact; the enum holds no red
  or blue name and refuses one (22P02); propose holds no seat so two teams may
  propose the same colour; a student cannot confirm and a mentor can; a taken
  colour is refused naming the holder; an archived team releases its colour;
  the name filter refuses seven evasions and accepts six Scunthorpe-problem
  names; the trigger bites on a RAW update with no RPC in the way; and no
  client holds an update grant on the column.
- **THE RACE, PROVED WITH TWO REAL TRANSACTIONS.** Two connections open,
  both read that the colour is free, and only then do both write. Exactly one
  commits; the loser gets `23505` on `teams_accent_unique_live`. The POSITIVE
  CONTROL is the same two transactions on different colours, where both
  commit. Sequential RPC calls would only have proved the second read the
  first.
- **The logo rules proved in the REAL component, in the browser** against
  `/dev/brand`: five full logos render at their minimums; `first-icon` and
  `first-wordmark` render nothing and leave a refusal naming the crop rule,
  on a surface that has two full logos in its footer; the FLL vertical lockup
  is refused alone and renders beside a FIRST logo, same component and same
  props, only the surface differing; 29px refused and 30px rendered. A wrapper
  applying a team accent, a `hue-rotate` filter and a border radius withdrew
  the mark with "an ancestor (div.h__hostile) applies filter: hue-rotate(90deg)",
  while the same mark in the footer rendered with zero refusals.
- **The mark is used as supplied**: computed styles on a rendered mark are
  `filter: none`, `border-radius: 0px`, transparent background, `--team-accent`
  reset to empty, aspect ratio matching the file's 1692:442 exactly, and clear
  space of 10px at a 40px render (a quarter, rounded up).
- **Name usage, off the rendered DOM**: four FIRST spans all `font-style:
  italic` and `text-transform: uppercase`; two LEGO spans both
  `font-style: normal`; and exactly `®, ®, ™` of superscripts in a paragraph
  using the name four times -- first FIRST, first LEGO, then the season's
  trademark symbol.
- **Every surface carries the footer, in the SERVER HTML**: nine routes
  checked, all with both full logo files, the verbatim attribution and the
  team identification, and zero refusals.
- **375px and 1440px: 0px horizontal overflow** on 18 surface-width
  combinations. One real failure was found and fixed: the student-screen
  harness overflowed 16px at 375px because its grid track sized to a
  fixed-width phone frame. The NEGATIVE CONTROL for the measurement itself:
  the same page in a 150px frame reports 176px of overflow, so the check can
  fail.
- `npx svelte-check`: **0 errors, 0 warnings** (655 files). Full suite: **37
  files, 436 tests**, green.
- **The catalog test earned its keep twice**: it caught
  `_teams_short_name_clean` shipping without its `revoke all from public`, and
  it caught four seed and console assertions still written against the old
  four-colour world.
- **The linked project is at 0018.** `supabase db push` applied it and
  `migration list` shows local and remote level for every file in the chain.

### What is explicitly NOT verified

- **The mentor console and student runtime through a real sign-in.** Mentor
  auth is Google OAuth and needs a human; a student PIN login needs a seeded
  session. The brand footer, the marks and the overflow were verified on every
  route reachable without a session and in the dev harnesses, which mount the
  REAL components; the accent picker's SQL side is proved end to end with real
  GoTrue sessions in the test suite. What is unproved is the two joined in one
  browser tab.
- **Screenshots.** The Browser pane was not displayed in this session, so
  every visual claim above is a measurement read out of the live DOM
  (computed styles, bounding rectangles, server HTML) rather than a picture.
  Whether the result LOOKS right to a person who knows the brand is not
  something a contrast ratio can answer, and it is the one check still owed.
- **The print surfaces on paper.** The roster card, the parent card and the
  notebook print view were updated for the light ground and the correct name
  usage, and they type-check; nobody printed one.
- **"Scunthorpe" is refused by the name filter.** A real place name caught by
  the long-word list. Accepted rather than special-cased: a mentor can set any
  name the filter allows, and the alternative is a whitelist that grows
  forever.
- **The team board kiosk at a metre.** The footer has a kiosk variant with
  larger marks; nobody stood a metre from an iPad.

### Deferred

- **A reverse-variant surface.** The reverse (dark-background) marks are
  installed and `BrandLogo` takes `variant="reverse"`, but no surface uses
  one, because every surface is now light. The prop exists so a future dark
  panel is a placement decision and not a re-download.
- **The FIRST vertical logo and the FLL vertical lockups in the app.** Both
  are installed and both render in the harness; no app surface has a shape
  that wants them yet.
- **A season lockup for CANOPY or BIOGLOW.** Season artwork is not fetched,
  committed or reproduced; the season names are text in the surrounding face,
  which is also what the IP policy asks for.
- **Per-team colour on the parent view and the board device.** Both read the
  accent already and both handle null; neither offers a way to change it, and
  neither should.
- **Realtime on the accent.** A team picking a colour is a once-a-season
  event; the picker refetches after its own write and the next page load
  shows everyone else's.

---

