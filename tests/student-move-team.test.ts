// tests/student-move-team.test.ts
//
// MOVING A CHILD TO ANOTHER TEAM REWRITES THEIR LOGIN. The address is
// `{join_code}-{slug}@fll.invalid`, so a move changes both halves and every
// session signed in under the old one has to die -- the same shape as
// rotating a join code (0009), and warned about the same way in the console.
//
// The other half of this file is the composite key doing its job. Every row
// that names a student carries (student_id, team_id) -> students (id,
// team_id), so a student whose team changes either drags those rows with them
// or the update is refused. FORWARD-LOOKING rows (role assignments, task
// assignments) are cleared and counted; HISTORY (a blocker they raised, a
// photo they took) refuses the move instead, because rewriting it would be a
// lie about what the season looked like.

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
	signInError,
	sql,
	type Client,
	type SeededMentor,
	type SeededStudent,
	type SeededTeam
} from './db/harness';
import { studentEmail } from '../src/lib/auth/student-identity';

let mentor: SeededMentor;
let from: SeededTeam;
let to: SeededTeam;
let full: SeededTeam;

const service = serviceClient();

type Moved = {
	to_team_id: string;
	to_team_name: string;
	slug: string;
	email: string;
	previous_slug: string;
	roles_cleared: number;
	tasks_unassigned: number;
};

beforeAll(async () => {
	mentor = await seedMentor('move');
	from = await createTeam(mentor.client, 'Move From');
	to = await createTeam(mentor.client, 'Move To');
	full = await createTeam(mentor.client, 'Move Full');
}, 60_000);

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('a move rewrites the login and drops the sessions', () => {
	let student: SeededStudent;
	let client: Client;

	test('the old address stops working, the new one works with the same PIN, and the old session is dead', async () => {
		student = await createStudent(mentor.client, from, 'Mia', 'M');
		client = await signIn(student.email, student.pin);

		// The session is live before the move: this is the positive control for
		// the "signed out" assertion below.
		const before = await client.rpc('auth_whoami');
		expect(before.error).toBeNull();
		expect(before.data).toMatchObject({ kind: 'student', team_id: from.teamId });

		// The session rows that exist RIGHT NOW. The assertion below is that
		// these are gone, not that the user has none: signing in again at the new
		// address (which this test does) makes a fresh one.
		const sessionsBefore = (
			await sql<{ id: string }[]>`select id from auth.sessions where user_id = ${student.authUserId}`
		).map((r) => r.id);
		expect(sessionsBefore.length).toBeGreaterThan(0);

		const { data, error } = await mentor.client.rpc('student_move_team', {
			p_student_id: student.studentId,
			p_to_team_id: to.teamId
		});
		expect(error).toBeNull();
		const moved = data as Moved;
		expect(moved.to_team_id).toBe(to.teamId);
		expect(moved.email).toBe(studentEmail(to.joinCode, moved.slug));

		// The old address is gone from auth entirely.
		expect(await signInError(student.email, student.pin)).toBeTruthy();

		// The new one works, with the PIN untouched -- a move is not a reset.
		const after = await signIn(moved.email, student.pin);
		const { data: who } = await after.rpc('auth_whoami');
		expect(who).toMatchObject({ kind: 'student', team_id: to.teamId, first_name: 'Mia' });

		// Every session signed in under the old address is gone from auth.sessions.
		const [{ n }] = await sql<{ n: number }[]>`
			select count(*)::int as n from auth.sessions where id = any(${sessionsBefore}::uuid[])`;
		expect(n).toBe(0);
	}, 60_000);

	test('the roster moved with them: the old team no longer lists them and the new one does', async () => {
		const oldRoster = await service.from('students').select('id').eq('team_id', from.teamId);
		expect((oldRoster.data ?? []).map((r) => r.id)).not.toContain(student.studentId);

		const newRoster = await service.from('students').select('id, slug').eq('team_id', to.teamId);
		expect((newRoster.data ?? []).map((r) => r.id)).toContain(student.studentId);
	});

	test('the slug is re-deduplicated inside the receiving team, so a name clash still logs in', async () => {
		// Someone with the same name is already on the receiving team.
		const sitting = await createStudent(mentor.client, to, 'Zed', 'Z');
		expect(sitting.slug).toBe('zedz');

		const travelling = await createStudent(mentor.client, from, 'Zed', 'Z');
		expect(travelling.slug).toBe('zedz');

		const { data, error } = await mentor.client.rpc('student_move_team', {
			p_student_id: travelling.studentId,
			p_to_team_id: to.teamId
		});
		expect(error).toBeNull();
		const moved = data as Moved;
		expect(moved.previous_slug).toBe('zedz');
		expect(moved.slug).toBe('zedz2');

		// Both accounts sign in, at different addresses, with their own PINs.
		await signIn(moved.email, travelling.pin);
		await signIn(sitting.email, sitting.pin);
	}, 60_000);
});

describe('what a move clears and what it refuses', () => {
	test('role assignments are cleared and task assignments unassigned, both counted for the mentor', async () => {
		const student = await createStudent(mentor.client, from, 'Rex', 'X');

		const { error: roleErr } = await mentor.client.rpc('role_assign', {
			p_team_id: from.teamId,
			p_student_id: student.studentId,
			p_role: 'lead_builder',
			p_tier: 'primary'
		});
		expect(roleErr).toBeNull();

		const taskId = crypto.randomUUID();
		const { error: taskErr } = await mentor.client.from('tasks').insert({
			id: taskId,
			team_id: from.teamId,
			title: 'Attach the wheels',
			assigned_student_id: student.studentId,
			created_by_mentor_id: mentor.mentorId
		});
		expect(taskErr).toBeNull();

		const { data, error } = await mentor.client.rpc('student_move_team', {
			p_student_id: student.studentId,
			p_to_team_id: to.teamId
		});
		expect(error).toBeNull();
		const moved = data as Moved;
		expect(moved.roles_cleared).toBe(1);
		expect(moved.tasks_unassigned).toBe(1);

		// The task stayed with the team that made it, and lost its assignee.
		const { data: task } = await service
			.from('tasks')
			.select('team_id, assigned_student_id')
			.eq('id', taskId)
			.single();
		expect(task).toEqual({ team_id: from.teamId, assigned_student_id: null });

		// The role assignment is gone, not carried over: they hold no role on
		// the receiving team.
		const [{ n }] = await sql<{ n: number }[]>`
			select count(*)::int as n from public.role_assignments where student_id = ${student.studentId}`;
		expect(n).toBe(0);
	}, 60_000);

	test('a student with history on the old team is refused, with counts and what to do instead', async () => {
		const student = await createStudent(mentor.client, from, 'Hal', 'H');
		const client = await signIn(student.email, student.pin);

		const { error: blockErr } = await client.from('blockers').insert({
			id: crypto.randomUUID(),
			team_id: from.teamId,
			student_id: student.studentId,
			task_id: null,
			note: 'The motor keeps stalling'
		});
		expect(blockErr).toBeNull();

		const attempt = await mentor.client.rpc('student_move_team', {
			p_student_id: student.studentId,
			p_to_team_id: to.teamId
		});
		const error = expectPostgrestError(attempt);
		expect(error.message).toContain('1 blocker(s) and 0 photo(s)');
		expect(error.message).toContain('Deactivate them on');

		// NEGATIVE CONTROL: the refusal changed nothing. The student is still on
		// the old team, still signed in, and the blocker is still theirs.
		const { data: row } = await service
			.from('students')
			.select('team_id, slug')
			.eq('id', student.studentId)
			.single();
		expect(row?.team_id).toBe(from.teamId);
		expect(row?.slug).toBe(student.slug);
		const stillIn = await client.rpc('auth_whoami');
		expect(stillIn.data).toMatchObject({ team_id: from.teamId });

		// POSITIVE CONTROL: a teammate with no history moves cleanly right now,
		// so the refusal above is about the history and not about the two teams.
		const clean = await createStudent(mentor.client, from, 'Nel', 'N');
		const { error: cleanErr } = await mentor.client.rpc('student_move_team', {
			p_student_id: clean.studentId,
			p_to_team_id: to.teamId
		});
		expect(cleanErr).toBeNull();
	}, 60_000);

	test('a move into a full team is refused by name, and the cap trigger is under it either way', async () => {
		for (let i = 1; i <= 6; i++) {
			await createStudent(mentor.client, full, `Full${i}`, 'F');
		}
		const student = await createStudent(mentor.client, from, 'Ono', 'O');

		const attempt = await mentor.client.rpc('student_move_team', {
			p_student_id: student.studentId,
			p_to_team_id: full.teamId
		});
		const error = expectPostgrestError(attempt);
		expect(error.message).toBe(`${full.name} already has 6 students, which is the most a team can hold.`);

		const { data: row } = await service.from('students').select('team_id').eq('id', student.studentId).single();
		expect(row?.team_id).toBe(from.teamId);

		// POSITIVE CONTROL: free a seat and the same call lands.
		const [{ id: parked }] = await sql<{ id: string }[]>`
			select id from public.students where team_id = ${full.teamId} order by slug limit 1`;
		await mentor.client.rpc('student_deactivate', { p_student_id: parked });
		const { error: nowOk } = await mentor.client.rpc('student_move_team', {
			p_student_id: student.studentId,
			p_to_team_id: full.teamId
		});
		expect(nowOk).toBeNull();
	}, 120_000);

	test('only a mentor moves anyone, and no client can do it by writing the column', async () => {
		const student = await createStudent(mentor.client, from, 'Pia', 'P');
		const client = await signIn(student.email, student.pin);

		const rpc = await client.rpc('student_move_team', {
			p_student_id: student.studentId,
			p_to_team_id: to.teamId
		});
		expect(expectPostgrestError(rpc).message).toBe('Only a mentor can move a student to another team.');

		// The column route is shut for a mentor too: team_id is in no client
		// UPDATE grant, so PostgREST refuses it outright.
		const direct = await mentor.client
			.from('students')
			.update({ team_id: to.teamId } as never)
			.eq('id', student.studentId)
			.select('id');
		expect(expectPostgrestError(direct).code).toBe('42501');

		// And the trigger is the backstop under the grant: even as `postgres`,
		// with no grant to stop it, an ordinary UPDATE of team_id is refused
		// because it is not a move.
		await expect(
			sql`update public.students set team_id = ${to.teamId} where id = ${student.studentId}`
		).rejects.toThrow(/team and login slug are changed by moving them/);

		const { data: row } = await service.from('students').select('team_id').eq('id', student.studentId).single();
		expect(row?.team_id).toBe(from.teamId);
	}, 60_000);
});
