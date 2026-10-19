# Build phases

Moved verbatim from `CLAUDE.md` (What this is) on 2026-10-19, so `CLAUDE.md` stays under 3,000 words. `CLAUDE.md` links here; keep this file current in the same change as anything it describes.

### Build phases

1. **This repo's foundation (done):** scaffold, schema (0001-0008), RLS, both auth paths, login screen, placeholder `/app` shell.
2. **Mentor console (done):** schema 0009, the live board, meeting and phase control, provisioning (teams, roster, PINs, roles, printable cards) and task creation.
3. **Student runtime (done):** schema 0010, check-in, My Screen, the Team tab, evidence capture, Team Board mode for the shared iPad, and the local-first write queue.
4. **Season tools (done):** schema 0011-0012 (the Skill Hub's mission table and the route planner) and 0013-0015 (the six-student cap, self-enrollment, the parent view, the match timer and run log).
5. **Seat codes and the operability sweep (done):** schema 0019 (per-student claim codes, replacing 0013's open join window whole) and 0020 (cancel/restore a meeting, reopen one ended by accident, reorder a phase, archive/restore a team, soft-delete and restore a notebook page, redraft a recap). Every entity a mentor or student can create is now create/edit/delete operable, destructive actions confirm by naming what goes with them, and the lists that pass a screen sort and filter.
