# 03 Should a teammate be able to soft-delete a teammate's notebook page?
- Raised: 2026-09-01 by the chat "FLL app feature requests and improvements"
- Status: open
- Default: no. Narrow delete back to author-or-lead in an 0027, because a soft-delete by a nine-year-old is a support ticket.
- Settles it: a mentor saying which they want, ideally after one Friday with the widened write path in front of real students.

## What happened

Migration `0026` (on `claude/notebook-write-permissions-sbwtjq`, **unmerged as
of 2026-09-02**) opens the engineering notebook to the whole team: any member
may write a page, and recap confirmation stays with the lead. That is the
deliberate change and it is the right one -- a notebook one child owns is a
notebook one child writes.

**`notebook_entry_delete` calls the same gate.** It was not widened on
purpose; it shares `notebook_can_edit()` with the write path, so widening the
write widened the delete in the same stroke. The result is that any teammate
can now soft-delete any entry, including one they did not write.

## Why the default is to narrow it

`CLAUDE.md` (Soft delete) already says why a notebook entry is soft rather
than hard: **"it is a child's own paragraph."** The reasoning that makes the
delete recoverable is the same reasoning that says somebody else should not
be casually reaching for it. A soft delete is undoable, so nothing is lost --
but the undo runs through a mentor, on a Friday, during a session, which is
the definition of a support ticket.

Writing and deleting are also not symmetric in the way the widening assumed.
Two children writing on one notebook is collaboration. One child removing
another's paragraph is not, and no amount of "it is only soft" changes what
it feels like at that table.

## What narrowing costs

A page written under the wrong name, or written and abandoned, needs its
author or the lead to remove it. On a six-seat team that is one tap away from
somebody in the room. Against that: the widened form has no in-app way to
tell an accidental delete from a deliberate one, and the person who notices
is the author, later.

## What it would take

A `0027` giving the delete its own gate (author or lead) rather than sharing
`notebook_can_edit()`, plus the test asserting both directions: a teammate
refused, the author and the lead allowed. **It cannot be written until 0026
lands**, because the number after it is not this repo's to take while that
branch stands unmerged.

## Also open, and smaller

Whether the lead may delete at all, or only the author and a mentor. The
default above says the lead may, because the lead confirms recaps and is
already the notebook's editorial authority. That half is worth one sentence
from a mentor when the rest is decided.
