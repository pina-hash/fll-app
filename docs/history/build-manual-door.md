---
title: "The build manual gets a tab in the console nav, and the student door moves inside the student screen (`claude/build-manual-door-d28nd3`, code only, no migration)"
date: 2026-09-02
branches: [claude/build-manual-door-d28nd3]
migrations: []
subsystems: ["Skill Hub, notebook", "Student runtime", "Mentor console"]
---

### The prompt's premise was false, and the tree said so

This bundle was issued to add two doors onto `/app/build`, on the stated
grounds that neither existed: no entry in the console nav array, and no link
on the student screen. **The first claim was true. The second was not.**

`src/routes/app/(student)/me/+page.svelte` already rendered a "Build our
robot" slab immediately below `StudentScreen`, added by
`claude/robot-build-manual-access-513wpq` and live on `main` since `04d8668`.
`tests/build-manual-entry.test.ts` named that exact file as its `student`
entry point and asserted that it stated the step count and warned about the
file size, so the door was not merely present, it was test-locked. A student
could reach the manual. The prompt's file list had been drawn from the wrong
claim, which is why it withheld both the page and the test.

The audit is what corrected it: `grep -rn COMP_BOT_MANUAL_ROUTE src/` put the
existing link on screen in one line. That is the whole reason the prompt asked
for an audit before a gate.

Reported back rather than built around, the ownership was extended to cover
the page and the test, and the work became the move the previous bundle had
already asked for in writing.

### What changed

**The console nav gets a `Build` tab**, immediately before `Library`, in
`src/routes/app/+layout.svelte`. It links `COMP_BOT_MANUAL_ROUTE`, never the
23 MB file: the destination screen is the thing that states the size before
the tap. The nav renders only for a mentor (`{#if isMentor}`), which is the
population that was missing a door, because from the console the Skill Hub
tile was the only way in.

**The student's door moved into `StudentScreen`'s own `destinations`
snippet**, as a seventh entry beside "Make our robot code", behind a
`buildHref` prop defaulting to `COMP_BOT_MANUAL_ROUTE`. The slab in
`(student)/me/+page.svelte` is gone; that page now passes the href like any
other prop.

**The file size note came with it.** It sits under the list rather than inside
the link label, because these slabs are one short sentence each and a
nine-year-old reads the first line only. Dropping it was never on the table:
23 MB over school wifi is a fact a student is owed before the tap, not after.

### The load-bearing decisions

**THE PREVIOUS BUNDLE ASKED FOR THIS MOVE IN A COMMENT, AND THE COMMENT WAS
RIGHT.** It read: "THE PROPER HOME IS StudentScreen'S OWN `destinations`
snippet ... but that component belongs to another lane this bundle, so the
link lives here instead. Moving it in is a one-line change and should happen
the next time that file is open." A door parked outside the component that
owns the list is two places to keep in step, and the slab had already grown a
duplicate of the size copy to prove it.

**THE CHECK-IN BRANCH NO LONGER SHOWS THE MANUAL, AND THAT IS THE POINT.**
`destinations()` renders in two of the component's three top-level branches:
the no-meeting branch and the checked-in branch. It does not render on the
check-in screen, which is deliberately one question and one button. That
branch is exactly why the slab was placed outside the component originally,
and accepting the loss is what makes the move a simplification rather than a
relocation. A student reaches the manual before the meeting starts and again
once they are checked in.

**REMOVING THE SLAB LOSES NO CLEARANCE FOR THE FIXED I'M STUCK BAR.** The slab
carried `padding-bottom: 7rem` with a comment saying it cleared that bar.
`.sr`, the component's own root, already carries `6.5rem` for the same reason.
The slab's padding was clearing the bar only for the slab, because the slab
sat outside `.sr`. Checked before the deletion, not after.

**THE TEST FOLLOWED THE DOOR AND KEPT EVERY CLAIM.** `ENTRY_POINTS.student` is
`src/lib/student/StudentScreen.svelte` now. Two files joined a new
`ALSO_SCANNED` list, which is held to the single-source rule but not to the
copy rules: the page that mounts the screen and passes the href, and the
console layout that carries the new tab. A door added and left unscanned is
the next place somebody types the path.

### What was measured

- `npm run check`: **726 files, 0 errors, 0 warnings**, both before any edit
  and after all of them. The baseline needed a local `.env` with placeholder
  `PUBLIC_SUPABASE_*` values first; without one, `svelte-check` reports 5
  errors in 3 files for missing `$env/static/public` members, on `origin/main`
  as much as here. That `.env` was never committed.
- `npm test -- --project pure`: **16 files, 343 tests, all passing**, which is
  the figure `CLAUDE.md` records for that project.
- **The single-source test was proved to bite.** `buildHref`'s default was
  mutated in the permissive direction, from `COMP_BOT_MANUAL_ROUTE` to a typed
  `'/app/build'`, and `tests/build-manual-entry.test.ts` went red on the
  offenders assertion at line 123. The file was restored and `md5sum -c`
  confirmed it byte-identical, and the suite went green again.
- The repo-wide dash check (`git ls-files -z | xargs -0 grep -l`) returns
  nothing.

### What is explicitly NOT verified

- **The suite was not run in full.** `npm test` needs a running local Supabase
  stack and this container has none, so the 32 `db` files were not executed.
  Nothing in this bundle touches SQL, RLS, a grant or an RPC, but that is a
  reason to expect them green, not evidence that they are.
- **Nothing was seen in a browser.** No screenshot, no contrast measurement, no
  375px or 1440px pass. The new nav tab takes `.shell__tab` unchanged and the
  new destination takes `.sr__teamlink` unchanged, so neither introduces a
  colour or a size that was not already measured, but the nav is one tab wider
  than it was and that row scrolls on purpose.
- `npm run verify:browser` was not run.

### What was deferred

- **The unreachable card on `/app` was left exactly as it is**, and deliberately.
  `src/routes/app/+page.server.ts` redirects all three principal kinds away, so
  the build card in `+page.svelte` is reachable by nobody. It could not simply
  be deleted: `tests/build-manual-entry.test.ts` names that file as its `home`
  entry point and asserts it imports the constant, states the step count and
  warns about the size, so deleting the card reddens the suite. Resolving it
  properly means deciding whether `/app` should render for anyone at all, which
  is a question about the redirect and not about the manual.
- **`--font-display` is a token `CLAUDE.md` says does not exist.** The Visual
  theme section states "there is deliberately no `--font-display` that reaches
  the hero face". `src/lib/design-system/typography.css:31` declares it, mapped
  to Rajdhani, and eight rules across `StudentScreen.svelte`, `MatchTimer.svelte`
  and `app/build/+page.svelte` reference it. The token resolves to the body face,
  so nothing renders wrongly and no heading has reached the hero face; the rule
  and the tree simply disagree about whether the name exists. Left alone: the
  stylesheet and `CLAUDE.md` both belong to other lanes.
