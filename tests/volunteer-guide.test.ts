// tests/volunteer-guide.test.ts
//
// THE VOLUNTEER GUIDE IS LINKS AND CHECKS, SO WHAT CAN BREAK IS A LINK.
//
// Every mission in the guide points at the official Robot Game Rulebook at the
// page where that mission's rules begin. Those pages were read from the real
// PDF, and a rulebook reissue can move them, so this file pins the shape (all
// 15 missions, each with a page, in the range the rulebook's mission pages
// occupy) and refuses the two quiet failures: a mission with no official link,
// and any rule text copied in from FIRST. Nothing here needs the local stack.

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { MISSION_CONTENT } from '../src/lib/content/missions';
import {
	MISSION_RULEBOOK_PAGE,
	RULEBOOK_MAP_PAGE,
	RULEBOOK_URL,
	TEAM_CHECK,
	VOLUNTEER_SHEETS,
	rulebookLink
} from '../src/lib/content/volunteer';

describe('volunteer guide: official mission links', () => {
	test('every mission has a rulebook page, and nothing else does', () => {
		const codes = MISSION_CONTENT.map((m) => m.code).sort();
		expect(Object.keys(MISSION_RULEBOOK_PAGE).sort()).toEqual(codes);
		expect(codes).toHaveLength(15);
	});

	test('pages are the rulebook mission pages (9 to 12), in mission order', () => {
		const pages = MISSION_CONTENT.map((m) => MISSION_RULEBOOK_PAGE[m.code]);
		for (const p of pages) {
			expect(p).toBeGreaterThanOrEqual(9);
			expect(p).toBeLessThanOrEqual(12);
		}
		expect([...pages].sort((a, b) => a - b)).toEqual(pages);
	});

	test('the map page sits before the mission pages', () => {
		expect(RULEBOOK_MAP_PAGE).toBeLessThan(Math.min(...Object.values(MISSION_RULEBOOK_PAGE)));
	});

	test('a link is the official PDF at a page, on FIRST\'s own host', () => {
		const url = rulebookLink(9);
		expect(url).toBe(`${RULEBOOK_URL}#page=9`);
		expect(new URL(url).host).toBe('firstinspires.blob.core.windows.net');
	});
});

describe('volunteer guide: content shape', () => {
	test('three sheets, each with something to look for and something to ask', () => {
		expect(VOLUNTEER_SHEETS.map((s) => s.id)).toEqual(['game-plan', 'iteration-log', 'more-rounds']);
		for (const s of VOLUNTEER_SHEETS) {
			expect(s.lookFor.length).toBeGreaterThan(0);
			expect(s.ask.length).toBeGreaterThan(0);
		}
	});

	test('team check ids are unique', () => {
		const ids = TEAM_CHECK.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test('no em dashes in anything a volunteer reads', () => {
		const src = readFileSync('src/lib/content/volunteer.ts', 'utf8');
		const page = readFileSync('src/routes/volunteer/+page.svelte', 'utf8');
		expect(src.includes('—')).toBe(false);
		expect(page.includes('—')).toBe(false);
	});
});
