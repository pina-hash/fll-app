// tests/build-manual-entry.test.ts
//
// THE ROBOT BUILD MANUAL HAS ONE PATH AND FIVE DOORS, AND THE PATH IS WRITTEN
// DOWN ONCE.
//
// The 225-step competition build manual is the document these four teams open
// more than any other, and for five bundles the only way to it was Skill Hub,
// then Build & Programming, then ROBOT4, then a resource link: four taps with
// the word "build" appearing nowhere above the last one. An earlier bundle gave
// it a destination of its own and three entry points into that destination, and
// a later one added the console nav tab and moved the student door inside the
// student screen. The failure mode another door invites is somebody typing the
// path again, so this file asserts the single-source rule structurally, the way
// tests/codegen-ports.test.ts asserts that only one file assigns a movement
// pair.
//
// THE STUDENT DOOR IS THE COMPONENT, NOT THE PAGE THAT MOUNTS IT. It shipped as
// a slab that src/routes/app/(student)/me/+page.svelte rendered below
// StudentScreen, because the lane that added it did not own the component. It
// is now the seventh entry in that component's own `destinations` snippet, so
// the assertions below follow it there. The page is still scanned for a typed
// path, because it is still where the href is passed in.
//
// It also asserts the SIZE rule, which is a product rule and not a style one:
// the file is 23 MB and these are school tablets, so no entry point may embed
// it and no entry point may start the transfer without a tap.
//
// Nothing here needs the local stack.

import { describe, expect, test } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
	COMP_BOT_MANUAL_ROUTE,
	COMP_BOT_MANUAL_SIZE,
	COMP_BOT_MANUAL_STEPS,
	COMP_BOT_MANUAL_URL,
	RESOURCES
} from '$lib/content/resources';
import { ROBOT_ITEMS } from '$lib/content/categories';

const ROOT = process.cwd();

/** The destination screen, plus the three surfaces that lead to it and say
 *  what it is before the tap. */
const ENTRY_POINTS = {
	destination: 'src/routes/app/build/+page.svelte',
	home: 'src/routes/app/+page.svelte',
	student: 'src/lib/student/StudentScreen.svelte',
	hub: 'src/routes/app/library/+page.svelte'
} as const;

/**
 * Doors that link the route without describing the manual, so they carry none
 * of the copy the entry points above are held to, and the page that mounts the
 * student screen and passes it the href. They are here for one reason: a path
 * literal must not hide in them either.
 */
const ALSO_SCANNED = [
	'src/routes/app/+layout.svelte',
	'src/routes/app/(student)/me/+page.svelte'
];

const SOURCE_OF_TRUTH = 'src/lib/content/resources.ts';

/** Every file a path literal could hide in. */
const SCANNED = [SOURCE_OF_TRUTH, ...Object.values(ENTRY_POINTS), ...ALSO_SCANNED];

function read(rel: string): string {
	return readFileSync(join(ROOT, rel), 'utf8');
}

/**
 * Comments are prose and are allowed to name a route: half of the reasoning in
 * these files is about where /app/build sits. Only a real string literal counts
 * as typing the path a second time, so the comments come out first.
 */
function stripComments(src: string): string {
	return src
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^[ \t]*\/\/.*$/gm, '');
}

function quotedLiteral(path: string): RegExp {
	const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`['"\`]${escaped}['"\`]`);
}

describe('the file itself', () => {
	test('static/build/comp-bot-manual.pdf ships and is a PDF', () => {
		const file = join(ROOT, 'static', COMP_BOT_MANUAL_URL);
		const bytes = readFileSync(file);
		expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
	});

	test('it is the big file the copy warns about, so the warning is not stale', () => {
		const { size } = statSync(join(ROOT, 'static', COMP_BOT_MANUAL_URL));
		// The stated size is "about 23 MB". Anything between 20 and 26 still reads
		// as 23; anything outside it means the copy is lying to a student about
		// what they are about to pull over school wifi.
		expect(size).toBeGreaterThan(20_000_000);
		expect(size).toBeLessThan(26_000_000);
		expect(COMP_BOT_MANUAL_SIZE).toMatch(/\bMB\b/);
	});
});

describe('one path, written down once', () => {
	test('resources.ts is the only file that spells the PDF path', () => {
		const literal = quotedLiteral(COMP_BOT_MANUAL_URL);
		const offenders = SCANNED.filter(
			(rel) => rel !== SOURCE_OF_TRUTH && literal.test(stripComments(read(rel)))
		);
		expect(offenders).toEqual([]);
		expect(literal.test(read(SOURCE_OF_TRUTH))).toBe(true);
	});

	test('resources.ts is the only file that spells the /app/build route', () => {
		const literal = quotedLiteral(COMP_BOT_MANUAL_ROUTE);
		const offenders = SCANNED.filter(
			(rel) => rel !== SOURCE_OF_TRUTH && literal.test(stripComments(read(rel)))
		);
		expect(offenders).toEqual([]);
		expect(literal.test(read(SOURCE_OF_TRUTH))).toBe(true);
	});

	test('every entry point imports the constant it uses', () => {
		for (const [name, rel] of Object.entries(ENTRY_POINTS)) {
			const src = read(rel);
			expect(src, `${name} (${rel}) imports from the resources module`).toMatch(
				/from '\$lib\/content\/resources'/
			);
			const wanted = name === 'destination' ? 'COMP_BOT_MANUAL_URL' : 'COMP_BOT_MANUAL_ROUTE';
			expect(src, `${name} (${rel}) reaches ${wanted}`).toContain(wanted);
		}
	});

	test("ROBOT4's resource link still resolves to the same file", () => {
		const robot4 = ROBOT_ITEMS.find((item) => item.id === 'ROBOT4');
		expect(robot4?.resourceId).toBe('comp-bot-manual');
		expect(RESOURCES['comp-bot-manual'].url).toBe(COMP_BOT_MANUAL_URL);
	});

	test('the step count is stated, not retyped, on every entry point', () => {
		expect(COMP_BOT_MANUAL_STEPS).toBe(225);
		for (const [name, rel] of Object.entries(ENTRY_POINTS)) {
			expect(read(rel), `${name} (${rel}) states the step count`).toContain(
				'COMP_BOT_MANUAL_STEPS'
			);
		}
	});
});

describe('23 MB does not load itself', () => {
	const destination = read(ENTRY_POINTS.destination);
	// Comments out: the screen's own comment NAMES the three tags it refuses to
	// use, and a scan that could not tell the two apart would fail on the note
	// explaining why they are absent.
	const destinationMarkup = stripComments(destination);

	test('no viewer and no embed anywhere on the build screen', () => {
		// Any of the three starts the transfer while the page is still painting,
		// which is the whole failure this screen exists to avoid.
		for (const tag of ['<embed', '<iframe', '<object']) {
			expect(destinationMarkup).not.toContain(tag);
		}
	});

	test('the manual opens on a tap, and the router is told not to prefetch it', () => {
		// The body carries data-sveltekit-preload-data="hover"; a static file is
		// not a route, and a finger brushing past it is not a request for 23 MB.
		expect(destination).toContain('data-sveltekit-preload-data="off"');
		expect(destination).toContain('data-sveltekit-reload');
	});

	test('the size is said in words on the screen that starts the download', () => {
		expect(destination).toContain('COMP_BOT_MANUAL_SIZE');
	});

	test('the entry points warn about the size too, before the tap', () => {
		for (const rel of [ENTRY_POINTS.home, ENTRY_POINTS.student]) {
			expect(read(rel), `${rel} warns about the size`).toContain('COMP_BOT_MANUAL_SIZE');
		}
	});
});
