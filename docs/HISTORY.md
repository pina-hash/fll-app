# fll-app engineering history -- moved to `docs/history/`

**This file is a pointer. The record lives in [`docs/history/`](history/), one
file per entry. Do not add an entry here.**

`CLAUDE.md` and older entries link to this path, so it stays. Nothing is
appended to it again, which is the point: a file nobody edits is a file that
never conflicts.

## Why it was split

Every bundle appended a new `##` section to the end of one 4,697-line file and
added a row to the migration index near its top. Two sessions working in
parallel therefore always wrote to the same handful of lines, so their branches
could never merge cleanly however unrelated the work was. `pina-hash/idea-app`
hit exactly this, four batches in a row, until GitHub refused to resolve the
file in the web editor at all; this repo split before paying that price, on
2026-09-02, with two branches already standing that both touch the record
(`claude/merge-branches-migration-script-0w3t1u` and
`claude/notebook-write-permissions-sbwtjq`, each carrying its own
`docs/HISTORY.md` block).

The fix is that **a new entry is a new file**, and a new file conflicts with
nothing. There is no shared append point left to contend for, and no index
line for two sessions to both rewrite. The migration index the old preamble
carried is GENERATED now (`npm run history:index`), inverted from each entry's
own `migrations:` list, which is also why it can no longer go stale the way the
committed table had: it stopped at 0016 while the chain stood at 0025.

## Writing an entry

One file, `docs/history/<slug>.md`, named after what the bundle did. Front
matter first, then the body, and the body does NOT repeat the title as a
heading: the heading is derived from `title` when the record is reassembled, so
a second copy is a second thing to keep in step.

```
---
title: "What the bundle did, in one sentence"
date: 2026-09-02
branches: [claude/your-branch-slug]
migrations: ["0026"]
subsystems: ["Mentor console"]
---

What changed, the load-bearing decisions and why, what was measured, what is
explicitly NOT verified, and what was deferred.
```

`record_order` belongs ONLY to the 27 files the split produced (`record-*.md`)
and pins their order in the pre-split file. A new entry never takes one:
`npm run history:verify` refuses a `record-` prefix without one, and refuses a
`record_order` on anything else.

## The tools

| Command | |
| --- | --- |
| `npm run history:verify` | Reassembles the 27 archive entries and proves the split still lossless, byte for byte, against the pre-split commit and against a pinned sha256. CI runs this. |
| `npm run history:index` | Prints the by-subsystem and by-migration indexes from front matter. Generated, never committed. |

`grep -r` over `docs/history/` is the primary way to find an entry; every
file's front matter carries its date, branches, migration numbers and
subsystems as plain text.
