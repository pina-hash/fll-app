// tests/mat-image-roundtrip.test.ts
//
// THE MENTOR UPLOAD PATH, END TO END, WHICH HAD NEVER BEEN VERIFIED. A real
// mentor session puts a real picture in the private bucket, calibrates it,
// places a mission marker through the calibration, and reads the whole thing
// back with a fresh client: the marker has to come back at the same
// millimetre AND at the same pixel of the picture. That round trip is the
// only thing standing between a mentor's tap and a robot arriving at the
// wrong model in a gym.
//
// It drives the SHIPPING functions -- uploadFieldImage, saveCalibration,
// fetchMatImage, loadPlannerData, applyPlannerOp -- not reimplementations of
// them, so the code path under test is the code path the console runs. The
// browser-only half (prepareFieldImage, which decodes and may re-encode) is
// deliberately not exercised here; it needs a canvas, and it is verified in
// the browser instead. That split is stated in the bundle's history entry.
//
// THE PICTURE. local-assets/bioglow-field.png when it is present (gitignored:
// it is FIRST and LEGO copyrighted and this repo is public), otherwise a
// synthesised PNG of the same size, so the file is green on a machine that
// does not have it. Which one ran is printed.
//
// missions and the mat bucket are GLOBAL, so this file saves and restores
// every global row it touches.

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	cleanupRun,
	closeDb,
	createStudent,
	createTeam,
	seedMentor,
	serviceClient,
	signIn,
	sql,
	type Client,
	type SeededMentor,
	type SeededTeam
} from './db/harness';
import { matImagePath, fetchMatImage, loadPlannerData } from '../src/lib/planner/data';
import {
	saveCalibration,
	saveDim,
	uploadFieldImage,
	removeFieldImage,
	type PreparedImage
} from '../src/lib/planner/field-image';
import { applyPlannerOp } from '../src/lib/planner/ops';
import {
	FULL_FRAME_CALIBRATION,
	calibrationFromCorners,
	imageToMat,
	legacyTableStretch,
	matToImage,
	type MatCalibration
} from '../src/lib/planner/calibration';
import {
	MAT_SIDE_STRIP_MM,
	TABLE_HEIGHT_MM,
	TABLE_WIDTH_MM,
	matToTable,
	onMat,
	routeMoves
} from '../src/lib/planner/geometry';

const service = serviceClient();

let mentor: SeededMentor;
let team: SeededTeam;
let otherTeam: SeededTeam;
let student: Client;
let otherStudent: Client;

/** The calibration under test: the MAT, inset inside a picture that has more in it. */
const CAL: MatCalibration = { origin: { u: 0.045, v: 0.875 }, far: { u: 0.955, v: 0.13 } };

/** Mission positions are GLOBAL rows; every one touched here is restored in afterAll. */
type MissionPos = { id: string; position_x_mm: number | null; position_y_mm: number | null };
let missionId = '';
let savedMissions: MissionPos[] = [];

function picture(): PreparedImage & { source: string } {
	try {
		const bytes = readFileSync('local-assets/bioglow-field.png');
		// PNG header: width and height are big-endian 32-bit at bytes 16 and 20.
		const width = bytes.readUInt32BE(16);
		const height = bytes.readUInt32BE(20);
		return {
			blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
			contentType: 'image/png',
			width,
			height,
			source: `local-assets/bioglow-field.png (${width}x${height}, ${bytes.length} bytes)`
		};
	} catch {
		// A minimal, valid 1x1 PNG. Enough to prove the storage round trip.
		const bytes = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			'base64'
		);
		return {
			blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
			contentType: 'image/png',
			width: 2019,
			height: 1153,
			source: 'synthesised 1x1 PNG (local-assets/bioglow-field.png not present)'
		};
	}
}

const PIC = picture();

beforeAll(async () => {
	mentor = await seedMentor('matimg');
	team = await createTeam(mentor.client, 'FieldPic');
	otherTeam = await createTeam(mentor.client, 'FieldPicRival');
	const s = await createStudent(mentor.client, team, 'Nina', 'K');
	const o = await createStudent(mentor.client, otherTeam, 'Omar', 'P');
	student = await signIn(s.email, s.pin);
	otherStudent = await signIn(o.email, o.pin);

	// Three, because the anisotropy case needs two ends of a path and the
	// round trip needs one of its own.
	savedMissions = await sql<MissionPos[]>`
		select id, position_x_mm, position_y_mm from public.missions order by sort_order limit 3`;
	missionId = savedMissions[0].id;

	console.log(`mat-image-roundtrip: using ${PIC.source}`);
});

afterAll(async () => {
	for (const m of savedMissions) {
		await service
			.from('missions')
			.update({ position_x_mm: m.position_x_mm, position_y_mm: m.position_y_mm })
			.eq('id', m.id);
	}
	await service.storage.from('mat').remove([matImagePath(team.teamId), matImagePath(otherTeam.teamId)]);
	await cleanupRun();
	await closeDb();
});

describe('a mentor uploads a field picture into their team folder', () => {
	test('the upload lands, and the row records the picture with NO calibration yet', async () => {
		const res = await uploadFieldImage(mentor.client, team.teamId, PIC);
		expect(res).toEqual({ ok: true, message: 'Picture saved. Calibrate it before it is shown.' });

		const loaded = await fetchMatImage(mentor.client, team.teamId);
		expect(loaded?.imageW).toBe(PIC.width);
		expect(loaded?.imageH).toBe(PIC.height);
		// The whole point: an uncalibrated picture is not a drawable picture.
		expect(loaded?.calibration).toBeNull();
		expect(loaded?.url).toBeTruthy();
	});

	test('the generated storage path names the team, and the object is really there', async () => {
		const loaded = await fetchMatImage(mentor.client, team.teamId);
		expect(loaded?.storagePath).toBe(`teams/${team.teamId}/field`);

		const listed = await service.storage.from('mat').list(`teams/${team.teamId}`);
		expect(listed.data?.map((o) => o.name)).toContain('field');
	});

	test('a client cannot choose the storage path: it is GENERATED', async () => {
		const res = await mentor.client
			.from('mat_images')
			// The column is in the generated Update type (PostgREST exposes it),
			// which is exactly why the SERVER refusing it is the thing that
			// matters: a client can send it and still cannot change it.
			.update({ storage_path: `teams/${otherTeam.teamId}/field` })
			.eq('team_id', team.teamId)
			.select('id');
		expect(res.error).not.toBeNull();

		const loaded = await fetchMatImage(mentor.client, team.teamId);
		expect(loaded?.storagePath).toBe(`teams/${team.teamId}/field`);
	});

	test('a re-upload CLEARS the calibration, because two corners describe one picture', async () => {
		expect((await saveCalibration(mentor.client, team.teamId, CAL)).ok).toBe(true);
		expect((await fetchMatImage(mentor.client, team.teamId))?.calibration).not.toBeNull();

		const again = await uploadFieldImage(mentor.client, team.teamId, PIC);
		expect(again).toEqual({ ok: true, message: 'New picture saved. Calibrate it before it is shown.' });
		expect((await fetchMatImage(mentor.client, team.teamId))?.calibration).toBeNull();
	});
});

describe('calibration is stored, and a degenerate one is refused', () => {
	test('the two tapped corners come back exactly as tapped', async () => {
		const res = await saveCalibration(mentor.client, team.teamId, CAL);
		expect(res.ok).toBe(true);

		const loaded = await fetchMatImage(mentor.client, team.teamId);
		expect(loaded?.calibration).toEqual(CAL);
	});

	test('the client refuses two taps too close together, and so does the table', async () => {
		const tooClose = { origin: { u: 0.5, v: 0.5 }, far: { u: 0.52, v: 0.9 } };
		const refusedHere = await saveCalibration(mentor.client, team.teamId, tooClose);
		expect(refusedHere.ok).toBe(false);
		expect(refusedHere.message).toContain('opposite corners');

		// Belt and braces: the same pair sent past the client check is refused
		// by 0017's own span constraint (23514), not silently stored.
		const refusedThere = await mentor.client
			.from('mat_images')
			.update({ origin_u: 0.5, origin_v: 0.5, far_u: 0.52, far_v: 0.9 })
			.eq('team_id', team.teamId)
			.select('id');
		expect(refusedThere.error?.code).toBe('23514');

		// The positive control: the good calibration is still what is stored.
		expect((await fetchMatImage(mentor.client, team.teamId))?.calibration).toEqual(CAL);
	});

	test('a half-written calibration is refused: all four corners or none', async () => {
		const res = await mentor.client
			.from('mat_images')
			.update({ origin_u: 0.1, origin_v: null, far_u: 0.9, far_v: 0.1 })
			.eq('team_id', team.teamId)
			.select('id');
		expect(res.error?.code).toBe('23514');
	});

	test('the dim control saves and reloads', async () => {
		expect((await saveDim(mentor.client, team.teamId, 65)).ok).toBe(true);
		expect((await fetchMatImage(mentor.client, team.teamId))?.dimPct).toBe(65);
		// Out of range is clamped by the client before the table's check bites.
		expect((await saveDim(mentor.client, team.teamId, 999)).ok).toBe(true);
		expect((await fetchMatImage(mentor.client, team.teamId))?.dimPct).toBe(90);
		await saveDim(mentor.client, team.teamId, 40);
	});
});

describe('THE ROUND TRIP: a marker placed on the picture comes back on the same pixel', () => {
	// Where a mentor tapped, as a fraction of the picture. Chosen near the far
	// corner, where a wrong transform is furthest off.
	const TAP = { u: 0.82, v: 0.27 };

	test('tap -> millimetres -> stored -> reloaded -> the same millimetres and the same pixel', async () => {
		const cal = calibrationFromCorners(CAL.origin, CAL.far) as MatCalibration;
		const mat = imageToMat(cal, TAP);
		const xMm = Math.round(mat.x);
		const yMm = Math.round(mat.y);
		// Sanity: a tap inside the calibrated rectangle is a point on the MAT,
		// and therefore also a point on the table, which is what is stored.
		expect(onMat({ x: xMm, y: yMm })).toBe(true);
		expect(xMm).toBeGreaterThan(0);
		expect(xMm).toBeLessThan(TABLE_WIDTH_MM);
		expect(yMm).toBeGreaterThan(0);
		expect(yMm).toBeLessThan(TABLE_HEIGHT_MM);

		// The shipping write path, through the same op the queue replays.
		const applied = await applyPlannerOp(mentor.client, {
			kind: 'mission_position',
			missionId,
			xMm,
			yMm
		});
		expect(applied).toBe('done');

		// RELOAD: a brand new signed-in client, the whole page load.
		const fresh = await signIn(mentor.email, mentor.password);
		const data = await loadPlannerData(fresh, team.teamId);
		const marker = data.missions.find((m) => m.id === missionId);
		expect(marker?.xMm).toBe(xMm);
		expect(marker?.yMm).toBe(yMm);
		expect(data.matImage?.calibration).toEqual(CAL);

		// And the marker draws back onto the pixel the mentor tapped. Half a
		// millimetre of rounding is the only difference allowed.
		const back = matToImage(data.matImage?.calibration as MatCalibration, {
			x: marker?.xMm as number,
			y: marker?.yMm as number
		});
		expect(Math.abs(back.u - TAP.u) * PIC.width).toBeLessThan(1);
		expect(Math.abs(back.v - TAP.v) * PIC.height).toBeLessThan(1);
	});

	test('NEGATIVE CONTROL: reading the same stored millimetres through the WRONG calibration lands elsewhere', async () => {
		// Treating a picture that is NOT cropped to the mat as though it were.
		// The stored millimetre is right; the pixel it draws on is not.
		const stretched: MatCalibration = FULL_FRAME_CALIBRATION;
		const { data } = await service
			.from('missions')
			.select('position_x_mm, position_y_mm')
			.eq('id', missionId)
			.single();
		const p = { x: data?.position_x_mm as number, y: data?.position_y_mm as number };
		const right = matToImage(CAL, p);
		const wrong = matToImage(stretched, p);
		const offPixels = Math.hypot((right.u - wrong.u) * PIC.width, (right.v - wrong.v) * PIC.height);
		expect(offPixels).toBeGreaterThan(50);
	});
});

describe('THE MAT SITS INSIDE THE TABLE, and the stored numbers say so', () => {
	test("a marker at the mat's OWN origin lands 181 mm in and flush with the bottom", async () => {
		// The mentor taps the corner of the printed sheet. That corner is not
		// the origin of the coordinate system: the sheet starts one 181 mm
		// strip in from the left wall and lies flush against the bottom one.
		// Driven through the real transform, the real op and a real reload.
		const cal = calibrationFromCorners(CAL.origin, CAL.far) as MatCalibration;
		const atMatOrigin = imageToMat(cal, cal.origin);
		expect(Math.round(atMatOrigin.x)).toBe(MAT_SIDE_STRIP_MM);
		expect(Math.round(atMatOrigin.y)).toBe(0);

		const applied = await applyPlannerOp(mentor.client, {
			kind: 'mission_position',
			missionId: savedMissions[1].id,
			xMm: Math.round(atMatOrigin.x),
			yMm: Math.round(atMatOrigin.y)
		});
		expect(applied).toBe('done');

		const fresh = await signIn(mentor.email, mentor.password);
		const data = await loadPlannerData(fresh, team.teamId);
		const marker = data.missions.find((m) => m.id === savedMissions[1].id);
		expect(marker?.xMm).toBe(181);
		expect(marker?.yMm).toBe(0);

		// And the far corner of the sheet is one strip short of the far wall.
		const atMatFar = imageToMat(cal, cal.far);
		expect(TABLE_WIDTH_MM - Math.round(atMatFar.x)).toBe(MAT_SIDE_STRIP_MM);
		// The only bare table above the sheet is the 9 mm top gap.
		expect(TABLE_HEIGHT_MM - Math.round(atMatFar.y)).toBe(9);

		// POSITIVE CONTROL: the mat's origin is a DIFFERENT point from the
		// table's, and the transform can still reach the table's origin --
		// it is simply off the sheet, which is a legal place to drive.
		expect(onMat({ x: 0, y: 0 })).toBe(false);
		expect(onMat({ x: 181, y: 0 })).toBe(true);
	});

	test('THE ANISOTROPY: a 45 degree path on the mat comes back as 45 degrees', async () => {
		// Two points 500 mm apart on each axis of the printed sheet, which is
		// a physically 45 degree drive. They go onto the picture through
		// matToImage, come back through imageToMat, are STORED as integers,
		// are reloaded by a fresh client, and only then become a movement.
		const cal = calibrationFromCorners(CAL.origin, CAL.far) as MatCalibration;
		const fromTable = matToTable({ x: 400, y: 300 });
		const toTable = matToTable({ x: 900, y: 800 });
		const fromPix = matToImage(cal, fromTable);
		const toPix = matToImage(cal, toTable);

		const a = imageToMat(cal, fromPix);
		const b = imageToMat(cal, toPix);
		for (const [m, id] of [
			[a, savedMissions[1].id],
			[b, savedMissions[2].id]
		] as const) {
			expect(
				await applyPlannerOp(mentor.client, {
					kind: 'mission_position',
					missionId: id,
					xMm: Math.round(m.x),
					yMm: Math.round(m.y)
				})
			).toBe('done');
		}

		const fresh = await signIn(mentor.email, mentor.password);
		const data = await loadPlannerData(fresh, team.teamId);
		const pa = data.missions.find((m) => m.id === savedMissions[1].id);
		const pb = data.missions.find((m) => m.id === savedMissions[2].id);
		expect([pa?.xMm, pa?.yMm]).toEqual([581, 300]);
		expect([pb?.xMm, pb?.yMm]).toEqual([1081, 800]);

		const moves = routeMoves([
			{ x: pa?.xMm as number, y: pa?.yMm as number },
			{ x: pb?.xMm as number, y: pb?.yMm as number }
		]);
		expect(moves).toHaveLength(1);
		expect(moves[0].headingDeg).toBeCloseTo(45, 9);
		expect(moves[0].driveCm).toBeCloseTo(Math.hypot(500, 500) / 10, 9);

		// WHAT IT USED TO SAY. The same two taps on the same picture, read
		// onto the TABLE rectangle the way this module did until now: the
		// long axis stretched by 2362/2000 and the short one by 1143/1134, so
		// the drive came back 18.1% long on x and the heading came back bent.
		const legacyFrom = legacyTableStretch(cal, fromPix);
		const legacyTo = legacyTableStretch(cal, toPix);
		const legacyMoves = routeMoves([legacyFrom, legacyTo]);
		expect(legacyMoves[0].headingDeg).toBeCloseTo(40.48, 1);
		expect(legacyMoves[0].headingDeg).not.toBeCloseTo(45, 0);
		// The x component alone, before and after: 590.5 mm against 500 mm.
		expect((legacyTo.x - legacyFrom.x) / (b.x - a.x)).toBeCloseTo(1.181, 3);
	});
});

describe('the picture is private: signed URL only', () => {
	let signedUrl = '';

	test('a signed URL serves the bytes (the positive control)', async () => {
		const loaded = await fetchMatImage(mentor.client, team.teamId);
		signedUrl = loaded?.url ?? '';
		expect(signedUrl).toContain(`teams/${team.teamId}/field`);
		expect(signedUrl).toContain('token=');

		const res = await fetch(signedUrl);
		expect(res.status).toBe(200);
		const body = await res.arrayBuffer();
		expect(body.byteLength).toBe(PIC.blob.size);
	});

	test('the same object with the token stripped is refused', async () => {
		const noToken = signedUrl.split('?')[0];
		const res = await fetch(noToken);
		expect(res.ok).toBe(false);
		expect([400, 401, 403, 404]).toContain(res.status);
	});

	test('the public object endpoint does not serve it: the bucket is private', async () => {
		const base = signedUrl.split('/storage/v1/')[0];
		const res = await fetch(`${base}/storage/v1/object/public/mat/teams/${team.teamId}/field`);
		expect(res.ok).toBe(false);
	});

	test('an unauthenticated client cannot even mint a signed URL', async () => {
		const { anonClient } = await import('./db/harness');
		const anon = anonClient();
		const { data, error } = await anon.storage
			.from('mat')
			.createSignedUrl(matImagePath(team.teamId), 60);
		expect(data?.signedUrl ?? null).toBeNull();
		expect(error).not.toBeNull();
	});
});

describe('the picture belongs to ONE team', () => {
	test("this team's student reads the row and gets a working URL", async () => {
		const loaded = await fetchMatImage(student, team.teamId);
		expect(loaded?.calibration).toEqual(CAL);
		expect(loaded?.url).toBeTruthy();
		const res = await fetch(loaded?.url as string);
		expect(res.status).toBe(200);
	});

	test('another team\'s student sees no row and cannot mint a URL', async () => {
		const loaded = await fetchMatImage(otherStudent, team.teamId);
		expect(loaded).toBeNull();

		const signed = await otherStudent.storage.from('mat').createSignedUrl(matImagePath(team.teamId), 60);
		expect(signed.data?.signedUrl ?? null).toBeNull();
		expect(signed.error).not.toBeNull();

		// POSITIVE CONTROL: the row and the object both exist, through the
		// service role. An empty read was a refusal, not an empty table.
		const { data } = await service.from('mat_images').select('id').eq('team_id', team.teamId);
		expect(data).toHaveLength(1);
		const listed = await service.storage.from('mat').list(`teams/${team.teamId}`);
		expect(listed.data?.map((o) => o.name)).toContain('field');
	});

	test('another team\'s student cannot read the object by listing or downloading either', async () => {
		const listed = await otherStudent.storage.from('mat').list(`teams/${team.teamId}`);
		expect(listed.data ?? []).toHaveLength(0);

		const down = await otherStudent.storage.from('mat').download(matImagePath(team.teamId));
		expect(down.data).toBeNull();
		expect(down.error).not.toBeNull();

		// POSITIVE CONTROL: the same statement against their OWN team folder
		// succeeds once a picture is there.
		await uploadFieldImage(mentor.client, otherTeam.teamId, PIC);
		const own = await otherStudent.storage.from('mat').list(`teams/${otherTeam.teamId}`);
		expect(own.data?.map((o) => o.name)).toContain('field');
	});

	test('a student cannot upload, calibrate or delete: this is a mentor measurement', async () => {
		const upload = await student.storage
			.from('mat')
			.upload(matImagePath(team.teamId), new Blob([new Uint8Array([1, 2, 3])]), { upsert: true });
		expect(upload.error).not.toBeNull();

		const recalibrate = await student
			.from('mat_images')
			.update({ origin_u: 0.2, origin_v: 0.8, far_u: 0.8, far_v: 0.2 })
			.eq('team_id', team.teamId)
			.select('id');
		// An RLS-filtered write is not an error: zero rows is the refusal.
		expect(recalibrate.error).toBeNull();
		expect(recalibrate.data).toHaveLength(0);

		const removed = await student.from('mat_images').delete().eq('team_id', team.teamId).select('id');
		expect(removed.data ?? []).toHaveLength(0);

		// POSITIVE CONTROL: the calibration is untouched, and the same
		// statement as the mentor moves one row.
		expect((await fetchMatImage(mentor.client, team.teamId))?.calibration).toEqual(CAL);
		const asMentor = await mentor.client
			.from('mat_images')
			.update({ origin_u: CAL.origin.u, origin_v: CAL.origin.v, far_u: CAL.far.u, far_v: CAL.far.v })
			.eq('team_id', team.teamId)
			.select('id');
		expect(asMentor.data).toHaveLength(1);
	});
});

describe('a mentor can take the picture back out', () => {
	test('removeFieldImage clears the object and the row together', async () => {
		const res = await removeFieldImage(mentor.client, otherTeam.teamId);
		expect(res.ok).toBe(true);

		expect(await fetchMatImage(mentor.client, otherTeam.teamId)).toBeNull();
		const listed = await service.storage.from('mat').list(`teams/${otherTeam.teamId}`);
		expect(listed.data?.map((o) => o.name) ?? []).not.toContain('field');

		// POSITIVE CONTROL: the other team's picture is untouched.
		expect((await fetchMatImage(mentor.client, team.teamId))?.calibration).toEqual(CAL);
	});
});
