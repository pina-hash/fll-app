/**
 * TWO-CORNER MAT CALIBRATION. The one implementation of "where on this
 * picture is table millimetre (x, y)", and its inverse.
 *
 * WHY THIS FILE EXISTS, AND WHAT IT WAS ITSELF GUILTY OF. The first
 * background layer stretched the uploaded picture edge to edge across a
 * rectangle and trusted the mentor to have cropped to it. A picture
 * stretched to a rectangle it does not fill is wrong EVERYWHERE except the
 * centre, and the wrongness is invisible: the picture still fills the
 * rectangle and still looks like a mat. That argument was right, and this
 * file went on doing exactly the thing it describes.
 *
 * The rectangle it stretched to was `MAT_WIDTH_MM by MAT_HEIGHT_MM`, which
 * at the time held 2362 by 1143: the inside of the TABLE, not the mat. So a
 * picture of the mat, correctly cropped, correctly tapped, was still laid
 * across a rectangle 18.1% too long and 0.8% too tall, and because those two
 * factors DIFFER the stretch was anisotropic and rotated every heading the
 * movement list reported. Two corners of the right rectangle is a transform;
 * two corners of the wrong rectangle is the same bug in better clothes.
 *
 * THE TWO TAPS ARE THE MAT'S CORNERS, NOT THE TABLE'S. First the corner of
 * the MAT on the launch area side, then the diagonally opposite corner.
 * The mat is what a mentor can actually see and hit: it is a printed sheet
 * with a printed edge, while the table's inside corner is where a wall meets
 * a floor, in shadow, at a fillet. Asking for the harder point to get the
 * same information back would be a worse screen and a worse calibration.
 *
 * THE OUTPUT IS TABLE MILLIMETRES ANYWAY. The two taps locate the MAT, and
 * `geometry.ts` knows where the mat sits inside the table (181 mm in from
 * each side, flush with the bottom), so the mat corner a mentor tapped comes
 * back as table (181, 0) rather than (0, 0). Every stored waypoint and
 * mission position is in table millimetres and none of them changed meaning.
 *
 * Two opposite corners of an axis-aligned rectangle pin an origin and an
 * independent scale on each axis -- which is exactly the freedom a
 * photograph of a mat needs, and no more. It cannot model rotation or
 * perspective, and it does not pretend to: a picture taken at an angle is
 * the wrong picture, not a harder transform.
 *
 * COORDINATES. Image points are FRACTIONS of the image's own width and
 * height, u across and v DOWN, so a calibration survives the same picture
 * being re-encoded at another resolution and never stores a pixel count that
 * could disagree with the file. Table points are millimetres, y UP, origin at
 * the launch area corner of the table: geometry.ts's convention, unchanged.
 *
 * ORIENTATION IS FREE. Nothing here assumes the launch corner is at the
 * bottom left of the picture. The two fractions are subtracted in the order
 * the mentor tapped them, so a picture that is upside down, mirrored, or
 * turned end for end produces negative scale factors and maps correctly
 * anyway. The tests pin all four orientations.
 */
import {
	MAT_HEIGHT_MM,
	MAT_ORIGIN_X_MM,
	MAT_ORIGIN_Y_MM,
	MAT_WIDTH_MM,
	TABLE_HEIGHT_MM,
	TABLE_WIDTH_MM,
	type PointMm
} from './geometry';

/** A point on the picture, as a fraction of its width and height. v is DOWN. */
export interface ImagePoint {
	u: number;
	v: number;
}

/** The two taps: opposite corners of the MAT, on the picture. */
export interface MatCalibration {
	/** The launch-area-side corner of the mat. Table (181, 0), not (0, 0). */
	origin: ImagePoint;
	/** The diagonally opposite corner of the mat. Table (2181, 1134). */
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

/**
 * Where a point on the picture sits on the field, in TABLE millimetres. The
 * two taps scale it onto the MAT, and the mat's offset inside the table is
 * added last: tap the mat's launch corner and this answers (181, 0).
 */
export function imageToMat(cal: MatCalibration, p: ImagePoint): PointMm {
	return {
		x: MAT_ORIGIN_X_MM + ((p.u - cal.origin.u) / spanU(cal)) * MAT_WIDTH_MM,
		y: MAT_ORIGIN_Y_MM + ((p.v - cal.origin.v) / spanV(cal)) * MAT_HEIGHT_MM
	};
}

/** Where a table millimetre sits on the picture, as a fraction of its size. */
export function matToImage(cal: MatCalibration, p: PointMm): ImagePoint {
	return {
		u: cal.origin.u + ((p.x - MAT_ORIGIN_X_MM) / MAT_WIDTH_MM) * spanU(cal),
		v: cal.origin.v + ((p.y - MAT_ORIGIN_Y_MM) / MAT_HEIGHT_MM) * spanV(cal)
	};
}

/**
 * The SVG matrix that lays the picture into the canvas's drawing space.
 *
 * The canvas draws TABLE millimetres with y DOWN (svgY = TABLE_HEIGHT_MM -
 * tableY). Draw the picture as a unit square at the origin and hand it this
 * matrix, and the two calibrated corners land exactly on the two corners of
 * the MAT rectangle, which sits one side strip in from the left of the table
 * and flush with its bottom. A matrix rather than x/y/width/height because a
 * flipped or mirrored calibration produces a NEGATIVE scale, which
 * `<image width>` refuses and a matrix takes in its stride.
 */
export function calibrationMatrix(cal: MatCalibration): {
	a: number;
	d: number;
	e: number;
	f: number;
} {
	const a = MAT_WIDTH_MM / spanU(cal);
	const d = -MAT_HEIGHT_MM / spanV(cal);
	return {
		a,
		d,
		e: MAT_ORIGIN_X_MM - cal.origin.u * a,
		f: TABLE_HEIGHT_MM - MAT_ORIGIN_Y_MM - cal.origin.v * d
	};
}

/** `matrix(a 0 0 d e f)`, ready for an SVG transform attribute. */
export function calibrationTransform(cal: MatCalibration): string {
	const { a, d, e, f } = calibrationMatrix(cal);
	return `matrix(${a} 0 0 ${d} ${e} ${f})`;
}

/**
 * THIS PICTURE IS ALREADY CROPPED TO THE MAT. The whole calibration, for the
 * common case: the mat's launch corner is the picture's own bottom left and
 * its opposite corner is the picture's top right.
 *
 * IT IS A CLAIM A MENTOR CONFIRMS, NOT A GUESS THE APP MAKES. That
 * distinction is the entire difference between this constant and the
 * stretch-to-fit it is descended from, which held these same four numbers and
 * applied them to whatever was uploaded without asking. Offered only when
 * `fullFrameFit` says the picture is the right SHAPE for it, and only as
 * something to say yes to.
 */
export const FULL_FRAME_CALIBRATION: MatCalibration = {
	origin: { u: 0, v: 1 },
	far: { u: 1, v: 0 }
};

/** The mat's own proportions: 2000 by 1134 is 1.76:1. Not the table's 2.07:1. */
export const MAT_ASPECT = MAT_WIDTH_MM / MAT_HEIGHT_MM;

/**
 * How far a picture's own proportions may sit from the mat's before it is no
 * longer offered the one-tap path. Relative, so 0.02 is two percent of 1.76.
 *
 * WHAT THE NUMBER HAS TO SEPARATE. The thing this screening test exists to
 * reject is a picture framed on the TABLE rather than on the mat, walls and
 * bare strips and all: that is 2.07:1, which is 17.2% away from the mat's
 * own ratio, so two percent rejects it by more than eight times over. A
 * genuine crop of the mat, meanwhile, is off by a fraction of a percent.
 * There is a wide empty band between the two and the tolerance sits in it.
 *
 * WHAT IT COSTS IF A PICTURE SNEAKS THROUGH. Two percent of proportion is
 * one axis scaled two percent wrong: 40 mm at the far end of the long axis,
 * 23 mm on the short one. That is a fifth of a robot's length, against the
 * 183 mm the table stretch was out by, and the mentor still has to look at
 * the mat drawn back onto the picture before anything is saved. The shape
 * test decides which path is OFFERED FIRST; it never decides alone.
 */
export const FULL_FRAME_ASPECT_TOLERANCE = 0.02;

export interface FullFrameFit {
	/** The picture's own width over its own height. */
	aspect: number;
	/** The mat's, for a message that names both numbers rather than objecting. */
	matAspect: number;
	/** How far apart they are, as a fraction of the mat's. */
	off: number;
	/** Whether the one-tap path may be offered for this picture. */
	fits: boolean;
}

/**
 * Whether a picture is the right shape to be a crop of the mat. Pixel counts
 * rather than fractions, because this is asked of a freshly uploaded file
 * before anybody has tapped anything.
 */
export function fullFrameFit(imageW: number, imageH: number): FullFrameFit {
	const aspect = imageW / Math.max(1e-9, imageH);
	const off = Number.isFinite(aspect) ? Math.abs(aspect - MAT_ASPECT) / MAT_ASPECT : 1;
	return {
		aspect,
		matAspect: MAT_ASPECT,
		off,
		fits: Number.isFinite(aspect) && off <= FULL_FRAME_ASPECT_TOLERANCE
	};
}

/**
 * THE TRANSFORM THIS BUNDLE REMOVES: the same two taps read onto the TABLE
 * rectangle instead of the mat. Exported for one purpose, so a test can put
 * a number on the correction rather than asserting there is one, and so the
 * figures in HISTORY.md are measurements.
 *
 * It is not a fallback and nothing in the app may call it. The x factor is
 * 2362/2000 and the y factor 1143/1134, and the interesting part is that
 * they DIFFER: every long-axis drive came back 18.1% too long, and because
 * the two axes were stretched unequally every heading came back rotated by
 * an amount that depended on which way the robot was pointing.
 */
export function legacyTableStretch(cal: MatCalibration, p: ImagePoint): PointMm {
	return {
		x: ((p.u - cal.origin.u) / spanU(cal)) * TABLE_WIDTH_MM,
		y: ((p.v - cal.origin.v) / spanV(cal)) * TABLE_HEIGHT_MM
	};
}

/**
 * How many millimetres apart two calibrations put the same point on the
 * picture. It is what makes "the old way was wrong" a number instead of a
 * claim, on this bundle's correction as much as on 0017's.
 */
export function disagreementMm(a: MatCalibration, b: MatCalibration, p: ImagePoint): number {
	const pa = imageToMat(a, p);
	const pb = imageToMat(b, p);
	return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}
