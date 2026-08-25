/**
 * THE DARK GROUND, DERIVED AND MEASURED RATHER THAN PICKED.
 *
 * Run: node scripts/derive-dark-palette.mjs
 *
 * WHAT THIS IS FOR. src/lib/design-system/colors.css carries a measured
 * number against every token pairing, on both grounds. This script is where
 * those numbers come from and how the dark-ground team accents were derived.
 * It is committed so a future session can re-run it instead of trusting the
 * comments, and tests/theme-contrast.test.ts re-measures the shipped files
 * independently so the two cannot drift apart silently.
 *
 * IT INVENTS NO BRAND COLOUR. The official values are inputs only. Where a
 * brand accent cannot carry text on the dark ground the answer is a token
 * that is declared NOT a brand colour, exactly as 0018 declared
 * --success-text, --danger-text and --warning for the white ground.
 */

/* --- sRGB, WCAG, CIE76 -- the arithmetic, once ---------------------------- */

const hexToRgb = (hex: string): number[] => {
	const h = hex.replace('#', '');
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const rgbToHex = (rgb: number[]): string =>
	'#' +
	rgb
		.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0'))
		.join('');

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG 2.x relative luminance. */
export const luminance = (hex: string): number => {
	const [r, g, b] = hexToRgb(hex).map(toLinear);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2.x contrast ratio, rounded the way the guidelines are read. */
export const contrast = (a: string, b: string): number => {
	const la = luminance(a);
	const lb = luminance(b);
	const hi = Math.max(la, lb);
	const lo = Math.min(la, lb);
	return (hi + 0.05) / (lo + 0.05);
};
const r2 = (n: number): number => Math.round(n * 100) / 100;

/* --- OKLCH, for moving a hue's lightness without moving its hue ----------- */

const srgbToOklab = (hex: string): [number, number, number] => {
	const [r, g, b] = hexToRgb(hex).map(toLinear);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
};
const oklabToSrgb = ([L, a, bb]: [number, number, number]): number[] => {
	const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	].map(toGamma);
};
const oklch = (hex: string): [number, number, number] => {
	const [L, a, b] = srgbToOklab(hex);
	return [L, Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI];
};
const fromOklch = ([L, C, h]: [number, number, number]): number[] => {
	const rad = (h * Math.PI) / 180;
	return oklabToSrgb([L, C * Math.cos(rad), C * Math.sin(rad)]);
};
const inGamut = (rgb: number[]): boolean => rgb.every((c) => c >= -0.0005 && c <= 1.0005);

/* --- CIE Lab / dE76, the separation measure 0018 used --------------------- */

const srgbToXyz = (hex: string): number[] => {
	const [r, g, b] = hexToRgb(hex).map(toLinear);
	return [
		0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
		0.2126729 * r + 0.7151522 * g + 0.072175 * b,
		0.0193339 * r + 0.119192 * g + 0.9503041 * b
	];
};
const labOf = (hex: string): number[] => {
	const white = [0.95047, 1, 1.08883];
	const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
	const [x, y, z] = srgbToXyz(hex).map((v, i) => f(v / white[i]));
	return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const dE76 = (h1: string, h2: string): number => {
	const a = labOf(h1);
	const b = labOf(h2);
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};

/** sRGB hue in degrees, which is how 0018 stated the launch-area exclusions. */
const srgbHue = (hex: string): number => {
	const [r, g, b] = hexToRgb(hex);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	if (max === min) return 0;
	let h: number;
	if (max === r) h = ((g - b) / (max - min)) % 6;
	else if (max === g) h = (b - r) / (max - min) + 2;
	else h = (r - g) / (max - min) + 4;
	return (h * 60 + 360) % 360;
};
/** The mat's launch areas are red and blue; 0018 excludes both hue bands. */
const isLaunchAreaHue = (hex: string): boolean => {
	const h = srgbHue(hex);
	return h >= 335 || h <= 25 || (h >= 200 && h <= 258);
};

export { contrast as wcag, dE76, srgbHue, isLaunchAreaHue, oklch, fromOklch, inGamut, rgbToHex, r2 };


/* --- mixing, in linear light, which is the only honest way to step a ramp -- */
const mix = (a: string, b: string, t: number): string => {
	const A = hexToRgb(a).map(toLinear);
	const B = hexToRgb(b).map(toLinear);
	return rgbToHex(A.map((v, i) => toGamma(v + (B[i] - v) * t)));
};
export { mix };

/* ==========================================================================
   THE DERIVATION ITSELF. Everything below only prints; nothing below is
   imported. Run `node scripts/derive-dark-palette.mjs` to reproduce every
   number in src/lib/design-system/colors.css and team-accents.css.
   ========================================================================== */

const FIRST_BLACK = '#231f20';
const FIRST_GRAY = '#9a989a';
const WHITE = '#ffffff';

/** One ground: its three surfaces, its ink, and what a team accent on it
 *  must not be mistaken for. */
export interface Ground {
	surfaces: string[];
	text1: string;
	accentInk: string;
	washMix: number;
	references: string[];
}

/** The two grounds, as they ship. */
export const GROUNDS: Record<'light' | 'dark', Ground> = {
	light: {
		surfaces: ['#ffffff', '#f5f5f5', '#ebeaeb'],
		text1: '#231f20',
		accentInk: '#ffffff',
		washMix: 0.18,
		/* Colours a team accent must not be mistaken for on this ground. */
		references: ['#0066b3', '#ed1c24', '#662d91', '#00a651', '#9a989a', '#046b37', '#bf1219', '#8a5a00']
	},
	dark: {
		surfaces: ['#231f20', '#353233', '#413f40'],
		text1: '#f3f3f3',
		accentInk: '#231f20',
		washMix: 0.06,
		references: [
			'#0066b3',
			'#ed1c24',
			'#662d91',
			'#00a651',
			'#9a989a',
			'#cc95fe',
			'#65b1fe',
			'#03c662',
			'#ff8b7f',
			'#e59e2d'
		]
	}
};

/** 0018's eleven, which are the seeds for both grounds. */
export const SEED_ACCENTS: Record<string, string> = {
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

/* The floors. AA is 4.5; the search targets 4.6 so a rounded number in a
   comment can never be the thing that makes a pairing pass. The separation
   floors are the light palette's OWN measured worst cases, with headroom, so
   the dark set is held to the bar 0018 set rather than to a new one. */
const TEXT_FLOOR = 4.6;
const PAIR_FLOOR = 21.8;
const REF_FLOOR = 10.0;

/**
 * LIFT OR SETTLE A HUE UNTIL IT MEETS EVERY CONSTRAINT AT ONCE.
 * OKLCH lightness and chroma are what move. The sRGB hue is HELD within 3
 * degrees of the seed, because that is the space the launch-area exclusions
 * are written in and because a team's colour has to still be that team's
 * colour on the other ground. OKLCH hue is searched rather than fixed: sRGB
 * hue drifts as a colour is lightened, and it is the sRGB one that matters.
 */
export function accentCandidates(seed: string, ground: Ground): string[] {
	const targetHue = srgbHue(seed);
	const seedH = oklch(seed)[2];
	const drift = (hex: string): number => Math.abs(((srgbHue(hex) - targetHue + 540) % 360) - 180);
	const out = new Set<string>();
	for (let h = seedH - 30; h <= seedH + 30; h += 0.5) {
		for (let L = 0.15; L <= 0.99; L += 0.008) {
			for (let C = 0.002; C <= 0.42; C += 0.005) {
				const rgb = fromOklch([L, C, h]);
				if (!inGamut(rgb)) break;
				const hex = rgbToHex(rgb);
				if (drift(hex) > 3) continue;
				if (isLaunchAreaHue(hex)) continue;
				// Carries small text on all three surfaces of this ground.
				if (!ground.surfaces.every((s) => contrast(hex, s) >= TEXT_FLOOR)) continue;
				// Takes its ink when it is a filled chip.
				if (contrast(ground.accentInk, hex) < TEXT_FLOOR) continue;
				// AND carries text ON ITS OWN WASH, which is what a selected
				// chip is: accent-coloured label on an accent-tinted panel.
				const wash = mix(ground.surfaces[0], hex, ground.washMix);
				if (contrast(hex, wash) < TEXT_FLOOR) continue;
				if (contrast(ground.text1, wash) < TEXT_FLOOR) continue;
				out.add(hex);
			}
		}
	}
	return [...out];
}

/**
 * THE OBJECTIVE IS RECOGNISABILITY, NOT MAXIMUM SPREAD. The search takes the
 * candidate CLOSEST to 0018's colour, and the separation floors are
 * constraints on that rather than the thing being maximised. Maximising
 * spread instead produced a near-white "magenta" and a beige "orange": a
 * different palette wearing the same names.
 */
export function derivePalette(ground: Ground): { pick: Record<string, string>; pool: Record<string, string[]> } {
	const names = Object.keys(SEED_ACCENTS);
	const pool: Record<string, string[]> = {};
	for (const n of names) pool[n] = accentCandidates(SEED_ACCENTS[n], ground);
	const empty = names.filter((n) => pool[n].length === 0);
	if (empty.length) throw new Error(`no candidate survives every constraint for: ${empty.join(', ')}`);

	const pick: Record<string, string> = {};
	for (const n of names)
		pick[n] = pool[n].reduce((best, c) =>
			dE76(c, SEED_ACCENTS[n]) < dE76(best, SEED_ACCENTS[n]) ? c : best
		);

	const penalty = (set: Record<string, string>): number => {
		let p = 0;
		for (let i = 0; i < names.length; i++)
			for (let j = i + 1; j < names.length; j++) {
				const d = dE76(set[names[i]], set[names[j]]);
				if (d < PAIR_FLOOR) p += (PAIR_FLOOR - d) ** 2;
			}
		for (const n of names)
			for (const r of ground.references) {
				const d = dE76(set[n], r);
				if (d < REF_FLOOR) p += (REF_FLOOR - d) ** 2;
			}
		return p;
	};
	const drift = (set: Record<string, string>): number =>
		names.reduce((sum, n) => sum + dE76(set[n], SEED_ACCENTS[n]), 0);
	const score = (set: Record<string, string>): number => penalty(set) * 40 + drift(set);

	let current = score(pick);
	for (let round = 0; round < 80; round++) {
		let moved = false;
		for (const n of names) {
			const keep = pick[n];
			let best = keep;
			let bestScore = current;
			for (const cand of pool[n]) {
				pick[n] = cand;
				const sc = score(pick);
				if (sc < bestScore - 1e-9) {
					bestScore = sc;
					best = cand;
				}
			}
			pick[n] = best;
			if (best !== keep) {
				current = bestScore;
				moved = true;
			}
		}
		if (!moved) break;
	}
	if (penalty(pick) > 1e-6) throw new Error('no assignment met every separation floor');
	return { pick, pool };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const pad = (n: number, w = 6): string => r2(n).toFixed(2).padStart(w);

	console.log('=== CONTROL: the arithmetic reproduces the figures 0018 recorded ===');
	for (const [n, v] of Object.entries({
		'FLL purple': '#662d91',
		'FIRST blue': '#0066b3',
		'FIRST red': '#ed1c24',
		'FLL green': '#00a651',
		'FIRST gray': '#9a989a'
	})) {
		console.log(`  ${n.padEnd(11)} on white ${pad(contrast(v, WHITE))}   on FIRST black ${pad(contrast(v, FIRST_BLACK))}`);
	}

	console.log('\n=== THE DARK GROUND: FIRST black, stepped toward the brand gray ===');
	for (const t of [0, 0.06, 0.12]) {
		const g = mix(FIRST_BLACK, FIRST_GRAY, t);
		console.log(`  t=${String(t).padEnd(5)} ${g}`);
	}
	console.log('\n=== THE DARK INK: white, stepped toward the brand gray ===');
	const D = GROUNDS.dark.surfaces;
	for (const [name, t] of [
		['--text-1', 0.15],
		['--text-2', 0.58],
		['--text-3', 0.84]
	] as const) {
		const ink = mix(WHITE, FIRST_GRAY, t);
		console.log(
			`  ${name.padEnd(9)} t=${t} ${ink}   ${pad(contrast(ink, D[0]))} /${pad(contrast(ink, D[1]))} /${pad(contrast(ink, D[2]))}`
		);
	}

	/** A brand colour cannot be tinted, so a foreground it cannot fill is a
	 *  declared functional value: the same hue family, a different colour,
	 *  never presented as the brand one. */
	const liftFunctional = (seedHex: string, grounds: string[], target: number): string => {
		const [, C0, h] = oklch(seedHex);
		for (let L = 0.2; L <= 0.995; L += 0.002) {
			for (let C = Math.min(0.4, C0 * 1.35); C >= 0; C -= 0.002) {
				const rgb = fromOklch([L, C, h]);
				if (!inGamut(rgb)) continue;
				const out = rgbToHex(rgb);
				if (grounds.every((g) => contrast(out, g) >= target)) return out;
				break;
			}
		}
		throw new Error(`nothing at the hue of ${seedHex} clears ${target} on all three surfaces`);
	};
	console.log('\n=== THE DARK GROUND\'S FUNCTIONAL FOREGROUNDS (>= 4.6 on all three) ===');
	for (const [name, seed] of Object.entries({
		'--accent-text': '#662d91',
		'--link': '#0066b3',
		'--success-text': '#00a651',
		'--danger-text': '#ed1c24',
		'--warning': '#8a5a00'
	})) {
		const out = liftFunctional(seed, D, 4.6);
		console.log(
			`  ${name.padEnd(15)} not-${seed} -> ${out}   ${pad(contrast(out, D[0]))} /${pad(contrast(out, D[1]))} /${pad(contrast(out, D[2]))}   dE from its seed ${r2(dE76(out, seed))}`
		);
	}

	console.log('\n=== --boundary must clear 3:1 on all three of its own surfaces ===');
	for (const [ground, value] of [
		['light', '#7a787a'],
		['dark', '#918e8f']
	] as const) {
		const S = GROUNDS[ground].surfaces;
		console.log(`  ${ground.padEnd(5)} ${value}  ${pad(contrast(value, S[0]))} /${pad(contrast(value, S[1]))} /${pad(contrast(value, S[2]))}`);
	}

	for (const [gname, ground] of Object.entries(GROUNDS)) {
		const { pick } = derivePalette(ground);
		const names = Object.keys(SEED_ACCENTS);
		console.log(`\n=== THE ELEVEN ON THE ${gname.toUpperCase()} GROUND ===`);
		console.log('    name     0018      shipped   wash      s0/s1/s2                ink    on-wash  text1-on-wash  hue');
		for (const n of names) {
			const a = pick[n];
			const w = mix(ground.surfaces[0], a, ground.washMix);
			console.log(
				`    ${n.padEnd(8)} ${SEED_ACCENTS[n]}  ${a}  ${w}  ` +
					`${pad(contrast(a, ground.surfaces[0]), 5)}/${pad(contrast(a, ground.surfaces[1]), 5)}/${pad(contrast(a, ground.surfaces[2]), 5)}` +
					`  ${pad(contrast(ground.accentInk, a), 5)}  ${pad(contrast(a, w), 5)}    ${pad(contrast(ground.text1, w), 5)}` +
					`        ${String(Math.round(srgbHue(a))).padStart(3)} (was ${String(Math.round(srgbHue(SEED_ACCENTS[n]))).padStart(3)})`
			);
		}
		let closest = { d: Infinity, a: '', b: '' };
		for (let i = 0; i < names.length; i++)
			for (let j = i + 1; j < names.length; j++) {
				const d = dE76(pick[names[i]], pick[names[j]]);
				if (d < closest.d) closest = { d, a: names[i], b: names[j] };
			}
		let nearest = { d: Infinity, a: '', b: '' };
		for (const n of names)
			for (const r of ground.references) {
				const d = dE76(pick[n], r);
				if (d < nearest.d) nearest = { d, a: n, b: r };
			}
		console.log(`    closest pair: ${closest.a}/${closest.b} at dE ${r2(closest.d)}`);
		console.log(`    nearest reference: ${nearest.a} to ${nearest.b} at dE ${r2(nearest.d)}`);
		console.log('    --- CSS ---');
		for (const n of names)
			console.log(
				`    [data-accent='${n}'] { --team-accent: ${pick[n]}; --team-accent-ink: ${ground.accentInk}; --team-accent-wash: ${mix(ground.surfaces[0], pick[n], ground.washMix)}; }`
			);
	}
}
