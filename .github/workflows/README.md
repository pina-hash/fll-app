# What runs here, and what it does to your branches

Three workflows. `ci.yml` checks a push; `integrate.yml` collects the branches
that passed onto `integration`; `deploy.yml` merges `integration` into `main`
when a person presses the button and types the sentence.

The shape is idea-app's (`pina-hash/idea-app`, `.github/workflows/`), and
`integrate.yml` is a byte-for-byte copy of that repo's file. Its header
comment therefore describes idea-app's migration path (hand application in
the SQL editor). **That sentence is not this repo's rule.** Here a migration
is applied by `supabase db push`, with its ledger row, or it is not applied;
see `CLAUDE.md`, Database conventions, and the confirmation `deploy.yml`
asks for.

## The short version

- **Session branches (`claude/**`) disappear on their own once
  `integrate.yml` is on `main`. That is correct, not a mistake.** When CI goes
  green on one, `integrate.yml` merges it into `integration` and deletes it.
  The commits are on `integration`; nothing is lost.
- **The branch to look at is `integration`.** It is long-lived, it always has
  the latest `main` merged into it, and it carries every finished bundle that
  has not been deployed yet.
- **`main` moves only through `deploy.yml`, pressed by a person.** No
  workflow pushes to `main` on its own; `integrate.yml` says at length why
  not.
- **A `claude/**` branch that is still sitting there is a signal, not a
  leftover.** It means one of: its CI failed, its CI has not run on its tip,
  or its merge into `integration` conflicted. All three want a person.

## Deploying

1. Apply every migration `integration` carries to the linked project:
   `supabase db push`, with the credential pinned per command as `CLAUDE.md`
   requires. Confirm from the schema, not the ledger, that the objects are
   there; then confirm the ledger row is there too.
2. Open **Actions**, pick **Deploy**, press **Run workflow**, and type
   `every migration on integration is applied to production`.
3. The job requires a green CI run at `integration`'s tip (it dispatches one
   and waits if there is none), merges `--no-ff` into `main`, and pushes.
   Vercel deploys from that push.

`integration` is not deleted or reset afterwards. It keeps going; the next
sweep merges `main` back into it, which after a deploy is a fast-forward.

## When something is stuck

Open the **Actions** tab and find the red **Integrate** run. Its job summary
names every branch and what happened to it: merged, conflicted, or left alone
with the reason (`CI on abc1234 is failure`, `already in integration`).

A conflict is two bundles genuinely touching the same file. Resolve it on the
branch, never on `integration`:

```
git fetch origin
git checkout claude/<the branch>
git merge origin/integration      # resolve, commit
git push origin claude/<the branch>
```

CI runs again, and the next green run picks it up. You can also press **Run
workflow** on Integrate to retry the sweep immediately.

While one branch conflicts, **every** Integrate run stays red, because it
re-reports the outstanding conflict each time. Other branches still merge
normally underneath that red X; the summary is what tells you which is which.

## What CI needs, and what it does not

`ci.yml` boots a real local Supabase stack on the runner (`supabase/setup-cli`
pinned to 2.115.0, then `supabase start`), applies the migration chain and
`seed.sql` exactly as the local stack does, and runs `npm run check`,
`npm test` and `npm run history:verify`. It needs no secret: the stack
answers on the runner's loopback with the demo keys `.env.test` carries, and
the hosted project is never contacted. The boot time is printed in the
"Start the local Supabase stack" step.

`integration` gets no CI run from a push (a push made with `GITHUB_TOKEN`
starts no workflow). The `nightly-integration` job in `ci.yml` dispatches a
run on that branch every day at 04:30 UTC, and **Run workflow** on CI with
the branch set to `integration` does the same on demand. Those runs are what
`deploy.yml` reads.

## Two properties worth knowing before they surprise you

- **A `claude/**` branch is merged as soon as CI is green on its tip.** There
  is no "done" flag. If a session pushes a work-in-progress commit and CI
  passes, that commit is integrated and the branch is deleted. Push when you
  are finished.
- **The four branches standing on 2026-09-02 are left alone by the first
  sweep.** Two (`planner-mat-dimensions-a5nt7m`,
  `robot-build-manual-access-513wpq`) are already contained in `main` and are
  skipped as "already in integration"; two
  (`merge-branches-migration-script-0w3t1u`,
  `notebook-write-permissions-sbwtjq`) have no CI run on their tip, because
  they were pushed before `ci.yml` existed, and are skipped as "CI is
  unknown". Pushing a commit to either of those two gives it a run.
