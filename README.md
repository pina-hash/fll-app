# fll-app

The season app for Bosco Tech's four FIRST LEGO League teams, BIOGLOW 2026-27:
mentors run Friday and Saturday sessions from a console, students work a team
board from tablets. Both sign-in paths, the mentor console and the student
runtime are built: the live board, meeting and phase control, provisioning,
task creation, and on the student side check-in, My Screen, the Team tab,
evidence capture, Team Board mode for a shared iPad, and a local-first write
queue that survives the room's wifi dropping.

`CLAUDE.md` is the operating document for working in this repo. This file is
the orientation.

## Stack

- SvelteKit 2 (Svelte 5, runes) + TypeScript, `@sveltejs/adapter-vercel`
- Supabase (Postgres 17, Auth, Realtime, Storage) through `@supabase/ssr`
- Supabase CLI for migrations (`supabase/migrations/NNNN_*.sql`) and the local stack
- Vitest, run against the real local stack

## Prerequisites

- Node 22+ and npm
- Supabase CLI 2.115+ and Docker (the local stack is Docker-based)
- A Supabase project with Google OAuth enabled and restricted to boscotech.edu

## Environment variables

Copy `.env.example` to `.env`. Every variable is documented there. For local
work the values are the ones `supabase status` prints; `.env.test` (committed)
carries the same local defaults for the test suite.

### Supabase auth setup

- Google provider enabled in the dashboard. The database trigger in
  `supabase/migrations/0002_mentors.sql` is what actually limits mentors to
  boscotech.edu; the provider restriction is a convenience.
- Redirect URLs: `http://localhost:5173/auth/callback` and
  `https://<your-domain>/auth/callback`.
- Email confirmations off (students have no deliverable address).

## Database

Migrations are sequentially numbered in `supabase/migrations/` and applied by
the CLI:

```bash
supabase start                 # local stack (applies the chain + seed.sql)
supabase db reset              # re-apply from scratch
supabase migration up          # apply pending files to the running local stack
supabase db push               # apply pending files to the linked project
```

`supabase/seed.sql` is local-only: a placeholder admin mentor
(`admin@boscotech.edu` / `mentor-local-password`), four teams with generated
join codes and their glow accents, and the Friday/Saturday phase templates.

## Local development

```bash
npm install
supabase start
node scripts/seed-local-session.mjs   # optional: gives the console something to show
npm run dev
```

`scripts/seed-local-session.mjs` drives the real RPCs as the seeded admin
mentor to create rosters on all four teams, role assignments with deliberate
gaps, a started Friday meeting, attendance, tasks and two open blockers. It is
idempotent and local-only.

Sign in as a student with one of the seeded team codes (`supabase status`
won't show them; `select name, join_code from public.teams;` will) after a
mentor has created a student through `student_create`.

## Tests

```bash
npx vitest run
```

The suite needs the local stack running. Files run serially against one
shared database; each file creates run-tagged rows and removes them.

## Other scripts

```bash
npx svelte-check               # type + a11y check (baseline: 0 errors, 0 warnings)
npm run build                  # production build
supabase gen types typescript --local > src/lib/supabase/database.types.ts
```

## The console

Sign in as a mentor and `/app` lands on the live board.

| Route | What it is |
| --- | --- |
| `/app/board` | The live board. Phone-first: four team cards over realtime, sorted by who needs you most. |
| `/app/board/[teamId]` | One team: blockers with a resolve action, roles today, check-in, tasks. |
| `/app/meeting` | Create a session from a phase template, start it, advance the phase, end it. |
| `/app/teams` | Provisioning, desktop-first master-detail: team settings, roster, PINs, roles. |
| `/app/teams/[teamId]/card` | The printable paper roster card. |
| `/app/tasks` | Create a task on one team or on all four at once. |
| `/dev/live-board` | Dev-only harness: the real live-board component with fixtures. 404s in a build. |

A PIN is bcrypt-hashed the moment it is set, so nothing can read one back. The
console shows a PIN once, when it is minted, and holds it in `sessionStorage`
for the printable card; the card also offers "reset every PIN on this team"
when the printed cards have gone stale.

## The student runtime

Sign in as a student and `/app` lands on their own screen. It is 375px-first
and the whole screen is their team's accent.

| Route | What it is |
| --- | --- |
| `/app/me` | Check in, the phase and countdown, their role (and whether they are covering), their role queue, and I'M STUCK. |
| `/app/me/team` | Read-only: who is here, who is in each seat today, what the team is working on. |
| `/board` | Team Board mode for a spare iPad. Team code plus a mentor-set PIN, once, then it stays up. |
| `/dev/student-screen` | Dev-only harness: the real student screen with fixtures. 404s in a build. |

Every student write goes through `src/lib/student/queue.svelte.ts`: it is
written to IndexedDB before it is attempted and stays there until the server
accepts it, so a dropped connection cannot lose a finished task or a captured
photo. The device mints each row's uuid, which is what makes a replay a no-op
rather than a duplicate. The screen says "No wifi" and how many writes are
waiting rather than pretending they landed.

A mentor turns a team board on from that team's page in the console and reads
the PIN out. The board is a device, not a person: it reads its team and closes
its team's tasks, and appears on no roster.

## Deployment

Vercel, from `main`: https://fll-app-tawny.vercel.app (project `fll-app`,
GitHub-connected, every push to `main` deploys). The Supabase project
(`ypusbfatsmoukvlfgrqf`) exists, is linked, and carries the whole migration
chain through 0009 plus the four teams and both phase templates. Whether
Vercel's `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` point at it has
not been checked from this repo; check them in the Vercel project settings
before expecting the deployed login screen to work.

## Project layout

```
src/
  app.css                      shell styles; imports the token layer
  app.d.ts                     App.Locals / App.PageData
  hooks.server.ts              per-request Supabase client, claims, principal, route guard
  lib/
    auth/student-identity.ts   join code / PIN / slug / synthetic address (mirrors 0004)
    auth/principal.ts          who a session is: mentor | student | nobody
    console/                   the mentor console's shared code
      types.ts                 board and role shapes, and their parsers
      clock.ts                 phase clock, formatting, the season timezone
      live.svelte.ts           the realtime feed and the debounced refetch
      LiveBoard.svelte         the live board, pure props (the harness mounts this)
      pins.ts                  PINs this tab has seen, for the roster card
    student/                   the student runtime's shared code
      queue.svelte.ts          the local-first write queue (IndexedDB)
      refresh.ts               a refetch that cannot blank the screen offline
      clock.svelte.ts          the server-corrected session clock
      types.ts                 student view shapes, and the covering projection
      StudentScreen.svelte     My Screen, pure props (the harness mounts this)
    design-system/             CSS custom-property tokens (colors, type, effects, motion, team accents)
    supabase/database.types.ts generated by `supabase gen types`
  routes/
    +layout.server.ts / +layout.ts / +layout.svelte   session plumbing
    login/                     team code -> name -> PIN, or Google for mentors
    auth/callback, auth/error, auth/signout
    app/                       the authenticated shell
    app/(mentor)/              board, meeting, teams, tasks: 403 for a student
    app/(student)/             me, me/team: 403 for anyone who is not a student
    board/                     Team Board mode for a shared iPad, outside /app
    dev/live-board/            dev-only harness, 404 in a build
    dev/student-screen/        dev-only harness, 404 in a build
supabase/
  config.toml                  local stack config
  migrations/0001..0010        the schema, in apply order
  seed.sql                     local development seed
tests/
  db/harness.ts                sql / asRole / signIn / seed helpers
  *.test.ts                    one concern per file
docs/HISTORY.md                per-bundle engineering record
```
