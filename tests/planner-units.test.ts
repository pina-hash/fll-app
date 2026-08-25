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
	yAxisTicks,
	type LengthUnit
} from '../src/lib/planner/units';
import { MAT_HEIGHT_MM, MAT_WIDTH_MM } from '../src/lib/planner/geometry';

describe('conversion', () => {
	it('round-trips every unit', () => {
		for (const unit of ['mm', 'cm', 'in'] as LengthUnit[]) {
			expect(toMm(fromMm(1234, unit), unit)).toBeCloseTo(1234, 9);
		}
	});

	it('uses the exact inch', () => {
		expect(toMm(1, 'in')).toBe(25.4);
		expect(fromMm(MAT_WIDTH_MM, 'in')).toBeCloseTo(92.99, 1);
		expect(fromMm(MAT_HEIGHT_MM, 'in')).toBe(45);
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
		expect(xAxisTicks('cm').map((t) => t.mm)).toEqual([0, 500, 1000, 1500, 2000, MAT_WIDTH_MM]);
	});

	it('gives inches their own round-number ticks', () => {
		const labels = xAxisTicks('in').map((t) => t.label);
		expect(labels[0]).toBe('0');
		expect(labels[labels.length - 1]).toBe('93');
		expect(yAxisTicks('in').map((t) => t.label)).toEqual(['0', '12', '24', '36', '45']);
	});

	it('pins the inch edge tick to the mat edge, never past it', () => {
		// 93 in is 2362.2 mm; the stored mat is 2362. The tick must not
		// overhang the frame.
		const last = xAxisTicks('in').at(-1)!;
		expect(last.mm).toBe(MAT_WIDTH_MM);
		for (const t of [...xAxisTicks('in'), ...yAxisTicks('in')]) {
			expect(t.mm).toBeGreaterThanOrEqual(0);
		}
		expect(Math.max(...yAxisTicks('in').map((t) => t.mm))).toBe(MAT_HEIGHT_MM);
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
