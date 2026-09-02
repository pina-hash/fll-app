---
title: "2026-08-23 -- Skill Hub port: schema 0011, content modules, `/app/library`"
date: 2026-08-23
branches: []
migrations: ["0011"]
subsystems: ["Skill Hub, notebook"]
record_order: 5
---

### What changed

Ported the standalone `pina-hash/fll-camp` static site into this repo so
mentors and students have one place instead of two. Everything a student or
mentor could reach in fll-camp is now reachable at `/app/library`: the seven
Skill Hub categories (Meet the Robot, Robot Game Missions, Core Values,
Innovation Project, Build & Programming, the Mechanisms Library, the Video and
Resource Library), the official BIOGLOW season documents (Tier 1 always
visible, Tier 2 grouped, the Challenge Updates warning intact), and the three
Baby Sharks course PDFs (the FLL Coding Course labeled as season content, Intro
to Python and Basic Engineering labeled optional).

- **Content is `src/lib/content/*.ts`, typed, not JSON.** `categories.ts`,
  `resources.ts`, `media.ts`, `seasonDocs.ts`, `babySharks.ts`, and
  `missions.ts` (editorial text only, see below). fll-camp's five files
  (`content.js`, `missions.js`, `resources.js`, plus its two React components'
  inline copy) became six typed modules with the same data, same wording,
  reviewed as a normal diff.
- **The one exception: `0011_missions_and_team_notes.sql`.** The `missions`
  table holds the 15 BIOGLOW missions' code, name, points label, scoring lines
  (jsonb), and a nullable `position_x_mm`/`position_y_mm` a mentor can set --
  seeded by the migration itself (idempotent upsert on `code`, never touching
  an already-set position) because the next bundle's route planner references
  a mission by database id and a mentor edits its mat position at runtime,
  neither of which git can hold. `team_mission_notes` replaces fll-camp's
  single browser-local-storage strategy note (shared, and lost on device wipe)
  with one row per team per mission, RLS-scoped exactly like `tasks`: a mentor
  reads and writes every team's, a student reads and writes only their own.
  MATCH_BASICS (Equipment Inspection, Precision Tokens) stayed content-only:
  they are not mission models and the route planner has no reason to
  reference them.
- **`/app/library` sits directly under `/app`, outside both `(mentor)` and
  `(student)`.** Its own `+layout.server.ts` admits a mentor or a student and
  403s a board device -- the Hub is not gated by role, phase, or check-in, but
  a shared iPad has no reason to browse it. The mentor console shell renders
  it with the existing chrome (`Library` added to `NAV`); a student gets a
  compact header of its own, same pattern as the Team tab, reached from a new
  "Look something up" slab on My Screen (`StudentScreen.svelte`).
- **The strategy-notes editor only exists for missions.** fll-camp's other
  five item categories also had a notes box (keyed by device, not team); this
  port keeps their `prompt` as a read-only "Think about it" line and does not
  build a persistence UI for them -- the task's one carved-out exception was
  missions, and building five more note tables was not asked for.
- **The 225-step competition bot manual** is now `static/build/comp-bot-manual.pdf`
  (fll-camp's own self-hosted copy, not a new download from Google Drive).
  Everything else stays link-only: PrimeLessons, FLL Tutorials, Baby Sharks,
  and every FIRST publication are referenced by URL, never fetched or mirrored.

### Why

One config surface instead of two divergent copies drifting between fll-camp's
GitHub Pages deploy and this app. Missions became relational because the very
next bundle (a route planner) needs to join a mission to a mat position and a
team's plan; nothing else in the Hub has that shape.

### What was measured

- **`svelte-check`: 0 errors, 0 warnings**, re-derived with
  `npx svelte-kit sync && npx svelte-check` (532 files).
- **`npx vitest run`: 198 passed, 0 failed**, including a new
  `tests/missions-team-notes.test.ts` that proves both directions on the new
  tables: 15 missions exist and are readable by both populations; only a
  mentor can move a mat position (student write returns zero rows via
  `.select()`, per the RLS-filtered-write gotcha, not an error); a team A
  student cannot read, insert into, or update team B's note, by id and by SQL,
  against the service-role positive control; `team_id`/`mission_id` are
  blocked at the grant level for a student and, proved separately under the
  service role (which bypasses grants), by the `_immutable_columns` trigger
  itself. `tests/schema-catalog.test.ts`'s `TABLES` list gained `missions` and
  `team_mission_notes`; `tests/db/harness.ts`'s `cleanupRun()` gained a
  `team_mission_notes` delete so a run that creates notes cleans up its teams
  without a foreign-key error.
- **Mission count and point values**: `select count(*) from public.missions`
  is 15; each `points_label` and `scoring` line was checked by hand against
  fll-camp's `src/state/missions.js` during the port and again by reading the
  rendered `/app/library/missions` page.
- **Every external link, checked 2026-08-23.** 67 of 68 distinct URLs
  returned 200 to a browser-UA `curl`. The three Baby Sharks PDFs (on a Wix
  `filesusr.com` bucket that rejects a bare curl/headless UA) were confirmed
  with a browser-UA curl AND opened in the Browser pane to be sure. One dead
  link found and fixed: `reliability` (fll-camp's
  `/en/worksheets/2020/07/16/Guided-Mission.html`, used by BP5, BP9, and the
  Strategy topic band) 404s. Pointed at the FLL Tutorials category index with
  a `// TODO verify-link` comment, per the link-policy fallback CLAUDE.md
  already documents, rather than guessing a replacement worksheet.
- **Viewports, 0px overflow at both ends**: `/app/library`,
  `/app/library/missions`, `/app/library/missions/M09`,
  `/app/library/mechanisms/MECH2`, `/app/library/documents`, and
  `/app/library/media` at 375px and 1440px.
- **Negative control on the RLS claim**: before the fix, a plain `.update()`
  without `.select()` against a denied row returned `error: null`, which is
  what `tests/missions-team-notes.test.ts` calls out explicitly as the
  RLS-filtered-write gotcha CLAUDE.md warns about, rather than mistaking it
  for a passing test.
- **End-to-end through the real login**: signed in locally as a seeded
  student (PIN reset via `student_reset_pin`, the same RPC
  `tests/student-auth.test.ts` already proves), opened
  `/app/library/missions/M13`, wrote a strategy note, reloaded, and confirmed
  the same text came back from a fresh page load, then confirmed directly in
  Postgres that the row landed against the signed-in student's own team.
  Confirmed a board-device session gets a 403 from `/app/library`.

### What is explicitly NOT verified

- **The mentor console's own view of `/app/library`**, end to end through a
  real Google sign-in. Mentors authenticate via OAuth, which needs a human in
  this environment; the guard logic is symmetric with the student path
  (`+layout.server.ts` admits `mentor | student`, refuses `board`) and is
  covered by `svelte-check` and the existing mentor-only test suite, but the
  rendered mentor view (the team-selector dropdown on a mission's note editor
  in particular) was not clicked through by a mentor session.
- **The other 60-odd FIRST season document and PrimeLessons/FLL Tutorials
  links**, beyond the one bulk curl pass and the handful opened in-browser.
  A curl 200 is evidence the URL resolves, not that the PDF is intact; only
  the three Baby Sharks PDFs and a couple of representative pages were opened
  and read.
- **A real Android/iPad browser** for the new `/app/library` surfaces --
  checked at 375px/1440px in the Browser pane, not on hardware.

### Deferred

- **Team-scoped notes for the other five item categories** (Meet the Robot,
  Core Values, Innovation Project, Build & Programming, the Mechanisms
  Library). Their `prompt` renders read-only; only missions got the database
  treatment, per the task's one exception.
- **A working replacement for the dead `reliability` link.** It falls back to
  the FLL Tutorials category index for now; the `// TODO verify-link` comment
  in `src/lib/content/resources.ts` is where to pick this up.

