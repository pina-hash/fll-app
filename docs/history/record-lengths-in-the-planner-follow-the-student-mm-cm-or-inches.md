---
title: "2026-08-25 -- Lengths in the planner follow the student: mm, cm or inches"
date: 2026-08-25
branches: []
migrations: []
subsystems: ["Route planner, field picture"]
record_order: 14
---

Every length the planner SHOWS now follows one switchable preference, a
mm / cm / in toggle beside the zoom buttons: the movement list's drives, the
launch "Drives ..." summary, the mat's axis ticks and captions, and the
measurement fields (robot width, length and speed; the mentor's Base width
and height). Turns stay degrees; seconds stay seconds.

- **Display only, converted in one module** (`src/lib/planner/units.ts`).
  The model, the queue, the geometry and every stored column stay exactly
  what they were: waypoints, missions and mat_config in millimeters,
  team_robots.speed_cm_s in cm/s. The fields convert on the way in (typed
  8 in -> 203 mm stored) and the existing clamps and rounding in
  persistRobot()/persistMatSetup() still run on the mm value, so no check
  constraint ever sees a converted number.
- **The preference is per device**, localStorage under `fll-planner-units`,
  guarded, defaulting to centimeters (what the SPIKE blocks default to and
  what the movement list always showed). Anyone may switch it, including a
  view-only teammate and a reader of the example plan, because it changes
  nothing but rendering.
- **Inches get their own axis ticks.** The mat is exactly 93 by 45 inches,
  so the inch axis ticks at 0, 12, 24 ... 93 and 0, 12 ... 45 instead of
  labelling the metric positions "39.4". Tick POSITIONS never convert (they
  are the drawing's mm); 93 in is 2362.2 mm, 0.2 past the stored mat width,
  so the edge tick is pinned to the frame.

### Measured

- In a browser at 375 (harness, real component): the same route reads
  "Drive 64.6 cm", "Drive 646 mm", "Drive 25.4 in" across the toggle; the
  launch summary and both axes follow; the robot width field reads 170 /
  17 / 6.7; typing 8 with inches selected stores 203 mm (shown 20.3 cm) and
  lands the robot_profile op in the persist log; the preference survives a
  reload; a viewer can switch units while every field stays disabled;
  0px horizontal overflow with the three extra buttons in the controls row.
- `tests/planner-units.test.ts` proves the conversions, the formatting
  precision, the tick tables and the storage-less default by arithmetic;
  the DB-free set is now 10 files, **208 tests, all passing**.
- `npx svelte-check`: **0 errors, 0 warnings, 681 files.**

### Not verified

- Same environment constraint as the two bundles above: no local stack, so
  the DB-backed suite did not run. This bundle writes the same rows with
  the same values it always did (mm and cm/s), only entered through a
  conversion; run `npx vitest run` on a machine with Docker.

### Deferred

- The keyboard nudge steps (10 / 50 mm) do not follow the unit; they are
  gesture size, not display.
- The calibrator's corner fields stay in image fractions: mentor-facing,
  image-space, not lengths.

