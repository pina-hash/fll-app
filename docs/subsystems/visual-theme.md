# Visual theme

Moved verbatim from `CLAUDE.md` (Conventions) on 2026-10-19, so `CLAUDE.md` stays under 3,000 words. `CLAUDE.md` links here; keep this file current in the same change as anything it describes.

### Visual theme

The token layer is `src/lib/design-system/` (pure CSS custom properties:
`fonts`, `colors`, `typography`, `effects`, `motion`, `team-accents`, entered
through `index.css`), imported once by `src/app.css`, which holds the shared
classes (`.card`, `.btn`, `.field`, `.input`, `.tile`, `.hero`, `.live-dot`,
text roles). **Do not invent colours or name a font face as a literal**;
design against the tokens. `tests/design-tokens.test.ts` fails the suite if a
colour literal appears anywhere outside that folder, and its allowed list has
four entries, each carrying the reason that colour cannot be a token. It also
enumerates every colour INSIDE the folder and requires each one per ground; see
the two bullets on the alias rule below.

- **THE IDENTITY IS THE IDEA PATHWAY, NOT TEAM 5669 AND NOT FIRST.** IDEA
  green is the pathway colour and is SCARCE ON PURPOSE. Content accents are
  brass, patina and copper, and they live in the content layer. Crimson is
  LIVE, REC and error ONLY and is never identity. The FIRST and FIRST LEGO
  League palettes survive as the PROGRAM LAYER (`--program-fll*`), which
  colours program chrome and never content, never identity.
- **GREEN HAS FOUR JOBS AND EACH ONE HAS EXACTLY ONE OWNER. THIS IS A LIST,
  NOT A GUIDELINE.** "Scarce on purpose" was written down for four bundles and
  ignored for four bundles: at its peak mint answered to eleven token names
  (`--accent`, `--accent-text`, `--fg-hero`, `--rim`, `--link`, `--focus-ring`,
  `--success`, `--success-text`, `--season`, `--selection-bg`, `--glow`) across
  147 references, and the app read as greenwashed because every one of those
  names was used CORRECTLY and they all resolved to `#8FE08A`. The vocabulary
  was semantic; the values were not. The four jobs:
  1. **Identity**: the season wordmark (`--season`) and hero type
     (`--fg-hero` + `--glow`). Nothing else.
  2. **ONE active state**: the console's nav pill, `.shell__tab--on`. It is
     the only "you are here" in the app that is always on screen, so it is the
     one that earns the colour. Every other selected/current/chosen/active
     state is `.btn--picked`'s treatment (a lighter fill, an ink ring, bold)
     or the TEAM's own accent. A second green active state is a defect.
  3. **The primary action**: `.btn--primary`, and its student and kiosk dress
     (`.slab--go`, `.open__btn`). One job, three sizes.
  4. **The focus ring**: `--focus-ring` / `--focus-outline`.
  `--success*` remains a STATUS token and is green, but only where the thing
  is genuinely done, live, connected or ok. A heading, a clock readout, a
  points number, a badge, a mat outline and a route line are none of those:
  they take the ink ladder, and they all did take the success colour once.
- **BEFORE REACHING FOR A COLOUR, ASK WHICH TOKEN ALREADY MEANS THIS.** The
  pattern behind almost every instance above was the same: a semantic token
  existed and the green got used because it was the green that was handy. A
  strategy prompt outlined in `--accent` while `--brass` (the callout accent)
  had zero references; a notebook entry whose outcome was "mixed" in the LINK
  colour while `--warning` means exactly that; a filter segment marked with
  `.btn--primary`, which is the ACTION colour doing a STATE job.
- **THE ARCHITECTURE CAME FROM `FRC_Design_System.md`** in the sibling
  `frc-app` (`src/lib/design-system/docs/`), ported as ARCHITECTURE and not as
  appearance: a token layer as the single source of colour, ground scopes set
  by an attribute on a root, and a four-transition motion library. No Techmen
  gold, no 5669 seal, no Space Grotesk.
- **THE FACES ARE Chakra Petch (`--font-hero`, DISPLAY ONLY) AND Rajdhani
  (`--font-body`, everything else, headings included).** Both self-hosted via
  @fontsource rather than preconnected, for the same offline reason the rest
  of the app is local-first. There is deliberately no `--font-display` that
  reaches the hero face: that name invites a heading to take it.

- **THE DEFAULT GROUND IS A NEUTRAL DARK RAMP, AND THE GREEN RAMP IS A DECK.**
  `:root` and `[data-ground='dark']` are `#181818 / #222222 / #2C2C2C` with
  `#393939` raised and `#111111` chrome; `--gear`, `--boundary` and
  `--fg-structure` are `#808080`, because linework is not identity, not an
  active state and not a status. The green ramp it replaced is
  `[data-ground='deck']`, complete and opt-in, and NOTHING SETS IT YET.
  **EVERY NEUTRAL STEP MATCHES THE GREEN STEP'S LUMINANCE**, which is why
  nothing in the palette had to be re-derived: contrast depends only on
  relative luminance, so every ratio survived to within the 0.05 the 8-bit grid
  costs, and no pairing crossed a floor. Re-measure rather than assume if you
  move one.
- **THREE GROUND SCOPES, AND EVERY COLOUR IN THE TOKEN LAYER IS DECLARED IN
  ALL OF THEM AS A LITERAL.** `:root` and `[data-ground='dark']` share the
  neutral ramp; `[data-ground='paper']`, `[data-ground='light']` and
  `:root[data-theme='light']` share the bone paper sheet; `[data-ground='deck']`
  is the green ramp; and `@media print` restates paper. **A `var()`
  reference, a missing alias, or a colour that is not an alias at all falls back
  to the dark value SILENTLY**, because custom-property substitution resolves
  where a property is DECLARED. **THIS BUG HAS NOW LANDED FIVE TIMES ACROSS TWO
  APPS AND WORN A DIFFERENT HAT EVERY TIME**: a `var()` inside an alias, a hex
  inside a component, a composed shadow (`--shadow-card`, `--shadow-raised`,
  `--backdrop-deep`, `--focus-outline`), a ground-blind plate, and `--season`,
  which was declared once in the shared palette block and was therefore not an
  alias and not something a check over the alias set could see. It shipped the
  day AFTER the alias test did, while that test passed.
- **SO THE CHECK NO LONGER LOOKS FOR A SHAPE; IT ENUMERATES.**
  `tests/design-tokens.test.ts` reads every stylesheet in the token layer
  (the DIRECTORY, so a new one is covered the day it lands), finds every custom
  property whose value is a colour, and requires each to be declared at TWO
  DISTINCT SITES: one the dark ground reaches and the paper ground does not,
  and one the other way round. **Two sites is the whole test**, because one
  declaration cannot hold two values however many ground selectors it names,
  which is exactly how the palette block looked correct. Two sites with the
  same value is fine (`--rule-gray` is deliberately identical on both, and
  being written twice is what makes changing one visible). The exemptions are
  the RAW PALETTE (`--idea-*`, `--program-*`) and the GROUND-PAIRED team-accent
  properties, and **neither exemption is taken on trust**: the raw-palette case
  fails if any rule anywhere references one, and the paired case fails if a
  `-on-light` ever loses its `-on-dark`. The control puts `--season` back as it
  shipped and requires the enumeration to flag it.
- **IDEA MINT IS ILLEGAL ON PAPER** (1.27 on the bone sheet), so the paper
  scope redeclares the accent as deep IDEA green `#226E1D` at 5.07 with its
  hue held, and flattens every glow to zero. Same rule the sibling app applies
  to Techmen Gold, same reason.
- Both grounds are derived and measured, and `tests/theme-contrast.test.ts`
  re-measures the SHIPPED stylesheets rather than trusting a comment. A new
  token, or a change to one, is measured on BOTH grounds in that test in the
  same change. `scripts/derive-dark-palette.ts` is where the arithmetic comes
  from; it reproduces 0018's own recorded figures as its control.
- **THE DEFAULT GROUND IS THE APP'S OWN, NOT THE OPERATING SYSTEM.**
  `resolveGround('system')` answers `dark` whatever the device prefers.
  `light` remains an explicit choice and resolves to paper, which makes
  choosing it a preview of the printout rather than a second theme to maintain.
- **THE GROUND CONTROL IS IN THE FOOTER OF EVERY SURFACE AND NEEDS NO
  SESSION.** `BrandFooter` is mounted at the root layout, so a student, a
  mentor, a board device and a signed-out visitor all reach the same
  three-state control. The choice is `localStorage['fll-theme']`, PER DEVICE:
  it survives a reload and a sign-out, and it does not follow an account to
  another device. That is deliberate on shared iPads.
- **THE LIGHT GROUND IS MEASURED AS THOROUGHLY AS THE DARK ONE, ON STUDENT
  SURFACES TOO.** A sweep that only walks mentor routes proves nothing about
  the runtime nine-year-olds use, and for two bundles that was the only sweep
  there was.
- **AN OFFICIAL ACCENT THAT CANNOT CARRY TEXT ON A GROUND BECOMES A FILL
  THERE, AND ITS FOREGROUND BECOMES A DECLARED FUNCTIONAL COLOUR.** On white,
  FLL green is 3.19 and FIRST red is 4.38; on the dark page, FLL purple is
  1.82, FIRST blue 2.76 and FIRST red 3.72. So `--accent`, `--success` and
  `--danger` are FILLS with a ground-independent ink, and `--accent-text`,
  `--link`, `--success-text`, `--danger-text` and `--warning` carry the words.
  **Never darken or lighten a brand colour and still call it the brand
  colour**; the functional values are separate, are enumerated in `colors.css`,
  are never brand expression, and never appear on or near a mark. That list
  does not grow quietly.
- **`--team-accent-ink` IS THE INK THAT SITS ON A FILLED ACCENT CHIP AND
  NOTHING ELSE.** An accent-coloured LABEL on a card, on a surface or on the
  accent wash is `--team-accent`, which is derived to clear 4.5 against all
  three surfaces of its ground AND against its own wash. Using the ink token as
  text put white on near-white in five places on the shipped light ground.
  `--accent-ink` and `--success-ink` are likewise the inks for DIFFERENT fills
  and are not interchangeable.
- **THE GROUND IS RESOLVED ONCE, BEFORE FIRST PAINT, AND THE DARK PALETTE IS
  WRITTEN DOWN ONCE.** Three states (system, light, dark), stored per device in
  `localStorage`, collapsed to a concrete `light` or `dark` by the blocking
  script at the top of `src/app.html`; CSS only ever sees
  `:root[data-theme='dark']`. Do not add a `prefers-color-scheme` copy of the
  palette: it is a second statement of one rule. `src/lib/theme/theme.ts` holds
  the only copy of that script, and `tests/theme-toggle.test.ts` runs the one
  in `app.html` against a stubbed browser so the two cannot drift.
- **NEVER NAME A SVELTEKIT PLACEHOLDER INSIDE A COMMENT IN `src/app.html`.**
  They are substituted by a plain string replace, comments included, and the
  markup injected for the head carries comments of its own whose closing
  delimiter ends the outer comment early -- spilling the rest of it onto the
  page as body text on every screen.
- **PRINT IS ALWAYS THE LIGHT GROUND, AND NO PRINT RULE RESTATES A COLOUR.**
  The dark palette is declared inside `@media screen`, so a printed sheet never
  sees it. An `@media print` block exists only to defeat the browser's "do not
  print backgrounds" default and to drop the chrome; one that names a colour is
  a second palette waiting to disagree with the first.
- **`[data-ground='light']` FORCES A GROUND ON A SUBTREE, AND A FORCED GROUND
  RE-DECLARES, IT DOES NOT INHERIT.** A `var()` resolves on the element that
  DECLARES it, so anything selected on an ancestor (a team accent) inherits
  straight through a plate unless the plate re-declares it -- which is why each
  accent states both of its triples and the ground picks one. `color` is an
  inherited VALUE too, already resolved on `<body>`, which is why `[data-ground]`
  also sets it. The notebook's paper preview and the route planner's mat are
  the two plates.
- **No glows, no coloured backdrops.** A mark may not sit on a busy or
  distracting background, and a halo in a brand accent is the nearest thing
  to recolouring one. Elevation is a neutral shadow.
- `--boundary` carries meaning and clears 3:1 on every ground it lands on
  (measured 4.38 / 4.02 / 3.65 against `--surface-0` / `-1` / `-2`);
  `--hairline` decorates and is not held to that. Do not raise `--hairline`.
  If you change `--boundary`, re-measure rather than assume.
- Touch targets are 44px minimum (`.btn`, `.tile`, `.input`); body text never
  below 17px. The users are nine.
- Everything animated is gated behind `prefers-reduced-motion: no-preference`
  (`motion.css`: the classes are the gate).
- **A TEAM'S COLOUR IS DATA, AND ONLY THE STYLESHEET KNOWS WHAT IT LOOKS
  LIKE.** `teams.accent` is an enum of eleven values (or null, before a team
  chooses); the server prints it as `data-accent="..."` and
  `team-accents.css` turns that into `--team-accent`, `--team-accent-ink`,
  `--team-accent-wash`. Never write a team colour as an inline style and
  never store a hex string in a column. A team accent is functional colour,
  never brand expression, and never touches a FIRST mark.
- **A TEAM STARTS WITH A COLOUR, AND THE VARIETY ON A SCREEN COMES FROM THE
  TEAMS, NOT FROM THE CHROME.** 0018 derived and measured eleven accents and
  nothing used one for seven bundles, because every team was created with
  `accent = null`: the live board's rail, the team card's wash, the teams
  list, the notebook tab and the planner's mission chips all fell back to the
  same neutral, so four teams rendered as four identical cards. 0025 hands a
  starting colour to every accent-less LIVE team and `seed.sql` does the same
  for a fresh stack. A team still CHOOSES (`team_propose_accent`,
  `team_confirm_accent`, `team_set_accent`); what changed is the state it
  starts in. **THE HAND-OUT ORDER IS DERIVED, NOT TASTE**: a farthest-point
  walk scored by the WORSE of the two grounds, so the first four teams are
  lime, purple, teal and orange with a closest pair of dE 54.8 where the
  enum's own order would have given dE 18.9 and two greens.
- **THE SEED NOW HOLDS FOUR OF THE ELEVEN COLOURS, so a test that hard-codes
  one is a coin toss against it.** Ask the database which are free
  (`team-identity-accent.test.ts` shows the query) rather than naming a
  colour.
- **`.btn--small` is a DESKTOP affordance.** It exists so a dense table row on
  a laptop is not all button; `@media (pointer: coarse)` puts it back to 44px.
  Any new compact control does the same.
- **THE STUDENT RUNTIME IS 375px FIRST AND THE WHOLE SCREEN IS THE TEAM'S
  ACCENT**, not a stripe on a card: a glance across a table of phones should
  say whose is whose. Every student-facing control is a 56px slab; a link they
  are meant to tap is a button, not a line of text. The reading level is
  fourth grade -- "Nobody is in this seat", not "role unfilled"; "I'm here",
  not "Check in". The team board is landscape-first and sized to be read from
  a metre away (`clamp()` on every heading).
- **The Live Board is phone-first; every other console surface is
  desktop-first master-detail.** Both ends are checked regardless: a pass at
  1440px is not a pass at 375px. A grid item defaults to `min-width: auto`, so
  any track holding a deliberately wide child (a table with a `min-width`, a
  fixed-width preview frame) states `min-width: 0` or
  `grid-template-columns: minmax(0, 1fr)`, or the page scrolls sideways.
