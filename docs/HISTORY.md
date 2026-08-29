# fll-app engineering history

The per-bundle record: what each migration and code-only bundle changed, why it
was built that way, what was measured, and what was deliberately left undone.

**`CLAUDE.md` is authoritative for how to work in this repo. This file is the
record of how those rules came to exist.** If the two ever appear to disagree,
`CLAUDE.md` wins and this file is the dated account of an earlier state.
Entries are dated accounts of what shipped and are not edited to match later
changes.

## When to read this file

When you need the REASON behind a rule in `CLAUDE.md`, or are diagnosing a
subsystem and want to know what was measured when it shipped. Do not read it
end to end; jump by migration number.

## How to append

A shipped bundle appends a new `##` section at the END, following the shape
below: what changed, the load-bearing decisions and why, what was measured,
what is explicitly NOT verified, and what was deferred. Add its row to the
migration index. Promote a line into `CLAUDE.md` only if it changes how a
future unrelated task should be done.

## Migration index

| File | Bundle |
| --- | --- |
| `0001_foundation_types_helpers.sql` | 2026-08-22 foundation |
| `0002_mentors.sql` | 2026-08-22 foundation |
| `0003_teams.sql` | 2026-08-22 foundation |
| `0004_students.sql` | 2026-08-22 foundation |
| `0005_role_assignments.sql` | 2026-08-22 foundation |
| `0006_meetings.sql` | 2026-08-22 foundation |
| `0007_tasks_blockers_evidence.sql` | 2026-08-22 foundation |
| `0008_realtime.sql` | 2026-08-22 foundation |
| `0009_console_accents_roles_phases.sql` | 2026-08-23 mentor console |
| `0010_student_runtime_board_devices.sql` | 2026-08-23 student runtime |
| `0011_missions_and_team_notes.sql` | 2026-08-23 Skill Hub port |
| `0012_strategy_route_planner.sql` | 2026-08-23 route planner |
| `0013_roster_cap_and_self_enrollment.sql` | 2026-08-23 roster, parents, match runs |
| `0014_parent_access.sql` | 2026-08-23 roster, parents, match runs |
| `0015_match_runs.sql` | 2026-08-23 roster, parents, match runs |
| `0016_engineering_notebook.sql` | 2026-08-23 engineering notebook |

---

## 2026-08-22 -- Foundation: scaffold, schema 0001-0008, RLS, both auth paths

### What changed

A new repository, modelled on `pina-hash/idea-app`'s conventions (migration
shape, SECURITY DEFINER RPC shape, realtime publication block, soft-delete
stamps, flat test layout, CSS-token design system) with none of its schema or
business logic. Eight migrations, a local-only seed, a vitest suite of 90 tests
against the real local stack, and the smallest app that exercises both sign-in
paths: `/login`, `/auth/callback`, `/auth/error`, `/auth/signout`, and a
placeholder `/app` shell.

### Load-bearing decisions

- **One Auth instance, two populations, one trigger.** `0002`'s
  `handle_new_auth_user` on `auth.users` is the gate for everyone: Google +
  boscotech.edu becomes a mentor (first one is admin, under an advisory lock);
  `@fll.invalid` is accepted only while `student_create` has raised a
  transaction-local GUC (`fll.creating_student`); everything else raises,
  which aborts GoTrue's insert and therefore the sign-in. Both the SQL path
  (the exact insert GoTrue performs) and the GoTrue paths (public sign-up,
  admin `createUser`) are tested.
- **Student creation and PIN reset are SQL.** `student_create` writes
  `auth.users` (every token column `''`, not NULL -- GoTrue scans them into
  Go strings), `auth.identities`, and `students` in one transaction.
  `student_reset_pin` writes `encrypted_password = extensions.crypt(pin,
  extensions.gen_salt('bf', 10))` (cost 10 to match GoTrue's own) and deletes
  `auth.sessions` for the user. **Both were proved end to end against GoTrue
  v2.195 on the local stack**: sign in with the PIN, reset as a mentor, old
  PIN refused, new PIN accepted, the pre-reset refresh token dead. The
  admin-API fallback the spec allowed for was therefore not built.
- **The slug is stored, not derived.** `students.slug` is computed once by
  `student_create` (`_student_slug_base` + numeric dedupe under a `for update`
  lock on the team row) so a later rename never changes a login. The client
  mirror (`src/lib/auth/student-identity.ts`) is held to
  `public._student_email` by `tests/login-roster.test.ts`.
- **The join code is permanent.** It is half of every student address on the
  team, so `teams.join_code` has no client UPDATE grant and no rotation RPC.
  Rotation would be a new bundle that re-mints every address.
- **The team boundary is a composite foreign key before it is a policy.**
  `students (id, team_id)` is unique and every student reference on
  `role_assignments`, `tasks`, `blockers`, `evidence` is `(student_id,
  team_id)` against it; `evidence (task_id, team_id)` and `blockers (task_id,
  team_id)` do the same against `tasks (id, team_id)`. Cross-team rows are
  impossible regardless of policy.
- **Column-level grants are how "server-owned" is enforced for every client.**
  `evidence.upload_timestamp` (the spec's explicit requirement),
  `tasks.closed_at`/`created_at`, `blockers.raised_at`,
  `attendance.checked_in_at` (insert) appear in no client INSERT/UPDATE grant.
  Tested through PostgREST for a student AND a mentor, through SQL as
  `authenticated`, and against the catalog.
- **Mentor-only columns are a trigger**, because one `authenticated` role
  cannot carry two grant sets: `_mentor_only_columns('evidence_required')` on
  `tasks`. `_immutable_columns` pins team/author columns on tasks and blockers.
- **One holder per (team, role, tier) is an exclusion constraint** over
  `daterange(effective_from, effective_to, '[)')` with btree_gist, plus a
  second constraint so one student cannot hold both tiers of a role at once.
- **Meetings are shared, not per team**, readable by every signed-in user,
  written by mentors. `meetings.current_phase_id` is a composite foreign key
  `(current_phase_id, id) -> meeting_phases (id, meeting_id)` with
  `on delete set null (current_phase_id)` (Postgres 15+), so the live pointer
  can never name another meeting's phase. `phase_templates` + `meeting_create`
  stamp the Friday (90) / Saturday (120) phases.
- **Realtime: five tables, replica identity full.** Mentors hard-delete on the
  work surface and a DELETE event with only a key cannot be filtered by
  `team_id`. The publication block is idempotent on both axes (copied shape).
- **RLS-governed direct writes on feature tables** -- a deliberate divergence
  from idea-app's "zero client write grants". The spec defines team-scoped
  read AND write policies, and a local-first write queue replays idempotent
  upserts against tables (client-minted `id` in every insert grant,
  server-stamped `updated_at`, natural unique keys). Auth-sensitive writes
  stay behind definer RPCs.
- **`check_function_bodies = off` around 0001's helpers.** SQL-language
  bodies are validated at creation and the tables they read arrive in
  0002/0004, while 0003's policies already need `current_student_team_id()`.
  Switched off for that section, `reset` after it.
- **Explicit `service_role` grants on every table.** The supabase/postgres
  17.6.1.159 image's default ACL for `postgres`-owned tables in `public`
  gives the three API roles only TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. The
  first test run reddened on every service-role positive control; the fix is
  a stated grant per table rather than a reliance on defaults.
- **`team_login_roster` returns the team id.** The spec asks for "team id,
  team name, roster" and for "no ids that grant access"; a team id grants
  nothing (every read of team data is RLS on the signed-in identity), so it
  is returned and the student/auth ids, PIN and grade are not. Asserted by
  key-set in `tests/login-roster.test.ts`.

### What was measured

- `supabase db reset` applies 0001-0008 + `seed.sql` cleanly on the local
  stack (Postgres 17.6, GoTrue 2.195, PostgREST 16.1, Realtime 2.129,
  storage-api 1.69). Seed result: one admin mentor (`is_admin = true` via
  the trigger), four teams with valid codes, templates summing to 90 / 120.
- `npx vitest run`: 9 files, **90 tests, 90 passed**, ~8 s.
- **Mutation proof:** `0007`'s "students read their own team tasks" policy
  flipped to `using (true)`, `db reset`, `tests/team-isolation.test.ts`:
  3 failed (list, by-id, SQL path) / 17 passed. File restored
  (md5-identical), reset, 20 / 20.
- `npx svelte-check`: 0 errors, 0 warnings.
- `npm run build` on Linux (WSL, Node 22): `.vercel/output` produced
  (`index.func`, `app.func`, `login.func`, static). On Windows the adapter
  fails creating a symlink (`EPERM`) after Vite succeeds -- pre-existing
  adapter behaviour, recorded as a trap.

### What is explicitly NOT verified

- **A real Google sign-in.** The trigger's Google branch is tested with the
  exact `auth.users` row GoTrue writes for an OAuth sign-up, and the refusal
  branch through GoTrue's public and admin endpoints; the browser redirect
  round trip against the dashboard's Google provider is not automated.
- **Realtime delivery.** Publication membership and replica identity are
  asserted in the catalog; no test subscribes to a channel and receives a
  phase-change event.
- **Storage uploads.** The bucket and the four `storage.objects` policies are
  created and asserted present; no test uploads an object.
- **Slug dedupe under true concurrency.** The `for update` on the team row is
  the serialisation; the test covers sequential duplicates only.
- **The "first mentor is admin" rule on an empty table** is shown on the seed
  row (created by the trigger) and by later mentors not being admin; it is
  not re-run on an emptied `mentors` table because every later table
  references mentors.

### Deferred

- Join-code rotation (re-mints every student address on the team).
- A rate limit on `team_login_roster` (32^6 codes; PostgREST has none).
- The local-first write queue itself, and a phase-transition RPC that stamps
  `meeting_phases.started_at`/`ended_at` alongside `current_phase_id` (today a
  mentor updates the pointer directly through RLS).
- Student reads of mentor display names (a "resolved by" label): students
  currently cannot read `mentors` at all.

---

## 2026-08-23 -- Pin the Supabase CLI credential to `.env` (docs only)

### What changed

- `CLAUDE.md` gains **### Supabase CLI credentials** between the commands
  fence and **### Machine and toolchain**: never run a bare `supabase`
  command in this repo; read `SUPABASE_ACCESS_TOKEN` from `.env` into the
  environment of that one command.
- No code, no schema, no migration.

### Load-bearing decisions

- **The rule is a pin against drift, not a fix for a live mismatch.** See the
  measurement below: as of today the global CLI login and `.env` resolve to
  the *same* account. The rule earns its place anyway, because the global
  login is ambient machine state -- Windows Credential Manager, shared by
  every repo, rewritten by any `supabase login` run in `idea-app`, `frc-app`,
  or anywhere else. A bare command reads whatever that happens to be at the
  moment, with no prompt and no error. Making the credential a property of
  the repo removes the whole class of question.
- **Per-command, not `export` in a shell profile.** A profile export is the
  same ambient-state failure with a different owner: it leaks into sibling
  repos and outlives the session that set it. Prefixing the one command keeps
  the blast radius to the command.
- **Set it for local commands too**, even though `start`/`db reset`/
  `migration up`/`gen types --local` never reach the hosted API. Two habits
  means eventually reaching for the wrong one on the command that matters.

### What was measured

All from `C:\fll-app-sk` on 2026-08-23.

- **`.env` is gitignored and untracked.** `git check-ignore -v .env` ->
  `.gitignore:16:.env`. `git ls-files` lists only `.env.example` and
  `.env.test` (both deliberately allowlisted by `!` rules).
- **The CLI honours `SUPABASE_ACCESS_TOKEN`** -- proved with a negative
  control, not assumed: a syntactically valid but bogus `sbp_000...` token
  returns `LegacyProjectsListUnexpectedStatusError ... "Unauthorized"`, so the
  variable is load-bearing and the real run below is not the global login in
  disguise.
- **`supabase projects list` with the `.env` token** returns four projects,
  all in org `avkkuocbjpehyyxmnzhq` ("pina-hash's Org"): `sparc-hq`
  (ACTIVE_HEALTHY), `fll-app` (ACTIVE_HEALTHY), `logbook` (INACTIVE),
  `idea-app` (INACTIVE).
- **THE PREMISE THIS BUNDLE STARTED FROM IS WRONG, and the record should say
  so.** The same command with the variable unset (`env -u`) returns a
  byte-equivalent project list, and `supabase orgs list` returns the same
  single org either way. The machine's global CLI login is **not** a different
  account from this repo's `.env` token -- today they are the same account,
  which owns exactly one org.
- **What is separate is the PROJECT, not the account.** `fll-app`
  (`ypusbfatsmoukvlfgrqf`) and `idea-app` (`ajhlxbkctsqnrbbqtyrt`) are
  distinct projects inside one org. `CLAUDE.md`'s "its own project, separate
  from idea-app's" is accurate as written and was not changed.
- **The project-limit worry is real but differently shaped.** It is a
  same-org active-project cap, not a wrong-account cap: two of the four
  projects are ACTIVE_HEALTHY and two are paused. Unpausing `idea-app` or
  `logbook` is the operation that would hit it -- and it would hit it with
  either credential.
- **The documented snippet was run verbatim** after the edit, copy-pasted out
  of `CLAUDE.md`, and returned the project list. An earlier draft of that line
  had its `\r\n` collapsed into real newlines by the writing tool; the
  verbatim run is what caught it.
- `CLAUDE.md` re-checked as LF-only (0 CR bytes) per the repo's line-ending
  rule.

### What is explicitly NOT verified

- **That the two credentials are the same token**, as opposed to two tokens
  on one account. The global login is in Windows Credential Manager, not a
  readable `~/.supabase/access-token` file (that directory holds only
  `telemetry.json` and `traces/`), and it was not extracted -- identity was
  compared through the API's answers instead.
- **That the accounts will stay the same.** This is precisely what the rule
  defends against and precisely what a one-time measurement cannot promise.
- **`db push` / `link` under the rule.** Only the read-only `projects list`
  and `orgs list` were exercised. The repo is not currently linked
  (`supabase/.temp` holds no `project-ref`, which is why every run above also
  printed "Cannot find project ref").

### Deferred

- A wrapper script (e.g. `scripts/supabase.sh`) that sources `.env` and execs
  the CLI, so the rule is enforced by tooling instead of by habit. Not written
  because the WSL indirection already means each call is a script, and a
  second wrapper layer would have to agree with it.
- Re-linking the repo (`supabase link --project-ref ypusbfatsmoukvlfgrqf`)
  under the rule; out of scope for a documentation bundle.
---

## 2026-08-23 -- Mentor console: schema 0009, the live board, meeting control, provisioning, tasks

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

## 2026-08-23 -- Student runtime, Team Board mode, the offline write queue

### What changed

**Production was verified first, and it was already wired up.** See the
measurements: the deployed site reaches the linked project and always did.

**Schema.** One migration,
`supabase/migrations/0010_student_runtime_board_devices.sql`:

- `_resolve_current_meeting_id()` -- "which meeting is running", lifted out of
  0009's `board_live_summary` (which is replaced to call it) and given a public
  wrapper, `meeting_current()`, for the student screen and the team board.
- `team_board_devices` plus `team_board_enable` / `team_board_disable`,
  `_board_email()` and `current_board_team_id()`: a per-team kiosk account for
  the shared iPad.
- `handle_new_auth_user` (0002) replaced, widened by exactly one flag so a
  board address is mintable only from inside `team_board_enable`.
- Board-scoped SELECT policies on `teams`, `students`, `attendance`,
  `role_assignments`, `blockers`, `tasks`, plus one UPDATE policy on `tasks`.
- `team_resolve_roles` replaced to accept a board device as a caller. The RULE
  is untouched; only the guard widened.
- `_tasks_require_evidence()` and the `tasks_require_evidence` trigger.
- `auth_whoami` gains a third branch, `board`.

**App.** `src/lib/student/` (the write queue, the session clock, the safe
refetch, the view types and the role projection, `StudentScreen.svelte`), the
route group `src/routes/app/(student)/` (`me`, `me/team`), the public
`src/routes/board/` kiosk, and the harness at `src/routes/dev/student-screen/`.
The mentor console's team page gains a Team board iPad section.

### Load-bearing decisions

- **A BOARD IS A DEVICE, NOT A PERSON.** The shared iPad needs to read its team
  and close its team's tasks. Making it a student row would put it on the
  roster, let it hold a role, let it be checked in and let it raise a blocker
  as somebody. It gets its own auth account and a `team_board_devices` row
  instead, and the policies grant it exactly two verbs. `tests/board-device`
  asserts the six things it must NOT be able to do.
- **Its address contains a dot, deliberately.** `{code}-board.device@fll.invalid`
  cannot collide with `{code}-{slug}@fll.invalid` because 0004's slug alphabet
  is `[a-z0-9]`. A team whose roster happens to contain a "Bo Ard" is not a
  security incident.
- **THE EVIDENCE RULE IS A TRIGGER, NOT A DISABLED BUTTON.** The screen greys
  out Done until a photo exists, but the rule has to survive a write queued on
  a device that was offline and replayed later, so it lives in the database. A
  mentor may still close such a task: they set the flag and they are standing
  there.
- **Every student write goes through the queue, and the queue is on disk
  before it is on the wire.** Photos are Blobs in IndexedDB, not strings in
  localStorage, because the photo is the thing that must not be lost.
- **Idempotency comes from the client minting the id**, which is why 0007
  granted `id` on every insert. A replayed insert is a `23505`, which the queue
  reads as success. `attendance` collides on its natural key too, so even a
  replay under a fresh id is a no-op.
- **"Transient" and "permanent" are different, and only one of them is
  retried.** A fetch that never reached the server keeps the op queued; a
  SQLSTATE coming back from Postgres marks it failed and SHOWS it. Retrying a
  refusal forever would be a lie told quietly.
- **NEVER TREAT "no error" AS "it landed" FOR A WRITE RLS COULD FILTER.** An
  UPDATE that RLS filters returns 204 and zero rows with `error === null`. This
  cost an hour of chasing during this bundle and is now a rule in CLAUDE.md.
  (The board's own writes turned out to be fine; the thing that was wrong was
  my check script, see below.)
- **`invalidateAll()` is unsafe on any path that can run offline**, and this
  was found the hard way. See the measurement.
- **The student screen re-uses `team_resolve_roles` and projects it**;
  `myRoleFrom` never decides who is active, it only asks which row is about
  me. Its own test file covers all six shapes, including the one that matters:
  "I am the second AND the primary is here" must not read the same as "the job
  is mine today".
- **The whole screen is the team's colour**, not a stripe on a card, so a
  glance across a table of phones tells you whose is whose. It reuses 0009's
  `data-accent` tokens and adds none.
- **Reading level is a design constraint.** "Nobody is in this seat", not "role
  unfilled". "I'm here", not "Check in". Every student-facing control is a
  56px slab.

### What was measured

All on 2026-08-23.

**Production, before anything was built:**

- **The production environment variables are CORRECT and always were.** The
  first reading was wrong: `vercel env pull` under CLI 54.12.2 writes
  `PUBLIC_SUPABASE_URL=""` for encrypted values rather than decrypting them,
  which looked exactly like "never set". What settled it: the live bundle at
  `fll-app-tawny.vercel.app` contains
  `https://ypusbfatsmoukvlfgrqf.supabase.co` and that project's anon JWT, and
  the newest production deployment is 11 minutes old, built AFTER the variables
  were created.
- **The deployed site reads real production data.** Typing `VCPW2G` into the
  live login screen called `team_login_roster` against the linked project and
  came back "Red Team", with "No students on this team yet".
- **The deployed guards work in a REAL production build.** `/app` and
  `/app/board` redirect when unauthenticated; **`/dev/live-board` returns 404**,
  which closes the item HISTORY 0009 listed as not verified (it had only been
  proven by inverting the guard under `vite dev`).
- **Google OAuth is live on the project**: `external.google` is true and
  `/auth/v1/authorize?provider=google` redirects to a real Google client id.
  `external.email` is on, which is what student PIN sign-in needs.
- **NOT DONE: an actual mentor Google sign-in.** It needs the user's Google
  credentials, which are theirs to type. Creating a substitute mentor account
  in production was attempted and correctly refused by this environment's
  safety classifier; it was not worked around.

**The runtime, against the local stack:**

- **`npx vitest run`: 17 files, 186 tests, all passing.** Three new files:
  `student-isolation` (17), `board-device` (18), `student-role-projection` (8).
- **`npx svelte-check`: 0 errors, 0 warnings** (723 files).
- **The full suite, twice, on a database rebuilt from the chain each time: once
  at HEAD and once with this bundle.** The stand-in is not GoTrue and not
  PostgREST, so a large part of the suite cannot pass here at all; the only
  honest reading is the DIFFERENCE, and it is exactly the new tests.
  HEAD: 28 files failed / 18 passed, 130 tests failed / 433 passed / 92 skipped.
  With this bundle: 28 files failed / 18+1 passed, 130 tests failed / 450
  passed / 92 skipped. Same 130 failures, both times, and +17 passing, which is
  the 14 port cases plus the 3 rendered-name cases. Nothing that passed before
  stopped passing.
- **The harness mounts the REAL component.** `sr__rolelabel` was changed to
  `STUDENT-SENTINEL-4471`, the harness showed it, and the file was restored
  byte-identically (md5 `fdc236b54d017997521cafe439554485`). Inverting the dev
  guard made `/dev/student-screen` 404; restored byte-identically (md5
  `d9b1d028896bcc24e64e7bfaeb8129ee`).
- **A phase change reached a student device with no reload.** Advancing (the
  same `meeting_advance_phase` RPC the console's button calls) moved the screen
  from "Role Blocks 11:45" to "Mat Run 14:52" with
  `performance.getEntriesByType('navigation').length === 1` throughout.
- **NEGATIVE CONTROL: the student screen does not poll.** In 67 seconds open it
  made 4 data refetches: one at mount and three at the instant of the advance.
  A one-second poll would have made about 67. The three-in-a-burst led to
  `watchTables` gaining the same 250ms debounce `BoardFeed` already had; a
  second advance then produced exactly one refetch.
- **THE OFFLINE PROOF.** `window.fetch` was replaced with one that always
  rejects. Tapping Done and raising a blocker: the screen stayed up
  (`navigation.length === 1`), showed "No wifi 2", and the database was
  unchanged (task open, 2 blockers). Restoring `fetch` and waiting one 8-second
  heartbeat: the task went done and the blocker count went 2 -> 3.
- **EXACTLY ONCE, proved by replay.** The blocker op was re-injected into
  IndexedDB with the SAME client-minted id and the page reloaded so the queue
  replayed it. No failure was shown and the count stayed at 3.
- **NEGATIVE CONTROL for that:** the identical payload re-injected under a NEW
  id produced a 4th row, so the test above could have failed and did not. The
  extra row was deleted.
- **`invalidateAll()` while offline hard-reloads the page, measured.** The
  first offline attempt blanked and re-created the document. The cause was the
  queue calling its `onChange` in a `finally` even when the flush had bailed
  transiently. Fixed two ways: the callback only fires after a flush that
  reached the server, and `safeInvalidateAll()` refuses to run when the queue
  has reported the server unreachable. Re-run: the screen survived.
- **Evidence capture end to end.** A 779-byte JPEG was handed to the real file
  input and the real sheet. It arrived in `storage.objects` at
  `{team}/{task}/{evidence id}.jpg` at 779 bytes, with an `evidence` row
  carrying the caption and a server-set `upload_timestamp`. The task's Done
  button went from "Photo first" (disabled) to "Done" (enabled).
- **Check-in, and the role flipping live.** Diego was covering Lead Builder
  because Maya was out; the screen said so in words. Signing in as Maya and
  tapping "I'm here" wrote attendance and `team_resolve_roles` immediately
  reported Lead Builder as "Maya R. / primary". Ending the meeting turned the
  student screen into "No meeting is running right now" over realtime, with
  nothing else on it.
- **Team Board mode.** Signed in on the real form with team code `9B3QGD` and
  the mentor-set PIN. At 1180x820 the team name renders at 52px and the clock
  at 80px, tasks are grouped by role with who is in each seat, Done buttons are
  56px, and the evidence-required task is disabled with "Needs a photo".
  Tapping Done closed **only Red Team's** copy of a task that exists on all
  four teams.
- **A verification script of mine was wrong, and it is worth recording.** For
  about twenty minutes the board looked like it was reporting "Saved" without
  writing. The board was fine; `select ... from tasks where title = '...'` was
  matching four rows (one per team) and reading the wrong one. The fix was to
  join `teams` and print per team, which is also what showed the isolation.
- **Viewports, 0px page overflow on every surface at both ends:** `/app/me`,
  `/app/me/team`, `/board` and `/dev/student-screen` at 375px and at 1440px.
  At 375 the student column is full width with the I'M STUCK bar fixed; at 1440
  it is a centred 544px column. The board is 4 columns at 1180 and 5 at 1440,
  1 at 375.
- **One real target defect found and fixed:** "See what my team is doing" was a
  25px inline link. It is now a 56px slab like every other student control.

### What is explicitly NOT verified

- **A mentor signing into the DEPLOYED console with Google.** Everything up to
  the Google redirect is verified; the click itself needs the user.
- **The deployed STUDENT runtime.** The commit that carries it triggers the
  deploy, so at the time of writing production runs the previous build. The
  schema it needs is already there and is backward compatible.
- **Real iPad Safari and real Android Chrome.** The camera path is
  `<input type="file" accept="image/*" capture="environment">`, which is the
  documented behaviour on both, and it was driven with a real `File` through
  the real input in Chromium. No physical device was used.
- **The Wake Lock on a real iPad.** iOS Safari has supported the Screen Wake
  Lock API since 16.4; the code requests it and re-requests on
  `visibilitychange`, and it degrades silently. Not exercised on hardware.
- **A genuinely dropped access point**, as opposed to a severed `window.fetch`.
  The realtime websocket survives a fetch sever, so the reconnect-and-refetch
  path was not exercised by this method.
- **Print output**, still, from the 0009 bundle.
- **Screenshots.** This session could not composite browser frames, so every
  visual claim is a measurement, not an image.
- **Two students editing the same task at once.** Last write wins by design;
  no race was driven.

### Deferred

- **A student cannot un-claim a task** from the screen, only claim it. One tap
  each way was more surface than the first season needs.
- **Evidence is write-only from the student side.** They can add a photo; they
  cannot see the ones already attached, or delete one. The RLS for both exists
  (0007).
- **The team board cannot close an evidence-required task**, by design: it has
  no camera identity and evidence must be attributable to a student. The button
  says so rather than hiding.
- **No per-student notification** when a mentor resolves their blocker. The
  Team tab shows the list; nothing pings.
- **The queue never gives up.** A permanently failed op is shown and can be
  dismissed, but there is no retry button and no export.

---

## 2026-08-23 -- Skill Hub port: schema 0011, content modules, `/app/library`

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

## 2026-08-23 -- Route planner: schema 0012, geometry, the planner surfaces

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

## 2026-08-23 -- Roster cap and self-enrollment, the parent view, the match timer

### What changed

**Schema.** Three migrations, in apply order.

`supabase/migrations/0013_roster_cap_and_self_enrollment.sql`:

- `team_size_cap()`: the number 6, written once, granted to `anon` as well as
  `authenticated` so the login screen and the console print the same figure
  without either typing it.
- `_students_team_cap()` + `students_team_cap` BEFORE INSERT OR UPDATE: the
  cap, as a trigger, because "at most six ACTIVE students on this team" is an
  aggregate a CHECK cannot see. It takes `pg_advisory_xact_lock` on the team
  first, which is the whole point: twenty children enrolling from twenty
  phones in the same minute would otherwise each read five. Deactivated rows
  hold no seat; an UPDATE that leaves an already-active row on the same team
  short-circuits before the lock, so a rename on a full team is free.
- `teams.join_open_since` / `teams.join_open_meeting_id` (no client grant) and
  `team_join_open(team_id)`: the stored state and the DERIVED answer. Open
  means a mentor opened it, the meeting it was opened in has not ended, and
  the local day it was opened on has not. `team_join_window_open/close` are
  the two taps; `meeting_end` (replaced) also clears the columns so the
  console never shows a stale "open".
- `student_self_enroll(join_code, first, initial, grade, pin)`: granted to
  `anon` and nothing else. Three gates in front of it -- a real join code, an
  open window, a free seat -- all re-read inside its own transaction under the
  team row lock, so a stale tab is the normal case rather than the edge one.
  It mints the same three rows `student_create` mints, with the same
  `fll.creating_student` gate, and builds the address itself.
- `team_login_roster` (replaced): gains `size_cap`, `roster_size`,
  `roster_full` and `join_open`, so the login screen can explain a closed
  window or a full team instead of failing at the end of a form.
- `team_roster_state()`: seats, cap and window state for every live team in
  one mentor-only call.
- `_students_immutable` (replaced) + `_student_detach_from_team` +
  `student_move_team(student, to_team)`: a move rewrites both halves of the
  login address (new code, slug re-deduplicated inside the receiving team),
  rewrites `auth.users` and `auth.identities`, and drops every session --
  the same shape as rotating a join code. It CLEARS forward-looking rows
  (role assignments, task assignments) and reports the counts; it REFUSES
  when the student has history on the old team (a blocker they raised, a
  photo they took), with the counts and the alternative, because a move
  cannot rewrite those truthfully.
- Realtime: `students` and `teams` published with full replica identity.

`supabase/migrations/0014_parent_access.sql`:

- `student_parent_access`: one row per student; `token` is 32 random bytes as
  64 hex characters and is stored in PLAINTEXT, readable by mentors and by
  nobody else. That is the deliberate difference from a PIN, and the header
  says so at length: a PIN authenticates a PERSON who can be told it again
  out loud, a parent link is a CAPABILITY a mentor must be able to reprint in
  March for a card lost in October, and hashing it would make "print the
  cards" mean "invalidate every link on the team".
- The composite key `(student_id, team_id) -> students (id, team_id)` carries
  `ON UPDATE CASCADE`, so a student moved between teams (0013) takes their
  parent link with them: the link belongs to the child.
- `parent_access_issue` / `parent_access_revoke` (mentor only) and
  `parent_view(token)` / `parent_photo_path(token, evidence_id)` (anon and
  authenticated). `parent_view` returns null -- never an error -- for an
  unknown, malformed, revoked, deactivated or archived case, so probing
  cannot tell any of them apart.
- `team_resolve_roles` (replaced) gains ONE clause: a transaction-local
  `fll.parent_view` GUC naming the team, raised only inside `parent_view`'s
  own body. Role resolution is reused rather than rebuilt; the mechanism is
  the same one 0004 already bets account creation on, and rests on the same
  fact (a client speaking to PostgREST cannot set a GUC).

`supabase/migrations/0015_match_runs.sql`:

- `match_runs`, `match_run_launches`, `match_run_scores`. `points` on both
  the run and the line appears in NO client grant: a BEFORE trigger prices
  each line from `missions.scoring` (0011) and an AFTER trigger re-totals the
  run. A device says WHAT it scored, never how much that is worth, because a
  scoreboard you can type into is not a scoreboard and this is the number a
  child opens the app to see.
- `match_runs.strategy_id` is a composite key to `strategies`, nullable, so
  "did v2 beat v1" is answerable and a run driven with no plan is still
  loggable.
- RLS: mentors, the team's own students, and the team's own board device, on
  all three tables, for all four operations. Both `logged_by_*` columns are
  nullable with no exactly-one-creator constraint (unlike `tasks`), because a
  shared iPad logs a run as the team rather than as a person.
- `match_run_history(team_id)`: the list plus `best_so_far` as a window
  function. The trendline is a RULE, so it is computed once in SQL rather
  than accumulated three different ways in JavaScript. It returns null, not
  an error, for a team the caller may not see. Its gate is wrapped in
  `coalesce(..., false)`: the identity helpers are NULL for a caller who is
  not that thing, and `not (false or null)` is NULL, which an IF treats as
  "no" and falls straight through. In a WHERE clause NULL and false behave
  the same; inside an IF they do not, and the first version of this function
  leaked a rival team's history until the browser check caught it.
- It REPLACES 0013's `_student_detach_from_team` to null `logged_by_student_id`
  on a move. That could not be a foreign-key action: Postgres accepts a
  column list only on `ON DELETE SET NULL`, and a bare `ON UPDATE SET NULL`
  would try to null `team_id`, which is NOT NULL.

**App.**

- `src/routes/login/+page.svelte`: an "I'm new here" branch. Name, last
  initial, grade, PIN, confirm PIN, and signed in immediately -- no approval
  queue, because a queue means twenty children waiting on one adult. The
  screen shows "N spots left", "this team is full" or "sign-ups are closed"
  from the RPC's own answer, and when the RPC refuses it prints that sentence
  VERBATIM: the database writes those for a nine-year-old and the screen has
  nothing to add.
- `src/routes/app/(mentor)/teams/[teamId]/`: a Sign-ups card (seats free, one
  tap open/close), an editable roster (rename, grade, deactivate, move) and a
  Parent link column. The move is warned about before it fires, the same way
  join-code rotation is. The page subscribes to `students`/`teams` and
  REFETCHES on every event, so the roster fills in while a mentor watches.
- `src/routes/app/(mentor)/teams/[teamId]/parents/`: the printable parent
  cards, one per student, each with the link and a QR rendered server-side as
  inline SVG. "Make the N missing links" deliberately does not touch links
  that already exist, so cards already handed out keep working.
- `src/routes/p/[token]/`: the parent page, outside `/app` for the same
  reason `/board` is. `src/routes/p/[token]/photo/[evidenceId]` is the only
  reader of `SUPABASE_SERVICE_ROLE_KEY` in the repo
  (`src/lib/server/service-client.ts`): the DATABASE decides whether that
  token may see that photo, and the service role only signs a 60-second URL
  for the path it was handed.
- `src/lib/match/`: `rules.ts` (the 150-second constant, the clock formatter,
  the preview tally), `ops.ts` (one queued op writes a run and everything
  under it, every row client-id'd so a replay collides rather than
  duplicating), `MatchTimer.svelte` (pure props), `types.ts`, `data.ts`.
  Reachable at `/app/me/match` (through the write queue) and `/board/match`
  (straight down the wire, reporting refusals honestly, because the queue
  keys on a signed-in student and a kiosk has no such owner).
- `src/routes/dev/match-timer/`: the dev-guarded harness, mounting the REAL
  component with fixtures and a persist log.
- `scripts/seed-local-session.mjs`: Gold Team's roster trimmed from seven to
  six. The cap refused the seventh, on a dev script, exactly as it would on a
  Friday.
- `qrcode-generator` is the one new dependency: 50KB, no dependencies of its
  own, the reference encoder. A hand-rolled Reed-Solomon that is subtly wrong
  still LOOKS like a QR code, and the failure shows up as a parent in a car
  park whose phone will not read the card.

### The load-bearing decisions, and why

- **The cap is a trigger with an advisory lock, not a check and not app
  code.** It has to hold against four write paths that do not know about each
  other, and against twenty simultaneous enrollments. A count without a lock
  is a race that shows up exactly once, in the room, on the day.
- **The join window is derived, with two bounds.** Binding it to the running
  meeting is what makes "never left open all week" true without anybody
  remembering. The local-day bound covers the case where no meeting was
  running when it was opened. `meeting_end` also clears the stored columns,
  so the console tells the truth; the derived function is what every gate
  actually calls, so a window whose meeting ended some other way is still
  shut.
- **The parent token is plaintext and the reasoning is written down.** This
  is the one place the repo stores a bearer credential in a readable column.
  It is justified by what it grants (read-only, one child, revocable in one
  tap) and by what hashing would cost (reprinting a card would kill it). The
  header says explicitly not to copy the decision to anything that
  authenticates a person.
- **The service role got its first reader, and it decides nothing.** CLAUDE.md
  anticipated one `$lib/server/*` module. The ordering matters: RPC first,
  service role second, and the service role never chooses who may see what.
- **A score is computed, never sent.** Both `points` columns are ungranted
  and trigger-owned. This is the same rule as `tasks.closed_at` and
  `evidence.upload_timestamp`, applied to the one number a child cares about.
- **The match clock is local and monotonic, and shares no code with the phase
  timer.** The phase timer ticks off a server-corrected wall clock because a
  fast tablet would show phantom overrun; a match timer has to be exact and
  continuous in a gym with no signal, which only `performance.now()` gives.
  Two clocks, opposite requirements, no shared module.
- **A move refuses rather than rewrites history.** Role and task assignments
  are about next week and are cleared with a count; a blocker and a photo are
  about what happened and block the move with a readable alternative.

### What was measured

- **The cap at the database, not the UI.** `tests/roster-cap.test.ts` writes
  seven students as `postgres` with raw INSERTs -- no RPC, no PostgREST, no
  RLS in the path. Six land; the seventh raises "That team already has 6
  students...". The refusal leaves nothing behind (no seventh row, no orphan
  auth user from the rolled-back half). Then the same trigger holding via
  `student_create`, via `student_self_enroll` with the window still provably
  open, and via `student_reactivate` into a full team; plus the two things
  that must NOT count (a deactivated row, a rename on a full team).
- **Self-enrollment's gates.** `tests/self-enrollment.test.ts`: a wrong code
  and a closed window each refused with their own sentence and a positive
  control next to them; the enrolled child signs in through GoTrue at the
  address `src/lib/auth/student-identity.ts` computes; two children called
  Sam K both get working logins (`samk`, `samk2`); ending the meeting closes
  the window in BOTH the derived rule and the stored columns
  (`join_windows_closed: 1`); a window whose meeting ended some other way is
  still shut by the rule alone; a window backdated a day is shut by the day
  bound and re-opening today works.
- **A parent token reaches exactly one child.** `tests/parent-access.test.ts`:
  the sibling's attendance, finished task and photo are shown by the
  SIBLING's own token and by the service role, and are absent from this
  token's payload; the other team never appears; `parent_photo_path` answers
  with a path for the child's own photo and null for the sibling's, which the
  sibling's token then resolves. Revoking, regenerating and deactivating each
  turn the link off with a positive control that it worked a moment before.
  No write path: a mentor can read a token but cannot INSERT, UPDATE (42501)
  or DELETE (42501) the table, and an anon client holding a valid token gets
  a refusal on every table it tries.
- **Match runs.** `tests/match-runs.test.ts`: the total equals the sum of the
  lines priced from the missions table (the test reads the prices out of the
  table rather than typing them), re-totals on quantity change and on delete;
  `points` is 42501 on both tables for update and for insert; a line index a
  mission does not have is refused by mission name; `best_so_far` over three
  deliberately non-monotonic runs is `[20, 60, 60]`; a run may cite only its
  own team's strategy (23503 otherwise); the rival's runs are invisible on
  all three tables with the service role as positive control, and
  `match_run_history` answers null rather than raising; the board iPad logs a
  run with both `logged_by_*` null.
- **The move.** `tests/student-move-team.test.ts`: the old address stops
  working, the new one works with the SAME PIN, the pre-move session rows are
  gone from `auth.sessions`; the slug re-dedupes inside the receiving team
  (`zedz` to `zedz2`) and both accounts still sign in; role assignments
  cleared and tasks unassigned with counts; a student with a blocker is
  refused with "1 blocker(s) and 0 photo(s)" and a clean teammate moves
  immediately afterwards as the positive control; a move into a full team is
  refused by team name; a student cannot move themselves, the column is
  42501 for a mentor, and the trigger refuses it even as `postgres`.
- **The permissive-direction mutations, twice.** Applied to the live database
  (migration files untouched, md5 quoted below), then `db reset` to restore.
  (1) `parent_photo_path` without its ownership join and
  `student_parent_access` SELECT set to `using (true)`: exactly the two
  guarding tests went red. (2) `_students_team_cap` returning NEW
  unconditionally, `match_runs` SELECT `using (true)`, and
  `grant update (points)`: exactly six tests went red, including all three
  cap proofs. Restored by reset, md5 unchanged
  (0013 `b3491623d47f62403872bf82b14dc21a`,
  0014 `af3cc5d7be9bf921975fe5e11ea874c5`,
  0015 `08aea4bbcb17ec0a8d8f925072eb85e2`), suite green.
  Note the RPC-level pre-checks in `student_self_enroll` and
  `student_move_team` kept those two paths refusing even with the trigger
  gutted, which is the belt-and-braces working; the trigger itself is proved
  by the raw-insert test, which did go red.
- **The harness round trip and the guard inversion, in the browser.** Start,
  stop, tick M01's two lines and one launch, save: the persist log read
  `match_run_log started=... ran=1s 2 lines, 1 launch attempted, 30 pts`, and
  the on-screen tally read 30, matching 20 + 10 from the season list. The dev
  guard inverted (`if (dev)`) answered 404; restored it answered 200 and the
  file is byte-identical (md5 `38029556651091af20d08b3432a22eeb` before and
  after). A sentinel edit inside the REAL `MatchTimer.svelte` moved the
  harness through HMR and was restored byte-identical (md5
  `0627a2c629fa609ed025130d44822732`).
- **End to end in the browser, against the local stack.** Signed in as a
  seeded student through the real login screen; the match timer ran, stopped
  at 0:02, logged M13 (30 points) through the WRITE QUEUE, and the row landed
  in Postgres with `points = 30` priced by the trigger and attributed to that
  student. As a mentor: opened Green Team's sign-ups from the console, and a
  self-enrollment fired from an anon PostgREST call moved the open page from
  5 rows to 6 and from "1 seat free" to "0" with no reload -- realtime doing
  what it was published for. The seventh was then refused with "That team is
  full. A team holds 6 students." WHILE THE WINDOW WAS STILL OPEN, which is
  the stale-tab case. A rename kept the login slug (`wrenk`) unchanged; a
  move to a full team showed the warning panel and then the by-name refusal;
  a parent link was made, and the parent cards page rendered six cards with
  six distinct QR codes. Signed out entirely, `/p/<token>` returned 200 with
  the child's page and an invented token 404'd. Then, with no session at all,
  the "I'm new here" flow: mismatched PINs caught client-side, then enrolled
  and landed on "Hi, Kaya!" with no approval step.
- **375px and 1440px: 0px horizontal overflow**, measured as
  `scrollWidth - innerWidth` on the login screen (all four steps), the match
  timer, the parent page, the console team page, the parent cards page and
  the harness.
- `tests/parent-qr.test.ts` reads the modules back out of the printed SVG
  path and checks the STRUCTURE a scanner needs -- quiet zone empty, three
  finder patterns present with their light separators and 3x3 cores, timing
  pattern alternating, NO finder in the bottom-right corner (the negative
  control that would catch an all-dark matrix), version arithmetic
  `(n - 17) % 4 == 0`, two tokens giving two different symbols, and black on
  white regardless of theme.
- `npx svelte-check`: **0 errors, 0 warnings** (602 files). Full suite: **30
  files, 309 tests**, all green against the real local stack.

### What is explicitly NOT verified

- **A real parent on a real phone.** The parent page was driven with no
  session in the Browser pane at 375px; nobody scanned a printed card with a
  camera. The QR is checked structurally (see above) and comes from the
  reference encoder, but the paper-to-camera round trip is untested.
- **The photo route end to end.** `parent_photo_path`'s authorisation is
  tested in both directions, and the route is a thin redirect over it, but no
  parent link was followed to an actual image: the seeded evidence rows point
  at storage objects that were never uploaded, so the signed URL would 404 on
  the bytes.
- **The mentor console through a real Google sign-in.** OAuth needs a human;
  the mentor session in the browser was minted against GoTrue directly and
  installed as the same cookie the app writes.
- **The board iPad's match timer on hardware.** `/board/match` was checked
  only for its redirect when the caller is not a board device; the board's
  write path is covered by `tests/match-runs.test.ts` through a real board
  session, not through the page.
- **Twenty simultaneous enrollments.** The advisory lock is the design and
  the cap is proved sequentially; no concurrent load was generated.
- **Print output.** Both card pages carry `@media print` rules; neither was
  sent to a printer or a PDF.

### Deferred

- **A parent link that expires on its own.** Deliberately not built: a silent
  expiry is a support call in February. Revocation is one tap.
- **Emailing a parent link.** There is no mail path in this project; a
  printed card at pickup is the delivery mechanism the season has.
- **Editing a logged run's scoring lines.** A run's note and elapsed time are
  editable and the whole run can be removed and re-logged; changing which
  lines it scored after the fact is not in the UI (the tables allow it).
- **Realtime on the match tables.** Left out on purpose: a run is logged once
  by the person holding the phone, and a list updating under a note being
  typed is motion for its own sake.
- **Self-enrollment onto a team a child is already on.** Nothing stops a
  child typing themselves in twice under a slightly different name; the
  dedup suffix makes both accounts work. A mentor deactivates the spare.

---

## 2026-08-23 -- Engineering notebook: schema 0016, the four judged sections, session recaps, print

### What shipped

- **Schema 0016** (`supabase/migrations/0016_engineering_notebook.sql`): the
  `notebook_section` and `notebook_outcome` enums; `notebook_can_edit()` (the
  one statement of who edits which section, built on `team_resolve_roles`'
  covering rule exactly the way `strategy_can_edit` is); `notebook_entries`
  (prompt answers, free notes, and Robot Design "tries" with a first-class
  worked/failed/mixed outcome); `meeting_recaps` (one frozen jsonb draft per
  team per meeting plus the lead's summary and a confirmed flag whose stamps
  are trigger-owned); `_meeting_recap_facts()` and
  `_meeting_recaps_generate()`; `meeting_advance_phase` and `meeting_end`
  replaced at their signatures to generate drafts at the Close (the last
  phase) and at meeting end; `_student_detach_from_team` replaced to drop
  notebook attribution on a team move; `notebook_season_stats()`; a
  `unique (id, team_id)` on `evidence` so entries cite photos by composite
  key.
- **The app**: `src/lib/content/notebook.ts` (prompts written fresh at a
  fourth-grade level; nothing taken from the copyrighted FIRST notebook,
  which is linked through the Library instead), `src/lib/notebook/`
  (`types.ts`, `data.ts`, `ops.ts`, `Notebook.svelte`, `NotebookPage.svelte`,
  `NotebookPrint.svelte`), student routes `/app/me/notebook` and
  `/app/me/notebook/print`, mentor routes `/app/notebook`,
  `/app/notebook/[teamId]` and its `/print`, the `/dev/notebook` harness, a
  Notebook tab in the console nav and a "Write in our notebook" link on My
  Screen. Notebook ops ride the existing WriteQueue.

### The load-bearing decisions

- **THE MAPPING IS THE FEATURE.** The notebook assembles itself from what the
  app already recorded, so students edit and add reasoning instead of
  retyping the season. Robot Design gets the iteration story (tries), the
  strategy-version and match-run record; the session recap draft carries
  attendance names, tasks closed (with role), photos with captions, blockers
  raised and resolved, run count and best points, and strategy versions
  saved, all computed from the meeting's own window.
- **A recap draft is FROZEN jsonb, not a view**, so a task deleted in
  November cannot erase what an October recap said. It regenerates only
  while unconfirmed; confirming freezes it, and that is what confirming
  means. Unconfirmed recaps render with a "Not finished" badge in the app
  and a "Draft, not confirmed" mark in print; they are never dropped.
- **Confirmation is a client boolean with server-owned stamps**
  (`confirmed_at`, `confirmed_by_*` carry no grant; a trigger stamps them
  from the server clock and the caller), the same shape as `tasks.closed_at`,
  so a queued confirm replays idempotently and keeps its original stamp.
- **Section edit rights live in `notebook_can_edit(team_id, section)`**: any
  mentor; the Notebook and Values Lead everywhere; Robot Design also takes
  the builder, programmer and run captain; the Innovation Project also takes
  the innovation lead. Recap edits gate on the `season_summary` section. The
  covering rule is delegated, never re-derived.
- **A failed try is a first-class row** (`outcome = 'failed'`, styled and
  encouraged in copy), because Robot Design judging rewards the iteration
  story and children hide failures unless the UI tells them not to.
- **On a team move, notebook attribution detaches** (0015's practice-run
  answer, not 0013's blocker refusal): the notebook belongs to the team, so
  the words stay and only the byline goes.
- **Print is the browser's own PDF path** (`window.print()` on a flat
  document whose base state hides nothing); `color-scheme: light` and white
  `html`/`body` are forced under `@media print` because the app's dark canvas
  otherwise prints as a border around the paper.

### What was measured

- **The permissive mutation bit.** With the notebook read policy set to
  `using (true)` and `notebook_can_edit` set to `select true`, seven of the
  sixteen isolation tests went red (cross-team read, write, delete, section
  gating, recap gating, the covering rule); restored verbatim from the
  migration, all sixteen green again, and the final run was against a
  `db reset` schema derived purely from the files.
- `tests/notebook-recap.test.ts` lived a real session through the real RPCs
  and proved the draft contains what happened: the names checked in, the
  closed task and its role, the photo caption and path, the blocker note in
  both raised and resolved lists, one run priced at 20 by the trigger, the
  strategy version, and both halves of confirmation (frozen when confirmed,
  regenerated with late work when not).
- `tests/notebook-offline-replay.test.ts`: the same insert op twice under
  one client-minted id is one row; the NEGATIVE CONTROL (same payload,
  different id) is two rows; refused updates are shown, replayed deletes and
  confirms converge, and a replayed confirm keeps its original stamp.
- **In the browser, with real data**: signed in as the seeded Red Team
  notebook lead through the real login screen, wrote a failed try, reloaded,
  and read it back from the server with the right byline; the drafted recap
  showed the seeded session's real attendance, task and blockers; summary
  and confirm survived a reload; the print route rendered all of it.
- **Print output verified, not assumed**: headless Chrome printed the
  harness's print view to PDF (read back page by page), and the PDF's first
  fill operation was checked to be white after the color-scheme fix. Photos
  render in entries and the session log at readable size with captions.
- **The harness link proved both ways**: a sentinel edit inside
  `Notebook.svelte` appeared in the harness and the file was restored to an
  identical md5; the guard inverted to `if (dev)` answered 404 and was
  restored to an identical md5; a real edit in the harness produced
  `notebook_update` in the persist log.
- **375px and 1440px: 0px horizontal overflow** on every notebook tab, the
  open composer, and the print view, in the harness and on the real student
  pages.
- `npx svelte-check`: **0 errors, 0 warnings** (636 files). Full suite: **33
  files, 337 tests**, green against the reset stack.

### What is explicitly NOT verified

- **The mentor notebook pages through a real Google sign-in.** OAuth needs a
  human; the mentor's edit rights are proved at the database layer
  (`notebook_can_edit`, the mentor writes in the isolation test) and the
  pages reuse the student page's components and loader verbatim.
- **Paper from a physical printer.** The PDF is Chrome's print pipeline,
  which is also what "Save as PDF" uses; nobody fed a sheet.
- **A photo in the printed PDF from real storage.** The PDF's photos came
  from the harness's data-URI fixture; the real signed-URL path renders in
  the app (verified) and print uses the same `photoUrls` map, but the seeded
  evidence rows point at storage objects that were never uploaded.
- **The linked project.** `supabase migration list` shows remote at 0012:
  0013-0015 were left unpushed by the previous bundle and 0016 follows them.
  Pushing all four is one `supabase db push` (with the `.env` token) when
  the club decides.

### Deferred

- **Attaching a NEW photo from inside the notebook.** Entries cite photos the
  season already captured (evidence rows); the capture path stays on tasks,
  where the photo proves work. A "take a photo for the notebook" flow would
  need its own storage pathing and adds a second camera surface.
- **Reordering entries by drag.** `sort_order` exists and is written on
  insert; no drag UI.
- **Realtime on the notebook tables.** Left out on purpose, like the
  planner: one effective editor per section, and a refetch landing under a
  child mid-sentence would clobber the text they are typing.
- **A judge-facing table of contents or page numbers in print.** The
  document is short enough this season; the browser's print margins carry no
  numbering.

---

## 2026-08-24 -- The real field picture: schema 0017, two-corner calibration, the background layer

The route planner could already show a background picture. It stretched
whatever was uploaded corner to corner across the 2362 by 1143 mm mat
rectangle, on the assumption that a mentor had cropped it exactly to the mat
borders, and it let any signed-in account in the club read it. The club's
actual picture is the official BIOGLOW field layout, which breaks both
assumptions at once: it includes the border walls, so it is a different shape
from the surface inside it, and it is FIRST and LEGO copyrighted, so it
cannot be shown to a bucket-wide audience and certainly cannot enter a public
repo. This bundle replaces the transform and narrows the door.

### What changed

- **`supabase/migrations/0017_mat_image_calibration.sql`.** `mat_images`: one
  row per team, holding the picture's pixel size, the two calibration corners
  as fractions of the picture, and the dim setting. `storage_path` is
  `GENERATED ALWAYS` as `teams/<team_id>/field`, so a client cannot make a
  team's row point at another team's object. Three checks make a stored
  calibration one that can actually be inverted: all four corners or none, all
  inside the frame, and at least 0.05 of the picture on each axis. Mentors
  write; mentors and the row's own team read. The storage read policy replaces
  0012's bucket-wide `using (bucket_id = 'mat')` with one scoped on
  `storage.foldername(name)[2]`, so an object outside `teams/<team_id>/` --
  including 0012's root-level `mat.jpg` -- falls to mentors only.
- **`src/lib/planner/calibration.ts`**, the whole transform: two opposite
  corners of the playing surface, in picture fractions, give an origin and an
  INDEPENDENT scale per axis. `imageToMat`, `matToImage`, and the SVG matrix
  that lays a unit-square `<image>` onto the mat rectangle. Orientation is
  free: a mirrored or upside-down picture produces a negative scale and maps
  correctly, which is why the placement is a matrix and not `x/y/width/height`
  (`<image width>` refuses a negative).
- **`MatCalibrator.svelte`**: tap the launch-area corner, tap the opposite
  one, then look at the mat drawn BACK onto the picture -- surface outline,
  250 mm grid, a tick every foot -- before saving. Four percentage fields are
  the same state as the taps: the keyboard path, and the way to nudge a corner
  by a tenth of a percent.
- **`MatCanvas.svelte`**: the picture is placed by its calibration and clipped
  to the mat rectangle, so the walls are cut away. A picture with no
  calibration is NOT DRAWN. A contrast layer switches on only while a picture
  is shown: a dimming scrim at the team's setting, a dark casing under the
  route, `paint-order: stroke` outlines behind every label, heavier grid,
  frame and dots.
- **`field-image.ts`** replaces `photo.ts`. An already-acceptable file is
  uploaded UNTOUCHED (a layout is line art; a JPEG round trip softens exactly
  the edges a mentor calibrates against), and only an oversized or unusual one
  is re-encoded, PNG staying PNG. A new upload CLEARS the calibration, because
  two corners describe one picture.
- **Signed URLs are ten minutes** (`MAT_IMAGE_URL_TTL_S`), down from eight
  hours, and the canvas asks for a fresh one once if a draw fails.
- **`local-assets/` is gitignored**, and CLAUDE.md gained a "The field
  picture" section stating the distribution rule, the no-stretch rule, and the
  contrast rule.

### Load-bearing decisions

- **THE TRANSFORM IS TWO CORNERS AND NOTHING MORE.** Two opposite corners of
  an axis-aligned rectangle are exactly the freedom a picture-inside-walls
  needs: an origin and an independent scale per axis. Rotation and perspective
  were deliberately left out. A picture taken at an angle is the wrong
  picture, not a harder transform, and pretending otherwise would put a fourth
  and fifth number in front of a mentor with nothing to measure them against.
- **AN UNCALIBRATED PICTURE IS NOT DRAWN, AND THERE IS NO FALLBACK.** This is
  the whole bundle in one rule. The old behaviour was not "no calibration", it
  was "a guessed calibration", and the guess looked exactly like a correct
  one. `fetchMatImage` returns `calibration: null` for any stored pair the
  transform could not invert, and null means the layer is absent.
- **THE CONFIRMATION IS PART OF THE FEATURE, NOT POLISH.** Nothing downstream
  can catch a wrong transform, so the only defence is a drawing a mentor can
  judge against the mat in front of them. The aspect check is the one mis-tap
  arithmetic can catch alone (two corners on the same side make a rectangle of
  the wrong shape) and it names the number rather than just objecting.
- **PER-TEAM FOLDER, GENERATED PATH.** The boundary is a constraint before it
  is a policy, the same instinct as the composite foreign keys on the work
  surface. A client can send `storage_path` and still cannot change it.
- **THE DIM SLIDER IS LOCAL FIRST, PERSISTED FOR MENTORS.** The row is
  mentor-writable, so a student dragging it adjusts their own screen for the
  session rather than being told a write failed.
- **THE CALIBRATOR'S INSTRUCTION BOX IS ONE GRID CELL HOLDING ALL THREE
  SENTENCES.** Measured: with the sentences swapped in and out, a narrow
  column slid the picture 48 px UP between tap one and tap two, so the second
  corner landed where the mentor was no longer aiming. A `min-height` does not
  fix it because the wrap point depends on the width.

### What was measured

- **The error the old transform made, on the club's own 2019 by 1153 image**:
  against a plausible true calibration, corner-to-corner stretch is **183 mm**
  out at the corner of the playing surface, **153 mm** a little inside it, and
  **4 mm** dead centre. A SPIKE Prime robot is about 200 mm long, and the
  agreeing centre is why the error hides.
- **`tests/planner-calibration.test.ts`, 26 tests, green before any screen
  existed**: both tapped corners map to (0, 0) and (2362, 1143), the midpoint
  to the mat centre, the other two rectangle corners to the other two mat
  corners; an off-square calibration (0.72 of the width by 0.60 of the height
  on a square picture) maps by two independent scales; the inverse round-trips
  to 1e-12; all four picture orientations map correctly; degenerate pairs are
  refused with a positive control one step wider; the drawing matrix puts the
  tapped corners on the mat rectangle corners.
- **The calibration tests bite**: `imageToMat` mutated to the old stretch
  reddened **14 of the 26**; `calibration.ts` restored to an identical md5
  (`1ca1732cdb8a965296cfaf49daec2797`) and re-verified green.
- **`tests/mat-image-roundtrip.test.ts`, 19 tests, against the REAL picture**
  (`local-assets/bioglow-field.png`, 2019x1153, 187101 bytes, printed by the
  file so it is never in doubt): a real mentor GoTrue session uploads it into
  `teams/<id>/field`, calibrates, places a mission marker through the
  transform with the shipping `applyPlannerOp`, and a FRESH signed-in client
  reloads the whole page through `loadPlannerData` -- the marker returns at
  the same millimetre AND redraws within one pixel of the tap. The negative
  control reads the same stored millimetre through stretch-to-fit and lands
  more than 50 px away.
- **The picture is signed-URL only**: the URL serves the exact byte count; the
  same URL with the token stripped is refused; the public object endpoint does
  not serve it; an anon client cannot mint a signed URL at all. Positive
  control on every one.
- **Another team cannot fetch it**: no row, no signed URL, an empty list and a
  refused download, with the service role showing the row and the object both
  exist. Their OWN team's folder is the positive control and lists.
- **The isolation tests bite**: the storage read policy reverted to 0012's
  `using (bucket_id = 'mat')` and the `mat_images` select policy widened to
  `using (true)` reddened exactly the two cross-team tests; restored by
  `supabase db reset` from the migration files and re-verified green (policy
  expression re-read from `pg_policy`).
- **In the browser, in the live DOM at 1440x900**: the fixture picture's four
  playing-surface corners land on the mat rectangle corners at **(0, 0),
  (2362, 0), (0, 1143), (2362, 1143)** exactly, read off the rendered
  `<image>`'s own transform. The negative control: the PICTURE's own corners
  land at (-192, 1374) and (2554, -229), outside the mat, which is where
  stretch-to-fit wrongly put the origin.
- **The calibration flow, driven in the browser**: two synthetic taps at the
  fixture's known corners produce 7% / 85.6% / 93% / 14.3%, the surface is
  reported as exactly 1032 by 499 pixels, and no aspect warning fires. The
  negative control, two corners on the same side, warns "26.46:1, but the
  playing surface is 2.07:1". The stage top is identical before, between and
  after the taps.
- **The contrast layer is off unless it is needed**: over the picture, labels
  carry a `rgb(11, 18, 32)` outline with `paint-order: stroke`, the route a
  26 px casing, the grid comes up to near-white at 0.4. Toggled off, all of it
  reverts to `paint-order: normal`, `stroke: none`, no casing.
- **The harness link proved both ways**: a `data-sentinel` attribute added
  inside `MatCanvas.svelte` appeared in the harness and the file was restored
  to an identical md5 (`0d965e209a9593339feb8bee493fb2b8`); the dev guard
  inverted to `if (dev)` answered 404 and was restored to an identical md5
  (`d1df12ef269cefaef6922823c9b117b9`), 200 again after.
- **375px and 1440px: 0px horizontal overflow** with no picture, an
  uncalibrated one and a calibrated one, and on the calibrator itself. The
  mission chips scroll inside their own `overflow-x: auto` container, as
  before.
- `npx svelte-check`: **0 errors, 0 warnings** (640 files). Full suite: **35
  files, 383 tests**, green.
- **The linked project is at 0017.** It was at 0016 when this bundle started;
  `supabase db push` applied 0017 and `supabase migration list` now shows
  local and remote level at 0017 for every file in the chain.

### What is explicitly NOT verified

- **`prepareFieldImage` -- the browser-only decode and re-encode half of the
  upload.** It needs `createImageBitmap` and a canvas, so the round-trip test
  drives `uploadFieldImage` with real PNG bytes instead. What is unproved is
  specifically the pass-through-versus-re-encode decision and the pixel
  measurement, not the network path or the calibration.
- **The mentor console pages through a real Google sign-in.** OAuth needs a
  human. The upload, calibration, storage and reload paths are proved at the
  data layer with a real mentor GoTrue session, and the UI is proved in the
  harness mounting the real `RoutePlanner`; what is unproved is the two joined
  end to end in one browser tab.
- **Screenshots.** The Browser pane was not displayed in this session, so
  every visual claim above is a measurement read out of the live DOM
  (transforms, computed styles, bounding rectangles) rather than a picture.
  For the calibration claim that is the stronger evidence; for "does it look
  right over a real layout" it is not evidence at all, and a mentor's eye on
  the confirmation overlay remains the last check.
- **The real picture rendered under the schematic.** The browser checks used
  the harness's own drawn stand-in, because the real layout is copyrighted and
  cannot be a fixture. The real one went through the storage and calibration
  path in the test suite, not through a rendered canvas.
- **Whether the club's chosen calibration is correct.** Only a mentor looking
  at the confirmation overlay can say that. Nothing here knows where the
  playing surface is in their picture.

### Deferred

- **Rotation and perspective correction.** Two corners cannot model either.
  A picture taken at an angle should be retaken.
- **Per-team mission positions.** `missions.position_*` is still global, as
  0011 left it: all four teams play the same mat, so one placement serves
  them all. Only the PICTURE is per team, because the file is theirs.
- **Calibrating from the launch area rectangle instead.** `mat_config` still
  holds the launch area as two numbers a mentor measures; it could be tapped
  on the picture once a calibration exists. Not needed to fix the marker
  positions, which is what this bundle was for.
- **Removing 0012's root-level `mat.jpg` if the linked project has one.** The
  migration refuses to delete objects; it only narrows who may read them, and
  reports the count.

---

## 2026-08-24 -- The FIRST visual identity, and teams that name and colour themselves

Two changes that landed together because the second depends on the first. The
app's look was invented: a bioluminescent dark theme with colours and a
typeface nobody had checked against a guideline. It now reads as a FIRST LEGO
League Challenge tool, built from the official palettes, the official face and
the supplied marks, with the logo rules enforced by a component rather than
written down. And the four teams stopped being Red/Blue/Green/Gold with
assigned colours: they are Team 1 through Team 4, they choose their own colour
from a palette of eleven, and a colour is taken once.

### What changed

**The sources were read, not remembered.** The FIRST Branding & Design
Guidelines, the FIRST LEGO League Branding & Lockup Guidelines and the Policy
on the Use of FIRST Trademarks and Copyrighted Materials were downloaded to
`local-assets/brand/` (gitignored: they are FIRST's documents) and extracted
to text. `src/lib/brand/rules.ts` quotes the clause behind every rule with its
page number, so the next session can check a rule without the PDF.

- **The palette is the official one.** FIRST black `#231F20`, blue `#0066B3`,
  red `#ED1C24`, gray `#9A989A` (BG p9); FIRST LEGO League purple `#662D91`,
  green `#00A651`, red, black (FLL p12). FLL purple is the primary action
  because this is a FIRST LEGO League tool; FIRST blue is links and focus; the
  brand gray is the thin rule the FLL guidelines prescribe between a paired
  FIRST logo and a division lockup.
- **The face is Roboto, self-hosted, and nothing was substituted for it.**
  See "the font question" below.
- **`static/brand/` holds nine supplied files, byte for byte** -- the FIRST
  horizontal and vertical logos (full colour and reverse) and four FIRST LEGO
  League Challenge Challenge lockups. Nothing was recoloured, cropped, traced
  or re-exported.
- **`src/lib/brand/`**: `rules.ts` (the rules and the mark table),
  `BrandLogo.svelte` (renders a mark, or refuses), `FirstName.svelte` (the
  only thing that prints the names), `BrandSurface.svelte` and
  `BrandFooter.svelte` (mounted at the ROOT layout, so every surface carries
  the attribution and two full official logos), `context.ts` (the per-surface
  registers).
- **`supabase/migrations/0018_team_identity_and_accent_claim.sql`**: the four
  teams renamed to Team 1 to Team 4 (ids and join codes untouched); the accent
  enum rebuilt from four assigned colours to eleven chooseable ones; a partial
  unique index making a colour taken once across live teams; nullable accent,
  because a team that has not chosen has no colour; a proposal column trio; a
  `short_name` with a shape CHECK and a wordlist trigger; and five RPCs
  (`team_accent_options`, `team_propose_accent`, `team_confirm_accent`,
  `team_set_accent`, `team_set_short_name`).
- **`AccentPicker.svelte` and `TeamName.svelte`**, on the mentor team page and
  the student Team tab. Every swatch says free, ours, or which team holds it.

### Load-bearing decisions

- **THE GROUND IS WHITE, AND THAT IS THE BRAND-ACCURATE CHOICE AS WELL AS THE
  ACCESSIBLE ONE.** "Mainly black" in both palettes describes the INK, and the
  guidelines' preferred marks are the full-colour versions with the reverse
  versions reserved for dark grounds. Measured: the four brand accents are
  8.94 / 5.91 / 4.38 / 3.19 against white and 1.82 / 2.76 / 3.72 / 5.10
  against `#231F20`. On a black ground the brand's own accents cannot carry
  text at all. Every glow and the radial backdrop went with the dark theme: a
  mark may not sit on a busy background, and a halo in a brand accent is the
  nearest thing to recolouring one.
- **THE LOGO RULES ARE ENFORCED BY THE COMPONENT, NOT DOCUMENTED FOR IT.**
  `BrandLogo`'s only geometry prop is `height`; there is no width, rotation,
  crop, colour, radius, filter or background prop and no class/style
  passthrough, so a caller has no way to alter a mark. It refuses below the
  documented minimum, refuses a supporting mark with no full logo on the
  surface, and refuses the icon alone and the wordmark alone ALWAYS -- FIRST
  supplies no such file, and making one means cropping, which is forbidden
  outright. That last one is stricter than the guideline on purpose.
- **REFUSAL DOES NOT THROW.** A violating usage renders nothing, logs the rule
  and leaves `[data-brand-refused]` in the DOM, with the reason visible under
  `vite dev`. A brand mistake in a footer must not blank a mentor's console
  mid-meeting, and a rule enforced by taking the screen down is a rule someone
  will route around.
- **AN ANCESTOR FILTER IS THE HALF CSS CANNOT DEFEND, SO IT IS DETECTED.**
  The hostile-wrapper check in the harness found this: `all: initial` on the
  image stops inherited colour and page-level `img` rules, but an ancestor's
  `filter`, `opacity`, `mix-blend-mode` or rotation rasterises the whole
  subtree and no descendant declaration escapes it. The first draft of this
  component claimed protection it did not have. `ancestorHazard()` now walks
  the ancestors after mount and withdraws the mark, naming the element and
  the rule.
- **EVERY SURFACE IS A `BrandSurface`, KEYED ON THE PATH.** Both registers are
  per surface and are populated during component init. Carrying them across a
  client-side navigation would put the ® on the wrong page and let a mark be
  vouched for by a logo the reader can no longer see, so the root layout
  remounts on path change. The surfaces that own state are page components and
  already remount.
- **THE ATTRIBUTION IS QUOTED AND THE QUOTE WAS CHOSEN.** IP section IV.A's
  joint FIRST/LEGO trademark disclaimer, word for word. Under IP II.1 a
  registered team using its own marks is not required to post one at all; the
  other candidates in that section say the marks are "used by special
  permission", which this club has not been granted. The one used is true as
  written and names both owners.
- **THE MARKS ARE TRACKED IN A PUBLIC REPO, DELIBERATELY.** IP II.1 lets a
  currently registered team use the logos for its own team activities without
  permission or disclaimer, and BG p32 names websites explicitly, "as long as
  team identification (team name/number) appears in conjunction with the
  logo(s)" -- which is why the footer names the club and its teams and is not
  optional. This amends the previous bundle's blanket "no FIRST or LEGO
  artwork is ever tracked": that rule now says no SEASON OR GAME artwork, and
  the logos are the stated exception.
- **RED AND BLUE ARE EXCLUDED FROM THE TEAM PALETTE BECAUSE OF THE MAT.** The
  two launch areas are red and blue, and the route planner draws a team's
  route, waypoints and robot footprint in that team's accent on top of the
  mat. A team accent in either hue would have its own route read as a launch
  area, and it would look perfectly reasonable in code review. Every value
  sits outside hue [335, 25] and [200, 258]; 0018's header says so at length
  so nobody widens it back.
- **THE ENUM WAS REPLACED, NOT EXTENDED.** Postgres can add an enum value but
  never remove one, and `cyan` is squarely in the excluded blue band. Leaving
  it reachable would leave the collision one dropdown away. Existing rows were
  mapped (cyan to teal, chartreuse to lime, amber to orange, magenta stays)
  and then cleared: an assigned colour is not a chosen one.
- **THE RACE IS DECIDED BY A PARTIAL UNIQUE INDEX, NOT BY A SCREEN.** Twenty
  children on twenty phones can tap the same swatch in the same second. The
  loser gets a 23505 from Postgres, which `team_confirm_accent` catches and
  turns into a sentence naming the winner. Nothing depends on a refetch
  arriving in time. NOBODY holds an update grant on `teams.accent` any more,
  not even a mentor: the RPCs are the only door and each re-checks its caller.
- **WHO CONFIRMS IS `strategy_can_edit()`, NOT A SECOND VERSION OF IT.** The
  active Run Captain while a meeting has one, otherwise the assignment
  holders, plus any mentor. That rule already existed exactly, from 0012.
- **THE NAME FILTER NEEDED TWO LISTS.** One substring list refused
  "Passenger", "Class Act" and "Assemble" over "ass"; one whole-word list let
  "s h i t" and "fuuuck" through. So long unambiguous words match as
  substrings of the squashed text and short ambiguous ones only as whole
  tokens, over four normalisations (two leet foldings, each with repeated
  letters collapsed). It is in the DATABASE because the student runtime
  replays queued writes and a board device posts directly.
- **THREE FUNCTIONAL COLOURS ARE DECLARED NON-BRAND.** Green is 3.19 on white
  and red is 4.38; neither clears 4.5:1 as small text, and "blocked" has no
  brand equivalent at all. Darkening a brand colour and still calling it the
  brand colour is the thing the guidelines forbid, so `--success-text`,
  `--danger-text` and `--warning` are separate declared values, never brand
  expression and never near a mark -- the same category as a team accent.

### The font question

**Roboto, and nothing was substituted, because Roboto is freely licensed.**
The FIRST Branding & Design Guidelines name the Roboto family as the primary
font of the branding system (p29) and say in the same paragraph that the
weights "can be accessed free of charge along with additional font weights at
fonts.google.com/specimen/Roboto". It ships under the SIL Open Font License
1.1, which permits web use and self-hosting. Arial is the guide's own named
substitute (p30) and is the fallback in the stack. Roboto Condensed 700 is the
display face, which is the weight the brand system uses it for.

It is SELF-HOSTED via `@fontsource`, not hotlinked. The previous stylesheet
pulled Nunito and JetBrains Mono from `fonts.googleapis.com` at runtime; this
app is local-first by design, and a webfont request that never returns is a
screen of fallback metrics mid-meeting on a tablet in a gym. The mono face
(join codes, PINs, clocks) is not a brand concern and stays JetBrains Mono,
now self-hosted for the same reason.

### What was measured

- **The colour decision, not asserted**: brand accents against white are
  purple 8.94, blue 5.91, red 4.38, green 3.19; against `#231F20` they are
  1.82, 2.76, 3.72, 5.10. Every token in `colors.css` carries its measured
  ratio against all three grounds, and the ones that failed were moved:
  `--text-3` from the brand gray (2.86) to `#6B696A` (5.45 / 5.00 / 4.54, so
  it clears 4.5 even on a raised control), `--boundary` to `#7A787A`
  (4.38 / 4.02 / 3.65).
- **The team palette was derived, not picked.** Eleven colours, each binary
  searched to a target contrast, all clearing 4.5:1 on white in BOTH
  directions so one ink rule covers every swatch; every wash carries the ink
  at 13.6 or better. Closest pair, CIE76: green/sage at **21.4**. Closest any
  accent comes to an official brand colour: orchid to FLL purple at **27.9**.
  A twelfth in this gamut dropped the closest pair to 17.3, which is why there
  are eleven. The derivation script is in `local-assets/brand/`.
- **`tests/brand-rules.test.ts`, 29 tests**: every mark's minimum refused one
  pixel under and accepted at it; the icon alone and wordmark alone refused
  even on a surface holding a full logo; the vertical lockup refused alone and
  allowed beside a full logo; a supporting mark proved not to vouch for
  another; the attribution compared against the policy words character for
  character, including that it does NOT say "special permission"; the ancestor
  walk catching filter, blend, opacity and rotation, with a translate-only
  ancestor as the positive control.
- **`tests/team-identity-accent.test.ts`, 22 tests**: the seeded four are
  numbered and colourless with their join codes intact; the enum holds no red
  or blue name and refuses one (22P02); propose holds no seat so two teams may
  propose the same colour; a student cannot confirm and a mentor can; a taken
  colour is refused naming the holder; an archived team releases its colour;
  the name filter refuses seven evasions and accepts six Scunthorpe-problem
  names; the trigger bites on a RAW update with no RPC in the way; and no
  client holds an update grant on the column.
- **THE RACE, PROVED WITH TWO REAL TRANSACTIONS.** Two connections open,
  both read that the colour is free, and only then do both write. Exactly one
  commits; the loser gets `23505` on `teams_accent_unique_live`. The POSITIVE
  CONTROL is the same two transactions on different colours, where both
  commit. Sequential RPC calls would only have proved the second read the
  first.
- **The logo rules proved in the REAL component, in the browser** against
  `/dev/brand`: five full logos render at their minimums; `first-icon` and
  `first-wordmark` render nothing and leave a refusal naming the crop rule,
  on a surface that has two full logos in its footer; the FLL vertical lockup
  is refused alone and renders beside a FIRST logo, same component and same
  props, only the surface differing; 29px refused and 30px rendered. A wrapper
  applying a team accent, a `hue-rotate` filter and a border radius withdrew
  the mark with "an ancestor (div.h__hostile) applies filter: hue-rotate(90deg)",
  while the same mark in the footer rendered with zero refusals.
- **The mark is used as supplied**: computed styles on a rendered mark are
  `filter: none`, `border-radius: 0px`, transparent background, `--team-accent`
  reset to empty, aspect ratio matching the file's 1692:442 exactly, and clear
  space of 10px at a 40px render (a quarter, rounded up).
- **Name usage, off the rendered DOM**: four FIRST spans all `font-style:
  italic` and `text-transform: uppercase`; two LEGO spans both
  `font-style: normal`; and exactly `®, ®, ™` of superscripts in a paragraph
  using the name four times -- first FIRST, first LEGO, then the season's
  trademark symbol.
- **Every surface carries the footer, in the SERVER HTML**: nine routes
  checked, all with both full logo files, the verbatim attribution and the
  team identification, and zero refusals.
- **375px and 1440px: 0px horizontal overflow** on 18 surface-width
  combinations. One real failure was found and fixed: the student-screen
  harness overflowed 16px at 375px because its grid track sized to a
  fixed-width phone frame. The NEGATIVE CONTROL for the measurement itself:
  the same page in a 150px frame reports 176px of overflow, so the check can
  fail.
- `npx svelte-check`: **0 errors, 0 warnings** (655 files). Full suite: **37
  files, 436 tests**, green.
- **The catalog test earned its keep twice**: it caught
  `_teams_short_name_clean` shipping without its `revoke all from public`, and
  it caught four seed and console assertions still written against the old
  four-colour world.
- **The linked project is at 0018.** `supabase db push` applied it and
  `migration list` shows local and remote level for every file in the chain.

### What is explicitly NOT verified

- **The mentor console and student runtime through a real sign-in.** Mentor
  auth is Google OAuth and needs a human; a student PIN login needs a seeded
  session. The brand footer, the marks and the overflow were verified on every
  route reachable without a session and in the dev harnesses, which mount the
  REAL components; the accent picker's SQL side is proved end to end with real
  GoTrue sessions in the test suite. What is unproved is the two joined in one
  browser tab.
- **Screenshots.** The Browser pane was not displayed in this session, so
  every visual claim above is a measurement read out of the live DOM
  (computed styles, bounding rectangles, server HTML) rather than a picture.
  Whether the result LOOKS right to a person who knows the brand is not
  something a contrast ratio can answer, and it is the one check still owed.
- **The print surfaces on paper.** The roster card, the parent card and the
  notebook print view were updated for the light ground and the correct name
  usage, and they type-check; nobody printed one.
- **"Scunthorpe" is refused by the name filter.** A real place name caught by
  the long-word list. Accepted rather than special-cased: a mentor can set any
  name the filter allows, and the alternative is a whitelist that grows
  forever.
- **The team board kiosk at a metre.** The footer has a kiosk variant with
  larger marks; nobody stood a metre from an iPad.

### Deferred

- **A reverse-variant surface.** The reverse (dark-background) marks are
  installed and `BrandLogo` takes `variant="reverse"`, but no surface uses
  one, because every surface is now light. The prop exists so a future dark
  panel is a placement decision and not a re-download.
- **The FIRST vertical logo and the FLL vertical lockups in the app.** Both
  are installed and both render in the harness; no app surface has a shape
  that wants them yet.
- **A season lockup for CANOPY or BIOGLOW.** Season artwork is not fetched,
  committed or reproduced; the season names are text in the surrounding face,
  which is also what the IP policy asks for.
- **Per-team colour on the parent view and the board device.** Both read the
  accent already and both handle null; neither offers a way to change it, and
  neither should.
- **Realtime on the accent.** A team picking a colour is a once-a-season
  event; the picker refetches after its own write and the next page load
  shows everyone else's.

---

## 2026-08-24 -- Seat codes replace the open join window, and every entity becomes operable

Two bundles in one session: schema **0019** (per-student claim codes, and the
removal of 0013's open join window) and **0020** (the operations every entity
was missing), plus the client work for both and the repairs found on the way.

### Why the join window went

0013 built enrollment for a mentor who knows the room: open a per-team window
with one tap, watch six children type their own names, close it. The mentor
this season does not know the children's names before the first Friday, and a
window is open to whoever is holding the team code -- an older sibling, a child
from another team, the same child twice.

A seat code answers "who is allowed to take this seat" with "whoever the mentor
handed the card to", which is the actual policy. The window was removed WHOLE
rather than left standing beside the new path: `team_join_open`,
`team_join_window_open`, `team_join_window_close`, `student_self_enroll`,
`teams.join_open_since`, `teams.join_open_meeting_id`, the two console buttons,
the `join_open` key on `team_login_roster` and `team_roster_state`, the login
screen's "I'm new here" branch, and `tests/self-enrollment.test.ts`. Two
enrollment doors means one of them is untested on the morning it matters.

`student_create` is untouched: a mentor who DOES know a name still types it in.

### The decisions inside 0019

- **A LIVE CODE HOLDS A SEAT.** The cap was six active students; it is now six
  ACTIVE STUDENTS PLUS LIVE CLAIM CODES (`_team_seats_taken()`), enforced by
  `_students_team_cap` (rewritten) and `_claim_codes_team_cap` (new), both
  taking the same advisory lock 0013 took. Without this a mentor could print
  six cards for a team that already has four children and two of them would be
  turned away at the tablet holding a card that says they have a seat.
- **REDEMPTION SPENDS THE SEAT BEFORE IT INSERTS THE STUDENT**, and the
  composite `(claimed_student_id, team_id)` foreign key is therefore
  `deferrable initially deferred`. The other order asks the cap to hold seven
  seats for one statement. This was found by running the migration, not by
  reasoning: the first draft stamped `claimed_at` alone and tripped the check
  constraint that says a claim always names its student.
- **THE CAP'S SENTENCE NAMES WHAT IS ACTUALLY IN THE WAY.** With no cards out
  it is 0013's sentence, unchanged. With cards out it counts both and says so.
  A team full of children and a team full of unspent cards are different
  problems with different fixes.
- **A TEAM CODE TYPED INTO THE SEAT BOX GETS ITS OWN SENTENCE.** "That is your
  team code, not your seat code." It is the confusion that will actually happen
  in the room, the child is holding the team code either way, and a dead end is
  what loses a nine-year-old.
- **THE ANON DOOR COUNT IS STILL FIVE.** `student_claim_seat` replaces
  `student_self_enroll` one for one, and `tests/schema-catalog.test.ts` still
  says five.
- **A CLAIM CODE IS PLAINTEXT**, for the reason the parent token is: a mentor
  must be able to reprint the card a child lost. Second and last exception.

### The decisions inside 0020

- **A MEETING IS SOFT-DELETED, AND THE MEASUREMENT IS WHY.** In a rolled-back
  transaction on a seeded Friday, one `delete from meetings` took 18 attendance
  rows and 4 phases with it and detached 20 tasks. Attendance is the register of
  who was in the room. So there is still NO delete: `meeting_cancel` stamps
  `cancelled_at` and returns the counts it is keeping, `meeting_restore` brings
  it back, and `tests/entity-operations.test.ts` keeps the destructive
  measurement executable so the reason cannot rot.
- **THE CANCELLED MEETING IS EXCLUDED IN ONE PLACE.**
  `_resolve_current_meeting_id()` is what `meeting_current()`,
  `board_live_summary()`, `strategy_can_edit()` and `notebook_can_edit()` all
  ask. Four surfaces, one line.
- **REORDERING A PHASE IS AN RPC**, because `(meeting_id, ordinal)` is unique
  and not deferrable. The park value is computed, not constant: it has to be
  free, `>= 1` (the check constraint) and inside a SMALLINT, which is what the
  column is. The first draft parked at `ordinal + 1000000` and overflowed with
  22003; `tests/entity-operations.test.ts` caught it before it shipped.
- **ARCHIVING A TEAM REFUSES RATHER THAN STRANDING A ROSTER**, and names the
  count. Restoring one clears its colour if another team took it while it was
  away, because the accent is unique across live teams only (0018).
- **A NOTEBOOK PAGE IS SOFT-DELETED WITH A TEN-SECOND UNDO**, and a mentor-only
  bin (`notebook_bin`) behind it, because the undo is gone by the time an adult
  hears about it. The read filter is in the policy, so a deleted page leaves the
  notebook, the print sheet and the season stats at once.
- **A CONFIRMED RECAP IS SOMEBODY'S WORD.** `meeting_recap_regenerate` redrafts
  the unconfirmed ones and reports how many it left alone.

### What was measured

- **Baseline, re-derived:** `svelte-check` 655 files, 0 errors, 0 warnings;
  `vitest` 37 files, 436 tests green. **After:** 660 files, 0/0; 38 files, 451
  tests green.
- **The claim lifecycle, end to end in a real browser** at 375px: seat code ->
  first name, last initial, grade -> PIN twice -> "Take my seat" -> signed in at
  `/app/me` as a real GoTrue session. The student row is created and the code is
  spent.
- **Every destructive operation, both ways**, with the service role as the
  positive control: cancel keeps 18 attendance rows, 4 phases and 20 tasks; a
  soft-deleted notebook page is gone from the author's reads AND still on the
  table with `deleted_at` set.
- **Three permissive mutations, each restored byte-identically (md5 compared):**
  making `student_claim_seat` reusable reddens the single-use test; dropping
  `deleted_at is null` from the notebook read policy reddens the soft-delete
  test; gutting `team_archive`'s student check reddens the refusal test.
- **48 surface-width measurements at 375px and 1440px, all 0px of horizontal
  overflow**, with the negative control that proves the measurement bites (a
  3000px child injected into the seat-cards page reads 2637px).
- **The trademark attribution prints** on the roster card, the parent cards, the
  notebook print sheet and the new seat cards (203 characters, verbatim, under
  print media), with the negative control that hiding `footer.bf` is detected.

### Broken things found while sweeping, and fixed

- **`scripts/seed-local-session.mjs` was dead.** 0018 renamed the teams to
  "Team 1".."Team 4" and left every map in the script keyed on the old colour
  names. It crashed with UNDEFINED_VALUE at the first `student_create`, and
  before crashing it silently seeded no roles and no attendance at all. It now
  maps the colours onto the numbered teams and sets each short name through
  `team_set_short_name`, which is what a team naming itself actually does.
- **Every mentor console page scrolled sideways by 21px at 375px.** `.shell`
  was a grid with no `grid-template-columns`, so its implicit column was
  content-sized and the nav's scrolling tab row sized the whole page.
  `minmax(0, 1fr)` takes it to 0. `min-width: 0` on the nav does NOT fix it:
  the overflow is the track, not the item.
- **`FirstName.svelte` could not wrap.** `white-space: nowrap` on the whole
  name made "FIRST LEGO League Challenge BIOGLOW(tm)" a single 338px word,
  which hung 11px off the notebook print sheet at 375px and carried the
  trademark symbol out of view. The nowrap moved inward to each MARK, which is
  what the guidelines actually protect.
- **Writes that reported success from the absence of an error**, the exact trap
  CLAUDE.md warns about: the write queue's `task_status` and `task_claim` (a
  student taps Done, the tick goes green, the task is still open everywhere
  else), the console's task delete and "Team saved.", every write on the live
  board detail, the board kiosk's match-launches insert, `removeFieldImage`
  (which asked for its rows and ignored them), and the planner's mat-dimming
  setting. All now ask for their rows back and treat zero rows as a refusal.
  The queue's fix distinguishes "RLS filtered it" from "a mentor deleted the
  task while this op sat on disk" and does not blame the child for the second.
- **Raw PostgREST text shown to mentors**, e.g. `new row violates row-level
  security policy for table "tasks"`. Replaced with sentences.
- **`invalidateAll()` on the board match kiosk**, which CLAUDE.md forbids on any
  path that can run offline. Now `safeInvalidateAll()`.

### Not verified

- **Nothing was pushed to the linked Supabase project.** `.env` is gitignored
  and absent from this checkout, so `SUPABASE_ACCESS_TOKEN` is not available
  and `supabase status` reports no linked project. 0019 and 0020 are applied
  and proved against a local stack only. Run `db push` from the machine that
  has `.env`.
- **`npm run build`** was not run: it dies on Windows in the adapter and was
  not exercised on Linux here either.
- **Print output was checked in print media in a headless browser**, not on
  paper. Page breaks between seat cards are argued from the CSS.
- **The evidence-cascade orphan.** Deleting a task with photos on it cascades
  the `evidence` rows in the database with no client in the loop, so those
  storage objects are still orphaned. 0020's section 6 says so at length.

### Deferred

- **A storage sweep for orphaned objects.** The right fix for the cascade
  above, and it needs a job that can call the Storage API, not a trigger.
- **Restoring an old strategy version.** A team can look at v2 but not adopt
  it; `strategy_snapshot` only ever copies the newest.
- **Cross-team lists for strategies and board devices**, and a cross-team
  "print every parent card". The per-team pages exist; the four-teams-at-once
  views do not.
- **Mission position bulk edit** and a searchable mission list.

---

## 2026-08-25 -- A second measured ground: dark mode, and the pairings it exposed on the first one

Code only. **No migration.** `teams.accent` keeps the same eleven enum values,
the ground preference lives in `localStorage`, and nothing in `supabase/`
changed.

### What this is, and what it deliberately is not

0018 made the ground white because it was forced to: the FIRST and FIRST LEGO
League accents measure 8.94, 5.91, 4.38 and 3.19 against white and 1.82, 2.76,
3.72 and 5.10 against the brand's own black, so on a dark ground three of the
four cannot carry text at all. This bundle does not invert that ground, and it
does not bring back the bioluminescent theme 0018 removed: there is no radial
backdrop, no coloured glow, and no tinted elevation anywhere. It DERIVES a
second ground and measures every pairing on it.

- **The dark page is FIRST black (#231F20)**, and the two surfaces above it are
  that black mixed toward the brand gray in linear light (#353233, #413F40) --
  the mirror of the white ground's own construction, so no new hue enters the
  system on either side. The ink is white mixed toward the same gray
  (#F3F3F3 / #CDCCCD / #B0AEB0), and `--text-3` clears 4.5 on all three dark
  surfaces exactly as it does on all three light ones.
- **Purple and blue stay official and become FILLS.** A purple fill with white
  ink measures 8.94 whatever is behind it, so the primary action does not move.
  What moved is purple and blue AS TEXT, which on this ground measure 1.82 and
  2.76.
- **Five new declared FUNCTIONAL colours**, in the category 0018 opened for
  `--success-text`, `--danger-text` and `--warning`: `--accent-text` #CC95FE,
  `--link` / `--focus-ring` #65B1FE, `--success-text` #03C662, `--danger-text`
  #FF8B7F, `--warning` #E59E2D, each 7.2 / 5.6 / 4.6 on the three dark
  surfaces. None is a tint, a screen or a lightened brand colour presented as
  the brand colour, which is the thing the guidelines forbid outright; each is
  a separate value that is never used as brand expression and never appears on
  or near a mark. The nearest any of them comes to the official colour it
  replaces is dE 13.9.
- **`scripts/derive-dark-palette.ts` is where every number comes from.** It
  reproduces 0018's own recorded figures (8.94 / 5.91 / 4.38 / 3.19 on white,
  1.82 / 2.76 / 3.72 / 5.10 on FIRST black) from the official hex values, which
  is the control on its own arithmetic, and `tests/theme-contrast.test.ts`
  re-measures the SHIPPED stylesheets rather than trusting the comments.

### The eleven team accents: all eleven failed, all eleven were re-derived, none was dropped

Measured against the dark page, the set 0018 shipped ran from **1.81 (olive) to
3.38 (orange, purple)**. Not one of them could carry text there, because every
one of them was built to be dark enough for white. Dropping the failures would
have meant dropping all eleven and orphaning whatever colour a team had already
chosen, so each got a dark-ground variant at the SAME HUE (each ground held
within 3 degrees of 0018's value, measured in sRGB, which is the space the
launch-area exclusions are written in), lifted until it clears 4.5 on all three
dark surfaces and on its own wash, taking the brand black as its ink.

**Red and blue stay excluded on both grounds**, for 0018's reason: the mat's
launch areas are red and blue. That exclusion is why the hue is held rather
than lifted freely -- an unconstrained lift walked magenta from hue 326 to 336,
straight into the red band, and it walked violet onto the edge of the blue one.

The variant is the CLOSEST valid colour to the light one, not the most
separated. Maximising separation instead produced a near-white "magenta" and a
beige "orange": a different palette wearing the same names.

Separation, CIE76 dE over the eleven: light closest pair green/sage at 21.87,
dark closest pair violet/orchid at 21.87. 0018 measured its closest pair at
21.4 and rejected a twelfth colour for dropping that to 17.3, so both grounds
are at or above the bar it set.

### The light ground moved too, because measuring it properly showed it had to

0018 measured the eleven against the PAGE only. Measured against the two raised
surfaces and against their own washes -- which is where the app actually sets
accent-coloured text, on `.chip--on`, `.tk__tag--mine`, `.btn2--pick` and
`.bp--here` -- **five of them did not clear 4.5**: orange, lime, sage, purple
and magenta landed between 4.02 and 4.75 on `--surface-2`. They are nudged
darker, by at most dE 5. `green` moved further (8.37 to 10.88) because sage
moving darker squeezed the green/sage pair, which was already the closest in
the set.

### How the ground is chosen, and why the dark palette is written down once

Three states -- system, light, dark -- resolved to a concrete `light` or `dark`
before first paint by a blocking script at the top of `src/app.html`, and
stored per device in `localStorage` (with `system` stored as an ABSENCE, so a
device that was never told anything and a device told to follow its system are
the same device). CSS only ever sees `:root[data-theme='dark']`.

- **The dark palette is ONE block.** A `prefers-color-scheme` copy of it would
  be a second statement of the same rule, and two copies drift within a season.
  The cost is that a browser with JavaScript disabled gets the light ground
  whatever its system says; this app does not run without JavaScript anyway
  (IndexedDB write queue, realtime board, two browser clocks).
- **`@media screen` around the dark block is what makes print always light**,
  with not one token restated. Every `@media print` rule in the repo now only
  defeats the browser's "do not print backgrounds" default; the literal
  palettes those blocks used to carry (`#ffffff`, `#000000`, `#333333`,
  `#999999`, and NotebookPrint's private `#1a2330` / `#4a5768` / `#c6cdd6`) are
  gone.
- **`[data-ground='light']` forces a ground on a SUBTREE.** The notebook's
  paper preview and the route planner's mat use it.

### The three surfaces with their own problem

- **PRINT.** Verified in print media on both system schemes: `--surface-0`
  resolves to white, `color-scheme` to light, and the marks show their
  full-colour files, with `data-theme='dark'` still on `<html>`.
- **THE ROUTE PLANNER'S MAT IS A LIGHT PLATE ON BOTH GROUNDS.** The decision
  and its cost are argued at length in `MatCanvas.svelte`. The short version:
  the scrim is `--surface-0`, a real field layout is a LIGHT drawing, so on the
  white ground "dim" means "fade the picture toward white until the plan reads"
  and it works because the plan is dark ink. Let the scrim follow a dark ground
  and the same slider fades a light drawing toward black -- glare at 0%, a
  black rectangle at 90%, and somewhere in the middle the picture passes
  through the lightness of the ink on top of it and the labels vanish into it.
  A control that makes its subject less readable in the middle of its own range
  is worse than no control. The cost, stated: on the dark ground the planner is
  a light rectangle in dark chrome.
- **THE TEAM BOARD KIOSK WAS MEASURED, NOT ASSUMED.** At the iPad's real
  viewports, both orientations: 41 text runs, headings at 52 and 32.4px
  landscape, 40.5 and 24.3px portrait. Worst contrast **5.00 on the light
  ground and 5.76 on the dark one** -- so dark is not worse, and neither is
  merely adequate. The limiting factor is the same on both grounds and is not a
  colour: supporting labels ("nobody in this seat", "All done") render at 15 to
  17px, which is small at a metre. Unchanged by this bundle, and written down
  rather than fixed.

### The FIRST marks: the ground swaps the ASSET

Nothing is recoloured, filtered, inverted or blended. `BrandLogo` renders BOTH
supplied files and the ground's own tokens display exactly one, which is what
makes the right mark correct in the first painted frame instead of one
hydration later. The `variant` prop is GONE: once the page has two grounds a
caller cannot know which one its mark will land on.

- The official downloads supply a reverse file for the FIRST horizontal logo,
  the FIRST vertical logo and the FLL Challenge horizontal stacked lockup.
  Those three swap file. **The other three FLL lockups are supplied in full
  colour only, so they get a WHITE PLATE**: square, no border, no radius, no
  shadow, extending past the mark's full clear space, which is the background
  that artwork is specified for rather than the artwork altered to suit a
  ground. Said out loud here because it is a judgement call.
- The cost, stated: both files are fetched, about 225 KB more across the
  footer's two marks, once, then cached.
- The accessible name moved from the image to the wrapper (`role="img"`), because
  a `display:none` image's alt text is announced by nothing and the mark would
  have had no name on one of the two grounds.
- `ancestorHazard` still walks, and still catches the brand harness's
  deliberate `hue-rotate` on both grounds.

### Broken things found while sweeping, and fixed

Every one of these was a defect on the SHIPPED light ground, found because the
sweep measured every text pairing on every surface instead of sampling.

- **`.error` set the words of an error in the official FIRST red**, 4.38 on
  white, at semibold, which is not "large" at any size this app uses. It was a
  failing pairing before a second ground existed.
- **`.btn2--done` on the student screen was white on FLL green at 3.19**, on
  both grounds. It used `--accent-ink` (white, the ink for the PURPLE fill) on
  a green fill; green's ink is the brand black, at 5.10.
- **`--team-accent-ink` used as TEXT, in four places** (`.nb__tab--on`,
  `.nb__h`, `.nb__statn`, `.nbp__name`, `.mnb__team--on`). The ink token is
  what sits ON a filled accent chip; these are accent-coloured labels on a card
  or on the accent WASH, so the token put **white text on a near-white
  surface** -- measured 1.09, 1.20. With a team accent set, a notebook heading
  was invisible on the shipped light ground.
- **`.rp__delete` set "Delete launch" in the official red**, 4.02 on
  `--surface-1`.
- **`.btn--danger`'s border was the official red**, which is 3.50 against
  `--surface-2` on the light ground and 2.39 on the dark one, under the 3:1
  floor `--boundary` is held to.
- **`BrandLogo`'s dev-only refusal note inherited its background**, so on the
  brand harness the explanation of a refusal measured 1.11. It carries its own
  ground now, because a refusal appears wherever a mark was going to.
- **`tcard-loud` pulsed a 1.5rem amber glow in a hard-coded rgba** -- the
  bioluminescent theme's last survivor on the console, and the one thing the
  guidelines are most explicit about not putting near a mark. The inset rule
  thickens instead.
- **`ds-breathe` in motion.css** pulsed a hard-coded mint halo and had no call
  site. Removed.
- **`NotebookPrint` still carried `var(--surface-0, #0b1016)` fallbacks** to the
  pre-0018 dark theme, plus a private print palette of six literals.
- **The dev route-planner fixture picture was DARK**, so the harness tested the
  easy case: a real field layout is printed line art on a light ground, and a
  dark fixture let every overlay sit on it comfortably. It is a light drawing
  now, still drawn by this repo and still not a crop of anyone's artwork.
- **A comment in `src/app.html` named `%sveltekit.head%`.** The placeholders are
  substituted by a plain string replace, comments included, and the markup
  SvelteKit injects for the head carries comments of its own whose closing
  delimiter ended the outer comment early -- putting a paragraph of build notes
  at the top of every screen. Caught by the sweep, which reported the same
  stray text as a text run on all 27 routes. A test now asserts each
  placeholder appears exactly once.

### The one bug this bundle created and then caught

**A forced-light subtree kept the outer ground's team accent.** The first
version of the dark accents was a second table keyed on
`:root[data-theme='dark'] [data-accent]`. The `data-accent` attribute sits on an
ANCESTOR of the mat plate, so the dark value was selected outside the plate and
inherited straight in: a teal team's mat drawn in the dark ground's pale teal,
on white, with mission labels at 1.37. Two lessons, both now written into
`team-accents.css`:

- A `var()` resolves on the element that DECLARES it, so a ground that can be
  forced on a subtree has to re-declare the selection on the ground element
  itself. Each accent therefore states BOTH of its triples and the ground picks
  one; a plate cannot know which accent it is inside, but it can always ask for
  "the light one of whatever pair this is".
- `color` is an inherited VALUE, already resolved on `<body>`. A subtree that
  redefines only custom properties keeps the outer ground's ink for anything
  relying on inheritance -- which is why `[data-ground]` now also sets `color`.

### Measured

- **`tests/theme-contrast.test.ts`, 76 assertions**, parsing the shipped
  `colors.css` and `team-accents.css` and measuring every foreground against
  all three surfaces of its own ground, every fill against its ink, every
  accent against its wash, plus the launch-area hue exclusions, the separation
  floors, and that the six official values are byte-identical on both grounds.
  Its negative control asserts FIRST blue on the dark page is BELOW 4.5, which
  is the case the ground had to solve.
- **`tests/theme-toggle.test.ts`, 16 assertions**, which pull the boot script
  out of `src/app.html`, run it in a VM against a stubbed document,
  localStorage and matchMedia for all six combinations of the three preferences
  and the two system settings, and assert it is a bare `<script>` in `<head>`
  ahead of the head placeholder. Controls: a manual override must actually
  override the system, an unknown stored value must be ignored, and storage
  that THROWS (Safari private window, "block all cookies") must still leave a
  ground on the page.
- **A browser sweep of 27 routes x 2 grounds x 2 widths (375 and 1440) = 108
  page loads**, walking every rendered text node, resolving its effective
  foreground and background through the ancestor stack (and, in SVG, through
  the sibling shape a label is drawn on), and reporting every pairing under
  4.5, or 3 at large-bold sizes. **0 failing pairings, 0px horizontal overflow
  on every page at both widths, 0 ground mismatches.** Repeated as a STUDENT
  principal (8 routes, 32 loads) and as a BOARD DEVICE (2 routes, 8 loads), and
  under print media (5 routes, 20 loads, both system schemes).
- **Negative control on the contrast measurement.** `body`'s ink was set to
  `--surface-1` on both grounds; the sweep reported 20 failing pairings across
  6 distinct pairs, at 1.09 and 1.00 on light and 1.28 and 1.00 on dark.
  Restored, md5 `802dea3caf2cf0748cddfffb57424cde` before and after.
- **Negative control on the overflow measurement.** `min-width: 1800px` on
  `.board__legend`; the sweep reported 1441px of overflow at 375 and 376px at
  1440, on both grounds. Restored, md5 `2e2d0526e79b6ef308a604f845b7ece4`
  before and after.
- **No flash of the wrong ground, proved by looking at the frames the browser
  painted.** An ordering measurement against first-contentful-paint is too
  loose in dev mode: the app is module-driven, FCP lands long after anything in
  the document, and moving the boot script to the end of `<body>` still
  "passed" it. So a CDP screencast captures every painted frame and classifies
  it. With the script in `<head>`: no frame of the wrong ground on any
  route/scheme combination. **Negative control:** with the script moved to the
  end of `<body>` (`src/app.html` restored to md5
  `e13dd1dd30d69a4371000a92cddda24e`), a white frame is painted before the dark
  ground on every dark-scheme route.
- **A cold tab shows one white frame before the navigation commits**, on either
  ground. It is Chromium compositing the outgoing blank document, not this app:
  a warmed-up navigation between two app pages shows no such frame. Page code
  cannot influence it.
- **The toggle exercised in a browser**: all three states, both system schemes,
  `aria-checked` and the stored value after each click, and the ground after a
  full reload with `dark` stored.
- **The mark swap confirmed per ground and per medium**: reverse files shown and
  full-colour files hidden on the dark ground, the reverse on light and in
  print, `filter: none` on every mark in all six combinations.
- `npx svelte-check`: **0 errors, 0 warnings, 666 files.**

### Not verified

- **The DB-backed suite did not run, and neither did anything against a
  database.** This session's environment blocks Docker image layer downloads at
  the network policy (`production.cloudfront.docker.com` and the public-ECR
  CDN both answer 403 to CONNECT), so `supabase start` cannot pull an image and
  there is no local stack. **31 of the 40 test files need one.** The 9 that do
  not -- including both new files -- pass: 199 tests. Nothing in this bundle
  touches SQL, RLS, an RPC or a policy, so the risk is a regression this bundle
  could not have caused; run `npx vitest run` on a machine with Docker before
  trusting that.
- **Nothing was pushed to the linked Supabase project, because there is nothing
  to push.** No migration file was created; `supabase/` is byte-identical.
  Production remains at 0020, and this bundle does not change that.
- **The console, student and kiosk surfaces were reached through a stand-in
  PostgREST and GoTrue**, not the real stack: a small mock answers `auth_whoami`
  and `board_live_summary` with plausible shapes so the SCREENS render. That is
  sound for a contrast and overflow sweep, which measures CSS, and it is NOT
  evidence about any query, policy or RPC.
- **Print was checked in print media in a headless browser**, not on paper.
- **`npm run build`** was not run.
- **The guideline PDFs are not in this checkout.** `local-assets/` is gitignored
  and absent, so the reasoning about tints and screens of brand colours rests on
  the clauses quoted verbatim in `src/lib/brand/rules.ts` and `colors.css`, and
  on the strictest reading of them: no tint, no screen, no lightened brand
  colour presented as the brand colour. Nothing beyond those clauses was
  assumed.
- **No real iPad, and no dim room.** The kiosk figures are a headless Chromium
  at the iPad's CSS viewport. The "readable at a metre" judgement is arithmetic
  about type size, not an observation.

### Deferred

- **The kiosk's 15 to 17px supporting labels.** Equally small on both grounds,
  and a layout change rather than a colour one.
- **A `prefers-contrast: more` ground.** Both palettes clear AA; neither is
  built for AAA, and a third ground is a third set of measurements.
- **The dark ground has no counterpart to the light one's `--boundary`
  headroom.** 3.22 against `--surface-2` versus 3.65 on light. Both clear 3:1;
  the dark one has less room if a future surface is added above `--surface-2`.

## 2026-08-25 -- The planner learns to explain itself: setup chain, coach, plain language, worked example

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

## 2026-08-25 -- Lengths in the planner follow the student: mm, cm or inches

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

## 2026-08-25 -- The ledger disagreed with the database: 0019 and 0020 repaired

`migration list --linked` reported 0019 and 0020 as unapplied against a
production database that provably had `student_claim_codes`, which only
0019 creates. The suspicion going in was a wrong-project link: a bare
`supabase` command falls through to the machine's global login, which is
ambient state shared with `idea-app` and `frc-app` and is silently
re-pointed by a `supabase login` run in either of them.

That suspicion was wrong, on three counts. `supabase/.temp/linked-project.json`
already named `ypusbfatsmoukvlfgrqf`; the `.env` token resolved to the same
project and showed it `linked: true`; and running `migration list --linked`
with that token explicitly pinned still reported 0019 and 0020 as unapplied.
The link and the credential were both correct.

What was actually wrong: production held the 0019 and 0020 SCHEMA but not
the 0019 and 0020 LEDGER ROWS. Verified against the schema itself before
touching anything: `student_claim_codes` and all 19 of 0019's functions
present; 0013's `student_self_enroll`, `team_join_open` and the two
`teams.join_open_*` columns correctly gone; `meetings.cancelled_at` and
`notebook_entries.deleted_at` present; and the IN-PLACE rewrites had landed
too, which object existence alone would not have caught -- `_students_team_cap`
counts `student_claim_codes`, `_resolve_current_meeting_id` filters
`cancelled_at`, and the notebook read policy filters `deleted_at`. The SQL
had reached production by a path that writes no ledger row (the dashboard
SQL editor or a direct execute), not `supabase db push`, and two later
bundles had then asserted "production remains at 0020" from that state
without re-checking.

Repaired with `supabase migration repair --status applied 0019 0020`, which
writes only the two ledger rows and no DDL. `migration list --linked`
afterward showed a remote version on all 20 rows through 0020.

The session also tested the credential rule itself, since it exists
precisely to prevent a wrong-project problem and had not caught this one.
It fires correctly: a bogus token is refused rather than silently falling
through, and the documented WSL wrapper resolves the same project end to
end. It had nothing to catch here, because this was a wrong LEDGER, not a
wrong ACCOUNT -- the rule's blind spot is that the global fallthrough on
this machine happens to point at the same org today, so the failure mode it
guards against is latent rather than exercised.

### Measured

- `supabase/.temp/project-ref` and `linked-project.json`: `ypusbfatsmoukvlfgrqf`.
- The `.env` token's project list: exactly two projects, `sparc-hq` and
  `fll-app`, one org.
- `migration list --linked`, before repair: 0001-0018 with a remote version,
  0019 and 0020 with an empty one, WITH the token pinned.
- `migration list --linked`, after repair: a remote version on all 20 rows.
- The bare-command fallthrough (`env -u SUPABASE_ACCESS_TOKEN`) currently
  resolves to the same org as `.env`, so it could not be used to demonstrate
  the failure the credential rule guards against on this machine.

### Not verified

- **Why the SQL reached production outside `db push` in the first place** is
  inferred from HISTORY's own record (the bundle that shipped 0019 and 0020
  was authored in a checkout with no `.env` and explicitly deferred the
  push), not directly observed. The repeat of the same failure on 0021 in
  the very next bundle shows the cause was not fixed by writing this down
  once; see the standing rule this incident earned in CLAUDE.md.

## 2026-08-25 -- The grant the chain never wrote: schema 0021-0022, and the test that could only pass

The linked project granted `anon` EXECUTE on all 85 functions in `public`.
The local stack granted 5. Nothing in `supabase/` asked for either number,
`tests/schema-catalog.test.ts` had asserted the correct 5 since 0013, and it
had been green the whole time.

### What was actually wrong

- **A hosted Supabase project carries `ALTER DEFAULT PRIVILEGES` the local
  CLI image does not.** Measured, same query both sides, `pg_default_acl`
  objtype `f`, grantor `postgres`: local `postgres=X/postgres`; linked
  `postgres=X/postgres | anon=X/postgres | authenticated=X/postgres |
  service_role=X/postgres`. Migrations connect as `postgres`, so on the
  linked project every `create function` in this chain acquired an explicit
  `anon=X` at creation. `grep -rn "default privileges" supabase/` is empty:
  this was never ours.
- **The per-RPC `revoke all ... from public` could not have caught it.** That
  removes PUBLIC's implicit grant; the default is an explicit grant to a
  named role. Both statements are correct and neither was going to see the
  other. Tables escaped only because the table convention states
  `revoke all ... from anon, authenticated` BY NAME; functions had no
  equivalent line.
- **The test could only pass.** It ran against local, the one environment
  where the bug cannot occur.

### What was actually reachable, which is not the same as what was granted

Probed against the linked project with its real anon key, writers driven with
nonexistent uuids so a fall-through could not touch real data. Team rows and
counts were byte-identical before and after.

- **Every writer refused**: `team_create`, `student_create`,
  `student_reset_pin`, `team_regenerate_join_code`, `meeting_cancel`,
  `team_archive`, `team_claim_codes_issue`, `team_set_short_name`,
  `team_confirm_accent`, `strategy_snapshot`, `notebook_entry_delete`. Two
  independent mechanisms, neither of them the function grant: every DEFINER
  RPC re-checks its caller, and `is_mentor()` is `select exists (...)`, which
  cannot return NULL, so the bare `if not public.is_mentor()` in 0003 and
  0004 fires rather than falling through the way CLAUDE.md warns a
  NULL-returning gate does. The private `_` helpers are SECURITY INVOKER, so
  they ran AS anon and died on the table grants this chain does state.
- **What answered**: `team_accent_options` (the only DEFINER function in
  `public` with no caller check, direct or delegated) and four pure helpers,
  `_student_email`, `_student_slug_base`, `_generate_claim_code`,
  `_generate_join_code`. Nothing stored was disclosed: the helpers compute,
  and `team_accent_options`'s `taken_by` fields are null until a team picks a
  colour. `_student_email` leaks nothing an attacker could not already
  compute, because that rule is mirrored in `src/lib/auth/student-identity.ts`,
  which ships to every browser.
- So the exposure was one read of not-yet-populated data and four pieces of
  derivable arithmetic. Written down at this length because the honest
  finding is narrower than "85 functions were exposed", and the next person
  reading the migration header deserves the real number.

### 0021, anon

Revokes EXECUTE from `anon` across `public`, hands back exactly the five
doors, and neutralises the `postgres` default so the next migration does not
re-open it. Refuses if any of the five is missing beforehand (the sweep would
otherwise lock out the login screen or the parent link), and refuses again if
anon can execute anything but those five afterwards.

### 0022, authenticated: benign, and changed anyway

The same default over-granted 29 functions to `authenticated`: 14 trigger
functions (PostgREST will not call one outside a trigger), 14 SECURITY
INVOKER helpers, and one DEFINER, `student_claim_seat`, already a deliberate
`anon` door. **Not an exposure**, measured rather than argued. Worst
candidate is `_student_detach_from_team`: any student id, no caller check,
deletes role assignments. Reproduced on a seeded local stack with the
over-grant replicated, signed in as one student against a teammate:

    Maya deletes Diego's role_assignments directly ...... 0 rows
    Maya nulls Diego's task assignments directly ........ 0 rows
    the same delete as the table owner .................. 2 rows
    current_student_id() = Maya, is_mentor() = false

The third line is the positive control that makes the zeroes mean refusal
rather than an empty table; the fourth is the negative control that the
session was really a student. `role_assignments` carries one DELETE policy
and its qual is `is_mentor()`. The function then dies on
`permission denied for table match_runs`.

Changed regardless, for two reasons that are not "it might be exploitable":
the catalog test asserts underscore helpers are executable by nobody, and
against the linked project that assertion FAILED on all 26; and the default
was still open, so the next private helper somebody writes, which in this
schema is as likely as not to be SECURITY DEFINER, would arrive callable by
every signed-in student. 0022 revokes by name over the underscore prefix
only (never `revoke ... on all functions`, which would strip the 56 public
RPCs and take the console down), closes the `authenticated` default, and
asserts both that 0 helpers are open AND that 4 sampled public RPCs survive.

Proved safe before revoking: no column DEFAULT, RLS policy or CHECK
constraint on the linked project names a `public._` function, so nothing
evaluates one as the calling role.

### The test

`tests/db/linked.ts` reads the linked project's catalog through the
Management API (needs only `SUPABASE_ACCESS_TOKEN`, no database password) and
`tests/schema-catalog.test.ts` now asserts the five doors, the closed private
helpers, anon's absent table privileges, the neutralised default and the
applied ledger against production as well as local.

- **It reads `.env` BEFORE `process.env`, which is the opposite of the usual
  order.** This machine's shell carries a token for the account idea-app and
  frc-app use. Environment-first failed with a Management API 403. A 403 is
  the lucky outcome: another account that owned a project of its own would
  answer 200 and the suite would assert the grants of a database nobody here
  runs.
- **It skips LOUDLY via `process.stderr.write`, not `console.warn`.** Vitest
  intercepts `console.*`; the first version warned into the void and the run
  printed a bare "5 skipped", which is precisely the silent pass the whole
  arrangement exists to end.

### Measured

- Linked project, real anon key, after 0021: all five doors execute
  (`team_size_cap` 6; `team_login_roster` returns Team 1 and its join code;
  `student_claim_seat` gives its own "That seat code does not work"
  refusal, which is proof it RAN). Negative control, ten previously reachable
  functions, all `42501`: `team_accent_options`, `_student_email`,
  `_student_slug_base`, `_generate_claim_code`, `_generate_join_code`,
  `is_mentor`, `auth_whoami`, `team_create`, `team_claim_codes`,
  `strategy_can_edit`.
- Linked project after both: anon executes **5 of 85**, 0 private helpers
  open to anon or authenticated, `postgres` function default names neither
  role.
- The new remote assertions were run BEFORE 0022 was pushed and **failed on
  exactly the three things 0022 fixes** while passing the two 0021 fixed.
  That is the control that they bite.
- The loud-skip path was exercised by hiding `supabase/.temp/project-ref`:
  banner printed, 5 skipped, run still green.
- `supabase db reset` rebuilds 0001-0022 clean, guards and all.
- `tests/schema-catalog.test.ts`: **19 passed.**

### Not verified

- **0021 and 0022 were each applied to production outside the chain before
  the ledger knew about them**, exactly as 0019 and 0020 had been. Both were
  confirmed by their end state and repaired with
  `migration repair --status applied`. The habit, not the schema, is the
  thing still unfixed here.
- **The `authenticated` grant on the 14 trigger functions and on
  `student_claim_seat` is left standing** on the linked project. Neither is
  reachable in a way that matters and 0022 restores a rule about underscore
  helpers, not a full grant-for-grant reconciliation with local.

### Deferred

- **The table and sequence hosted defaults are untouched.** `anon` holds no
  table privilege today, because every table in this chain states its own
  revoke. A future table whose author forgets that line is world-readable on
  the linked project and correct on local: the same bug in a different hat.
  0021 section 5 records the measurement.
- **`team_accent_options` still has no caller check.** It is now
  `authenticated`-only and reveals which team took which colour, which
  teammates can see anyway. It should probably still gate.

## 2026-08-25 -- Schema 0023: the other two hosted defaults, and a gate on the last ungated function

The two things 0021 and 0022 each wrote down and did not do.

### What the defaults actually differed by

Measured on both environments before anything changed. `pg_default_acl` in
`public`, grantor `postgres`, which is the row that governs because
migrations connect as `postgres`:

    TABLES     linked  anon=arwdDxtm   authenticated=arwdDxtm
               local   anon=Dxtm       authenticated=Dxtm
               difference: a, r, w, d -- INSERT, SELECT, UPDATE, DELETE

    SEQUENCES  linked  anon=rwU        authenticated=rwU
               local   anon=w          authenticated=w
               difference: r, U -- SELECT and USAGE

Both keep `Dxtm` on tables (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN), which
is the "nothing useful by default" CLAUDE.md has always described. The
`supabase_admin` rows are IDENTICAL on both sides and were left alone.

**Nothing was leaking.** `anon` held no table privilege on either
environment, and `authenticated` held SELECT and DELETE across the same 28
tables on both. There are ZERO sequences in `public`, so that half governs
nothing that exists. The convention worked; every table in the chain states
its own revoke and every table had done it.

### Why it changed anyway

A convention holds until somebody forgets, and the forgotten case is
invisible: the migration is silent about grants it did not write, and until
0022 the suite only ever looked at local. Proved on PRODUCTION, both
directions, in a self-undoing `do` block that raised its result so nothing
committed:

    with 0023 ................ postgres=arwdDxtm | service_role=arwdDxtm
    hosted default restored .. postgres=arwdDxtm | anon=arwdDxtm |
                               authenticated=arwdDxtm | service_role=arwdDxtm

The same table, forgotten the same way, is owner-only under 0023 and fully
readable and writable by `anon` without it. Confirmed afterwards that no
probe table was left behind and the default was unchanged.

`revoke all` rather than "match local", because local's remaining `D` is
TRUNCATE, which no RLS policy governs. Not reachable through PostgREST, which
is how local got away with it, but "not reachable through the API we happen
to use" is weaker than "not granted". The chain needs none of these defaults.
Because the file is in the chain it applies to both environments, so they
converge instead of drifting further apart. `service_role` is untouched, as
in 0021 and 0022.

ALTER DEFAULT PRIVILEGES governs objects created after it and nothing else,
so this could not affect an existing row, table or grant. The guard asserts
that anyway, plus that `authenticated` can still SELECT at least 20 tables,
which would catch a later edit turning one of those statements into a real
sweep.

### The gate on team_accent_options

**A signed-in mentor or a signed-in student.** It was the only SECURITY
DEFINER function in `public` with no caller check, direct or delegated.

Ruled out in order: **mentor only** is wrong, because `AccentPicker.svelte`
is on the student's own /me/team screen and a Run Captain proposes the
colour; **the caller's team** is meaningless, because `teams.accent` is
unique across live teams by partial index, so "which colours are taken" is
inherently a question about the OTHER teams and a team-scoped answer would
always say "nothing is taken"; **nobody** is already true for `anon`, which
lost EXECUTE in 0021, and this is the second line of defence beneath that.

Board devices are excluded deliberately: `current_student_id()` reads
`students` and a board lives in `team_board_devices`, so it answers NULL and
the gate refuses. That is CLAUDE.md's existing rule that a board is a device
and not a person. There is no board caller; the two callers are the mentor
team page and the student /me/team page.

It raises rather than returning `[]`. "Probing reveals nothing" governs the
anon doors, where an empty answer is what stops a stranger learning whether
something exists; every caller that now reaches this function is signed in,
and an empty palette on a colour picker reads as a broken screen.
`board_live_summary` is the precedent for a signed-in caller of the wrong
kind. The function moved from `language sql` to `plpgsql`, which
`create or replace` allows because the signature and return type are
unchanged, so the signature trap does not apply.

### Measured

- Linked project after 0023: table default `postgres=arwdDxtm |
  service_role=arwdDxtm`, sequence default `postgres=rwU | service_role=rwU`.
  Neither API role appears in either.
- The three new remote assertions were run BEFORE the push and failed on
  exactly the three things 0023 fixes (table default, the gate, the ledger),
  while the sequence assertion correctly passed. That is the control that
  they bite.
- **Permissive mutation, the gate:** 0018's ungated definition was restored
  on local and `tests/board-device.test.ts` reddened with
  `expected undefined to be 'Only a mentor or a team member ...'`, which is
  the board reading the palette. Restored with `db reset` and confirmed
  byte-identical: `md5(pg_get_functiondef(...))` is
  `bb3fca7938c6a4a1b2ed486c1ca575a8` before and after.
- Live on production with the real anon key: `team_accent_options` still
  `42501` from 0021; positive control `team_size_cap` still returns 6.
- Live on local, both halves of the gate: a board is refused by name, a
  mentor gets 11 options, a student gets 11 options.
- `npx svelte-check`: **0 errors, 0 warnings, 683 files.**
- Full suite: **41 files, 562 tests, all passing.**

### Not verified

- **The gate was not exercised by a signed-in caller against the linked
  project.** Production has one mentor (Google OAuth) and zero students, so
  there is no session to sign in with. The remote assertion is from the
  catalog (the body carries the check and is still DEFINER); the live
  both-directions proof is on local against real GoTrue sessions.
- **`supabase_admin`'s defaults are untouched** on both environments. They
  are identical on both sides, this chain creates nothing as that role, and
  changing a platform role's defaults is not this file's business.

### Deferred

- Nothing from 0021 or 0022 is still open. The three hosted defaults that
  matter to this chain are closed for both API roles.

## 2026-08-25 -- Two defects a mentor's first real calibration found

Both surfaced from one mentor's first attempt at calibrating the mat with the
official FLL engineering notebook path-planning diagram, which reads the
whole field but measures nearer 1.75:1, not the mat's own 2.07:1.

### The aspect note read as an error over a legitimate picture

The aspect check (0017) exists to catch one mistake arithmetic can notice on
its own: two corners tapped on the SAME side of the mat, which produces a
rectangle of the wrong shape. But calibration scales each axis independently,
so a picture that is not drawn to true 2.07:1 calibrates correctly anyway,
and the arithmetic cannot tell that apart from the mistake it can catch --
both produce an off-ratio tapped rectangle. The message ("Check you tapped
corners that are diagonally opposite...") only spoke to the mistake, in the
bold `--warning` treatment used elsewhere for real errors, and the mentor
read it as one and stopped.

Saving was never actually blocked by this check; the save button is gated on
`usable` alone (spans above `MIN_CALIBRATION_SPAN`), which the aspect ratio
never touches. The defect was entirely in what the message implied, not in
what it did.

Rewritten to keep the ratio, name the likely benign cause first (the picture
may simply not be drawn to scale), point at the actual check (does the drawn
grid sit on the mat), and only then give the diagonal-opposite guidance --
one message, because the arithmetic still cannot distinguish the two causes.
Moved off the bold warning treatment (`cal__warn`, `--warning`) onto the same
neutral `small muted` style the confirmation text already uses, since "your
picture is not to scale" is not a problem to fix.

### "Calibrate now" did nothing when the calibrator was already open

The mat setup panel's copy and button were written for the ONE state where
the calibrator is closed. `calibrating = true` when it is already true is a
no-op with nothing to show for it: the panel kept saying "This picture has no
calibration yet, so it is not shown on the mat" and its "Calibrate now"
button reopened what was already on screen, above a panel a mentor is often
scrolled past. It read as broken.

`goToCalibrator()` replaces the bare `calibrating = true` everywhere in
RoutePlanner.svelte: it sets the flag AND scrolls `matBlockEl` into view,
unconditionally, so the button does something visible whether the calibrator
was already open or not -- including on first upload, where the calibrator
used to open automatically off screen while the file input stayed in view.
The panel's own paragraph now checks `calibrating` first and says the
calibrator is open above, and its button relabels to "Go to the calibrator".
The setup checklist's "Finish calibrating" item got the same fix, for the
same reason: it had the identical no-op.

### The duplicate save message

"New picture saved. Calibrate it before it is shown." (field-image.ts) was
rendered twice at once on a fresh upload: once inside `MatCalibrator` (which
receives `pictureMsg` as its `message` prop) and again in the panel's own
`{#if pictureMsg}` paragraph, because the panel had no reason to know the
calibrator was already showing the same string. The panel now suppresses its
copy of `pictureMsg` while `calibrating` is true.

### Measured

Driven through the REAL `RoutePlanner` and `MatCalibrator` components in a
browser, mentor scenario, via `/dev/route-planner`. `computer` coordinate
clicks were unavailable in this session (the pane would not composite a
screenshot); taps were dispatched as real `PointerEvent`s at coordinates
computed from the SVG's `getBoundingClientRect()` and the calibrator's own
`pointFromEvent` math, onto the exact `onpointerdown` handler a real tap
reaches -- the same technique a testing library uses, not a shortcut around
the component.

- **A new dev-harness fixture**, `uncalibrated-nonscale`: playing surface
  980 by 560 inside a 1200 by 700 picture, a clean 1.75:1, matching the real
  notebook diagram's proportions. Tapping its real corners: note reads
  "Those corners make a 1.75:1 rectangle; the playing surface itself is
  2.07:1. That is often fine...", save button `disabled: false`, and saving
  produced exactly one persisted calibration op with no duplicate message
  anywhere -- the panel's own paragraphs, read from the DOM, are the static
  explainer and "The calibrator is open above...", nothing else.
- **Negative control, same fixture:** two corners tapped on the same (top)
  side, 1.75:1 fixture, spans both comfortably above `MIN_CALIBRATION_SPAN`
  so this exercises the aspect branch rather than the degenerate one:
  19.60:1 rectangle, same message text (unavoidable -- one signal, two
  causes), and it still names the actual mistake and the fix. Save stayed
  enabled, matching the pre-existing "warns, does not block" design; this
  bundle did not add a hard block.
- **Regression control:** the original fixture, drawn to the mat's true
  2.07:1, produces NO note on its real corners -- the plain "playing surface
  is 1032 by 499 pixels" confirmation, unchanged.
- **The degenerate case** (two corners almost on top of each other) still
  disables save, unchanged; the "almost on top" message itself did not
  render in this run because `calibrationFromCorners` returns `null` below
  `MIN_CALIBRATION_SPAN` and the branch is gated on a non-null `candidate` --
  pre-existing, not touched by this bundle, not one of the two defects, and
  not a regression (`git diff` confirms that line is untouched).
- All of the above repeated at 375 and 1440 px: `document.documentElement
  .scrollWidth - window.innerWidth` is **0 at both widths**, before tapping,
  after tapping, and with the aspect note visible.
- `npx svelte-check`: **0 errors, 0 warnings, 683 files.**
- Full suite: **41 files, 562 tests, all passing.** No test asserted the old
  copy, so none needed updating.

### Not verified

- **The exact production string** ("New picture saved. Calibrate it before
  it is shown.", from `field-image.ts`) was not reproduced verbatim: the dev
  harness's `onUploadPicture`/`onSaveCalibration` are canned mocks
  ("harness: nothing is uploaded here.", "harness: calibration logged, not
  stored.") that never touch Supabase Storage. The suppression mechanism
  (`pictureMsg && !calibrating`) was exercised end to end with the harness's
  own strings taking the identical code path; the production string itself
  is a constant this bundle did not change.
- **No migration.** This is copy and control-flow only; nothing in
  `supabase/` changed, so there is nothing to push and nothing for
  `migration list --linked` to report.

### Deferred

- The degenerate-candidate gap above (no message when `candidate` is `null`)
  is a pre-existing rough edge, not one of the two reported defects. Left as
  found.

---

## 2026-08-26 -- The code generator lands: SPIKE word-block emitter, schema 0024, and a route that refuses a bad file

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

## 2026-08-26 -- The registry arrives: V9 becomes a real check, and a placeholder can no longer ship quietly

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

## 2026-08-27 -- V5 and V8: the two checks that read what V6 through V11 cannot see

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

## 2026-08-27 -- A mentor door onto the generator, and units that do not drift

Two gaps reported from use. A mentor could be told by the database that they may
edit a team's robot and have nowhere to do it, and the two geometry fields could
only be read in millimetres.

`IDEA_INTERFACE_STANDARDS.md` is NOT in this repository, and was not at the time
this was written: the only tracked Markdown is `CLAUDE.md`, `README.md`,
`docs/FLL_CODEGEN_SPEC.md` and this file. The three rules quoted in the request
were followed instead: one component gated by prop, gate at the load and not
only in the markup, presence of a transport is presence of a control.

### What landed

- **`/app/codegen` and `/app/codegen/[teamId]`, the mentor entry point.** Same
  two-file shape as `/app/plan` and `/app/notebook`: a picker of live team tiles,
  then the surface with a team strip across the top. No picker was invented; the
  planner's was matched, down to the tile markup. `Robot code` joins the console
  nav between Plan and Notebook.
- **NO SECOND MENTOR PAGE.** `CodegenPage.svelte` is still the one render path
  and now says so in its own props. The team was already a prop; what changed is
  that it is now the ONLY thing that differs between the two surfaces, because
  the role flag went away.
- **The save transport replaced the client prop.** `CodegenSave` is a function a
  surface supplies; `supabaseCodegenSave(supabase, teamId)` is the real one and
  closes over the team its load resolved. The component no longer imports
  `saveConfig` or `saveCalibration`, no longer knows what Supabase is, and the
  Save section renders `{#if save}`.
- **Millimetres, centimetres and inches on both geometry fields**
  (`src/lib/codegen/units.ts`), remembered per device in `localStorage` beside
  the theme. No migration: `wheel_diameter_mm` and `track_width_mm` are
  unchanged and a unit never reaches the database.
- **Wheel presets:** 56 mm, 43.2 mm, 88 mm, and Custom, which is what the select
  reads whenever the stored diameter is not one of the three.
- **The readout keeps its millimetres and gains the chosen unit beside them:**
  `300 mm (11.811 in) = 614 motor degrees`. Millimetres are what goes into the
  file, so they are never replaced, only accompanied.

### Load-bearing decisions

- **A TRANSPORT, NOT A ROLE FLAG, AND THE DIFFERENCE IS WHAT HAPPENS WHEN A
  SURFACE FORGETS.** `isMentor={true}` is a claim the page has to trust, and a
  page that trusts a flag it was handed is a page that can be lied to. A
  transport either exists or it does not. Retyping the prop turned both existing
  callers into compile errors until they supplied one, which is the behaviour
  being bought: a surface that forgets fails closed, at the type level, before
  it ever renders.
- **PRESENCE OF A TRANSPORT IS PRESENCE OF A CONTROL.** The old Save button
  rendered unconditionally and its handler began `if (!supabase) return`, so the
  dev harness showed a button that answered a tap with silence. Now no transport
  means no section. What a caller may WRITE is still the database's answer,
  discovered by asking for the row back; the transport only decides whether
  there is anything to press.
- **THE GATE IS AT THE LOAD.** `/app/codegen/[teamId]`'s load 404s a team that
  does not exist or has been archived, before a component is chosen or a prop is
  built. The `(mentor)` group's layout has already answered 403 to anyone who is
  not a mentor. Neither decision is made in markup, and the markup makes none of
  its own: it renders what the prop says.
- **`commit()` IS THE WHOLE UNITS FEATURE.** A field shows a rounded number.
  Converting that number back and storing it is how 56 mm becomes 56.007 mm, and
  then 56.014, and the wheel diameter is the DIVISOR in the distance conversion
  so the error scales every distance in every run. So the field's text and the
  row's millimetres are synced in ONE DIRECTION AT A TIME: text goes to
  millimetres through `commit()`, which refuses a number the field itself
  printed; millimetres go to text only when the unit changes or a preset is
  picked, never while somebody is mid-word in the box.
- **The stated trade:** retyping the number a field is already showing is a
  no-op, because the field's resolution IS its display precision. Anyone who
  genuinely wants 56.007 mm switches the field to mm, where it can be said.
- **`fromUnit()` cuts IEEE-754 dust at six decimals of a millimetre, which is
  not display rounding.** `2.25 * 25.4` is 57.150000000000006 in this language
  and a `numeric` column would keep that verbatim forever.
- **The unit is read from `localStorage` after mount, never in the initialiser.**
  Seeding it during SSR would make the hydrated client disagree with the HTML the
  server sent, and `localStorage` throws rather than returning null in a private
  window. Same reasoning as the theme, and the same try/catch.

### Measured

- **The units test, `tests/codegen-units.test.ts`: 18 passed.** The required
  case: a 56 mm config painted into an inches field shows `2.205`, the untouched
  field hands `2.205` back, and `commit()` returns exactly 56
  (`Object.is(stored, 56)`). Its control: typing `2.25` stores exactly `57.15`,
  `6.2` cm stores `62`, and an edit one display step away (`2.206`) lands as
  `56.0324` rather than being swallowed.
- **The guard was proved to bite, not assumed to.** The naive conversion the
  first branch refuses is asserted to produce `56.007`, and five saves of it in a
  row are asserted to drift while five saves through `commit()` are asserted not
  to move at all.
- **In a browser, at 375 and 1440, both payloads, real component.** Student
  payload (Team 1, teal) and mentor payload (Team 3, orange) at both widths:
  horizontal overflow **0 px** at every one, heading rendered, unit control
  reading `mm | cm | inches`, wheel select offering the three presets plus
  "Something else (type it below)". Generate from each produced **FLL Toolkit v1,
  374 blocks, 9 stacks, six extensions** and **FLL Toolkit Self Test, 466 blocks,
  10 stacks, seven extensions**, verdict "Checked: nothing wrong. 2 files ready.",
  with the download control present. The only console error was a 404 for
  `/favicon.ico` at 375, which is pre-existing.
- **The units rule watched in the browser, not only asserted.** Opened at 56.0 /
  112.0 mm; switching to inches repainted the fields to `2.205` and `4.409` and
  the note under them read "Saved as 56.0 mm across and 112.0 mm apart". Save
  with the field untouched handed the transport **wheel 56 mm, track 112 mm**.
  Focusing the field, firing its input event (the field echoing its own display)
  and saving again handed the transport **56 mm** again. Typing `2.25` moved the
  readout from 614 to 602 motor degrees and handed the transport **57.15 mm**.
  Switching back to mm showed `57.1` in a one-decimal field while the row held
  57.15, and the preset select correctly read "custom".
- **The preference survives a reload:** chose cm, reloaded, and came back to
  `WHEEL ACROSS (CM) = 5.60` with the readout `300 mm (30.00 cm) = 614 motor
  degrees`. Presets from there: 43.2 mm gave 796 motor degrees, 88 mm gave 391,
  and saving handed the transport **88 mm** exactly.
- **No transport, no control:** `/dev/codegen?save=off` renders zero Save
  buttons and no "Keep these numbers" section, with Generate still present.
- **Both new routes exist and are gated.** With no session, `/app/codegen` and
  `/app/codegen/<uuid>` both land on `/login?next=...`, and the RENDERED TEXT was
  checked rather than the status code, because a sweep that follows redirects
  measures the login page and reports it as a clean surface.
- **The mentor write path, against the applied chain.** A mentor has
  `is_mentor() = true` and `current_student_team_id() = null`, and
  `strategy_can_edit()` is true for both teams. The insert `saveConfig` sends
  returned 1 row; the reload read back
  id `88459096-0133-48f3-ac4e-baf2971d6f8f`, name `Mentor base mentort1n`,
  wheel 56, track 112, gears 1. `wheel_diameter_mm` came back as the string
  `"56"` (it is `numeric`, so PostgREST hands it over as text) and
  `Number()` of it is exactly 56. Writing 56 again left it at 56; writing the
  drifted 56.007 showed the column keeps it verbatim, which is why the guard is
  in the client and not hoped for in the database.
- **The dark ground and both accents were looked at**, at 1440, in inches: 0 px
  horizontal overflow, the selected unit chip carrying the team accent, and no
  new colour token introduced (`.cg__also` uses `--text-muted`, already measured
  on this surface).
- `npx svelte-check`: **0 errors, 0 warnings, 715 files.**
- **The full control suite: 23 negative controls CAUGHT, 5 positive controls
  SILENT, 1 reporting case, 56 tests across three files.**
- The full suite: 15 files passed, 29 failed, 289 tests passed. Every one of the
  29 fails on GoTrue or PostgREST being absent, unchanged from the last bundle.
- The repo-wide em dash and en dash check is clean.

### Not verified, and one premise corrected

- **A MENTOR CAN WRITE TO ANY TEAM, INCLUDING ONE THEY DID NOT SELECT, AND THAT
  IS THE SCHEMA WORKING AS WRITTEN.** The request asked to confirm that a mentor
  on no team still cannot write to a team they did not select. Measured, the
  database says the opposite and says it deliberately: `strategy_can_edit()` is
  `is_mentor() OR the Run Captain`, so mentor B inserting into a team mentor B
  never opened returned 1 row with no error. 0024's header says as much ("any
  mentor, and the Run Captain"), and it is the same rule the route planner has
  had since 0012. What actually scopes a mentor is the APPLICATION: the
  transport closes over the team its load resolved, and `CodegenSaveInput`
  carries no team field, so a rendered page has no way to name a different one.
  That is a closure, not a boundary, and it is written down here rather than
  described as one.
- **The boundary that IS in the database is the student one, and it holds.** A
  student who is not the Run Captain got `strategy_can_edit = false`, an INSERT
  refused outright with `42501` ("new row violates row-level security policy for
  table robot_configs"), and an UPDATE of another team's row that returned zero
  rows with no error. Positive controls: mentor B READS team one's row (1 row,
  because 0024's read policy names mentors), and a team two student reads it as
  0 rows where the service role reads 1.
- **Nothing was signed in through the real routes.** No container registry is
  reachable from this session (`ghcr.io` and Docker Hub blob hosts both answer
  403 through the agent proxy), so GoTrue and PostgREST could not be started and
  no browser could hold a mentor or student session. The browser evidence above
  is the REAL component under both payloads in the `/dev` harness, plus the
  redirect both real routes perform with no session. The database evidence is
  the real chain on a PostgreSQL 16 cluster with a hand-built stand-in for the
  platform base, with every statement issued the way PostgREST issues one.
- **The "Drive this far" box is still millimetres.** The readout beside it now
  carries the chosen unit, which is what was asked; making the input itself
  unit-aware was not, and a third field that converts is a third place the
  rounding rule has to hold.
- **`database.types.ts` is still unregenerated**, so `storage.ts` still goes
  through its `untyped` handle. `supabase gen types` runs `postgres-meta` in a
  container and cannot be pulled either.

### Deferred

- A mentor picking a team still lands on that team's FIRST saved config, because
  `CodegenPage` reads `data.configs[0]`. A team that keeps two (the season base
  and the January heavy base, which 0024's header anticipates) has no way to
  choose between them on this screen. The row supports it; the surface does not.

---

## 2026-08-27 -- A seat code is typed once per device, ever

Reported from use: a child who joined with a seat code had to go most of the way
back through signing up to sign back in. The audit found why, and it was not
where it looked.

### What was actually wrong

The join door and the return door start from TWO DIFFERENT CODES. A child joins
with a SEAT code off a printed card; the sign-in screen asks for the TEAM code.
Those are different codes (0019 separated them on purpose and the login screen
already explained the difference), the seat code is spent the moment it is used,
and nothing ever showed the child the team code. So next Friday they typed the
spent seat code into the team-code box, were told no team had it, tried the
seat-code door, were told the seat was taken, and asked a mentor for a third
code they had never been given.

`student_claim_seat` has always returned `join_code`, `team_id`, `team_name` and
`slug` alongside the address. The login screen read the address, signed in with
it, and let the rest go out of scope one line later.

### What landed

- **`src/lib/auth/device-team.ts`**, the whole of the device's memory: one join
  code, in one cookie, with the reasoning for both.
- **The memory is written in `hooks.server.ts`, when a STUDENT principal
  resolves.** Every door in ends there -- the card, the roster, a mentor
  resetting a PIN -- so no door added later can forget to, and no client code
  touches it. Mentors and board devices do not write it.
- **`/login`'s load resolves the roster on the SERVER** when the device
  remembers, so the names are in the first HTML rather than one round trip
  later on school wifi. A remembered code that no longer names a live team
  (regenerated, archived) is forgotten rather than shown as an empty screen.
- **The roster is the screen a returning child lands on:** the team's name, then
  a grid of 88px name slabs, two columns at 375. No code field, no dropdown, no
  box to type a name into.
- **Tapping a name focuses the PIN box inside the tap's own handler**, which is
  the user gesture iOS requires to raise a keyboard, and the sixth digit submits.
  The Sign in button stays for anyone who arrives another way.
- **"Not my team" is a plain form POST to `?/forget`**, which clears the cookie
  and returns the code field. A shared iPad moves between tables; a GET that
  clears device state is a GET a prefetch can fire; and this is the one control
  on the screen that has to work when JavaScript has not.
- **The seat-code door is untouched** and is still the first thing under the
  roster, because the second child to join on a remembered iPad is holding a
  card and nothing else.

### The judgement asked for: cookie, not localStorage

**A first-party cookie set by this server: `httpOnly`, `SameSite=Lax`, `Secure`
following the scheme, `Max-Age` 400 days.** Three reasons, in order of weight.

1. **SAFARI DELETES SCRIPT-WRITABLE STORAGE AFTER SEVEN DAYS.** localStorage,
   IndexedDB and cookies written from page script are all in that category, and
   the clock is seven days of Safari use without interacting with this site.
   THESE TEAMS MEET ONCE A WEEK, Friday and Saturday. A memory with a seven-day
   life and a seven-day refresh interval works until the week a child is off
   sick. A cookie set by this server in an HTTP response is not in that sweep.
   This app is a Safari tab and nothing else: there is no manifest and no
   service worker anywhere in `static/`.
2. The login page is server rendered, so the cookie is readable BEFORE first
   paint and the roster ships in the HTML.
3. `httpOnly` costs nothing, because no page script needs to read it, and
   rewriting it is the only useful thing an injection could do with it.

**What it does not survive, stated rather than hoped:** Settings, Safari, Clear
History and Website Data wipes it like everything else, and a private tab never
has it. Both land the child on the team-code field, which is the screen that
exists for exactly that. It does not follow a child to another iPad, which is
correct: it is the iPad's memory, not theirs.

**Why it is safe to keep:** the value is a JOIN CODE, already public to everyone
on the team, already granted to `anon` through `team_login_roster`. It
authenticates nobody.

### Sessions: they do persist, and that was never the cause

Measured from the configuration and then in a browser. `createBrowserClient`
(`@supabase/ssr` 0.12.4) with no cookies option uses `document.cookie` with
`persistSession: true`, `autoRefreshToken: true` and `maxAge` 400 days;
`config.toml` sets `jwt_expiry = 3600` with rotating refresh tokens, and
`[auth.sessions]`'s `timebox` and `inactivity_timeout` are both COMMENTED OUT,
so nothing forces a logout. **There was no timeout to extend.**

What actually ends a session, in the order it bites: (1) explicit sign-out,
which on a shared iPad is the NORMAL hand-off to the next child and is correct;
(2) iOS purging script-writable storage, which takes the session cookie with it
because that one IS script-written; (3) clearing website data.

So the cause of the reported pain was that the team identity was COUPLED to the
session and died with it. The fix is the decoupling: the device remembers its
team separately, and sign-out does not touch it. That is why the cookie name is
outside the `sb-` namespace `signOut()` clears, and why a test asserts it.

### Measured

- **In a browser at 375 wide, cold open to signed in: 1 tap and 6 keystrokes.**
  Tap your own name, type your PIN, in. Before: **3 taps and 12 keystrokes** for
  a child who KNOWS the team code (tap the code box, six characters, Find my
  team, tap the name, six digits), and the child in the report did not know it,
  so their real path was two dead ends and a mentor.
- The name tiles measure **135 x 88 px** at 375, two columns, **0 px** of
  horizontal overflow.
- **A wrong PIN fails and says so:** "That PIN did not work. Try again, or ask a
  mentor to reset it.", the box is cleared, and the screen stays on that child's
  PIN step. **The right PIN typed immediately afterwards succeeds** and lands on
  `/app/me` showing "Team 1 / Ada L.".
- **The escape clears the memory:** before, cookie `DGM2E7`, 0 code fields, 3
  names; after one tap on "Not my team", cookie CLEARED, 1 code field, 0 names,
  and a reload does not bring it back. A remembered code that names no live team
  behaves the same way on its own.
- **The cookie the SERVER sets:** `httpOnly=true`, `SameSite=Lax`, 400 days, and
  `document.cookie` in the page does not contain it. (A first pass at this check
  injected the cookie from the test instead, which measured the test's own flags
  and not the server's; it was redone through a real sign-in.)
- **The session survives a browser restart.** Signed in, listed the persistent
  cookies (`sb-127-auth-token` 400d, `fll-device-team` 400d), CLOSED THE BROWSER
  PROCESS, launched a new one with only what was on disk, and went straight to
  `/app/me`: 200, still signed in, "Team 1 / Mila R.".
- **Cross-team isolation still holds after all of it.** Four task rows exist
  across four teams; Ada sees exactly the one on her own team. Asked for another
  team's row BY ITS EXACT ID she gets 0 rows where the owner gets 1, so the empty
  answer is a filter and not an empty table. One of the three rows she cannot see
  is on a different team that happens to share the NAME "Team 1", which is the
  sharper form of the same proof: the boundary is the team id.
- `tests/device-team.test.ts`: **7 passed** with a stack, **4 passed and 3
  skipped** without one. The four that always run are the ones that matter most
  here: junk in the cookie is no memory at all (including the four symbols the
  join alphabet excludes, and a quoted SQL fragment), the flags are what they
  claim, and the cookie name is outside the namespace `signOut()` clears.
- `npx svelte-check`: **0 errors, 0 warnings, 717 files.**
- **Full suite: 30 files failed, 15 passed, 293 tests passed, 0 test failures.**
  Every failing file fails at setup on GoTrue or PostgREST being absent. Last
  bundle was 29 and 15 with 289 passing; the extra failing file is the new one's
  database half, and the extra four passes are its pure half.
- The repo-wide em dash and en dash check is clean.

### Not verified

- **No iOS device was involved and none could be.** The seven-day
  script-writable-storage sweep is the documented mechanism this decision rests
  on; it is cited as the reason for choosing a server-set cookie, not as
  something measured here. What WAS measured is that the cookie this server sets
  is `httpOnly` and invisible to `document.cookie`, which is what puts it in the
  other category.
- **GoTrue and PostgREST were not in the loop.** No container registry is
  reachable from this session: ghcr.io, Docker Hub, public.ecr.aws, quay.io,
  mirror.gcr.io and registry.k8s.io all answer 403 through the agent proxy. The
  browser walk ran against a local stand-in for those two services, written for
  this verification and not committed. Its password check is
  `encrypted_password = extensions.crypt(pin, encrypted_password)` against the
  real bcrypt hash the real `student_claim_seat` wrote, which is the comparison
  GoTrue makes; everything else it answers is this repo's own SQL under
  `set local role` with `request.jwt.claims`, which is how PostgREST runs one.
  It is an incomplete PostgREST: running the whole suite against it turns 30
  setup failures into 130 assertion failures, all of them its gaps.
- **Realtime is not in the stand-in**, so the student runtime's socket 404s in
  the walk. Unrelated to this change.

### The threat model, and where it must not go

A visible roster plus a PIN is weak auth and is ACCEPTED here: the protected
asset is a middle school team's robot notes, and the teammates already know each
other's names. The PIN is still bcrypt in `auth.users` from the moment it is set
and can never be read back.

**It has NOT leaked to mentors, and it must not.** Mentors are Google-only on a
boscotech.edu domain (`hd` plus 0002's trigger on `auth.users`), hold no PIN
anywhere in this schema, and appear on no roster. The device memory is written
only for a student principal. Board devices hold a 6-digit PIN, but a board is a
DEVICE and not a person: it is on no roster, cannot be a named author, and is
minted by a mentor-only RPC.

### Deferred

- Sign-out is still at the bottom of the Team tab. Now that handing the iPad
  over lands the next child on the roster, the hand-off deserves to be a
  first-class control with a name like "Someone else's turn" rather than a
  button a child has to go looking for.

---

## 2026-08-27 -- The IDEA token and chrome layer, and the alias rule made a test

Students said the app looked archaic. It had no design system: every surface was
whatever the last session matched. This bundle installs a token and chrome layer
app-wide. It redesigns no page's structure.

### What was inherited, and what was not

Architecture came from `FRC_Design_System.md` v1.7 in the sibling `frc-app`
(`src/lib/design-system/docs/`), read at 644b809 rather than remembered. Ported:
a token layer as the single source of colour, ground scopes set by an attribute
on a root, and a four-transition motion library. NOT ported: any of Team 5669's
appearance. No Techmen gold, no 5669 seal, no Space Grotesk. The identity here
is the IDEA pathway.

### What landed

- **`colors.css` rewritten as a palette plus TWO GROUND SCOPES**, each declaring
  the complete semantic alias set (63 names) as LITERAL values. `:root` shares
  the dark block so a document with no ground attribute resolves the whole set
  rather than resolving partially, which is the dangerous state: the palette
  alone still paints green and looks almost right.
- **IDEA green is scarce on purpose.** In the whole console chrome it marks the
  season wordmark and the tab you are on. Content accents are brass, patina and
  copper; crimson is LIVE, REC and error only and never identity; the FIRST
  LEGO League values are the PROGRAM LAYER and colour program chrome only.
- **Chakra Petch (`--font-hero`, display only) and Rajdhani (`--font-body`,
  headings included)**, self-hosted via @fontsource rather than preconnected,
  for the same offline reason the rest of the app is local-first. There is
  deliberately no `--font-display` that reaches the hero face.
- **The four transitions** (`.ds-shutter`, `.ds-boot`, `.ds-banner`, `.ds-cut`)
  plus three entrances, every one gated behind `prefers-reduced-motion:
  no-preference` inside the library and inert outside a `.ds-run` container, so
  base styles remain the visible end state.
- **Chrome adopts the identity:** the header bar and nav sit on `--chrome-bg`,
  the active tab is the pathway green, the footer bookends it, and the sign-in
  screen leads with the BIOGLOW wordmark in the hero face, in `--season`, with
  the one rationed glow in the app.
- **The paper ground is ready and already earning its keep.** Printing a run
  sheet is coming; meanwhile the route planner's mat and its calibrator carry
  `[data-ground='light']`, and that is now the paper scope.

### The alias rule, and the bug that had already shipped here

Custom-property substitution resolves where a property is DECLARED. An alias
written once on `:root` computes there and inherits the already-resolved string
into every other scope, so a ground that forgets one keeps the dark value while
looking correctly themed. No error, no warning, no visual clue.

**FOUR INSTANCES WERE ALREADY IN THIS REPO.** `effects.css` declared
`--shadow-card`, `--shadow-raised`, `--backdrop-deep` and `--focus-outline` on
`:root`, each composed out of a ground-dependent `var()`. All four froze the
light ground's values into the dark one, and the planner's forced-light mat
plate was drawing a black shadow on a white sheet as a result. They are ground
aliases now, and they are literals. `effects.css` declares no colour at all.

`tests/design-tokens.test.ts` is the guard, and it reads the SHIPPED stylesheet
rather than a copy of it: the scopes must name the same aliases, no value may
contain `var(`, the paper scope must flatten every glow and may not carry mint,
and NOTHING outside the token folder may name a colour or a font family.

### Measured

- **`tests/design-tokens.test.ts`: 13 passed, including two controls.** Deleting
  one alias from the paper scope makes the comparison report exactly that alias;
  turning one literal into a `var()` makes the literals check see it. Without
  those, "every scope declares every alias" is a sentence that passes whether or
  not the check works.
- **The alias check found its first real bug immediately, in the test itself.**
  The paper scope was anchored on a PREFIX of its selector list, which also
  matches the palette block at the top of the file: it compared that block
  against itself and passed while 63 aliases were missing. Anchored on the full
  selector list, it went red, which is what a check that cannot fail looks like
  when you fix it.
- **32 screens walked, every rendered text node, ZERO pairings under the floor.**
  Every top-level route, both roles, at 375 and 1440: the effective foreground
  and background were resolved through the ancestor stack and compared at 4.5,
  or 3 at large-bold sizes.
- **32 route/width combinations rendered 200**, `--ground: dark`, page
  `rgb(19, 26, 19)`, body face Rajdhani, **0px horizontal overflow on every
  one**. The only console error anywhere was a `/favicon.ico` 404, pre-existing.
- **The forced-light plate resolves correctly inside a dark root**, checked in a
  live browser: `[data-ground='light']` computes `--ground: paper`, background
  `rgb(234, 230, 216)`, ink `rgb(19, 26, 19)`. That is the alias bug's original
  shape, proven fixed rather than argued fixed.
- **The eleven team accents re-measured on both new grounds.** All eleven dark
  variants clear 4.5 on the new ramp and improve (7.80 to 7.97 on the page,
  where the old ramp gave 7.18 to 7.33). Five light variants failed on the bone
  sheet (orange 4.45, lime 4.51, sage 4.42, purple 4.47, magenta 4.57) and were
  darkened with their hue held to within 0.3 degrees. The paper washes were
  re-tinted from the sheet at 5 percent so a label on its own wash still clears
  4.5.
- **Colour literals outside the token layer: 15, in 4 files, all four on the
  allowed list with a reason.** `qr.ts` (2: a themed QR code is an unscannable
  QR code), `brand/rules.ts` (1: the white plate FIRST full-colour artwork is
  specified for, which a ground must NOT be able to retint), and two dev
  fixtures drawn by this repo (`route-planner` 11, `notebook` 1) that stand in
  for copyrighted artwork and have to stay light drawings. Inside the token
  layer: 183 in `colors.css`, 66 in `team-accents.css`, zero in the other five.
- **One font literal was found and removed.** `NotebookPrint.svelte` named
  `Georgia, 'Times New Roman', serif` directly; it is `--font-paper` now.
- `npx svelte-check`: **0 errors, 0 warnings, 718 files.**
- **Full suite: 30 files failed, 16 passed, 323 tests passed, 0 test failures.**
  Every failing file fails at setup on GoTrue or PostgREST being absent. Last
  bundle was 30 and 15 with 293 passing; the extra passing file is the new
  token test and the extra 30 passes are its cases plus the retuned ones.

### Two judgements, stated rather than buried

- **`--dim #87947C` ships exactly as specified, and it does not clear 4.5
  everywhere.** It measures 5.53 / 4.99 / 4.35 / 3.60 against the four ramp
  steps. It is the metadata token for the page and a card; a raised `--plate`
  takes `--fg`. The app's running labels take `--text-3`, which is the same hue
  lifted to 5.75 / 5.18 / 4.52 so the three-step ink ladder keeps this repo's
  standing rule that every step clears 4.5 on all three surfaces.
- **The paper ground's accent separability floor is 18.8, not 0018's 21.3.** The
  bone sheet carries about four fifths of white's luminance, so five accents had
  to darken to clear 4.5, and darkening a set compresses it in Lab: olive/lime
  went from 22.80 to 18.88. A search over hue-holding candidates found NO lime
  that clears the sheet and stays 21.3 from the other ten. Moving olive or lime
  apart would change a colour a team chose by name, on a ground they will rarely
  see, to protect a floor derived on a third ground. The number is recorded and
  asserted instead. The dark ground, which is the one the app runs on, keeps
  21.3 and measures 21.87.

### Changed outside the token layer, and why

- **`resolveGround('system')` now answers `dark`.** The identity IS the dark
  ground, and a light-mode device following its own setting would open the app
  on the print sheet. `light` remains an explicit choice, resolves to paper, and
  is therefore a preview of the printout. The toggle's labels changed with it:
  "Match my device" was a sentence a nine-year-old could test and find untrue.
- **`CLAUDE.md`'s "Visual theme" and "FIRST branding" sections** were rewritten
  in place. They said the palette and the face were the official FIRST ones and
  the ground was white; both are now false. The FIRST rules that still govern
  (the marks, the name in text, team identification, no busy backgrounds) are
  untouched, and the FIRST palette survives as the program layer.

### Found, reported, NOT fixed

- **`FirstName.svelte` renders "LeagueChallenge" with no space**, and
  "FIRSTLEGO" in `textContent`. Confirmed PRE-EXISTING: that file has no diff in
  this bundle, and the defect is in Svelte's whitespace handling at the `{#if}`
  boundaries, not in any colour or face. It is visible in the console header on
  every mentor screen. It is a FIRST naming-rule violation and it is copy, which
  this bundle was told not to change, so it is written down here for the pass
  that owns it.
- **Nothing looked wrong purely from retinting.** No page needed a layout change
  and none was made.

### Not verified

- **GoTrue and PostgREST were not in the loop.** No container registry is
  reachable from this session. The browser sweep ran against the same local
  stand-in the previous bundle used and disclosed. What it establishes is a
  RENDERING claim: computed styles, resolved grounds, measured contrast and
  overflow, which do not depend on which server answered the data call.
- **No printed sheet was produced.** The `@media print` scope is asserted for
  alias completeness and read in the stylesheet; it has not been through a
  print dialog.
- **The four transitions have no call site yet.** They are the library, gated
  and inert; nothing in this bundle applies one, because applying one would be
  a structural change to a page.

## 2026-08-27 -- The generator asks a nine-year-old questions a nine-year-old can answer

The code generator worked and nobody wanted to use it. Reported from use: it
looked archaic and was not fun, and the users are nine to fourteen. The copy was
good and mostly survives. The problem was the shape: twelve form controls in a
column, one of them asking a fourth grader for a gear ratio. This bundle
rebuilds `/app/me/codegen` and `/app/codegen/[teamId]`. Same
`CodegenPage.svelte`, same one render path, same transport, same emitter. The
emitter, the validator and the registry were not touched.

### The two structural findings, dealt with before any styling

**SIX FIELDS WERE ONE QUESTION.** `left_motor`, `right_motor`, `movement_pair`,
`left_color_port`, `right_color_port` and `attachment_motors` all answer "what
is plugged into which port", and the form asked it six times: two dropdowns, a
text box wanting "AB", two more dropdowns and a row of six checkboxes. A child
holding a driving base does not hold six answers, they hold one picture. So
`src/lib/codegen/ports.ts` is that picture as data (a `PortRole` per port) and
`HubPorts.svelte` draws it: a top-down hub with A, B, C down the left edge, D, E
and F down the right, and the 5x5 light matrix between, which is the real
layout, because the picture's whole job is being matched against the brick in
front of them. Tap a port, pick one of five things.

**`movement_pair` IS NOW DERIVED AND IS NO LONGER A FIELD.** It was a second
source of truth that could silently disagree with the two drive ports: set the
left motor to C, the right to D, leave "AB" in the box, and the emitter baked a
movement pair naming two ports with no drive motors in them. Nothing checked it
and nothing could. `configPortsFromMap()` is now the ONLY producer of one and it
is `leftMotor + rightMotor`. The column is stored exactly as before. A row that
already disagrees with itself is repaired when it is opened, not when a port
happens to be touched -- that gap was found by the test, not by reading the
code, and is why the repair runs on arrival.

**`yaw_axis` WAS COLLECTED, STORED AND IGNORED, SO IT IS NO LONGER ASKED FOR.**
T17 left the emitter when V9 refused `flippermoresensors_setOrientation` as an
unverified shape, and nothing has read the column since. The column stays, the
`up` default stays, `cfg.yawAxis` still travels to the transport untouched, so a
row saying 'front' keeps saying 'front'. What is gone is the question.
`CodegenPage.svelte` carries the note saying the control returns when the shape
is verified, and `tests/codegen-ports.test.ts` goes red if a control comes back
before then.

### What landed

- **`src/lib/codegen/ports.ts`** -- the port map, its rules and the one
  producer. Drive roles SWAP rather than duplicate (there is one left driving
  wheel, so putting it in C has to say something about the port that held it),
  which is what keeps the map complete at every step. Colour REFUSES rather than
  swapping: two ports are already the answer and there is no non-arbitrary way
  to pick which a third displaces, so the screen says "Two colour sensors
  already, in E and F. Set one to Nothing first." Predictable beats clever.
  Which colour sensor is "left" is decided by port letter, and that rule is
  printed under the hub rather than left to be discovered.
- **`HubPorts.svelte`, `WheelPicture.svelte`, `TrackPicture.svelte`** -- three
  drawings, all made of tokens and shapes by this repo. No LEGO artwork is
  fetched, mirrored or reproduced. The three wheels are drawn at TRUE RELATIVE
  SIZE (radius scaled from the millimetres), because the ratio is the thing
  being matched against the part in a hand. `TrackPicture` exists because the
  three wrong answers to "track width" are all reasonable -- outside to outside,
  inside to inside, the width of the chassis -- so the arrow starts and ends on
  a marked wheel centre line and the caption says so.
- **Four steps, not one wall.** Our robot / Our wheels / What our sensors see /
  Make it. Back and forward, progress on screen throughout. Forward is blocked
  by that step's own blockers, stated as sentences ("Say which port the LEFT
  driving wheel is in", "White has to read a bigger number than black"), so an
  incomplete answer cannot be walked past. Tapping a numbered chip goes BACK
  only.
- **Wheels are recognised, not measured.** Three pictures at 56, 43.2 and 88 mm
  with "Ours is something else" as a disclosure behind them, which opens itself
  for a stored wheel that is not one of the three. The unit toggle and the
  rounding-safe commit from the previous bundle are untouched.
- **Gears default to 1:1 and hide behind "Our robot has gears."** Most driving
  bases are direct drive and "motor turns per wheel turn" is a phrase no
  nine-year-old should meet unless it applies to them. The disclosure opens
  itself for a stored ratio that is not 1.
- **The arithmetic panel stays and now visibly moves.** It was the best thing on
  the page. Changing the wheel from 56 mm to 43.2 mm moves 300 mm from 614 to
  796 motor degrees on screen, which is the error the emitter would otherwise
  bake into every drive in every run with nothing on the robot to say so.
- **Generate is an event.** Two cards arrive, named, each saying what it is for
  ("The one you drive with. Open this in the SPIKE App." / "Run this on the hub
  once to check the toolkit works."), with the block count, the stacks, the
  extensions and the variables the file contains.
- **`FirstName.svelte`** -- the naming violation the previous bundle found and
  reported. Every space between two names is now an explicit `{' '}`.

### The FIRST naming fix, and why the source looked right

Svelte trims whitespace at the START of an `{#if}` block's content. The markup
had a newline and two tabs between LEGO and League; the compiler dropped them,
and the page said "FIRSTLEGO League" and "LeagueChallenge" on every mentor
screen for the whole of the bundle that shipped it. Reading the file proved
nothing. `{' '}` is an expression and is emitted verbatim, so the spacing no
longer depends on how the file is indented.

The guard is new and it is a RENDERING assertion, because nothing else could
have caught this. `tests/brand-rules.test.ts` now renders the real component
through `svelte/server` and reads the text out of the output. That needed the
Svelte plugin in `vitest.config.ts`, which is there for this one reason and is
commented as such; it does not turn `tests/` into a component suite.

### Measured

- **Browser, both roles, 375 and 1440, all four steps, walked start to finish
  and generated.** Identical behaviour in all four combinations.
  - Step 1: hub renders `A=LEFT DRIVE B=RIGHT DRIVE C=MOTOR D=MOTOR E=COLOUR
    F=COLOUR`, derived line "Left colour sensor: E - right colour sensor: F".
    All six old controls absent: movement-pair box 0, yaw select 0, port selects
    0. Port tap target 91x88 (375) / 96x69 (1440). Tapping C offers the five
    roles; Colour is disabled and says why; setting C to left drive swaps A to
    MOTOR, as designed.
  - Step 2: three wheel cards, tap targets 145x221 (375) / 210x198 (1440).
    43.2 mm moves the sum 614 -> 796; back to 56 mm returns 614. Track picture
    drawn with its caption. Gear ratio box on screen: 0.
  - Step 3: white 5 against black 12 raises the blocker and disables Next;
    restoring 95 re-enables it.
  - Step 4: two file cards, 374 blocks / 9 stacks / 6 extensions / 10 variables
    and 466 / 10 / 7 / 12, verdict "Checked: nothing wrong. 2 files ready."
  - 0px horizontal overflow on every step at both widths. No console or page
    errors.
- **The emitter output did not move.** A config built the old way and the same
  config seeded THROUGH the port map produce structurally IDENTICAL projects:
  374 blocks / 9 stacks / 10 variables / 6 extensions and 466 / 10 / 12 / 7, 0
  findings, bytes present, the 16 unpinned manifest fields unchanged. Structure,
  not bytes: `pack()` uses `Math.random()` and `new Date()`.
- **`tests/codegen-ports.test.ts`, 14 cases.** The property is asserted over
  every map reachable in two moves from the default: 187 distinct maps, 75 of
  them complete, and every complete one has `movementPair === leftMotor +
  rightMotor` and satisfies 0024's two CHECK constraints. The 112 incomplete
  ones all produce `null` rather than a half-built config. The structural half
  greps `src/` and fails if any file outside a named list of four assigns
  `movementPair` at all; the four are listed with a written reason each, so a
  fifth has to be argued for.
- **`tests/brand-rules.test.ts`, 32 cases**, including the five rendered names.
  The guard was proved to bite: putting the trimmed whitespace back reddens two
  cases; the file was restored and re-measured byte-identically (md5
  d1ed6aa0da7336ad52f8d06a3d0d68f8) and the file went green again.
- **`npx svelte-check`: 0 errors, 0 warnings** (723 files).
- **The full suite, twice, on a database rebuilt from the chain each time: once
  at HEAD and once with this bundle.** The stand-in is not GoTrue and not
  PostgREST, so a large part of the suite cannot pass here at all; the only
  honest reading is the DIFFERENCE, and it is exactly the new tests.
  HEAD: 28 files failed / 18 passed, 130 tests failed / 433 passed / 92 skipped.
  With this bundle: 28 files failed / 18+1 passed, 130 tests failed / 450
  passed / 92 skipped. Same 130 failures, both times, and +17 passing, which is
  the 14 port cases plus the 3 rendered-name cases. Nothing that passed before
  stopped passing.
- **Contrast, every text node on every step, both grounds, both widths, both
  roles** -- 32 step-screens, which is what the repo-wide sweep does not do (it
  measures step 1 of the dark ground only). 24 of the 32 came back clean and the
  8 that did not are the mentor light-ground screens, carrying only the two
  chrome defects below. One defect was introduced and fixed:
  the current step chip was `--accent-text` on `--accent-soft` and measured 4.31
  on the paper ground, because a wash darkens the surface under ink derived to
  clear 4.5 against the bare surface. It is now `--accent-ink` on `--accent`,
  the fill-plus-declared-ink pairing the palette already measures on both
  grounds and the same one the Next button and a chosen port use.

### Found, reported, NOT fixed

Both are in the mentor console CHROME, not on this page. They appear on every
mentor screen and on none of the student ones: the same two, with the same
numbers, on all five of `/app/board`, `/app/teams`, `/app/tasks`,
`/app/library` and `/app/notebook`, which this bundle does not touch. Both
predate it.
They are written down here rather than fixed because correcting either means
changing the token layer or the shell, which is a different surface and owes its
own measurement on both grounds.

- **`.shell__season-name` is `--season` (mint, `#8fe08a`) and on the paper
  ground it lands on bone: 1.14 against `rgb(223, 218, 202)`, at 18px/700, plus
  its `™` at 10px/700.** `--season` is declared once in the identity block that
  all four ground selectors share, so unlike every alias it does not re-declare
  per ground. The fix is to give it a paper value in the paper block, derived
  and measured the way the rest of that palette was.
- **`.shell__tab--on` is `--accent-text` on `--accent-soft`: 3.88 on paper.**
  The same wash arithmetic as the step chip above, in the console nav. The
  cheapest correct fix is the one used here.

### Not verified

- **GoTrue and PostgREST were not in the loop.** No container registry is
  reachable from this session, so the browser work ran against the same local
  stand-in the previous two bundles used and disclosed. What it establishes is a
  RENDERING and ARITHMETIC claim: computed styles, resolved grounds, measured
  contrast, overflow, the port map's behaviour under taps, and the generated
  projects' structure. None of those depend on which server answered the data
  call.
- **No `.llsp3` was opened in the SPIKE app.** The claim made here is that the
  output did not MOVE, measured against the same emitter's output before the
  change, not that it opens; that was established when the emitter shipped.
- **The saved row was not re-read through a real PostgREST.** The derivation is
  asserted in arithmetic over every reachable map and the repair is asserted on
  a hand-built contradictory row.

### Deferred

- **The two chrome contrast defects above.**
- **`flippermoresensors_setOrientation` is still unverified**, so the yaw
  control stays off the screen. Verifying the shape and restoring the control
  are one job, in that order.

## 2026-08-27 -- --season was never an alias, so the alias test could not see it

Two contrast failures in the mentor console chrome, found by the previous
bundle's sweep and deferred as a different surface. Both on the paper ground,
both on every mentor screen:

    .shell__season-name   --season (mint) on bone      1.14
    .shell__tab--on       --accent-text on --accent-soft  3.88

The first is the interesting one. It is the alias bug again, in a shape the
alias test was structurally unable to see, and it landed ONE DAY after that
test shipped, while the test was passing.

### The cause

`--season` was declared in the PALETTE BLOCK at the top of `colors.css`, whose
selector list is `:root, [data-ground='dark'], [data-ground='paper'],
[data-ground='light']`. One declaration, four ground selectors: both grounds got
IDEA mint, which is 1.27 on the bone sheet and 1.14 behind the header bar it is
actually set on. `--season` is not decoration; the console header and the login
hero both paint the season wordmark with it.

The old check took the DARK SCOPE'S declaration list as the definition of "the
alias set" and asked whether paper and print matched it. Anything the dark scope
did not declare was therefore not in the set and could not be missing from
anything. `--season` was not an alias, so it was not checked, so it was not
found. The test was correct about what it measured and the thing it measured was
the wrong set.

**FIFTH OCCURRENCE, FIFTH DIFFERENT HAT.** A `var()` inside an alias; a hex
inside a component's backplate; four composed shadows on `:root`; a ground-blind
team-accent plate; and now a colour that is simply not an alias. The shapes keep
changing, so the check stopped looking for a shape.

### The widened check

`tests/design-tokens.test.ts` now enumerates. It reads every stylesheet in
`src/lib/design-system/` -- the DIRECTORY, so a new one is covered the day it
lands, not the day somebody remembers to name it -- finds every custom property
whose value is a colour, and asks one question of each: is it declared at TWO
DISTINCT SITES, one the dark ground reaches and the paper ground does not, and
one the other way round?

**TWO SITES IS THE WHOLE TEST, and that is the part worth keeping.** A single
declaration cannot hold two values however many ground selectors it names, which
is exactly how the palette block managed to look correct. Two sites with the
SAME value is fine and is not the bug: `--rule-gray` is deliberately identical on
both grounds, and because it is written twice, changing one is visible.

Colour detection includes the bare rgb-triple idiom (`--shadow-color: 0, 0, 0`),
which is a colour with the function pulled off and would have been the next thing
through. A property is judged over its whole set of declarations rather than one
at a time, because the paper ground writes `--glow: none`, which is not a colour
but IS the paper answer for a property whose dark answer is one; judging it alone
called a present site a missing one.

Measured: **77 colour-valued custom properties**, of which 20 have a single
ground-blind site. Nineteen are exempt and one was the bug.

### The allow list, in full, and why neither half is taken on trust

**RAW PALETTE (13).** `--idea-mint`, `--idea-bone`, `--idea-dim`, `--idea-gear`,
`--idea-brass`, `--idea-patina`, `--idea-copper`, `--idea-crimson`,
`--program-fll`, `--program-fll-explore`, `--program-fll-discover`,
`--program-fll-ink`, `--program-rule`. The IDEA ones are the raw named colours an
alias's literal came from, and `colors.css` has always claimed "no rule below
points at these by name". The FIRST LEGO League ones are published values used
UNMODIFIED: darkening a brand colour for a ground and still calling it the brand
colour is the thing the guidelines forbid, so they are ground-independent by
mandate, and the alias that actually lands on a ground is `--rule-gray`, declared
in both scopes.

That exemption is safe ONLY because nothing uses them, so **the claim is
asserted rather than assumed**: a case greps every tracked source file and fails
if any rule references one. Measured today: zero references, all thirteen. The
moment a component writes `var(--idea-mint)`, the test goes red instead of the
colour going out on a paper ground.

**GROUND-PAIRED (6).** `--accent-on-dark`, `--accent-on-light`,
`--accent-ink-on-dark`, `--accent-ink-on-light`, `--accent-wash-on-dark`,
`--accent-wash-on-light`. A team accent carries its ground in its own NAME, so
the pair is the scope; team-accents.css argues that at length and the reason is
the forced-light mat plate. That exemption is safe only while the pairs are
complete, because one half alone falls through the var() chain to `--text-2` and
a team silently loses its colour on one ground. So a case walks team-accents.css
and requires every `-on-light` to have its `-on-dark` in the SAME rule. Measured:
66 paired properties, 0 broken.

Two further cases keep the list itself honest: an entry whose property no longer
exists fails, and an entry that IS now declared per ground fails, so an exemption
cannot outlive its reason.

### The control, run before the fix

Required by the task and it is the point: a widened check that goes green on the
bug it was written for has not been shown to work, which is exactly how the alias
test passed while missing 63 aliases. Run against the UNFIXED stylesheet, the
enumeration reported one orphan and only one:

    FAIL  every colour in the token layer is declared once per ground >
          each one has a dark site and a paper site, and they are different sites
    + [
    +   "--season is declared at 2 screen site(s): {:root, [data-ground='dark'],
    +    [data-ground='paper'], [data-ground='light']} = #8fe08a |
    +    {[data-season='bioglow']} = #93d6c8",
    + ]
    Tests  1 failed | 17 passed (18)

The 17 passing beside it matter too: widening the check did not redden anything
that was already right.

The control SHIPS, over a mutated copy of the real stylesheet: every `--season`
declaration is removed and exactly one is put back in the shared palette block,
which is the state it shipped in. It asserts the enumeration flags that, AND that
the shipped sheet passes, so the case cannot go green by the enumeration simply
answering false to everything.

### The fix

`--season` is a ground alias now: `#8fe08a` dark, `#226e1d` paper, `#226e1d`
print. The paper value is the literal `--accent` already takes there, so no new
colour enters the system. Measured 11.90 / 4.53 on `--chrome-bg`, which is the
header bar the wordmark actually sits on and is NOT one of the three surfaces --
that is why it is now in `theme-contrast.test.ts` with `--chrome-bg` named
explicitly in its surface list.

**THE BIOGLOW RESKIN HAD THE SAME DEFECT WAITING.** `[data-season='bioglow']` was
one rule naming no ground, so the first time anyone set that attribute the dark
cyan would have gone onto the printed page at 1.98. It is two rules now, dark
`#93d6c8` and paper `#286a5d`, which are this file's own `--patina` on each
ground. The attribute is currently set by nothing, so the reskin is dead code
today; it is dead code that is now correct.

**KNOWN LIMIT, WRITTEN DOWN RATHER THAN HIDDEN:** a forced paper plate inside a
dark document inherits the dark season, because `data-season` sits on the root
and the compound selector cannot match the plate. Team accents solve that with
ground-named pairs and a season would need the same if the wordmark ever went
inside a plate. It does not: both consumers are at document level. The comment in
`colors.css` says so.

### The tab

`.shell__tab--on` is a filled pill: `--accent-ink` on `--accent`, 11.14 dark and
5.07 paper. Same resolution as the code generator's current step chip, same
reason, and no reason was found for the nav to differ. Looked at on both grounds
before keeping it: a mint pill in the dark chrome bar and a deep-green one on
paper, which is the treatment the primary button already uses, so "the one you
are on" now says the same thing everywhere in the app.

Worth stating why the wash failed at all, since `--accent-text` is derived to
clear 4.5: the nav's ground is `--chrome-bg`, not one of the three surfaces, and
a 12% wash over it lands on `#c8cdb5`, darker than anything `--accent-text` was
measured against.

### Measured

- **Every mentor route, both grounds, both widths: 44 screens, 0 pairings under
  the floor, 0px horizontal overflow on all 44.** Routes discovered from the
  nav itself rather than typed: `/app`, the eight nav destinations, and the two
  drill-ins. Before this bundle the same sweep found three pairings on each of
  the light-ground screens.
- **No student surface moved, and the harness is shown to be capable of seeing
  it if one had.** A full-page screenshot hash CANNOT answer this: two
  back-to-back runs of identical code differ, because these screens carry a
  clock and a live dot. So what was measured is what this bundle changes:
  for every element, in DOM order, the computed `color`,
  `background-color`, the four border colours, `outline-color`, `fill`,
  `stroke`, `box-shadow`, `text-shadow`, `caret-color` and `column-rule-color`.
  That collector is deterministic (proved: two runs, identical). Sixteen
  student screens (seven `/app/me*` routes plus `/board`, both grounds) hash
  IDENTICALLY at HEAD and with the bundle. The control: the same collector on
  `/app/board` and `/app/teams` differs on all four, at the same element
  counts, so the difference is colour and the harness sees it.
- **`npx svelte-check`: 0 errors, 0 warnings, 723 files.**
- **Full suite on a database rebuilt from the chain: 28 files failed / 19
  passed, 130 tests failed / 458 passed / 92 skipped.** The stand-in is not
  GoTrue and not PostgREST, so most of the suite cannot pass here and only the
  DIFFERENCE is honest: HEAD was 130 failed / 450 passed. Same 130 failures,
  +8 passing. The two touched files alone go 106 to 114, which accounts for the
  +8 exactly: nothing that passed before stopped passing.

### Not verified

- **GoTrue and PostgREST were not in the loop**, for the third bundle running:
  no container registry is reachable from this session. Every claim here is a
  RENDERING claim -- computed styles, resolved grounds, measured contrast,
  overflow -- and none of them depends on which server answered the data call.
- **No printed sheet was produced.** `--season` is asserted in the print scope
  for completeness and measured on the paper ground it copies; it has not been
  through a print dialog.
- **The BIOGLOW reskin was not exercised**, because nothing sets
  `data-season`. Its two rules are measured as colours and asserted by the
  enumeration; the selectors themselves have not been matched by a real
  document.

### Found, not fixed

- **`src/lib/design-system/index.css`'s header is stale.** It says the token
  entry point is "built on the official FIRST and FIRST LEGO League palettes and
  the Roboto family". Both were true before the IDEA bundle and neither is now:
  the identity is the IDEA pathway and the faces are Chakra Petch and Rajdhani.
  It is a comment, it changes no behaviour, and it is not what this bundle was
  asked to touch.

## 2026-08-27 -- Green stops being the ground and becomes four jobs with four owners

Reported from use: the app is far too greenwashed. It was, and the cause was
the palette specification rather than any implementation of it. Every rule in
the app was written correctly against a semantic token, and the tokens all
pointed at the same colour.

### The diagnosis, measured before anything changed

At HEAD, mint answered to ELEVEN token names -- `--accent`, `--accent-text`,
`--fg-hero`, `--rim`, `--link`, `--focus-ring`, `--success`, `--success-text`,
`--season`, `--selection-bg`, `--glow` -- and every one of them resolved to
`#8FE08A` on the dark grounds and `#226E1D` on paper. 147 references across 30
files, and not one of them looked wrong at its own call site.

Underneath all of it, the page ramp itself was green: `#131A13 / #1B241B /
#242F23 / #2E3D2E`, all with G above R above B. A ground is under every pixel
and no rule has to ask for it, so the cast was there before a single
declaration ran. `--gear` / `--boundary` / `--fg-structure` were `#75846F`, a
green-grey on every card border in the app.

"Green is the IDEA identity and it is SCARCE ON PURPOSE" has been in CLAUDE.md
since the token layer shipped. It was written down four bundles running and
ignored four bundles running, because a sentence cannot be violated by any one
line. It is a LIST now.

### TASK 1 -- the ground

The default ramp is neutral: `#111111 / #181818 / #222222 / #2C2C2C / #393939`,
with `#323232` hairline and `#808080` structure.

**EVERY STEP MATCHES THE GREEN STEP'S LUMINANCE, AND THAT IS WHY NOTHING HAD TO
BE RE-DERIVED.** Contrast depends only on relative luminance, so a neutral grey
of the same Y preserves every ratio ever measured against these surfaces. The
8-bit grid moves each recorded figure by at most 0.05 and no pairing crosses its
floor: `--text-3` on `--surface-2` went 4.52 to 4.53, `--boundary` 3.51 to 3.52,
`--fg-dim` 4.35 to 4.36. Every figure in `colors.css` was re-measured against
the new ramp and rewritten rather than carried over, because a comment that
records a ratio is a claim.

The green ramp is not deleted. It is `[data-ground='deck']`, a COMPLETE scope
(a ground that re-declared only its six surfaces would inherit every other alias
from wherever it was nested, which is the alias bug wearing a sixth hat), and
**nothing sets it yet**, which is stated in the file rather than implied.

`tests/design-tokens.test.ts` was taught the third ground: `reaches()` now
classifies a selector against three ground regexes instead of two, and
`declaredPerGround` requires a system of DISTINCT sites, one per ground, rather
than a distinct pair. Proved to bite by deleting `--rim` from the deck scope
(two cases red, the file restored byte-identically, md5 checked).

**THE STRUCTURE COLOURS WENT NEUTRAL TOO, and that is TASK 2's rule, not this
one's**: linework is not identity, not an active state and not a status.
`--boundary` on paper is one 8-bit step darker than its luminance match, because
the exact neutral `#7C7C7C` measures 2.99 on `--surface-2` and would have been
the first boundary in this palette under its 3:1 floor; `#7B7B7B` is 3.03.

### TASK 2 -- one job per colour

**147 references to 64.** The job list, before and after, is in the bundle's
report; the shape of it is:

- **Identity, kept**: `--season` on the console wordmark and the login hero,
  `--fg-hero` + `--glow` on hero type. Five references.
- **ONE active state**: the console nav pill, `.shell__tab--on`. It is the only
  "you are here" that is on screen on every mentor route, so it is the one that
  earns the colour. Everything else that said "selected" in green now takes
  `.btn--picked`'s treatment -- a lighter fill, a full-strength ink ring, bold
  -- or the team's own accent: the teams and tasks filter segments, the media
  library chip, the notebook tab, the planner's unit and zoom toggles, the
  calibrator's zoom, and the code generator's step chip, wheel card, hub port
  and role button.
- **The primary action**: `.btn--primary` and its student and kiosk dress
  (`.slab--go`, `.open__btn`). One job, three sizes.
- **The focus ring**: unchanged.
- **Status**: `--success*` stays green and stays a status token, on done, live,
  connected, ok and outcome-worked, which is 20 of the remaining 64.

### The pattern, which is the finding

Every instance had the same shape: **a semantic token already existed and the
green got used because it was the green that was handy.** Four kinds:

1. **A status token doing typography.** `--success-text` was the colour of the
   library header title, the board's open-screen title, four clock readouts, a
   mission's points number, a course badge, the calibrator's ruler and the mat's
   launch-area label. None is a success. `--text-1` and `--text-2` existed the
   whole time.
2. **The action colour marking state.** "Live (6) / Archived (0)" and the task
   status filters were `.btn--primary` toggled onto whichever was showing. A
   filter that is already applied is not something to press, and there was no
   picked treatment to reach for, so there is one now.
3. **A status wearing the link colour.** A notebook entry whose outcome is
   "mixed" and a queue that is "syncing" were `--link`. Mixed is between worked
   and failed and syncing is in progress: `--warning` is exactly that meaning
   and had 72 references elsewhere already.
4. **Content accents sitting unused while content took the identity colour.**
   The strategy prompt on a mission page and a library item was outlined in
   `--accent` while `--brass`, which CLAUDE.md names as the callout accent, had
   ZERO references in the whole app. `--copper` and `--patina` likewise.

`--link` itself is the ink now, on every ground, which moved 35 references off
green in one line per scope. Twelve of those were never links: route lines,
waypoint dots, step numbers, a timeline segment, a chart dot. They were renamed
to `--text-1`, which is a rename and not a change -- the two tokens are the same
literal on every ground -- so `--link` means links again.

**One thing this found that nothing else would have:** the mat calibrator drew
its two corner pins in `--success` and `--accent`, which are the same colour on
every ground. The one screen whose whole job is "tap this corner, now tap the
other one" was drawing two identical markers. They are ink and copper now.

`--link` also left `theme-contrast.test.ts`'s brand-substitute list, with the
reason written into the case: that list exists for functional values that stand
in for a brand colour that cannot carry text, and the ink stands in for nothing.
An ink that is a near-black is not brand expression, and the paper ground's has
been within dE 10 of FIRST black since it shipped (`#131A13` measured 8.9) on
`--fg` and `--text-1`, which that case has never covered and should not.

### TASK 3 -- colour from content

**0018 derived, measured and shipped eleven team accents and NOTHING HAD USED
ONE FOR SEVEN BUNDLES**, because `teams.accent` is nullable and every team was
created null. The live board's 6px rail, the team card's wash, the notebook tab
and the planner's mission chips all fell back to `--text-2`: six team cards on
the console rendered as six identical grey cards, and the teams list said "no
colour yet" six times.

`0025_teams_default_accent.sql` hands a starting colour to every LIVE team whose
accent is null. It never overwrites a colour a team chose, never touches an
archived team, refuses to run if the enum stops being eleven values, and leaves
the remainder null with a count if there are more colourless teams than free
colours. `seed.sql` does the same for a fresh stack, because the seed runs AFTER
the chain and would otherwise put a local database straight back into the state
0025 exists to end. A team still chooses; what changed is the state it starts in.

**THE HAND-OUT ORDER IS DERIVED.** Enum order gives the first four teams bark,
orange, olive and lime, two of which are greens and whose closest pair measures
dE 18.9. The order in the file is a farthest-point walk over the eleven, scoring
each pair by its WORSE ground so a colour that separates well on one sheet and
badly on the other cannot win. It gives lime, purple, teal, orange: closest pair
dE 54.8. That is the number that matters, because this club runs four teams.

The teams list gained a 4px accent rail, the accent wash the board cards already
use, and the team name in its own colour (`--team-accent`, not the ink token:
the one derived to clear 4.5 against all three surfaces AND against its own
wash).

**THE PROGRAM LAYER AT MODERATE WEIGHT**: the footer's top edge is the published
FIRST gray rather than the app's decorative hairline, so the band carrying the
two lockups reads as program chrome. That is the "footer rail". **No
program-scoped badge was invented**, and that is a decision rather than an
omission: CLAUDE.md and the FIRST guidelines both put brand colour on chrome and
never on content, and adding a badge to the season-document list means adding
markup, which this bundle was told not to do.

### TASK 4 -- light and dark, both roles

Already built and already correct; what it needed was proving and one fix. The
control lives in `BrandFooter`, which `BrandSurface` mounts at the ROOT layout,
so a student, a mentor, a board and a signed-out visitor all reach the same
three-state radio group. Its own selected option was `--accent-text` -- a second
green active state, in the footer of every surface in the app at once -- and it
is the picked treatment now.

Measured: control present and usable while SIGNED OUT; ground before any choice
is `dark`; a student picks Paper and gets `data-theme=light`, `fll-theme=light`,
body `rgb(234, 230, 216)`; identical after a reload; identical after a real
`POST /auth/signout` that bounces `/app/me` to `/login?next=%2Fapp%2Fme` and
leaves no auth cookie with a value; and a DIFFERENT browser context still opens
dark, because the choice is per device and not per account.

### Measured

- **The mint job list, before and after**: 147 references across 30 files, to 64
  across 20. Green's remaining owners are exactly the four jobs above.
- **Contrast: 108 screens over 26 distinct routes** -- every mentor route
  including five team drill-ins, every student route, `/board`, `/login` and
  `/auth/error`, each on BOTH grounds at 375 and 1440. **0 pairings under the
  floor**, and 0px horizontal overflow on 106 of the 108. Student surfaces had
  never been measured on paper before this bundle; all 32 of those screens are
  clean.
- **The emitter did not move.** The generated project structure is byte-for-byte
  identical between HEAD and this bundle (same block counts, stacks, variables,
  extensions, findings, unpinned manifest fields). Only CSS changed in the
  generator's components.
- **`npx svelte-check`: 0 errors, 0 warnings, 723 files.**
- **Full suite on a database rebuilt from the chain, twice.** HEAD: 130 failed /
  458 passed / 92 skipped. This bundle: 130 failed / 459 passed / 92 skipped, and
  the failing SETS are identical -- `comm` reports no test failing here that
  passes at HEAD, and none the other way. The stand-in is not GoTrue and not
  PostgREST, so most of the suite cannot pass in this session and only the
  difference is honest.
- **Two tests broke on the way and both were right to.**
  `schema-catalog.test.ts` and `team-identity-accent.test.ts` each asserted that
  the seeded teams have no colour, which is the claim 0025 reverses; they assert
  the four starting colours now, and the second also asserts the names are still
  NUMBERS, because handing out colours must not walk back 0018's rename. The
  other was the accent race's POSITIVE CONTROL, which hard-coded teal and lime:
  the seed now holds four of the eleven, so it looks up two free colours instead
  and cannot go stale the next time the seed changes.

### Not verified

- **GoTrue and PostgREST were not in the loop**, for the fourth bundle running:
  no container registry is reachable from this session. Every claim here is a
  rendering, arithmetic or SQL claim, and none depends on which server answered
  the data call. **0025 has NOT been pushed to the linked project**; it is
  committed and applied locally only. `supabase db push` is the delivery and it
  has not happened.
- **The deck ground has never been rendered**, because nothing sets
  `data-ground="deck"`. It is asserted complete and its literals are measured;
  no screen has been seen wearing it.
- **No printed sheet was produced.** The print scope tracks paper and is
  asserted for completeness; it has not been through a print dialog.

### Found, not fixed

- **`/app/codegen/[teamId]` overflows 9px horizontally at 375**, on both
  grounds. Confirmed PRE-EXISTING: the same probe reports 9px at HEAD. The
  overflowing boxes are `.mc__head`, `.mc__teams` and `.cg`, which is a padding
  or box-sizing question in the mentor console wrapper. It is layout, and this
  bundle was told to change colour and tokens.
- **`src/lib/design-system/index.css`'s header is still stale** (it names the
  FIRST palettes and the Roboto family, neither of which has been true since the
  IDEA bundle). Reported last bundle, still a comment, still not this bundle's
  remit.

## 2026-08-29 -- Two branches to main, and the six-step delivery becomes one command

Two reviewed branches carrying no SQL went to `main`, and the hand-run
procedure for delivering a migration became `scripts/land-migration.sh`.

### What landed on main

Both merged `--no-ff` in order, from `d050814`, and both merged clean; they
touch disjoint directories, so a conflict would have been a signal rather than
something to resolve.

- `claude/planner-mat-dimensions-a5nt7m` (a0d5f6a): the mat geometry
  correction. Ten files, all under `src/lib/planner/` and `tests/`.
- `claude/robot-build-manual-access-513wpq` (04d8668): the build manual made
  reachable. Seven files, all under `src/lib/content/`, `src/routes/app/` and
  `tests/`.
- `main` is `0f2e3fa`.

**Confirmed by reading the artifact on the remote, not by trusting the push.**
`src/routes/app/build/+page.svelte` is on `origin/main` (blob
`8b5dd25`), and it carries the reason it joins no route group: the mentor group
would 403 a student, the student group would 403 the board.
`src/lib/planner/geometry.ts` on `origin/main` declares `TABLE_WIDTH_MM = 2362`,
`TABLE_HEIGHT_MM = 1143`, `MAT_SIDE_STRIP_MM = 181`, `MAT_TOP_GAP_MM = 9`, and
derives `MAT_WIDTH_MM = 2000` and `MAT_HEIGHT_MM = 1134` from them; its header
now calls 2362 by 1143 THE TABLE and records that the old comment called those
numbers the mat for six bundles. `docs/HISTORY.md` was 4697 lines at that
point.

**Neither branch wrote a HISTORY entry.** Both shipped without one, which the
documentation rule asks for. Recorded here rather than fixed: their reasoning
lives in their own file headers, and back-filling two entries from a diff would
be a worse record than none.

### scripts/land-migration.sh

The delivery of one migration used to be six steps run by hand, and three
times running (0019, 0020, 0021) the SQL reached production by a path that
writes no ledger row. The script is that procedure with the failure modes
written into it.

- **STEP 3 IS THE WHOLE POINT AND EVERYTHING ELSE IS PLUMBING.** `db push`
  does not push the file you name, it pushes every local migration the remote
  ledger is missing. So a hole BELOW the target means `db push` replays a file
  whose objects may already be live. The script parses
  `migration list --linked`, and a hole below the target ABORTS: nothing after
  it runs, and the message names each file and tells the reader how to tell
  "genuinely absent" from "present but unrecorded", with the
  `migration repair --status applied` command for the second case.
- **THE PARSER IS PROVED, NOT ASSERTED, AND THE PROOF SHIPS WITH IT.**
  `--self-test` runs it against four captured shapes of the CLI's own output:
  a clean chain, a chain with 0024 missing from the remote ledger, an
  ASCII-pipe rendering with the target applied and a file pending above it,
  and a target absent from the list entirely. It runs on EVERY invocation
  before anything is touched, so a broken gate stops the run rather than
  waving it through.
- **The gate was mutated in the permissive direction to prove it bites.**
  Collapsing the below/above branch so every hole classified as `above`
  (a warning, not an abort) reddened two of the four cases with the exact
  diff printed. Restored byte-identically, md5 `cde48bb7...` before and
  after, and green again.
- **ONE CREDENTIAL PATH.** Every CLI call goes through
  `scripts/wsl-supabase.sh`. The script never runs a bare `supabase` and never
  sets `SUPABASE_ACCESS_TOKEN` in its own environment. It also refuses to run
  if the checkout it is in is not the directory the wrapper cds to inside WSL,
  because that mismatch would push one tree's migrations while reporting on
  another's.
- **STEP 6 READS THE CATALOG, NOT THE LEDGER AND NOT THE PUSH OUTPUT**, since
  those are the two things that agreed with themselves and disagreed with the
  database all three times. The objects are read OUT OF THE MIGRATION FILE
  (functions, triggers with their table, tables, indexes, types, policies),
  with dollar-quoted bodies skipped so a `create` inside a function body is
  not mistaken for an object the file creates, so the step is not specific to
  0026. Against `0026_notebook_whole_team_writes.sql` it extracts exactly
  `notebook_can_edit`, `notebook_can_confirm`, `_meeting_recaps_confirm_gate`
  and the trigger `meeting_recaps_confirm_gate` on `meeting_recaps`, which is
  the list that bundle is meant to deliver. The read is a SELECT against the
  Management API address `tests/db/linked.ts` already uses, with the token
  extracted by the wrapper's own expression. **If it cannot reach the remote
  it says so and prints the SQL to paste**, and asks for a second typed
  confirmation before merging on an unconfirmed schema. It never reports
  success it did not measure.
- **The typed confirmation is `apply NNNN`, not a keypress.** It names what
  and which, so a stray Enter cannot push and a scrollback paste cannot
  either.
- **`docs/HISTORY.md` IS THE ONE FILE A CONFLICT IS RESOLVED IN, AND THE
  RESOLUTION IS MECHANICAL.** It is append-at-the-end by construction, so two
  bundles in flight conflict there and nowhere else; `git merge-file --union`
  over the three stages keeps both, in bundle order. ANY OTHER CONFLICTED PATH
  aborts the merge and restores the tree. Both paths were exercised in
  sandbox repositories: the union path produced both entries in order with no
  markers, no leftovers and a merge commit; the other path aborted with the
  conflicting path named and `git status` clean at the pre-merge commit.
- **The union merge drops the blank line between the two headings.** Both
  entries are present and ordered; only the spacing wants a human eye. Written
  into the script's own comment rather than worked around.
- **NOTHING IS ROLLED BACK, DELIBERATELY.** By step 8 the SQL is live and
  `main` is pushed. A red suite is reported as a finding, loudly, in the
  closing block, and the script exits 2; reverting the merge would leave the
  schema ahead of the code, which is worse than a red suite somebody can read.
- **It holds a WSL session open for its own duration.** `db reset` in step 8
  is exactly the case CLAUDE.md warns about, where the VM shuts down with no
  session open and kills the containers mid-run.
- Every abort prints the same three headings: what stopped, where that leaves
  the repo AND the linked project, and the next command to run.

### Measured

- `--self-test`: 4 of 4 cases green. Gutted permissively: 2 of 4 red, with the
  expected and actual classifications printed. Restored, md5 identical, green.
- Object extraction against `0026`: the four objects above and nothing else.
  Against `0019`: 12 functions, 1 index, 1 policy, 1 table, 2 triggers with
  their table resolved. Against `0017`: 1 table, 2 triggers, 5 policies.
- `shellcheck --shell=bash scripts/land-migration.sh`: clean, no findings.
  `bash -n`: clean.
- Argument handling: no arguments prints usage and exits 1; a version with no
  branch aborts with the usage as its "what to do next"; `-h` exits 0.
- `npx svelte-kit sync && npx svelte-check`: **0 errors, 0 warnings, 726 files**,
  which is the documented baseline. It needs a `.env` carrying the two
  `PUBLIC_SUPABASE_*` names to reach it: without one, `svelte-kit sync`
  generates no members on `$env/static/public` and the same 5 errors appear in
  `hooks.server.ts`, `service-client.ts` and the root `+layout.ts`. Measured
  both ways in this container to be sure the 5 were the missing file and not a
  defect; the placeholder `.env` was deleted afterwards and is gitignored
  either way.
- **The DB-free tests covering the two merged branches: 7 files, 209 tests, all
  passing** (`planner-geometry`, `planner-units`, `planner-calibration`,
  `build-manual-entry`, `design-tokens`, `theme-contrast`, `theme-toggle`).

### Not verified

- **THE SCRIPT HAS NEVER BEEN RUN END TO END.** This session had no WSL, no
  Docker, no `.env` and no reach to the linked project, and was instructed to
  run no `supabase` command at all. What is proved is the parser, the object
  extractor, both merge paths, the argument handling and the shell itself.
  What is NOT proved is any step that talks to Supabase: steps 3, 5, 6 and 8
  have never executed against a real CLI or a real project. **The first run
  on Mr. Pina's machine is the real test**, and the safe way to take it is to
  read the step 3 output and the SQL, then stop at the confirmation prompt the
  first time by typing anything else: everything before that prompt is
  read-only apart from a local merge on the branch.
- **The captured `migration list` output in the self test is written from the
  format the CLI documents and HISTORY records, not copied from a live run**
  of this machine's CLI. If 2.115.0 draws that table differently the parser is
  tolerant of the differences seen so far (box characters or ASCII pipes, with
  or without bracketing pipes) but has not met the real thing. A first run
  that reports `target-missing` for a file that is plainly listed is that
  mismatch, and the fix is a fifth fixture.
- **0026 is still unpushed and `claude/notebook-write-permissions-sbwtjq` is
  still unmerged**, which is the correct state: the script is the machinery
  for landing it and has not been run.

### Deferred

- A `create policy` whose `on <table>` sits on a following line extracts with
  an empty table in step 6's object list. Cosmetic only: the lookup keys on
  the policy name and `pg_policies` returns the table anyway.
