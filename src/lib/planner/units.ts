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

import {
	MAT_HEIGHT_MM,
	MAT_ORIGIN_X_MM,
	MAT_ORIGIN_Y_MM,
	MAT_WIDTH_MM,
	TABLE_HEIGHT_MM,
	TABLE_WIDTH_MM
} from './geometry';

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
 * AXIS TICKS, AND WHICH RECTANGLE EACH SERIES IS ABOUT.
 *
 * There are two rectangles on this canvas (geometry.ts) and a tick that does
 * not say which one it belongs to is worse than no tick. So there are two
 * series per axis, and every tick's `mm` is a position in TABLE millimetres
 * -- the drawing's one coordinate space -- while its LABEL is a reading in
 * whichever rectangle the series is about.
 *
 * THE TABLE SERIES IS THE PRIMARY ONE, because the table is what the numbers
 * mean. Every waypoint and every mission position is stored in table
 * millimetres, a waypoint may legitimately sit on bare table beside the mat,
 * and the movement list measures the drives between them. A student reading
 * "1500" off the x axis and typing it into anything must get the number the
 * database holds. It is also the series inches were always for: the table is
 * exactly 93 by 45 inches, which is where those round foot marks come from.
 * They were labelled as the mat's for six bundles and they were never the
 * mat's.
 *
 * THE MAT SERIES IS TWO TICKS PER AXIS: where the printed sheet starts and
 * where it ends, labelled in the mat's OWN coordinates so the second one
 * reads as the mat's size. That is what a child standing at the table needs
 * in order to point at the schematic and at the sheet and see the same
 * thing, and it is the reading the table series cannot give: on the x axis
 * the mat begins at table 181 and a mat-relative 0.
 *
 * MatCanvas draws the table series on the bottom and left edges and the mat
 * series on the mat's top and right edges, so no two labels can collide
 * however narrow the screen gets.
 */
export interface AxisTick {
	/** Where the tick sits, in TABLE millimetres: the drawing's own space. */
	mm: number;
	/** What it reads, in the chosen unit and in its own series' rectangle. */
	label: string;
}

const X_MM = [0, 500, 1000, 1500, 2000, TABLE_WIDTH_MM];
const Y_MM = [0, 500, 1000, TABLE_HEIGHT_MM];
const X_IN = [0, 12, 24, 36, 48, 60, 72, 84, 93];
const Y_IN = [0, 12, 24, 36, 45];

function metricTicks(positions: number[], unit: LengthUnit): AxisTick[] {
	return positions.map((mm) => ({ mm, label: trim1(fromMm(mm, unit)) }));
}

/** 93 in is 2362.2 mm and the table is stored as 2362; pin the tick to the edge. */
function inchTicks(positions: number[], edgeMm: number): AxisTick[] {
	return positions.map((inches) => ({
		mm: Math.min(edgeMm, toMm(inches, 'in')),
		label: String(inches)
	}));
}

export function xAxisTicks(unit: LengthUnit): AxisTick[] {
	return unit === 'in' ? inchTicks(X_IN, TABLE_WIDTH_MM) : metricTicks(X_MM, unit);
}

export function yAxisTicks(unit: LengthUnit): AxisTick[] {
	return unit === 'in' ? inchTicks(Y_IN, TABLE_HEIGHT_MM) : metricTicks(Y_MM, unit);
}

/**
 * The mat's two edges on an axis: positioned in table millimetres, labelled
 * in the mat's own. The far label is therefore the mat's size in the chosen
 * unit, which is the one number this screen must never appear to be asking
 * anybody for.
 */
function matEdgeTicks(originMm: number, extentMm: number, unit: LengthUnit): AxisTick[] {
	return [
		{ mm: originMm, label: trim1(fromMm(0, unit)) },
		{ mm: originMm + extentMm, label: trim1(fromMm(extentMm, unit)) }
	];
}

export function xMatTicks(unit: LengthUnit): AxisTick[] {
	return matEdgeTicks(MAT_ORIGIN_X_MM, MAT_WIDTH_MM, unit);
}

export function yMatTicks(unit: LengthUnit): AxisTick[] {
	return matEdgeTicks(MAT_ORIGIN_Y_MM, MAT_HEIGHT_MM, unit);
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
