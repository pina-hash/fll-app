---
title: "2026-08-23 -- Mentor console: schema 0009, the live board, meeting control, provisioning, tasks"
date: 2026-08-23
branches: []
migrations: ["0009"]
subsystems: ["Mentor console"]
record_order: 3
---

### What changed

**Schema.** One migration, `supabase/migrations/0009_console_accents_roles_phases.sql`:

- `teams.accent`, a `public.team_accent` enum (`cyan`, `chartreuse`,
  `magenta`, `amber`), backfilled distinct across the existing teams and
  granted to `authenticated` for UPDATE alongside `name` and
  `fll_team_number`. `join_code` still has no client write grant.
- `team_create` gains `p_accent` and the old two-argument version is dropped
  first (the signature trap). `_next_team_accent()` picks the least-used
  accent when the caller does not name one.
- `team_resolve_roles(p_team_id, p_meeting_id, p_on_date)` -- the ONE
  definition of active-role resolution. Returns a set, one row per role.
- `board_live_summary(p_meeting_id)` -- everything the live board draws, in
  one round trip, sorted by who needs the mentor most.
- `meeting_start`, `meeting_advance_phase`, `meeting_end` -- atomic phase
  control.
- `team_regenerate_join_code` -- rotates the code AND re-mints every student
  login on the team.
- `role_assign` / `role_unassign` -- role changes that get past 0005's
  exclusion constraints instead of failing on them.
- `_app_timezone()` / `_app_today()` / `_app_day_start()` -- the season's
  clock, private.
- `auth_whoami` gains `accent` on its student branch (same signature, so a
  plain replace).

**Design system.** `src/lib/design-system/team-accents.css` (new, imported
last from `index.css`) turns the `data-accent` attribute into
`--team-accent`, `--team-accent-ink`, `--team-accent-wash`,
`--team-accent-shadow`. `colors.css` gains `--glow-chartreuse` and
`--glow-magenta` and corrects `--boundary` (see below).

**App.** `src/lib/console/` (types + parsers, clock/format helpers, the
`BoardFeed` realtime controller, `LiveBoard.svelte`, the session PIN store)
and the route group `src/routes/app/(mentor)/` holding `board`,
`board/[teamId]`, `meeting`, `teams`, `teams/[teamId]`,
`teams/[teamId]/card` and `tasks`. Plus the dev-only harness at
`src/routes/dev/live-board/`.

**Docs.** `CLAUDE.md` gains the **## Writing** section (no em or en dashes,
repo-wide) and its build phases move on. The five existing violations were
fixed.

### Load-bearing decisions

- **The accent is an ENUM, not a hex string.** The database owns which team is
  which; the stylesheet owns what the colour is. A hex column would put a
  second palette outside `src/lib/design-system/`, which the repo's visual
  rules forbid, and it would let a mentor pick an unreadable colour. The
  server prints `data-accent="magenta"` and CSS does the rest, so no inline
  style ever carries a team colour.
- **It is NOT unique-constrained.** Four accents and four teams line up today,
  but a fifth team must still be creatable. `team_create` picks the least-used
  accent and the console labels the ones already taken; that is a nudge, not a
  constraint.
- **Active-role resolution is one SQL function, called from three places.**
  The live board, the team drill-in and the roster pane all ask
  `team_resolve_roles`. Three TypeScript implementations of "primary if
  present, else second if present, else nobody" would drift within a season.
  The provisioning pane calls it with NO meeting, which makes every
  `active_*` column null and leaves exactly the assignment data that pane
  edits: one function, two questions.
- **It returns a SET, not jsonb, which diverges from the house RPC shape.**
  Its main caller is a `cross join lateral` inside `board_live_summary`;
  returning jsonb would mean unpacking it in SQL to count unfilled roles.
  PostgREST still serialises it to a JSON array for the two screens that call
  it directly.
- **It is SECURITY DEFINER with the caller re-checked in the WHERE clause.**
  It has to call the private `_app_today()`, and a `security invoker`
  set-returning function would need those helpers granted to `authenticated`.
  An unauthorised caller gets zero rows rather than an error, so a team a
  student may not see answers exactly like a team that does not exist.
- **"Today" is a LOCAL date, and the board does not use a date at all.** A
  Friday session runs 16:30-18:00 in Rosemead, which is 23:30-01:00 UTC: half
  of every Friday meeting falls on the next UTC day, so `created_at::date =
  current_date` would split a session in two. Role assignments go through
  `_app_today()`; the board's counts are scoped to the meeting's own window
  (`started_at` to `now()`), which is what a mentor means by "today" while
  standing in the room.
- **The board refetches instead of patching.** Every realtime event schedules
  one debounced refetch of the whole snapshot. Recomputing four rows of
  derived counts in the browser from a stream of INSERT/UPDATE/DELETE would be
  a second implementation of 0009's SQL. Measured cost: a few hundred bytes.
- **The snapshot carries `server_now` and the client corrects for skew.** The
  phase clock is the one number a mentor trusts in the room; a tablet four
  minutes fast would show four minutes of phantom overrun.
- **Phase control is three RPCs, not three client UPDATEs.** Advancing moves
  the outgoing phase's `ended_at`, the incoming phase's `started_at` and
  `meetings.current_phase_id` in one transaction under a `for update` lock on
  the meeting. A half-landed phase change leaves a table of nine-year-olds on
  the wrong task for twenty minutes. One commit is also one realtime
  broadcast.
- **Nothing auto-advances on overrun.** The board and the meeting screen show
  `+8:00` in amber; the mentor decides. Advancing is behind a confirm step
  because a mis-tap mid-session is expensive.
- **Rotating a join code rewrites every login on the team.** 0003 said this
  operation would not exist, because the code is half of a student's address.
  The console needs it, so `team_regenerate_join_code` does it properly:
  `teams.join_code`, then `auth.users.email` and
  `auth.identities.identity_data` for every student, then their sessions are
  dropped. PINs are untouched. 0003's header is now wrong on that one point
  and 0009's header says so.
- **`role_assign` exists because the constraint is right and the INSERT is
  wrong.** 0005 refuses an overlapping holder with 23P01, which is correct and
  which a naive console INSERT hits on every reassignment. The RPC ends the
  assignments in the way first. An assignment made TODAY is deleted rather
  than stamped, because `effective_to > effective_from` makes closing a
  same-day row impossible and because "undo what I just did" is what the
  mentor means.
- **A PIN cannot be read back, and the printable card says so.** `student_create`
  and `student_reset_pin` bcrypt the PIN immediately (0004), so the roster card
  can only print a PIN this browser tab watched being minted. Those values live
  in `sessionStorage` (`src/lib/console/pins.ts`) and the card offers "reset
  every PIN on this team" for the case where the cards are stale. The
  alternative -- storing a recoverable PIN -- was rejected: it would make the
  database hold plaintext credentials for minors to save one reprint.
- **`--boundary` was raised from `#3a4a66` to `#5c7199`.** CLAUDE.md claims it
  clears 3:1 on every ground; measured, the old value was 2.10:1 on
  `--surface-0`. The rule was the intent and the value failed it, so the value
  moved. See the measurements below.
- **`.btn--small` returns to 44px under `@media (pointer: coarse)`.** The
  compact button is a desktop affordance for dense table rows; on the phone
  the mentor is tapping one-handed while walking.
- **The mentor guard is a route GROUP, not a per-page check.**
  `src/routes/app/(mentor)/+layout.server.ts` throws 403 once for every
  console surface, so a new page under it cannot forget.

### What was measured

All on 2026-08-23, against the local stack and (where stated) the linked
project `ypusbfatsmoukvlfgrqf`.

- **The seed HAD run on the linked project**, contrary to the premise this
  bundle started from. Four teams with valid join codes and both phase
  templates (friday 90 min, saturday 120 min) were already present, plus one
  admin mentor (`apina@boscotech.edu`). Nothing needed seeding; the accents
  were set after the push to match `seed.sql`.
- **Join codes on the linked project:** Red `VCPW2G`, Blue `FJ2L34`, Green
  `XE38BB`, Gold `J7D3YB`. The local stack has its own, different codes.
- **`supabase db push` applied 0009 to the linked project** and all nine new
  functions are present in `pg_proc` there.
- **`supabase db reset` re-applies the whole chain plus the seed cleanly**, and
  the backfill produced four distinct accents.
- **`npx vitest run`: 14 files, 143 tests, all passing.** Five new files:
  `console-role-resolution` (13), `console-meeting-phases` (10),
  `console-mentor-only` (13), `console-live-board` (8), `team-join-code` (8).
- **`npx svelte-check`: 0 errors, 0 warnings**, which is the baseline.
- **Active-role resolution, all three branches, against real attendance:**
  primary present holds the seat; primary out with the second in gives
  `active_tier = 'second'`; neither present reads unfilled. Confirmed in the
  browser too: checking Lena T. in flipped Red Team's Run Captain from
  "Nobody in the seat" to "Lena T. (primary)" with no other change.
- **The exclusion constraint was reproduced before the RPC was trusted.** A
  raw INSERT over an existing holder returns `23P01`; `role_assign` in the
  same file then does the same thing successfully. A test that only asserted
  the RPC works would not have shown the RPC was necessary.
- **The phase broadcast, two clients, no reload.** Meeting control in one tab,
  the live board in another. Advancing moved the board from "Huddle 1 of 4" to
  "Role Blocks 2 of 4" with `performance.getEntriesByType('navigation').length
  === 1` on the board tab throughout.
- **NEGATIVE CONTROL for that claim: the board does not poll.** After 65
  seconds open it had made exactly two `board_live_summary` calls, one at
  mount and one at the moment of the advance. A one-second poll would have
  made about 65.
- **The dev harness mounts the REAL component.** `stat__label` inside
  `LiveBoard.svelte` was changed to `HARNESS-PROOF-9137`, the harness showed
  it through HMR, and the file was restored byte-identically
  (md5 `df3ea0657b11afe07753006480275cda` before and after).
- **NEGATIVE CONTROL for the dev guard.** Inverting `if (!dev)` to `if (dev)`
  made `/dev/live-board` return 404; restored byte-identically (md5
  `cc4f50e6fefd1abab1c2247d32db04fe`).
- **Mentor-only, both directions, at BOTH boundaries.** With a student
  session, `/app/board`, `/app/meeting`, `/app/teams`, `/app/tasks`,
  `/app/board/[id]`, `/app/teams/[id]` and `/app/teams/[id]/card` all answered
  403 while `/app` answered 200; with a mentor session the same seven answered
  200. At the database, every console RPC refuses a student in a sentence, and
  the same call as a mentor succeeds in the same test.
- **Viewports.** Live board at 1440px: four cards across, no horizontal
  overflow. At 375px: one column, four stat cells of 70px with no label
  clipped, phase strip sticky, body text 17px, no horizontal overflow. Every
  console surface measured 0px page overflow at 375px after the fix below.
- **A real layout bug was found and fixed at 375px:** the roster table
  (`min-width: 34rem`, deliberately, so the columns stay readable) pushed the
  whole grid track 231px past the viewport, because a grid item defaults to
  `min-width: auto`. Adding `min-width: 0` to the detail pane's children made
  the table scroll inside its own wrapper (301px visible, 544px content) with
  0px page overflow.
- **Contrast, computed rather than eyeballed** (against `--surface-0` /
  `--surface-1` / `--surface-2`): cyan 11.0 / 10.2 / 9.1; chartreuse 14.5 /
  13.5 / 12.1; magenta 8.1 / 7.5 / 6.7; amber 12.0 / 11.1 / 10.0. Each
  accent's ink on its own accent: 9.8, 13.0, 7.9, 10.8. The old `--boundary`
  measured 2.10 / 1.95 / 1.74; the new one measures 3.81 / 3.54 / 3.16.
- **Bulk task creation** wrote one task to all four teams in one statement and
  the board picked all four up over realtime without a reload.
- **The printable card** resolved each student's roles through
  `team_resolve_roles`, and "reset every PIN" produced six six-digit PINs and
  a complete card.

### What is explicitly NOT verified

- **The production build.** `npm run build` still dies on Windows in
  `@sveltejs/adapter-vercel`'s `closeBundle` with a symlink `EPERM`, so the
  `/dev/live-board` 404 was proven by inverting the guard under `vite dev`
  rather than by loading a production bundle. The guard is `dev` from
  `$app/environment`, which is a compile-time constant in a build.
- **The console against the LINKED project.** 0009 is applied there and the
  functions exist, but every browser and test measurement above ran against
  the local stack. Production has no students, no meetings and no tasks yet.
- **Realtime under a genuinely dropped connection.** The reconnect path
  (`CHANNEL_ERROR` -> `reconnecting` -> refetch on resubscribe, plus the
  `online` and `visibilitychange` listeners) is written and reachable but was
  not exercised by actually severing the socket; the no-polling measurement
  above covers the happy path only.
- **Print output.** The `@media print` rules were written and the card renders
  on screen, but no PDF or paper output was produced.
- **Screenshots.** The session could not composite browser frames, so every
  visual claim above is a measurement (computed styles, geometry, text
  content), not an image.
- **Two mentors advancing the same phase simultaneously.** The `for update`
  lock makes the second one see the first one's result, but that race was not
  driven.

### Deferred

- **Editing the phase templates from the console.** Meetings are created from
  the friday/saturday templates as seeded; changing a template still means SQL.
- **Stepping a phase BACKWARDS.** Only forward and end exist. A mis-tap is
  guarded by a confirm step instead, which was the cheaper answer for one
  season.
- **Assigning a task to a specific student from the console.** The column and
  the constraint exist (`tasks.assigned_student_id`); the create form offers a
  role queue instead, which is how the plan is actually written.
- **Archiving a team from the console.** `teams.archived_at` is grant-writable
  and the layout already reads it, but no button sets it.
- **A mentor roster screen** (promote to admin, deactivate a mentor). 0002
  supports it through RLS; nothing in the console surfaces it.
- **Attendance for the student runtime.** The console checks students in from
  the team drill-in, which is the mentor's path; the student's own check-in is
  the next build.
---

