/**
 * The planner's length-unit preference: conversion, formatting and the axis
 * tick tables, proved by arithmetic the way geometry.ts was. Display only:
 * nothing here touches a row, so no stack is needed.
 */
import { describe, expect, it } from 'vitest';
import {
	formatLength,
	fromMm,
	loadUnit,
	toMm,
	unitWord,
	xAxisTicks,
	xMatTicks,
	yAxisTicks,
	yMatTicks,
	type LengthUnit
} from '../src/lib/planner/units';
import {
	MAT_HEIGHT_MM,
	MAT_ORIGIN_X_MM,
	MAT_WIDTH_MM,
	TABLE_HEIGHT_MM,
	TABLE_WIDTH_MM
} from '../src/lib/planner/geometry';

describe('conversion', () => {
	it('round-trips every unit', () => {
		for (const unit of ['mm', 'cm', 'in'] as LengthUnit[]) {
			expect(toMm(fromMm(1234, unit), unit)).toBeCloseTo(1234, 9);
		}
	});

	it('uses the exact inch', () => {
		expect(toMm(1, 'in')).toBe(25.4);
		// 93 by 45 inches is the TABLE. The mat is not a whole number of
		// inches on either axis, which is exactly why the inch ticks belong
		// to the table series and not to the mat one.
		expect(fromMm(TABLE_WIDTH_MM, 'in')).toBeCloseTo(92.99, 1);
		expect(fromMm(TABLE_HEIGHT_MM, 'in')).toBe(45);
		expect(fromMm(MAT_WIDTH_MM, 'in')).toBeCloseTo(78.74, 2);
		expect(fromMm(MAT_HEIGHT_MM, 'in')).toBeCloseTo(44.65, 2);
	});
});

describe('formatLength', () => {
	it('shows whole millimeters and one decimal in coarser units', () => {
		expect(formatLength(1000, 'mm')).toBe('1000 mm');
		expect(formatLength(1000, 'cm')).toBe('100.0 cm');
		expect(formatLength(1000, 'in')).toBe('39.4 in');
	});

	it('rounds rather than truncates', () => {
		expect(formatLength(1005.6, 'mm')).toBe('1006 mm');
		expect(formatLength(1005.6, 'cm')).toBe('100.6 cm');
	});
});

describe('axis ticks', () => {
	it('labels metric ticks at the metric positions', () => {
		expect(xAxisTicks('mm').map((t) => t.label)).toEqual(['0', '500', '1000', '1500', '2000', '2362']);
		expect(xAxisTicks('cm').map((t) => t.label)).toEqual(['0', '50', '100', '150', '200', '236.2']);
		expect(yAxisTicks('cm').map((t) => t.label)).toEqual(['0', '50', '100', '114.3']);
		// The positions themselves never convert: they are the drawing's mm.
		expect(xAxisTicks('cm').map((t) => t.mm)).toEqual([0, 500, 1000, 1500, 2000, TABLE_WIDTH_MM]);
	});

	it('gives inches their own round-number ticks', () => {
		const labels = xAxisTicks('in').map((t) => t.label);
		expect(labels[0]).toBe('0');
		expect(labels[labels.length - 1]).toBe('93');
		expect(yAxisTicks('in').map((t) => t.label)).toEqual(['0', '12', '24', '36', '45']);
	});

	it('pins the inch edge tick to the TABLE edge, never past it', () => {
		// 93 in is 2362.2 mm; the stored table is 2362. The tick must not
		// overhang the frame.
		const last = xAxisTicks('in').at(-1)!;
		expect(last.mm).toBe(TABLE_WIDTH_MM);
		for (const t of [...xAxisTicks('in'), ...yAxisTicks('in')]) {
			expect(t.mm).toBeGreaterThanOrEqual(0);
		}
		expect(Math.max(...yAxisTicks('in').map((t) => t.mm))).toBe(TABLE_HEIGHT_MM);
	});
});

describe('the MAT series: positioned on the table, labelled in the mat', () => {
	it('marks where the printed sheet starts and ends', () => {
		// Position is always the drawing's table millimetres...
		expect(xMatTicks('mm').map((t) => t.mm)).toEqual([MAT_ORIGIN_X_MM, MAT_ORIGIN_X_MM + MAT_WIDTH_MM]);
		expect(yMatTicks('mm').map((t) => t.mm)).toEqual([0, MAT_HEIGHT_MM]);
		// ...and the LABEL is the mat's own reading, so the far one is the
		// mat's size. A student reads 0 where the sheet begins, at table 181.
		expect(xMatTicks('mm').map((t) => t.label)).toEqual(['0', '2000']);
		expect(xMatTicks('cm').map((t) => t.label)).toEqual(['0', '200']);
		expect(yMatTicks('cm').map((t) => t.label)).toEqual(['0', '113.4']);
		expect(xMatTicks('in').map((t) => t.label)).toEqual(['0', '78.7']);
	});

	it('shares the bottom edge with the table series and nothing else', () => {
		// On x the two series cannot land together: 181 and 2181 are not round
		// table numbers. On y they DO share one position, and it is the true
		// one -- the mat is flush with the bottom wall, so mat 0 and table 0
		// are the same line. That is the reason the two series are drawn on
		// OPPOSITE edges in MatCanvas rather than trusted not to overlap.
		const tableX = new Set(xAxisTicks('cm').map((t) => t.mm));
		for (const t of xMatTicks('cm')) expect(tableX.has(t.mm)).toBe(false);

		const tableY = new Set(yAxisTicks('cm').map((t) => t.mm));
		expect(yMatTicks('cm').filter((t) => tableY.has(t.mm)).map((t) => t.mm)).toEqual([0]);
	});
});

describe('the preference', () => {
	it('falls back to centimeters where storage does not exist', () => {
		// Node has no localStorage; the guarded read must answer the default
		// rather than throw.
		expect(loadUnit()).toBe('cm');
	});

	it('names the units for an axis caption', () => {
		expect(unitWord('mm')).toBe('mm');
		expect(unitWord('cm')).toBe('cm');
		expect(unitWord('in')).toBe('inches');
	});
});
