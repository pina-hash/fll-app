// tests/evidence-grants.test.ts
//
// upload_timestamp IS SERVER-OWNED AT THE GRANT LEVEL (0007). No client --
// student or mentor, through PostgREST or as the authenticated role in SQL --
// can name the column in an insert or update; the default stamps it. The same
// file shows the row CAN be written without naming it (the positive control)
// and that the path check ties a row to its own team and task.

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
let a2: SeededStudent;
let alice: Client;
let taskA = '';

beforeAll(async () => {
	mentor = await seedMentor('evid');
	teamA = await createTeam(mentor.client, 'EvidA');
	teamB = await createTeam(mentor.client, 'EvidB');
	a1 = await createStudent(mentor.client, teamA, 'Lee', 'L');
	a2 = await createStudent(mentor.client, teamA, 'Mia', 'M');
	const task = await mentor.client
		.from('tasks')
		.insert({ team_id: teamA.teamId, title: 'Build the arm', created_by_mentor_id: mentor.mentorId, evidence_required: true })
		.select('id')
		.single();
	if (task.error) throw new Error(task.error.message);
	taskA = task.data.id;
	alice = await signIn(a1.email, a1.pin);
});

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('upload_timestamp', () => {
	test('a student attaches evidence without naming the column and the server stamps it', async () => {
		const before = Date.now();
		const { data, error } = await alice
			.from('evidence')
			.insert({
				team_id: teamA.teamId,
				task_id: taskA,
				storage_path: `${teamA.teamId}/${taskA}/arm-1.jpg`,
				caption: 'first try',
				uploaded_by_student_id: a1.studentId
			})
			.select('upload_timestamp')
			.single();
		expect(error).toBeNull();
		const stamped = Date.parse(data!.upload_timestamp);
		expect(stamped).toBeGreaterThan(before - 60_000);
		expect(stamped).toBeLessThan(Date.now() + 60_000);
	});

	test('naming upload_timestamp on insert is refused with 42501, for a student and for a mentor', async () => {
		const forged = '2020-01-01T00:00:00Z';
		const asStudent = expectPostgrestError(
			await alice.from('evidence').insert({
				team_id: teamA.teamId,
				task_id: taskA,
				storage_path: `${teamA.teamId}/${taskA}/forged-student.jpg`,
				uploaded_by_student_id: a1.studentId,
				upload_timestamp: forged
			})
		);
		expect(asStudent.code).toBe('42501');

		const asMentor = expectPostgrestError(
			await mentor.client.from('evidence').insert({
				team_id: teamA.teamId,
				task_id: taskA,
				storage_path: `${teamA.teamId}/${taskA}/forged-mentor.jpg`,
				uploaded_by_student_id: a1.studentId,
				upload_timestamp: forged
			})
		);
		expect(asMentor.code).toBe('42501');

		const control = await serviceClient().from('evidence').select('id').like('storage_path', '%forged-%');
		expect(control.data).toEqual([]);
	});

	test('naming upload_timestamp on update is refused with 42501', async () => {
		const asStudent = expectPostgrestError(
			await alice.from('evidence').update({ upload_timestamp: '2020-01-01T00:00:00Z' }).eq('task_id', taskA)
		);
		expect(asStudent.code).toBe('42501');
		const asMentor = expectPostgrestError(
			await mentor.client.from('evidence').update({ upload_timestamp: '2020-01-01T00:00:00Z' }).eq('task_id', taskA)
		);
		expect(asMentor.code).toBe('42501');
	});

	test('SQL path as the authenticated role: the column privilege is what refuses it', async () => {
		const error = await captureError(() =>
			asUser(
				mentor.authUserId,
				(tx) => tx`insert into public.evidence (team_id, task_id, storage_path, uploaded_by_student_id, upload_timestamp)
					values (${teamA.teamId}, ${taskA}, ${`${teamA.teamId}/${taskA}/sql-forged.jpg`}, ${a1.studentId}, '2020-01-01')`
			)
		);
		expect(error.code).toBe('42501');
		expect(error.message).toMatch(/permission denied/);
	});

	test('the catalog agrees: no INSERT or UPDATE privilege on the column for authenticated or anon', async () => {
		const rows = await sql<{ grantee: string; privilege_type: string }[]>`
			select grantee, privilege_type from information_schema.column_privileges
			where table_schema = 'public' and table_name = 'evidence' and column_name = 'upload_timestamp'
			  and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE')`;
		expect(rows).toEqual([]);
		const tableLevel = await sql<{ grantee: string; privilege_type: string }[]>`
			select grantee, privilege_type from information_schema.table_privileges
			where table_schema = 'public' and table_name = 'evidence'
			  and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE')`;
		expect(tableLevel).toEqual([]);
	});
});

describe('the rest of the evidence row', () => {
	test('the path must name the row\'s own team and task', async () => {
		const wrongTeam = expectPostgrestError(
			await mentor.client.from('evidence').insert({
				team_id: teamA.teamId,
				task_id: taskA,
				storage_path: `${teamB.teamId}/${taskA}/x.jpg`,
				uploaded_by_student_id: a1.studentId
			})
		);
		expect(wrongTeam.code).toBe('23514');
	});

	test('a student captions their own upload and cannot touch a teammate\'s', async () => {
		const mia = await signIn(a2.email, a2.pin);
		const mine = await alice.from('evidence').update({ caption: 'second look' }).eq('task_id', taskA).select('caption');
		expect(mine.error).toBeNull();
		expect(mine.data).toEqual([{ caption: 'second look' }]);
		const theirs = await mia.from('evidence').update({ caption: 'not mine' }).eq('task_id', taskA).select('caption');
		expect(theirs.error).toBeNull();
		expect(theirs.data).toEqual([]);
		// but a teammate can SEE it
		const seen = await mia.from('evidence').select('caption').eq('task_id', taskA);
		expect(seen.data).toEqual([{ caption: 'second look' }]);
	});

	test('the evidence bucket exists and is private', async () => {
		const [bucket] = await sql<{ public: boolean }[]>`select public from storage.buckets where id = 'evidence'`;
		expect(bucket.public).toBe(false);
	});
});
