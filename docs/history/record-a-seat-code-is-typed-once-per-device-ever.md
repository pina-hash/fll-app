---
title: "2026-08-27 -- A seat code is typed once per device, ever"
date: 2026-08-27
branches: []
migrations: []
subsystems: ["Student runtime"]
record_order: 23
---

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

