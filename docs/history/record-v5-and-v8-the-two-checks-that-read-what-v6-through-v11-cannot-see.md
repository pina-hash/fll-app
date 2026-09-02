---
title: "2026-08-27 -- V5 and V8: the two checks that read what V6 through V11 cannot see"
date: 2026-08-27
branches: []
migrations: []
subsystems: ["Code generator"]
record_order: 21
---

The validator table in `FLL_CODEGEN_SPEC.md` lists eleven checks and `package.ts`
carried six of them. Two of the five missing ones were implementable with what
exists today. V2, V3, V4 and V7 still are not: all four reason over a plan
intermediate representation that Phase 2 introduces and Phase 1 does not have.

### What landed

- **V5, calibration sanity** (`validateCalibration` in `package.ts`). It guards a
  LIVE defect. `buildToolkit` divides by `(white - black)` and writes the
  quotient into the project as a literal, so `white === black` bakes a division
  by zero into the generated blocks and `white < black` inverts every line
  reading. The finding names the port and both readings.
- **`CALIBRATION_MIN_SEPARATION`, and why it is a margin rather than
  inequality.** At a separation of S the emitted divisor turns one raw point of
  sensor noise into `100/S` points of normalised output: 1.2 at the measured
  practice pair (95 on 12), 20 at a separation of 5. Bare inequality lets white
  51 on black 50 through, a divisor of 1. The floor is 20; real pairs measure 60
  to 85 apart. The database already refuses `white <= black`
  (`calibrations_white_above_black_check`), so V5 is what refuses a row that is
  legal to STORE and too narrow to BAKE.
- **V8, container round trip** (`verifyContainer`). It unzips what `pack()`
  produced, parses the inner `project.json` back out of it, and holds the result
  against `_meta.container` in `FLL_VERIFIED_SHAPES.json` field by field: outer
  entry names and compression, inner entry names, `project.json` deflated,
  assets stored, the stub asset's id and its zero length, `meta.vm`,
  `manifest_version`, and the two permissive fields (`sounds_required`,
  `icon_svg_may_be_stub`) consumed rather than ignored.
- **A field the registry does not mention is REPORTED, not accepted and not
  refused.** `ContainerReport.unpinned` carries the manifest keys the container
  block says nothing about, and `GeneratedProject.containerUnpinned` passes them
  to a caller. There are sixteen. Making them findings would withhold every file
  this emitter produces over fields nobody has observed yet; dropping them would
  let a field enter the manifest with nothing in the world vouching for it.
- **The manifest comparison is DRIVEN BY the registry, not restated beside it.**
  Every `manifest_<field>` key in the container block becomes one assertion, so
  a field observed later is enforced by editing the registry alone.
- **`pack()` now writes the inner stub asset STORED.** This closes the container
  mismatch the previous bundle recorded and did not fix.
- **`RegistryFaultCode` gains `no-container`**, with `assertContainerUsable()`
  taking the registry as a parameter so the guard can be tested on one. A
  registry full of shapes with no container block is a statement about the
  VALIDATOR, like `placeholder` and `empty`, and it is a third state because it
  fails differently: V9 would go on answering confidently while V8 has no
  reference at all.

### Load-bearing decisions

- **`validate(o, src)` takes the source as a REQUIRED parameter.** An optional
  one would make V5 a check that silently does not run whenever a caller forgets
  it, which is the failure mode the linked-project grant assertions had for
  twenty migrations: a test that can only pass. V5 is also the only check that
  reads the source at all, because by the time the emitter has run the
  calibration is two literals among four hundred blocks and its two original
  numbers cannot be recovered from what is left.
- **V8 runs on the BYTES, so packing now happens before the bytes are known to
  be handed over.** The order that matters is unchanged: a container that fails
  the round trip leaves `bytes` null exactly as a bad block graph does.
- **A container that will not open is a FINDING, not an exception.** V8's first
  clause is "the zip opens", and the caller is asking whether this file is safe
  to hand to a child.
- **`unpinned` is on `GeneratedProject` and deliberately NOT on the student's
  screen.** That surface reads at fourth grade; sixteen manifest field names are
  a note to whoever next observes the SPIKE App writing a manifest.
- **The central directory is walked from the end-of-central-directory record**,
  not by scanning for the `0x02014b50` signature, which turns up inside
  compressed data often enough to invent entries. fflate hands back decompressed
  bytes and forgets how each entry was stored, and three of the container
  block's fields are about exactly that.

### Measured

- **Twenty-three negative controls, all CAUGHT; five positive controls, all
  SILENT; one reporting case.** The three V5 cases are white 55 on black 55 (the
  division by zero), white 12 on black 95 (inverted), and white 30 on black 20
  (legal for the database, too narrow to bake). Each asserts the finding names
  BOTH ports and both readings. The seven V8 cases break the packed bytes:
  manifest `version` 37, a drifted `meta.vm`, `scratch.sb3` renamed, outer
  deflated, `project.json` stored, the stub asset deflated, the stub asset given
  bytes.
- **V5's positive control is white 41 on black 20**, a separation of 21: one
  point over the floor, a dim hall and a sensor sitting a little high, and the
  whole validator stays silent on it.
- **V8's positive controls are real `pack()` output**, once taken apart and
  resealed and once untouched. The first is what would catch the test harness
  drifting from `pack()`.
- **The `pack()` change was proved load-bearing by reverting it.** With the
  stub asset deflated again, `generateProjects` returned `findings=1` and
  `bytes=null` for BOTH projects: V8 fires on every generation, and no file is
  handed over. Restored, both come back `findings=0`, 9445 and 11192 bytes.
- **End to end through `generateProjects` with a broken calibration** (white 44
  on black 44): four findings across the two projects, both naming port E and
  port F with both readings, and `bytes` null on both.
- **The persistence path, against the applied chain.** `supabase/migrations`
  0001 through 0024 applied in order with no error, then, as the statements
  `storage.ts` sends: the Run Captain's insert returned 1 row,
  id `82c39cb8-e977-40d9-868d-7f0bc10c8a07`, name `Season base verifyk72y`, and
  the reload read that same id and name back with wheel 62, track 118, ports A/B
  and E/F. A student on the same team who is NOT the Run Captain got
  `strategy_can_edit` false, an UPDATE that returned zero rows with no error
  (which is what makes `saveConfig` report "That did not save."), a DELETE that
  returned zero rows, and an INSERT refused outright with `42501`, "new row
  violates row-level security policy". Positive controls: the same student READS
  the row (1 row), the row is unchanged afterwards through the owning role, and
  a student on another team reads 0 rows where the owner reads 1.
- **Applying 0024 turned `tests/schema-catalog.test.ts` RED, and it had been
  red since the bundle that wrote the migration.** Its `TABLES` list held 26
  names against a database with 28: `calibrations` and `robot_configs` were
  never added, so both the "every table has RLS enabled" case and the "every
  table has at least one policy" case failed the moment the migration reached a
  stack. Both names are in the list now, and the linked-project ledger case
  asserts `0024` alongside 0021, 0022 and 0023: that line is the one thing that
  would catch the migration having been applied by hand rather than pushed,
  which is how 0019, 0020 and 0021 each went out. With both fixes and
  `seed.sql` applied, the file runs 14 passed, 8 skipped (the eight are the
  linked-project cases, which skip loudly with no access token).
- **The full suite: 14 files passed, 29 failed, 271 tests passed.** Every one of
  the 29 fails on GoTrue or PostgREST being absent, not on anything in this
  change. Same cause as the last two bundles, three more files green than last
  time because the catalog now runs against a real applied chain.
- `npx svelte-check`: **0 errors, 0 warnings, 705 files.**
- The repo-wide em dash and en dash check is clean.

### Not verified

- **The persistence run did NOT go through PostgREST or GoTrue.** No container
  registry is reachable from this session (`ghcr.io` and Docker Hub blob hosts
  both answer 403 through the agent proxy), so `supabase start` could not pull
  its images. The chain was applied to a PostgreSQL 16 cluster with a hand-built
  stand-in for the platform base (the roles, the `auth` and `storage` SQL
  surfaces, `supabase_realtime`, the migration ledger), and every statement was
  issued the way PostgREST issues one: `set local role authenticated` with
  `request.jwt.claims`. The RLS and grant claims above are database claims and
  hold; a claim about the wire (a 204 with no rows, a PostgREST error code) is
  inferred from the SQL, not observed.
- **`database.types.ts` is still unregenerated**, so `storage.ts` still goes
  through its `untyped` handle. `supabase gen types` runs `postgres-meta` in a
  container and could not pull it either. The header comment in `storage.ts` now
  states the two facts separately rather than as one.
- **Still no `.llsp3` from this session has been opened in the SPIKE App**, and
  the stub asset's compression is the one change here that alters what the app
  is handed. STORED is what the registry records the app ITSELF writing
  (provenance A), which is why it was matched; the DEFLATED form is the one
  every tier B probe was proved with. The change is made on registry evidence,
  not on a probe, and is written down here rather than hidden.
- **The `unpinned` list has been read by nothing except the control.** Sixteen
  manifest fields still have nothing observed behind them.

### Deferred

- **V2, V3, V4 and V7 remain unbuilt**, and none of them is implementable yet:
  each reads a plan intermediate representation that Phase 2 introduces. V7,
  which the spec calls the load-bearing one, is the check that decodes the
  emitted `project.json` back to block text and compares it to the plan.
- Closing the `unpinned` gap means observing the SPIKE App writing a manifest
  and recording those fields in `_meta.container` as `manifest_<field>`. It is
  not closed by reasoning about them in `package.ts`, which is the same rule
  that keeps the emitter from certifying itself through V9.

---

