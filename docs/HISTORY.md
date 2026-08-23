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
