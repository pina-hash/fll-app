---
title: "2026-08-23 -- Route planner: schema 0012, geometry, the planner surfaces"
date: 2026-08-23
branches: []
migrations: ["0012"]
subsystems: ["Route planner, field picture"]
record_order: 6
---

### What changed

**Schema.** One migration,
`supabase/migrations/0012_strategy_route_planner.sql`:

- `strategy_can_edit(team_id)`: THE edit rule, once. A mentor, or the run
  captain as `team_resolve_roles` resolves that seat: the ACTIVE holder while
  a meeting has one (the covering rule), otherwise the primary/second
  assignment holders, so a captain can plan from home. Every policy on every
  planner table calls it; the UI's `canEdit` is the same RPC, so affordance
  and enforcement cannot drift.
- `strategies` (one per team, versioned; `unique (team_id, version)`),
  `launches`, `launch_missions` (with `scoring_lines`, the ticked plan lines),
  `waypoints` (mat millimeters, checked to the physical 2362 x 1143 mat).
  Children carry the composite `(parent_id, team_id)` foreign key, so
  cross-team parenting is impossible by CONSTRAINT before any policy runs.
- `team_robots`: per-team footprint, speed (default 30 cm/s), dwell per
  mission, handling time between launches. Natural key `unique (team_id)` so
  a replayed write is an upsert.
- `mat_config`: a singleton (`id boolean primary key check (id)`) holding the
  launch area rectangle, seeded NULL on purpose: rulebook numbers are entered
  by a mentor, never invented here, same policy as mission positions.
- `strategy_snapshot(team_id, label)`: the one RPC; freezes the working copy
  under a label and copies the whole tree to version+1 atomically.
- The private `mat` storage bucket: the club's OWN photo of its own mat,
  mentor-written, read by any signed-in session via signed URL.

**App.** `src/lib/planner/` (`geometry.ts`, `types.ts`, `ops.ts`, `data.ts`,
`photo.ts`, `MatCanvas.svelte`, `MoveList.svelte`, `RoutePlanner.svelte`,
`PlannerPage.svelte`), routes `src/routes/app/(mentor)/plan/` (+ `[teamId]`),
`src/routes/app/(student)/me/plan/`, and the harness at
`src/routes/dev/route-planner/`. The queue (`src/lib/student/queue.svelte.ts`)
gains the planner op kinds and delegates them to `ops.ts`; its
transient/permanent classifier moved to `src/lib/student/postgrest.ts` so the
two files share one implementation. Console nav gains Plan; My Screen gains
"Plan our robot runs".

### Load-bearing decisions

- **THE OUTPUT IS THE MOVEMENT LIST, NOT THE DRAWING.** Everything renders in
  the units the students' SPIKE Prime code takes: turn left/right N degrees,
  drive N centimeters, heading tracked through the whole path, first segment
  turn-free because the kid aims the robot in the launch area by hand.
- **THE GEOMETRY IS THE ONE EXCEPTION TO "DERIVED ANSWERS LIVE IN SQL", AND
  IT IS STILL DEFINED ONCE.** `geometry.ts` must recompute at drag speed on a
  tablet that may be offline; SQL cannot run there. There is no SQL twin.
  The known-answer tests (square = four 90s and four equal drives, line =
  zero turns, wrap past 0/360) ran green before any UI existed.
- **NO OFFICIAL MAT ARTWORK, EVER.** The mat is a schematic rectangle at the
  real 45 x 93 inch proportions with labeled millimeter axes; missions are
  labeled markers at mentor-entered positions; the only image is the club's
  own photo, cropped to the borders and stretched, no calibration.
- **Planner tables are NOT in `supabase_realtime`, deliberately.** The
  surface is local-first with one effective editor per team by role; a
  refetch landing mid-gesture would clobber the plan under a child's finger.
  For the same reason the planner's queue gets NO `onChange` invalidate and
  the component owns its model for the session.
- **Every edit is a queued op, and zero-rows-back is interrogated.** Inserts
  replay as `23505` (success); updates ask for their rows back and, on zero,
  probe the row: still visible means REFUSED (shown), gone means the edit is
  moot (done). A delete that finds nothing left is a delete that worked.
- **`scoring_lines` makes the point total a plan, not a guess.** Mission
  scoring is a jsonb list with alternatives ("10 or 20") and per-item lines
  ("10 each seed"); summing all lines would be wrong, so the team ticks the
  lines it intends and the total sums exactly those.
- **`between_launches_s` exists because the return trip is not the whole
  cost.** Routes start and end in the launch area (warned when they do not),
  but swapping the attachment and re-aiming costs real seconds; it is a
  configurable, defaulted to 8, so the 2:30 check fails in September instead
  of at the tournament.

### What was measured

- `tests/planner-geometry.test.ts`: 20 known-answer cases, no stack needed.
- `tests/strategy-isolation.test.ts`: reads stop at the team line (service
  role positive control on every denial), writes stop at `strategy_can_edit`,
  the composite FK refuses a forged `team_id` with `23503` before RLS is
  consulted, and the covering rule flips live: second checked in edits,
  absent primary filtered to zero rows; primary checks in and it flips back.
- **The permissive-direction mutation.** `waypoints` SELECT and UPDATE
  policies temporarily set to `using (true)`, `db reset`, and exactly the
  four guarding tests went red (cross-team read, teammate write, both
  covering-rule denials); file restored byte-identical
  (md5 0d5791b847201e3d51c2c9247e6b5f31 before and after), reset, green.
- `tests/strategy-offline-replay.test.ts`: the SAME op applied twice through
  `applyPlannerOp` (the queue's real code path) lands exactly one row; the
  NEGATIVE CONTROL replays the same payload under a different id and gets a
  second row, proving dedup comes from the client-minted id. A teammate's
  filtered update is reported as a refusal message, not success.
- `tests/strategy-snapshot.test.ts` and `tests/planner-mat.test.ts`: the
  version copy is faithful with fresh ids, refusals are in the caller's own
  terms; mat_config and the mat bucket are mentor-write, everyone-read.
- **The harness round trip, in the browser.** One scripted tap on the mat
  became `planner_insert waypoints` in the persist log; drag became
  `planner_update`; long-press became `planner_delete`; Undo re-inserted
  under the SAME id. A sentinel edit inside `MoveList.svelte` moved the
  harness via HMR and was restored byte-identical (md5 checked); the dev
  guard inverted answered 404 and restored answered 200.
- **End to end as a real student.** Signed in through the real login screen
  as the seeded Blue Team run captain, created the strategy, tapped three
  waypoints, reloaded: same movement list back from Postgres. Then severed
  `window.fetch`, made an edit ("Offline. 1 change kept on this device."),
  restored fetch, and the 8-second heartbeat flushed it ("Saved"); the
  waypoint was present after reload.
- **375px and 1440px: 0px horizontal overflow** across all four harness
  scenarios (captain, viewer, mentor, empty), measured as
  `scrollWidth - clientWidth` with an uncontained-descendant sweep.
- `npx svelte-check`: 0 errors, 0 warnings (563 files). Full suite: 23 files,
  246 tests, all green against the real stack.

### What is explicitly NOT verified

- **The mentor planner view through a real Google sign-in** (OAuth needs a
  human here). The mentor path shares `PlannerPage`/`RoutePlanner` with the
  student path that WAS driven end to end, and the harness's mentor scenario
  exercised marker placement; the console page shell around it was not
  clicked by a mentor session.
- **A real iPad.** Touch gestures were exercised as scripted pointer events
  at 375px/1440px in the Browser pane, not on hardware; long-press timing
  (550 ms) and pan feel are untested on a physical screen.
- **The mat photo path end to end.** Bucket policies are tested (mentor
  writes, student reads, student cannot write or delete); the client-side
  canvas JPEG conversion and the rendered background layer were not driven,
  because uploading needs a mentor session.
- **Concurrent editors.** Last-write-wins per row is the design; two devices
  editing one launch simultaneously was not exercised.

### Deferred

- **Inserting a waypoint mid-route.** Tap appends; a missed stop means
  deleting back or dragging. The schema needs nothing new (`sort_order` is
  already the order), only UI.
- **Pinch zoom on the mat.** Zoom is 1x/2x/3x buttons with drag-to-pan;
  two-finger pinch is inert.
- **Mission positions and the launch area themselves.** The tables ship
  empty of geometry on purpose; a mentor enters the rulebook numbers on the
  real mat_config row and mission markers before the planner is useful.

---

