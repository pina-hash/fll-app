---
title: "2026-08-27 -- A mentor door onto the generator, and units that do not drift"
date: 2026-08-27
branches: []
migrations: []
subsystems: ["Code generator"]
record_order: 22
---

Two gaps reported from use. A mentor could be told by the database that they may
edit a team's robot and have nowhere to do it, and the two geometry fields could
only be read in millimetres.

`IDEA_INTERFACE_STANDARDS.md` is NOT in this repository, and was not at the time
this was written: the only tracked Markdown is `CLAUDE.md`, `README.md`,
`docs/FLL_CODEGEN_SPEC.md` and this file. The three rules quoted in the request
were followed instead: one component gated by prop, gate at the load and not
only in the markup, presence of a transport is presence of a control.

### What landed

- **`/app/codegen` and `/app/codegen/[teamId]`, the mentor entry point.** Same
  two-file shape as `/app/plan` and `/app/notebook`: a picker of live team tiles,
  then the surface with a team strip across the top. No picker was invented; the
  planner's was matched, down to the tile markup. `Robot code` joins the console
  nav between Plan and Notebook.
- **NO SECOND MENTOR PAGE.** `CodegenPage.svelte` is still the one render path
  and now says so in its own props. The team was already a prop; what changed is
  that it is now the ONLY thing that differs between the two surfaces, because
  the role flag went away.
- **The save transport replaced the client prop.** `CodegenSave` is a function a
  surface supplies; `supabaseCodegenSave(supabase, teamId)` is the real one and
  closes over the team its load resolved. The component no longer imports
  `saveConfig` or `saveCalibration`, no longer knows what Supabase is, and the
  Save section renders `{#if save}`.
- **Millimetres, centimetres and inches on both geometry fields**
  (`src/lib/codegen/units.ts`), remembered per device in `localStorage` beside
  the theme. No migration: `wheel_diameter_mm` and `track_width_mm` are
  unchanged and a unit never reaches the database.
- **Wheel presets:** 56 mm, 43.2 mm, 88 mm, and Custom, which is what the select
  reads whenever the stored diameter is not one of the three.
- **The readout keeps its millimetres and gains the chosen unit beside them:**
  `300 mm (11.811 in) = 614 motor degrees`. Millimetres are what goes into the
  file, so they are never replaced, only accompanied.

### Load-bearing decisions

- **A TRANSPORT, NOT A ROLE FLAG, AND THE DIFFERENCE IS WHAT HAPPENS WHEN A
  SURFACE FORGETS.** `isMentor={true}` is a claim the page has to trust, and a
  page that trusts a flag it was handed is a page that can be lied to. A
  transport either exists or it does not. Retyping the prop turned both existing
  callers into compile errors until they supplied one, which is the behaviour
  being bought: a surface that forgets fails closed, at the type level, before
  it ever renders.
- **PRESENCE OF A TRANSPORT IS PRESENCE OF A CONTROL.** The old Save button
  rendered unconditionally and its handler began `if (!supabase) return`, so the
  dev harness showed a button that answered a tap with silence. Now no transport
  means no section. What a caller may WRITE is still the database's answer,
  discovered by asking for the row back; the transport only decides whether
  there is anything to press.
- **THE GATE IS AT THE LOAD.** `/app/codegen/[teamId]`'s load 404s a team that
  does not exist or has been archived, before a component is chosen or a prop is
  built. The `(mentor)` group's layout has already answered 403 to anyone who is
  not a mentor. Neither decision is made in markup, and the markup makes none of
  its own: it renders what the prop says.
- **`commit()` IS THE WHOLE UNITS FEATURE.** A field shows a rounded number.
  Converting that number back and storing it is how 56 mm becomes 56.007 mm, and
  then 56.014, and the wheel diameter is the DIVISOR in the distance conversion
  so the error scales every distance in every run. So the field's text and the
  row's millimetres are synced in ONE DIRECTION AT A TIME: text goes to
  millimetres through `commit()`, which refuses a number the field itself
  printed; millimetres go to text only when the unit changes or a preset is
  picked, never while somebody is mid-word in the box.
- **The stated trade:** retyping the number a field is already showing is a
  no-op, because the field's resolution IS its display precision. Anyone who
  genuinely wants 56.007 mm switches the field to mm, where it can be said.
- **`fromUnit()` cuts IEEE-754 dust at six decimals of a millimetre, which is
  not display rounding.** `2.25 * 25.4` is 57.150000000000006 in this language
  and a `numeric` column would keep that verbatim forever.
- **The unit is read from `localStorage` after mount, never in the initialiser.**
  Seeding it during SSR would make the hydrated client disagree with the HTML the
  server sent, and `localStorage` throws rather than returning null in a private
  window. Same reasoning as the theme, and the same try/catch.

### Measured

- **The units test, `tests/codegen-units.test.ts`: 18 passed.** The required
  case: a 56 mm config painted into an inches field shows `2.205`, the untouched
  field hands `2.205` back, and `commit()` returns exactly 56
  (`Object.is(stored, 56)`). Its control: typing `2.25` stores exactly `57.15`,
  `6.2` cm stores `62`, and an edit one display step away (`2.206`) lands as
  `56.0324` rather than being swallowed.
- **The guard was proved to bite, not assumed to.** The naive conversion the
  first branch refuses is asserted to produce `56.007`, and five saves of it in a
  row are asserted to drift while five saves through `commit()` are asserted not
  to move at all.
- **In a browser, at 375 and 1440, both payloads, real component.** Student
  payload (Team 1, teal) and mentor payload (Team 3, orange) at both widths:
  horizontal overflow **0 px** at every one, heading rendered, unit control
  reading `mm | cm | inches`, wheel select offering the three presets plus
  "Something else (type it below)". Generate from each produced **FLL Toolkit v1,
  374 blocks, 9 stacks, six extensions** and **FLL Toolkit Self Test, 466 blocks,
  10 stacks, seven extensions**, verdict "Checked: nothing wrong. 2 files ready.",
  with the download control present. The only console error was a 404 for
  `/favicon.ico` at 375, which is pre-existing.
- **The units rule watched in the browser, not only asserted.** Opened at 56.0 /
  112.0 mm; switching to inches repainted the fields to `2.205` and `4.409` and
  the note under them read "Saved as 56.0 mm across and 112.0 mm apart". Save
  with the field untouched handed the transport **wheel 56 mm, track 112 mm**.
  Focusing the field, firing its input event (the field echoing its own display)
  and saving again handed the transport **56 mm** again. Typing `2.25` moved the
  readout from 614 to 602 motor degrees and handed the transport **57.15 mm**.
  Switching back to mm showed `57.1` in a one-decimal field while the row held
  57.15, and the preset select correctly read "custom".
- **The preference survives a reload:** chose cm, reloaded, and came back to
  `WHEEL ACROSS (CM) = 5.60` with the readout `300 mm (30.00 cm) = 614 motor
  degrees`. Presets from there: 43.2 mm gave 796 motor degrees, 88 mm gave 391,
  and saving handed the transport **88 mm** exactly.
- **No transport, no control:** `/dev/codegen?save=off` renders zero Save
  buttons and no "Keep these numbers" section, with Generate still present.
- **Both new routes exist and are gated.** With no session, `/app/codegen` and
  `/app/codegen/<uuid>` both land on `/login?next=...`, and the RENDERED TEXT was
  checked rather than the status code, because a sweep that follows redirects
  measures the login page and reports it as a clean surface.
- **The mentor write path, against the applied chain.** A mentor has
  `is_mentor() = true` and `current_student_team_id() = null`, and
  `strategy_can_edit()` is true for both teams. The insert `saveConfig` sends
  returned 1 row; the reload read back
  id `88459096-0133-48f3-ac4e-baf2971d6f8f`, name `Mentor base mentort1n`,
  wheel 56, track 112, gears 1. `wheel_diameter_mm` came back as the string
  `"56"` (it is `numeric`, so PostgREST hands it over as text) and
  `Number()` of it is exactly 56. Writing 56 again left it at 56; writing the
  drifted 56.007 showed the column keeps it verbatim, which is why the guard is
  in the client and not hoped for in the database.
- **The dark ground and both accents were looked at**, at 1440, in inches: 0 px
  horizontal overflow, the selected unit chip carrying the team accent, and no
  new colour token introduced (`.cg__also` uses `--text-muted`, already measured
  on this surface).
- `npx svelte-check`: **0 errors, 0 warnings, 715 files.**
- **The full control suite: 23 negative controls CAUGHT, 5 positive controls
  SILENT, 1 reporting case, 56 tests across three files.**
- The full suite: 15 files passed, 29 failed, 289 tests passed. Every one of the
  29 fails on GoTrue or PostgREST being absent, unchanged from the last bundle.
- The repo-wide em dash and en dash check is clean.

### Not verified, and one premise corrected

- **A MENTOR CAN WRITE TO ANY TEAM, INCLUDING ONE THEY DID NOT SELECT, AND THAT
  IS THE SCHEMA WORKING AS WRITTEN.** The request asked to confirm that a mentor
  on no team still cannot write to a team they did not select. Measured, the
  database says the opposite and says it deliberately: `strategy_can_edit()` is
  `is_mentor() OR the Run Captain`, so mentor B inserting into a team mentor B
  never opened returned 1 row with no error. 0024's header says as much ("any
  mentor, and the Run Captain"), and it is the same rule the route planner has
  had since 0012. What actually scopes a mentor is the APPLICATION: the
  transport closes over the team its load resolved, and `CodegenSaveInput`
  carries no team field, so a rendered page has no way to name a different one.
  That is a closure, not a boundary, and it is written down here rather than
  described as one.
- **The boundary that IS in the database is the student one, and it holds.** A
  student who is not the Run Captain got `strategy_can_edit = false`, an INSERT
  refused outright with `42501` ("new row violates row-level security policy for
  table robot_configs"), and an UPDATE of another team's row that returned zero
  rows with no error. Positive controls: mentor B READS team one's row (1 row,
  because 0024's read policy names mentors), and a team two student reads it as
  0 rows where the service role reads 1.
- **Nothing was signed in through the real routes.** No container registry is
  reachable from this session (`ghcr.io` and Docker Hub blob hosts both answer
  403 through the agent proxy), so GoTrue and PostgREST could not be started and
  no browser could hold a mentor or student session. The browser evidence above
  is the REAL component under both payloads in the `/dev` harness, plus the
  redirect both real routes perform with no session. The database evidence is
  the real chain on a PostgreSQL 16 cluster with a hand-built stand-in for the
  platform base, with every statement issued the way PostgREST issues one.
- **The "Drive this far" box is still millimetres.** The readout beside it now
  carries the chosen unit, which is what was asked; making the input itself
  unit-aware was not, and a third field that converts is a third place the
  rounding rule has to hold.
- **`database.types.ts` is still unregenerated**, so `storage.ts` still goes
  through its `untyped` handle. `supabase gen types` runs `postgres-meta` in a
  container and cannot be pulled either.

### Deferred

- A mentor picking a team still lands on that team's FIRST saved config, because
  `CodegenPage` reads `data.configs[0]`. A team that keeps two (the season base
  and the January heavy base, which 0024's header anticipates) has no way to
  choose between them on this screen. The row supports it; the surface does not.

---

