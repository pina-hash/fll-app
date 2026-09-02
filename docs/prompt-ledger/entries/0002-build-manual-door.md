# 0002 Give the robot build manual a door in the mentor nav and on the student screen
- Issued: 2026-09-02
- By: claude.ai chat "FLL app work, 2026-09-02", build manual door lane
- Owns: `src/routes/app/+layout.svelte`, `src/routes/app/+page.svelte`,
  `src/routes/app/+page.server.ts`, `src/routes/app/build/**`,
  `src/lib/student/StudentScreen.svelte`, `src/lib/content/resources.ts`
- Migration permitted: no. Highest on origin/main at issue: 0025
- Status: pushed
- Branch: assigned by the harness; named in the session report
- Notes: `/app/build` shipped on `claude/robot-build-manual-access-513wpq` and is
  live on `main`. The console nav array carries no entry for it, `/app` redirects
  every principal away from the card that links to it, and the student screen has no
  link, so the Skill Hub tile is the only way in. This bundle adds the two missing
  doors and changes nothing else. Deliberately excluded: the conformance lane's
  paths, any restyling, any new route, any migration.
