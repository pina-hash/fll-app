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
