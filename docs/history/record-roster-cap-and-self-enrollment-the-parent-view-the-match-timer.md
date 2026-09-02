---
title: "2026-08-23 -- Roster cap and self-enrollment, the parent view, the match timer"
date: 2026-08-23
branches: []
migrations: ["0013", "0014", "0015"]
subsystems: ["Roster, parents, match runs"]
record_order: 7
---

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

