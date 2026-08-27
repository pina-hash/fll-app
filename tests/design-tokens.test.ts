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
import { readFileSync } from 'node:fs';
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
	print: '\n@media print {'
};

describe('every ground scope declares the complete alias set', () => {
	const dark = declarations(scopeBody(css, SCOPES.dark));
	const paper = declarations(scopeBody(css, SCOPES.paper));
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
