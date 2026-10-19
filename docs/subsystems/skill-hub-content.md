# Skill Hub content

Moved verbatim from `CLAUDE.md` (Conventions) on 2026-10-19, so `CLAUDE.md` stays under 3,000 words. `CLAUDE.md` links here; keep this file current in the same change as anything it describes.

### Skill Hub content

The Skill Hub (the Robot Game Missions, Core Values, Innovation Project, Build
& Programming, the Mechanisms Library, Meet the Robot, and the Video and
Resource Library, plus the official season documents and the Baby Sharks
courses) lives at `/app/library`, reachable by a mentor or a student, not
gated by role, phase, or check-in, and refused to a board device the same way
the rest of `/app` is.

- **Content is editorial and lives in `src/lib/content/` as typed modules,
  not JSON.** It is reviewed in git like any other copy change, and a
  malformed entry fails `svelte-check` rather than surfacing at runtime.
- **THE ONE EXCEPTION IS MISSIONS.** A mission's numbers (name, points,
  scoring lines, mat position) live in the `missions` table
  (`supabase/migrations/0011_missions_and_team_notes.sql`), because a mentor
  edits the mat position at runtime and the route planner references a
  mission by database id. The mission's prose (description, caveats, the
  strategy prompt) stays in `src/lib/content/missions.ts`, joined to the
  table by `code`. Team strategy notes on a mission are `team_mission_notes`,
  one row per team per mission, RLS-scoped the same way tasks are.
- **COPYRIGHT: link only, never rehost.** No FIRST or LEGO artwork, mat
  graphics, mission model images, or building instructions are fetched,
  mirrored, or reproduced here. Every official document and every
  PrimeLessons / FLL Tutorials / Baby Sharks link points at the original
  publisher. The one self-hosted file, `static/build/comp-bot-manual.pdf`
  (the 225-step competition build manual), is not a FIRST publication and is
  this repo's own copy, not a mirror of someone else's. The one piece of official
  artwork that reaches the app at all is the club's own copy of the field
  layout, and it never enters the repo: see "The field picture" below.
- **THE BABY SHARKS PDFs SIT ON A WIX BUCKET THAT BLOCKS AUTOMATED FETCHING.**
  Its bot protection rejects a default curl/headless user agent but serves
  the full PDF to a browser one. A failed `curl` against a
  `filesusr.com/ugd/...` URL is a user-agent problem, not evidence the link
  is dead -- verify those three links by opening them in an actual browser,
  never by curl. Every other external link in the Hub (PrimeLessons, FLL
  Tutorials, the FIRST `blob.core.windows.net` season documents) does not
  block automation, so a curl failure there is a real dead link.
