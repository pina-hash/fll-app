// tests/team-isolation.test.ts
//
// THE CROSS-TEAM PROOF. A student on team A cannot read or write team B's
// tasks, blockers, evidence, roster, attendance, role assignments or team row
// -- by listing, by id, through PostgREST and through SQL -- while the service
// role (the positive control) sees every one of those rows. An RLS policy that
// silently fails open is indistinguishable from one that works unless the
// same row is shown to exist and to be invisible in the same test.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	asUser,
	captureError,
	cleanupRun,
	closeDb,
	createStudent,
	createTeam,
	expectPostgrestError,
	seedMentor,
	serviceClient,
	signIn,
	sql,
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
const svc = serviceClient();

const rows = {
	taskA: '',
	taskB: '',
	blockerB: '',
	evidenceB: '',
	roleB: '',
	attendanceB: '',
	meetingId: ''
};

beforeAll(async () => {
	mentor = await seedMentor('iso');
	teamA = await createTeam(mentor.client, 'A');
	teamB = await createTeam(mentor.client, 'B');
	a1 = await createStudent(mentor.client, teamA, 'Alice', 'A');
	b1 = await createStudent(mentor.client, teamB, 'Bob', 'B');

	const m = mentor.client;
	const taskA = await m
		.from('tasks')
		.insert({ team_id: teamA.teamId, title: 'A task', created_by_mentor_id: mentor.mentorId })
		.select('id')
		.single();
	const taskB = await m
		.from('tasks')
		.insert({ team_id: teamB.teamId, title: 'B task', created_by_mentor_id: mentor.mentorId })
		.select('id')
		.single();
	if (taskA.error || taskB.error) throw new Error(`seed tasks: ${taskA.error?.message ?? taskB.error?.message}`);
	rows.taskA = taskA.data.id;
	rows.taskB = taskB.data.id;

	const blockerB = await m
		.from('blockers')
		.insert({ team_id: teamB.teamId, student_id: b1.studentId, task_id: rows.taskB, note: 'B is stuck' })
		.select('id')
		.single();
	if (blockerB.error) throw new Error(`seed blocker: ${blockerB.error.message}`);
	rows.blockerB = blockerB.data.id;

	const evidenceB = await m
		.from('evidence')
		.insert({
			team_id: teamB.teamId,
			task_id: rows.taskB,
			storage_path: `${teamB.teamId}/${rows.taskB}/photo.jpg`,
			uploaded_by_student_id: b1.studentId
		})
		.select('id')
		.single();
	if (evidenceB.error) throw new Error(`seed evidence: ${evidenceB.error.message}`);
	rows.evidenceB = evidenceB.data.id;

	const roleB = await m
		.from('role_assignments')
		.insert({ team_id: teamB.teamId, student_id: b1.studentId, role: 'lead_builder', tier: 'primary' })
		.select('id')
		.single();
	if (roleB.error) throw new Error(`seed role: ${roleB.error.message}`);
	rows.roleB = roleB.data.id;

	const meeting = await m.rpc('meeting_create', {
		p_kind: 'friday',
		p_meeting_date: '2026-09-04',
		p_planned_start_at: '2026-09-04T16:30:00-07:00'
	});
	if (meeting.error) throw new Error(`seed meeting: ${meeting.error.message}`);
	rows.meetingId = (meeting.data as { meeting_id: string }).meeting_id;

	const attendanceB = await m
		.from('attendance')
		.insert({ meeting_id: rows.meetingId, student_id: b1.studentId })
		.select('id')
		.single();
	if (attendanceB.error) throw new Error(`seed attendance: ${attendanceB.error.message}`);
	rows.attendanceB = attendanceB.data.id;

	alice = await signIn(a1.email, a1.pin);
});

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('reads: team B is invisible to a team A student, and exists', () => {
	test('listing tasks returns only team A rows, including the team A task', async () => {
		const { data, error } = await alice.from('tasks').select('id, team_id');
		expect(error).toBeNull();
		expect(data!.length).toBeGreaterThan(0);
		expect(data!.every((t) => t.team_id === teamA.teamId)).toBe(true);
		expect(data!.map((t) => t.id)).toContain(rows.taskA);
		expect(data!.map((t) => t.id)).not.toContain(rows.taskB);
	});

	const byId: Array<[string, () => string, 'tasks' | 'blockers' | 'evidence' | 'role_assignments' | 'attendance']> = [
		['task', () => rows.taskB, 'tasks'],
		['blocker', () => rows.blockerB, 'blockers'],
		['evidence row', () => rows.evidenceB, 'evidence'],
		['role assignment', () => rows.roleB, 'role_assignments'],
		['attendance row', () => rows.attendanceB, 'attendance']
	];

	for (const [label, idOf, table] of byId) {
		test(`team B ${label} by id: empty for the student, present for the service role`, async () => {
			const denied = await alice.from(table).select('id').eq('id', idOf());
			expect(denied.error).toBeNull();
			expect(denied.data).toEqual([]);

			const control = await svc.from(table).select('id').eq('id', idOf());
			expect(control.error).toBeNull();
			expect(control.data).toHaveLength(1);
		});
	}

	test('the team B roster and team row are invisible; team A roster and row are visible', async () => {
		const students = await alice.from('students').select('id, team_id');
		expect(students.error).toBeNull();
		expect(students.data!.every((s) => s.team_id === teamA.teamId)).toBe(true);
		expect(students.data!.map((s) => s.id)).toContain(a1.studentId);
		expect(students.data!.map((s) => s.id)).not.toContain(b1.studentId);

		const teams = await alice.from('teams').select('id');
		expect(teams.error).toBeNull();
		expect(teams.data!.map((t) => t.id)).toEqual([teamA.teamId]);

		const control = await svc.from('students').select('id').eq('id', b1.studentId);
		expect(control.data).toHaveLength(1);
	});

	test('a student cannot read the mentors table at all', async () => {
		const { data, error } = await alice.from('mentors').select('id');
		expect(error).toBeNull();
		expect(data).toEqual([]);
		const control = await svc.from('mentors').select('id').eq('id', mentor.mentorId);
		expect(control.data).toHaveLength(1);
	});

	test('SQL path: the same select as authenticated with the student claims is empty', async () => {
		const visible = await asUser(a1.authUserId, (tx) => tx`select id from public.tasks where id = ${rows.taskB}`);
		expect(visible).toHaveLength(0);
		const own = await asUser(a1.authUserId, (tx) => tx`select id from public.tasks where id = ${rows.taskA}`);
		expect(own).toHaveLength(1);
	});
});

describe('writes: a team A student cannot write team B', () => {
	test('insert a task into team B is refused with 42501', async () => {
		const error = expectPostgrestError(
			await alice.from('tasks').insert({
				team_id: teamB.teamId,
				title: 'forged',
				created_by_student_id: a1.studentId
			})
		);
		expect(error.code).toBe('42501');
		const control = await svc.from('tasks').select('id').eq('team_id', teamB.teamId).eq('title', 'forged');
		expect(control.data).toEqual([]);
	});

	test('SQL path: insert into team B tasks is 42501', async () => {
		const error = await captureError(() =>
			asUser(
				a1.authUserId,
				(tx) =>
					tx`insert into public.tasks (team_id, title, created_by_student_id)
					   values (${teamB.teamId}, 'forged', ${a1.studentId})`
			)
		);
		expect(error.code).toBe('42501');
	});

	test('update of a team B task affects zero rows and leaves the row unchanged', async () => {
		const { data, error } = await alice.from('tasks').update({ title: 'hacked' }).eq('id', rows.taskB).select('id');
		expect(error).toBeNull();
		expect(data).toEqual([]);
		const control = await svc.from('tasks').select('title').eq('id', rows.taskB).single();
		expect(control.data!.title).toBe('B task');
	});

	test('a blocker raised "by" a team B student, or into team B, is refused', async () => {
		const asOther = expectPostgrestError(
			await alice.from('blockers').insert({ team_id: teamA.teamId, student_id: b1.studentId, note: 'forged' })
		);
		expect(asOther.code).toMatch(/^(42501|23503)$/);
		const intoB = expectPostgrestError(
			await alice.from('blockers').insert({ team_id: teamB.teamId, student_id: a1.studentId, note: 'forged' })
		);
		expect(intoB.code).toMatch(/^(42501|23503)$/);
	});

	test('evidence attached to a team B task is refused', async () => {
		const error = expectPostgrestError(
			await alice.from('evidence').insert({
				team_id: teamB.teamId,
				task_id: rows.taskB,
				storage_path: `${teamB.teamId}/${rows.taskB}/forged.jpg`,
				uploaded_by_student_id: a1.studentId
			})
		);
		expect(error.code).toMatch(/^(42501|23503)$/);
	});

	test('a student cannot delete a task, even on their own team', async () => {
		const { data, error } = await alice.from('tasks').delete().eq('id', rows.taskA).select('id');
		expect(error).toBeNull();
		expect(data).toEqual([]);
		const control = await svc.from('tasks').select('id').eq('id', rows.taskA);
		expect(control.data).toHaveLength(1);
	});

	test('a student cannot create a task attributed to a mentor', async () => {
		const error = expectPostgrestError(
			await alice.from('tasks').insert({ team_id: teamA.teamId, title: 'forged', created_by_mentor_id: mentor.mentorId })
		);
		expect(error.code).toBe('42501');
	});

	test('a student cannot flip evidence_required on their own team task (mentor-only column)', async () => {
		const { error } = await alice.from('tasks').update({ evidence_required: true }).eq('id', rows.taskA);
		expect(error).not.toBeNull();
		expect(error!.message).toMatch(/Only a mentor can change "evidence_required"/);
		const control = await svc.from('tasks').select('evidence_required').eq('id', rows.taskA).single();
		expect(control.data!.evidence_required).toBe(false);
	});

	test('a student CAN update their own team task (the positive half of the write policy)', async () => {
		const { data, error } = await alice.from('tasks').update({ status: 'active' }).eq('id', rows.taskA).select('status');
		expect(error).toBeNull();
		expect(data).toEqual([{ status: 'active' }]);
	});
});

describe('the mentor sees both teams', () => {
	test('mentor lists tasks from both teams', async () => {
		const { data, error } = await mentor.client.from('tasks').select('id');
		expect(error).toBeNull();
		const ids = data!.map((t) => t.id);
		expect(ids).toContain(rows.taskA);
		expect(ids).toContain(rows.taskB);
	});

	test('a mentor resolving a blocker records themselves, and cannot record another mentor', async () => {
		const other = await sql<{ id: string }[]>`select id from public.mentors where id <> ${mentor.mentorId} limit 1`;
		if (other.length) {
			const forged = await mentor.client
				.from('blockers')
				.update({ resolved_at: new Date().toISOString(), resolved_by_mentor_id: other[0].id })
				.eq('id', rows.blockerB)
				.select('id');
			expect(forged.error?.code).toBe('42501');
		}
		const ok = await mentor.client
			.from('blockers')
			.update({ resolved_at: new Date().toISOString(), resolved_by_mentor_id: mentor.mentorId })
			.eq('id', rows.blockerB)
			.select('resolved_by_mentor_id');
		expect(ok.error).toBeNull();
		expect(ok.data).toEqual([{ resolved_by_mentor_id: mentor.mentorId }]);
	});
});
