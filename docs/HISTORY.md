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
- **`npx svelte-check`: 0 errors, 0 warnings.**
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
