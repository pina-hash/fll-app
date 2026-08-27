// tests/design-tokens.test.ts
//
// THE ALIAS RULE, ASSERTED RATHER THAN HOPED FOR.
//
// Custom-property substitution resolves where a property is DECLARED. An alias
// written once on :root computes there and inherits the already-resolved string
// into every other scope, so a ground that forgets one keeps the dark value
// while looking like it themed correctly. There is no error, no warning, and no
// visual clue until somebody prints the page.
//
// This exact bug has shipped twice in the sibling app: once at token level, once
// as a hardcoded hex inside a component's backplate that no ground could
// retint. A LITERAL COLOUR INSIDE A COMPONENT IS THE SAME BUG WEARING A
// DIFFERENT HAT, which is why the last block below scans the whole repo and not
// only the token folder.
//
// These cases read the SHIPPED stylesheet. Nothing here is a copy of the values
// it checks, so the file cannot pass by agreeing with itself.

import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const DS = join(process.cwd(), 'src/lib/design-system');
const COLORS = join(DS, 'colors.css');

/** Strip comments so a hex inside a measurement note is never read as a value. */
function stripComments(css: string): string {
	return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The body of the rule whose selector list starts at `selectorStart`. */
export function scopeBody(css: string, selectorStart: string): string {
	const i = css.indexOf(selectorStart);
	if (i < 0) throw new Error(`colors.css: no scope starting "${selectorStart}"`);
	const open = css.indexOf('{', i);
	let depth = 0;
	for (let j = open; j < css.length; j++) {
		if (css[j] === '{') depth++;
		else if (css[j] === '}') {
			depth--;
			if (depth === 0) return css.slice(open + 1, j);
		}
	}
	throw new Error(`colors.css: unterminated scope "${selectorStart}"`);
}

/** `--name: value;` pairs declared directly in a rule body. */
export function declarations(body: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of body.split('\n')) {
		const m = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*;\s*$/);
		if (m) out[m[1]] = m[2].trim();
	}
	return out;
}

const css = stripComments(readFileSync(COLORS, 'utf8'));

/**
 * The two ground scopes, by the exact selector each block opens with. Named
 * here rather than discovered, so DELETING a scope is a failure too: a
 * discovered list would simply find one fewer and compare it against itself.
 */
const SCOPES: Record<string, string> = {
	dark: '\n:root,\n[data-ground=\'dark\'] {',
	// The FULL selector list, because a prefix of it also opens the palette
	// block at the top of the file and this check would then compare that block
	// against itself and pass with 63 aliases missing.
	paper: "\n[data-ground='paper'],\n[data-ground='light'],\n:root[data-theme='light'] {",
	deck: "\n[data-ground='deck'] {",
	print: '\n@media print {'
};

/* ==========================================================================
   THE SCOPE-COMPLETENESS CHECK, ENUMERATED FROM THE STYLESHEET.

   THE OLD VERSION ASKED THE WRONG QUESTION AND THAT IS WHY IT MISSED ONE.
   It took the dark scope's declaration list as the definition of "the alias
   set" and asked whether the paper and print scopes matched it. Anything the
   dark scope did not declare was therefore not in the set, and could not be
   missing from anything. `--season` is declared in the shared palette block
   at the top of colors.css, whose selector list names all four ground
   selectors at once, so ONE declaration serves both grounds and both grounds
   get the same value: IDEA mint, which measures 1.14 on the bone sheet. It is
   used by the console header and the login hero, it was unreadable on paper on
   every mentor screen, and the alias test passed the whole time -- it shipped
   ONE DAY after that test did.

   THAT IS THE FIFTH TIME THIS BUG HAS LANDED ACROSS TWO APPS, and every time
   it wore a different hat: a var() in an alias, a hex in a component, a
   composed shadow, a ground-blind plate, and now a colour that is simply not
   an alias. The shapes keep changing, so the check no longer looks for a
   shape. It enumerates EVERY custom property in the token layer whose value is
   a colour and asks one question of each.

   THE QUESTION: is this colour declared at TWO DISTINCT SITES, one that the
   dark ground reaches and the paper ground does not, and one the other way
   round? Two sites is the whole test. A single declaration cannot hold two
   values, so a property with one site has one answer for both grounds no
   matter how many ground selectors that one site happens to name -- which is
   exactly how the shared palette block looked correct. Two sites with the SAME
   value is fine and is not the bug: --rule-gray is deliberately identical on
   both, and because it is written twice, changing one is visible.

   The allow list below is the whole of what is exempt, and each category
   carries a case that PROVES the exemption is safe rather than assuming it.
   An exemption nobody can check is how a hole gets in.
   ========================================================================== */

/** Every rule in a stylesheet, with the at-rule prelude it sits inside. */
export function rulesOf(css: string, at = ''): { at: string; sel: string; body: string }[] {
	const out: { at: string; sel: string; body: string }[] = [];
	let i = 0;
	while (i < css.length) {
		const open = css.indexOf('{', i);
		if (open < 0) break;
		let depth = 0;
		let j = open;
		for (; j < css.length; j++) {
			if (css[j] === '{') depth++;
			else if (css[j] === '}' && --depth === 0) break;
		}
		const sel = css.slice(i, open).trim();
		const body = css.slice(open + 1, j);
		if (sel.startsWith('@')) out.push(...rulesOf(body, at ? `${at} ${sel}` : sel));
		else out.push({ at, sel: sel.replace(/\s+/g, ' '), body });
		i = j + 1;
	}
	return out;
}

/**
 * Is this value a colour?
 *
 * The last alternative is the bare rgb triple idiom (`--shadow-color: 0, 0, 0`),
 * which is a colour with the function pulled off and would otherwise be the
 * next thing to slip through. A value is judged over the property's WHOLE set
 * of declarations, not one at a time: the paper ground writes `--glow: none`,
 * which is not a colour but IS the paper answer for a property whose dark
 * answer is one, and judging it alone would call a present site a missing one.
 */
const COLOUR_VALUE =
	/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:transparent|currentColor|white|black)\b|^\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*$/;

type Site = { file: string; at: string; sel: string; value: string };

/**
 * Every colour-valued custom property in a set of stylesheets, and where it is
 * set. Taking the sheets as an argument rather than reading them is what lets
 * THE CONTROL run this exact function over a mutated copy: a control that
 * reimplements the check proves nothing about the check.
 */
function colourSitesIn(sheets: Record<string, string>): Map<string, Site[]> {
	const all = new Map<string, Site[]>();
	for (const [file, css] of Object.entries(sheets)) {
		for (const rule of rulesOf(css)) {
			for (const line of rule.body.split('\n')) {
				const m = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*;\s*$/);
				if (!m) continue;
				if (!all.has(m[1])) all.set(m[1], []);
				all.get(m[1])!.push({ file, at: rule.at, sel: rule.sel, value: m[2] });
			}
		}
	}
	const colours = new Map<string, Site[]>();
	for (const [prop, sites] of all) {
		if (sites.some((s) => COLOUR_VALUE.test(s.value))) colours.set(prop, sites);
	}
	return colours;
}

/**
 * The shipped token layer. The DIRECTORY is enumerated, not a list of
 * filenames, so a new stylesheet added to the folder is covered the day it
 * lands rather than the day somebody remembers to name it here.
 */
function colourSites(): Map<string, Site[]> {
	const sheets: Record<string, string> = {};
	for (const file of readdirSync(DS).filter((f) => f.endsWith('.css'))) {
		sheets[file] = stripComments(readFileSync(join(DS, file), 'utf8'));
	}
	return colourSitesIn(sheets);
}

/**
 * THE GROUNDS, AND THERE ARE THREE OF THEM NOW.
 *
 * `deck` is the green ramp the app used to default to. It joined the file the
 * same bundle the default went neutral, and it is in this list rather than
 * exempt because a ground that only re-declares its six surfaces inherits every
 * other alias from wherever it is nested -- which is the alias bug wearing a
 * sixth hat. A new ground is complete or it is not a ground.
 */
const GROUND_SELECTOR: Record<string, RegExp> = {
	dark: /\[data-ground='dark'\]|\[data-theme='dark'\]/,
	paper: /\[data-ground='paper'\]|\[data-ground='light'\]|\[data-theme='light'\]/,
	deck: /\[data-ground='deck'\]/
};
const GROUNDS = Object.keys(GROUND_SELECTOR);

/**
 * Which grounds a rule can speak to EXCLUSIVELY. A selector naming no ground at
 * all (`:root`, `[data-accent='teal']`) speaks to all of them and therefore
 * distinguishes none, which is the property that makes this check work.
 */
function reaches(sel: string): Record<string, boolean> {
	const parts = sel.split(',').map((s) => s.trim());
	const out: Record<string, boolean> = {};
	for (const g of GROUNDS) {
		out[g] = parts.some(
			(p) =>
				GROUND_SELECTOR[g].test(p) &&
				GROUNDS.every((other) => other === g || !GROUND_SELECTOR[other].test(p))
		);
	}
	return out;
}

/** Sites outside @media print. Print is asserted separately, as its own scope. */
const screenSites = (sites: Site[]) => sites.filter((s) => !/print/.test(s.at));

/**
 * A colour is declared per ground when each ground has a site of its own AND no
 * two grounds are leaning on the SAME site. One declaration cannot hold three
 * values, so a distinct site per ground is the requirement; a system of
 * distinct representatives over three sets is small enough to check by hand.
 */
function declaredPerGround(sites: Site[]): boolean {
	const screen = screenSites(sites);
	const per = GROUNDS.map((g) => screen.filter((s) => reaches(s.sel)[g]));
	if (per.some((list) => list.length === 0)) return false;
	// Every assignment of one site per ground, all distinct.
	const walk = (i: number, used: Site[]): boolean =>
		i === per.length ||
		per[i].some((site) => !used.includes(site) && walk(i + 1, [...used, site]));
	return walk(0, []);
}

/**
 * THE ALLOW LIST. Two categories, nineteen entries, and neither category is
 * taken on trust: each has a case below that fails if its premise stops
 * holding. Adding an entry is a decision and it has to be argued for in the
 * reason string, which is printed by the reporting case so the list can be
 * read without opening this file.
 */
const RAW_PALETTE: Record<string, string> = {
	'--idea-mint': 'IDEA identity, the raw named colour an alias literal came from',
	'--idea-bone': 'IDEA identity, raw named colour',
	'--idea-dim': 'IDEA identity, raw named colour',
	'--idea-gear': 'IDEA identity, raw named colour',
	'--idea-brass': 'IDEA content accent, raw named colour',
	'--idea-patina': 'IDEA content accent, raw named colour',
	'--idea-copper': 'IDEA content accent, raw named colour',
	'--idea-crimson': 'IDEA status colour, raw named colour',
	'--program-fll':
		'a published FIRST LEGO League value, used UNMODIFIED. Darkening a brand ' +
		'colour for a ground and still calling it the brand colour is the thing the ' +
		'guidelines forbid, so this one is ground-independent by mandate',
	'--program-fll-explore': 'a published FIRST LEGO League value, used unmodified',
	'--program-fll-discover': 'a published FIRST LEGO League value, used unmodified',
	'--program-fll-ink': 'a published FIRST LEGO League value, used unmodified',
	'--program-rule':
		'FIRST gray, published and used unmodified. The ALIAS that lands on a ground ' +
		'is --rule-gray, which is declared in both scopes'
};

const GROUND_PAIRED: Record<string, string> = {
	'--accent-on-dark': 'a team accent carries its ground in its own NAME, so the pair is the scope',
	'--accent-on-light': 'the paper half of that pair',
	'--accent-ink-on-dark': 'the ink for the dark half',
	'--accent-ink-on-light': 'the ink for the paper half',
	'--accent-wash-on-dark': 'the wash for the dark half',
	'--accent-wash-on-light': 'the wash for the paper half'
};

const ALLOWED = { ...RAW_PALETTE, ...GROUND_PAIRED };

describe('every colour in the token layer is declared once per ground', () => {
	const sites = colourSites();

	test('the enumeration reached the whole token layer, so the check below means something', () => {
		// Measured: 77 colour-valued custom properties across colors.css and
		// team-accents.css. A number well under that means the parser stopped
		// seeing a file and every case here would pass on an empty set.
		expect(sites.size).toBeGreaterThan(60);
		for (const known of ['--bg0', '--accent', '--glow', '--season', '--accent-on-dark', '--scrim']) {
			expect([...sites.keys()], `the enumeration missed ${known}`).toContain(known);
		}
		expect([...new Set([...sites.values()].flat().map((s) => s.file))].sort()).toEqual([
			'colors.css',
			'team-accents.css'
		]);
	});

	test('each one has a dark site and a paper site, and they are different sites', () => {
		const orphans: string[] = [];
		for (const [prop, list] of [...sites].sort()) {
			if (prop in ALLOWED) continue;
			if (declaredPerGround(list)) continue;
			orphans.push(
				`${prop} is declared at ${screenSites(list).length} screen site(s): ` +
					screenSites(list)
						.map((s) => `{${s.sel}} = ${s.value}`)
						.join(' | ')
			);
		}
		expect(
			orphans,
			'Each of these resolves to ONE value on BOTH grounds. A single declaration ' +
				'cannot hold two colours, however many ground selectors it names. Declare ' +
				'it in the dark scope and in the paper scope as literals, or add it to the ' +
				'allow list with the reason it is genuinely ground-independent.'
		).toEqual([]);
	});

	test('the allow list has no stale entries', () => {
		for (const [prop, reason] of Object.entries(ALLOWED)) {
			expect([...sites.keys()], `${prop} is allow-listed but no longer exists`).toContain(prop);
			expect(
				declaredPerGround(sites.get(prop)!),
				`${prop} is allow-listed as ground-independent but IS now declared per ground; ` +
					`remove the entry rather than leaving an exemption nothing needs`
			).toBe(false);
			expect(reason.length, `${prop} needs a written reason`).toBeGreaterThan(20);
		}
	});

	/**
	 * THE RAW PALETTE IS EXEMPT ONLY BECAUSE NOTHING USES IT. colors.css says
	 * these exist "so a reader can see where an alias's literal came from" and
	 * that "no rule below points at these by name". That is a claim, and this is
	 * the claim asserted: the moment a component writes var(--idea-mint), the
	 * exemption stops being safe and this goes red instead of the colour going
	 * out on a paper ground.
	 */
	test('the raw-palette exemption is safe: no rule anywhere references one', () => {
		const files = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
			.split('\n')
			.filter((f) => f && /\.(css|svelte|ts|html)$/.test(f));
		const users: string[] = [];
		for (const file of files) {
			const body = stripComments(readFileSync(join(process.cwd(), file), 'utf8'));
			for (const prop of Object.keys(RAW_PALETTE)) {
				if (new RegExp(`var\\(\\s*${prop}\\b`).test(body)) users.push(`${file}: var(${prop})`);
			}
		}
		expect(
			users,
			'A raw palette colour is the same on every ground. Referencing one puts a ' +
				'dark-ground colour on the paper sheet, which is the whole bug. Use the ' +
				'alias that carries it, or make this one an alias.'
		).toEqual([]);
	});

	/**
	 * THE PAIRED EXEMPTION IS SAFE ONLY WHILE THE PAIRS ARE COMPLETE. A team
	 * accent does not need two scopes because it names its ground in the
	 * property, but that only holds while both halves exist in the same rule:
	 * one half alone falls back through team-accents.css's var() chain to
	 * --text-2, and a team silently loses its colour on one ground.
	 */
	test('the ground-paired exemption is safe: every pair has both halves, in the same rule', () => {
		const css = stripComments(readFileSync(join(DS, 'team-accents.css'), 'utf8'));
		const broken: string[] = [];
		let seen = 0;
		for (const rule of rulesOf(css)) {
			const names = Object.keys(declarations(rule.body));
			for (const name of names) {
				const half = name.match(/^(.*)-on-(dark|light)$/);
				if (!half) continue;
				seen++;
				const other = `${half[1]}-on-${half[2] === 'dark' ? 'light' : 'dark'}`;
				if (!names.includes(other)) broken.push(`{${rule.sel}} has ${name} but not ${other}`);
			}
		}
		expect(seen, 'no paired properties were found; this case is testing nothing').toBe(66);
		expect(broken).toEqual([]);
	});
});

describe('the three named ground scopes agree with each other', () => {
	const dark = declarations(scopeBody(css, SCOPES.dark));
	const paper = declarations(scopeBody(css, SCOPES.paper));
	const deck = declarations(scopeBody(css, SCOPES.deck));
	const print = declarations(scopeBody(scopeBody(css, SCOPES.print), ':root {'));
	const names = Object.keys(dark);

	test('the dark scope is not empty, so the comparison below means something', () => {
		expect(names.length).toBeGreaterThan(40);
		expect(names).toContain('--bg0');
		expect(names).toContain('--accent');
		expect(names).toContain('--glow');
	});

	for (const [label, scope] of [
		['paper', paper],
		['deck', deck],
		['print', print]
	] as const) {
		test(`the ${label} scope declares every alias the dark scope does`, () => {
			const have = Object.keys(scope);
			const missing = names.filter((n) => !have.includes(n));
			const extra = have.filter((n) => !names.includes(n));
			expect(
				missing,
				`${label} is missing ${missing.length} alias(es). Each one SILENTLY keeps the ` +
					`dark ground's value on this scope: ${missing.join(', ')}`
			).toEqual([]);
			expect(extra, `${label} declares alias(es) no other scope has: ${extra.join(', ')}`).toEqual(
				[]
			);
		});
	}

	/**
	 * A var() in an alias is the bug in its original form: it resolves against
	 * the scope that DECLARED it, so it freezes one ground's answer into all of
	 * them. The values have to be literals.
	 */
	test('no alias in any scope references var()', () => {
		for (const [label, scope] of [
			['dark', dark],
			['paper', paper],
			['deck', deck],
			['print', print]
		] as const) {
			for (const [name, value] of Object.entries(scope)) {
				expect(
					/var\(/.test(value),
					`${label}: ${name} is "${value}". An alias must be a LITERAL: a var() ` +
						`resolves where it is declared, not where it is used.`
				).toBe(false);
				expect(value, `${label}: ${name} is empty`).not.toBe('');
			}
		}
	});

	test('the two grounds actually differ, so neither is a copy of the other', () => {
		const same = names.filter((n) => dark[n] === paper[n]);
		// A handful legitimately match: the FIRST rule gray is a published value
		// and --glow-strength is a number. Everything else must move.
		expect(same.length).toBeLessThan(6);
		expect(dark['--bg0']).not.toBe(paper['--bg0']);
		expect(dark['--accent']).not.toBe(paper['--accent']);
	});

	test('the paper scope flattens every glow, because a halo is mud on a sheet', () => {
		for (const [name, value] of Object.entries(paper)) {
			if (!/glow/.test(name)) continue;
			expect(['none', '0'], `paper: ${name} is "${value}"`).toContain(value);
		}
	});

	/** IDEA mint measures 1.27 on the bone sheet. It may not appear there. */
	test('IDEA mint is illegal on the paper ground', () => {
		const MINT = /#8fe08a|rgba?\(\s*143\s*,\s*224\s*,\s*138/i;
		for (const [name, value] of Object.entries(paper)) {
			expect(MINT.test(value), `paper: ${name} carries IDEA mint (${value})`).toBe(false);
		}
	});
});

/**
 * THE CONTROL. Remove one alias from one scope and the suite must go red.
 *
 * Without this, "every scope declares every alias" is a sentence that passes
 * whether or not the check works: the two scopes agree today, so an assertion
 * that never fails and an assertion that cannot fail look identical. This runs
 * the real comparison over a mutated copy of the real stylesheet.
 */
describe('the control: the check bites', () => {
	test('deleting one alias from the paper scope fails the comparison', () => {
		const mutated = css.replace("\t--accent-soft: rgba(34, 110, 29, 0.12);\n", '');
		expect(mutated, 'the mutation did not apply; the control is testing nothing').not.toBe(css);

		const dark = Object.keys(declarations(scopeBody(mutated, SCOPES.dark)));
		const paper = Object.keys(declarations(scopeBody(mutated, SCOPES.paper)));
		const missing = dark.filter((n) => !paper.includes(n));
		expect(missing).toEqual(['--accent-soft']);
	});

	/**
	 * THE CONTROL FOR THE WIDENED CHECK, AND IT IS THE ACTUAL BUG.
	 *
	 * `--season` is put back exactly as it shipped: one declaration, in the
	 * palette block whose selector list names all four ground selectors, and the
	 * two per-ground declarations removed. That is the state the previous alias
	 * test passed on for a whole bundle. A widened check that goes green on the
	 * bug it was written for has not been shown to work, so this runs the real
	 * enumeration over a mutated copy of the real stylesheet and requires
	 * --season to come back as the orphan.
	 */
	test('putting --season back in the shared palette block reddens the enumeration', () => {
		const original = stripComments(readFileSync(join(DS, 'colors.css'), 'utf8'));

		// Take EVERY --season declaration out, then put back exactly one, in the
		// shared palette block, which is where it shipped. The two reskin rules
		// are left standing and empty: a rule that declares nothing contributes
		// no site, so what is left is the original shape, one declaration whose
		// selector list names all four ground selectors at once.
		const stripped = original.replace(/^[ \t]*--season:[^;]+;[ \t]*$/gm, '');
		expect(stripped, 'no --season declarations were found to remove').not.toBe(original);
		const broken = stripped.replace(
			/(--program-rule:[^;]+;)/,
			'$1\n\t--season: #8fe08a;'
		);
		expect(broken, 'the palette block was not found; the control is testing nothing').not.toBe(
			stripped
		);

		const sites = colourSitesIn({ 'colors.css': broken });
		const list = sites.get('--season');
		expect(list, '--season vanished entirely; the mutation went too far').toHaveLength(1);
		expect(
			declaredPerGround(list!),
			'the enumeration accepted a --season with one shared declaration, which is ' +
				'precisely the defect it exists to catch'
		).toBe(false);

		// And the other direction, on the SHIPPED sheet, so this case fails if the
		// enumeration has simply started answering false to everything.
		expect(declaredPerGround(colourSites().get('--season')!)).toBe(true);
	});

	test('turning one literal into a var() fails the literals check', () => {
		const mutated = css.replace('--accent: #226e1d;', '--accent: var(--idea-mint);');
		expect(mutated).not.toBe(css);
		const paper = declarations(scopeBody(mutated, SCOPES.paper));
		expect(/var\(/.test(paper['--accent'])).toBe(true);
	});
});

/**
 * A LITERAL COLOUR INSIDE A COMPONENT IS THE SAME BUG WEARING A DIFFERENT HAT.
 * The token layer can only be the single source of colour if nothing outside it
 * names one, so this walks every tracked source file.
 *
 * The allowed list is short, explicit, and each entry says why the colour
 * cannot be a token. Adding to it is a decision, not a convenience.
 */
describe('nothing outside the token layer names a colour', () => {
	const ALLOWED: Record<string, string> = {
		'src/lib/parent/qr.ts':
			'a QR code is machine-readable and must be maximum-contrast black on white; ' +
			'a themed QR code is an unscannable QR code',
		'src/lib/brand/rules.ts':
			'LIGHT_PLATE is the white background FIRST full-colour artwork is specified ' +
			'for. It is FIRST’s requirement, and a ground that could retint it would ' +
			'be recolouring a mark',
		'src/routes/dev/route-planner/+page.svelte':
			'a dev fixture standing in for the copyrighted field layout, DRAWN BY THIS ' +
			'REPO. It is a picture, not chrome, and it has to be a LIGHT drawing or the ' +
			'harness is testing the easy case',
		'src/routes/dev/notebook/+page.svelte':
			'a dev fixture photo placeholder, drawn by this repo. Not chrome.'
	};

	test('every colour literal outside src/lib/design-system is on the allowed list', () => {
		const files = execFileSync(
			'git',
			['ls-files', 'src/**/*.svelte', 'src/**/*.css', 'src/**/*.ts', 'src/app.css', 'src/app.html'],
			{ encoding: 'utf8' }
		)
			.split('\n')
			.filter((f) => f && !f.startsWith('src/lib/design-system/'));

		const offenders: string[] = [];
		for (const file of files) {
			const body = stripComments(readFileSync(join(process.cwd(), file), 'utf8'));
			const hits = body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([\d\s,.]+\)|hsla?\([^)]*\)/g);
			if (!hits) continue;
			if (file in ALLOWED) continue;
			offenders.push(`${file}: ${[...new Set(hits)].join(' ')}`);
		}
		expect(
			offenders,
			'A colour outside the token layer cannot be retinted by a ground. Either use a ' +
				'token, or add the file to ALLOWED with the reason it cannot be one.'
		).toEqual([]);
	});

	test('the allowed list has no stale entries', () => {
		for (const file of Object.keys(ALLOWED)) {
			const body = stripComments(readFileSync(join(process.cwd(), file), 'utf8'));
			expect(
				/#[0-9a-fA-F]{3,8}\b|rgba?\([\d\s,.]+\)/.test(body),
				`${file} is on the allowed list but no longer carries a colour literal`
			).toBe(true);
		}
	});
});

describe('the type layer names a face through a token', () => {
	const typography = readFileSync(join(DS, 'typography.css'), 'utf8');

	test('the hero face is display only and the body face is separate', () => {
		expect(typography).toMatch(/--font-hero:\s*'Chakra Petch'/);
		expect(typography).toMatch(/--font-body:\s*'Rajdhani'/);
	});

	test('no component names a font family as a literal', () => {
		const files = execFileSync('git', ['ls-files', 'src/**/*.svelte', 'src/app.css'], {
			encoding: 'utf8'
		})
			.split('\n')
			.filter(Boolean);
		const offenders: string[] = [];
		for (const file of files) {
			const body = stripComments(readFileSync(join(process.cwd(), file), 'utf8'));
			for (const m of body.matchAll(/font-family:\s*([^;]+);/g)) {
				if (!m[1].includes('var(--font-')) offenders.push(`${file}: ${m[1].trim()}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
