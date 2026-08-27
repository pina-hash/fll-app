/**
 * LENGTH UNITS FOR THE TWO GEOMETRY FIELDS, AND NOTHING ELSE.
 *
 * STORAGE STAYS MILLIMETRES. `robot_configs.wheel_diameter_mm` and
 * `track_width_mm` do not change, no migration is involved, and a unit never
 * reaches the database: this is a DISPLAY PREFERENCE, remembered per device
 * next to the theme, and a team's robot configuration is the same row whichever
 * way a mentor likes to read a tape measure.
 *
 * THE WHOLE POINT OF THIS FILE IS `commit()`. A field shows a ROUNDED number,
 * because 2.2047244094488188 inches is not something anybody types or reads. If
 * that rounded number is ever converted back and stored, the row drifts: 56 mm
 * shown as 2.205 in and written back is 56.007 mm, which looks completely
 * plausible, is wrong by 0.01 percent, and does it again on every save. The
 * wheel diameter is the DIVISOR in the distance conversion, so that error
 * scales every distance in every run, and every intermediate value on the way
 * there looks fine.
 *
 * So: convert once on entry, keep the exact result, round only for display, and
 * never save what the display showed.
 */

export const LENGTH_UNITS = ['mm', 'cm', 'in'] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

/** What the label says. Fourth grade: "inches", not "in". */
export const UNIT_LABEL: Record<LengthUnit, string> = {
	mm: 'mm',
	cm: 'cm',
	in: 'inches'
};

/** What the readout says, where space is tight. */
export const UNIT_SHORT: Record<LengthUnit, string> = { mm: 'mm', cm: 'cm', in: 'in' };

const MM_PER_UNIT: Record<LengthUnit, number> = { mm: 1, cm: 10, in: 25.4 };

/**
 * How many decimals the FIELD shows. Each one is at least as fine as a tenth
 * of a millimetre, which is finer than anybody can read off a part: 0.01 cm is
 * 0.1 mm exactly, and 0.001 in is 0.0254 mm.
 */
export const UNIT_DECIMALS: Record<LengthUnit, number> = { mm: 1, cm: 2, in: 3 };

/** The number input's step, matching what the field is willing to show. */
export const UNIT_STEP: Record<LengthUnit, number> = { mm: 0.1, cm: 0.01, in: 0.001 };

/**
 * Where IEEE-754 dust is cut off, in decimals of a millimetre.
 *
 * NOT display rounding, and the difference matters. `2.25 * 25.4` is
 * 57.150000000000006 in this language, and a `numeric` column would store that
 * verbatim and hand it back forever. Six decimals of a millimetre is a
 * nanometre: far below any measurement, far above the dust.
 */
const MM_DUST_DECIMALS = 6;

export function isLengthUnit(value: unknown): value is LengthUnit {
	return value === 'mm' || value === 'cm' || value === 'in';
}

/** The per-device key. Sits beside `fll-theme`, and for the same reason. */
export const LENGTH_UNIT_STORAGE_KEY = 'fll-codegen-length-unit';

/** Millimetres out of the row, into the unit on screen. */
export function toUnit(mm: number, unit: LengthUnit): number {
	return mm / MM_PER_UNIT[unit];
}

/** A number typed in `unit`, into the millimetres the row stores. */
export function fromUnit(value: number, unit: LengthUnit): number {
	return Number((value * MM_PER_UNIT[unit]).toFixed(MM_DUST_DECIMALS));
}

/** The rounded text a field shows for a value ALREADY in `unit`. */
export function fixed(value: number, unit: LengthUnit): string {
	return value.toFixed(UNIT_DECIMALS[unit]);
}

/** The rounded text a field shows for a value stored in millimetres. */
export function display(mm: number, unit: LengthUnit): string {
	return fixed(toUnit(mm, unit), unit);
}

/**
 * What a field hands back, turned into what the row should hold.
 *
 * THE GUARD IS THE FIRST BRANCH, and it is the whole reason this function
 * exists rather than a bare `fromUnit()` on the input event. The field only
 * ever SHOWED a rounded number. If what comes back is that same rounded
 * number, nobody edited it: the field is echoing its own display, and
 * converting that back would write the rounding error into the row. So the
 * exact current value is returned untouched, and 56 mm opened in inches and
 * saved is still exactly 56 mm.
 *
 * The trade, stated rather than hidden: retyping the number the field is
 * already showing is a no-op, because the field's resolution IS its display
 * precision and there is no way to tell the two apart. Anyone who genuinely
 * wants 56.007 mm has to switch the field to mm, where it can be said.
 */
export function commit(typed: number, currentMm: number, unit: LengthUnit): number {
	// A blank box reads as 0 and a half-typed one can read as anything; neither
	// is a measurement. 0024 checks `> 0` on both columns, so a value that could
	// never be stored is not accepted here either, and zero in particular would
	// make mmToDegrees divide by it.
	if (!Number.isFinite(typed) || typed <= 0) return currentMm;
	if (fixed(typed, unit) === display(currentMm, unit)) return currentMm;
	return fromUnit(typed, unit);
}

/** A field's bounds, converted from the millimetre bounds 0024 enforces. */
export function boundsIn(unit: LengthUnit, maxMm: number): { min: number; max: number } {
	return { min: UNIT_STEP[unit], max: Number(toUnit(maxMm, unit).toFixed(UNIT_DECIMALS[unit])) };
}

/**
 * The three wheels a team is likely to have, plus Custom.
 *
 * IT IS READ OFF THE PART, NOT MEASURED. A tyre carries its size moulded into
 * the sidewall, and reading it beats putting a ruler across a rubber curve. It
 * is also the divisor in the distance conversion, so a wheel entered 10 percent
 * small makes every drive in every run 10 percent long, and nothing on the
 * robot says so. Picking from a list is how that stops being a typing mistake.
 */
export const WHEEL_PRESETS: readonly { mm: number; label: string }[] = [
	{ mm: 56, label: '56 mm (the standard SPIKE wheel)' },
	{ mm: 43.2, label: '43.2 mm (the small wheel)' },
	{ mm: 88, label: '88 mm (the big wheel)' }
] as const;

export const CUSTOM_WHEEL = 'custom';

/** Which preset a stored diameter IS, or Custom. Exact match only. */
export function wheelPresetFor(mm: number): string {
	const hit = WHEEL_PRESETS.find((p) => p.mm === mm);
	return hit ? String(hit.mm) : CUSTOM_WHEEL;
}
