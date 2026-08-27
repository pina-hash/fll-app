// tests/brand-rules.test.ts
//
// THE BRAND RULES, AS ASSERTIONS. Every rule the app is bound by is a
// function in src/lib/brand/rules.ts, and every one of them is exercised here
// with a violating usage first and a legal one beside it, because a rule that
// only ever sees legal input is not a rule.
//
// This file needs no database and no stack. The half that can only be shown
// in a rendered component -- a supporting mark refusing to appear on a
// surface with no full logo -- is proved in the browser against /dev/brand,
// which mounts the REAL BrandLogo; see the bundle's history entry.

import { describe, expect, test } from 'vitest';
import { render } from 'svelte/server';
import FirstName from '../src/lib/brand/FirstName.svelte';
import {
	BrandRuleError,
	MARKS,
	SEASON,
	ancestorHazard,
	TRADEMARK_ATTRIBUTION,
	assertMarkAllowed,
	assertMinimumHeight,
	clearSpacePx,
	createRegister,
	registerMark,
	type BrandMark
} from '../src/lib/brand/rules';

const ALL = Object.keys(MARKS) as BrandMark[];

describe('the supplied artwork is what the app renders', () => {
	test('every mark with a file points at /brand/ and nothing else', () => {
		for (const m of ALL) {
			const spec = MARKS[m];
			if (!spec.file) continue;
			expect(spec.file.startsWith('/brand/')).toBe(true);
			expect(spec.file.endsWith('.png')).toBe(true);
			if (spec.reverseFile) expect(spec.reverseFile.startsWith('/brand/')).toBe(true);
		}
	});

	test('the icon alone and the wordmark alone have NO file, because making one means cropping', () => {
		expect(MARKS['first-icon'].file).toBeNull();
		expect(MARKS['first-wordmark'].file).toBeNull();
		expect(MARKS['first-icon'].refusedBecause).toMatch(/crop/i);
		expect(MARKS['first-wordmark'].refusedBecause).toMatch(/wordmark-alone|body copy/i);
	});

	test('every mark carries the intrinsic size of its file, so width can only follow height', () => {
		for (const m of ALL) {
			const spec = MARKS[m];
			if (!spec.file) continue;
			expect(spec.width).toBeGreaterThan(0);
			expect(spec.height).toBeGreaterThan(0);
		}
	});
});

describe('RULE: a supporting piece may not be the only representation of the logo', () => {
	test('the icon alone is refused even on a surface that HAS a full logo', () => {
		const reg = createRegister();
		registerMark(reg, 'first-horizontal');
		expect(reg.fullLogos).toBe(1);
		// A full logo is present and it is STILL refused: there is no supplied
		// icon-alone file, and cropping one out is forbidden outright.
		expect(() => assertMarkAllowed('first-icon', reg)).toThrow(BrandRuleError);
		expect(() => assertMarkAllowed('first-icon', reg)).toThrow(/refused/i);
	});

	test('the wordmark alone is refused the same way', () => {
		const reg = createRegister();
		registerMark(reg, 'fll-challenge-horizontal-stacked');
		expect(() => assertMarkAllowed('first-wordmark', reg)).toThrow(BrandRuleError);
	});

	test('the FLL Challenge VERTICAL lockup is refused on a surface with no full logo', () => {
		const bare = createRegister();
		expect(bare.fullLogos).toBe(0);
		expect(() => assertMarkAllowed('fll-challenge-vertical', bare)).toThrow(BrandRuleError);
		expect(() => assertMarkAllowed('fll-challenge-vertical', bare)).toThrow(
			/only representation of the logo/i
		);
	});

	test('THE POSITIVE CONTROL: the same lockup is allowed once a full logo is on the surface', () => {
		const reg = createRegister();
		registerMark(reg, 'first-horizontal');
		expect(() => assertMarkAllowed('fll-challenge-vertical', reg)).not.toThrow();
	});

	test('a second SUPPORTING mark does not vouch for the first', () => {
		const reg = createRegister();
		// Registering the vertical lockup must not raise the full-logo count:
		// it is exactly the mark that needs vouching for.
		registerMark(reg, 'fll-challenge-vertical');
		expect(reg.fullLogos).toBe(0);
		expect(() => assertMarkAllowed('fll-challenge-vertical', reg)).toThrow(BrandRuleError);
	});

	test('every full logo counts, and only full logos do', () => {
		const full = ALL.filter((m) => MARKS[m].isFullLogo);
		const supporting = ALL.filter((m) => MARKS[m].needsFullLogoNearby);
		expect(full).toEqual([
			'first-horizontal',
			'first-vertical',
			'fll-challenge-horizontal-stacked',
			'fll-challenge-horizontal',
			'fll-challenge-vertical-icon'
		]);
		expect(supporting).toEqual(['fll-challenge-vertical', 'first-icon', 'first-wordmark']);
		// Nothing is both.
		expect(full.filter((m) => supporting.includes(m))).toEqual([]);

		for (const m of full) {
			const reg = createRegister();
			registerMark(reg, m);
			expect({ mark: m, count: reg.fullLogos }).toEqual({ mark: m, count: 1 });
			expect(() => assertMarkAllowed('fll-challenge-vertical', reg)).not.toThrow();
		}
	});
});

describe('RULE: never below the documented minimum size', () => {
	const CASES: [BrandMark, number][] = [
		['first-horizontal', 30],
		['first-vertical', 60],
		['fll-challenge-horizontal-stacked', 45],
		['fll-challenge-horizontal', 25],
		['fll-challenge-vertical-icon', 60],
		['fll-challenge-vertical', 40]
	];

	for (const [mark, min] of CASES) {
		test(`${mark} refuses ${min - 1}px and accepts ${min}px`, () => {
			expect(MARKS[mark].minHeightPx).toBe(min);
			expect(() => assertMinimumHeight(mark, min - 1)).toThrow(BrandRuleError);
			expect(() => assertMinimumHeight(mark, min - 1)).toThrow(new RegExp(`${min}px`));
			// The positive control, one pixel up.
			expect(() => assertMinimumHeight(mark, min)).not.toThrow();
		});
	}

	test('the refusal names where the number comes from', () => {
		try {
			assertMinimumHeight('fll-challenge-horizontal-stacked', 10);
			throw new Error('expected a refusal');
		} catch (error) {
			expect((error as Error).message).toContain('FLL p11');
		}
	});
});

describe('RULE: minimum clear space scales with the mark', () => {
	test('it is a quarter of the rendered height, rounded up, and never zero', () => {
		expect(clearSpacePx(48)).toBe(12);
		expect(clearSpacePx(45)).toBe(12);
		expect(clearSpacePx(30)).toBe(8);
		expect(clearSpacePx(1)).toBe(1);
	});

	test('it grows with the mark, so a bigger logo gets a bigger safety zone', () => {
		expect(clearSpacePx(120)).toBeGreaterThan(clearSpacePx(60));
	});
});

describe('the trademark attribution is the IP policy words, not a paraphrase', () => {
	test('it names FIRST, LEGO, and the disclaimer sentence verbatim', () => {
		expect(TRADEMARK_ATTRIBUTION).toBe(
			'FIRST® LEGO® League is a jointly held trademark of FIRST® ' +
				'(www.firstinspires.org) and the LEGO Group, neither of which is overseeing, ' +
				'involved with, or responsible for this activity, product, or service.'
		);
	});

	test('it carries the registered symbol on both marks and names both owners', () => {
		expect(TRADEMARK_ATTRIBUTION).toContain('FIRST®');
		expect(TRADEMARK_ATTRIBUTION).toContain('LEGO®');
		expect(TRADEMARK_ATTRIBUTION).toContain('the LEGO Group');
		expect(TRADEMARK_ATTRIBUTION).toContain('www.firstinspires.org');
	});

	test('it does not claim a permission this club has not been granted', () => {
		// The other candidate statements in IP section IV say the marks are
		// "used by special permission". A registered team using its own marks
		// under II.1 has not been granted one, so that wording must not appear.
		expect(TRADEMARK_ATTRIBUTION).not.toMatch(/special permission/i);
	});

	test('no plural or possessive form of either mark appears anywhere', () => {
		// IP III.A Don't 1: never "FIRST's", "FIRSTs", "LEGOs", "LEGO's".
		expect(TRADEMARK_ATTRIBUTION).not.toMatch(/FIRST['’]s|FIRSTs|LEGOs|LEGO['’]s/);
	});
});

describe('the season names are text, and carry the right symbol', () => {
	test('the two season names are the ones the club is playing', () => {
		expect(SEASON.first).toBe('CANOPY');
		expect(SEASON.challenge).toBe('BIOGLOW');
		expect(SEASON.years).toBe('2026-27');
	});

	test('neither is on the registered list, so neither is a bare name in the marks table', () => {
		// Attachment A of the IP policy lists what is registered. CANOPY and
		// BIOGLOW are not on it, which is why FirstName renders them with a
		// trademark symbol rather than a registered one.
		expect(SEASON.first).not.toBe('FIRST');
		expect(SEASON.challenge).not.toBe('FLL');
	});
});

/**
 * THE NAMES AS RENDERED, NOT AS WRITTEN.
 *
 * This is the only place in the suite that mounts a component, and it is here
 * because the defect it guards against was INVISIBLE IN THE SOURCE. The markup
 * had a newline and two tabs between LEGO and League; Svelte trims whitespace
 * at the start of an {#if} block's content, so the compiler dropped it and the
 * page said "FIRSTLEGO League Challenge" -- on every mentor screen, for the
 * whole of the bundle that shipped it. Reading the file proved nothing. Reading
 * the DOM proved it in one line.
 *
 * `svelte/server`'s render is the cheapest DOM there is: no browser, no jsdom,
 * and the same compiled output the first paint of every page uses. FirstName
 * falls back to its own empty name register with no surface above it, so the
 * (R) lands on the first use in each of these, which is the rule.
 */
describe('the names as a reader sees them, rendered', () => {
	const text = (name: 'first' | 'fll' | 'challenge' | 'season' | 'first-season') =>
		render(FirstName, { props: { name } }).body.replace(/<[^>]*>/g, '');

	test('every name has its spaces, and the words are separate words', () => {
		expect(text('first')).toBe('FIRST\u00ae');
		expect(text('fll')).toBe('FIRST\u00ae LEGO\u00ae League');
		expect(text('challenge')).toBe('FIRST\u00ae LEGO\u00ae League Challenge');
		expect(text('season')).toBe('FIRST\u00ae LEGO\u00ae League Challenge BIOGLOW\u2122');
		expect(text('first-season')).toBe('FIRST\u00ae CANOPY\u2122');
	});

	test('the two runs that were fused stay separated, stated as their own case', () => {
		// These are the exact strings the shipped page produced. They are asserted
		// as absences rather than left implied by the equalities above, because
		// this is the regression and it should name itself when it comes back.
		for (const n of ['fll', 'challenge', 'season'] as const) {
			expect(text(n)).not.toMatch(/FIRST\u00ae?LEGO/);
			expect(text(n)).not.toMatch(/LeagueChallenge/);
		}
	});

	test('FIRST is the element the italic rule selects, and LEGO is not', () => {
		// The class list carries Svelte's scope hash, so these match the class
		// rather than the whole attribute. What is being asserted is which
		// element each name is in: `.first` is the one the stylesheet italicises
		// and `.lego` is the one it must never touch.
		const html = render(FirstName, { props: { name: 'fll' } }).body;
		expect(html).toMatch(/<i class="first[^"]*">FIRST<\/i>/);
		expect(html).toMatch(/<span class="lego[^"]*">LEGO<\/span>/);
	});
});

describe('RULE 1, the half CSS cannot defend: an ancestor that would alter the mark', () => {
	// The walk is given a reader, so the rule can be exercised without a DOM.
	const chain = (styles: Partial<Record<string, string>>[]) => {
		const nodes = styles.map((s, i) => ({
			tagName: i === 0 ? 'SPAN' : 'DIV',
			className: `n${i}`,
			style: {
				filter: s.filter ?? 'none',
				opacity: s.opacity ?? '1',
				blend: s.blend ?? 'normal',
				transform: s.transform ?? 'none'
			},
			parentElement: null as unknown
		}));
		for (let i = 0; i < nodes.length - 1; i++) nodes[i].parentElement = nodes[i + 1];
		const read = (e: unknown) => (e as (typeof nodes)[0]).style;
		return { leaf: nodes[0] as unknown as Element, read: read as never };
	};

	test('a clean chain is allowed', () => {
		const { leaf, read } = chain([{}, {}, {}]);
		expect(ancestorHazard(leaf, read)).toBeNull();
	});

	test('an ancestor filter is named, however far up it is', () => {
		const { leaf, read } = chain([{}, {}, {}, { filter: 'hue-rotate(90deg)' }]);
		expect(ancestorHazard(leaf, read)).toMatch(/filter: hue-rotate/);
	});

	test('a blend mode, a partial opacity and a rotation are each caught', () => {
		expect(ancestorHazard(...(Object.values(chain([{}, { blend: 'multiply' }])) as [Element, never])))
			.toMatch(/mix-blend-mode/);
		expect(ancestorHazard(...(Object.values(chain([{}, { opacity: '0.5' }])) as [Element, never])))
			.toMatch(/opacity/);
		expect(
			ancestorHazard(
				...(Object.values(chain([{}, { transform: 'matrix(0.7, 0.7, -0.7, 0.7, 0, 0)' }])) as [
					Element,
					never
				])
			)
		).toMatch(/transform/);
	});

	test('THE POSITIVE CONTROL: a translate-only ancestor moves the mark without altering it', () => {
		const { leaf, read } = chain([{}, { transform: 'matrix(1, 0, 0, 1, 40, 12)' }]);
		expect(ancestorHazard(leaf, read)).toBeNull();
	});

	test('a null element has no ancestors and no hazard', () => {
		expect(ancestorHazard(null, (() => ({ filter: 'none', opacity: '1', blend: 'normal', transform: 'none' })) as never)).toBeNull();
	});
});
