/**
 * THE PALETTE IS RE-MEASURED FROM THE SHIPPED FILES, NOT FROM THE COMMENTS.
 *
 * src/lib/design-system/colors.css and team-accents.css carry a measured
 * contrast ratio beside every token. A comment cannot fail, so this file
 * parses the CSS itself, resolves the tokens for BOTH grounds, and asserts
 * every pairing the app actually renders. A token edited without re-measuring
 * reddens here.
 *
 * The arithmetic is imported from scripts/derive-dark-palette.ts, which is
 * the script that derived the dark ground, so the derivation and the
 * verification cannot use two different definitions of "contrast". That
 * module reproduces 0018's own recorded figures (8.94 / 5.91 / 4.38 / 3.19 on
 * white, 1.82 / 2.76 / 3.72 / 5.10 on FIRST black) from the official hex
 * values, which is the control on the arithmetic itself.
 *
 * WHAT AA MEANS HERE. 4.5:1 for body text, 3:1 for a boundary that carries
 * meaning and for text at large-bold sizes. Where a pairing is only ever used
 * at a large bold size the table says so and holds it to 3:1; everything else
 * is held to 4.5.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wcag, dE76, srgbHue, isLaunchAreaHue } from '../scripts/derive-dark-palette.ts';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const COLORS = read('../src/lib/design-system/colors.css');
const ACCENTS = read('../src/lib/design-system/team-accents.css');

/**
 * Everything between a selector's `{` and its matching `}`. The selector is
 * matched with whitespace treated as insignificant, so reformatting the
 * stylesheet cannot quietly stop this file from measuring anything.
 */
function block(css: string, selector: string): string {
	const pattern = new RegExp(
		selector.trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'),
		''
	);
	const hit = pattern.exec(css);
	if (!hit) throw new Error(`no such selector: ${selector}`);
	const at = hit.index;
	const open = css.indexOf('{', at);
	let depth = 0;
	for (let i = open; i < css.length; i++) {
		if (css[i] === '{') depth++;
		else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
	}
	throw new Error(`unbalanced block for ${selector}`);
}

/** `--name: value;` pairs, comments stripped. */
function declarations(body: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
		out[m[1]] = m[2].trim();
	}
	return out;
}

/** Resolve var() chains down to a literal. */
function resolve(tokens: Record<string, string>, name: string, seen = new Set<string>()): string {
	const raw = tokens[name];
	if (raw === undefined) throw new Error(`unresolved token ${name}`);
	const ref = raw.match(/^var\((--[a-z0-9-]+)\)$/);
	if (!ref) return raw;
	if (seen.has(name)) throw new Error(`circular token ${name}`);
	seen.add(name);
	return resolve(tokens, ref[1], seen);
}

/**
 * EACH SCOPE IS SELF-CONTAINED NOW, which is why there is no merge here any
 * more. The old dark block restated only what moved and this file had to spread
 * the light block underneath it to resolve anything; that spread was the bug's
 * shape written into the test. Every scope declares the complete alias set as
 * literals, so each one is read on its own and a missing alias throws
 * `unresolved token` rather than silently measuring the other ground's value.
 * tests/design-tokens.test.ts is what asserts the completeness itself.
 */
const PALETTE = declarations(
	block(COLORS, ":root, [data-ground='dark'], [data-ground='paper'], [data-ground='light']")
);
const DARK_DECLS = declarations(block(COLORS, ":root, [data-ground='dark'] {"));
const PAPER_DECLS = declarations(
	block(COLORS, "[data-ground='paper'], [data-ground='light'], :root[data-theme='light']")
);

const GROUNDS = {
	paper: (n: string) => resolve({ ...PALETTE, ...PAPER_DECLS }, n),
	dark: (n: string) => resolve({ ...PALETTE, ...DARK_DECLS }, n)
} as const;
type GroundName = keyof typeof GROUNDS;
const BOTH: GroundName[] = ['paper', 'dark'];

const SURFACES = ['--surface-0', '--surface-1', '--surface-2'] as const;

/** Every foreground token, and the floor it is held to. */
const FOREGROUNDS: { token: string; floor: number; why?: string; surfaces?: readonly string[] }[] = [
	{ token: '--text-1', floor: 4.5 },
	{ token: '--text-2', floor: 4.5 },
	{ token: '--text-3', floor: 4.5 },
	{ token: '--accent-text', floor: 4.5 },
	{ token: '--link', floor: 4.5 },
	{ token: '--success-text', floor: 4.5 },
	{ token: '--danger-text', floor: 4.5 },
	{ token: '--warning', floor: 4.5 },
	{ token: '--brass', floor: 4.5 },
	{ token: '--patina', floor: 4.5 },
	{ token: '--copper', floor: 4.5 },
	{ token: '--fg', floor: 4.5 },
	{ token: '--fg-hero', floor: 4.5 },
	{
		token: '--fg-dim',
		floor: 4.5,
		surfaces: ['--surface-0', '--surface-1'],
		why:
			'the specified IDEA --dim, shipped as given. It measures 4.35 on --surface-2 ' +
			'and 3.60 on --plate, so metadata takes it on the page and on a card only; ' +
			'a raised panel takes --fg. --text-3 is the lifted variant the running ' +
			'labels use, and it is held to all three above.'
	},
	{ token: '--gear', floor: 3, why: 'linework and inactive strokes, never text' },
	{ token: '--boundary', floor: 3, why: 'a boundary carries meaning and is held to 3:1, not 4.5' }
];

/** A fill and the ink that sits on it. */
const FILLS: { fill: string; ink: string; floor: number; why: string }[] = [
	{ fill: '--accent', ink: '--accent-ink', floor: 4.5, why: 'primary button label' },
	{ fill: '--success', ink: '--success-ink', floor: 4.5, why: 'live/done chip' },
	{ fill: '--warning', ink: '--warning-ink', floor: 4.5, why: 'blocked chip' },
	{
		fill: '--danger',
		ink: '--danger-ink',
		floor: 3,
		why: 'FIRST red takes white ink at 4.38 on both grounds, which is large bold only; colors.css says so and no small text is set on it'
	},
	{ fill: '--warning-wash', ink: '--text-1', floor: 4.5, why: 'warning block body text' },
	{ fill: '--danger-wash', ink: '--text-1', floor: 4.5, why: 'error block body text' },
	{
		fill: '--danger-wash',
		ink: '--danger-text',
		floor: 4.5,
		why: "BrandLogo's refusal note, which carries its own ground because it appears wherever a mark was going to"
	},
	{ fill: '--warning-wash', ink: '--warning', floor: 4.5, why: 'a warning label on its own wash' }
];

describe('the arithmetic reproduces the figures 0018 recorded', () => {
	it('the official accents measure what colors.css has always said they do', () => {
		const r = (a: string, b: string) => Math.round(wcag(a, b) * 100) / 100;
		expect(r('#662d91', '#ffffff')).toBe(8.94);
		expect(r('#0066b3', '#ffffff')).toBe(5.91);
		expect(r('#ed1c24', '#ffffff')).toBe(4.38);
		expect(r('#00a651', '#ffffff')).toBe(3.19);
		expect(r('#662d91', '#231f20')).toBe(1.82);
		expect(r('#0066b3', '#231f20')).toBe(2.76);
		expect(r('#ed1c24', '#231f20')).toBe(3.72);
		expect(r('#00a651', '#231f20')).toBe(5.1);
	});

	it('a deliberately failing pairing is reported as failing -- the control', () => {
		// FIRST blue on the dark page is the exact case the dark ground had to
		// solve. If this assertion ever passes, the measurement stopped biting.
		expect(wcag('#0066b3', '#231f20')).toBeLessThan(4.5);
		expect(wcag('#231f20', '#231f20')).toBe(1);
	});
});

describe.each(BOTH)('%s ground: every text pairing clears AA', (ground) => {
	const t = GROUNDS[ground];

	it.each(FOREGROUNDS)('$token on the surfaces it is used on', ({ token, floor, surfaces }) => {
		for (const surface of surfaces ?? SURFACES) {
			const ratio = wcag(t(token), t(surface));
			expect(
				ratio,
				`${token} (${t(token)}) on ${surface} (${t(surface)}) is ${ratio.toFixed(2)}`
			).toBeGreaterThanOrEqual(floor);
		}
	});

	it.each(FILLS)('$ink on $fill -- $why', ({ fill, ink, floor }) => {
		const ratio = wcag(t(ink), t(fill));
		expect(ratio, `${ink} on ${fill} is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(floor);
	});

	it('--boundary carries meaning and clears 3:1 on all three surfaces', () => {
		for (const surface of SURFACES) {
			const ratio = wcag(t('--boundary'), t(surface));
			expect(ratio, `--boundary on ${surface} is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
		}
	});

	it('--focus-ring is visible against the page and against a raised control', () => {
		for (const surface of SURFACES) {
			const ratio = wcag(t('--focus-ring'), t(surface));
			expect(ratio, `--focus-ring on ${surface} is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
		}
	});

	it('--hairline decorates and is NOT held to 3:1, but is still visible', () => {
		const ratio = wcag(t('--hairline'), t('--surface-0'));
		expect(ratio).toBeGreaterThan(1.2);
		expect(ratio).toBeLessThan(2);
	});

	it('the surfaces are distinguishable, or say why they are not', () => {
		// ON PAPER --surface-0 AND --surface-1 ARE THE SAME SHEET, DELIBERATELY.
		// A card printed on paper is not a different colour of paper; it is a
		// rule and a shadow on the same sheet. Only --surface-2, the recessed
		// well, is a separate tone. On the dark ground all three step apart.
		const pairs: [string, string][] =
			ground === 'paper'
				? [
						['--surface-0', '--surface-2'],
						['--surface-1', '--surface-2']
					]
				: [
						['--surface-0', '--surface-1'],
						['--surface-1', '--surface-2'],
						['--surface-0', '--surface-2']
					];
		for (const [a, b] of pairs) {
			const ratio = wcag(t(a), t(b));
			expect(ratio, `${a} and ${b} are ${ratio.toFixed(3)} apart`).toBeGreaterThan(1.05);
		}
		if (ground === 'paper') expect(t('--surface-0')).toBe(t('--surface-1'));
	});
});

describe('the official colours are never altered', () => {
	it('the FIRST LEGO League program values are used unmodified on both grounds', () => {
		// PROGRAM CHROME ONLY. These colour the lockups and the program rail and
		// never content or identity, which is why they sit in the shared palette
		// rather than in a ground scope: a ground may not retint a program mark.
		expect(GROUNDS.dark('--program-fll')).toBe('#ed1c24');
		expect(GROUNDS.dark('--program-fll-explore')).toBe('#00a651');
		expect(GROUNDS.dark('--program-fll-discover')).toBe('#662d91');
		expect(GROUNDS.dark('--program-fll-ink')).toBe('#231f20');
		for (const token of [
			'--program-fll',
			'--program-fll-explore',
			'--program-fll-discover',
			'--program-fll-ink'
		]) {
			expect(GROUNDS.dark(token), `${token} moved between grounds`).toBe(GROUNDS.paper(token));
		}
	});

	it('the lockup rule is the FIRST gray on both grounds', () => {
		expect(GROUNDS.paper('--rule-gray')).toBe('#9a989a');
		expect(GROUNDS.dark('--rule-gray')).toBe('#9a989a');
	});

	it('the pathway green is the identity, and it moves between grounds', () => {
		// IDEA mint measures 1.27 on the bone sheet, so paper carries deep IDEA
		// green instead. The IDENTITY is the same; the value cannot be.
		expect(GROUNDS.dark('--accent')).toBe('#8fe08a');
		expect(GROUNDS.paper('--accent')).toBe('#226e1d');
		expect(GROUNDS.dark('--accent')).not.toBe(GROUNDS.paper('--accent'));
	});

	it('crimson is status and never identity', () => {
		// It is LIVE, REC and error only. If it ever equalled the accent on
		// either ground it would have become the identity colour by accident.
		for (const g of BOTH) {
			expect(GROUNDS[g]('--live')).toBe(GROUNDS[g]('--crimson'));
			expect(GROUNDS[g]('--crimson')).not.toBe(GROUNDS[g]('--accent'));
		}
	});

	it('no functional colour is close enough to a brand colour to stand in for one', () => {
		// The functional values exist BECAUSE a brand colour could not carry
		// text. One that landed next door to the colour it replaced would be a
		// tint of a brand colour wearing another name, which is the thing the
		// guidelines forbid. 10 dE is roughly "plainly a different colour".
		const brand = ['#ed1c24', '#00a651', '#662d91', '#231f20'];
		for (const g of BOTH) {
			for (const token of ['--accent-text', '--link', '--success-text', '--danger-text', '--warning']) {
				const value = GROUNDS[g](token);
				// A functional value that IS a program colour, unaltered, would be
				// allowed; none is, so nothing is skipped here today.
				if (brand.includes(value)) continue;
				for (const b of brand) {
					expect(
						dE76(value, b),
						`${g} ${token} (${value}) is only dE ${dE76(value, b).toFixed(1)} from ${b}`
					).toBeGreaterThan(10);
				}
			}
		}
	});
});

/* --- the eleven team accents, on both grounds ----------------------------- */

const ACCENT_NAMES = [
	'bark',
	'orange',
	'olive',
	'lime',
	'green',
	'sage',
	'teal',
	'violet',
	'purple',
	'orchid',
	'magenta'
] as const;

/**
 * Each accent states BOTH of its full triples -- colour, ink and wash -- and
 * the ground picks one, so this reads the pair and does the picking the same
 * way the two selection rules in team-accents.css do.
 */
function accentTokens(ground: GroundName, name: string): Record<string, string> {
	const pair = declarations(block(ACCENTS, `[data-accent='${name}']`));
	// The pair is still named on-light / on-dark; the GROUND is now paper /
	// dark. The paper sheet takes the light half, which is what
	// team-accents.css's own selection rule says.
	const suffix = ground === 'paper' ? 'on-light' : 'on-dark';
	return {
		'--team-accent': pair[`--accent-${suffix}`],
		'--team-accent-wash': pair[`--accent-wash-${suffix}`],
		'--team-accent-ink': pair[`--accent-ink-${suffix}`]
	};
}

describe.each(BOTH)('%s ground: the eleven team accents', (ground) => {
	const t = GROUNDS[ground];

	it.each(ACCENT_NAMES)('%s carries text on all three surfaces and takes its ink', (name) => {
		const a = accentTokens(ground, name);
		for (const surface of SURFACES) {
			const ratio = wcag(a['--team-accent'], t(surface));
			expect(
				ratio,
				`${name} (${a['--team-accent']}) on ${surface} is ${ratio.toFixed(2)}`
			).toBeGreaterThanOrEqual(4.5);
		}
		const ink = wcag(a['--team-accent-ink'], a['--team-accent']);
		expect(ink, `${name} ink is ${ink.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
		const wash = wcag(t('--text-1'), a['--team-accent-wash']);
		expect(wash, `--text-1 on the ${name} wash is ${wash.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
	});

	it('no accent lands in a launch-area hue: the mat is red and blue', () => {
		for (const name of ACCENT_NAMES) {
			const value = accentTokens(ground, name)['--team-accent'];
			expect(isLaunchAreaHue(value), `${name} (${value}) is hue ${Math.round(srgbHue(value))}`).toBe(
				false
			);
		}
	});

	/**
	 * THE PAPER FLOOR IS LOWER THAN THE DARK ONE, AND IT IS A MEASUREMENT OF A
	 * TRADE RATHER THAN A RELAXED STANDARD.
	 *
	 * 0018 measured its closest pair at 21.35 against a WHITE ground and
	 * rejected a twelfth colour for dropping it to 17.3. The paper sheet is
	 * bone #EAE6D8, not white: it carries about four fifths of white's
	 * luminance, so five of the eleven no longer cleared 4.5 on it and had to
	 * sit darker. Darkening a set compresses it in Lab, and the closest pair
	 * (olive/lime) went from 22.80 to 18.88.
	 *
	 * The alternative was moving olive or lime further apart, which changes a
	 * colour a team chose by name on a ground they will almost never see, to
	 * protect a floor that was derived on a third ground. So the values hold
	 * their hue to within 0.3 degrees, the number is recorded here, and it is
	 * asserted so a future edit cannot compress the set further without saying
	 * so. The dark ground, which is the one the app runs on, keeps 21.3.
	 */
	it('the eleven stay separable, to the floor measured on this ground', () => {
		const values = ACCENT_NAMES.map((n) => accentTokens(ground, n)['--team-accent']);
		let closest = Infinity;
		for (let i = 0; i < values.length; i++)
			for (let j = i + 1; j < values.length; j++)
				closest = Math.min(closest, dE76(values[i], values[j]));
		const floor = ground === 'paper' ? 18.8 : 21.3;
		expect(closest, `closest pair is dE ${closest.toFixed(2)}`).toBeGreaterThanOrEqual(floor);
	});

	it('holds 0018\'s hue: each ground within 3 degrees of it, the two within 6', () => {
		if (ground === 'paper') return;
		// The derivation constrains BOTH grounds to within 3 degrees of the
		// colour 0018 shipped, which is what makes a team's colour still that
		// team's colour. Two variants each 3 degrees off in opposite
		// directions are therefore 6 apart, and that is the bound to assert:
		// asserting 3 between the grounds would be asserting something the
		// derivation never promised.
		const SEED_HUES: Record<string, string> = {
			bark: '#6b4e32',
			orange: '#a76105',
			olive: '#3b5003',
			lime: '#497e03',
			green: '#025a31',
			sage: '#427b67',
			teal: '#026478',
			violet: '#721fd1',
			purple: '#c714c7',
			orchid: '#9c117b',
			magenta: '#d4057b'
		};
		const apart = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
		for (const name of ACCENT_NAMES) {
			const seed = srgbHue(SEED_HUES[name]);
			const lightHue = srgbHue(accentTokens('paper', name)['--team-accent']);
			const darkHue = srgbHue(accentTokens('dark', name)['--team-accent']);
			expect(apart(lightHue, seed), `${name} light drifted from 0018`).toBeLessThanOrEqual(3);
			expect(apart(darkHue, seed), `${name} dark drifted from 0018`).toBeLessThanOrEqual(3);
			expect(apart(darkHue, lightHue), `${name} grounds drifted apart`).toBeLessThanOrEqual(6);
		}
	});

	it('no accent is confusable with a brand colour or a state colour', () => {
		const references = [
			'#0066b3',
			'#ed1c24',
			'#662d91',
			'#00a651',
			'#9a989a',
			t('--accent-text'),
			t('--link'),
			t('--success-text'),
			t('--danger-text'),
			t('--warning')
		];
		for (const name of ACCENT_NAMES) {
			const value = accentTokens(ground, name)['--team-accent'];
			for (const r of references) {
				// 0018's own worst case on white is green to --success-text at
				// 9.31 dE, so that is the bar, not a number invented here.
				expect(
					dE76(value, r),
					`${ground} ${name} (${value}) is dE ${dE76(value, r).toFixed(1)} from ${r}`
				).toBeGreaterThanOrEqual(9.3);
			}
		}
	});
});
