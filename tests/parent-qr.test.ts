// tests/parent-qr.test.ts
//
// THE QR ON A PARENT CARD IS THE ONE THING NOBODY CAN EYEBALL. A code that is
// subtly wrong still LOOKS like a QR code; the failure appears as a parent in
// a car park whose phone will not read the card, weeks later, with nothing to
// debug. So this file reads the modules back out of the SVG path the card
// prints and checks the STRUCTURE the spec requires: the quiet zone is empty,
// the three finder patterns are where a scanner looks for them, and the timing
// pattern alternates.
//
// It is not re-implementing QR encoding -- qrcode-generator is the reference
// implementation and has its own tests. It is checking the layer this repo
// wrote: modules to path commands to viewBox, which is exactly where an
// off-by-one becomes an unscannable card.
//
// Pure functions; no database, no stack.

import { describe, expect, test } from 'vitest';
import { parentUrl, qrSvg } from '../src/lib/parent/qr';

const MARGIN = 4;

/**
 * The dark modules, read back out of the rendered path. Every command is
 * `M{x} {y}h1v1h-1z` in MODULE coordinates, so parsing it is how this test
 * sees what a scanner would see.
 */
function readModules(svg: string): { dark: Set<string>; span: number; count: number } {
	const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
	expect(viewBox).not.toBeNull();
	const span = Number(viewBox![1]);
	expect(Number(viewBox![2])).toBe(span);

	const path = /<path d="([^"]*)"/.exec(svg);
	expect(path).not.toBeNull();

	const dark = new Set<string>();
	const re = /M(\d+) (\d+)h1v1h-1z/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(path![1])) !== null) {
		dark.add(`${Number(match[1]) - MARGIN},${Number(match[2]) - MARGIN}`);
	}
	// Every command in the path was one of ours: nothing unparsed is left.
	expect(path![1].replace(re, '')).toBe('');

	return { dark, span, count: span - MARGIN * 2 };
}

const isDark = (dark: Set<string>, col: number, row: number) => dark.has(`${col},${row}`);

describe('the card the parent scans', () => {
	const url = parentUrl('https://fll.boscotech.edu', 'a'.repeat(64));
	const svg = qrSvg(url);
	const { dark, span, count } = readModules(svg);

	test('the URL is exactly origin + /p/ + token, with no double slash', () => {
		expect(url).toBe(`https://fll.boscotech.edu/p/${'a'.repeat(64)}`);
		// A trailing slash on the origin must not produce `//p/`.
		expect(parentUrl('https://fll.boscotech.edu/', 'b'.repeat(64))).toBe(
			`https://fll.boscotech.edu/p/${'b'.repeat(64)}`
		);
	});

	test('it is a real QR symbol: odd, square, at least version 1, with the spec quiet zone', () => {
		// Every QR version is 21, 25, 29 ... modules: 4 * version + 17.
		expect((count - 17) % 4).toBe(0);
		expect(count).toBeGreaterThanOrEqual(21);
		expect(span).toBe(count + MARGIN * 2);
		// A parent link is 80-odd characters, so it cannot fit in version 1.
		expect(count).toBeGreaterThan(21);
		expect(dark.size).toBeGreaterThan(count * 2);
	});

	test('the quiet zone is empty on all four sides', () => {
		// Nothing was emitted outside the symbol: the path only ever offsets by
		// the margin, so a module at -1 would mean the offset was applied twice.
		for (const key of dark) {
			const [col, row] = key.split(',').map(Number);
			expect(col).toBeGreaterThanOrEqual(0);
			expect(row).toBeGreaterThanOrEqual(0);
			expect(col).toBeLessThan(count);
			expect(row).toBeLessThan(count);
		}
	});

	test('the three finder patterns are where a scanner looks for them', () => {
		// A finder is a 7x7: dark ring, light ring, 3x3 dark core. All three
		// corners except bottom-right carry one.
		for (const [ox, oy] of [
			[0, 0],
			[count - 7, 0],
			[0, count - 7]
		]) {
			for (let i = 0; i < 7; i++) {
				expect({ at: `${ox + i},${oy} top`, dark: isDark(dark, ox + i, oy) }).toEqual({
					at: `${ox + i},${oy} top`,
					dark: true
				});
				expect(isDark(dark, ox + i, oy + 6)).toBe(true);
				expect(isDark(dark, ox, oy + i)).toBe(true);
				expect(isDark(dark, ox + 6, oy + i)).toBe(true);
			}
			// The light separator ring.
			for (let i = 1; i < 6; i++) {
				expect({ at: `${ox + i},${oy + 1}`, dark: isDark(dark, ox + i, oy + 1) }).toEqual({
					at: `${ox + i},${oy + 1}`,
					dark: false
				});
				expect(isDark(dark, ox + i, oy + 5)).toBe(false);
			}
			// The 3x3 core.
			for (let x = 2; x <= 4; x++) {
				for (let y = 2; y <= 4; y++) {
					expect({ at: `${ox + x},${oy + y}`, dark: isDark(dark, ox + x, oy + y) }).toEqual({
						at: `${ox + x},${oy + y}`,
						dark: true
					});
				}
			}
		}

		// NEGATIVE CONTROL: the bottom-right corner has NO finder pattern, which
		// is what tells a scanner which way up the symbol is. If the three
		// assertions above passed on a matrix of all-dark modules, this fails.
		const bottomRight = [0, 1, 2, 3, 4, 5, 6].map((i) => isDark(dark, count - 7 + i, count - 7));
		expect(bottomRight.every(Boolean)).toBe(false);
	});

	test('the timing pattern alternates along row 6 and column 6', () => {
		for (let i = 8; i < count - 8; i++) {
			expect({ i, row6: isDark(dark, i, 6) }).toEqual({ i, row6: i % 2 === 0 });
			expect({ i, col6: isDark(dark, 6, i) }).toEqual({ i, col6: i % 2 === 0 });
		}
	});

	test('two different tokens make two different symbols', () => {
		const other = readModules(qrSvg(parentUrl('https://fll.boscotech.edu', 'c'.repeat(64))));
		expect(other.count).toBe(count);
		const same = [...dark].filter((k) => other.dark.has(k)).length;
		// The finders, timing and format bits are shared; the data area is not.
		expect(same).toBeLessThan(dark.size);
	});

	test('it prints black on white whatever the viewer theme is', () => {
		// The console is dark. A QR rendered in theme colours is unscannable, so
		// the two colours are literals here and nowhere else in this repo.
		expect(svg).toContain('fill="#ffffff"');
		expect(svg).toContain('fill="#000000"');
		expect(svg).toContain('shape-rendering="crispEdges"');
		expect(svg).toContain('role="img"');
	});

	test('a longer payload grows the symbol rather than truncating it', () => {
		const small = readModules(qrSvg('https://x.example/p/short'));
		const big = readModules(qrSvg(`https://a-much-longer-host.example/p/${'d'.repeat(200)}`));
		expect(small.count).toBeLessThan(big.count);
	});
});
