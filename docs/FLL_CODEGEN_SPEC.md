# FLL Code Generator - Governing Specification

**Version 1.16 - 2026-08-25**

Owns the SPIKE Prime word-block code generator inside `fll-app`. Covers the container
format, the normative technique standard, the My Block toolkit, the plan intermediate
representation, the compiler, the validator, the student authoring surface, and the
phase gates.

Read this file in full before writing any emitter code or any Claude Code prompt that
touches the generator. App layout, role parity, and viewport rules are not restated
here and remain governed by `IDEA_INTERFACE_STANDARDS.md`.

---

## What this is

A compiler that turns a student-authored run plan into a LEGO Education SPIKE App 3
word-block project file (`.llsp3`), against a known robot configuration and a known
sensor calibration.

**What it generates:** the reliability substrate. Heading math, distance arithmetic,
timeout discipline, calibration normalization, re-reference bookkeeping, and the
identical preamble every program needs. This material is the same for every FLL team
on earth and is not what Robot Design judging evaluates for originality.

**What it never generates:** mission selection, run order, attachment design, launch
position, or strategy. Those are the team's work. An empty plan compiles to an empty
program, by design and without exception.

The distinction is the entire ethical and pedagogical basis of the feature. It is a
hard rule, not a design preference. See Judging and Core Values below.

---

## Runway and what it caps

FIRST LEGO League ends after the 2026-27 BIOGLOW season; FIRST and LEGO Education
conclude their partnership at that point. The successor LEGO League season in 2027-28
still accepts SPIKE and legacy hardware. From 2028-29 onward LEGO League requires the
Computer Science and AI kits. FIRST's separate K-8 successor program has not named its
hardware, and the current regional-partner expectation is that SPIKE remains usable
there while the CS and AI kit does not.

**Consequence:** two guaranteed competitive seasons plus indefinite classroom use.
That justifies a focused build against a stable target. It does not justify a platform,
a plugin architecture, a second hardware backend, or any abstraction whose payoff is
in season three. Build for SPIKE Prime word blocks and nothing else. Revisit only if
the successor program names SPIKE.

---

## Hard rules

- **The app proposes no mission content.** No suggested runs, no recommended order, no
  "teams like yours also attempted." The plan is authored by students or it does not
  exist.
- **Every plan step carries a student-written note before the plan will compile.** The
  note is the explainability gate and the notebook line. A plan with an unwritten note
  is invalid input, and the compiler refuses it rather than filling it in.
- **Every emitted sensor wait has a timeout.** No exceptions, no opt-out, no advanced
  mode that removes it. A bare wait that never satisfies burns the entire 2.5 minute
  match, and this is the single most common way a working program fails at a tournament.
- **Ports are baked from the robot configuration, never parameterized.** See the
  toolkit section for why this is a platform constraint and not a choice.
- **No emitter code is written before Phase 0 closes.** The manifest is unknown, and a
  guessed manifest produces a file that looks correct and does not open.
- **A generated file is proven by the SPIKE App opening it, not by the emitter
  reporting success.** This is the project's standing rule that a tool's report is
  evidence about the tool rather than about the world, applied here.
- **Calibration constants are baked at generation time, not read at run time.** SPIKE
  cannot share values between programs in different slots, so a runtime calibration
  would have to run inside all fifteen programs. Baking them in makes a venue lighting
  change a single regenerate-all instead of fifteen hand edits.

---

## Phase 0: the ground truth gate

Nothing downstream of this section may be built until every item here is resolved
against a real file produced by the real app.

### Container format, locked against a real export

Established 2026-08-25 by reading a `Project_1.llsp3` produced by the SPIKE App on
Mr. Pina's machine. This section is measurement, not inference. Where it disagrees with
anything written from research, this section governs.

```
Project.llsp3                zip, all entries STORED (no compression)
  manifest.json
  scratch.sb3                zip; project.json DEFLATED, assets STORED
    project.json
    deadc057000000000000000000000000.svg    zero bytes, stub costume asset
    <hash>.wav                              default sprite sound, present but unused
  icon.svg                   Blockly render of the workspace, decorative
```

**`manifest.json`, verbatim shape:**

| Key | Observed value | Emitter treatment |
|---|---|---|
| `type` | `"word-blocks"` | literal |
| `version` | `38` | literal, manifest schema version |
| `autoDelete` | `false` | literal |
| `created` / `lastsaved` | ISO 8601 UTC, milliseconds, `Z` | generated |
| `id` | 12-char token | generated |
| `name` | project name | from plan |
| `slotIndex` | `0` | from plan, 0 to 19 |
| `size` | `0` | literal |
| `workspaceX` / `workspaceY` / `zoomLevel` | `120` / `120` / `0.675` | literal |
| `showAllBlocks` | `false` | see note below |
| `hardware` | `{"<20-char id>": {"type": "flipper"}}` | copied |
| `extensions` | `["flipperevents", "flippermove"]` | **computed from blocks used** |
| `state` | `{playMode, canvasDrawerTab, canvasDrawerOpen}` | copied |
| `extraFiles` | `[]` | literal |

**`extensions` is the finding with the longest tail.** It lists only the namespaces the
project actually uses, and it appears in two places that must agree: the manifest and
`project.json`. An emitted file using a `flippermoremove` block without declaring the
namespace in both arrays is the most likely way to produce a file that opens with
missing blocks rather than failing loudly. The emitter computes both arrays from the
block set rather than hard-coding either.

**`project.json`** is standard Scratch 3. `meta.vm` is pinned at
`0.2.0-prerelease.20200512204241` and is copied verbatim rather than invented. Two
targets: a `Stage` with no blocks, and one sprite whose `name` is a 20-character random
token. Block ids are 20-character tokens from Scratch's wide `soup` charset including
punctuation; any unique string is acceptable and the emitter uses readable ones.

Assets: the costume `assetId` is the well-known `deadc057...` stub and the file it
names is **zero bytes**. The emitter ships the same zero-byte SVG rather than rendering
anything.

### Block shapes, from the export

- **Numeric literals are inline primitives** in the input array, not separate blocks:
  `"VALUE": [1, [4, "10"]]`, where `4` is `math_number`.
- **A reporter obscuring a literal** uses input type 3 with the literal retained as a
  fallback: `"VALUE": [3, "<reporter id>", [4, "10"]]`.
- **Some parameters are true fields.** `flippermove_move` carries
  `"fields": {"UNIT": ["rotations", null]}`.
- **Selectors are shadow blocks in input slots, not fields.** `setMovementPair` carries
  `"inputs": {"PAIR": [1, "<id>"]}` pointing at a `flippermove_movement-port-selector`
  block with `shadow: true` and field
  `field_flippermove_movement-port-selector`. Direction works the same way via
  `flippermove_custom-icon-direction`.

### Confirmed by probe, 2026-08-25

Two emitter-produced files opened in the SPIKE App and rendered correctly. These are
measurements from a real app, not inferences.

**The core question is answered: the app opens a file the emitter wrote.** Probe A
rendered `when program starts / set movement motors to A+B / set movement speed to 40 %
/ DRIVEROT 2` with a separate `define DRIVEROT (rotations)` stack. Probe B rendered
`set movement acceleration to slow` and `start moving at 40 40 % speed`.

| Question | Result |
|---|---|
| Emitter-produced file opens | Yes |
| My Block definition, prototype, and call round-trip | Yes, all three render correctly |
| Argument reporter driving a numeric input | **Yes.** Input type 3 obscuring an inline literal works |
| Extension blocks render when declared | Yes, with the combination below |
| Menu shadow shape guessed from the string table | Correct |
| Bundled sound asset required | No. `"sounds": []` and no wav in the archive |
| Zero-byte stub costume asset | Accepted |
| Stub `icon.svg` | Accepted |
| Outer zip STORED, inner `project.json` DEFLATED | Accepted |
| Generated `id`, `name`, `slotIndex` in the manifest | Accepted |

**The argument-reporter result is the load-bearing one.** The entire toolkit depends on
My Blocks taking numeric parameters that reach the movement blocks. Probe A proves it:
`move [forward] for (rotations) rotations` renders with the parameter wired into the
VALUE input as a type-3 obscured shadow. Had this failed, all eight toolkit blocks would
have had to become parameterless per-distance variants and the feature would not have
been worth building.

**Menu shadows follow `<namespace>_menu_<name>` with a field named `<name>`.**
Confirmed by `flippermoremove_menu_acceleration` carrying
`"fields": {"acceleration": ["slow", null]}`. This pattern was guessed from the string
table and held, so the remaining menu shadows can be derived the same way rather than
each needing its own export.

**Extension declaration: the proven combination is `extensions` present in both the
manifest and `project.json` **and** `showAllBlocks: true`.** The probes set
`showAllBlocks` to true; the original hand-made export had it false. Whether the
declaration alone suffices is untested, so the emitter sets it true and does not
speculate.

### Confirmed by Probe D, 2026-08-25

**`TURN TO (heading) AT (speed) SPEED` was emitted and rendered correctly in the SPIKE
App.** Not a shape test: the real toolkit block, 42 blocks, built the way the compiler
will build it. This validates the toolkit's central algorithm end to end before a line
of `fll-app` code exists.

What it renders as, verbatim from the app:

```
define TURN TO (heading) AT (speed) SPEED
  set [turn error] to ((((heading) - (yaw angle)) + 180) mod 360) - 180
  set [settled] to 0
  repeat until <(settled) > 2>
    set [turn error] to ((((heading) - (yaw angle)) + 180) mod 360) - 180
    if <(abs of (turn error)) < 2> then
      change [settled] by 1
    else
      set [settled] to 0
    set [turn power] to (turn error) * 1.2
    start moving at (turn power) (0 - (turn power)) % speed
  stop moving
```

Closed by this one file:

| Shape | Result |
|---|---|
| `AXIS` as a plain field on `flippersensors_orientationAxis` | Guess confirmed. Renders `yaw angle` |
| Reporter nesting four levels deep | Works. The wrap expression renders intact |
| Multi-parameter My Block, labels interleaved with inputs | Works. `TURN TO %s AT %s SPEED` reads as a sentence |
| `control_repeat_until`, `control_if_else`, `control_wait` | All confirmed, including `SUBSTACK` and `SUBSTACK2` |
| `operator_mod`, `add`, `subtract`, `multiply`, `gt`, `lt`, `mathop` with `OPERATOR: abs` | All confirmed |
| `data_setvariableto`, `data_changevariableby`, `data_variable`, target `variables` map | All confirmed |
| `flippermoremove_startDualSpeed` with reporters in both inputs | Confirmed |
| `flippermove_stopMove`, `flippersensors_resetYaw`, `flippermove_setMovementPair` | Confirmed |
| Structural parent normalization | Produces an openable file |

**T2's wrap expression is now proven renderable**, which was the technique most likely to
be untranslatable into word blocks.

### Confirmed by Probe C failing, 2026-08-25

Probe C did not open. The app showed only *Could not open project* and refused the
entire file. **There is no graceful degradation and no diagnostic.** One wrong opcode,
field name, or shadow shape loses everything, and the app will not say which.

Three rules follow.

- **Every block shape in the toolkit is verified by observation before it ships.** An
  unverified shape is not a small risk that degrades a single block; it is total loss of
  the file with no error message pointing anywhere.
- **The validator is the only diagnostic that exists.** The app provides none, so V1
  through V8 are not belt-and-braces. They are the entire feedback mechanism, and they
  must run before a file ever reaches a student.
- **A probe tests exactly one unverified shape.** Probe C bundled eight and was
  therefore uninformative about all eight. Bundling was the mistake, and folder-drop
  import makes it unnecessary: N files cost the same as one to deliver.

**Fault confirmed by elimination, 2026-08-25.** All six bisect files opened and
rendered correctly, covering every other unverified shape in Probe C individually. The
sole fault was using `flipperdisplay_ledMatrixText`, which carries a `{PORT}`, for the
hub's built-in matrix. The hub matrix block is `flipperlight_lightDisplayText`, which is
`write {TEXT}` with no port at all; the `flipperdisplay_*` family addresses an attached
matrix. Everything else in Probe C was correct, which is why bundling made the file
uninformative about all eight shapes rather than seven.

**The field pattern generalized and held.** A dropdown with no matching
`<ns>_..-selector` or `<ns>_menu_..` opcode in the string table is a plain field on the
block itself. Predicted for `AXIS`, then confirmed independently for `STOP` on both the
movement and per-motor variants, and for `UNIT`. This is now the rule the emitter
applies when a shape has not been individually observed, and it is still a prediction
rather than a licence: V9 requires observation before shipping.

### Observed but not yet confirmed

Two things did not behave as specified. Both are settled by the resave diff, and
neither is promoted to a finding until then.

- **Block comments did not render.** Probe A attached a comment to the hat block and no
  balloon appeared. Either SPIKE 3 drops comments on import or it has no comment UI. The
  design response does not depend on which: see the explainability note below.
- **Top-level `x`/`y` were not honored as given.** Probe A placed its two stacks 280px
  apart vertically; the app rendered them side by side. The app appears to arrange.
  Layout is therefore not a lever the emitter can pull for readability.

### Unknowns, remaining

1. **`mutation.warp` survival.** The probes emit `warp: "false"`. If the app rewrites it
   to true on save, control loops inside a My Block stop yielding and the toolkit
   architecture changes before Phase 1 starts. Settled by the resave diff. This is now
   the only unknown that can still force a redesign.
2. **Whether comments are dropped on import or unsupported entirely.** Settled by
   whether the resaved file carries a populated or empty `comments` map.
3. **What coordinates the app writes back**, which tells us whether it repositions on
   import or on save.
4. **Whether the app honors `slotIndex` on a dropped file,** or assigns slots itself.
   Determines whether the generator can preassign runs to slots.
5. **Whether the app dedupes or overwrites on a repeated manifest `id`.** Governs how
   aggressive the regenerate-all guard has to be.
6. **Web Share API file payloads on the students' iPadOS version.** Ergonomics only; the
   documented drag path is the fallback.

### Phase 0 exit criteria

A two-block hello-world `.llsp3`, produced by the emitter rather than by hand, opens in
the SPIKE App, downloads to a hub slot, and runs. Reported by naming the file, the app
version, the hub, and the slot, not by asserting that it worked.

---

## Delivery path

Established 2026-08-25. Students run the SPIKE App on iPad and laptop. This section
governs how a generated file reaches the app, and it is a first-class part of Phase 1
rather than a detail to solve later.

**Import on every supported platform is a filesystem drop, not an in-app import
dialog.** The SPIKE App reads a known folder and shows whatever is in it as a project.

| Platform | Folder | Status |
|---|---|---|
| iPad | `On My iPad / Spike / LEGO Education SPIKE/` via the Files app | Documented. **Primary device** |
| Windows laptop | Folder location not yet established. Proven 2026-08-25 by probes opening | Backup device |
| Mac | `~/Library/Containers/Spike/Data/Documents/LEGO Education SPIKE/` | Documented, not in use |
| Chromebook | **No documented import path.** The Chromebook build does not store projects in a standard location and exposes export only | Would break. Not in use |

**Chromebook is the one platform where this feature does not work.** That is not a
problem today and it is a constraint on any future fleet decision. Record it before
someone buys Chromebooks.

### Consequences of import being a folder drop

This is better than an import dialog in three ways and riskier in one.

- **Batch delivery is native.** A team regenerating fifteen runs drops fifteen files in
  one transfer and the app picks all of them up. The emitter should ship a set, not a
  file at a time.
- **Slots can be preassigned.** `slotIndex` is set at generation time, so run 1 lands in
  slot 1 without a student choosing. Whether the app honors a dropped file's
  `slotIndex` is untested and is listed below.
- **The plan in Supabase becomes the backup.** Prime Lessons warns that teams lose
  months of work every year to a dead device, because projects live only on the device.
  Here the plan is the source of truth and any device regenerates from it. This is a
  real secondary benefit and worth saying to the teams out loud.
- **The risk: a regenerate-all can collide with student work.** The app is reading a
  shared folder that also holds everything the students made by hand.

### Rules this establishes

- **Every emitted file carries a unique manifest `id`.** Ids are generated per file,
  never derived from the run number, because two files sharing an id in one folder is
  undefined behavior.
- **Filenames and project names are namespaced** so a regenerate can never overwrite a
  project a student created by hand. The manifest `name` drives the in-app display and
  the filename drives the filesystem, so both are set and both match.
- **A regenerate replaces only files the app itself previously emitted**, tracked
  through `codegen_artifacts`.

### iPad transfer, proposed

**iPad is the primary device and Windows laptops are the backup**, so iPad ergonomics
are not a nice-to-have. They are the feature's real interface, and a transfer path that
works but frustrates a twelve-year-old will simply not get used.

The documented restore path is a drag from one Files app location to another while
holding the file, across an expanding sidebar. That is awkward for an adult and worse
for a twelve-year-old on a deadline.

The proposed path instead uses the Web Share API from the `fll-app` PWA:
generate, tap share, choose Save to Files, pick the SPIKE folder. iOS remembers recent
destinations, so after the first time it is three taps. For a full set, emit a single
zip; the Files app uncompresses natively on a long press, so a team's whole run set
lands in the folder in one operation.

**Web Share with file payloads on the iPadOS Safari version the teams run is
unverified** and is the first thing to test in Phase 1. The documented drag path is the
fallback and works today, so this is an ergonomics improvement rather than a dependency.

The Windows folder location is unestablished. It matters less now that laptops are the
backup path, but it is cheap to record the next time someone is at a laptop.

## The technique standard

Sixteen normative requirements. The compiler enforces every one of them structurally,
so that correctness is a property of generated output rather than of a student
remembering. Each is stated with the failure it prevents, because a rule without its
reason gets removed by a future session that does not know what it was protecting.

### Navigation

**T1. Absolute headings, never relative turns.** All turns target a heading measured
from a single reference established at run start. Prevents the error accumulation that
makes any run past two turns unrepeatable.

**T2. Angle wrap on every heading comparison.** Yaw reports -180 to 180. Error is
computed as `((target - current + 180) mod 360) - 180`. Scratch `mod` returns a
non-negative result for a positive divisor, so this expression is correct as written in
word blocks. Prevents the robot spinning 270 degrees the wrong way, which is a
once-per-tournament failure for teams that skip it.

**T3. Proportional turn with a settle window.** Turn speed is proportional to heading
error, floored at a minimum that beats static friction, and the exit requires the error
inside tolerance across several consecutive checks or a timeout. Prevents overshoot: a
commanded 90 degree pivot turns approximately 102 degrees at 50% speed on a standard
driving base, from sensor read latency plus momentum. A fixed fudge factor is not an
acceptable substitute because it is speed-dependent and battery-dependent.

**T4. Gyro-corrected straight drive.** Straight motion loops on per-side speed derived
from heading error rather than issuing a single move-for-distance block, because the
built-in distance block applies no heading correction.

**T5. Distance in motor degrees, computed at generation time.**
`degrees = (distance_mm / (pi * wheel_diameter_mm)) * 360 * gear_ratio`, evaluated by
the compiler and emitted as a literal integer. The `set 1 rotation to X cm moved` block
is a single global calibration that silently becomes wrong the moment a gear changes.

### Re-referencing

**T6. Wall square followed by a heading-frame reset.** Press into a known wall at low
power, then re-zero. This clears accumulated gyro and odometry error mid-run and is the
highest-value reliability technique available on this platform. See the heading frame
section for the bookkeeping the compiler performs.

**T7. Two-sensor line square with a refinement pass.** Stop each drive motor when its
own sensor sees the line, then repeat the sequence looking for white. One pass leaves
the robot angled if it arrived angled; the second pass is what actually squares it.

**T8. Reflected light normalization.** Per-sensor white and black references are
captured during calibration and the compiler emits
`normalized = (raw - black) / (white - black) * 100`. The line-follow target is then 50
in normalized space regardless of venue lighting. Prevents the classic failure where a
line follower tuned in the classroom does not work under tournament lights.

### Motion quality

**T9. Explicit acceleration on every move.** Movement acceleration defaults are Fast
10000, Medium 1800, Slow 1000; motor defaults are Fast 10000, Medium 2000 for the small
motor and 4000 for medium and large, Slow 1000. Ramping eliminates launch wheel slip,
which corrupts heading in the first ten centimeters of every run. The custom form takes
two values in one variable as a space-separated string, a quirk the compiler handles by
construction.

**T10. Explicit stop method on every move.** Coast to let the robot settle against a
model, hold when the following action depends on position, brake otherwise. Never left
implicit.

**T11. Speed blocks, never power blocks,** for any motion whose distance or heading
matters. Speed is regulated against battery droop; power is not. This is why a run that
worked at full charge fails at half charge.

### Robustness

**T12. A timeout on every sensor wait.** Emitted as `repeat until <condition> or <timer
greater than limit>`. See Hard Rules.

**T13. Settling wait after a yaw reset.** SPIKE 3 continues past `set yaw angle to 0`
before the reset lands, so a following heading comparison can read the pre-reset value.
Emitted as a short fixed wait or a wait-until-near-zero after every reset.

**T14. Identical preamble and postamble in every program.** Preamble: set movement
motors, movement speed, acceleration, stop method, reset relative motor positions,
reset yaw, settling wait, reset timer, initialize heading offset, write the run number
to the 5x5 matrix. Postamble: stop moving, display a completion glyph. Roughly ten
blocks that must be byte-identical across every program in the set. Hand-copying this
across fifteen projects is exactly where teams introduce divergence they cannot find.

**T15. Parallel attachment tasks.** Attachment motion that can overlap driving is
emitted as a broadcast-triggered stack with an explicit resynchronization variable, not
as a serial step. Overlap is where match time is recovered.

**T17. Yaw axis set explicitly in the preamble.** `set yaw axis to {UP}` is emitted from
the hub orientation recorded in `robot_configs`. Prevents the failure where a
side-mounted or upright hub reports rotation on the wrong axis and every heading in the
run is meaningless.

**T16. A pre-match gyro drift check program.** Generated once per team. Displays a
distinguishable glyph if yaw is changing while the robot is stationary, signaling that
the hub needs a reboot before the match. Occupies its own slot.

---

## The My Block toolkit

Eight custom blocks, inlined into every generated project.

### Why ports are baked rather than parameterized

**Correction, 2026-08-25.** Version 1.0 of this file stated that port selectors are
fields and therefore cannot be driven by a My Block parameter. That is wrong. The
export shows selectors are shadow blocks occupying input slots, and a Scratch input
slot holding a shadow can be obscured by a reporter using input type 3. Whether the
SPIKE VM honors an argument reporter in that position is untested and is not currently
worth testing.

Ports stay baked anyway, for a better reason than the wrong one:

**A generated program a student cannot edit in the app without breaking it is a bad
program.** The SPIKE editor renders these selectors as custom dropdown widgets and does
not offer a drop target for a reporter. A file constructed with a shape the editor
cannot itself produce may render oddly, may be silently rewritten on save, and cannot be
modified by the student. Since the whole point of the feature is that students own,
read, and iterate on the output, the emitter restricts itself to shapes the editor can
produce natively.

The compiler therefore reads ports from `robot_configs` and emits fixed-port block
variants: `RUN MOTOR C`, `RUN MOTOR D`, and so on, only for ports the robot has. Same
for color sensor ports in the line-following and squaring blocks. This is only possible
because configuration is known at generation time.

**Standing rule this establishes:** the emitter emits only block shapes observed in a
file the SPIKE App itself wrote. Any novel shape is proven by round-tripping it through
the app before it enters the toolkit.

### The heading frame and `hdg_offset`

SPIKE provides `set yaw angle to 0` and no block that sets yaw to an arbitrary value.
A wall square therefore cannot restore the field heading directly.

The compiler maintains a variable `hdg_offset` holding the field heading that local
zero currently corresponds to. On a wall square against a wall whose field heading is
known, the compiler emits a yaw reset and sets `hdg_offset` to that wall's field
heading. Every subsequent `TURN TO (field heading)` compiles to a local target of
`field_heading - hdg_offset`, wrapped per T2.

Students author in field headings throughout and never see the frame change. This
bookkeeping is precisely the class of work a middle-school team will not do by hand and
a compiler does for free.

### Block signatures

Inputs shown in parentheses. All headings are field headings. All distances are
millimetres. All speeds are percentages.

| Block | Inputs | Behavior |
|---|---|---|
| `START RUN` | run number, base speed | T14 preamble, sets `hdg_offset` to 0 |
| `TURN TO` | heading, speed | T1, T2, T3, T12 |
| `DRIVE` | distance, speed, heading | T4, T5, T9, T10, T12 |
| `DRIVE TO LINE` | max distance, speed, heading, threshold | T4, T8, T12; exits on crossing or max distance |
| `SQUARE ON LINE` | speed | T7, T12 |
| `SQUARE ON WALL` | wall heading, power, seconds | T6, T13; rewrites `hdg_offset` |
| `FOLLOW LINE` | distance, speed, side | T8, T12; PD control, per-sensor variant |
| `RUN MOTOR <port>` | degrees, speed | T10, T12; one variant per configured port |

**On PID.** The toolkit uses PD for line following and P with a settle window for
turning. Full PID is not used. Integral windup over the short segments an FLL run
actually contains does more harm than the term corrects, and an untunable third
constant in the hands of a twelve-year-old is a liability. This is a deliberate
departure from the common tutorial and is recorded here so a later session does not
"fix" it.

---

## Round 2 results and the escalation rule

**Confirmed 2026-08-25.** Four of six opened. Registry now holds 57 verified shapes.

- **R1 proves T12 is implementable.** `repeat until <(E reflected light) < 40 or (timer)
  > 3>` renders, so boolean nests into boolean and the timeout pattern that the hard rule
  demands on every sensor wait has a working form. This was the highest-consequence
  unknown left, because T12 is a rule with no exceptions and until now no proven
  implementation.
- **R4** confirmed `control_wait_until` and `flippersensors_isReflectivity`, with
  `COMPARATOR` following the plain-field pattern, now four for four.
- **R5** swept the remaining operators: divide, round, not, equals, and, plus
  `control_repeat` and `control_if`.
- **R6** confirmed the power-button run indicator.

**R2 and R3 failed whole-file, and the reason I cannot say which block is at fault is my
own error.** The v1.5 rule says a probe tests exactly one unverified shape. R2 carried
four and R3 carried three. Writing a rule down does not enforce it; the generator script
must, and it now reports the count of new shapes per file so the violation is visible
before delivery rather than after.

R3 did narrow anyway, from three candidates to two, because R4 independently confirmed
`control_wait_until`. That was luck from overlapping coverage, not design, and it is the
argument for building probes so their coverage overlaps deliberately.

### The escalation rule

The field pattern was predicted, then held four times. On the fifth and sixth
applications it produced two unopenable files. **When a pattern-based inference fails,
stop inferring and read the app's own output.**

Binary-searching enum values across probe rounds is the wrong instrument once the
pattern is in doubt: each round costs a full exchange and only ever confirms or denies
one guess. A project built by hand in the SPIKE App and exported gives exact JSON for
every block in it at once, and it is the same effort as opening one probe.

Applied here: the six blocking shapes are resolved by one hand-built export rather than
six more probes. Probes remain the right instrument for confirming a shape the emitter
produced. They are the wrong instrument for discovering a shape it has never seen.

## Extensions

Established 2026-08-25 from the SPIKE App extension picker, which is authoritative for
what namespaces this app has.

### Root cause of the Probe C failure, corrected

v1.5 recorded the fault as using a ported block for the hub matrix. That was the symptom.
**The cause is that the opcode table this project derived shapes from spans several LEGO
products, and was treated as the SPIKE Prime vocabulary.** It carries `ev3*`,
`horizontal*`, and `flipperdisplay_*`, none of which exist in this app.

`flipperdisplay_*` is the parallel of `flipperlight_*` for a different product. The
picker's "Display" extension is `displaymonitor_*`, on-screen images and text, and is
unrelated. Reaching into `flipperdisplay_*` was not a wrong block choice within a valid
namespace; it was a block from software the students do not run.

**The exclusion list now lives in the registry** under `_meta.namespaces.NOT_IN_THIS_APP`
and V9 rejects any opcode in it. A wrong shape inside a real namespace is one dead file;
a whole phantom namespace would have produced them indefinitely.

### The tether test

This is the organizing question for which extensions may appear where. A hub in a match
is untethered, so **a block that renders on the connected device does nothing during a
run.**

| Extension | Namespace | Runs on hub | Use |
|---|---|---|---|
| More Motors | `flippermoremotor` | Yes | **Required.** Relative position, stop method, acceleration, stall detection |
| More Movement | `flippermoremove` | Yes | **Required.** `startDualSpeed` underpins every gyro-corrected drive and proportional turn |
| More Sensors | `flippermoresensors` | Yes | **Required.** See below |
| Line Graph | `linegraphmonitor` | No, tethered | Tuning programs only |
| Bar Graph | `bargraphmonitor` | No, tethered | Tuning programs only |
| Display | `displaymonitor` | No, tethered | Tuning programs only |
| Music | `flippermusic` | No, tethered | Never. `flippersound_beep` is core and works on the hub |
| Weather Manager | `weather` | No, needs internet | **Never.** A network dependency inside a competition program is a liability |

### More Sensors is promoted to required

v1.7 dismissed this extension. That was wrong, and three of its blocks matter:

- **`set yaw axis to {UP}`** selects which physical axis counts as yaw. FLL robots
  routinely mount the hub on its side or upright, and without this the gyro reports the
  wrong axis and every heading in T1 and T2 is meaningless. **This belongs in the T14
  preamble** and its absence would have been a subtle, hard-to-diagnose failure on any
  robot without a flat-mounted hub.
- **`angular velocity {AXIS}`** gives turn rate, which makes the T3 settle window far
  more reliable: a robot at the target heading and still rotating is not settled, and
  position alone cannot tell you that.
- **`{PORT} raw {COLOR}`** gives raw channel values, a better discriminator than
  reflected light on mats where two colors reflect alike.

### Tuning programs, a new artifact class

This is where the tethered extensions earn their place, and it is the right answer to
using the whole toolset rather than restricting it.

A tuning program runs with the hub connected to the device, at the practice table, and
plots what the robot is doing while it does it. Line Graph makes two things possible
that teams currently do by guesswork:

- **Threshold picking.** Drive slowly across the mat plotting reflected light, then read
  the white and black references straight off the graph instead of sampling by hand.
  This feeds the T8 calibration directly.
- **Turn tuning.** Plot heading error against time through a `TURN TO` and see the
  overshoot, the oscillation, and the settle, instead of inferring them from where the
  robot ended up.

Generated in Phase 2 alongside the calibration capture, as a separate artifact class
from run programs, and never mixed with them.

### Minimal declaration in run programs

A run program declares only the namespaces its blocks use. This is a robustness
property, not conservatism: every declared extension is another thing that must be
present on the device the file is opened on, and the failure mode is the whole file
refusing to open with no diagnostic.

## Independent validation, and why nothing further is needed to start

**2026-08-25.** Nine word-block projects authored in the SPIKE App by an unrelated
third party were located and mined. Registry is at 70 shapes.

**Twenty-four shapes appear in both my registry and those files, and there is not a
single disagreement.** Every field name, every shadow opcode, every enum value matches.
That is external validation of the whole approach against work no one here produced,
and it is stronger than any number of additional probes.

Thirteen further shapes were harvested at zero cost, including `control_forever`,
`flippermotor_motorSetSpeed`, `flippermove_startMove`, `flippermove_startSteer`,
`flippersensors_isColor`, `flippersensors_isDistance`, and `flipperevents_whenButton`
with `BUTTON` and `EVENT` as plain fields, which is the shape a run-selection menu would
need.

The real files also declare `flippersensors` and `flippersound` in the `extensions`
array even though the picker lists both as core. So the array is Scratch VM extension
ids, not the optional-extension set, and the emitter's rule of declaring every `flipper*`
namespace it uses matches what the app itself writes.

### Provenance tiers

The registry now records how each shape was established, because the two kinds of
evidence are not equal.

- **Tier A, app-authored.** Read from a project the SPIKE App itself wrote. Proves the
  app *produces* the shape, so field names and enum values are exact rather than merely
  tolerated. 24 shapes.
- **Tier B, probe-confirmed.** The emitter wrote it and the app opened and rendered it.
  Proves the app *accepts* it. 46 shapes.

Both are verified and both satisfy V9. Tier A is the better evidence where an enum value
is in question, and is the reason the escalation rule in v1.7 prefers an export to
another probe round.

### The six unproven shapes do not block Phase 1

v1.7 filed them as `unverified_blocking`. **That was overstated.** Walking the eight
toolkit blocks against the registry:

| Toolkit block | Status |
|---|---|
| `START RUN` | Verified shapes only |
| `TURN TO` | Verified. Proven whole by Probe D |
| `DRIVE` | Verified |
| `DRIVE TO LINE` | Verified |
| `SQUARE ON LINE` | Verified. Per-side stop via `startDualSpeed` at 0 |
| `SQUARE ON WALL` | Verified in its timed-press form. Only the stall variant needs the unproven shapes |
| `FOLLOW LINE` | Verified |
| `RUN MOTOR` | Verified via `motorTurnForDirection` |

**Every Phase 1 deliverable is buildable today on verified shapes.** The six affect T15
parallel tasks, which belongs to the Phase 2 compiler, and the stall variant of T6,
which is an improvement on something that already works. They are now filed as
`unverified_deferred` with the verified alternative named for each, and they get resolved
opportunistically rather than by scheduling another round of manual testing.

## The verified-shapes registry

`FLL_VERIFIED_SHAPES.json` holds every opcode, field name, and shadow shape that has
been **observed rendering in the real SPIKE App**, with the probe that proved it. 44
shapes as of 2026-08-25.

It stands in the same relation to this file as `IDEA_DS_DIGEST.md` does to the design
standard. **Evidence, not authority.** It records what is true of the app; this document
records what the emitter must do. Where they disagree about a rule, this file governs.
Where they disagree about whether a shape works, the registry governs and this file is
corrected.

Rules:

- A shape enters the registry only when it has been seen rendering. Never when it has
  been reasoned about, however good the reasoning. The field pattern predicted `STOP`,
  `UNIT`, and `COMPARATOR` correctly and then failed twice, which is exactly why
  prediction never enters the registry.
- The registry carries an `unverified_deferred` list. A shape on it is known to be
  needed and known not to be proven, which is a different state from absent and must not
  be allowed to look like one. Each entry names the verified alternative that covers the
  gap until it is resolved.
- Every shape records its provenance tier. Where a tier B shape and a tier A shape
  disagree, tier A governs.
- The registry is written by probe results, never by hand from the string table.
- **V9 fails the build if the emitter reaches for a shape outside the registry.** This
  is the check that matters most, because the SPIKE App's only diagnostic is refusing
  the entire file without saying why.

## The plan intermediate representation

A run plan is an ordered list of typed steps. It is the students' work product, the
compiler's only input besides configuration and calibration, and the source of the
notebook export.

Every step carries a required `note` string written by a student. The compiler refuses
a plan containing an empty note.

### Step types

| Type | Fields |
|---|---|
| `drive` | `mm`, `speed`, `heading` |
| `turn_to` | `heading`, `speed` |
| `drive_to_line` | `max_mm`, `speed`, `heading`, `sensor` |
| `follow_line` | `mm`, `speed`, `side`, `sensor` |
| `square_line` | `speed` |
| `square_wall` | `field_heading`, `power`, `seconds` |
| `motor` | `port`, `degrees`, `speed`, `stop` |
| `motor_until_stall` | `port`, `speed`, `timeout` |
| `wait` | `seconds` |
| `parallel` | `drive_branch[]`, `attachment_branch[]` |

`start_run` and `end_run` are implicit and are not authorable. A student cannot omit
the preamble, and cannot add anything before it.

### Compiler responsibilities

Given a plan, a `robot_config`, and a `calibration`, the compiler:

1. Resolves every distance to motor degrees per T5 and emits a literal integer.
2. Tracks `hdg_offset` across the plan and rewrites every field heading to a local
   target, wrapped per T2.
3. Injects a timeout on every wait per T12, with the limit derived from the step's own
   distance or angle rather than a global constant.
4. Emits acceleration and stop method per step per T9 and T10.
5. Emits a yaw reset plus settling wait per T13 only where the frame actually changes.
6. Bakes calibration constants per T8.
7. Expands `parallel` into a broadcast stack plus a resynchronization variable per T15.
8. Carries each step's student note into the notebook export. It does not attach it as
   a Scratch comment, because comments do not survive import.
9. Emits the T14 preamble and postamble.
10. Emits only the fixed-port block variants the configuration requires.

### Advisory checks, surfaced but not blocking

- A plan that travels beyond a configured distance threshold with no `square_wall` or
  `square_line` is flagged as unreferenced. Long unreferenced runs are the most common
  reason a run that works on the practice table fails on the competition table.
- A plan whose estimated duration exceeds the match budget is flagged with the estimate.

These warn. They never edit the plan and never insert a step. Inserting a re-reference
the student did not author would be the app making a strategy decision, which is
forbidden.

---

## Data model

Four tables in the existing `fll-app` Supabase project, scoped to team by RLS
consistent with the schema already in place.

| Table | Contents |
|---|---|
| `robot_configs` | wheel diameter, track width, gear ratio, drive motor ports and polarity, attachment motor ports, color sensor ports and side assignment, hub yaw axis orientation |
| `calibrations` | per team per sensor: white reference, black reference, captured timestamp, venue label |
| `run_plans` | team, run number, target slot, ordered steps as JSON, per-step notes, author, revision history |
| `codegen_artifacts` | generated file hash, emitter version, config and calibration ids used, timestamp |

`codegen_artifacts` exists so that a program on a hub can be traced back to the exact
configuration, calibration, and emitter version that produced it. Without it, a run
that behaves differently than the plan predicts is undiagnosable.

**Migrations are main-only** and follow the established path: created and proven
locally against seeded data, then applied by hand through the SQL editor. The stack
occupancy check runs first, since `fll-app-sk` and `idea-app` have been observed
running local stacks side by side.

---

## The emitter

Runs client-side in the browser. SvelteKit already ships the surface; the emitter needs
a zip writer and a JSON builder and nothing else. No edge function, no server
round-trip, no queue.

Structure:

- `blocks.ts` - typed constructors for each opcode used, producing correctly shaped
  `inputs`, `fields`, `shadow` entries, and id linkage. Nothing elsewhere hand-writes a
  block object.
- **`parent` links are derived structurally in a final normalization pass, never
  tracked by hand.** Established 2026-08-25 when hand-tracked parents produced three
  reporters whose `parent` disagreed with the input holding them, in a file that was
  otherwise well-formed. Ownership is already recorded in `inputs` and `next`; deriving
  from it cannot drift, and maintaining it separately provably does. The same pass
  computes the `extensions` arrays from the opcodes actually used.
- `toolkit.ts` - the eight My Block definitions as generator functions parameterized by
  `robot_config`.
- `compile.ts` - plan plus config plus calibration to a `project.json`.
- `package.ts` - `project.json` to `scratch.sb3` to `.llsp3`, against the Phase 0
  locked manifest.
- `decode.ts` - the reverse path, used only by the validator.

`decode.ts` is not a feature. It exists so the validator can prove a round trip rather
than assert one.

---

## The validator

Every guard ships with a negative control that breaks the thing and confirms the guard
catches it. Where a guard could plausibly fire on correct output, it also ships with a
positive control that makes a legal change and requires the guard to stay silent. A
guard that has never failed has not been tested, and a guard that fires on legitimate
work gets deleted.

| Check | What it proves |
|---|---|
| V1 | Every emitted wait has a timeout companion |
| V2 | Every heading resolves to a local target within -180 to 180 after offset |
| V3 | Every distance resolves to an integer degree count within motor range |
| V4 | Every referenced port exists in `robot_config` |
| V5 | Calibration exists and white exceeds black by the minimum margin |
| V6 | Block ids unique; every `next` and `parent` link resolves; every input-held block's `parent` is the block holding it; no block unreachable from a top-level block |
| V7 | Emitted `project.json` decodes back to block text matching the plan |
| V9 | Every opcode, field name, and shadow shape used appears in the verified-shapes registry |
| V10 | Each technique with a checkable structural signature is present in the emitted blocks |
| V11 | No two top-level stacks' bounding boxes intersect. Layout is single-column, so this degenerates to a vertical-gap check |
| V8 | The zip opens and the manifest matches the Phase 0 locked reference |

V7 is the load-bearing one. It is the only check that compares what was emitted against
what was intended rather than against the emitter's own beliefs.

V9 exists because the SPIKE App fails whole-file with no diagnostic. The registry holds
only shapes observed rendering in the real app, and an emitter that reaches for anything
outside it fails the build rather than shipping a file that cannot be opened.

**Naming what runs these is part of writing them.** `fll-app` already carries a test
suite; these run in it, and the suite runs in CI. A test that only executes when a
person remembers to run it is documentation, not a control, and the deploy path here
publishes on push.

---

## Student authoring surface

Students author plans directly. Mentors view and comment. The plan belongs to the
student who wrote it.

Requirements specific to this surface. Everything else defers to
`IDEA_INTERFACE_STANDARDS.md`, which is read in full before the surface prompt is
written.

- **The plan builder is a list of plain-language rows, not a code editor.** The
  audience is ages 9 to 16.
- **Arithmetic is shown, never hidden.** A `drive 300mm` row displays that it compiles
  to 614 motor degrees. The point of the tool is to remove the tedium of the
  calculation, not to conceal that a calculation happened. A student who cannot see the
  number cannot explain it to a judge.
- **The note field is required and blocks compilation when empty.** It is a first-class
  input, not a comment affordance tucked behind a disclosure.
- **A "what this block does" panel is available for every toolkit block,** written at
  the reading level of the youngest team member, not paraphrased from this document.
- **Nothing is prefilled.** No default steps, no starter plan, no template run.
- **Regenerate-all is one action.** Changing a configuration or a calibration marks
  every affected plan stale and offers to re-emit the whole set. This is the property
  that makes baked constants correct rather than brittle.

---

## Judging and Core Values

The Robot Design rubric anticipates external coding resources and rewards their use.
IDENTIFY credits a team for having explored building and coding resources and sought
guidance as needed. CREATE credits developing original designs or improving on existing
ones according to the team's own mission strategy. Judges dock wholesale copying of an
entire robot plus attachments plus programs; sourced components with honest attribution
are accepted practice.

The generator sits inside that allowance provided three things hold, and the design
enforces all three:

1. **The team authored the strategy.** Guaranteed structurally: the app generates no
   plan content.
2. **The team can explain the code.** Enforced by the required note per step, by the
   notebook export, and by the visible arithmetic.

   **Revised 2026-08-25.** v1.0 and v1.1 put in-file block comments at the centre of
   this. Probe A showed comments do not render, so the vehicle moves app-side. The
   notebook export is now primary rather than a convenience, and **toolkit block names
   have to carry their own meaning**, because the block name is the only explanation
   that travels with the file. `TURN TO` and `DRIVE TO LINE` are readable at a glance;
   an abbreviation like the probe's `DRIVEROT` is not, and names of that shape are
   rejected. Proccode label text interleaves with inputs, so
   `TURN TO %s AT %s SPEED` renders as a legible sentence.
3. **The team attributes the resource.** Every generated project carries an attribution
   line, and the notebook export names the tool.

**The notebook export** assembles a run-by-run page from the student's own notes plus
the toolkit explanations plus the attribution line. It feeds the Robot Design
explanation directly. It is generated from the plan, never from the code, because the
plan is what the student wrote.

If a student cannot explain what `TURN TO` does, that is a coaching gap the app should
make visible rather than paper over. The explanation panel exists for that reason.

---

## Phase 1 emitter, built 2026-08-25

Written in TypeScript, the real target language, so it transcribes into
`src/lib/codegen/` rather than being rewritten. `blocks.ts` (constructors, structural
normalization), `toolkit.ts` (the eight My Blocks), `package.ts` (zip and validator),
`main.ts`, `negcontrol.ts`.

Output: **`FLL_Toolkit_v1.llsp3`, 320 blocks, 8.5 KB, nine My Blocks** including a
per-port `RUN MOTOR` variant for each configured attachment motor. Emitted from a
`RobotConfig` of 56 mm wheels, 1:1 gearing, pair AB, attachments C and D, color sensors
E and F, and a calibration of white 95 black 12. Changing the config regenerates
everything; 300 mm resolves to 614 motor degrees.

### Two defects the validator caught on its first run

**A reporter subtree reused at two sites gets two parents, which is invalid in
Scratch.** The proportional term in `TURN TO` and the two darkness tests in
`SQUARE ON LINE` were each built once and referenced twice. The file would very likely
have been refused with no diagnostic. Every use site now builds its own subtree, and
that is a rule for the emitter: **reporters are constructed per use, never shared.**

**T17 was emitted from unverified shapes and V9 refused it.** This is the check working
exactly as designed, on the very first thing that tried to bypass it, one turn after
T17 was added to the preamble in v1.8. The toolkit now omits it, and
`flippermoresensors_setOrientation` is filed as deferred with the consequence recorded:
a robot whose hub is not flat-mounted is unsupported until that shape is verified. That
gap is stated rather than silently papered over.

### Phase 1 gate met, and what the review of the output found

**All nine My Blocks rendered in the SPIKE App, 2026-08-25.** The Phase 1 gate is met at
the file level: a config in, a working toolkit out.

Reading the rendered output found two defects a clean validator run had not.

**The T3 speed floor was missing.** It was specified, built, and then silently deleted
while fixing the shared-subtree defect, because the floor logic lived in the same lines
as the reused reporter. Consequence in the field: a turn arriving within a few degrees
commands a speed too low to overcome static friction, so the robot stops short and sits
there until the 4-second timeout. It would have looked like a tuning problem forever.
Reinstated with a cap as well, since a 180 degree error otherwise commands 216 percent.

**Distance was measured from the left motor alone.** Under heading correction the two
sides always travel different distances, so one motor misreports path length on every
`DRIVE`, `DRIVE TO LINE`, and `FOLLOW LINE`. Now the mean of both, with both zeroed at
entry.

### Layout, and V11

The second render of the toolkit came back **unreadable**: nine stacks overlapping in a
single column, each drawn on top of the next. Two consequences, and the second is the
one that matters.

The stated one: readability is a requirement here, not a nicety. The explainability case
rests on a student opening the output and reading it, and on a judge being shown it. An
overlapping workspace fails that outright.

The unstated one: **it also made the output impossible to audit.** I could not confirm
the T3 floor guards had landed, because `DRIVE` was drawn over `TURN TO`. A defect in
presentation had become a defect in verifiability.

Cause: stack positions were hand-guessed constants. They were adequate at 320 blocks and
collided at 360, because a stack's height is not knowable until it exists. `layout.ts`
now **measures** each stack, walking the `next` chain and recursing through `SUBSTACK`
and `SUBSTACK2`, then fills a grid column by column, shortest column first. V11 asserts
no two top-level bounding boxes intersect.

**Coordinates are honored. Confirmed 2026-08-25**, three columns rendering as placed.
This also retires the v1.0 observation that the app auto-arranges: it does not, and the
earlier single-column render was the app faithfully drawing bad coordinates. `split.ts`
is unnecessary and stays a stub.

### The width model was wrong, and V11 passed anyway

The three-column render was readable but **still overlapped**: `SQUARE ON LINE` ran into
the `TURN TO` column while V11 reported clean.

The check was correct; its inputs were not. Width was modelled as nesting depth times a
constant, and it underestimated by roughly a third, because **a row grows with the
breadth of its operand tree, not its depth**. `a < b and c < d or timer > n` is shallow
and enormously wide, and that is the exact shape of every T12 timeout condition in the
toolkit, so the error was concentrated precisely where the rows are widest.

Width is now the recursive sum of a block's own label plus each operand, with a 15
percent margin because the model estimates what the app's renderer does rather than
measuring it. Column count drops automatically when the widest stack exceeds a sane
canvas, which took the toolkit from three columns to two.

**The general lesson is worth more than the fix.** V11 was a correct check reasoning over
a wrong model, and it returned confident and wrong, which is worse than having no check:
a clean run on bad measurements bought false confidence and I stopped looking. A guard's
inputs need validating as much as its logic.

### Single column, and why estimating was the wrong move twice

The two-column render was measurable. At a scale of 0.315 the heights came back **5 to 8
percent short on every stack containing a C-block**, absorbed by the row gap with almost
nothing to spare. Second model, same direction of error.

It also exposed a worse problem than crowding. Filling the shortest column **scrambles
reading order**, and it had exiled `TURN TO`, the second block anyone needs, to a column
three thousand units off screen where nobody would find it.

Layout is now **one column in definition order**, with constants recalibrated from the
measurement and both models carrying explicit margins.

The reason to prefer this is not that the numbers are better. It is that column width
depends on the width model, which cannot be validated from here, so **every layout bug
kept re-presenting as a width-estimate bug**. One column removes the dependency instead
of tuning it: vertical scrolling is the natural gesture, definition order is preserved,
and horizontal overlap becomes impossible rather than merely unlikely. When a model
cannot be validated, the move is to stop depending on its accuracy, not to keep
sharpening it.

### Layout closed, and the bug it was hiding

Single-column layout rendered with generous gaps in definition order. **Layout is
closed.** More to the point, `TURN TO` was legible for the first time, and reading it
found a logic defect that four earlier renders had concealed.

**The speed floor was applied unconditionally, including inside the settle window.** A
robot within 2 degrees of target computes a power of at most 2.4 percent, the floor
raises that to 15, and the robot is driven at 15 percent while it is supposed to be
settling. It gets knocked back outside tolerance, `_settled` resets to zero, and the turn
oscillates until the 4 second timeout instead of finishing. **Every turn in every run,
4 seconds long.**

This is the same requirement that was deleted in v1.10 and reinstated in v1.11. Correct
both times about needing a floor, wrong both times about where it belongs. The floor
exists to break static friction *on approach*; during settle the correct command is zero.
The power calculation now lives entirely inside the out-of-tolerance branch, and the
in-tolerance branch commands zero. V10 gained a check that the floor is reachable only
through an else arm.

**Straight-line heading correction was uncapped.** A large error, from a bump or a bad
start heading, produces a correction larger than the base speed, which reverses one side
and spins the robot instead of recovering. Now clamped to 30.

Also removed: a dead `set _err` before the turn loop, which the loop recomputed before
any read.

### Two notes on the checks themselves

The first version of the floor-placement check **fired on all three positive controls**.
It matched any guard reading `_mag`, which included the straight-drive correction clamp,
where being unconditional is correct. Narrowed to identify the guard by what it *writes*.
Recorded because this is the second time in this build that a check's inputs were wrong
rather than its logic, and because a check that fires on correct work gets deleted, which
would have cost the guard entirely.

Worth stating plainly: **four consecutive defects in this toolkit were found by looking at
renders, not by the validator.** The validator has never once been the thing that caught a
logic error first. It catches regressions of defects already found. That is genuinely
valuable and it is not the same as verification, and the gap is exactly the class of
error that only shows up when a person reads the output.

### The settle fix confirmed, and a self-test

The corrected `TURN TO` rendered as intended: `set _pwr to 0` in the tolerance branch,
the whole power calculation inside the else, dead pre-loop assignment gone.

**`FLL_Toolkit_SelfTest.llsp3`** is the toolkit plus a program the hub runs and grades
itself, so the next verification costs one download instead of a reading session. Slot
18, 466 blocks.

Four graded turns: 90, back to 0, -90, and 179. The last is deliberate, sitting at the
wrap boundary T2 exists for.

**Each turn is graded on heading and on elapsed time, and reports which one failed.**
This is aimed squarely at the defect I got wrong twice. The oscillation bug produces a
*correct final heading* with a four second duration, because the turn reaches the target
and then rattles until the timeout. Grading only the heading would have called it a pass.
So a turn that lands but takes over three seconds reports `SLOW`, a turn that lands wrong
reports `OFF`, and only both reports `OK`.

Distance is deliberately ungraded. Nothing on the hub can measure the floor, so the last
step drives 300 mm and stops for a tape measure.

### A constraint the shared variables impose

Toolkit My Blocks share `_err`, `_mag`, `_pwr`, and `_corr`, so **they are not safe to
call from two stacks at once.** For the intended T15 use this is fine, because the
attachment blocks take only parameters and touch no shared state, so `RUN MOTOR` running
beside `DRIVE` is safe. Two movement blocks running concurrently is not, and would
corrupt both. Phase 2's parallel compiler must enforce one movement block at a time, and
this is recorded now rather than discovered when a run behaves inexplicably.

### V10, technique conformance

The floor defect passed a clean validator run, ten controls, and a visual review.
**A requirement with no assertion is a requirement that can be deleted without anything
noticing**, and it was deleted by a fix for something unrelated.

V10 asserts the structural signature of a technique in the emitted blocks: T3 must carry
both clamp guards, every T13 yaw reset must be followed by a settling wait, T5 position
reads and resets must pair across both motors, and the T14 preamble must set the movement
pair and stop method. Each technique that has a checkable shape gets one, and each ships
with a negative control that deletes it.

### Controls

Sixteen controls, all passing. Thirteen negative, each breaking the file in a specific way and
requiring its check to fire: the phantom-namespace failure that killed Probe C, an
opcode absent from the registry, a used-but-undeclared namespace, a sensor loop stripped
of its timeout, a parent disagreeing with the input holding it, a dangling reference, and
an orphan block, and four V10 cases including a replay of the exact floor deletion that
shipped in the first toolkit, and a V11 case placing two stacks at identical
coordinates. Three positive, each a legal edit that must fire nothing:
retuning a proportional constant, changing a stop method, recalibrating a light
threshold.

**The first positive control failed, and the check was right.** It swapped a whole input,
which orphaned the reporter previously there, and V6 fired. The control was wrong, not
the validator. A legal edit changes a literal in place and orphans nothing. Recorded
because a false positive is normally the signal to loosen a check, and here loosening
would have removed a correct guard.

## Phase plan and gates

Each phase has an exit gate that is observed rather than argued.

**Phase 0 - Ground truth.** Manifest and block shapes locked 2026-08-25 against a real
export. Both probes opened and rendered correctly, so the emitter path is proven at the
file level. Remaining: the resave diff for `mutation.warp`, and a download-to-hub run.
Gate: an emitter-produced file opens, downloads to a slot, and runs, reported by naming
file, app version, hub, and slot.

**Phase 1 - Configuration and toolkit.** Emitter and toolkit **built 2026-08-25** and
validated clean with ten controls passing. What remains is the `robot_configs` table and
surface in `fll-app`, which waits on the student runtime. Gate: a team's own configuration produces a toolkit file whose
`TURN TO 90` lands within tolerance on their actual robot, measured over ten trials.

This phase is useful shipped alone and delivers most of the value. If the arc stalls
anywhere, it stalls after Phase 1 and the team is still better off.

**Phase 2 - Calibration and the plan compiler.** `calibrations` and `run_plans`, the
compiler, the validator, and the student authoring surface. Gate: a student-authored
plan compiles, runs on the table, and scores its mission, with V1 through V8 green in
CI.

**Phase 3 - Explanation, notebook, and drift check.** The explanation panels, the
notebook export, the gyro drift check generator, and regenerate-all. Gate: a student
who did not write a given run can read its notebook page and explain the run.

**Sequencing.** The whole arc waits on the `fll-app` student runtime landing. The
runtime is the surface these features attach to, and building the generator against a
surface that does not exist yet would produce a second integration pass for no gain.

---

## Open items

- The seven remaining Phase 0 unknowns, all blocking, and all closed by opening two
  probe files.
- **Platform closed 2026-08-25:** iPad and laptop. Both import by folder drop and both
  work. Chromebook has no import path and would break the feature, which is a constraint
  on future hardware purchasing rather than a current problem.
- **Whether the toolkit should also emit a Python variant.** Deferred, not rejected.
  Word blocks are the stated target and the harder problem; Python would be a trivial
  addition later against the same plan IR, and building for it now would be paying for
  an abstraction whose payoff is in a season that may not exist.
- **This file is not yet referenced by the project custom instructions.** It joins the
  two markdown files already pending that update. FLL currently has no owning document
  in the routing list at all, which is the gap this file closes.

---

## Changelog

- **1.16 (2026-08-25)** - Settle fix confirmed in the render. Added
  `FLL_Toolkit_SelfTest.llsp3`, the toolkit plus a self-grading program so the next
  verification is one download rather than a reading session. Four graded turns including
  one at 179 degrees against the wrap boundary, **each graded on heading and elapsed time
  separately**, because the oscillation defect produces a correct final heading with a
  four second duration and a heading-only check would have passed it; failures report
  `SLOW` or `OFF` rather than a bare fail. Distance left ungraded since nothing on the hub
  can measure the floor. Recorded that toolkit My Blocks share scratch variables and are
  **not safe to call from two stacks at once**: attachment blocks beside a movement block
  is fine, two movement blocks is not, and Phase 2's parallel compiler must enforce it.

- **1.15 (2026-08-25)** - Single-column layout rendered cleanly; **layout is closed**.
  With `TURN TO` legible for the first time, reading it found the defect four earlier
  renders had hidden: **the speed floor was applied inside the settle window**, so a robot
  within tolerance was commanded 15 percent, knocked back out, and oscillated until the 4
  second timeout, on every turn of every run. Same requirement deleted in v1.10 and
  reinstated in v1.11, correct both times that a floor is needed and wrong both times
  about where it belongs; the power calculation now lives entirely in the
  out-of-tolerance branch and the in-tolerance branch commands zero. Also capped
  straight-line heading correction, which was uncapped and would spin the robot on a
  large error rather than recover, and removed a dead `set _err` before the turn loop.
  The new floor-placement check **fired on all three positive controls** by matching any
  guard reading `_mag`, including the correction clamp where unconditional is correct;
  narrowed to identify the guard by what it writes. Recorded that four consecutive
  defects here were found by reading renders and none by the validator, which catches
  regressions of known defects rather than new logic errors.

- **1.14 (2026-08-25)** - The two-column render was measurable at scale 0.315 and showed
  **heights running 5 to 8 percent short on every stack with a C-block**, the same
  direction of error as the width model, absorbed by the row gap with little to spare.
  It also showed that shortest-column packing **scrambles reading order**, having exiled
  `TURN TO` to a column three thousand units off screen. Constants recalibrated from the
  measurement and both models given explicit margins. Layout switched to **one column in
  definition order**, not because the estimates improved but because column width depends
  on a model that cannot be validated from here, so every layout bug kept recurring as a
  width-estimate bug. One column removes the dependency rather than tuning it and makes
  horizontal overlap impossible rather than unlikely.

- **1.13 (2026-08-25)** - **The app honors coordinates**, confirmed by a three-column
  render, retiring the v1.0 observation that it auto-arranges; the earlier overlapping
  column was the app faithfully drawing bad coordinates. `TURN FLOOR` and cap guards
  confirmed present in `TURN TO`. But the render **still overlapped while V11 reported
  clean**: the width model used nesting depth times a constant and underestimated by
  about a third, because a row grows with the breadth of its operand tree rather than its
  depth, and the widest rows in the toolkit are exactly the shallow, broad T12 timeout
  conditions. Width is now a recursive sum of label plus operands with a 15 percent
  margin, and column count drops automatically when the widest stack exceeds a sane
  canvas. Recorded the general lesson: **a correct check reasoning over a wrong model
  returns confident and wrong**, which is worse than no check, because a clean run on bad
  measurements ends the search.

- **1.12 (2026-08-25)** - The toolkit rendered with **all nine stacks overlapping in one
  column**, unreadable. Beyond failing the readability requirement the explainability
  case depends on, it made the output unauditable: the T3 floor guards could not be
  confirmed because `DRIVE` was drawn over `TURN TO`, so a presentation defect had become
  a verification defect. Cause was hand-guessed stack coordinates, adequate at 320 blocks
  and colliding at 360 because a stack's height is not knowable before it is built.
  Added `layout.ts`, which measures each stack by walking its chain and substacks and
  fills a grid shortest-column-first, plus V11 asserting no two top-level bounding boxes
  intersect. Recorded that whether the app honors coordinates at all is still unproven,
  with `split.ts` stubbed as the fallback of fewer stacks per project. Controls to
  fifteen.

- **1.11 (2026-08-25)** - **Phase 1 gate met**: all nine My Blocks rendered in the SPIKE
  App. Reviewing the rendered output found two defects a clean validator run had missed.
  **The T3 speed floor had been silently deleted by the fix for the shared-subtree
  defect**, because they occupied the same lines; a turn arriving near target would have
  commanded a speed too low to move the robot and stalled until timeout, looking like a
  tuning problem indefinitely. Reinstated with a cap. **Distance was measured from one
  drive motor**, which misreports path length whenever heading correction is active,
  meaning always; now the mean of both. Added V10 technique conformance, because the
  floor defect survived a clean validator run, ten controls, and a visual review: a
  requirement with no assertion can be deleted by an unrelated fix without anything
  noticing. Controls to fourteen, including a replay of the floor deletion.

- **1.10 (2026-08-25)** - **Phase 1 emitter built** in TypeScript against the verified
  registry, producing `FLL_Toolkit_v1.llsp3`: 320 blocks, nine My Blocks, 8.5 KB, from a
  `RobotConfig`. The validator caught two real defects on its first run. **Shared
  reporter subtrees get two parents and are invalid in Scratch**, which affected the
  proportional term in `TURN TO` and both darkness tests in `SQUARE ON LINE`; reporters
  are now constructed per use site. **V9 refused T17**, one turn after v1.8 added it,
  because its shapes were never verified; the toolkit omits it and robots without a
  flat-mounted hub are recorded as unsupported rather than silently mishandled. Ten
  controls added and passing, seven negative and three positive. The first positive
  control failed and the check was correct: it orphaned a reporter, so the control was
  wrong. Recorded because a false positive normally argues for loosening a check, and
  loosening here would have deleted a correct guard.

- **1.9 (2026-08-25)** - Nine third-party app-authored word-block projects located and
  mined. **Twenty-four shapes overlap my registry with zero disagreements**, which is
  external validation of the whole derivation approach against work produced by no one
  here. Thirteen shapes harvested for free, registry to 70. Confirmed that the manifest
  `extensions` array is Scratch VM extension ids rather than the optional-extension set,
  matching the emitter's declare-what-you-use rule. Added provenance tiers: app-authored
  evidence proves the app produces a shape and is exact on enum values, probe evidence
  proves the app accepts one, and tier A governs on conflict. **Corrected v1.7's
  `unverified_blocking` label, which was overstated**: walking all eight toolkit blocks
  against the registry shows every Phase 1 deliverable is buildable today, and the six
  unproven shapes affect only Phase 2 parallel tasks and a stall variant of a wall square
  that already works timed. Refiled as `unverified_deferred` with the verified
  alternative named for each.

- **1.8 (2026-08-25)** - The SPIKE App extension picker established the authoritative
  namespace list, and **corrected the Probe C root cause**: the opcode table this project
  worked from spans several LEGO products, and `flipperdisplay_*`, `ev3*`, and
  `horizontal*` do not exist in this app at all. The symptom was a wrong matrix block;
  the cause was treating a multi-product table as this app's vocabulary. Exclusion list
  added to the registry and enforced by V9. Added the tether test as the rule for which
  extensions may appear in run programs, since a block that renders on the connected
  device does nothing in a match. **Promoted More Sensors to required, reversing v1.7**:
  `set yaw axis to {UP}` is needed on any robot whose hub is not flat-mounted, and its
  absence would have made every heading wrong in a way that is very hard to diagnose.
  Added T17 for it and put it in the T14 preamble. Added tuning programs as a distinct
  tethered artifact class, which is where Line Graph, Bar Graph, and Display belong and
  where they are genuinely valuable for threshold picking and turn tuning. Recorded that
  minimal extension declaration in run programs is a robustness property.

- **1.7 (2026-08-25)** - Round 2: four of six opened, registry to 57 shapes. **R1 proves
  the T12 timeout pattern is implementable**, boolean nesting into boolean, which was the
  highest-consequence unknown remaining since T12 is a hard rule that had no proven form.
  R4 confirmed `COMPARATOR` as a plain field, the pattern's fourth success. R2 and R3
  failed whole-file and are uninformative about which block is at fault **because I
  bundled four and three new shapes into them, violating the rule written in v1.5**; the
  generator now reports new-shape count per file so the violation is visible before
  delivery. Added the escalation rule: when a pattern-based inference fails, stop
  inferring and read the app's own output, because a hand-built export resolves every
  block in it at once for the same effort as opening one probe. Six shapes moved to an
  `unverified_blocking` list in the registry so that needed-but-unproven is visibly
  distinct from absent.

- **1.6 (2026-08-25)** - All six bisect files opened, **confirming the Probe C fault by
  elimination**: the hub matrix is `flipperlight_lightDisplayText` with no port, and
  every other shape in Probe C was correct. Recorded that the field pattern generalized
  and held: a dropdown with no matching selector or menu opcode is a plain field, first
  predicted for `AXIS` and then confirmed independently for `STOP` and `UNIT`. Added the
  verified-shapes registry section. `FLL_VERIFIED_SHAPES.json` now holds 44 observed
  shapes and stands to this document as `IDEA_DS_DIGEST.md` stands to the design
  standard: evidence, not authority.

- **1.5 (2026-08-25)** - **`TURN TO` was emitted as a real 42-block toolkit block and
  rendered correctly**, validating the wrap expression, deep reporter nesting,
  multi-parameter My Blocks, the full control, operator, and variable vocabulary,
  `startDualSpeed` with reporters, and `AXIS` as a plain field. The technique standard's
  hardest item to express in word blocks is now proven expressible. Separately, Probe C
  **failed whole-file with no diagnostic beyond "Could not open project"**, establishing
  that a wrong shape loses the entire file rather than degrading one block. Added three
  rules from that: shapes are verified by observation before shipping, the validator is
  the only diagnostic that exists, and a probe tests exactly one unverified shape.
  Added V9, a verified-shapes registry check. Identified but did not confirm the likely
  Probe C fault: the hub matrix is `flipperlight_lightDisplayText` with no port, not the
  `flipperdisplay_*` family which carries one.

- **1.4 (2026-08-25)** - Platform record corrected: laptops are Windows, not Mac, and
  **iPad is the primary device with laptops as backup**. That promotes the iPad transfer
  path from an ergonomics improvement to the feature's real interface. Windows folder
  location noted as unestablished and now low priority. Added the rule that **`parent`
  links are derived structurally in a final pass rather than tracked by hand**,
  established when hand-tracked parents produced three reporters whose parent disagreed
  with the input holding them in an otherwise well-formed file; the same pass computes
  the `extensions` arrays from opcodes actually used. Tightened V6 to check
  input-to-parent agreement and reachability, since the looser version would have passed
  that file.

- **1.3 (2026-08-25)** - Student platform established as iPad and laptop, closing the
  last scheduling blocker. Added the delivery path section. **Import on every supported
  platform is a filesystem drop into a folder the app scans, not an in-app import**,
  which makes batch delivery and slot preassignment native and makes collision with
  student work the real risk. Added three rules from that: unique manifest `id` per
  file, namespaced filenames and project names, and regenerate touching only files the
  app previously emitted. Recorded that Chromebook has no documented import path and
  would break the feature, as a constraint on future purchasing. Proposed a Web Share
  path for iPad to replace the documented drag-across-sidebar restore, with the drag
  path as the working fallback. Noted the secondary benefit that plans living in
  Supabase solve the device-loss problem teams hit every season.

- **1.2 (2026-08-25)** - Two emitter-produced probe files opened and rendered correctly
  in the SPIKE App. Records what that proves: the emitter path works end to end at the
  file level, My Blocks round-trip, **argument reporters drive numeric inputs via
  type-3 obscured shadows**, extension blocks render when declared in both arrays with
  `showAllBlocks` true, the `<namespace>_menu_<name>` shadow pattern holds, and the
  bundled sound asset, rendered icon, and non-stub costume are all unnecessary. The
  argument-reporter result is what makes the toolkit viable at all. Two behaviours came
  back negative and are held as observations pending the resave diff: block comments did
  not render, and top-level coordinates were not honored. **Moved the explainability
  mechanism off in-file comments** onto the notebook export and onto toolkit block names
  that carry their own meaning, since the block name is the only explanation that
  travels with the file. Unknowns reduced to four, one of which can still force a
  redesign.

- **1.1 (2026-08-25)** - Container format section rewritten from measurement after a
  real `.llsp3` export was read, replacing everything written from research. Manifest
  fields locked verbatim, including the `extensions` array that must agree between the
  manifest and `project.json` and is the most likely cause of a file that opens with
  blocks missing. Block shapes recorded: inline numeric primitives, type-3 obscured
  shadows, true fields versus shadow-block selectors. **Corrected the v1.0 claim that
  port selectors are fields**; they are shadow blocks in input slots, so the stated
  reason for baking ports was wrong even though the conclusion holds. Replaced it with
  the reason that survives: the emitter restricts itself to shapes the SPIKE editor can
  produce natively, because a student must be able to edit the output. Added that
  standing rule. Unknowns reduced from eight to seven, with five closed by the export
  and the rest routed to two generated probe files.

- **1.0 (2026-08-25)** - Created. Scoped from research into the `.llsp3` container
  format, the 396-opcode SPIKE word-block vocabulary, the Prime Lessons technique
  corpus, the FIRST LEGO League Robot Design rubric language, and the program's
  announced sunset timeline. Establishes the sixteen-item technique standard, the
  eight-block toolkit with baked ports and `hdg_offset` frame tracking, the plan
  intermediate representation, the eight validator checks, and four phase gates.
  Records three decisions that would otherwise look arbitrary later: PD rather than
  full PID, ports baked rather than parameterized, and calibration constants baked at
  generation time rather than read at run time.
