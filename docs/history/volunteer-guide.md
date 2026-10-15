---
title: "A Volunteer Guide in the Skill Hub: the three printed sheets as a phone checklist, and every mission linked to its page in the official rulebook (code only, no migration)"
date: 2026-10-14
branches: [main]
migrations: []
subsystems: ["Skill Hub, notebook"]
---

### What shipped

`/app/library/volunteer`, reachable from a new first-row tile in the Skill Hub, so any signed-in mentor or student device can open it. No database, no migration.

- **The three sheets.** Game Plan, Iteration Log and More Rounds each expand to what a finished sheet looks like and what to ask a team holding it. The text is the club's own, written from the sheets as printed on 2026-09-25 and 2026-10-14.
- **A two-minute team check.** Seven tap-to-tick lines ordered by where a struggling team usually breaks: plan, a log per launch, versions with a photo or saved program, one change per test, three tries, the 10-run PROVE IT, and feeding the best version back to the Game Plan. The ticks live on the device for the visit and are not saved.
- **Missions.** All 15, each with the existing summary page and an "official rulebook, page N" link. No FIRST text is copied in; the existing link-only rule holds.

### Page numbers were measured, and an estimate from a fetch tool was wrong

The page for each mission was read from the real rulebook PDF (`fll-challenge-bioglow-rgr.pdf`, 20 pages): the mat map is p8, Missions 01 to 04 are p9, 05 to 08 p10, 09 to 12 p11, 13 to 15 p12. A web-fetch summary of the same file had guessed p9 to p13 with different groupings. It admitted it could not read page boundaries and was wrong anyway, which is why the numbers come from `pdftotext` page by page. The Game Plan's own "mission map p8" citation agrees with the measurement.

### What was verified, and what was not

- `tests/volunteer-guide.test.ts` (pure, no stack) pins that all 15 missions have a page, pages stay in 9 to 12 and in order, and links stay on FIRST's own host. `npm run test:pure`: 17 files, 350 tests, all passing.
- `svelte-check` reports 5 errors, all missing `PUBLIC_SUPABASE_*` env vars in files this change does not touch; none in the new files.
- **The page was not rendered in a browser.** Every `/app` surface needs a Google or seat-code session, so no production surface can be driven from a container. Open it on a phone before Friday's session.

### Needs a person

- **Re-read the page table if FIRST reissues the rulebook.** The Challenge Updates document overrides the rulebook and changes in season; the page links to it with the existing warning.
- **The #page= anchor** is honored by desktop and Android PDF viewers. On iOS Safari it may open the rulebook at page 1. The link still opens the official rulebook, which is the safe failure.
