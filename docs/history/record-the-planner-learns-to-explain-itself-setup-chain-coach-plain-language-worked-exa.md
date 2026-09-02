---
title: "2026-08-25 -- The planner learns to explain itself: setup chain, coach, plain language, worked example"
date: 2026-08-25
branches: []
migrations: []
subsystems: ["Route planner, field picture"]
record_order: 13
---

**The finding this bundle answers, verified before building:** a first-time
user of the route planner saw one line of text and nothing else. With no
strategy row the component rendered only the empty card ("No plan yet. The Run
Captain or a mentor starts it."), so a teammate hit a dead end and a captain
got one unexplained button; after starting, the mat was a blank schematic,
because 0011 seeds all 15 missions with NULL positions (deliberately), the
launch area ships null, and no picture exists. Nothing said who had to fix
any of that, and the movement list, the planner's actual product, was the
last thing a phone reached. Confirmed in a browser through the dev harness
(the real component, `plan: none`) at 375px before any change was made.

### What changed

- **The setup chain is stated, once** (`src/lib/planner/setup.ts`): mission
  dots placed, Base marked, picture none/uncalibrated/ready. A mentor gets a
  checklist card with the actions on it: "Place the dots" walks every
  unplaced mission one tap at a time (the notice advances itself and counts
  down), "Set the Base size" opens and scrolls to the mat setup panel,
  "Finish calibrating" resumes a stalled picture. A student gets one honest
  sentence naming what their mentor still has to do, and never a disabled
  control; the trailing clause respects `canEdit` ("You can still draw a
  route now" vs "Your team can still plan now").
- **The mat always renders.** The empty-plan card sits above it instead of
  replacing the whole surface, so the first screen is a mat with a next
  action on it, never a blank page.
- **The coach** (`src/lib/planner/PlannerCoach.svelte`): a six-step
  first-run walkthrough whose steps check themselves off LIVE from the plan
  (start, first point in Base, second point, read the numbers, add a
  mission, end in Base). Skippable (Hide, persisted per device in
  localStorage under `fll-planner-coach-hidden`, try/catch), reopenable from
  the toolbar Help button, auto-opens for students only, and carries "Words
  to know": launch, Base, mission, attachment, and the 2:30 bar, each in one
  sentence. The 2:30 bar also answers "What is this bar?" inline on the time
  card.
- **The movement list is the point of the screen.** On a phone the order is
  mat, Robot moves, match clock, missions, launches, settings; on desktop
  the moves panel is the TOP of the side column. Implemented with
  `display: contents` wrappers and `order` under 64rem, so the two-column
  desktop layout is untouched. (Cost, accepted: below 64rem the visual order
  differs from DOM order; screen readers hear mat, missions, clock, moves.)
- **Visible undo and delete.** Undo moved from the toolbar to the mat
  controls, next to where edits happen. Tapping a point now raises a bar
  naming it ("Point 3 is picked.") with a Delete button and Done; long-press
  still works and the hint mentions both. Undo also covers a mentor's dot
  placement (mission_move no longer requires `editable`, which was false for
  a mentor before any plan existed).
- **The worked example** (`src/lib/content/example-strategy.ts`,
  `src/lib/planner/ExamplePlan.svelte`, routes
  `/app/me/plan/example` and `/app/plan/example`, harness
  `/dev/example-plan`): two launches against real missions (M01+M03,
  M08+M05), routes that start and end in Base, rendered through the REAL
  RoutePlanner behind an EXAMPLE banner that says what it is and that the
  dots are example spots. It is CONTENT, not rows: canEdit false, no
  onPersist, no database row anywhere, so "cannot be edited into their plan"
  and "cannot be deleted by a student" are structural, not policied. The
  banner links back to the caller's own planner. "See an example plan"
  appears in the empty state and in the coach.
- **The season mission list moved to content**
  (`SEASON_MISSIONS` in `example-strategy.ts`), mirroring 0011's seed the way
  `student-identity.ts` mirrors `_student_email`; the dev harness and the
  example both render from it. The database stays the authority for live
  screens.
- **Plain-language pass over every planner string.** The full list is in the
  bundle's commit; the load-bearing rewrites: "working copy" became
  "(editing now)" and the version select hides until a second version
  exists; "Save a version" became "Save a copy" with one sentence of why;
  waypoints are "points" everywhere a student reads (including aria labels);
  the mat hint teaches tap/drag/pick-then-Delete; "Does not fit: cut 0:12
  somewhere" became "Too long: ... make a route shorter or take out a
  mission"; "Planned points" became "Points if it all works"; the
  returns-to-base warning now says WHY Base matters; "Attachment" is kept
  (real FLL vocabulary) and taught inline and in the glossary; launch is
  kept and taught as "one trip out of Base". Mission chips got a heading and
  a one-line how-to per audience. Every empty state names the next action
  and who takes it.
- **The dev harness** grew the axes the diagnosis needed: plan
  (two launches / none), mat setup (ready / nothing set up), the three roles
  unchanged. The 'empty' scenario is gone; 'none' plus a role covers it.

### Load-bearing decisions

- **The example is a module, not a migration.** CLAUDE.md's rule ("content
  is editorial and lives in src/lib/content/ as typed modules") plus the
  brief's two immutability requirements decide it: a row can be protected by
  policy; a module cannot be written at all. No migration ships in this
  bundle, and the missions table still seeds no positions.
- **Mission dots on the example are declared example spots** in the banner
  copy, because inventing REAL positions was ruled out in 0011 and a worked
  example without dots teaches nothing.
- **The student setup sentence never mentions the picture.** The picture is
  optional; a child cannot act on it; the two things that shape their mat
  (dots, Base) are the two things named.

### Measured

- **First-run captain path, end to end, in a browser** (headless Chromium,
  375x812, the real component in the harness): empty state names the next
  action, Start creates the plan, two taps create points 1 and 2, the moves
  panel shows "Drive 100.0 cm", a mission tap lights the chip and the trip,
  and the coach's first five steps check themselves off in the same session;
  the persist log shows exactly the expected five ops in order. Point
  selection raises the bar, Delete removes the point, Undo restores it
  (5 -> 4 -> 5 waypoints on the fixture plan).
- **Mentor path from zero**: checklist shows 0 of 15 and both unmet steps;
  "Place the dots" enters the run (notice: "Tap the mat where M01 (Drone
  Survey) sits. 14 more after this one."), a tap places M01 and the notice
  advances to M02 with the checklist reading 1 of 15; "Set the Base size"
  opens the mat setup details. The student's blocked sentence is derived
  from the same `setupState()`, so the clearing was exercised by the same
  data change.
- **The example cannot be changed, measured as absences**: 0 Undo, 0 Save a
  copy, 0 Add/Delete launch, 0 Place on mat, 0 version select, 0 enabled
  mission buttons, 0 enabled settings inputs; a mat tap and an 800ms
  long-press on a point leave the waypoint count at 5. **Positive control:**
  the same gestures in the captain harness add and delete waypoints and land
  ops in the persist log.
- **375 and 1440, both grounds, 0px horizontal overflow** on the harness and
  the example page. **Negative control:** a 600px div injected at 375
  reports 225px through the same check.
- **Both grounds eyeballed via screenshot**: the coach's success-fill check
  circles, the warning-toned setup note, the EXAMPLE tag on the accent fill,
  and the mat's light plate all resolve from existing measured token pairs;
  no new colour was invented and no token redefined.
- **Coach persistence**: Hide survives a reload; Help reopens it; the
  glossary answers launch, Base and 2:30.
- `npx svelte-check`: **0 errors, 0 warnings, 680 files.**
- The 9 database-free test files: **199 tests, all passing** (geometry and
  calibration among them, untouched).

### Not verified

- **The DB-backed suite did not run, and no real signed-in session was
  driven.** Same environment constraint as the previous bundle: the network
  policy answers 403 to the Docker registry CDNs, so `supabase start` cannot
  pull images and there is no local stack, no GoTrue, no PostgREST. The
  student and mentor first-run paths were driven through the dev harness
  (the real component, fixture props), not through `/app` as a real student
  and mentor. Nothing in this bundle touches SQL, RLS, an RPC, a policy or
  a grant, so what the stack would add is confirmation that `loadPlannerData`
  still feeds the same props; run `npx vitest run` on a machine with Docker
  before trusting that.
- **Nothing was pushed to the linked Supabase project, because there is
  nothing to push**: no migration file was created; `supabase/` is
  byte-identical. `supabase migration list --linked` was also not runnable
  here: this checkout has no `.env` and so no `SUPABASE_ACCESS_TOKEN`
  (gitignored, per the credential rule). Production remains at 0020.
- **No real child read these strings.** The fourth-grade judgement is an
  editorial pass, not a reading test.

### Deferred

- **DOM order vs visual order below 64rem** (see above): revisit if
  screen-reader use on phones materialises.
- **The coach does not localise its checkmark glyph** ('✓' is a glyph, not
  an icon asset); fine for this club.
- **A "watch" walkthrough for view-only teammates**: they currently get one
  explanatory paragraph and the glossary, not steps of their own.

