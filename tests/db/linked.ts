// tests/db/linked.ts
//
// THE GRANT ASSERTIONS HAVE TO RUN SOMEWHERE THE BUG CAN ACTUALLY HAPPEN.
// `tests/db/harness.ts` talks to the local stack, which is built from the
// migration chain and nothing else. A hosted Supabase project is not: it
// carries ALTER DEFAULT PRIVILEGES the local image does not, so every
// `create function` there acquires grants the chain never asked for. That is
// how anon ended up executing all 85 functions in `public` on the linked
// project while local measured the correct 5, with a green suite the whole
// time. See CLAUDE.md, "Hosted defaults".
//
// This module is the second address. It reads the schema catalog of the
// LINKED project through the Management API, which needs only
// SUPABASE_ACCESS_TOKEN and no database password.
//
// It is READ ONLY by construction: `remoteCatalogQuery` is the only export
// that talks to the network and every caller passes a select. Nothing here
// may write, and a test that wants to write belongs against the local stack.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = new URL('../../', import.meta.url);

function readIfPresent(relative: string): string | null {
	try {
		return readFileSync(fileURLToPath(new URL(relative, REPO_ROOT)), 'utf8');
	} catch {
		return null;
	}
}

/**
 * The linked project's ref, written by `supabase link`. Not read from
 * config.toml: `project_id` there is the LOCAL stack's container name
 * (`fll-app-sk`) and has never been the remote ref.
 */
function resolveRef(): string | null {
	const direct = readIfPresent('supabase/.temp/project-ref')?.trim();
	if (direct) return direct;

	const json = readIfPresent('supabase/.temp/linked-project.json');
	if (!json) return null;
	try {
		const ref = (JSON.parse(json) as { ref?: string }).ref;
		return ref && ref.length > 0 ? ref : null;
	} catch {
		return null;
	}
}

/**
 * The token, from `.env` FIRST and only then from the environment.
 *
 * THAT ORDER IS THE WHOLE POINT AND IT IS NOT THE CONVENTIONAL ONE. CLAUDE.md
 * calls `.env` "the repo's own answer to which account is this", and the one
 * credential statement that cannot drift when a sibling repo logs in. The
 * ambient `SUPABASE_ACCESS_TOKEN` is exactly the drift it warns about: this
 * machine also checks out idea-app and frc-app, which use a DIFFERENT
 * Supabase account.
 *
 * Measured, not hypothetical. Written the conventional way round (environment
 * first) these assertions failed with a Management API 403, because the shell
 * carried `sbp_64fb242e...` from a sibling repo while `.env` holds
 * `sbp_77098c29...`, the account that actually owns this project. A 403 is at
 * least loud. The failure that matters is the quiet one: another account that
 * happens to own a project of its own would answer 200 and this suite would
 * cheerfully assert the grants of a database nobody here runs.
 *
 * `.env` is gitignored, so on a checkout without it this falls through to the
 * environment and then to null, and the suite skips loudly rather than
 * quietly measuring nothing.
 */
function resolveToken(): string | null {
	const dotenv = readIfPresent('.env');
	if (dotenv) {
		for (const line of dotenv.split(/\r?\n/)) {
			const match = /^SUPABASE_ACCESS_TOKEN=(.*)$/.exec(line.trim());
			if (match) {
				const value = match[1].trim().replace(/^["']|["']$/g, '');
				if (value) return value;
			}
		}
	}

	const fromEnv = process.env.SUPABASE_ACCESS_TOKEN?.trim();
	return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

const REF = resolveRef();
const TOKEN = resolveToken();

export const linkedRef = REF;

/** Why the remote assertions cannot run, or null when they can. */
export function linkedUnavailableReason(): string | null {
	if (!REF) {
		return 'no linked project: supabase/.temp/project-ref is absent. Run `supabase link` first.';
	}
	if (!TOKEN) {
		return 'no SUPABASE_ACCESS_TOKEN in the environment or in .env (.env is gitignored, so a fresh checkout will not have it).';
	}
	return null;
}

export const linkedAvailable = linkedUnavailableReason() === null;

/**
 * Print the skip reason where a human will actually see it.
 *
 * A silently skipped grant assertion is worse than an absent one: the run
 * still says "passed", which is precisely the failure this whole module
 * exists to stop. Vitest marks the tests skipped; this makes the REASON
 * visible in the same output.
 */
export function warnLinkedSkipped(suite: string): void {
	const reason = linkedUnavailableReason();
	if (!reason) return;
	const rule = '='.repeat(72);
	// process.stderr.write, NOT console.warn. Vitest intercepts console.* and
	// the default reporter swallowed the banner entirely: the run printed a
	// bare "5 skipped" and nothing else, which is the silent skip this
	// function exists to prevent. Writing to the stream directly gets past
	// the interception.
	process.stderr.write(
		[
			'',
			rule,
			`SKIPPED (not passed): ${suite}`,
			`  ${reason}`,
			'',
			'  These assertions are the only ones that run against the LINKED',
			'  project. A hosted project carries default privileges the local',
			'  image does not, so verifying grants against local alone proves',
			'  nothing about production. This run did NOT check production.',
			rule,
			'',
			''
		].join('\n')
	);
}

type QueryRow = Record<string, unknown>;

/**
 * Run one read-only query against the linked project's database through the
 * Management API. Throws rather than returning empty on a transport or SQL
 * error, so a broken credential can never look like a clean catalog.
 */
export async function remoteCatalogQuery<T extends QueryRow = QueryRow>(query: string): Promise<T[]> {
	if (!REF || !TOKEN) {
		throw new Error(`remoteCatalogQuery called with no linked project: ${linkedUnavailableReason()}`);
	}

	const response = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ query })
	});

	const text = await response.text();
	if (!response.ok) {
		throw new Error(`linked project query failed (${response.status}): ${text.slice(0, 400)}`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(`linked project returned non-JSON: ${text.slice(0, 400)}`);
	}

	// The API answers a failed statement with an object carrying `message`
	// rather than an HTTP error, which would otherwise read as zero rows.
	if (!Array.isArray(parsed)) {
		throw new Error(`linked project query failed: ${text.slice(0, 400)}`);
	}
	return parsed as T[];
}
