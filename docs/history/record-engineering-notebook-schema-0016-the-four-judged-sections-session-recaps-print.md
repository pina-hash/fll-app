---
title: "2026-08-23 -- Engineering notebook: schema 0016, the four judged sections, session recaps, print"
date: 2026-08-23
branches: []
migrations: ["0016"]
subsystems: ["Skill Hub, notebook"]
record_order: 8
---

### What shipped

- **Schema 0016** (`supabase/migrations/0016_engineering_notebook.sql`): the
  `notebook_section` and `notebook_outcome` enums; `notebook_can_edit()` (the
  one statement of who edits which section, built on `team_resolve_roles`'
  covering rule exactly the way `strategy_can_edit` is); `notebook_entries`
  (prompt answers, free notes, and Robot Design "tries" with a first-class
  worked/failed/mixed outcome); `meeting_recaps` (one frozen jsonb draft per
  team per meeting plus the lead's summary and a confirmed flag whose stamps
  are trigger-owned); `_meeting_recap_facts()` and
  `_meeting_recaps_generate()`; `meeting_advance_phase` and `meeting_end`
  replaced at their signatures to generate drafts at the Close (the last
  phase) and at meeting end; `_student_detach_from_team` replaced to drop
  notebook attribution on a team move; `notebook_season_stats()`; a
  `unique (id, team_id)` on `evidence` so entries cite photos by composite
  key.
- **The app**: `src/lib/content/notebook.ts` (prompts written fresh at a
  fourth-grade level; nothing taken from the copyrighted FIRST notebook,
  which is linked through the Library instead), `src/lib/notebook/`
  (`types.ts`, `data.ts`, `ops.ts`, `Notebook.svelte`, `NotebookPage.svelte`,
  `NotebookPrint.svelte`), student routes `/app/me/notebook` and
  `/app/me/notebook/print`, mentor routes `/app/notebook`,
  `/app/notebook/[teamId]` and its `/print`, the `/dev/notebook` harness, a
  Notebook tab in the console nav and a "Write in our notebook" link on My
  Screen. Notebook ops ride the existing WriteQueue.

### The load-bearing decisions

- **THE MAPPING IS THE FEATURE.** The notebook assembles itself from what the
  app already recorded, so students edit and add reasoning instead of
  retyping the season. Robot Design gets the iteration story (tries), the
  strategy-version and match-run record; the session recap draft carries
  attendance names, tasks closed (with role), photos with captions, blockers
  raised and resolved, run count and best points, and strategy versions
  saved, all computed from the meeting's own window.
- **A recap draft is FROZEN jsonb, not a view**, so a task deleted in
  November cannot erase what an October recap said. It regenerates only
  while unconfirmed; confirming freezes it, and that is what confirming
  means. Unconfirmed recaps render with a "Not finished" badge in the app
  and a "Draft, not confirmed" mark in print; they are never dropped.
- **Confirmation is a client boolean with server-owned stamps**
  (`confirmed_at`, `confirmed_by_*` carry no grant; a trigger stamps them
  from the server clock and the caller), the same shape as `tasks.closed_at`,
  so a queued confirm replays idempotently and keeps its original stamp.
- **Section edit rights live in `notebook_can_edit(team_id, section)`**: any
  mentor; the Notebook and Values Lead everywhere; Robot Design also takes
  the builder, programmer and run captain; the Innovation Project also takes
  the innovation lead. Recap edits gate on the `season_summary` section. The
  covering rule is delegated, never re-derived.
- **A failed try is a first-class row** (`outcome = 'failed'`, styled and
  encouraged in copy), because Robot Design judging rewards the iteration
  story and children hide failures unless the UI tells them not to.
- **On a team move, notebook attribution detaches** (0015's practice-run
  answer, not 0013's blocker refusal): the notebook belongs to the team, so
  the words stay and only the byline goes.
- **Print is the browser's own PDF path** (`window.print()` on a flat
  document whose base state hides nothing); `color-scheme: light` and white
  `html`/`body` are forced under `@media print` because the app's dark canvas
  otherwise prints as a border around the paper.

### What was measured

- **The permissive mutation bit.** With the notebook read policy set to
  `using (true)` and `notebook_can_edit` set to `select true`, seven of the
  sixteen isolation tests went red (cross-team read, write, delete, section
  gating, recap gating, the covering rule); restored verbatim from the
  migration, all sixteen green again, and the final run was against a
  `db reset` schema derived purely from the files.
- `tests/notebook-recap.test.ts` lived a real session through the real RPCs
  and proved the draft contains what happened: the names checked in, the
  closed task and its role, the photo caption and path, the blocker note in
  both raised and resolved lists, one run priced at 20 by the trigger, the
  strategy version, and both halves of confirmation (frozen when confirmed,
  regenerated with late work when not).
- `tests/notebook-offline-replay.test.ts`: the same insert op twice under
  one client-minted id is one row; the NEGATIVE CONTROL (same payload,
  different id) is two rows; refused updates are shown, replayed deletes and
  confirms converge, and a replayed confirm keeps its original stamp.
- **In the browser, with real data**: signed in as the seeded Red Team
  notebook lead through the real login screen, wrote a failed try, reloaded,
  and read it back from the server with the right byline; the drafted recap
  showed the seeded session's real attendance, task and blockers; summary
  and confirm survived a reload; the print route rendered all of it.
- **Print output verified, not assumed**: headless Chrome printed the
  harness's print view to PDF (read back page by page), and the PDF's first
  fill operation was checked to be white after the color-scheme fix. Photos
  render in entries and the session log at readable size with captions.
- **The harness link proved both ways**: a sentinel edit inside
  `Notebook.svelte` appeared in the harness and the file was restored to an
  identical md5; the guard inverted to `if (dev)` answered 404 and was
  restored to an identical md5; a real edit in the harness produced
  `notebook_update` in the persist log.
- **375px and 1440px: 0px horizontal overflow** on every notebook tab, the
  open composer, and the print view, in the harness and on the real student
  pages.
- `npx svelte-check`: **0 errors, 0 warnings** (636 files). Full suite: **33
  files, 337 tests**, green against the reset stack.

### What is explicitly NOT verified

- **The mentor notebook pages through a real Google sign-in.** OAuth needs a
  human; the mentor's edit rights are proved at the database layer
  (`notebook_can_edit`, the mentor writes in the isolation test) and the
  pages reuse the student page's components and loader verbatim.
- **Paper from a physical printer.** The PDF is Chrome's print pipeline,
  which is also what "Save as PDF" uses; nobody fed a sheet.
- **A photo in the printed PDF from real storage.** The PDF's photos came
  from the harness's data-URI fixture; the real signed-URL path renders in
  the app (verified) and print uses the same `photoUrls` map, but the seeded
  evidence rows point at storage objects that were never uploaded.
- **The linked project.** `supabase migration list` shows remote at 0012:
  0013-0015 were left unpushed by the previous bundle and 0016 follows them.
  Pushing all four is one `supabase db push` (with the `.env` token) when
  the club decides.

### Deferred

- **Attaching a NEW photo from inside the notebook.** Entries cite photos the
  season already captured (evidence rows); the capture path stays on tasks,
  where the photo proves work. A "take a photo for the notebook" flow would
  need its own storage pathing and adds a second camera surface.
- **Reordering entries by drag.** `sort_order` exists and is written on
  insert; no drag UI.
- **Realtime on the notebook tables.** Left out on purpose, like the
  planner: one effective editor per section, and a refetch landing under a
  child mid-sentence would clobber the text they are typing.
- **A judge-facing table of contents or page numbers in print.** The
  document is short enough this season; the browser's print margins carry no
  numbering.

---

