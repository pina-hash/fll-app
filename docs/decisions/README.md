# docs/decisions/

**A question this repo cannot answer from inside itself, with the answer it is
proceeding on in the meantime.**

Not an architecture decision record. An ADR says what was decided and why; a
file here says what is UNDECIDED, what the code does anyway, and what would
settle it. The default is load bearing: something is already shipped on it.

## Why this exists as a directory

Three of these were raised in one chat on 2026-09-01, and every one of them
had the same shape: a question about the physical world (a printed mat, a
table's launch area) or about a rule nobody had stated (who may delete a
teammate's notebook page), which a session inside this repository cannot
resolve by reading anything in it. Left in a chat they are lost; left in
`CLAUDE.md` they read as rules; left in `docs/history/` they read as things
that happened. So they go here, open, until somebody looks at the mat or
makes the call.

**One file per decision, `NN-slug.md`.** Never one shared file: the same
reason `docs/HISTORY.md` was split, and the reason the prompt ledger is a
directory. Two sessions filing two decisions must not collide.

## The format

```
# NN <the question, as a question>
- Raised: <date> by <who or which chat>
- Status: open | decided | superseded
- Default: <what the code does today, in one sentence>
- Settles it: <the observation or the person who can answer>
```

Then the body: what depends on the answer, what the two answers would each
cost, and what is already shipped on the default.

## Statuses

- **open** -- the default stands and nobody has checked. This is not a bug
  and not a TODO: it is a stated assumption with its cost written down.
- **decided** -- somebody answered. The file stays, gains the answer, the
  date and who gave it, and names what changed in the code. It is not
  deleted, because the question a later session asks is "was this ever
  looked at", and a removed file answers that wrongly.
- **superseded** -- the question stopped applying (the feature went, the
  season changed). Say which, and when.

**A decision that turns into code cites this file from the code**, so the
next reader of that constant finds the reasoning rather than re-deriving it.
