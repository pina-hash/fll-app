/**
 * LENGTH UNITS FOR THE PLANNER, DEFINED ONCE. Students code their robots in
 * whatever unit their block set and their ruler speak, so every length the
 * planner SHOWS follows one switchable preference: millimeters, centimeters
 * or inches. The preference is display only: the model, the database, the
 * geometry and every persisted row stay in millimeters (waypoints,
 * missions, mat_config) or the stored column's own unit (team_robots'
 * speed_cm_s), exactly as before. Converting in one module is what keeps a
 * second implementation of 25.4 from drifting into a screen.
 *
 * The preference is a per-device convenience, stored like the coach's
 * dismissal: localStorage, guarded, defaulting to centimeters (the unit the
 * students' SPIKE Prime blocks default to, and what the movement list has
 * always shown).
 */

import { MAT_HEIGHT_MM, MAT_WIDTH_MM } from './geometry';

export type LengthUnit = 'mm' | 'cm' | 'in';

export const LENGTH_UNITS: { id: LengthUnit; label: string; word: string }[] = [
	{ id: 'mm', label: 'mm', word: 'millimeters' },
	{ id: 'cm', label: 'cm', word: 'centimeters' },
	{ id: 'in', label: 'in', word: 'inches' }
];

const MM_PER: Record<LengthUnit, number> = { mm: 1, cm: 10, in: 25.4 };

export function fromMm(mm: number, unit: LengthUnit): number {
	return mm / MM_PER[unit];
}

export function toMm(value: number, unit: LengthUnit): number {
	return value * MM_PER[unit];
}

/** One decimal, with trailing .0 dropped: "50", "236.2", "39.4". */
function trim1(v: number): string {
	const r = Math.round(v * 10) / 10;
	return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * A length for the movement list and the launch summary: whole millimeters,
 * or one decimal in the coarser units where a whole number would throw away
 * up to a centimeter ("1000 mm", "100.0 cm", "39.4 in").
 */
export function formatLength(mm: number, unit: LengthUnit): string {
	const v = fromMm(mm, unit);
	const text = unit === 'mm' ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1);
	return `${text} ${unit}`;
}

/** What an axis caption calls the unit: "mm", "cm", "inches". */
export function unitWord(unit: LengthUnit): string {
	return unit === 'in' ? 'inches' : unit;
}

/**
 * Axis ticks for the mat. Positions are ALWAYS millimeters (the drawing's
 * coordinate space); only the labels convert. Metric units label the metric
 * tick positions; inches get their own round-number ticks, because the mat
 * is exactly 93 by 45 inches and "39.4" up an axis helps nobody.
 */
export interface AxisTick {
	mm: number;
	label: string;
}

const X_MM = [0, 500, 1000, 1500, 2000, MAT_WIDTH_MM];
const Y_MM = [0, 500, 1000, MAT_HEIGHT_MM];
const X_IN = [0, 12, 24, 36, 48, 60, 72, 84, 93];
const Y_IN = [0, 12, 24, 36, 45];

function metricTicks(positions: number[], unit: LengthUnit): AxisTick[] {
	return positions.map((mm) => ({ mm, label: trim1(fromMm(mm, unit)) }));
}

/** The mat edge in inches lands 0.2 mm past the stored 2362; pin the tick to the edge. */
function inchTicks(positions: number[], edgeMm: number): AxisTick[] {
	return positions.map((inches) => ({
		mm: Math.min(edgeMm, toMm(inches, 'in')),
		label: String(inches)
	}));
}

export function xAxisTicks(unit: LengthUnit): AxisTick[] {
	return unit === 'in' ? inchTicks(X_IN, MAT_WIDTH_MM) : metricTicks(X_MM, unit);
}

export function yAxisTicks(unit: LengthUnit): AxisTick[] {
	return unit === 'in' ? inchTicks(Y_IN, MAT_HEIGHT_MM) : metricTicks(Y_MM, unit);
}

/** The stored per-device preference; centimeters until somebody chooses. */
const UNIT_KEY = 'fll-planner-units';

export function loadUnit(): LengthUnit {
	try {
		const raw = localStorage.getItem(UNIT_KEY);
		if (raw === 'mm' || raw === 'cm' || raw === 'in') return raw;
	} catch {
		// No storage: the default stands for this visit.
	}
	return 'cm';
}

export function saveUnit(unit: LengthUnit): void {
	try {
		localStorage.setItem(UNIT_KEY, unit);
	} catch {
		// Then the choice lasts the session; still switchable.
	}
}
