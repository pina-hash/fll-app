---
title: "2026-08-24 -- Seat codes replace the open join window, and every entity becomes operable"
date: 2026-08-24
branches: []
migrations: ["0019", "0020"]
subsystems: ["Roster, parents, match runs"]
record_order: 11
---

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

