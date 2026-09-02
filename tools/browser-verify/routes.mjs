/**
 * Which dev routes `tools/browser-verify` drives, and what it measures on each.
 *
 * THE SPECS THEMSELVES LIVE UNDER `routes/`, ONE FILE PER ROUTE. This file
 * ASSEMBLES them at load time and is the pointer explaining why, the way
 * `docs/HISTORY.md` points at `docs/history/`. It is the same split for the
 * same reason: a single array every lane appends a route object to at the
 * same closing `];` is a shared write point two branches touch on every
 * unrelated pair of features. idea-app's copy of this file blocked a merge
 * three times in one day before it was split; this repo starts split.
 *
 * ONE FILE PER ROUTE, COLLISION-FREE BY CONSTRUCTION. A route's filename is
 * derived from its OWN `path` (see `slugify` below), never chosen or
 * numbered: a session adding a new dev route is by definition adding a new,
 * distinct URL nothing else in the app answers on, so two lanes adding two
 * routes always produce two different files and share no line. A numbered
 * prefix would be the exact anti-pattern the history split rejected.
 *
 * ADDING A ROUTE: create `routes/<slug of your path>.mjs` exporting the spec
 * as its default export. See `routes/README.md` for the spec shape.
 *
 * `routes/_shared.mjs` holds `WIDTHS`; the loader skips any `_`-prefixed file
 * in the directory, the same escape hatch a `+server.ts` uses for a non-route
 * export.
 *
 * Ported from idea-app's tools/browser-verify/routes.mjs. The `order` export
 * that file describes belongs to the 25 files ITS split produced; nothing
 * here carries one, so every spec sorts alphabetically by filename.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export { WIDTHS } from './routes/_shared.mjs';

const ROUTES_DIR = new URL('./routes/', import.meta.url);

const slugify = (path) =>
	path
		.replace(/^\/dev\//, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

async function loadRoutes() {
	const files = readdirSync(fileURLToPath(ROUTES_DIR))
		.filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
		.sort();

	const entries = [];
	const seenPath = new Map();
	const seenSlug = new Map();
	for (const file of files) {
		const mod = await import(new URL(file, ROUTES_DIR));
		const spec = mod.default;
		if (!spec || typeof spec.path !== 'string') {
			throw new Error(`routes/${file} has no default export with a string \`path\``);
		}
		const slug = slugify(spec.path);
		// The duplicate-path and slug-collision checks run BEFORE the
		// filename-match check below, and must: `slug` is a pure function of
		// `spec.path`, so a file that reaches the filename-match check and
		// passes it is BY DEFINITION the unique file on disk named
		// `${slug}.mjs` -- readdirSync never returns two entries with the same
		// name, so no second file could ever also pass that check for the same
		// path or the same slug. Checking duplicates only after the filename
		// match would make both of these guards unreachable dead code.
		// `routes/_tools/verify-loader-guards.mjs` fires both.
		if (seenPath.has(spec.path)) {
			throw new Error(`duplicate route path ${spec.path} in routes/${file} and routes/${seenPath.get(spec.path)}`);
		}
		seenPath.set(spec.path, file);
		if (seenSlug.has(slug)) {
			throw new Error(`slug collision "${slug}" between routes/${file} and routes/${seenSlug.get(slug)}`);
		}
		seenSlug.set(slug, file);
		const expected = file.slice(0, -'.mjs'.length);
		if (slug !== expected) {
			throw new Error(
				`routes/${file}: filename does not match its own path -- expected routes/${slug}.mjs for path ${spec.path}`
			);
		}
		entries.push({ file, spec });
	}
	entries.sort((a, b) => a.file.localeCompare(b.file));
	return entries.map((e) => e.spec);
}

export const ROUTES = await loadRoutes();

export function selectRoutes(filter) {
	if (!filter || filter.length === 0) return ROUTES;
	return ROUTES.filter((r) => filter.some((f) => r.path.includes(f) || (r.label ?? '').includes(f)));
}

/** The URL to visit for a spec (an aliased spec measures a different state of the same route). */
export const urlFor = (spec) => spec.aliasOf ?? spec.path;
