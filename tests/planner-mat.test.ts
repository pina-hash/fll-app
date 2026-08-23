// tests/planner-mat.test.ts
//
// THE MAT SETUP SURFACES: the mat_config singleton (launch area, mentor-only
// writes) and the private 'mat' photo bucket (mentor writes, any signed-in
// reader). Both are GLOBAL, so this file saves and restores what it touches.

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

describe('the mat photo bucket', () => {
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

	test('a signed-in student reads the photo through a signed URL; a student cannot delete it', async () => {
		const signed = await studentClient.storage.from('mat').createSignedUrl(testObject, 60);
		expect(signed.error).toBeNull();
		expect(signed.data?.signedUrl).toContain(testObject);

		const removed = await studentClient.storage.from('mat').remove([testObject]);
		// Storage answers a filtered delete with an empty list, not an error.
		expect(removed.data ?? []).toHaveLength(0);
		const still = await service.storage.from('mat').list('', { search: testObject });
		expect(still.data?.some((o) => o.name === testObject)).toBe(true);
	});
});
