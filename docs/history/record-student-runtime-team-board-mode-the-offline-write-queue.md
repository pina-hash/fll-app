---
title: "2026-08-23 -- Student runtime, Team Board mode, the offline write queue"
date: 2026-08-23
branches: []
migrations: ["0010"]
subsystems: ["Student runtime"]
record_order: 4
---

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

