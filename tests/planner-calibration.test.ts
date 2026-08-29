// tests/planner-calibration.test.ts
//
// THE TRANSFORM FIRST, IN ISOLATION, BEFORE ANY UI. Every mission marker,
// waypoint and robot footprint the planner draws over the field picture is
// placed by src/lib/planner/calibration.ts, so the known-answer cases live
// here and ran green before the calibration screen existed. A wrong transform
// is INVISIBLE on screen -- the picture still fills the rectangle and still
// looks like a mat -- which is exactly why it has to be proved by arithmetic
// rather than by looking at it. This file needs no database and no stack.
//
// THE TWO TAPS ARE THE MAT'S CORNERS AND THE ANSWER IS IN TABLE MILLIMETRES.
// That is this bundle's correction and it is what most of these cases now
// pin: the mat is 2000 by 1134 inside a 2362 by 1143 table, so the corner a
// mentor taps is table (181, 0) and not (0, 0).
//
// The negative controls at the end are the point of the whole bundle: the
// transform this file used to apply (the same two taps read onto the TABLE
// rectangle) is measured against the corrected one, and the disagreement is
// reported as a percentage of a drive and as an angle.

import { describe, expect, test } from 'vitest';
import {
	MAT_HEIGHT_MM,
	MAT_ORIGIN_X_MM,
	MAT_ORIGIN_Y_MM,
	MAT_SIDE_STRIP_MM,
	MAT_WIDTH_MM,
	TABLE_HEIGHT_MM,
	TABLE_WIDTH_MM,
	headingDeg,
	matToTable,
	routeMoves
} from '../src/lib/planner/geometry';
import {
	FULL_FRAME_ASPECT_TOLERANCE,
	FULL_FRAME_CALIBRATION,
	MAT_ASPECT,
	MIN_CALIBRATION_SPAN,
	calibrationFromCorners,
	calibrationMatrix,
	calibrationTransform,
	disagreementMm,
	fullFrameFit,
	imageToMat,
	isUsableCalibration,
	legacyTableStretch,
	matToImage,
	type ImagePoint,
	type MatCalibration
} from '../src/lib/planner/calibration';

/** The two points the two taps mean, in the table coordinates everything is stored in. */
const MAT_ORIGIN = matToTable({ x: 0, y: 0 });
const MAT_FAR = matToTable({ x: MAT_WIDTH_MM, y: MAT_HEIGHT_MM });

/**
 * The everyday case: a picture whose playing surface sits inside a border of
 * walls. The launch corner is at the bottom left of the picture, a tenth of
 * the way in across and an eighth of the way up from the bottom.
 */
const INSET: MatCalibration = {
	origin: { u: 0.1, v: 0.875 },
	far: { u: 0.9, v: 0.125 }
};

/**
 * OFF SQUARE. The calibrated rectangle is nowhere near the mat's own 1.764:1
 * aspect within the picture (it spans 0.72 of the width and 0.60 of the
 * height, a 1.2:1 box on a square picture), it is not centred, and neither
 * corner touches an edge. Nothing in the transform may assume otherwise.
 */
const OFF_SQUARE: MatCalibration = {
	origin: { u: 0.07, v: 0.91 },
	far: { u: 0.79, v: 0.31 }
};

const near = (actual: number, expected: number, tol = 1e-9) =>
	expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

const nearPoint = (actual: { x: number; y: number }, x: number, y: number, tol = 1e-9) => {
	near(actual.x, x, tol);
	near(actual.y, y, tol);
};

describe('the two tapped corners are the two ends of the MAT', () => {
	test('THE MAT ORIGIN: the tapped launch corner is 181 mm in, flush with the bottom', () => {
		// The claim this whole bundle turns on. The corner a mentor taps is the
		// corner of the printed sheet, and the sheet starts one 181 mm strip in
		// from the table's left wall and lies flush against the bottom one.
		for (const cal of [INSET, OFF_SQUARE]) {
			const p = imageToMat(cal, cal.origin);
			nearPoint(p, MAT_SIDE_STRIP_MM, 0);
			expect(p.x).toBe(181);
			expect(p.y).toBe(0);
			// Flush at the bottom, and one strip short of the far wall too.
			expect(TABLE_WIDTH_MM - imageToMat(cal, cal.far).x).toBeCloseTo(MAT_SIDE_STRIP_MM, 9);
		}
	});

	test('the diagonally opposite corner maps to the far corner of the mat', () => {
		nearPoint(imageToMat(INSET, INSET.far), MAT_FAR.x, MAT_FAR.y);
		nearPoint(imageToMat(OFF_SQUARE, OFF_SQUARE.far), MAT_FAR.x, MAT_FAR.y);
		expect(MAT_FAR).toEqual({ x: 2181, y: 1134 });
	});

	test('the midpoint between them maps to the centre of the mat', () => {
		const mid = (c: MatCalibration): ImagePoint => ({
			u: (c.origin.u + c.far.u) / 2,
			v: (c.origin.v + c.far.v) / 2
		});
		const cx = MAT_ORIGIN_X_MM + MAT_WIDTH_MM / 2;
		const cy = MAT_ORIGIN_Y_MM + MAT_HEIGHT_MM / 2;
		nearPoint(imageToMat(INSET, mid(INSET)), cx, cy);
		nearPoint(imageToMat(OFF_SQUARE, mid(OFF_SQUARE)), cx, cy);
		// And that is NOT the centre of the table: the mat is short at the top.
		expect(cy).toBeLessThan(TABLE_HEIGHT_MM / 2);
	});

	test('the other two corners of the picture rectangle map to the other two mat corners', () => {
		nearPoint(imageToMat(INSET, { u: INSET.origin.u, v: INSET.far.v }), MAT_ORIGIN.x, MAT_FAR.y);
		nearPoint(imageToMat(INSET, { u: INSET.far.u, v: INSET.origin.v }), MAT_FAR.x, MAT_ORIGIN.y);
	});
});

describe('known answers on an off-square calibration', () => {
	// Worked by hand from the definition: u spans 0.79 - 0.07 = 0.72 and
	// v spans 0.31 - 0.91 = -0.60.
	test('a quarter of the way along each axis is a quarter of the mat', () => {
		const p: ImagePoint = { u: 0.07 + 0.72 * 0.25, v: 0.91 - 0.6 * 0.25 };
		const q = matToTable({ x: MAT_WIDTH_MM * 0.25, y: MAT_HEIGHT_MM * 0.25 });
		nearPoint(imageToMat(OFF_SQUARE, p), q.x, q.y);
	});

	test('a point off both axes lands where the two independent scales put it', () => {
		// 0.6 across, 0.2 up: the x scale and the y scale are unrelated, which
		// is the freedom two corners buy and one aspect ratio does not.
		const p: ImagePoint = { u: 0.07 + 0.72 * 0.6, v: 0.91 - 0.6 * 0.2 };
		const q = matToTable({ x: MAT_WIDTH_MM * 0.6, y: MAT_HEIGHT_MM * 0.2 });
		nearPoint(imageToMat(OFF_SQUARE, p), q.x, q.y, 1e-8);
	});

	test('a point outside the calibrated rectangle maps outside the mat, not clamped', () => {
		// The border walls are outside the playing surface and must READ as
		// outside; a transform that clamped would silently place a marker on
		// the edge instead of telling the caller it is off the mat.
		const p: ImagePoint = { u: 0.0, v: 0.98 };
		const mat = imageToMat(OFF_SQUARE, p);
		expect(mat.x).toBeLessThan(MAT_ORIGIN.x);
		expect(mat.y).toBeLessThan(MAT_ORIGIN.y);
	});
});

describe('the inverse', () => {
	test('matToImage undoes imageToMat for arbitrary points', () => {
		for (const cal of [INSET, OFF_SQUARE]) {
			for (const p of [
				{ u: 0.11, v: 0.42 },
				{ u: 0.5, v: 0.5 },
				{ u: 0.77, v: 0.19 },
				{ u: 0.03, v: 0.96 }
			]) {
				const back = matToImage(cal, imageToMat(cal, p));
				near(back.u, p.u, 1e-12);
				near(back.v, p.v, 1e-12);
			}
		}
	});

	test('the mat corners come back as the tapped corners', () => {
		const o = matToImage(OFF_SQUARE, MAT_ORIGIN);
		near(o.u, OFF_SQUARE.origin.u, 1e-12);
		near(o.v, OFF_SQUARE.origin.v, 1e-12);
		const f = matToImage(OFF_SQUARE, MAT_FAR);
		near(f.u, OFF_SQUARE.far.u, 1e-12);
		near(f.v, OFF_SQUARE.far.v, 1e-12);
	});
});

describe('orientation is free: all four ways a picture can be turned', () => {
	// Same mat, four ways of tapping it. Every one must map its own origin tap
	// to the mat's launch corner -- table (181, 0) -- and its own far tap to
	// the mat's far corner, and must put the CENTRE of the tapped rectangle at
	// the centre of the mat.
	const corners = { left: 0.1, right: 0.9, top: 0.125, bottom: 0.875 };
	const cases: { name: string; cal: MatCalibration }[] = [
		{
			name: 'launch corner bottom left (the usual photograph)',
			cal: { origin: { u: corners.left, v: corners.bottom }, far: { u: corners.right, v: corners.top } }
		},
		{
			name: 'launch corner bottom right (mirrored)',
			cal: { origin: { u: corners.right, v: corners.bottom }, far: { u: corners.left, v: corners.top } }
		},
		{
			name: 'launch corner top left (picture upside down on one axis)',
			cal: { origin: { u: corners.left, v: corners.top }, far: { u: corners.right, v: corners.bottom } }
		},
		{
			name: 'launch corner top right (picture end for end)',
			cal: { origin: { u: corners.right, v: corners.top }, far: { u: corners.left, v: corners.bottom } }
		}
	];

	for (const { name, cal } of cases) {
		test(name, () => {
			expect(isUsableCalibration(cal)).toBe(true);
			nearPoint(imageToMat(cal, cal.origin), MAT_ORIGIN.x, MAT_ORIGIN.y);
			nearPoint(imageToMat(cal, cal.far), MAT_FAR.x, MAT_FAR.y);
			nearPoint(
				imageToMat(cal, { u: (corners.left + corners.right) / 2, v: (corners.top + corners.bottom) / 2 }),
				MAT_ORIGIN_X_MM + MAT_WIDTH_MM / 2,
				MAT_ORIGIN_Y_MM + MAT_HEIGHT_MM / 2
			);
		});
	}

	test('a mirrored calibration produces a negative scale rather than an error', () => {
		const mirrored = cases[1].cal;
		expect(calibrationMatrix(mirrored).a).toBeLessThan(0);
		expect(calibrationTransform(mirrored)).toMatch(/^matrix\(-/);
	});
});

describe('the drawing matrix lands the picture on the mat rectangle', () => {
	// The canvas draws TABLE millimetres with y DOWN, so the mat's launch
	// corner is svg (181, 1143) and its far corner is svg (2181, 9) -- the 9
	// being the top gap. The picture is a unit square under this matrix.
	const apply = (m: { a: number; d: number; e: number; f: number }, p: ImagePoint) => ({
		x: m.a * p.u + m.e,
		y: m.d * p.v + m.f
	});

	for (const [name, cal] of [
		['the inset calibration', INSET],
		['the off-square calibration', OFF_SQUARE],
		['a mirrored calibration', { origin: { u: 0.9, v: 0.8 }, far: { u: 0.2, v: 0.2 } } as MatCalibration]
	] as const) {
		test(`${name} puts the tapped corners on the mat rectangle corners`, () => {
			const m = calibrationMatrix(cal);
			const o = apply(m, cal.origin);
			near(o.x, MAT_ORIGIN.x, 1e-9);
			near(o.y, TABLE_HEIGHT_MM - MAT_ORIGIN.y, 1e-9);
			const f = apply(m, cal.far);
			near(f.x, MAT_FAR.x, 1e-9);
			near(f.y, TABLE_HEIGHT_MM - MAT_FAR.y, 1e-9);
			// The top gap is real and visible in the drawing.
			near(f.y, 9, 1e-9);
		});
	}

	test('the matrix agrees with matToImage for an interior point', () => {
		const m = calibrationMatrix(OFF_SQUARE);
		const matPoint = { x: 1234, y: 567 };
		const onPicture = matToImage(OFF_SQUARE, matPoint);
		const drawn = apply(m, onPicture);
		near(drawn.x, matPoint.x, 1e-8);
		near(drawn.y, TABLE_HEIGHT_MM - matPoint.y, 1e-8);
	});
});

describe('a calibration that cannot be inverted is refused, not guessed at', () => {
	test('two taps in the same place', () => {
		expect(calibrationFromCorners({ u: 0.4, v: 0.4 }, { u: 0.4, v: 0.4 })).toBeNull();
	});

	test('taps that share an axis (a line, not a rectangle)', () => {
		expect(calibrationFromCorners({ u: 0.1, v: 0.9 }, { u: 0.9, v: 0.9 })).toBeNull();
		expect(calibrationFromCorners({ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.9 })).toBeNull();
	});

	test('taps closer together than the minimum span', () => {
		// 0.25 to 0.28 is a 0.03 span, under the 0.05 minimum. Binary-exact
		// endpoints so the boundary is the rule and not a rounding accident.
		expect(calibrationFromCorners({ u: 0.25, v: 0.25 }, { u: 0.28, v: 0.9 })).toBeNull();
		expect(MIN_CALIBRATION_SPAN).toBe(0.05);
		// The positive control: the same pair, wider on that axis, is accepted.
		expect(calibrationFromCorners({ u: 0.25, v: 0.25 }, { u: 0.3125, v: 0.9 })).not.toBeNull();
	});

	test('NaN and infinity are refused', () => {
		expect(isUsableCalibration({ origin: { u: Number.NaN, v: 0.9 }, far: { u: 0.9, v: 0.1 } })).toBe(false);
		expect(
			isUsableCalibration({ origin: { u: 0.1, v: 0.9 }, far: { u: Number.POSITIVE_INFINITY, v: 0.1 } })
		).toBe(false);
		expect(isUsableCalibration(null)).toBe(false);
		expect(isUsableCalibration(undefined)).toBe(false);
	});

	test('a usable calibration round-trips through calibrationFromCorners unchanged', () => {
		const cal = calibrationFromCorners(OFF_SQUARE.origin, OFF_SQUARE.far);
		expect(cal).toEqual(OFF_SQUARE);
	});
});

describe('the FULL FRAME path: a picture already cropped to the mat', () => {
	test('it is a legitimate calibration, and 0017 would store it', () => {
		// Read against supabase/migrations/0017_mat_image_calibration.sql:
		// mat_images_calibration_whole (all four corners or none),
		// mat_images_calibration_in_frame (each between 0 and 1, inclusive),
		// mat_images_calibration_span (each axis at least 0.05).
		const c = FULL_FRAME_CALIBRATION;
		for (const n of [c.origin.u, c.origin.v, c.far.u, c.far.v]) {
			expect(n).toBeGreaterThanOrEqual(0);
			expect(n).toBeLessThanOrEqual(1);
		}
		expect(Math.abs(c.far.u - c.origin.u)).toBeGreaterThanOrEqual(0.05);
		expect(Math.abs(c.far.v - c.origin.v)).toBeGreaterThanOrEqual(0.05);
		expect(isUsableCalibration(c)).toBe(true);
	});

	test('its corners are the mat corners, so the picture IS the sheet', () => {
		nearPoint(imageToMat(FULL_FRAME_CALIBRATION, { u: 0, v: 1 }), MAT_ORIGIN.x, MAT_ORIGIN.y);
		nearPoint(imageToMat(FULL_FRAME_CALIBRATION, { u: 1, v: 0 }), MAT_FAR.x, MAT_FAR.y);
	});

	test('the shape test admits a mat crop and rejects a picture framed on the table', () => {
		expect(MAT_ASPECT).toBeCloseTo(1.7637, 4);

		// A picture cropped to the mat, at three plausible resolutions.
		for (const [w, h] of [
			[2000, 1134],
			[1600, 907],
			[1000, 567]
		]) {
			expect(fullFrameFit(w, h).fits).toBe(true);
		}

		// A picture framed on the TABLE inside its walls: 2.07:1. This is the
		// case the test exists to reject, and it misses by more than eight
		// times the tolerance.
		const table = fullFrameFit(TABLE_WIDTH_MM, TABLE_HEIGHT_MM);
		expect(table.fits).toBe(false);
		expect(table.off).toBeGreaterThan(8 * FULL_FRAME_ASPECT_TOLERANCE);
		expect(table.off).toBeCloseTo(0.1717, 3);

		// The tolerance is the named constant and the boundary is the rule.
		expect(FULL_FRAME_ASPECT_TOLERANCE).toBe(0.02);
		const justInside = MAT_ASPECT * (1 + FULL_FRAME_ASPECT_TOLERANCE * 0.99);
		const justOutside = MAT_ASPECT * (1 + FULL_FRAME_ASPECT_TOLERANCE * 1.01);
		expect(fullFrameFit(justInside * 1000, 1000).fits).toBe(true);
		expect(fullFrameFit(justOutside * 1000, 1000).fits).toBe(false);
	});

	test('a degenerate size cannot pass the shape test', () => {
		expect(fullFrameFit(0, 0).fits).toBe(false);
		expect(fullFrameFit(Number.NaN, 100).fits).toBe(false);
	});
});

describe('NEGATIVE CONTROL: the TABLE stretch this bundle removes', () => {
	// `legacyTableStretch` is the transform this file used to apply: the same
	// two taps, read onto the 2362 by 1143 table instead of onto the 2000 by
	// 1134 mat. Everything below is a measurement of the correction.
	const CROP = FULL_FRAME_CALIBRATION;

	test('EVERY LONG-AXIS DRIVE WAS 18.1% TOO LONG', () => {
		// The full width of the mat, tapped as the full width of a picture
		// cropped to it. The truth is 2000 mm; the old answer was 2362.
		const a = imageToMat(CROP, { u: 0, v: 1 });
		const b = imageToMat(CROP, { u: 1, v: 1 });
		const now = routeMoves([a, b])[0].driveCm;
		expect(now).toBeCloseTo(200, 9);

		const oldA = legacyTableStretch(CROP, { u: 0, v: 1 });
		const oldB = legacyTableStretch(CROP, { u: 1, v: 1 });
		const before = routeMoves([oldA, oldB])[0].driveCm;
		expect(before).toBeCloseTo(236.2, 9);

		expect(before / now).toBeCloseTo(1.181, 3);
		expect((before / now - 1) * 100).toBeCloseTo(18.1, 1);
	});

	test('THE ANISOTROPY: a 45 degree path on the mat came back as 40.5 degrees', () => {
		// Two points 500 mm apart on each axis of the real mat: a physically
		// 45 degree drive. In picture fractions on a mat crop that is 0.25 of
		// the width and 500/1134 of the height.
		const du = 500 / MAT_WIDTH_MM;
		const dv = 500 / MAT_HEIGHT_MM;
		const from: ImagePoint = { u: 0.2, v: 0.8 };
		const to: ImagePoint = { u: 0.2 + du, v: 0.8 - dv };

		// The movement list, which is what a child actually reads.
		const moves = routeMoves([imageToMat(CROP, from), imageToMat(CROP, to)]);
		expect(moves).toHaveLength(1);
		expect(moves[0].headingDeg).toBeCloseTo(45, 9);
		expect(moves[0].driveCm).toBeCloseTo(Math.hypot(500, 500) / 10, 9);

		// What it used to say. The two axes were stretched by 2362/2000 and
		// 1143/1134, and because those DIFFER the angle moved.
		const legacy = headingDeg(legacyTableStretch(CROP, from), legacyTableStretch(CROP, to));
		expect(legacy).toBeCloseTo(40.479, 2);
		expect(Math.abs(legacy - 45)).toBeGreaterThan(4);
	});

	test('the turn is wrong by an amount that DEPENDS ON DIRECTION, which is the tell', () => {
		// An isotropic scale error would move every drive by the same factor
		// and leave every angle alone. This one bends each heading by a
		// different amount, so no single correction could ever have fixed it.
		const bend = (deg: number) => {
			const r = (deg * Math.PI) / 180;
			const from: ImagePoint = { u: 0.5, v: 0.5 };
			const to: ImagePoint = {
				u: 0.5 + (Math.cos(r) * 300) / MAT_WIDTH_MM,
				v: 0.5 - (Math.sin(r) * 300) / MAT_HEIGHT_MM
			};
			return headingDeg(legacyTableStretch(CROP, from), legacyTableStretch(CROP, to)) - deg;
		};
		// True at the axes, worst near the diagonal, and never a constant.
		expect(Math.abs(bend(0))).toBeLessThan(1e-9);
		expect(Math.abs(bend(90))).toBeLessThan(1e-9);
		expect(bend(45)).toBeCloseTo(-4.52, 2);
		expect(bend(20)).not.toBeCloseTo(bend(70), 1);
	});

	test('and the two transforms agree at the mat centre, which is why nobody saw it', () => {
		const centre = imageToMat(CROP, { u: 0.5, v: 0.5 });
		const legacyCentre = legacyTableStretch(CROP, { u: 0.5, v: 0.5 });
		// The table centre and the mat centre are 4.5 mm apart on y and dead
		// on in x: a marker in the middle of the mat looked perfect.
		expect(Math.abs(legacyCentre.x - centre.x)).toBeCloseTo(0, 9);
		expect(Math.abs(legacyCentre.y - centre.y)).toBeCloseTo(4.5, 9);
	});

	test('0017 is still right about its own bug: a picture with the table in it', () => {
		// The picture 0017 was built against is 2019 by 1153 pixels. These
		// numbers stand in for a plausible calibration of a picture that is
		// NOT cropped to the mat, and stretching such a picture to any
		// rectangle at all is still wrong by a robot's length.
		const REAL_ISH: MatCalibration = {
			origin: { u: 0.045, v: 0.875 },
			far: { u: 0.955, v: 0.13 }
		};
		const corner: ImagePoint = { u: 0.955, v: 0.13 };
		expect(disagreementMm(CROP, REAL_ISH, corner)).toBeGreaterThan(100);
		expect(disagreementMm(CROP, REAL_ISH, { u: 0.5, v: 0.5 })).toBeLessThan(20);
	});

	test('the positive control: cropped really does mean cropped', () => {
		expect(disagreementMm(CROP, CROP, { u: 0.3, v: 0.7 })).toBe(0);
		const tapped = calibrationFromCorners({ u: 0, v: 1 }, { u: 1, v: 0 });
		expect(tapped).not.toBeNull();
		expect(disagreementMm(CROP, tapped as MatCalibration, { u: 0.62, v: 0.31 })).toBe(0);
	});
});
