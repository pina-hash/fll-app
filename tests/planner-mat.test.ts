// tests/planner-mat.test.ts
//
// THE MAT SETUP SURFACES: the mat_config singleton (launch area, mentor-only
// writes) and the private 'mat' bucket. mat_config is GLOBAL, so this file
// saves and restores it.
//
// THE BUCKET'S READ RULE CHANGED IN 0017 AND THIS FILE RECORDS THE CHANGE.
// Under 0012 any signed-in account could read any object in the bucket,
// which was fine for the club's own photo of its own mat and is NOT fine for
// a copyrighted field layout. Reads are now scoped to teams/<team_id>/, so an
// object at the bucket ROOT -- like the one this file uploads -- is readable
// by mentors and by nobody else. The per-team half is proved end to end in
// tests/mat-image-roundtrip.test.ts.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	cleanupRun,
	closeDb,
	createStudent,
	createTeam,
	seedMentor,
	serviceClient,
	signIn,
	RUN,
	type Client,
	type SeededMentor
} from './db/harness';

let mentor: SeededMentor;
let studentClient: Client;

const service = serviceClient();
const testObject = `test-${RUN}.jpg`;
let savedConfig: { launch_area_w_mm: number | null; launch_area_h_mm: number | null } | null = null;

beforeAll(async () => {
	mentor = await seedMentor('mat');
	const team = await createTeam(mentor.client, 'Mat');
	const student = await createStudent(mentor.client, team, 'Mia', 'M');
	studentClient = await signIn(student.email, student.pin);

	const { data } = await service.from('mat_config').select('launch_area_w_mm, launch_area_h_mm').single();
	savedConfig = data;
});

afterAll(async () => {
	if (savedConfig) {
		await service.from('mat_config').update(savedConfig).eq('id', true);
	}
	await service.storage.from('mat').remove([testObject]);
	await cleanupRun();
	await closeDb();
});

describe('mat_config: one row, everyone reads, mentors write', () => {
	test('exactly one row exists and a student can read it', async () => {
		const { data, error } = await studentClient.from('mat_config').select('launch_area_w_mm, launch_area_h_mm');
		expect(error).toBeNull();
		expect(data).toHaveLength(1);
	});

	test('a student update is filtered to zero rows; the same statement moves one row for a mentor', async () => {
		const denied = await studentClient
			.from('mat_config')
			.update({ launch_area_w_mm: 111 })
			.eq('id', true)
			.select('id');
		expect(denied.error).toBeNull();
		expect(denied.data).toHaveLength(0);

		const allowed = await mentor.client
			.from('mat_config')
			.update({ launch_area_w_mm: 480, launch_area_h_mm: 950 })
			.eq('id', true)
			.select('id');
		expect(allowed.error).toBeNull();
		expect(allowed.data).toHaveLength(1);

		const { data } = await service.from('mat_config').select('launch_area_w_mm, launch_area_h_mm').single();
		expect(data).toEqual({ launch_area_w_mm: 480, launch_area_h_mm: 950 });
	});

	test('a second row cannot appear: the singleton check refuses id = false and clients hold no insert grant', async () => {
		const asClient = await studentClient
			.from('mat_config')
			.insert({ id: false as never });
		expect(asClient.error).not.toBeNull();

		const asService = await service.from('mat_config').insert({ id: false as never });
		// 23514: the check constraint (id must be true); 23505 would mean the
		// true row already exists. Either way there is one row.
		expect(['23514', '23505']).toContain(asService.error?.code);
	});
});

describe('the mat bucket', () => {
	const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

	test('a mentor uploads; a student cannot', async () => {
		const mentorUpload = await mentor.client.storage
			.from('mat')
			.upload(testObject, bytes, { contentType: 'image/jpeg', upsert: true });
		expect(mentorUpload.error).toBeNull();

		const studentUpload = await studentClient.storage
			.from('mat')
			.upload(`student-${RUN}.jpg`, bytes, { contentType: 'image/jpeg', upsert: true });
		expect(studentUpload.error).not.toBeNull();
	});

	test('an object outside teams/<team_id>/ is readable by mentors and by nobody else', async () => {
		// The POSITIVE CONTROL first: the object is really there and really
		// readable, so the student's empty answer below is a refusal and not an
		// empty bucket.
		const asMentor = await mentor.client.storage.from('mat').createSignedUrl(testObject, 60);
		expect(asMentor.error).toBeNull();
		expect(asMentor.data?.signedUrl).toContain(testObject);

		const asStudent = await studentClient.storage.from('mat').createSignedUrl(testObject, 60);
		expect(asStudent.data?.signedUrl ?? null).toBeNull();
		// Probing reveals nothing: a filtered read answers "not found", the same
		// answer an object that does not exist would get.
		expect(asStudent.error?.message).toContain('not found');
	});

	test('a student cannot delete it either', async () => {
		const removed = await studentClient.storage.from('mat').remove([testObject]);
		// Storage answers a filtered delete with an empty list, not an error.
		expect(removed.data ?? []).toHaveLength(0);
		const still = await service.storage.from('mat').list('', { search: testObject });
		expect(still.data?.some((o) => o.name === testObject)).toBe(true);
	});
});
