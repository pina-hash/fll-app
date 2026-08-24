/**
 * TWO-CORNER MAT CALIBRATION. The one implementation of "where on this
 * picture is mat millimetre (x, y)", and its inverse.
 *
 * WHY THIS FILE EXISTS. The first background layer stretched the uploaded
 * picture edge to edge across the 2362 by 1143 mm mat rectangle and trusted
 * the mentor to have cropped exactly to the playing surface. A real field
 * layout image includes the border walls, so it is TALLER and less wide than
 * the surface it contains: stretching it puts every mission marker somewhere
 * the model is not. The error is invisible -- the picture still fills the
 * rectangle and still looks like a mat -- and it costs a team a mission at
 * the tournament. So the picture is never stretched to fit. A mentor states
 * where the playing surface is by tapping two corners, and everything else is
 * arithmetic.
 *
 * THE TWO TAPS. First the corner of the PLAYING SURFACE on the launch area
 * side, which is mat (0, 0) by the coordinate system geometry.ts fixes. Then
 * the diagonally opposite corner, which is mat (MAT_WIDTH_MM,
 * MAT_HEIGHT_MM). Two opposite corners of an axis-aligned rectangle pin an
 * origin and an independent scale on each axis -- which is exactly the
 * freedom a photo of a mat inside its walls needs, and no more. It cannot
 * model rotation or perspective, and it does not pretend to: a picture taken
 * at an angle is the wrong picture, not a harder transform.
 *
 * COORDINATES. Image points are FRACTIONS of the image's own width and
 * height, u across and v DOWN, so a calibration survives the same picture
 * being re-encoded at another resolution and never stores a pixel count that
 * could disagree with the file. Mat points are millimetres, y UP, origin at
 * the launch area corner: geometry.ts's convention, unchanged.
 *
 * ORIENTATION IS FREE. Nothing here assumes the launch corner is at the
 * bottom left of the picture. The two fractions are subtracted in the order
 * the mentor tapped them, so a picture that is upside down, mirrored, or
 * turned end for end produces negative scale factors and maps correctly
 * anyway. The tests pin all four orientations.
 */
import { MAT_HEIGHT_MM, MAT_WIDTH_MM, type PointMm } from './geometry';

/** A point on the picture, as a fraction of its width and height. v is DOWN. */
export interface ImagePoint {
	u: number;
	v: number;
}

/** The two taps: opposite corners of the playing surface, on the picture. */
export interface MatCalibration {
	/** The launch-area-side corner of the playing surface. Mat (0, 0). */
	origin: ImagePoint;
	/** The diagonally opposite corner. Mat (MAT_WIDTH_MM, MAT_HEIGHT_MM). */
	far: ImagePoint;
}

/**
 * The smallest span, as a fraction of the picture, that either axis of a
 * calibration may have. Two taps a few pixels apart would divide by nearly
 * zero and throw the mat kilometres off the picture; the number is loose
 * because a legible photograph of a mat never fills less than a twentieth of
 * its own frame, and tight because anything smaller is a mis-tap.
 */
export const MIN_CALIBRATION_SPAN = 0.05;

/** How far the far corner is from the origin corner, per axis. Signed. */
function spanU(cal: MatCalibration): number {
	return cal.far.u - cal.origin.u;
}
function spanV(cal: MatCalibration): number {
	return cal.far.v - cal.origin.v;
}

/**
 * Whether this calibration can be inverted at all. A calibration that fails
 * here is never stored and never drawn: the picture stays hidden and the
 * mentor is asked to tap again, which is the honest answer. Guessing (a
 * stretch to fit) is the bug this whole file replaces.
 */
export function isUsableCalibration(cal: MatCalibration | null | undefined): cal is MatCalibration {
	if (!cal) return false;
	for (const n of [cal.origin.u, cal.origin.v, cal.far.u, cal.far.v]) {
		if (!Number.isFinite(n)) return false;
	}
	return Math.abs(spanU(cal)) >= MIN_CALIBRATION_SPAN && Math.abs(spanV(cal)) >= MIN_CALIBRATION_SPAN;
}

/**
 * Builds a calibration from the two taps, in the order they were made: the
 * launch-area corner first. Returns null when the pair is unusable, so a
 * caller cannot accidentally hold a calibration that divides by zero.
 */
export function calibrationFromCorners(
	origin: ImagePoint,
	far: ImagePoint
): MatCalibration | null {
	const cal: MatCalibration = { origin: { ...origin }, far: { ...far } };
	return isUsableCalibration(cal) ? cal : null;
}

/** Where a point on the picture sits on the mat, in millimetres. */
export function imageToMat(cal: MatCalibration, p: ImagePoint): PointMm {
	return {
		x: ((p.u - cal.origin.u) / spanU(cal)) * MAT_WIDTH_MM,
		y: ((p.v - cal.origin.v) / spanV(cal)) * MAT_HEIGHT_MM
	};
}

/** Where a mat millimetre sits on the picture, as a fraction of its size. */
export function matToImage(cal: MatCalibration, p: PointMm): ImagePoint {
	return {
		u: cal.origin.u + (p.x / MAT_WIDTH_MM) * spanU(cal),
		v: cal.origin.v + (p.y / MAT_HEIGHT_MM) * spanV(cal)
	};
}

/**
 * The SVG matrix that lays the picture into the mat's own drawing space.
 *
 * The mat canvas draws in millimetres with y DOWN (svgY = MAT_HEIGHT_MM -
 * matY). Draw the picture as a unit square at the origin and hand it this
 * matrix, and the two calibrated corners land exactly on the two corners of
 * the mat rectangle. A matrix rather than x/y/width/height because a flipped
 * or mirrored calibration produces a NEGATIVE scale, which `<image width>`
 * refuses and a matrix takes in its stride.
 */
export function calibrationMatrix(cal: MatCalibration): {
	a: number;
	d: number;
	e: number;
	f: number;
} {
	const a = MAT_WIDTH_MM / spanU(cal);
	const d = -MAT_HEIGHT_MM / spanV(cal);
	return { a, d, e: -cal.origin.u * a, f: MAT_HEIGHT_MM - cal.origin.v * d };
}

/** `matrix(a 0 0 d e f)`, ready for an SVG transform attribute. */
export function calibrationTransform(cal: MatCalibration): string {
	const { a, d, e, f } = calibrationMatrix(cal);
	return `matrix(${a} 0 0 ${d} ${e} ${f})`;
}

/**
 * THE CALIBRATION THIS FILE EXISTS TO REPLACE: the picture stretched corner
 * to corner over the mat rectangle. Exported only so a test can measure how
 * far wrong it is on a real field layout, and so the number in HISTORY.md is
 * a measurement rather than an assertion.
 */
export const STRETCH_TO_FIT: MatCalibration = {
	origin: { u: 0, v: 1 },
	far: { u: 1, v: 0 }
};

/**
 * How many millimetres apart two calibrations put the same point on the
 * picture. The confirmation overlay quotes it, and it is what makes "the old
 * way was wrong" a number instead of a claim.
 */
export function disagreementMm(a: MatCalibration, b: MatCalibration, p: ImagePoint): number {
	const pa = imageToMat(a, p);
	const pb = imageToMat(b, p);
	return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}
