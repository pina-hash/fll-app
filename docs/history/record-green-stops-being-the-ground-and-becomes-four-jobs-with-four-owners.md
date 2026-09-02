---
title: "2026-08-27 -- Green stops being the ground and becomes four jobs with four owners"
date: 2026-08-27
branches: []
migrations: ["0025"]
subsystems: ["Visual theme, brand"]
record_order: 27
---

Reported from use: the app is far too greenwashed. It was, and the cause was
the palette specification rather than any implementation of it. Every rule in
the app was written correctly against a semantic token, and the tokens all
pointed at the same colour.

### The diagnosis, measured before anything changed

At HEAD, mint answered to ELEVEN token names -- `--accent`, `--accent-text`,
`--fg-hero`, `--rim`, `--link`, `--focus-ring`, `--success`, `--success-text`,
`--season`, `--selection-bg`, `--glow` -- and every one of them resolved to
`#8FE08A` on the dark grounds and `#226E1D` on paper. 147 references across 30
files, and not one of them looked wrong at its own call site.

Underneath all of it, the page ramp itself was green: `#131A13 / #1B241B /
#242F23 / #2E3D2E`, all with G above R above B. A ground is under every pixel
and no rule has to ask for it, so the cast was there before a single
declaration ran. `--gear` / `--boundary` / `--fg-structure` were `#75846F`, a
green-grey on every card border in the app.

"Green is the IDEA identity and it is SCARCE ON PURPOSE" has been in CLAUDE.md
since the token layer shipped. It was written down four bundles running and
ignored four bundles running, because a sentence cannot be violated by any one
line. It is a LIST now.

### TASK 1 -- the ground

The default ramp is neutral: `#111111 / #181818 / #222222 / #2C2C2C / #393939`,
with `#323232` hairline and `#808080` structure.

**EVERY STEP MATCHES THE GREEN STEP'S LUMINANCE, AND THAT IS WHY NOTHING HAD TO
BE RE-DERIVED.** Contrast depends only on relative luminance, so a neutral grey
of the same Y preserves every ratio ever measured against these surfaces. The
8-bit grid moves each recorded figure by at most 0.05 and no pairing crosses its
floor: `--text-3` on `--surface-2` went 4.52 to 4.53, `--boundary` 3.51 to 3.52,
`--fg-dim` 4.35 to 4.36. Every figure in `colors.css` was re-measured against
the new ramp and rewritten rather than carried over, because a comment that
records a ratio is a claim.

The green ramp is not deleted. It is `[data-ground='deck']`, a COMPLETE scope
(a ground that re-declared only its six surfaces would inherit every other alias
from wherever it was nested, which is the alias bug wearing a sixth hat), and
**nothing sets it yet**, which is stated in the file rather than implied.

`tests/design-tokens.test.ts` was taught the third ground: `reaches()` now
classifies a selector against three ground regexes instead of two, and
`declaredPerGround` requires a system of DISTINCT sites, one per ground, rather
than a distinct pair. Proved to bite by deleting `--rim` from the deck scope
(two cases red, the file restored byte-identically, md5 checked).

**THE STRUCTURE COLOURS WENT NEUTRAL TOO, and that is TASK 2's rule, not this
one's**: linework is not identity, not an active state and not a status.
`--boundary` on paper is one 8-bit step darker than its luminance match, because
the exact neutral `#7C7C7C` measures 2.99 on `--surface-2` and would have been
the first boundary in this palette under its 3:1 floor; `#7B7B7B` is 3.03.

### TASK 2 -- one job per colour

**147 references to 64.** The job list, before and after, is in the bundle's
report; the shape of it is:

- **Identity, kept**: `--season` on the console wordmark and the login hero,
  `--fg-hero` + `--glow` on hero type. Five references.
- **ONE active state**: the console nav pill, `.shell__tab--on`. It is the only
  "you are here" that is on screen on every mentor route, so it is the one that
  earns the colour. Everything else that said "selected" in green now takes
  `.btn--picked`'s treatment -- a lighter fill, a full-strength ink ring, bold
  -- or the team's own accent: the teams and tasks filter segments, the media
  library chip, the notebook tab, the planner's unit and zoom toggles, the
  calibrator's zoom, and the code generator's step chip, wheel card, hub port
  and role button.
- **The primary action**: `.btn--primary` and its student and kiosk dress
  (`.slab--go`, `.open__btn`). One job, three sizes.
- **The focus ring**: unchanged.
- **Status**: `--success*` stays green and stays a status token, on done, live,
  connected, ok and outcome-worked, which is 20 of the remaining 64.

### The pattern, which is the finding

Every instance had the same shape: **a semantic token already existed and the
green got used because it was the green that was handy.** Four kinds:

1. **A status token doing typography.** `--success-text` was the colour of the
   library header title, the board's open-screen title, four clock readouts, a
   mission's points number, a course badge, the calibrator's ruler and the mat's
   launch-area label. None is a success. `--text-1` and `--text-2` existed the
   whole time.
2. **The action colour marking state.** "Live (6) / Archived (0)" and the task
   status filters were `.btn--primary` toggled onto whichever was showing. A
   filter that is already applied is not something to press, and there was no
   picked treatment to reach for, so there is one now.
3. **A status wearing the link colour.** A notebook entry whose outcome is
   "mixed" and a queue that is "syncing" were `--link`. Mixed is between worked
   and failed and syncing is in progress: `--warning` is exactly that meaning
   and had 72 references elsewhere already.
4. **Content accents sitting unused while content took the identity colour.**
   The strategy prompt on a mission page and a library item was outlined in
   `--accent` while `--brass`, which CLAUDE.md names as the callout accent, had
   ZERO references in the whole app. `--copper` and `--patina` likewise.

`--link` itself is the ink now, on every ground, which moved 35 references off
green in one line per scope. Twelve of those were never links: route lines,
waypoint dots, step numbers, a timeline segment, a chart dot. They were renamed
to `--text-1`, which is a rename and not a change -- the two tokens are the same
literal on every ground -- so `--link` means links again.

**One thing this found that nothing else would have:** the mat calibrator drew
its two corner pins in `--success` and `--accent`, which are the same colour on
every ground. The one screen whose whole job is "tap this corner, now tap the
other one" was drawing two identical markers. They are ink and copper now.

`--link` also left `theme-contrast.test.ts`'s brand-substitute list, with the
reason written into the case: that list exists for functional values that stand
in for a brand colour that cannot carry text, and the ink stands in for nothing.
An ink that is a near-black is not brand expression, and the paper ground's has
been within dE 10 of FIRST black since it shipped (`#131A13` measured 8.9) on
`--fg` and `--text-1`, which that case has never covered and should not.

### TASK 3 -- colour from content

**0018 derived, measured and shipped eleven team accents and NOTHING HAD USED
ONE FOR SEVEN BUNDLES**, because `teams.accent` is nullable and every team was
created null. The live board's 6px rail, the team card's wash, the notebook tab
and the planner's mission chips all fell back to `--text-2`: six team cards on
the console rendered as six identical grey cards, and the teams list said "no
colour yet" six times.

`0025_teams_default_accent.sql` hands a starting colour to every LIVE team whose
accent is null. It never overwrites a colour a team chose, never touches an
archived team, refuses to run if the enum stops being eleven values, and leaves
the remainder null with a count if there are more colourless teams than free
colours. `seed.sql` does the same for a fresh stack, because the seed runs AFTER
the chain and would otherwise put a local database straight back into the state
0025 exists to end. A team still chooses; what changed is the state it starts in.

**THE HAND-OUT ORDER IS DERIVED.** Enum order gives the first four teams bark,
orange, olive and lime, two of which are greens and whose closest pair measures
dE 18.9. The order in the file is a farthest-point walk over the eleven, scoring
each pair by its WORSE ground so a colour that separates well on one sheet and
badly on the other cannot win. It gives lime, purple, teal, orange: closest pair
dE 54.8. That is the number that matters, because this club runs four teams.

The teams list gained a 4px accent rail, the accent wash the board cards already
use, and the team name in its own colour (`--team-accent`, not the ink token:
the one derived to clear 4.5 against all three surfaces AND against its own
wash).

**THE PROGRAM LAYER AT MODERATE WEIGHT**: the footer's top edge is the published
FIRST gray rather than the app's decorative hairline, so the band carrying the
two lockups reads as program chrome. That is the "footer rail". **No
program-scoped badge was invented**, and that is a decision rather than an
omission: CLAUDE.md and the FIRST guidelines both put brand colour on chrome and
never on content, and adding a badge to the season-document list means adding
markup, which this bundle was told not to do.

### TASK 4 -- light and dark, both roles

Already built and already correct; what it needed was proving and one fix. The
control lives in `BrandFooter`, which `BrandSurface` mounts at the ROOT layout,
so a student, a mentor, a board and a signed-out visitor all reach the same
three-state radio group. Its own selected option was `--accent-text` -- a second
green active state, in the footer of every surface in the app at once -- and it
is the picked treatment now.

Measured: control present and usable while SIGNED OUT; ground before any choice
is `dark`; a student picks Paper and gets `data-theme=light`, `fll-theme=light`,
body `rgb(234, 230, 216)`; identical after a reload; identical after a real
`POST /auth/signout` that bounces `/app/me` to `/login?next=%2Fapp%2Fme` and
leaves no auth cookie with a value; and a DIFFERENT browser context still opens
dark, because the choice is per device and not per account.

### Measured

- **The mint job list, before and after**: 147 references across 30 files, to 64
  across 20. Green's remaining owners are exactly the four jobs above.
- **Contrast: 108 screens over 26 distinct routes** -- every mentor route
  including five team drill-ins, every student route, `/board`, `/login` and
  `/auth/error`, each on BOTH grounds at 375 and 1440. **0 pairings under the
  floor**, and 0px horizontal overflow on 106 of the 108. Student surfaces had
  never been measured on paper before this bundle; all 32 of those screens are
  clean.
- **The emitter did not move.** The generated project structure is byte-for-byte
  identical between HEAD and this bundle (same block counts, stacks, variables,
  extensions, findings, unpinned manifest fields). Only CSS changed in the
  generator's components.
- **`npx svelte-check`: 0 errors, 0 warnings, 723 files.**
- **Full suite on a database rebuilt from the chain, twice.** HEAD: 130 failed /
  458 passed / 92 skipped. This bundle: 130 failed / 459 passed / 92 skipped, and
  the failing SETS are identical -- `comm` reports no test failing here that
  passes at HEAD, and none the other way. The stand-in is not GoTrue and not
  PostgREST, so most of the suite cannot pass in this session and only the
  difference is honest.
- **Two tests broke on the way and both were right to.**
  `schema-catalog.test.ts` and `team-identity-accent.test.ts` each asserted that
  the seeded teams have no colour, which is the claim 0025 reverses; they assert
  the four starting colours now, and the second also asserts the names are still
  NUMBERS, because handing out colours must not walk back 0018's rename. The
  other was the accent race's POSITIVE CONTROL, which hard-coded teal and lime:
  the seed now holds four of the eleven, so it looks up two free colours instead
  and cannot go stale the next time the seed changes.

### Not verified

- **GoTrue and PostgREST were not in the loop**, for the fourth bundle running:
  no container registry is reachable from this session. Every claim here is a
  rendering, arithmetic or SQL claim, and none depends on which server answered
  the data call. **0025 has NOT been pushed to the linked project**; it is
  committed and applied locally only. `supabase db push` is the delivery and it
  has not happened.
- **The deck ground has never been rendered**, because nothing sets
  `data-ground="deck"`. It is asserted complete and its literals are measured;
  no screen has been seen wearing it.
- **No printed sheet was produced.** The print scope tracks paper and is
  asserted for completeness; it has not been through a print dialog.

### Found, not fixed

- **`/app/codegen/[teamId]` overflows 9px horizontally at 375**, on both
  grounds. Confirmed PRE-EXISTING: the same probe reports 9px at HEAD. The
  overflowing boxes are `.mc__head`, `.mc__teams` and `.cg`, which is a padding
  or box-sizing question in the mentor console wrapper. It is layout, and this
  bundle was told to change colour and tokens.
- **`src/lib/design-system/index.css`'s header is still stale** (it names the
  FIRST palettes and the Roboto family, neither of which has been true since the
  IDEA bundle). Reported last bundle, still a comment, still not this bundle's
  remit.
