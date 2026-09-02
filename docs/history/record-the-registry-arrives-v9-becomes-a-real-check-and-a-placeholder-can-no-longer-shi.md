---
title: "2026-08-26 -- The registry arrives: V9 becomes a real check, and a placeholder can no longer ship quietly"
date: 2026-08-26
branches: []
migrations: []
subsystems: ["Code generator"]
record_order: 20
---

The previous bundle shipped `docs/FLL_VERIFIED_SHAPES.json` as an empty
placeholder because the real file did not exist here, and verified the emitter
against a registry DERIVED FROM THE EMITTER'S OWN OPCODES. That could only ever
prove self-consistency: a registry containing exactly what the emitter emits
makes V9 certify whatever the emitter happens to emit, which is the one thing
V9 exists to prevent. The real registry and the real spec have now replaced
both placeholders, and this entry is what changed as a result.

### What landed

- `docs/FLL_VERIFIED_SHAPES.json`, the real one: **70 shapes, 24 provenance A
  (the SPIKE App itself wrote them, read out of a real exported project) and 46
  provenance B (the emitter wrote them and the app opened and rendered them).**
  Every shape carries `status: verified`, a dated `proof` naming its probe, and
  a provenance tier. 18 namespaces in `NOT_IN_THIS_APP`, and 8 shapes on
  `unverified_deferred`.
- `docs/FLL_CODEGEN_SPEC.md`, the real 1440-line governing specification,
  replacing the index of T- and V-numbers that stood in for it.
- `assertRegistryUsable()` in `package.ts`, called as the first statement of
  `validate()`, plus `RegistryFault` carrying a `code`.
- `src/lib/codegen/__tests__/registry-guard.test.ts`, six cases, never skipped.
- A new "The code generator" section in `CLAUDE.md`.
- **`@ts-nocheck` is GONE from `negcontrol.test.ts`.**

### Load-bearing decisions

- **THE GUARD THROWS RATHER THAN RETURNING A FINDING, AND PLACEHOLDER IS KEPT
  APART FROM EMPTY.** A finding is a statement about the PROJECT being
  validated; a missing registry is a statement about the VALIDATOR. Conflating
  them is exactly how the placeholder shipped without anyone noticing: V9
  rejected all 374 blocks of the toolkit, which reads precisely like an emitter
  that has broken, and the true cause (nobody had put the registry in yet)
  appeared in none of the 374 lines. A placeholder is ALSO empty, so the
  placeholder branch is tested first; a guard that only counted shapes would
  report the symptom and bury the cause.
- **A PLACEHOLDER NOW FAILS THE SUITE. IT DOES NOT SKIP IT.** The loud SKIP
  added last bundle stays, but it is not the guard and never was: it exists
  only so sixteen identical `RegistryFault` traces do not bury the one legible
  failure. `registry-guard.test.ts` is unskippable, and a run against a
  placeholder is RED. This is a deliberate departure from `tests/db/linked.ts`,
  which skips: an absent LINKED PROJECT is an unavailable environment, while a
  placeholder registry is a broken artifact sitting in the repo.
- **`@ts-nocheck` came off, and the annotation that did it was NOT the one
  expected.** Annotating the `.find()` callback's return type (`(k): boolean =>`)
  does NOT clear TS7022; verified in isolation with `tsc --ignoreConfig`. The
  circular inference is on the local `const c` inside that callback, and
  `const c: unknown` clears it. That is a pure type annotation: it changes no
  runtime behaviour, no assertion, and no control case's structure. 15 of the
  16 cases remain byte-identical to the tarball and the 16th differs by exactly
  those nine characters, proved by extracting every `expectCatch`/`expectSilent`
  invocation from both files and diffing. The whole file is now typechecked.

### Measured

- **All sixteen controls, against the REAL registry: 13 CAUGHT, 3 SILENT, 16
  passed.** V9 x3, V1, V6 x3, V10 x5, V11, then the three legal edits silent.
- **Which of those were previously circular.** "phantom namespace, the Probe C
  failure" fires on `flipperdisplay` being in `NOT_IN_THIS_APP`; last bundle
  that list was written BY THIS REPO to make the case fire, so the case proved
  nothing. It is now checked against 18 independently observed namespaces.
  "opcode absent from the registry" checked `flippermove_invented` against a
  44-entry list that was the emitter's own output; it is now checked against 70
  observed shapes. "namespace used but not declared" was never circular: it
  compares opcode namespaces against `o.extensions` and does not consult the
  registry at all. The ten non-V9 controls were never circular either.
- **THE EVIDENCE THAT THE REGISTRY IS EXTERNAL, which is the whole point:** 70
  shapes, 44 distinct opcodes emitted across both projects, **0 emitted opcodes
  absent from the registry, and 26 registry shapes the emitter never reaches
  for** (`flippermove_steer`, `flippersensors_isDistance`, `control_forever`,
  `flippersound_beepForTime` and 22 others). A registry derived from the
  emitter has exactly as many entries as the emitter has opcodes and zero
  surplus. 26 surplus is what a registry written by probe results looks like.
- **Toolkit:** 374 blocks, 9 stacks, 10 variables, six extensions, `overlaps()`
  EMPTY, validator **CLEAN**, 9449 bytes. **Self test:** 466 blocks, 10 stacks,
  12 variables, seven extensions, `overlaps()` EMPTY, **CLEAN**, 11196 bytes.
  300 mm = 614 motor degrees on both.
- **The zip opened and checked against the registry's own `container` block:**
  outer STORED with `manifest.json` / `scratch.sb3` / `icon.svg`; manifest
  `type` "word-blocks", `version` 38, `slotIndex` 19 and 18, `zoomLevel` 0.675,
  `showAllBlocks` true, `state.playMode` "download", 12-character id, hardware
  keyed to `{"type": "flipper"}`; inner sb3 holding `project.json` (deflated,
  83626 and 104029 bytes) and the zero-byte `deadc057...svg` stub; `meta.vm`
  `0.2.0-prerelease.20200512204241`. Every one matches what the registry says
  the app writes, with one exception noted below.
- **The guard was proved to bite, not assumed to.** With the placeholder
  swapped back in: 2 failed, 16 skipped, and the failure message names the file
  and what is wrong with it. Restored (md5 checked): 22 passed.
- **In a browser at 375 and 1440**, real registry, through the real component:
  0 failure notes, 0 findings listed, "Checked: nothing wrong. 2 files ready.",
  **the Download control present at both widths** (it was absent at both last
  bundle), and both files downloaded and opened: 374 blocks, 10 variables,
  correct manifest. Horizontal overflow 0 at both widths. The only console
  error was `/favicon.ico`, pre-existing.
- `npx svelte-check`: **0 errors, 0 warnings, 705 files**, now including
  `negcontrol.test.ts` itself.

### Not verified

- **STILL no `.llsp3` has been opened in the SPIKE App by this session.** V9
  now checks against shapes somebody else observed rendering; that is a large
  step up from circular, and it is not the same claim as "this file opens".
- **The spec's own shape count is stale.** `FLL_CODEGEN_SPEC.md` says "44
  shapes as of 2026-08-25" where the registry it describes now holds 70. Left
  as delivered rather than edited: the spec is a governing document supplied
  from outside and its counts are not this repo's to revise.
- **One container mismatch, reported rather than fixed.** The registry records
  inner `assets: STORED`; `pack()` deflates the inner sb3 wholesale, so the
  stub asset comes out DEFLATE. The stub is zero bytes, so no data is affected,
  and every probe-confirmed (tier B) shape in the registry was proved by files
  the app opened that were packed exactly this way. The emitter is verbatim and
  its correctness is empirical, so this is recorded and not changed.
- **0024 is still unapplied and `database.types.ts` still unregenerated.**
  Docker is unavailable in this container, so the same list of database checks
  as last bundle could not run. The full suite still fails 31 of 42 files on
  `connect ECONNREFUSED 127.0.0.1:54322`.
- **The share sheet path is still unexercised**, only the download fallback:
  headless Chromium answers `canShare({ files })` false, which is the correct
  answer for it.

### Deferred

- `flippermoresensors_setOrientation` and its menu shadow remain on
  `unverified_deferred`, so T17 is still unsupported and any hub not mounted
  flat and face up will turn wrong. The form still says so.
- V2, V3, V4, V5, V7 and V8 are in the spec's validator table and not in
  `package.ts`. V7, which decodes the emitted `project.json` back to block text
  and compares it to the plan, is the one the spec calls load-bearing, and it
  needs the plan intermediate representation that Phase 2 introduces.

---

