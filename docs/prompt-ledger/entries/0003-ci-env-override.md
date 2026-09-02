# 0003 Stop CI's placeholder env from overriding the local stack for the test step
- Issued: 2026-09-02
- By: claude.ai chat "FLL app work, 2026-09-02", CI fix lane
- Owns: `.github/workflows/ci.yml`
- Based on: claude/idea-standard-conformance-y51l0n (ci.yml does not exist on main)
- Migration permitted: no. Highest on origin/main at issue: 0025
- Status: pushed
- Branch: assigned by the harness; named in the session report
- Notes: The first CI run on the conformance branch went red on 30 of 48 test files,
  every one of them downstream of `signIn` in `tests/db/harness.ts`, with
  `fetch failed`. The stack itself booted, applied all 25 migrations, seeded, and
  passed `npm run check` with 0 errors. The cause is `ci.yml`'s workflow-level `env`
  block, which sets `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` for every
  step; `vitest.config.ts` loads `.env.test` through dotenv's `config()`, which does
  not override a variable already present in `process.env`. The suite therefore aimed
  at a hostname that does not resolve. The fix scopes the two placeholders to the
  step that needs them and guards the test step against a repeat. Deliberately
  excluded: `.env.test`, `vitest.config.ts`, `tests/**`, and the Node 20 action
  deprecation warnings.
