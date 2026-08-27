// A ROUNDED DISPLAY MUST NEVER BE WRITTEN BACK.
//
// The generator's two geometry fields can be read in mm, cm or inches, and the
// row stores millimetres whichever is chosen. A field shows a ROUNDED number,
// because 2.2047244094488188 inches is not something anybody types. If that
// rounded number is ever converted back and stored, the row drifts: 56 mm shown
// as 2.205 in and written back is 56.007 mm. That is wrong by a hundredth of a
// percent, it looks entirely plausible, and it happens again on every save.
//
// The wheel diameter is the DIVISOR in the distance conversion, so the error
// scales every distance in every run and every intermediate value on the way
// there looks fine. These cases are what stops it.

import { describe, expect, test } from 'vitest';
import {
	CUSTOM_WHEEL,
	LENGTH_UNITS,
	UNIT_DECIMALS,
	WHEEL_PRESETS,
	boundsIn,
	commit,
	display,
	fixed,
	fromUnit,
	isLengthUnit,
	toUnit,
	wheelPresetFor,
	type LengthUnit
} from '../src/lib/codegen/units';
import { DEFAULT_CONFIG } from '../src/lib/codegen/defaults';
import type { RobotConfig } from '../src/lib/codegen/toolkit';

/**
 * What a number field does when nobody edits it: it hands back the text it was
 * given. The component paints `display(mm, unit)` into the box, so that string
 * is exactly what comes back out of an untouched field.
 */
function untouchedFieldEcho(mm: number, unit: LengthUnit): number {
	return Number(display(mm, unit));
}

describe('the required case: a saved config opened in another unit and saved unedited', () => {
	test('56 mm opened in inches and saved without editing is still exactly 56', () => {
		const savedMm = 56;

		// 1. The row comes back from the database and the field is painted.
		const shown = display(savedMm, 'in');
		expect(shown).toBe('2.205');

		// 2. Nobody edits it. The field hands its own display back.
		const echoed = untouchedFieldEcho(savedMm, 'in');
		expect(echoed).toBe(2.205);

		// 3. That is what commit() is handed, and what it must refuse to convert.
		const stored = commit(echoed, savedMm, 'in');
		expect(stored).toBe(56);
		// Exactly 56, not 56 to within a tolerance: this is the number that
		// becomes a literal in every generated file.
		expect(Object.is(stored, 56)).toBe(true);
	});

	/**
	 * THE PROOF THAT THE GUARD IS LOAD-BEARING. Without the first branch of
	 * commit(), the case above stores this instead, and nothing anywhere would
	 * say so. Mutating the check to `using (true)` is how this repo proves a
	 * boundary bites; this is the same move on arithmetic.
	 */
	test('the naive conversion, the one commit() refuses, really does drift', () => {
		const naive = fromUnit(untouchedFieldEcho(56, 'in'), 'in');
		expect(naive).toBe(56.007);
		expect(naive).not.toBe(56);
	});

	test('and it drifts again on every save, which is why it is invisible', () => {
		let mm = 56;
		for (let i = 0; i < 5; i++) mm = fromUnit(untouchedFieldEcho(mm, 'in'), 'in');
		// Five saves later, still a completely plausible wheel diameter.
		expect(mm).toBeGreaterThan(56);
		expect(mm).toBeLessThan(56.05);
		// Under commit(), the same five saves change nothing at all.
		let held = 56;
		for (let i = 0; i < 5; i++) held = commit(untouchedFieldEcho(held, 'in'), held, 'in');
		expect(held).toBe(56);
	});

	test('the whole config survives a unit round trip byte for byte', () => {
		const before: RobotConfig = { ...DEFAULT_CONFIG, wheelDiameterMm: 56, trackWidthMm: 112 };
		const after: RobotConfig = { ...before };
		// Open in inches, look at it, switch to cm, look at it, switch back, save.
		for (const unit of ['in', 'cm', 'in', 'mm'] as LengthUnit[]) {
			after.wheelDiameterMm = commit(
				untouchedFieldEcho(after.wheelDiameterMm, unit),
				after.wheelDiameterMm,
				unit
			);
			after.trackWidthMm = commit(
				untouchedFieldEcho(after.trackWidthMm, unit),
				after.trackWidthMm,
				unit
			);
		}
		expect(after).toEqual(before);
	});
});

describe('the control: a genuinely edited value DOES save', () => {
	test('typing 2.25 inches stores 57.15 mm, exactly', () => {
		const stored = commit(2.25, 56, 'in');
		expect(stored).toBe(57.15);
		// Not 57.150000000000006, which is what the multiplication alone returns
		// and what a numeric column would keep forever.
		expect(String(stored)).toBe('57.15');
	});

	test('typing 6.2 cm stores 62 mm, the wheel that makes 300 mm read 554 degrees', () => {
		expect(commit(6.2, 56, 'cm')).toBe(62);
	});

	test('typing in mm stores what was typed', () => {
		expect(commit(62, 56, 'mm')).toBe(62);
		expect(commit(43.2, 56, 'mm')).toBe(43.2);
	});

	test('an edit of a single display step is still an edit', () => {
		// 2.205 is the display of 56; 2.206 is one step away and must land.
		expect(commit(2.206, 56, 'in')).toBe(56.0324);
		expect(commit(2.206, 56, 'in')).not.toBe(56);
	});

	test('an unreadable or impossible box changes nothing', () => {
		expect(commit(Number.NaN, 56, 'in')).toBe(56);
		expect(commit(Number.POSITIVE_INFINITY, 56, 'mm')).toBe(56);
		// An empty box reads as 0, and 0 is not a wheel. 0024 checks `> 0` on
		// both columns and mmToDegrees would divide by it.
		expect(commit(Number(''), 56, 'mm')).toBe(56);
		expect(commit(0, 56, 'mm')).toBe(56);
		expect(commit(-5, 56, 'mm')).toBe(56);
	});

	test('a value mid-typing commits as typed, and the next keystroke corrects it', () => {
		// Typing "2.25" in inches passes through 2 and 2.2 on the way. Each is a
		// real number the person has actually typed, so each lands, the readout
		// moves as they type, and nothing is written to the database until Save.
		// The field's own text is never repainted underneath them.
		expect(commit(Number('2'), 56, 'in')).toBe(50.8);
		expect(commit(Number('2.2'), 50.8, 'in')).toBe(55.88);
		expect(commit(Number('2.25'), 55.88, 'in')).toBe(57.15);
	});
});

describe('the conversions themselves', () => {
	test('every unit round-trips a value that is exact in it', () => {
		expect(fromUnit(toUnit(56, 'mm'), 'mm')).toBe(56);
		expect(fromUnit(toUnit(56, 'cm'), 'cm')).toBe(56);
		expect(fromUnit(2.5, 'in')).toBe(63.5);
		expect(fromUnit(11.2, 'cm')).toBe(112);
	});

	test('each unit shows at least a tenth of a millimetre', () => {
		for (const unit of LENGTH_UNITS) {
			const oneStep = fromUnit(Number((1).toFixed(UNIT_DECIMALS[unit])), unit);
			const nextStep = fromUnit(
				Number((1 + 10 ** -UNIT_DECIMALS[unit]).toFixed(UNIT_DECIMALS[unit])),
				unit
			);
			expect(nextStep - oneStep).toBeLessThanOrEqual(0.1 + 1e-9);
		}
	});

	test('display rounds and fixed agrees with it', () => {
		expect(display(56, 'mm')).toBe('56.0');
		expect(display(56, 'cm')).toBe('5.60');
		expect(display(56, 'in')).toBe('2.205');
		expect(fixed(toUnit(56, 'in'), 'in')).toBe(display(56, 'in'));
	});

	test("the bounds follow 0024's millimetre checks into whatever unit is on screen", () => {
		expect(boundsIn('mm', 200).max).toBe(200);
		expect(boundsIn('cm', 200).max).toBe(20);
		expect(boundsIn('in', 200).max).toBe(7.874);
		expect(boundsIn('cm', 500).max).toBe(50);
		// The minimum is one display step, never zero: 0024 checks `> 0`.
		for (const unit of LENGTH_UNITS) expect(boundsIn(unit, 200).min).toBeGreaterThan(0);
	});

	test('isLengthUnit refuses anything that is not one of the three', () => {
		for (const unit of LENGTH_UNITS) expect(isLengthUnit(unit)).toBe(true);
		for (const bad of ['m', 'ft', '', null, undefined, 3, 'IN']) {
			expect(isLengthUnit(bad)).toBe(false);
		}
	});
});

describe('the wheel presets', () => {
	test('the three offered wheels are exact millimetres', () => {
		expect(WHEEL_PRESETS.map((w) => w.mm)).toEqual([56, 43.2, 88]);
	});

	test('a stored diameter reads back as its preset, and anything else as Custom', () => {
		expect(wheelPresetFor(56)).toBe('56');
		expect(wheelPresetFor(43.2)).toBe('43.2');
		expect(wheelPresetFor(88)).toBe('88');
		expect(wheelPresetFor(62)).toBe(CUSTOM_WHEEL);
		// 56.007, the drift the guard above prevents, is NOT the standard wheel,
		// which is the other way a silent drift would eventually show itself.
		expect(wheelPresetFor(56.007)).toBe(CUSTOM_WHEEL);
	});

	test('picking a preset stores the exact number whatever unit is on screen', () => {
		// The preset writes millimetres directly: it never goes through the field,
		// so it never goes through a rounding.
		for (const w of WHEEL_PRESETS) {
			for (const unit of LENGTH_UNITS) {
				expect(commit(untouchedFieldEcho(w.mm, unit), w.mm, unit)).toBe(w.mm);
			}
		}
	});
});
