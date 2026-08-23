// tests/meetings-attendance.test.ts
//
// MEETINGS ARE SHARED AND MENTOR-WRITTEN (0006): every signed-in user reads
// them, only a mentor changes them, the current phase must belong to its own
// meeting, and a student can check themselves in only while a meeting is live
// -- with checked_in_at stamped by the server.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	cleanupRun,
	closeDb,
	createStudent,
	createTeam,
	expectPostgrestError,
	seedMentor,
	serviceClient,
	signIn,
	type Client,
	type SeededMentor,
	type SeededStudent,
	type SeededTeam
} from './db/harness';

let mentor: SeededMentor;
let teamA: SeededTeam;
let teamB: SeededTeam;
let a1: SeededStudent;
let b1: SeededStudent;
let alice: Client;
let friday = '';
let saturday = '';

beforeAll(async () => {
	mentor = await seedMentor('meet');
	teamA = await createTeam(mentor.client, 'MeetA');
	teamB = await createTeam(mentor.client, 'MeetB');
	a1 = await createStudent(mentor.client, teamA, 'Nia', 'N');
	b1 = await createStudent(mentor.client, teamB, 'Oli', 'O');
	alice = await signIn(a1.email, a1.pin);
});

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('meeting_create', () => {
	test('stamps the Friday template: four phases, 90 minutes', async () => {
		const { data, error } = await mentor.client.rpc('meeting_create', {
			p_kind: 'friday',
			p_meeting_date: '2026-09-11',
			p_planned_start_at: '2026-09-11T16:30:00-07:00'
		});
		expect(error).toBeNull();
		const out = data as { meeting_id: string; phases: number; planned_start_at: string; planned_end_at: string };
		friday = out.meeting_id;
		expect(out.phases).toBe(4);
		expect(Date.parse(out.planned_end_at) - Date.parse(out.planned_start_at)).toBe(90 * 60_000);

		const phases = await mentor.client.from('meeting_phases').select('ordinal, name, planned_minutes').eq('meeting_id', friday).order('ordinal');
		expect(phases.data).toEqual([
			{ ordinal: 1, name: 'Huddle', planned_minutes: 10 },
			{ ordinal: 2, name: 'Role Blocks', planned_minutes: 60 },
			{ ordinal: 3, name: 'Mat Run', planned_minutes: 15 },
			{ ordinal: 4, name: 'Close', planned_minutes: 5 }
		]);
	});

	test('stamps the Saturday template: 120 minutes', async () => {
		const { data, error } = await mentor.client.rpc('meeting_create', {
			p_kind: 'saturday',
			p_meeting_date: '2026-09-12',
			p_planned_start_at: '2026-09-12T09:00:00-07:00'
		});
		expect(error).toBeNull();
		const out = data as { meeting_id: string; planned_start_at: string; planned_end_at: string };
		saturday = out.meeting_id;
		expect(Date.parse(out.planned_end_at) - Date.parse(out.planned_start_at)).toBe(120 * 60_000);
	});

	test('a student cannot create a meeting, by RPC or by insert', async () => {
		const rpc = expectPostgrestError(
			await alice.rpc('meeting_create', { p_kind: 'friday', p_meeting_date: '2026-09-18', p_planned_start_at: '2026-09-18T16:30:00-07:00' })
		);
		expect(rpc.message).toBe('Only a mentor can create a meeting.');
		const ins = expectPostgrestError(
			await alice.from('meetings').insert({
				meeting_date: '2026-09-18',
				kind: 'friday',
				planned_start_at: '2026-09-18T16:30:00-07:00',
				planned_end_at: '2026-09-18T18:00:00-07:00',
				created_by: mentor.mentorId
			})
		);
		expect(ins.code).toBe('42501');
	});
});

describe('reading and the current phase', () => {
	test('a student reads every meeting and phase', async () => {
		const meetings = await alice.from('meetings').select('id').in('id', [friday, saturday]);
		expect(meetings.data).toHaveLength(2);
		const phases = await alice.from('meeting_phases').select('id').eq('meeting_id', friday);
		expect(phases.data).toHaveLength(4);
	});

	test('a student update of a meeting affects zero rows', async () => {
		const { data, error } = await alice.from('meetings').update({ started_at: new Date().toISOString() }).eq('id', friday).select('id');
		expect(error).toBeNull();
		expect(data).toEqual([]);
	});

	test('current_phase_id must point at one of the meeting\'s own phases', async () => {
		const saturdayPhase = await mentor.client.from('meeting_phases').select('id').eq('meeting_id', saturday).eq('ordinal', 1).single();
		const wrong = expectPostgrestError(await mentor.client.from('meetings').update({ current_phase_id: saturdayPhase.data!.id }).eq('id', friday));
		expect(wrong.code).toBe('23503');

		const fridayPhase = await mentor.client.from('meeting_phases').select('id').eq('meeting_id', friday).eq('ordinal', 1).single();
		const ok = await mentor.client.from('meetings').update({ current_phase_id: fridayPhase.data!.id }).eq('id', friday).select('current_phase_id');
		expect(ok.error).toBeNull();
		expect(ok.data).toEqual([{ current_phase_id: fridayPhase.data!.id }]);
	});
});

describe('attendance', () => {
	test('a student cannot check in before the meeting starts', async () => {
		const error = expectPostgrestError(await alice.from('attendance').insert({ meeting_id: friday, student_id: a1.studentId }));
		expect(error.code).toBe('42501');
	});

	test('once live, a student checks themselves in; checked_in_at is stamped by the server', async () => {
		const start = await mentor.client.from('meetings').update({ started_at: new Date().toISOString() }).eq('id', friday).select('id');
		expect(start.data).toHaveLength(1);

		const before = Date.now();
		const { data, error } = await alice.from('attendance').insert({ meeting_id: friday, student_id: a1.studentId }).select('checked_in_at').single();
		expect(error).toBeNull();
		expect(Date.parse(data!.checked_in_at)).toBeGreaterThan(before - 60_000);
	});

	test('a student cannot set checked_in_at, check in a teammate from another team, or check in twice', async () => {
		const stamped = expectPostgrestError(
			await alice.from('attendance').insert({ meeting_id: friday, student_id: a1.studentId, checked_in_at: '2020-01-01T00:00:00Z' })
		);
		expect(stamped.code).toBe('42501');
		const other = expectPostgrestError(await alice.from('attendance').insert({ meeting_id: friday, student_id: b1.studentId }));
		expect(other.code).toBe('42501');
		const twice = expectPostgrestError(await alice.from('attendance').insert({ meeting_id: friday, student_id: a1.studentId }));
		expect(twice.code).toBe('23505');
	});

	test('a student reads their team\'s attendance only; the mentor reads all', async () => {
		const bob = await mentor.client.from('attendance').insert({ meeting_id: friday, student_id: b1.studentId }).select('id').single();
		expect(bob.error).toBeNull();

		const mine = await alice.from('attendance').select('student_id').eq('meeting_id', friday);
		expect(mine.data).toEqual([{ student_id: a1.studentId }]);

		const all = await mentor.client.from('attendance').select('student_id').eq('meeting_id', friday);
		expect(all.data!.map((r) => r.student_id).sort()).toEqual([a1.studentId, b1.studentId].sort());

		const control = await serviceClient().from('attendance').select('id').eq('id', bob.data!.id);
		expect(control.data).toHaveLength(1);
	});

	test('after the meeting ends, check-in closes again', async () => {
		await mentor.client.from('meetings').update({ ended_at: new Date().toISOString() }).eq('id', friday);
		const late = await createStudent(mentor.client, teamA, 'Pax', 'P');
		const pax = await signIn(late.email, late.pin);
		const error = expectPostgrestError(await pax.from('attendance').insert({ meeting_id: friday, student_id: late.studentId }));
		expect(error.code).toBe('42501');
	});
});
