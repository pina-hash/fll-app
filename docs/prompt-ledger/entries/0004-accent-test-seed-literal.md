# 0004 Stop the accent race test from betting on a colour the seed allocates
- Issued: 2026-09-02
- By: claude.ai chat "FLL app work, 2026-09-02", accent test lane
- Owns: `tests/team-identity-accent.test.ts`
- Based on: claude/ci-env-override-q4t6sn
- Migration permitted: no. Highest on origin/main at issue: 0025
- Status: pushed
- Branch: assigned by the harness; named in the session report
- Notes: The one real failure in the first green-ish CI run. The case at "the RPC
  turns that 23505 into a sentence naming the winner" hard-codes `purple`, which
  `0025` hands to a seeded team, so its setup write is refused by
  `teams_accent_unique_live` and the assertion then measures the seed rather than
  the function. The positive control two cases above was already corrected for this
  exact cause and carries a comment naming `0025`; this is the case that fix
  missed. No migration and no function changes: the code under test is correct.
