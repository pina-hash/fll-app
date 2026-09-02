---
title: "The build manual gets a screen of its own and three ways in (`claude/robot-build-manual-access-513wpq`, code only, no migration)"
date: 2026-08-28
branches: [claude/robot-build-manual-access-513wpq]
migrations: []
subsystems: ["Skill Hub, notebook", "Student runtime"]
---

**RECONSTRUCTED FROM GIT ON 2026-09-02, NOT FROM A SESSION REPORT.** This
bundle merged to `main` as `04d8668` (merge `0f2e3fa`) and wrote no entry;
the record below is read off its own commit message and diff. The measured
figures quoted at the end are the commit's own words, not a re-measurement.

### What was wrong

The 225-step competition build manual had shipped in `static/build/` and was
reachable only through Skill Hub, then Build and Programming, then ROBOT4,
then a resource link. **Four taps, with the word "build" appearing nowhere
above the last one**, for the single artifact every team spends the season
inside.

### The screen

`/app/build` says plainly that this is the robot every team is building this
season, says how many steps it is, and opens the file on an explicit tap.

**It sits directly under `/app` and joins no route group**, which is the
load-bearing placement decision: the mentor group would 403 a student, the
student group would 403 the board, and the Skill Hub's own layout refuses a
board device on purpose. The robot is the one thing all three populations
look at, so the only guard above this page is `/app`'s, which asks for a
principal and nothing else. The Skill Hub link ON the page is hidden from a
board device, because the destination refuses one.

### Nothing pulls 23 MB until a thumb says so

No `<embed>`, no `<iframe>`, no `<object>`, no PDF viewer. Any of those start
the transfer while the page is still painting, and a viewer would also make a
nine-year-old wait for a library to load before seeing step 1. The router is
told the same thing twice (`data-sveltekit-reload`, `preload-data="off"`),
because the body carries `preload-data="hover"` and a static file has no
business being fetched because a finger brushed past it.

**The size is stated in words, next to the control, not in a tooltip**: "PDF,
225 steps, about 23 MB", with a sentence saying it can take a minute on a
phone and to leave the tab open rather than reopening it. A second control
saves it for offline reading.

### One path, written down once

`src/lib/content/resources.ts` gained `COMP_BOT_MANUAL_ROUTE`,
`COMP_BOT_MANUAL_STEPS` (225) and `COMP_BOT_MANUAL_SIZE` ("about 23 MB")
beside the existing `COMP_BOT_MANUAL_URL`. Five surfaces reach the manual now
and every one imports a constant rather than spelling a path of its own.

**Entry points link at the ROUTE, never at the PDF**, and the reason is
stated in the source: the tap that starts pulling 23 MB has to be the one on
a screen that has already said how big it is, and a card cannot say that and
still be a card. The three added entry points are the signed-in home screen,
the student screen and the Skill Hub's tile grid. ROBOT4's lesson now names
the new screen instead of pointing only downward; its resource link is
unchanged and still resolves to the same file.

`tests/build-manual-entry.test.ts` goes red if a second file types either
path as a literal, if the file stops being a PDF of about that size, or if a
viewer appears on the screen.

### Measured (quoted from the commit)

9 surfaces on both grounds at 375 and 1440, 1336 text nodes walked, 0
pairings under their floor, 0px horizontal overflow.

**One contrast defect found and fixed in passing**: the eyebrow on the
student and board shell measured 3.83 against the team wash at full strength
and now takes `--text-2`, because `--text-faint` is derived against the three
surfaces and not against the wash that shell paints.

### The lane that is still open

The commit says the manual now has "three ways in". The nav entry in
`src/routes/app/+layout.svelte`, the redirect in
`src/routes/app/+page.server.ts` and the student link in
`src/lib/student/StudentScreen.svelte` are a separate lane and were not this
bundle's; see `docs/decisions/` and the conformance entry of 2026-09-02,
which records that door as the highest-value app work outstanding.
