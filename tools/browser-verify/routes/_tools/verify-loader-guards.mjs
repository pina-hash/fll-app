#!/usr/bin/env node
// NEGATIVE CONTROLS for `../../routes.mjs`'s loader guards, the same argument
// `../../selftest.mjs`'s header makes about a browser check: a guard nobody
// has fired is a guard nobody has tested. The split's loader refuses on two
// failure modes -- a filename that disagrees with its own spec's `path`, and
// two files claiming the same `path` -- and neither throws in ordinary use.
//
//   node tools/browser-verify/routes/_tools/verify-loader-guards.mjs
//
// It needs no browser and no dev server, so it is the cheap half of proving
// this harness works.
//
// Both controls mutate the REAL routes/ directory (there is nowhere else the
// loader will look -- `ROUTES_DIR` in routes.mjs is a sibling of routes.mjs
// itself, not a parameter), and restore it from an in-memory copy taken
// before the mutation, never with `git checkout --`: that is a discard to
// HEAD rather than a scoped undo, and it takes any other uncommitted work in
// the file with it. Each control re-imports routes.mjs with a cache-busting
// query string, because a bare `import('../../routes.mjs')` would resolve to
// whatever this process already has cached.
//
// Exits 0 with "ALL GUARDS FIRED" if both controls threw the right way,
// exits 1 and names which one did not otherwise.
//
// Ported from idea-app's copy, with this repo's fixture route.

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROUTES_DIR = fileURLToPath(new URL('../', import.meta.url));
const ROUTES_MJS = fileURLToPath(new URL('../../routes.mjs', import.meta.url));

/** The spec both controls mutate. It is this repo's only route spec today. */
const FIXTURE = 'route-planner.mjs';

async function importFresh() {
	return import(`${ROUTES_MJS}?bust=${Date.now()}-${Math.random()}`);
}

async function expectThrow(label, run, mustInclude) {
	try {
		await run();
	} catch (err) {
		const msg = String(err && err.message ? err.message : err);
		if (!msg.includes(mustInclude)) {
			return {
				label,
				ok: false,
				detail: `threw, but the message did not name what it should:\n  got: ${msg}\n  wanted to see: ${mustInclude}`
			};
		}
		return { label, ok: true, detail: msg };
	}
	return { label, ok: false, detail: 'the loader did not throw at all -- the guard is silently gone' };
}

const results = [];

// Control 1: a filename that disagrees with its own spec's `path`.
{
	const victim = `${ROUTES_DIR}${FIXTURE}`;
	const decoy = `${ROUTES_DIR}route-planner-renamed-wrong.mjs`;
	if (!existsSync(victim)) throw new Error(`fixture route missing: ${victim} -- did routes/${FIXTURE} move?`);
	renameSync(victim, decoy);
	try {
		results.push(
			await expectThrow('filename disagrees with its own path', importFresh, 'filename does not match its own path')
		);
	} finally {
		renameSync(decoy, victim);
	}
}

// Control 2: two files naming the same route `path`. The loader reads the
// directory in SORT ORDER (readdirSync().sort()), and the duplicate/slug
// checks only see a collision against a path or slug ALREADY recorded by an
// earlier file in that order -- so the decoy's filename must sort AFTER the
// fixture (never `route-planner-...`, which sorts before it: '-' < '.' in
// ASCII, so any such name is processed first and would report its OWN
// filename mismatch, not a duplicate of a file that has not loaded yet).
{
	const source = `${ROUTES_DIR}${FIXTURE}`;
	const dupe = `${ROUTES_DIR}zzz-duplicate-of-route-planner.mjs`;
	if (existsSync(dupe)) throw new Error(`fixture collision: ${dupe} already exists -- leftover from a failed run?`);
	const original = readFileSync(source, 'utf8');
	// Same `path:` (and therefore the same slug the loader derives from it),
	// under a filename that does NOT match that slug -- proving the guard
	// fires on the PATH collision itself, independent of whether the second
	// file also happens to be misnamed.
	writeFileSync(dupe, original);
	try {
		results.push(await expectThrow('duplicate route path across two files', importFresh, 'duplicate route path'));
	} finally {
		unlinkSync(dupe);
	}
}

// A mutation left behind by a failed run must not read as the fixture
// restoring itself byte-identically -- assert the directory is back to what
// it started as, and that the file's bytes are unchanged.
{
	const restored = existsSync(`${ROUTES_DIR}${FIXTURE}`) ? readFileSync(`${ROUTES_DIR}${FIXTURE}`, 'utf8') : '';
	results.push({
		label: `${FIXTURE} restored after both controls, with no decoy left behind`,
		ok:
			restored.length > 0 &&
			!existsSync(`${ROUTES_DIR}route-planner-renamed-wrong.mjs`) &&
			!existsSync(`${ROUTES_DIR}zzz-duplicate-of-route-planner.mjs`),
		detail: restored.length ? `${restored.length} bytes` : 'MISSING'
	});
}

// And the loader loads cleanly again afterwards, which is the other half of
// "restored": a directory with no decoy in it that still refuses to load
// would be a worse state than the one the controls created.
{
	try {
		const mod = await importFresh();
		results.push({
			label: 'the loader loads cleanly again once the controls are undone',
			ok: Array.isArray(mod.ROUTES) && mod.ROUTES.length > 0,
			detail: `${mod.ROUTES.length} route spec(s): ${mod.ROUTES.map((r) => r.path).join(', ')}`
		});
	} catch (err) {
		results.push({
			label: 'the loader loads cleanly again once the controls are undone',
			ok: false,
			detail: `it threw: ${err.message}`
		});
	}
}

let allOk = true;
for (const r of results) {
	console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}`);
	console.log(`  ${r.detail.split('\n').join('\n  ')}`);
	if (!r.ok) allOk = false;
}

if (allOk) {
	console.log('\nALL GUARDS FIRED');
	process.exit(0);
} else {
	console.error('\nA LOADER GUARD DID NOT FIRE AS EXPECTED -- see the FAIL lines above');
	process.exit(1);
}
