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
// The negative control at the end is the point of the whole bundle: the old
// stretch-to-fit calibration is measured against a true one on a picture
// shaped like the real field layout, and the disagreement is reported in
// millimetres.

import { describe, expect, test } from 'vitest';
import { MAT_HEIGHT_MM, MAT_WIDTH_MM } from '../src/lib/planner/geometry';
import {
	MIN_CALIBRATION_SPAN,
	STRETCH_TO_FIT,
	calibrationFromCorners,
	calibrationMatrix,
	calibrationTransform,
	disagreementMm,
	imageToMat,
	isUsableCalibration,
	matToImage,
	type ImagePoint,
	type MatCalibration
} from '../src/lib/planner/calibration';

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
 * OFF SQUARE. The calibrated rectangle is nowhere near the mat's own 2.067:1
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

describe('the two tapped corners are the two ends of the mat', () => {
	test('the launch-area corner maps to the origin', () => {
		nearPoint(imageToMat(INSET, INSET.origin), 0, 0);
		nearPoint(imageToMat(OFF_SQUARE, OFF_SQUARE.origin), 0, 0);
	});

	test('the diagonally opposite corner maps to the full mat dimensions', () => {
		nearPoint(imageToMat(INSET, INSET.far), MAT_WIDTH_MM, MAT_HEIGHT_MM);
		nearPoint(imageToMat(OFF_SQUARE, OFF_SQUARE.far), MAT_WIDTH_MM, MAT_HEIGHT_MM);
	});

	test('the midpoint between them maps to the centre of the mat', () => {
		const mid = (c: MatCalibration): ImagePoint => ({
			u: (c.origin.u + c.far.u) / 2,
			v: (c.origin.v + c.far.v) / 2
		});
		nearPoint(imageToMat(INSET, mid(INSET)), MAT_WIDTH_MM / 2, MAT_HEIGHT_MM / 2);
		nearPoint(imageToMat(OFF_SQUARE, mid(OFF_SQUARE)), MAT_WIDTH_MM / 2, MAT_HEIGHT_MM / 2);
	});

	test('the other two corners of the picture rectangle map to the other two mat corners', () => {
		// The corner sharing the origin's u and the far corner's v is mat
		// (0, MAT_HEIGHT_MM); the mirror of it is (MAT_WIDTH_MM, 0).
		nearPoint(imageToMat(INSET, { u: INSET.origin.u, v: INSET.far.v }), 0, MAT_HEIGHT_MM);
		nearPoint(imageToMat(INSET, { u: INSET.far.u, v: INSET.origin.v }), MAT_WIDTH_MM, 0);
	});
});

describe('known answers on an off-square calibration', () => {
	// Worked by hand from the definition: u spans 0.79 - 0.07 = 0.72 and
	// v spans 0.31 - 0.91 = -0.60.
	test('a quarter of the way along each axis is a quarter of the mat', () => {
		const p: ImagePoint = { u: 0.07 + 0.72 * 0.25, v: 0.91 - 0.6 * 0.25 };
		nearPoint(imageToMat(OFF_SQUARE, p), MAT_WIDTH_MM * 0.25, MAT_HEIGHT_MM * 0.25);
	});

	test('a point off both axes lands where the two independent scales put it', () => {
		// 0.6 across, 0.2 up: the x scale and the y scale are unrelated, which
		// is the freedom two corners buy and one aspect ratio does not.
		const p: ImagePoint = { u: 0.07 + 0.72 * 0.6, v: 0.91 - 0.6 * 0.2 };
		nearPoint(imageToMat(OFF_SQUARE, p), MAT_WIDTH_MM * 0.6, MAT_HEIGHT_MM * 0.2, 1e-8);
	});

	test('a point outside the calibrated rectangle maps outside the mat, not clamped', () => {
		// The border walls are outside the playing surface and must READ as
		// outside; a transform that clamped would silently place a marker on
		// the edge instead of telling the caller it is off the mat.
		const p: ImagePoint = { u: 0.0, v: 0.98 };
		const mat = imageToMat(OFF_SQUARE, p);
		expect(mat.x).toBeLessThan(0);
		expect(mat.y).toBeLessThan(0);
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
		const o = matToImage(OFF_SQUARE, { x: 0, y: 0 });
		near(o.u, OFF_SQUARE.origin.u, 1e-12);
		near(o.v, OFF_SQUARE.origin.v, 1e-12);
		const f = matToImage(OFF_SQUARE, { x: MAT_WIDTH_MM, y: MAT_HEIGHT_MM });
		near(f.u, OFF_SQUARE.far.u, 1e-12);
		near(f.v, OFF_SQUARE.far.v, 1e-12);
	});
});

describe('orientation is free: all four ways a picture can be turned', () => {
	// Same playing surface, four ways of tapping it. Every one must map its own
	// origin tap to (0, 0) and its own far tap to the far mat corner, and must
	// put the CENTRE of the rectangle at the centre of the mat.
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
			nearPoint(imageToMat(cal, cal.origin), 0, 0);
			nearPoint(imageToMat(cal, cal.far), MAT_WIDTH_MM, MAT_HEIGHT_MM);
			nearPoint(
				imageToMat(cal, { u: (corners.left + corners.right) / 2, v: (corners.top + corners.bottom) / 2 }),
				MAT_WIDTH_MM / 2,
				MAT_HEIGHT_MM / 2
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
	// The mat canvas draws millimetres with y DOWN: mat (0, 0) is svg
	// (0, MAT_HEIGHT_MM) and mat (MAT_WIDTH_MM, MAT_HEIGHT_MM) is svg
	// (MAT_WIDTH_MM, 0). The picture is a unit square under this matrix.
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
			near(o.x, 0, 1e-9);
			near(o.y, MAT_HEIGHT_MM, 1e-9);
			const f = apply(m, cal.far);
			near(f.x, MAT_WIDTH_MM, 1e-9);
			near(f.y, 0, 1e-9);
		});
	}

	test('the matrix agrees with matToImage for an interior point', () => {
		const m = calibrationMatrix(OFF_SQUARE);
		const matPoint = { x: 1234, y: 567 };
		const onPicture = matToImage(OFF_SQUARE, matPoint);
		const drawn = apply(m, onPicture);
		near(drawn.x, matPoint.x, 1e-8);
		near(drawn.y, MAT_HEIGHT_MM - matPoint.y, 1e-8);
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

describe('NEGATIVE CONTROL: what stretch-to-fit gets wrong on a real field picture', () => {
	// The picture this bundle was built against is 2019 by 1153 pixels: a field
	// layout with the border walls in frame. Its aspect is 1.751:1 while the
	// playing surface is 2.067:1, so the surface cannot possibly reach both the
	// left and right edges AND the top and bottom edges of the picture. These
	// numbers stand in for a plausible calibration of it: the surface spans
	// most of the width and about three quarters of the height.
	const REAL_ISH: MatCalibration = {
		origin: { u: 0.045, v: 0.875 },
		far: { u: 0.955, v: 0.13 }
	};

	test('the old calibration and a true one disagree by a robot-sized distance', () => {
		// Measured, not asserted: 183 mm at the far corner of the playing
		// surface, 153 mm a little inside it, 4 mm dead centre (the two
		// transforms share a centre, which is exactly why the error hides).
		// A SPIKE Prime robot is roughly 200 mm long, so a marker off by this
		// much sends the robot to the wrong model.
		const corner: ImagePoint = { u: 0.955, v: 0.13 };
		expect(disagreementMm(STRETCH_TO_FIT, REAL_ISH, corner)).toBeGreaterThan(150);
		expect(disagreementMm(STRETCH_TO_FIT, REAL_ISH, { u: 0.9, v: 0.2 })).toBeGreaterThan(140);
		expect(disagreementMm(STRETCH_TO_FIT, REAL_ISH, { u: 0.5, v: 0.5 })).toBeLessThan(20);
	});

	test('stretch-to-fit puts the playing surface corner inside the walls, not on them', () => {
		// Under the old transform the mat origin sat at the very corner of the
		// PICTURE, which on this image is a point in the border wall.
		nearPoint(imageToMat(STRETCH_TO_FIT, { u: 0, v: 1 }), 0, 0);
		// A true calibration reads that same pixel as off the mat on both axes.
		const mat = imageToMat(REAL_ISH, { u: 0, v: 1 });
		expect(mat.x).toBeLessThan(0);
		expect(mat.y).toBeLessThan(0);
	});

	test('the two agree exactly when the picture really is cropped to the surface', () => {
		// The positive control for the negative control: stretch-to-fit was not
		// wrong in principle, it was wrong about this picture. Given a picture
		// cropped to the mat borders the two transforms are the same transform.
		expect(disagreementMm(STRETCH_TO_FIT, STRETCH_TO_FIT, { u: 0.3, v: 0.7 })).toBe(0);
		const cropped = calibrationFromCorners({ u: 0, v: 1 }, { u: 1, v: 0 });
		expect(cropped).not.toBeNull();
		expect(disagreementMm(STRETCH_TO_FIT, cropped as MatCalibration, { u: 0.62, v: 0.31 })).toBe(0);
	});
});
