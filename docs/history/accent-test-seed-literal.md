---
title: "The accent race test stops betting on a colour the seed allocates (`claude/team-identity-accent-test-ulum55`, `tests/team-identity-accent.test.ts` only, no migration)"
date: 2026-09-02
branches: [claude/team-identity-accent-test-ulum55]
migrations: []
subsystems: ["Build, tests, conventions", "Team identity and accents"]
---

The first CI run that got far enough to measure anything came back 47 of 48
files green with one real assertion failure, and the failure was in the test,
not in the code it tests. This bundle changes one file. No SQL, nothing under
`src/`, no other file under `tests/`.

### WHAT THE RED CASE SAID

Run 3 on `4e40a0c`, `tests/team-identity-accent.test.ts`, at the case "the RPC
turns that 23505 into a sentence naming the winner":

    AssertionError: expected 'Team 2 took that colour a moment befo...'
    to contain 'Test mtjx28amdzfq AccentA'

The message the RPC produced is the correct message for the state the database
was actually in. `Team 2` really did hold that colour, and `team_confirm_accent`
really did name the holder. What was wrong was the state, and the state was set
up by the test.

### THE CAUSE, WHICH IS TWO DEFECTS STACKED

The case did this:

    await service.from('teams').update({ accent: null }).eq('id', teamB.teamId);
    await service.from('teams').update({ accent: 'purple' }).eq('id', teamA.teamId);

`0025_teams_default_accent.sql` hands out starting colours in a derived
farthest-point order, `lime, purple, teal, orange`, and `supabase/seed.sql`
repeats those four literally because the seed runs AFTER the migration chain and
0025 therefore applies to an empty `teams` table on a fresh stack. So on every
fresh chain `Team 2` holds `purple` before any test file runs, and
`teams_accent_unique_live` (a unique index on `teams (accent)` where
`archived_at is null and accent is not null`) refuses the second write above.

The second defect is what made the first one invisible. A PostgREST write
refused by a constraint does not throw: it comes back as `{ data: null, error }`
with SQLSTATE 23505, and the line above discards the whole result. `teamA` then
held no colour at all, `teamB` confirmed `purple`, the RPC looked up who really
held it, and the assertion three lines later measured the seed instead of the
function. The same rule CLAUDE.md already states about RLS-filtered writes ("no
error" is not "it landed") applies verbatim to a constraint-refused one, and a
setup write is exactly where ignoring it costs the most: the failure surfaces
somewhere else, wearing the costume of a product bug.

### WHY THIS ESCAPED THE FIX THAT WAS ALREADY MADE FOR IT

`f6063e3`, the bundle that shipped 0025, already hit this and already fixed it
once. It rewrote the positive control two cases above to look its colours up
rather than type them, and left a comment saying why:

    // THE TWO COLOURS ARE LOOKED UP, NOT TYPED. This case used to name teal
    // and lime, and 0025 broke it by giving the seeded teams a starting
    // colour ...

It also rewrote the seeded-teams case to assert the four new colours. It did not
touch the case fifteen lines below the comment it had just written, because that
case named `purple` and the two it had fixed named `teal` and `lime`. The fix
was made per-literal rather than per-pattern, so it caught the literals that
were already failing and missed the one that had not been reached yet.

### WHAT CHANGED

Three cases in `THE RACE` describe now ask the database which colours are free
instead of naming one, through two small helpers added beside `concurrentPick`:

  * `firstFreeColour()` runs the same `enum_range` / `not exists` query the
    positive control already runs, at `limit 1`.
  * `takeAFreeColour(teamId)` calls it, writes the colour, and CHECKS the write
    with `.select('id')`, so a refusal fails on the setup line by name rather
    than three lines later as a wrong winner.

  * "the RPC turns that 23505 into a sentence naming the winner": was `purple`,
    the one that was red. Now looked up and checked. This is the correction the
    bundle exists for, and the assertion is unchanged: the message must still
    name `teamA` and must still not leak the index name.
  * "an archived team releases its colour": was `bark`, and its setup write was
    discarded the same way. `bark` is sixth in 0025's hand-out order, so it is
    free today only because this club runs four teams.
  * "exactly one wins, and the loser is refused by the unique index": was
    `sage`, tenth in the same order. Its writes were already checked, by
    `concurrentPick`'s own "both see the colour as free" assertion, so only the
    literal moved.

The generated `Database['public']['Enums']['team_accent']` is now imported into
the file so the looked-up colour types as one of the eleven rather than as
`string`. That import is what keeps the palette out of the test file: naming the
eleven values in a union here would be the same defect in a different spelling.

### WHAT WAS DELIBERATELY LEFT

The literals in the `choosing` describe (`violet`, `orchid`, `sage`) and in the
last describe (`olive`) stay. Every one of them is in a case that checks the
error at the statement that performs the write, so a collision fails there, by
name, rather than downstream; and `violet` is threaded through four consecutive
cases as a narrative (proposed, confirmed, refused to the other team, listed by
`team_accent_options`), so looking it up would mean module-level state shared
across cases, which is a restructuring this bundle has no reason to do.

`teal` in "a student cannot use the mentor override" is seed-held and stays
anyway: `team_set_accent` checks `is_mentor()` before it looks at the colour, so
that case never reaches the constraint. `bark` in the `team_accent_options` case
stays because the assertion there is that a free colour reads as free; replacing
it with a looked-up free colour would make it assert itself.

### MEASURED, AND NOT MEASURED

`npm run check`: 726 files, 0 errors, 0 warnings, with CI's two placeholder
`PUBLIC_SUPABASE_*` values in the environment. Without them the same run reports
5 errors at three `$env/static/public` import sites, which is the condition
`ci.yml` documents at length and is not a change in this file.

`npm test -- --project pure`: 16 files, 343 tests, all passing.

NOT VERIFIED HERE, and said plainly rather than dressed up: this container has a
`docker` binary but no running daemon and no Supabase CLI, so the local stack
could not be booted and `tests/team-identity-accent.test.ts` itself was never
executed against a database in this session. The proof is the next CI run. What
CAN be derived without running it: a fresh chain gives `Team 1` lime, `Team 2`
purple, `Team 3` teal and `Team 4` orange, from 0025's hand-out order and
`seed.sql`'s copy of it; the enum's declaration order from 0018 is `bark,
orange, olive, lime, green, sage, teal, violet, purple, orchid, magenta`; so the
free pool at the corrected case is `bark, olive, green, sage, violet, orchid,
magenta` and `order by a.accent limit 1` returns `bark`. The corrected case ends
up using `bark` on a fresh chain, and would use whatever is free on a chain
where it is not.
