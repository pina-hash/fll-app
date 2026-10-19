# The code generator

Moved verbatim from `CLAUDE.md` (Conventions) on 2026-10-19, so `CLAUDE.md` stays under 3,000 words. `CLAUDE.md` links here; keep this file current in the same change as anything it describes.

### The code generator

`src/lib/codegen/` turns a robot configuration into SPIKE Prime word-block
`.llsp3` projects. `/app/me/codegen` is the student surface,
`/app/codegen/[teamId]` the mentor's door onto the same one, `/dev/codegen` the
harness; all three mount `CodegenPage.svelte` and differ only in the transport
they hand it. The governing pair is `docs/FLL_CODEGEN_SPEC.md` (what the emitter must
do) and `docs/FLL_VERIFIED_SHAPES.json` (what is true of the app). Where they
disagree about a RULE the spec governs; where they disagree about whether a
SHAPE works the registry governs and the spec is corrected.

- **THE EMITTER IS VERBATIM AND ITS DEFECTS ARE NON-OBVIOUS.** `blocks.ts`,
  `toolkit.ts`, `layout.ts`, `selftest.ts` and the sixteen control cases in
  `__tests__/negcontrol.test.ts` came from outside this repo with their
  correctness established empirically over many probe rounds against the real
  app. Do not tidy them, do not refactor them, do not "fix" something that
  looks wrong without a probe result that says it is. The one edit made to a
  control case so far is a `: unknown` type annotation that changes no
  behaviour, and it is recorded in HISTORY.
- **THE SPIKE APP REFUSES A MALFORMED PROJECT WHOLE, WITH NO DIAGNOSTIC.** One
  wrong opcode, field name or shadow shape and the app says "Could not open
  project" and nothing else. There is no partial render and no way to bisect
  from the app. That single fact is why the registry exists, why V9 is the
  check that matters most, and why a project that fails validation has NO BYTES
  rather than a file somebody might hand over anyway.
- **A SHAPE ENTERS `FLL_VERIFIED_SHAPES.json` ONLY WHEN IT HAS BEEN SEEN
  RENDERING, NEVER WHEN IT HAS BEEN REASONED ABOUT.** The field pattern
  predicted `STOP`, `UNIT` and `COMPARATOR` correctly and then failed twice.
  Provenance A is a shape the app itself WROTE (enum values and field names are
  exact); B is one the emitter wrote and the app OPENED. Where the two
  disagree, A governs. Never derive the registry from the emitter's own
  opcodes: that makes V9 certify whatever the emitter happens to emit, which is
  the one thing it exists to prevent.
- **A SHAPE THAT IS NEEDED AND NOT PROVEN GOES ON `unverified_deferred`, WHICH
  IS A DIFFERENT STATE FROM ABSENT.** Each entry names the verified alternative
  covering the gap. `flippermoresensors_setOrientation` is the live one: T17's
  yaw axis is recorded on `robot_configs` and NOT emitted, so any hub that is
  not flat-mounted is unsupported. **A QUESTION WHOSE ANSWER IS THROWN AWAY IS
  NOT ASKED.** The form used to collect the axis and the emitter used to ignore
  it, which is a child spending attention on a control that changes nothing.
  The column and its `up` default stay, the screen no longer carries the
  control, and `CodegenPage.svelte` holds the note saying it returns when the
  shape is verified. Restoring the control is part of verifying the shape, not
  a step before it.
- **`assertRegistryUsable()` THROWS, IT DOES NOT RETURN A FINDING, AND
  PLACEHOLDER IS KEPT APART FROM EMPTY.** A finding describes the PROJECT; a
  missing registry describes the VALIDATOR, and letting a broken toolchain wear
  the costume of a broken project is how a placeholder shipped once already
  (V9 rejected all 374 blocks and the real cause appeared in none of the 374
  lines). A placeholder is also empty, so the placeholder branch is checked
  first or the guard names the symptom and hides the cause.
- **A MISSING OR PLACEHOLDER REGISTRY FAILS THE SUITE; IT DOES NOT SKIP IT.**
  `__tests__/registry-guard.test.ts` is that control and it is never skippable.
  The loud SKIP in `negcontrol.test.ts` only stops sixteen identical
  `RegistryFault` traces from burying the one legible failure; it is not the
  guard, and a run with a placeholder is red.
- **TWO PROJECTS, ALWAYS BOTH.** The toolkit (slot 19) and the self test
  (slot 18), and the self test BUILDS THE WHOLE TOOLKIT INTO ITSELF so it is
  standalone rather than a companion that only works beside the other file.
- **The registry's `container` block is the reference for what a `.llsp3`
  looks like** (outer STORED with `manifest.json`, `scratch.sb3`, `icon.svg`;
  inner `project.json` deflated; `meta.vm` and manifest `version` 38 exact).
  Check emitted output against it rather than against memory.
- **`pack()` uses `Math.random()` and `new Date()`**, so two runs of the same
  configuration differ by a few bytes and never hash equal. Compare structure,
  never bytes.
- **WHAT IS PLUGGED INTO WHICH PORT IS ONE QUESTION, ASKED ONCE, AND
  `movement_pair` IS DERIVED FROM IT.** `left_motor`, `right_motor`,
  `movement_pair`, `left_color_port`, `right_color_port` and
  `attachment_motors` are six columns answering one question, and the form
  asked it six times. `src/lib/codegen/ports.ts` is that question as data: one
  `PortRole` per port, and `configPortsFromMap()` is the ONLY producer of a
  `movementPair`, which is `leftMotor + rightMotor` and therefore cannot
  disagree with the two drive ports the way a text box beside two dropdowns
  could. An incomplete map produces `null`, never a half-built config, so it
  cannot reach the transport or the emitter, and a stored row that already
  disagrees with itself is repaired when it is opened.
  `tests/codegen-ports.test.ts` holds both halves: the property, over every map
  two moves from the default, and the structural half, which goes red if a
  second file assigns `movementPair` at all. Same rule as "A DERIVED ANSWER IS
  DEFINED ONCE", applied on the client because this derivation is a screen's
  arithmetic and not a database read.
