---
title: "2026-08-27 -- The generator asks a nine-year-old questions a nine-year-old can answer"
date: 2026-08-27
branches: []
migrations: []
subsystems: ["Code generator"]
record_order: 25
---

The code generator worked and nobody wanted to use it. Reported from use: it
looked archaic and was not fun, and the users are nine to fourteen. The copy was
good and mostly survives. The problem was the shape: twelve form controls in a
column, one of them asking a fourth grader for a gear ratio. This bundle
rebuilds `/app/me/codegen` and `/app/codegen/[teamId]`. Same
`CodegenPage.svelte`, same one render path, same transport, same emitter. The
emitter, the validator and the registry were not touched.

### The two structural findings, dealt with before any styling

**SIX FIELDS WERE ONE QUESTION.** `left_motor`, `right_motor`, `movement_pair`,
`left_color_port`, `right_color_port` and `attachment_motors` all answer "what
is plugged into which port", and the form asked it six times: two dropdowns, a
text box wanting "AB", two more dropdowns and a row of six checkboxes. A child
holding a driving base does not hold six answers, they hold one picture. So
`src/lib/codegen/ports.ts` is that picture as data (a `PortRole` per port) and
`HubPorts.svelte` draws it: a top-down hub with A, B, C down the left edge, D, E
and F down the right, and the 5x5 light matrix between, which is the real
layout, because the picture's whole job is being matched against the brick in
front of them. Tap a port, pick one of five things.

**`movement_pair` IS NOW DERIVED AND IS NO LONGER A FIELD.** It was a second
source of truth that could silently disagree with the two drive ports: set the
left motor to C, the right to D, leave "AB" in the box, and the emitter baked a
movement pair naming two ports with no drive motors in them. Nothing checked it
and nothing could. `configPortsFromMap()` is now the ONLY producer of one and it
is `leftMotor + rightMotor`. The column is stored exactly as before. A row that
already disagrees with itself is repaired when it is opened, not when a port
happens to be touched -- that gap was found by the test, not by reading the
code, and is why the repair runs on arrival.

**`yaw_axis` WAS COLLECTED, STORED AND IGNORED, SO IT IS NO LONGER ASKED FOR.**
T17 left the emitter when V9 refused `flippermoresensors_setOrientation` as an
unverified shape, and nothing has read the column since. The column stays, the
`up` default stays, `cfg.yawAxis` still travels to the transport untouched, so a
row saying 'front' keeps saying 'front'. What is gone is the question.
`CodegenPage.svelte` carries the note saying the control returns when the shape
is verified, and `tests/codegen-ports.test.ts` goes red if a control comes back
before then.

### What landed

- **`src/lib/codegen/ports.ts`** -- the port map, its rules and the one
  producer. Drive roles SWAP rather than duplicate (there is one left driving
  wheel, so putting it in C has to say something about the port that held it),
  which is what keeps the map complete at every step. Colour REFUSES rather than
  swapping: two ports are already the answer and there is no non-arbitrary way
  to pick which a third displaces, so the screen says "Two colour sensors
  already, in E and F. Set one to Nothing first." Predictable beats clever.
  Which colour sensor is "left" is decided by port letter, and that rule is
  printed under the hub rather than left to be discovered.
- **`HubPorts.svelte`, `WheelPicture.svelte`, `TrackPicture.svelte`** -- three
  drawings, all made of tokens and shapes by this repo. No LEGO artwork is
  fetched, mirrored or reproduced. The three wheels are drawn at TRUE RELATIVE
  SIZE (radius scaled from the millimetres), because the ratio is the thing
  being matched against the part in a hand. `TrackPicture` exists because the
  three wrong answers to "track width" are all reasonable -- outside to outside,
  inside to inside, the width of the chassis -- so the arrow starts and ends on
  a marked wheel centre line and the caption says so.
- **Four steps, not one wall.** Our robot / Our wheels / What our sensors see /
  Make it. Back and forward, progress on screen throughout. Forward is blocked
  by that step's own blockers, stated as sentences ("Say which port the LEFT
  driving wheel is in", "White has to read a bigger number than black"), so an
  incomplete answer cannot be walked past. Tapping a numbered chip goes BACK
  only.
- **Wheels are recognised, not measured.** Three pictures at 56, 43.2 and 88 mm
  with "Ours is something else" as a disclosure behind them, which opens itself
  for a stored wheel that is not one of the three. The unit toggle and the
  rounding-safe commit from the previous bundle are untouched.
- **Gears default to 1:1 and hide behind "Our robot has gears."** Most driving
  bases are direct drive and "motor turns per wheel turn" is a phrase no
  nine-year-old should meet unless it applies to them. The disclosure opens
  itself for a stored ratio that is not 1.
- **The arithmetic panel stays and now visibly moves.** It was the best thing on
  the page. Changing the wheel from 56 mm to 43.2 mm moves 300 mm from 614 to
  796 motor degrees on screen, which is the error the emitter would otherwise
  bake into every drive in every run with nothing on the robot to say so.
- **Generate is an event.** Two cards arrive, named, each saying what it is for
  ("The one you drive with. Open this in the SPIKE App." / "Run this on the hub
  once to check the toolkit works."), with the block count, the stacks, the
  extensions and the variables the file contains.
- **`FirstName.svelte`** -- the naming violation the previous bundle found and
  reported. Every space between two names is now an explicit `{' '}`.

### The FIRST naming fix, and why the source looked right

Svelte trims whitespace at the START of an `{#if}` block's content. The markup
had a newline and two tabs between LEGO and League; the compiler dropped them,
and the page said "FIRSTLEGO League" and "LeagueChallenge" on every mentor
screen for the whole of the bundle that shipped it. Reading the file proved
nothing. `{' '}` is an expression and is emitted verbatim, so the spacing no
longer depends on how the file is indented.

The guard is new and it is a RENDERING assertion, because nothing else could
have caught this. `tests/brand-rules.test.ts` now renders the real component
through `svelte/server` and reads the text out of the output. That needed the
Svelte plugin in `vitest.config.ts`, which is there for this one reason and is
commented as such; it does not turn `tests/` into a component suite.

### Measured

- **Browser, both roles, 375 and 1440, all four steps, walked start to finish
  and generated.** Identical behaviour in all four combinations.
  - Step 1: hub renders `A=LEFT DRIVE B=RIGHT DRIVE C=MOTOR D=MOTOR E=COLOUR
    F=COLOUR`, derived line "Left colour sensor: E - right colour sensor: F".
    All six old controls absent: movement-pair box 0, yaw select 0, port selects
    0. Port tap target 91x88 (375) / 96x69 (1440). Tapping C offers the five
    roles; Colour is disabled and says why; setting C to left drive swaps A to
    MOTOR, as designed.
  - Step 2: three wheel cards, tap targets 145x221 (375) / 210x198 (1440).
    43.2 mm moves the sum 614 -> 796; back to 56 mm returns 614. Track picture
    drawn with its caption. Gear ratio box on screen: 0.
  - Step 3: white 5 against black 12 raises the blocker and disables Next;
    restoring 95 re-enables it.
  - Step 4: two file cards, 374 blocks / 9 stacks / 6 extensions / 10 variables
    and 466 / 10 / 7 / 12, verdict "Checked: nothing wrong. 2 files ready."
  - 0px horizontal overflow on every step at both widths. No console or page
    errors.
- **The emitter output did not move.** A config built the old way and the same
  config seeded THROUGH the port map produce structurally IDENTICAL projects:
  374 blocks / 9 stacks / 10 variables / 6 extensions and 466 / 10 / 12 / 7, 0
  findings, bytes present, the 16 unpinned manifest fields unchanged. Structure,
  not bytes: `pack()` uses `Math.random()` and `new Date()`.
- **`tests/codegen-ports.test.ts`, 14 cases.** The property is asserted over
  every map reachable in two moves from the default: 187 distinct maps, 75 of
  them complete, and every complete one has `movementPair === leftMotor +
  rightMotor` and satisfies 0024's two CHECK constraints. The 112 incomplete
  ones all produce `null` rather than a half-built config. The structural half
  greps `src/` and fails if any file outside a named list of four assigns
  `movementPair` at all; the four are listed with a written reason each, so a
  fifth has to be argued for.
- **`tests/brand-rules.test.ts`, 32 cases**, including the five rendered names.
  The guard was proved to bite: putting the trimmed whitespace back reddens two
  cases; the file was restored and re-measured byte-identically (md5
  d1ed6aa0da7336ad52f8d06a3d0d68f8) and the file went green again.
- **`npx svelte-check`: 0 errors, 0 warnings** (723 files).
- **The full suite, twice, on a database rebuilt from the chain each time: once
  at HEAD and once with this bundle.** The stand-in is not GoTrue and not
  PostgREST, so a large part of the suite cannot pass here at all; the only
  honest reading is the DIFFERENCE, and it is exactly the new tests.
  HEAD: 28 files failed / 18 passed, 130 tests failed / 433 passed / 92 skipped.
  With this bundle: 28 files failed / 18+1 passed, 130 tests failed / 450
  passed / 92 skipped. Same 130 failures, both times, and +17 passing, which is
  the 14 port cases plus the 3 rendered-name cases. Nothing that passed before
  stopped passing.
- **Contrast, every text node on every step, both grounds, both widths, both
  roles** -- 32 step-screens, which is what the repo-wide sweep does not do (it
  measures step 1 of the dark ground only). 24 of the 32 came back clean and the
  8 that did not are the mentor light-ground screens, carrying only the two
  chrome defects below. One defect was introduced and fixed:
  the current step chip was `--accent-text` on `--accent-soft` and measured 4.31
  on the paper ground, because a wash darkens the surface under ink derived to
  clear 4.5 against the bare surface. It is now `--accent-ink` on `--accent`,
  the fill-plus-declared-ink pairing the palette already measures on both
  grounds and the same one the Next button and a chosen port use.

### Found, reported, NOT fixed

Both are in the mentor console CHROME, not on this page. They appear on every
mentor screen and on none of the student ones: the same two, with the same
numbers, on all five of `/app/board`, `/app/teams`, `/app/tasks`,
`/app/library` and `/app/notebook`, which this bundle does not touch. Both
predate it.
They are written down here rather than fixed because correcting either means
changing the token layer or the shell, which is a different surface and owes its
own measurement on both grounds.

- **`.shell__season-name` is `--season` (mint, `#8fe08a`) and on the paper
  ground it lands on bone: 1.14 against `rgb(223, 218, 202)`, at 18px/700, plus
  its `™` at 10px/700.** `--season` is declared once in the identity block that
  all four ground selectors share, so unlike every alias it does not re-declare
  per ground. The fix is to give it a paper value in the paper block, derived
  and measured the way the rest of that palette was.
- **`.shell__tab--on` is `--accent-text` on `--accent-soft`: 3.88 on paper.**
  The same wash arithmetic as the step chip above, in the console nav. The
  cheapest correct fix is the one used here.

### Not verified

- **GoTrue and PostgREST were not in the loop.** No container registry is
  reachable from this session, so the browser work ran against the same local
  stand-in the previous two bundles used and disclosed. What it establishes is a
  RENDERING and ARITHMETIC claim: computed styles, resolved grounds, measured
  contrast, overflow, the port map's behaviour under taps, and the generated
  projects' structure. None of those depend on which server answered the data
  call.
- **No `.llsp3` was opened in the SPIKE app.** The claim made here is that the
  output did not MOVE, measured against the same emitter's output before the
  change, not that it opens; that was established when the emitter shipped.
- **The saved row was not re-read through a real PostgREST.** The derivation is
  asserted in arithmetic over every reachable map and the repair is asserted on
  a hand-built contradictory row.

### Deferred

- **The two chrome contrast defects above.**
- **`flippermoresensors_setOrientation` is still unverified**, so the yaw
  control stays off the screen. Verifying the shape and restoring the control
  are one job, in that order.

