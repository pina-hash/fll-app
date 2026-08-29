#!/usr/bin/env bash
#
# scripts/land-migration.sh -- deliver ONE migration to the linked project and
# merge the branch that carries it, in one command, from Git Bash on Windows.
#
#   bash scripts/land-migration.sh 0026 claude/notebook-write-permissions-sbwtjq
#
# WHY THIS EXISTS: THE LEDGER WENT BEHIND THE SCHEMA THREE TIMES IN A ROW.
# 0019, 0020 and 0021 each reached the linked project by a path that writes
# DDL and no ledger row (a dashboard SQL editor, a direct execute), so
# `supabase_migrations.schema_migrations` stopped short of the real schema
# while the SQL itself was fully and correctly present. Each one was found by
# accident, bundles later, and repaired with `migration repair --status
# applied`. CLAUDE.md > Database conventions > Migrations carries the rule
# that came out of it: A MIGRATION IS DELIVERED BY RUNNING `supabase db push`,
# OR IT IS NOT DELIVERED. This script is that rule as a procedure, so the six
# steps a human used to run by hand cannot be run out of order, half way, or
# from memory at 10pm on a Thursday.
#
# THE GATE IN STEP 3 IS THE POINT OF THE WHOLE FILE. `db push` does not push
# the file you name; it pushes EVERY local migration the remote ledger does
# not have. So a hole below the target -- a file that is in the chain, is
# absent from the ledger, and whose objects are already live because somebody
# pasted it once -- means `db push` REPLAYS it. This script parses
# `migration list --linked` and refuses to go near `db push` while any such
# hole exists. Nothing after step 3 runs when it fires. `--self-test` proves
# the parser against captured output rather than asking you to trust it.
#
# ONE CREDENTIAL PATH, AND IT IS THE ONE THE REPO ALREADY HAS.
# Every CLI call goes through `scripts/wsl-supabase.sh`, which cds to the repo
# inside WSL and exports SUPABASE_ACCESS_TOKEN out of `.env`. This script
# never runs a bare `supabase`, never sets that variable in its own
# environment, and never reads a credential from anywhere `.env` is not. The
# one read that the CLI cannot perform (step 6, the catalog check) uses the
# SAME token, extracted with the wrapper's own expression, against the
# Management API address `tests/db/linked.ts` already uses -- read only, a
# select and nothing else. See CLAUDE.md: the forbidden thing is a path that
# WRITES SQL without writing the ledger row beside it.
#
# WHAT IT DOES NOT DO. It does not roll anything back. By the time the test
# suite runs in step 8 the SQL is live on the linked project and the merge is
# on `main`; reverting the merge would leave the schema ahead of the code,
# which is a worse state than a red suite you can read. A red suite is
# reported as a finding, loudly, and left for a human.

set -euo pipefail
# A glob that matches nothing expands to nothing rather than to itself, so
# "is there a file numbered NNNN" is answered by an empty array and not by a
# path with a literal asterisk in it.
shopt -s nullglob

# --- constants ---------------------------------------------------------------

WSL_DISTRO="Ubuntu"
WRAPPER_REL="scripts/wsl-supabase.sh"
MIGRATIONS_REL="supabase/migrations"
MGMT_HOST="https://api.supabase.com"

# --- small output helpers ----------------------------------------------------

RULE="========================================================================"

say()  { printf '%s\n' "$*"; }
step() { printf '\n%s\n== %s\n%s\n' "$RULE" "$*" "$RULE"; }
warn() { printf '\n!! %s\n' "$*"; }

# Every abort says the same three things: what failed, where that leaves the
# repo and the database, and the next command a human should run. A script
# that exits 1 with a bare message is how somebody ends up guessing whether
# the push landed.
abort() {
	local what="$1" state="$2" next="$3"
	printf '\n%s\n' "$RULE"
	printf 'STOPPED: %s\n' "$what"
	printf '%s\n\n' "$RULE"
	printf 'WHERE THINGS STAND\n%s\n\n' "$state"
	printf 'WHAT TO DO NEXT\n%s\n\n' "$next"
	exit 1
}

trim() {
	local s="$1"
	s="${s#"${s%%[![:space:]]*}"}"
	s="${s%"${s##*[![:space:]]}"}"
	printf '%s' "$s"
}

# Zero pad a version so a 4-digit chain and a 14-digit timestamp chain both
# compare correctly as strings. This repo is 4-digit; the padding is what
# stops that from being an assumption.
padver() { printf '%014d' "$((10#$1))"; }

# --- the parser, which is the gate -------------------------------------------
#
# `supabase migration list --linked` prints a three column table: LOCAL,
# REMOTE, TIME. A file present locally and absent from the remote ledger has
# an EMPTY remote cell. The CLI has drawn that table with box characters in
# some versions and ASCII pipes in others, with and without a leading pipe, so
# this normalises before it reads. It deliberately uses nothing but bash
# builtins: Git for Windows does not reliably ship awk.
#
# Reads the list output on stdin, takes the target version, and writes one
# classification per line:
#
#   below-unapplied <version>   a hole UNDER the target. This aborts the run.
#   above-unapplied <version>   pending above the target. Warned about, since
#                               `db push` will carry it along.
#   target-unapplied            the normal case: the target is what we push.
#   target-applied              already on the remote ledger; nothing to push.
#   target-missing              the target is not in the list at all.
classify_migration_list() {
	local target="$1"
	local target_padded seen_target=0
	target_padded="$(padver "$target")"

	local raw line probe c1 c2 local_v remote_v local_padded
	while IFS= read -r raw || [ -n "$raw" ]; do
		line="${raw//$'\r'/}"
		line="${line//│/|}"
		[ "${line#*|}" != "$line" ] || continue
		case "$line" in *LOCAL*) continue ;; esac

		# A rule line is only dashes, box dashes, crosses, pipes and spaces.
		probe="${line//|/}"; probe="${probe//-/}"; probe="${probe//─/}"
		probe="${probe//┼/}"; probe="${probe//+/}"; probe="${probe// /}"
		[ -n "$probe" ] || continue

		# Some CLI versions bracket the row in pipes; drop one of each.
		line="${line#|}"; line="${line%|}"

		IFS='|' read -r c1 c2 _ <<< "$line"
		local_v="$(trim "${c1:-}")"
		remote_v="$(trim "${c2:-}")"

		case "$local_v" in
			''|*[!0-9]*) continue ;;
		esac
		[ "${#local_v}" -ge 4 ] || continue

		local_padded="$(padver "$local_v")"

		if [ "$local_padded" = "$target_padded" ]; then
			seen_target=1
			if [ -n "$remote_v" ]; then say "target-applied"; else say "target-unapplied"; fi
			continue
		fi

		[ -n "$remote_v" ] && continue

		if [[ "$local_padded" < "$target_padded" ]]; then
			say "below-unapplied $local_v"
		else
			say "above-unapplied $local_v"
		fi
	done

	[ "$seen_target" -eq 1 ] || say "target-missing"
}

# --- self test ---------------------------------------------------------------
#
# THE GATE IS PROVED, NOT ASSERTED. Three captured shapes of the CLI's own
# output: a clean chain, a chain with a hole under the target (the 0019 / 0020
# / 0021 failure, which is the case this whole script exists for), and the
# ASCII-pipe rendering with pending files above the target. If any of these
# stops classifying correctly the script refuses to be trusted.
self_test() {
	local fails=0

	check() {
		local name="$1" expected="$2" actual="$3"
		if [ "$actual" = "$expected" ]; then
			say "  ok    $name"
		else
			fails=$((fails + 1))
			say "  FAIL  $name"
			say "        expected: $(printf '%s' "$expected" | tr '\n' ';')"
			say "        actual:   $(printf '%s' "$actual" | tr '\n' ';')"
		fi
	}

	step "Self test: the step 3 parser against captured migration list output"

	local clean hole ascii out

	# Box-drawing rendering, every file below the target on the remote ledger.
	clean="$(cat <<'FIXTURE'
Connecting to remote database...

        LOCAL      │     REMOTE     │     TIME (UTC)
  ─────────────────┼────────────────┼──────────────────────
    0023           │ 0023           │ 2026-08-14 03:11:02
    0024           │ 0024           │ 2026-08-20 17:44:51
    0025           │ 0025           │ 2026-08-27 01:09:38
    0026           │                │ 2026-08-29 06:22:10
FIXTURE
)"
	out="$(printf '%s\n' "$clean" | classify_migration_list 0026)"
	check "clean chain, target pending" "target-unapplied" "$out"

	# THE FAILURE THIS SCRIPT EXISTS FOR: 0024 is in the chain and absent from
	# the remote ledger, so `db push` would replay it on the way to 0026.
	hole="$(cat <<'FIXTURE'
Connecting to remote database...

        LOCAL      │     REMOTE     │     TIME (UTC)
  ─────────────────┼────────────────┼──────────────────────
    0022           │ 0022           │ 2026-08-11 22:05:14
    0023           │ 0023           │ 2026-08-14 03:11:02
    0024           │                │ 2026-08-20 17:44:51
    0025           │ 0025           │ 2026-08-27 01:09:38
    0026           │                │ 2026-08-29 06:22:10
FIXTURE
)"
	out="$(printf '%s\n' "$hole" | classify_migration_list 0026)"
	check "hole below the target is caught" \
		"$(printf 'below-unapplied 0024\ntarget-unapplied')" "$out"

	# ASCII pipes, bracketed rows, a file pending ABOVE the target, and the
	# target already carrying a remote version.
	ascii="$(cat <<'FIXTURE'
Connecting to remote database...

|      LOCAL     |     REMOTE     |     TIME (UTC)      |
|----------------|----------------|---------------------|
|   0025         |   0025         | 2026-08-27 01:09:38 |
|   0026         |   0026         | 2026-08-29 06:22:10 |
|   0027         |                | 2026-08-30 11:00:00 |
FIXTURE
)"
	out="$(printf '%s\n' "$ascii" | classify_migration_list 0026)"
	check "ascii table, target applied, pending above" \
		"$(printf 'target-applied\nabove-unapplied 0027')" "$out"

	out="$(printf '%s\n' "$ascii" | classify_migration_list 0030)"
	check "target absent from the list" \
		"$(printf 'below-unapplied 0027\ntarget-missing')" "$out"

	say ""
	if [ "$fails" -ne 0 ]; then
		abort "$fails self test case(s) failed." \
			"Nothing was touched. The parser in step 3 is the gate that keeps
\`db push\` from replaying a migration whose SQL is already live, and it is
not behaving as captured." \
			"Fix classify_migration_list in this file and run
  bash scripts/land-migration.sh --self-test
until it is green. Do not land a migration with a broken gate."
	fi
	say "Self test passed. The step 3 gate classifies all four captured shapes."
}

# --- argument handling -------------------------------------------------------

usage() {
	cat <<'USAGE'
Land one migration on the linked project and merge the branch carrying it.

  bash scripts/land-migration.sh <migration-number> <branch>
  bash scripts/land-migration.sh --self-test

  <migration-number>  the version as the CLI names it, e.g. 0026
  <branch>            the branch carrying the migration, e.g.
                      claude/notebook-write-permissions-sbwtjq

Run it from Git Bash, from the repo root, on the machine that holds .env.
USAGE
}

case "${1:-}" in
	--self-test) self_test; exit 0 ;;
	-h|--help) usage; exit 0 ;;
	'') usage; exit 1 ;;
esac

VERSION="$1"
BRANCH="${2:-}"

case "$VERSION" in
	''|*[!0-9]*) abort "\"$VERSION\" is not a migration version." \
		"Nothing was touched." \
		"Pass the version the way the CLI names it, four digits:
  bash scripts/land-migration.sh 0026 <branch>" ;;
esac
[ -n "$BRANCH" ] || abort "No branch given." "Nothing was touched." \
	"$(usage)"

# --- step 0: the checkout, the wrapper, and a WSL session that stays up -------

step "Step 0 of 9: where am I, and can I reach the wrapper"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$REPO_ROOT" ] || abort "Not inside a git repository." \
	"Nothing was touched." \
	"cd to the repo (C:\\fll-app-sk) and run this again."
cd "$REPO_ROOT"

WRAPPER="$REPO_ROOT/$WRAPPER_REL"
[ -f "$WRAPPER" ] || abort "$WRAPPER_REL is missing." \
	"Nothing was touched. Every Supabase call in this script goes through that
wrapper, because it is what pins this repo's own access token; there is no
fallback and there must not be one." \
	"Restore scripts/wsl-supabase.sh from git and run this again."

# The wrapper hardcodes the directory it cds to inside WSL. If this checkout is
# not that directory the wrapper would push a DIFFERENT tree's migrations while
# this script reports on ours, which is the wrong-target failure the credential
# rule exists to prevent, wearing a different hat.
WRAPPER_CD="$(sed -n 's/^cd \(.*\)$/\1/p' "$WRAPPER" | head -1)"
THIS_WSL_PATH="$(printf '%s' "$REPO_ROOT" | sed 's|^/\([A-Za-z]\)/|/mnt/\1/|')"
if [ -n "$WRAPPER_CD" ] && [ "$WRAPPER_CD" != "$THIS_WSL_PATH" ]; then
	abort "This checkout is not the one the wrapper operates on." \
		"Nothing was touched.
  this checkout, as WSL sees it : $THIS_WSL_PATH
  scripts/wsl-supabase.sh cds to: $WRAPPER_CD
Running on would push one tree's migrations and report on another's." \
		"Run this from $WRAPPER_CD, or correct the cd line in
scripts/wsl-supabase.sh if the repo has genuinely moved."
fi
WRAPPER_WSL="$THIS_WSL_PATH/$WRAPPER_REL"
say "repo (Windows) : $REPO_ROOT"
say "repo (WSL)     : $THIS_WSL_PATH"

# CLAUDE.md: WSL shuts the VM down when no session is open, which kills the
# containers mid-run. `db reset` in step 8 is exactly that scenario, so hold a
# session open for the length of this script and drop it on the way out.
KEEPALIVE_PID=""
cleanup() {
	if [ -n "$KEEPALIVE_PID" ]; then
		kill "$KEEPALIVE_PID" 2>/dev/null || true
	fi
	rm -f "${TMP_LIST:-}" "${TMP_NODE:-}" 2>/dev/null || true
}
trap cleanup EXIT

MSYS_NO_PATHCONV=1 wsl.exe -d "$WSL_DISTRO" -- sleep infinity >/dev/null 2>&1 &
KEEPALIVE_PID=$!
say "WSL keepalive  : pid $KEEPALIVE_PID (so the containers survive db reset)"

# Every Supabase call in this script. No other form is allowed to exist here.
supa() {
	MSYS_NO_PATHCONV=1 wsl.exe -d "$WSL_DISTRO" -- bash "$WRAPPER_WSL" "$@"
}

MIGRATION_CANDIDATES=( "$MIGRATIONS_REL/${VERSION}"_*.sql )
MIGRATION_FILE="${MIGRATION_CANDIDATES[0]:-}"
[ -n "$MIGRATION_FILE" ] || abort "No migration file numbered $VERSION." \
	"Nothing was touched. $MIGRATIONS_REL holds:
$(printf '%s\n' "$MIGRATIONS_REL"/*.sql | sed 's/^/  /')" \
	"Check the number. It is the four digit prefix on the filename."
say "migration      : $MIGRATION_FILE"

self_test

# --- step 1: refuse a dirty tree, refuse an absent branch --------------------

step "Step 1 of 9: the working tree and the branch"

if [ -n "$(git status --porcelain)" ]; then
	abort "The working tree is dirty." \
		"Nothing was touched. Uncommitted work would be carried through two
merges and a db reset by this script, and a reset rebuilds the local stack
from the chain alone." \
		"Commit or stash, then run this again:
$(git status --short | sed 's/^/  /')"
fi

git fetch origin --prune

if ! git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
	abort "origin has no branch named $BRANCH." \
		"Nothing was touched. Local branches on this machine are not what this
script merges; it merges what is on the remote." \
		"Push the branch first, or check the name against:
$(git ls-remote --heads origin | sed 's|.*refs/heads/|  |')"
fi
say "branch on origin: $BRANCH"

if ! git cat-file -e "origin/$BRANCH:$MIGRATION_FILE" 2>/dev/null; then
	warn "$MIGRATION_FILE is not on origin/$BRANCH."
	say  "That is not fatal (the file may already be on main), but it is worth"
	say  "knowing before you confirm the push."
fi

# --- the shared merge, and the one file where a conflict is mechanical -------
#
# docs/HISTORY.md is append-at-the-end by construction: every bundle adds its
# record to the bottom. Two bundles in flight therefore conflict there and
# nowhere else, and the resolution is always the same one -- keep both, in
# bundle order. `git merge-file --union` is exactly that, applied to the three
# stages git already has. ANY OTHER CONFLICTED PATH STOPS THE SCRIPT: these
# branches are supposed to touch disjoint code, so a second conflicted file is
# a signal that something is wrong rather than something to resolve.
#
# The one cost, measured in a sandbox merge: a union merge concatenates the two
# hunks verbatim, so the blank line that separated the last entry from the next
# heading is dropped and the two headings end up adjacent. Both entries are
# present and in bundle order; only the spacing wants a human eye afterwards.
merge_into_current() {
	local from="$1" msg="$2"
	if git merge --no-ff -m "$msg" "$from"; then
		return 0
	fi

	local conflicted
	conflicted="$(git diff --name-only --diff-filter=U)"
	if [ "$conflicted" != "docs/HISTORY.md" ]; then
		local head_now; head_now="$(git rev-parse --abbrev-ref HEAD)"
		git merge --abort || true
		abort "Merging $from into $head_now conflicted outside docs/HISTORY.md." \
			"The merge was ABORTED and the tree is back where it was. Nothing has
reached the linked project. Conflicting paths:
$(printf '%s' "$conflicted" | sed 's/^/  /')" \
			"Resolve those by hand on a branch, push, and run this script again.
docs/HISTORY.md is the only file this script resolves for you."
	fi

	say "docs/HISTORY.md conflicted. Resolving by keeping both sides in bundle order."
	git show :1:docs/HISTORY.md > "$REPO_ROOT/.history.base"  2>/dev/null || : > "$REPO_ROOT/.history.base"
	git show :2:docs/HISTORY.md > "$REPO_ROOT/.history.ours"
	git show :3:docs/HISTORY.md > "$REPO_ROOT/.history.theirs"
	git merge-file --union -p \
		"$REPO_ROOT/.history.ours" "$REPO_ROOT/.history.base" "$REPO_ROOT/.history.theirs" \
		> docs/HISTORY.md
	rm -f "$REPO_ROOT/.history.base" "$REPO_ROOT/.history.ours" "$REPO_ROOT/.history.theirs"
	git add docs/HISTORY.md

	if [ -n "$(git diff --name-only --diff-filter=U)" ]; then
		abort "docs/HISTORY.md resolved but conflicts remain." \
			"The merge is IN PROGRESS and the tree is half resolved. Nothing has
reached the linked project." \
			"Finish the merge by hand (git status), or 'git merge --abort'."
	fi
	git commit --no-edit
	say "docs/HISTORY.md resolved: both bundles kept, in order."
}

# --- step 2: bring main into the branch --------------------------------------

step "Step 2 of 9: check out $BRANCH and merge main into it"

git checkout -B "$BRANCH" "origin/$BRANCH"
merge_into_current "origin/main" "Merge branch 'main' into $BRANCH"
say "branch head: $(git rev-parse --short HEAD)"

# --- step 3: THE GATE --------------------------------------------------------

step "Step 3 of 9: what does the remote ledger actually have"

TMP_LIST="$(mktemp)"
say "Running: supabase migration list --linked (through scripts/wsl-supabase.sh)"
if ! supa migration list --linked > "$TMP_LIST" 2>&1; then
	abort "\`supabase migration list --linked\` failed." \
		"main has NOT been merged anywhere and NOTHING has reached the linked
project. $BRANCH now carries a merge of main, which is harmless and unpushed.
The CLI said:
$(sed 's/^/  /' "$TMP_LIST")" \
		"Fix the CLI's reach and run this again. Check in order:
  1. WSL is up:   wsl.exe -d $WSL_DISTRO -- echo ok
  2. .env holds SUPABASE_ACCESS_TOKEN for THIS repo's account
  3. the link:    MSYS_NO_PATHCONV=1 wsl.exe -d $WSL_DISTRO -- bash $WRAPPER_WSL projects list"
fi
sed 's/^/  /' "$TMP_LIST"

CLASSIFIED="$(classify_migration_list "$VERSION" < "$TMP_LIST")"
BELOW="$(printf '%s\n' "$CLASSIFIED" | sed -n 's/^below-unapplied //p')"
ABOVE="$(printf '%s\n' "$CLASSIFIED" | sed -n 's/^above-unapplied //p')"
TARGET_STATE="$(printf '%s\n' "$CLASSIFIED" | grep '^target-' | head -1)"

if [ -n "$BELOW" ]; then
	NAMED=""
	while IFS= read -r v; do
		[ -n "$v" ] || continue
		hit=( "$MIGRATIONS_REL/${v}"_*.sql )
		NAMED="$NAMED
  $v  ${hit[0]:-<no local file with this number>}"
	done <<< "$BELOW"

	abort "A MIGRATION BELOW $VERSION IS MISSING FROM THE REMOTE LEDGER." \
		"NOTHING has been pushed and NOTHING has been merged into main.
$BRANCH carries a merge of main and is unpushed; that is the only change.

These files are in the chain and absent from supabase_migrations on the
linked project:$NAMED

\`supabase db push\` does not push the file you name. It pushes EVERY local
migration the remote ledger is missing, oldest first. So running it now would
REPLAY the files above. If their SQL is already live on that database -- which
is exactly what happened to 0019, 0020 and 0021, each applied by a path that
writes no ledger row -- the replay either fails half way or succeeds and
rewrites objects nobody meant to touch today." \
		"Work out, FROM THE SCHEMA and not from the ledger, whether each file
above is genuinely absent or merely unrecorded:

  * genuinely absent  -> it is a real pending migration. Land it first, with
                         this same script, before you come back to $VERSION.
  * present but not
    recorded          -> the ledger is behind the database. Confirm the file's
                         objects, in-place rewrites AND grants match the schema,
                         then write the ledger row and no DDL:
                           MSYS_NO_PATHCONV=1 wsl.exe -d $WSL_DISTRO -- bash \\
                             $WRAPPER_WSL migration repair --status applied <version>

Then run this script again. Do not reach for the dashboard SQL editor."
fi

if [ -n "$ABOVE" ]; then
	warn "Pending migrations ABOVE $VERSION. \`db push\` carries these too:"
	printf '%s\n' "$ABOVE" | sed 's/^/    /'
	say  "They are listed again in the confirmation below. Read it."
fi

case "$TARGET_STATE" in
	target-unapplied)
		say ""
		say "Gate passed: every migration below $VERSION is on the remote ledger,"
		say "and $VERSION is pending. That is exactly the state db push wants."
		DO_PUSH=1
		;;
	target-applied)
		say ""
		warn "$VERSION is ALREADY on the remote ledger."
		say  "Nothing to push. This script will skip step 5 and go straight to"
		say  "verifying the schema, then the merge. That is the right thing after"
		say  "a run that pushed and then failed later on."
		DO_PUSH=0
		;;
	*)
		abort "$VERSION does not appear in \`migration list --linked\` at all." \
			"NOTHING has been pushed or merged. $BRANCH carries a merge of main
and is unpushed.
The CLI listed no row for $VERSION, although $MIGRATION_FILE exists in this
checkout. That usually means the CLI is reading a different directory than
this script is." \
			"Check that scripts/wsl-supabase.sh cds to this checkout, and that
$MIGRATION_FILE is committed on $BRANCH."
		;;
esac

# --- step 4: read the SQL, then type the word --------------------------------

step "Step 4 of 9: the SQL that is about to reach production"

say "--- $MIGRATION_FILE ---"
cat "$MIGRATION_FILE"
say "--- end of $MIGRATION_FILE ---"
say ""
say "This will run against the LINKED (production) project."
if [ -n "$ABOVE" ]; then
	say "It will ALSO push these, which the remote ledger is missing:"
	printf '%s\n' "$ABOVE" | sed 's/^/    /'
fi
if [ "$DO_PUSH" -eq 0 ]; then
	say "(Nothing will be pushed: $VERSION is already applied. Confirming here"
	say " continues to the schema check and the merge.)"
fi
say ""
printf 'Type exactly "apply %s" to continue, anything else to stop: ' "$VERSION"

CONFIRM=""
if [ -r /dev/tty ]; then
	IFS= read -r CONFIRM < /dev/tty || true
else
	IFS= read -r CONFIRM || true
fi

if [ "$(trim "$CONFIRM")" != "apply $VERSION" ]; then
	abort "Not confirmed." \
		"NOTHING was pushed and NOTHING was merged into main. $BRANCH carries a
merge of main and is unpushed; you can throw that away with
  git checkout main && git branch -D $BRANCH" \
		"Run the script again when you have read the SQL, and type the words
exactly:  apply $VERSION"
fi

# --- step 5: the push --------------------------------------------------------

step "Step 5 of 9: supabase db push"

if [ "$DO_PUSH" -eq 1 ]; then
	if ! supa db push; then
		abort "\`supabase db push\` failed." \
			"The linked project may be PARTIALLY changed: db push applies one file
at a time and stops at the first failure. NOTHING has been merged into main.
$BRANCH carries a merge of main and is unpushed." \
			"Read the CLI output above, then find out what actually landed:
  MSYS_NO_PATHCONV=1 wsl.exe -d $WSL_DISTRO -- bash $WRAPPER_WSL migration list --linked
Fix the SQL in a NEW migration if the file is now half applied -- never by
rewriting $MIGRATION_FILE, which is an applied record the moment any part of
it lands. Do not paste the remainder into the dashboard."
	fi
	say "db push reported success. That is the CLI's claim; step 6 checks the schema."
else
	say "Skipped: $VERSION was already on the remote ledger."
fi

# --- step 6: verify from the SCHEMA ------------------------------------------
#
# NOT from the push output, and NOT from the ledger. The three ledger
# incidents were all cases where one of those two agreed with itself and
# disagreed with the database. The objects checked here are read out of the
# migration file, so this step is not specific to any one migration: what the
# file says it creates is what gets looked for.

step "Step 6 of 9: does the schema actually hold what $VERSION creates"

# Read the DDL out of the file. Dollar quoted bodies are skipped, so a
# `create` inside a function body or a do block is not mistaken for an object
# this migration creates.
extract_objects() {
	local file="$1"
	local in_dollar=0 line lower rest name tbl pending_trigger=""
	while IFS= read -r line || [ -n "$line" ]; do
		line="${line//$'\r'/}"
		lower="$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')"

		local count="${lower//[^\$]/}"
		local dollars=$(( ${#count} / 2 ))
		local was_in="$in_dollar"
		if [ $(( dollars % 2 )) -eq 1 ]; then
			in_dollar=$(( 1 - in_dollar ))
		fi
		[ "$was_in" -eq 1 ] && continue

		lower="${lower%%--*}"

		if [ -n "$pending_trigger" ]; then
			tbl="$(printf '%s' "$lower" | sed -n 's/.*[[:space:]]on[[:space:]]\+\(public\.\)\?\([a-z0-9_]\+\).*/\2/p')"
			if [ -n "$tbl" ]; then
				say "trigger|$pending_trigger|$tbl"
				pending_trigger=""
			fi
			continue
		fi

		name="$(printf '%s' "$lower" | sed -n 's/^[[:space:]]*create[[:space:]]\+\(or[[:space:]]\+replace[[:space:]]\+\)\?function[[:space:]]\+\(public\.\)\?\([a-z0-9_]\+\).*/\3/p')"
		[ -n "$name" ] && { say "function|$name|"; continue; }

		name="$(printf '%s' "$lower" | sed -n 's/^[[:space:]]*create[[:space:]]\+\(or[[:space:]]\+replace[[:space:]]\+\)\?trigger[[:space:]]\+\([a-z0-9_]\+\).*/\2/p')"
		if [ -n "$name" ]; then
			tbl="$(printf '%s' "$lower" | sed -n 's/.*[[:space:]]on[[:space:]]\+\(public\.\)\?\([a-z0-9_]\+\).*/\2/p')"
			if [ -n "$tbl" ]; then say "trigger|$name|$tbl"; else pending_trigger="$name"; fi
			continue
		fi

		name="$(printf '%s' "$lower" | sed -n 's/^[[:space:]]*create[[:space:]]\+table[[:space:]]\+\(if[[:space:]]\+not[[:space:]]\+exists[[:space:]]\+\)\?\(public\.\)\?\([a-z0-9_]\+\).*/\3/p')"
		[ -n "$name" ] && { say "table|$name|"; continue; }

		name="$(printf '%s' "$lower" | sed -n 's/^[[:space:]]*create[[:space:]]\+\(unique[[:space:]]\+\)\?index[[:space:]]\+\(concurrently[[:space:]]\+\)\?\(if[[:space:]]\+not[[:space:]]\+exists[[:space:]]\+\)\?\([a-z0-9_]\+\).*/\4/p')"
		[ -n "$name" ] && { say "index|$name|"; continue; }

		name="$(printf '%s' "$lower" | sed -n 's/^[[:space:]]*create[[:space:]]\+type[[:space:]]\+\(public\.\)\?\([a-z0-9_]\+\).*/\2/p')"
		[ -n "$name" ] && { say "type|$name|"; continue; }

		name="$(printf '%s' "$line" | sed -n 's/^[[:space:]]*[Cc][Rr][Ee][Aa][Tt][Ee][[:space:]]\+[Pp][Oo][Ll][Ii][Cc][Yy][[:space:]]\+"\([^"]\+\)".*/\1/p')"
		if [ -n "$name" ]; then
			tbl="$(printf '%s' "$lower" | sed -n 's/.*[[:space:]]on[[:space:]]\+\(public\.\)\?\([a-z0-9_]\+\).*/\2/p')"
			say "policy|$name|$tbl"
			continue
		fi
	done < "$file"
}

OBJECTS="$(extract_objects "$MIGRATION_FILE" | sort -u)"

if [ -z "$OBJECTS" ]; then
	warn "No created objects found in $MIGRATION_FILE."
	say  "That is legitimate for a migration that only alters, grants or seeds."
	say  "There is nothing for step 6 to look up; check it by hand."
else
	say "Objects $VERSION says it creates:"
	printf '%s\n' "$OBJECTS" | sed 's/|/  /g; s/^/  /'
fi

# The read path. THE SAME TOKEN THE WRAPPER PINS, extracted with the wrapper's
# own expression, against the address tests/db/linked.ts uses. Read only.
PROJECT_REF=""
if [ -f supabase/.temp/project-ref ]; then
	PROJECT_REF="$(trim "$(cat supabase/.temp/project-ref)")"
fi
if [ -z "$PROJECT_REF" ] && [ -f supabase/.temp/linked-project.json ]; then
	PROJECT_REF="$(sed -n 's/.*"ref"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' supabase/.temp/linked-project.json | head -1)"
fi

CATALOG_SQL=""
if [ -n "$OBJECTS" ]; then
	FN_LIST=""; TG_LIST=""; TB_LIST=""; IX_LIST=""; TY_LIST=""; PO_LIST=""
	while IFS='|' read -r kind name _; do
		[ -n "$name" ] || continue
		case "$kind" in
			function) FN_LIST="$FN_LIST,'$name'" ;;
			trigger)  TG_LIST="$TG_LIST,'$name'" ;;
			table)    TB_LIST="$TB_LIST,'$name'" ;;
			index)    IX_LIST="$IX_LIST,'$name'" ;;
			type)     TY_LIST="$TY_LIST,'$name'" ;;
			policy)   PO_LIST="$PO_LIST,'$name'" ;;
		esac
	done <<< "$OBJECTS"

	parts=""
	add_part() { parts="${parts:+$parts
union all
}$1"; }
	[ -n "$FN_LIST" ] && add_part "select 'function' as kind, p.proname as name, pg_get_function_identity_arguments(p.oid) as detail
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (${FN_LIST#,})"
	[ -n "$TG_LIST" ] && add_part "select 'trigger', t.tgname, c.relname
from pg_trigger t join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and n.nspname = 'public' and t.tgname in (${TG_LIST#,})"
	[ -n "$TB_LIST" ] && add_part "select 'table', c.relname, c.relkind::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (${TB_LIST#,})"
	[ -n "$IX_LIST" ] && add_part "select 'index', indexname, tablename
from pg_indexes where schemaname = 'public' and indexname in (${IX_LIST#,})"
	[ -n "$TY_LIST" ] && add_part "select 'type', t.typname, t.typtype::text
from pg_type t join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public' and t.typname in (${TY_LIST#,})"
	[ -n "$PO_LIST" ] && add_part "select 'policy', policyname, tablename
from pg_policies where schemaname = 'public' and policyname in (${PO_LIST#,})"

	CATALOG_SQL="$parts
order by 1, 2;"
fi

catalog_fallback() {
	local why="$1"
	warn "COULD NOT READ THE SCHEMA: $why"
	say  "This step is NOT a pass. The push may well have landed; this script"
	say  "simply did not confirm it from the catalog, which is the only"
	say  "confirmation that counts."
	if [ -n "$CATALOG_SQL" ]; then
		say  ""
		say  "Paste this into the SQL editor for the linked project and read the"
		say  "rows yourself. It is a SELECT: it writes nothing."
		say  ""
		printf '%s\n' "$CATALOG_SQL" | sed 's/^/    /'
		say  ""
	fi
	say  "Then come back and run this script again; step 3 will see $VERSION as"
	say  "applied and skip the push."
}

CATALOG_OK=0
if [ -z "$CATALOG_SQL" ]; then
	say "Nothing to look up."
	CATALOG_OK=1
elif [ -z "$PROJECT_REF" ]; then
	catalog_fallback "no linked project ref in supabase/.temp/. Run 'supabase link' through the wrapper."
elif ! command -v node >/dev/null 2>&1; then
	catalog_fallback "node is not on PATH, and the catalog read is a node fetch."
else
	FLL_TOKEN="$(grep '^SUPABASE_ACCESS_TOKEN=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r\n"' || true)"
	if [ -z "$FLL_TOKEN" ]; then
		catalog_fallback ".env holds no SUPABASE_ACCESS_TOKEN. That file is this repo's answer to 'which account is this' and is gitignored, so a fresh checkout will not have it."
	else
		TMP_NODE="$(mktemp).mjs"
		cat > "$TMP_NODE" <<'NODE_EOF'
const ref = process.env.FLL_PROJECT_REF;
const token = process.env.FLL_MGMT_TOKEN;
const query = process.env.FLL_QUERY;
const host = process.env.FLL_MGMT_HOST;

const res = await fetch(`${host}/v1/projects/${ref}/database/query`, {
	method: 'POST',
	headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
	body: JSON.stringify({ query })
});
const text = await res.text();
if (!res.ok) {
	process.stderr.write(`HTTP ${res.status}: ${text.slice(0, 400)}\n`);
	process.exit(3);
}
let rows;
try {
	rows = JSON.parse(text);
} catch {
	process.stderr.write(`non-JSON answer: ${text.slice(0, 400)}\n`);
	process.exit(3);
}
// The API answers a failed statement with an object carrying `message`
// rather than an HTTP error, which would otherwise read as zero rows.
if (!Array.isArray(rows)) {
	process.stderr.write(`query failed: ${text.slice(0, 400)}\n`);
	process.exit(3);
}
if (rows.length === 0) {
	process.stdout.write('(no rows)\n');
	process.exit(0);
}
const cols = Object.keys(rows[0]);
const width = (c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length));
const widths = Object.fromEntries(cols.map((c) => [c, width(c)]));
const fmt = (vals) => cols.map((c) => String(vals[c] ?? '').padEnd(widths[c])).join('  ');
process.stdout.write(fmt(Object.fromEntries(cols.map((c) => [c, c]))).trimEnd() + '\n');
process.stdout.write(cols.map((c) => '-'.repeat(widths[c])).join('  ') + '\n');
for (const r of rows) process.stdout.write(fmt(r).trimEnd() + '\n');
NODE_EOF
		say ""
		say "Reading the linked project's catalog (project $PROJECT_REF, read only):"
		if FLL_PROJECT_REF="$PROJECT_REF" FLL_MGMT_TOKEN="$FLL_TOKEN" \
		   FLL_QUERY="$CATALOG_SQL" FLL_MGMT_HOST="$MGMT_HOST" \
		   node "$TMP_NODE" > "$TMP_NODE.out" 2> "$TMP_NODE.err"; then
			sed 's/^/    /' "$TMP_NODE.out"
			FOUND="$(grep -c . "$TMP_NODE.out" || true)"
			EXPECTED="$(printf '%s\n' "$OBJECTS" | grep -c . || true)"
			say ""
			say "Expected $EXPECTED object(s) from the file; the catalog answered with"
			say "$(( FOUND > 2 ? FOUND - 2 : 0 )) row(s) above."
			say "READ THOSE ROWS. A missing name means the push did not land what the"
			say "file says it lands, whatever db push reported."
			CATALOG_OK=1
		else
			catalog_fallback "$(cat "$TMP_NODE.err")"
		fi
		rm -f "$TMP_NODE.out" "$TMP_NODE.err"
		unset FLL_TOKEN
	fi
fi

if [ "$CATALOG_OK" -ne 1 ]; then
	say ""
	printf 'Continue to the merge anyway? Type exactly "merge %s": ' "$VERSION"
	MCONFIRM=""
	if [ -r /dev/tty ]; then IFS= read -r MCONFIRM < /dev/tty || true; else IFS= read -r MCONFIRM || true; fi
	if [ "$(trim "$MCONFIRM")" != "merge $VERSION" ]; then
		abort "Stopped before the merge, with the schema unconfirmed." \
			"THE SQL MAY BE LIVE ON THE LINKED PROJECT: step 5 ran and reported
success. Nothing has been merged into main. $BRANCH carries a merge of main
and is unpushed." \
			"Confirm the objects by hand with the SELECT printed above, then run
this script again. Step 3 will see $VERSION as applied and skip the push."
	fi
fi

# --- step 7: merge to main and push ------------------------------------------

step "Step 7 of 9: merge $BRANCH into main and push"

git checkout -B main origin/main
merge_into_current "$BRANCH" "Merge branch '$BRANCH'"

PUSHED=0
for attempt in 1 2 3 4; do
	if git push -u origin main; then PUSHED=1; break; fi
	delay=$(( 2 ** attempt ))
	warn "push failed (attempt $attempt). Retrying in ${delay}s."
	sleep "$delay"
done
if [ "$PUSHED" -ne 1 ]; then
	abort "Could not push main." \
		"THE SQL IS LIVE ON THE LINKED PROJECT and the merge exists LOCALLY on
main at $(git rev-parse --short HEAD). It is not on origin. The schema is
therefore ahead of what anybody else can see." \
		"Get the network back and push by hand:
  git push -u origin main
Do NOT force push and do NOT revert the merge: the SQL is already applied,
so reverting would leave the schema ahead of the code."
fi
MAIN_SHA="$(git rev-parse --short HEAD)"
say "main is now $MAIN_SHA on origin."

# --- step 8: rebuild local and run the suite ---------------------------------

step "Step 8 of 9: db reset locally, then the full suite"

say "A red suite here is a FINDING, not a rollback. The SQL is already live and"
say "main is already pushed; reverting would leave the schema ahead of the code."
say ""

RESET_OK=1
if ! supa db reset; then
	RESET_OK=0
	warn "\`supabase db reset\` failed. The local stack is not rebuilt."
	say  "The tests below, if they run at all, are measuring an old schema."
fi

TESTS_OK=1
TEST_TAIL=""
if [ "$RESET_OK" -eq 1 ]; then
	TEST_LOG="$(mktemp)"
	if npx vitest run 2>&1 | tee "$TEST_LOG"; then TESTS_OK=1; else TESTS_OK=0; fi
	TEST_TAIL="$(grep -E 'Test Files|Tests  |Duration' "$TEST_LOG" | sed 's/^/    /' || true)"
	rm -f "$TEST_LOG"
else
	TESTS_OK=0
	TEST_TAIL="    not run: db reset failed, so there was nothing trustworthy to test against."
fi

# --- step 9: the closing block -----------------------------------------------

step "Step 9 of 9: what happened"

cat <<CLOSING
APPLIED TO THE LINKED PROJECT
$( if [ "$DO_PUSH" -eq 1 ]; then printf '  %s, via supabase db push through scripts/wsl-supabase.sh' "$MIGRATION_FILE"; else printf '  nothing: %s was already on the remote ledger' "$VERSION"; fi )
$( if [ -n "$ABOVE" ]; then printf '  plus these, which the ledger was also missing:\n%s' "$(printf '%s\n' "$ABOVE" | sed 's/^/    /')"; fi )

SCHEMA CHECK
$( if [ "$CATALOG_OK" -eq 1 ]; then printf '  the catalog was read and its rows are printed under step 6'; else printf '  NOT CONFIRMED: the catalog could not be read. See step 6 for the SELECT to paste.'; fi )

MERGED
  $BRANCH into main, --no-ff, pushed as $MAIN_SHA

TESTS
$( if [ "$TESTS_OK" -eq 1 ]; then printf '  green'; else printf '  RED, or not run. THIS IS A FINDING AND NOTHING WAS ROLLED BACK.'; fi )
$TEST_TAIL

LEFT FOR YOU, IN A BROWSER
  * Sign in as a mentor and as a student and walk the surfaces this bundle
    touched. A migration can be green in SQL and wrong on a screen.
  * Check the surfaces on BOTH grounds and at 375px as well as 1440px.
  * If the bundle changed a policy or a grant, prove BOTH directions: the
    caller who may, and the caller who may not.
  * Regenerate and commit the types if this migration changed the schema shape:
      MSYS_NO_PATHCONV=1 wsl.exe -d $WSL_DISTRO -- bash $WRAPPER_WSL \\
        gen types typescript --local > src/lib/supabase/database.types.ts
CLOSING

if [ "$TESTS_OK" -ne 1 ] || [ "$CATALOG_OK" -ne 1 ]; then
	exit 2
fi
