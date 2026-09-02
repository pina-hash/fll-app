---
title: "2026-08-26 -- The code generator lands: SPIKE word-block emitter, schema 0024, and a route that refuses a bad file"
date: 2026-08-26
branches: []
migrations: ["0024"]
subsystems: ["Code generator"]
record_order: 19
---

The emitter that turns a robot configuration into SPIKE Prime `.llsp3` word-block
projects arrives from outside this repo, VERBATIM. Its correctness was
established empirically against the real SPIKE App over many probe rounds, and
several of its defects are non-obvious, so nothing in it was rewritten,
tidied, or "improved". Four of the five landed files are byte-identical to
their source; `package.ts` carries exactly the two changes the environment
demanded and no others.

### What landed

- `src/lib/codegen/{blocks,toolkit,layout,selftest}.ts` -- md5-identical to the
  tarball. `blocks.ts` builds the shapes, `toolkit.ts` the eight My Blocks,
  `layout.ts` measures every stack rather than guessing offsets, `selftest.ts`
  builds a project the hub runs and grades itself.
- `src/lib/codegen/package.ts` -- two changes. The verified-shape registry is
  now imported as JSON from `docs/FLL_VERIFIED_SHAPES.json` instead of read
  from an absolute container path, and `writeFile()` is gone: `pack()` already
  returned bytes, and now that is the only way out. Nothing else moved; the
  diff is nine lines including the `RegistryShape` interface the import needs
  under `strict`.
- `src/lib/codegen/__tests__/negcontrol.test.ts` -- the sixteen control cases,
  BYTE-IDENTICAL (proved by extracting every `expectCatch`/`expectSilent`
  invocation from both files and comparing). Only the wrapper changed:
  `expectCatch` now registers a vitest case instead of running inline, and the
  per-case CAUGHT/MISSED line goes to `process.stdout.write` because vitest
  intercepts `console.*` and a control suite whose whole product is that line
  cannot have it swallowed. Same reasoning as `tests/db/linked.ts`.
- `main.ts` and `emitall.ts` were discarded (container CLI drivers). What they
  orchestrated is `src/lib/codegen/generate.ts`, with one difference that is
  the point of the module: the CLI wrote a file whenever the validator came
  back clean, and `GeneratedProject.bytes` is `null` whenever it did not. A
  caller cannot hand over a project that failed validation because there are no
  bytes behind it.
- `src/lib/codegen/CodegenPage.svelte` plus `/app/me/codegen` (the real route,
  inside the student group, team-scoped exactly like `/app/me/plan`) and
  `/dev/codegen` (the `dev`-guarded harness mounting the REAL component with
  fixture props, the way `/dev/route-planner` does).
- `supabase/migrations/0024_robot_configs_and_calibrations.sql`, WRITTEN AND
  NOT APPLIED. See below.

### Load-bearing decisions

- **THE VERIFIED-SHAPE REGISTRY IS NOT IN THIS REPO AND WAS NOT INVENTED.**
  `docs/FLL_VERIFIED_SHAPES.json` and `docs/FLL_CODEGEN_SPEC.md` were both
  absent, and neither was in the tarball. A registry reconstructed from the
  emitter's own opcodes would make V9 certify whatever the emitter happens to
  emit, which is the one thing V9 exists to prevent, so the file shipped as an
  EMPTY, self-describing placeholder carrying `_meta.placeholder: true`. The
  consequence is deliberate and loud: V9 rejects all 374 blocks of the toolkit
  and all 466 of the self test, `generateProjects()` returns no bytes, and the
  route offers no download. **The generator is fail-closed until the real
  registry is dropped in at that path.** Nothing else has to change when it is.
- **THE CONTROL SUITE SKIPS LOUDLY RATHER THAN PASSING AGAINST A PLACEHOLDER.**
  With an empty registry the thirteen negative controls would "catch" on V9
  noise instead of on the defect each one injects, and the three positive
  controls would trip. A bare "16 skipped" reading as a pass is the exact
  failure `tests/db/linked.ts` exists to prevent, so the reason goes to
  `process.stderr` in the same banner shape.
- **THE ARITHMETIC IS ON THE SCREEN, NOT BEHIND IT.** The emitter bakes
  `360 * gear_ratio / (pi * wheel_diameter_mm)` into four My Blocks as a
  literal. If that number is wrong every drive in every run is wrong by the
  same percentage and nothing on the robot says so. The page therefore shows
  the sum and its working, live: 300 mm = 614 motor degrees at 56 mm wheels,
  554 at 62 mm, recalculated as the box is typed in.
- **THE SHARE SHEET IS DETECTED, NOT ASSUMED.** Students are on iPads, where a
  plain download means six steps through the Files app between a nine-year-old
  and their program. `deliver()` calls `navigator.canShare({ files })` with the
  ACTUAL payload rather than testing for the API's existence, falls back to an
  anchor download, and reports a cancelled share as cancelled rather than
  quietly dropping a file in Downloads the child just declined.
- **CALIBRATION IS A SEPARATE TABLE BECAUSE WHITE AND BLACK ARE PROPERTIES OF
  THE ROOM.** The practice table under fluorescent light and the competition
  hall under stage light give different readings from the same sensor on the
  same mat, so the natural key is `(team, port, venue)` and last week's numbers
  survive today's. Writes on both tables gate on `strategy_can_edit()`, called
  and not re-derived: a robot configuration is Robot Design territory and that
  is the same population that owns the route planner.
- **`__tests__/negcontrol.test.ts` CARRIES `@ts-nocheck`.** The un-annotated
  `.find()` callback in "speed floor hoisted out of the tolerance branch" makes
  tsc report TS7022 on a `const c` it cannot type without circularity.
  Annotating it would be editing a control case, which is the one edit this
  file must not accept, so the file opts out of tsc instead. vitest still
  type-strips and RUNS every case.

### Measured

- **Control suite, all sixteen, against a stand-in registry** (derived from the
  emitter's own 44 opcodes, kept OUT of the repo, and circular for V9 by
  construction): 13 CAUGHT, 3 SILENT, 16 passed. V9 x3, V1, V6 x3, V10 x5,
  V11. The three legal edits (retune a constant, change a stop method,
  recalibrate a threshold) tripped nothing.
- **Against the shipped placeholder registry:** 16 skipped with the banner.
- **Toolkit:** 374 blocks, 9 top-level stacks, 10 variables (`_hdgOffset`,
  `_settled`, `_err`, `_pwr`, `_mag`, `_target`, `_corr`, `_lspd`, `_rspd`,
  `_lastErr`), extensions `["flipperlight", "flippermoremotor",
  "flippermoremove", "flippermotor", "flippermove", "flippersensors"]`,
  `overlaps()` empty. **Self test:** 466 blocks, 10 stacks, 12 variables,
  seven extensions.
- **The packaged file was opened and read, not merely produced.** 9447 bytes;
  outer zip STORED with `manifest.json` (name "FLL Toolkit v1", slotIndex 19,
  type "word-blocks", version 38), `scratch.sb3` and `icon.svg`; inner sb3
  holding `project.json` and the stub svg; 374 blocks and 10 variables in the
  sprite, extensions matching the manifest.
- **In a browser at 375 and 1440**, through the real component: the conversion
  moved 614 -> 554 -> 614 as the wheel box changed, both files generated with
  their block counts and variable lists shown, and both downloaded. Horizontal
  overflow `scrollWidth - clientWidth` was **0 at both widths**, in every state
  including the 840-finding refusal. No console errors (the one 404 at 375 was
  `/favicon.ico`, pre-existing).
- **The refusal path was driven, not reasoned about.** With the placeholder
  registry restored, Generate at both widths produced 840 findings, listed
  them, and rendered **zero download buttons**.
- `npx svelte-check`: **0 errors, 0 warnings, 704 files.**

### Not verified

- **NO SHAPE IN THE EMITTER WAS VERIFIED BY THIS SESSION.** V9 is the only
  check that can say a shape is real, and the registry it asks is empty. Every
  V9 result reported above is either "rejects everything" (placeholder) or
  circular (stand-in). Nothing here is evidence that the SPIKE App accepts
  these files.
- **No `.llsp3` was opened in the SPIKE App.** Not available in this session.
- **The migration was not applied anywhere and its SQL never reached a
  database.** Docker is not available in this container, so there was no local
  stack: 0024 has not been parsed by Postgres, its CHECK constraints have not
  been exercised, and its policies have not been proved in either direction.
  No test was written for it for the same reason.
- **`src/lib/supabase/database.types.ts` was NOT regenerated**, because
  regenerating needs a stack with 0024 applied. `src/lib/codegen/storage.ts` is
  the one module holding an untyped client handle until it can be.
- **The full suite could not run.** 31 of 42 files failed, every failure
  tracing to `connect ECONNREFUSED 127.0.0.1:54322`. The 10 files that need no
  database passed. Nothing in this bundle caused any of it.
- **The share sheet path was not exercised**, only the download fallback:
  headless Chromium reports `canShare({ files })` false, which is the correct
  answer for it and is why detection rather than assumption is the rule.

### Deferred

- **T17 remains unsupported.** `flippermoresensors_setOrientation` is not in
  the registry, so `START RUN` does not emit it and any hub not mounted flat
  and face up will turn wrong. The column exists and the form says so out loud
  rather than generating a file that fails quietly.
- **0024 reaches production by hand**, in the SQL editor, and whoever does it
  must follow with `supabase migration repair --status applied 0024`. The
  ledger has now disagreed with the database three times in this repo for
  exactly this reason.

---

