// tests/console-role-resolution.test.ts
//
// ACTIVE-ROLE RESOLUTION IS ONE FUNCTION, SO IT GETS ONE TEST. 0009's
// team_resolve_roles answers "who is in role R for team T today": the primary
// if the primary checked in, else the second if the second checked in, else
// nobody. All three branches are asserted here against a real meeting with
// real attendance rows, because that is the only way the middle branch can be
// distinguished from the first.
//
// The second half is role_assign / role_unassign, which exist because 0005's
// exclusion constraints refuse an overlapping holder: a naive INSERT from the
// console fails with 23P01 every time a mentor reassigns a role. The 23P01 is
// reproduced directly, so the RPCs are shown to be solving a real problem and
// not a hypothetical one.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	captureError,
	cleanupRun,
	closeDb,
	createStudent,
	createTeam,
	seedMentor,
	sql,
	type SeededMentor,
	type SeededStudent,
	type SeededTeam
} from './db/harness';

let mentor: SeededMentor;
let team: SeededTeam;
let other: SeededTeam;
let alice: SeededStudent;
let ben: SeededStudent;
let cleo: SeededStudent;
let meetingId: string;

/** The season's local date, exactly as 0009's _app_today() computes it. */
async function appToday(): Promise<string> {
	const [{ today }] = await sql<{ today: string }[]>`
		select to_char((now() at time zone 'America/Los_Angeles')::date, 'YYYY-MM-DD') as today`;
	return today;
}

type RoleRow = {
	role: string;
	primary_name: string | null;
	primary_present: boolean;
	second_name: string | null;
	second_present: boolean;
	active_name: string | null;
	active_tier: string | null;
	unfilled: boolean;
	has_second: boolean;
};

async function resolve(teamId: string, withMeeting = true): Promise<RoleRow[]> {
	const { data, error } = await mentor.client.rpc('team_resolve_roles', {
		p_team_id: teamId,
		p_meeting_id: withMeeting ? meetingId : undefined
	});
	if (error) throw new Error(`team_resolve_roles failed: ${error.message}`);
	return data as unknown as RoleRow[];
}

const roleRow = (rows: RoleRow[], role: string) => rows.find((r) => r.role === role)!;

async function assign(teamId: string, studentId: string, role: string, tier: 'primary' | 'second') {
	const { data, error } = await mentor.client.rpc('role_assign', {
		p_team_id: teamId,
		p_student_id: studentId,
		p_role: role as never,
		p_tier: tier
	});
	if (error) throw new Error(`role_assign failed: ${error.message}`);
	return data as unknown as { assignment_id: string; unchanged: boolean; replaced: unknown[] };
}

beforeAll(async () => {
	mentor = await seedMentor('roles');
	team = await createTeam(mentor.client, 'roles-a');
	other = await createTeam(mentor.client, 'roles-b');
	alice = await createStudent(mentor.client, team, 'Alice', 'A');
	ben = await createStudent(mentor.client, team, 'Ben', 'B');
	cleo = await createStudent(mentor.client, team, 'Cleo', 'C');

	const today = await appToday();
	const { data: created, error } = await mentor.client.rpc('meeting_create', {
		p_kind: 'friday',
		p_meeting_date: today,
		p_planned_start_at: new Date().toISOString()
	});
	if (error) throw new Error(`meeting_create failed: ${error.message}`);
	meetingId = (created as unknown as { meeting_id: string }).meeting_id;
}, 60_000);

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('team_resolve_roles: the three branches', () => {
	test('with nobody assigned, all five roles read unfilled and none has a second', async () => {
		const rows = await resolve(team.teamId);
		expect(rows).toHaveLength(5);
		expect(rows.map((r) => r.role)).toEqual([
			'lead_builder',
			'lead_programmer',
			'run_captain',
			'innovation_lead',
			'notebook_values_lead'
		]);
		expect(rows.every((r) => r.unfilled)).toBe(true);
		expect(rows.every((r) => !r.has_second)).toBe(true);
	});

	test('assigned but nobody checked in is still unfilled: an assignment is not a presence', async () => {
		await assign(team.teamId, alice.studentId, 'lead_builder', 'primary');
		await assign(team.teamId, ben.studentId, 'lead_builder', 'second');

		const row = roleRow(await resolve(team.teamId), 'lead_builder');
		expect({
			primary: row.primary_name,
			second: row.second_name,
			hasSecond: row.has_second,
			active: row.active_name,
			unfilled: row.unfilled
		}).toEqual({
			primary: 'Alice A.',
			second: 'Ben B.',
			hasSecond: true,
			active: null,
			unfilled: true
		});
	});

	test('the primary checked in holds the seat', async () => {
		const { error } = await mentor.client
			.from('attendance')
			.insert({ meeting_id: meetingId, student_id: alice.studentId });
		expect(error).toBeNull();

		const row = roleRow(await resolve(team.teamId), 'lead_builder');
		expect({ active: row.active_name, tier: row.active_tier, unfilled: row.unfilled }).toEqual({
			active: 'Alice A.',
			tier: 'primary',
			unfilled: false
		});
	});

	test('the primary out and the second in: the SECOND holds the seat', async () => {
		// Ben is already the second; check him in and take Alice back out.
		const { error } = await mentor.client
			.from('attendance')
			.insert({ meeting_id: meetingId, student_id: ben.studentId });
		expect(error).toBeNull();
		await mentor.client.from('attendance').delete().eq('meeting_id', meetingId).eq('student_id', alice.studentId);

		const row = roleRow(await resolve(team.teamId), 'lead_builder');
		expect({
			primaryPresent: row.primary_present,
			secondPresent: row.second_present,
			active: row.active_name,
			tier: row.active_tier,
			unfilled: row.unfilled
		}).toEqual({
			primaryPresent: false,
			secondPresent: true,
			active: 'Ben B.',
			tier: 'second',
			unfilled: false
		});
	});

	test('no meeting means no attendance, so every role reads unfilled', async () => {
		// Ben is checked in to the meeting above; asked WITHOUT a meeting the
		// answer is still "nobody", which is correct rather than missing.
		const row = roleRow(await resolve(team.teamId, false), 'lead_builder');
		expect({ active: row.active_name, unfilled: row.unfilled, second: row.second_name }).toEqual({
			active: null,
			unfilled: true,
			second: 'Ben B.'
		});
	});

	test('a deactivated student stops holding the seat, even while checked in', async () => {
		const before = roleRow(await resolve(team.teamId), 'lead_builder');
		expect(before.active_name).toBe('Ben B.');

		const { error } = await mentor.client.rpc('student_deactivate', { p_student_id: ben.studentId });
		expect(error).toBeNull();

		const after = roleRow(await resolve(team.teamId), 'lead_builder');
		expect({ second: after.second_name, active: after.active_name, unfilled: after.unfilled }).toEqual({
			second: null,
			active: null,
			unfilled: true
		});

		await mentor.client.rpc('student_reactivate', { p_student_id: ben.studentId });
	});
});

describe('role_assign gets past the exclusion constraints', () => {
	test('THE CONSTRAINT BITES: a raw insert over an existing holder is refused with 23P01', async () => {
		const today = await appToday();
		// Positive control first: the row role_assign wrote really is there.
		const [{ n }] = await sql<{ n: number }[]>`
			select count(*)::int as n from public.role_assignments
			where team_id = ${team.teamId} and role = 'lead_builder' and tier = 'primary'
				and (effective_to is null or effective_to > ${today}::date)`;
		expect(n).toBe(1);

		const failure = await captureError(async () => {
			await sql`
				insert into public.role_assignments (team_id, student_id, role, tier, effective_from)
				values (${team.teamId}, ${cleo.studentId}, 'lead_builder', 'primary', ${today}::date)`;
		});
		expect(failure.code).toBe('23P01');
	});

	test('role_assign replaces the holder instead, and an assignment made today is deleted rather than stamped', async () => {
		const result = await assign(team.teamId, cleo.studentId, 'lead_builder', 'primary');
		expect(result.unchanged).toBe(false);
		expect(result.replaced).toHaveLength(1);

		const rows = await sql<{ student_id: string; effective_to: string | null }[]>`
			select student_id, effective_to from public.role_assignments
			where team_id = ${team.teamId} and role = 'lead_builder' and tier = 'primary'`;
		// Alice's row started today, so it was removed; only Cleo's remains.
		expect(rows).toHaveLength(1);
		expect(rows[0].student_id).toBe(cleo.studentId);

		const row = roleRow(await resolve(team.teamId), 'lead_builder');
		expect(row.primary_name).toBe('Cleo C.');
	});

	test('an assignment from an earlier day keeps its history: it is closed, not deleted', async () => {
		const today = await appToday();
		await sql`delete from public.role_assignments where team_id = ${team.teamId} and role = 'run_captain'`;
		await sql`
			insert into public.role_assignments (team_id, student_id, role, tier, effective_from)
			values (${team.teamId}, ${alice.studentId}, 'run_captain', 'primary', ${today}::date - 7)`;

		await assign(team.teamId, ben.studentId, 'run_captain', 'primary');

		const rows = await sql<{ student_id: string; effective_to: string | null }[]>`
			select student_id, to_char(effective_to, 'YYYY-MM-DD') as effective_to
			from public.role_assignments
			where team_id = ${team.teamId} and role = 'run_captain' and tier = 'primary'
			order by effective_from`;
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({ student_id: alice.studentId, effective_to: today });
		expect(rows[1]).toEqual({ student_id: ben.studentId, effective_to: null });
	});

	test('one student cannot hold both tiers of a role: the other tier is ended for them', async () => {
		await sql`delete from public.role_assignments where team_id = ${team.teamId} and role = 'innovation_lead'`;
		await assign(team.teamId, alice.studentId, 'innovation_lead', 'primary');
		await assign(team.teamId, alice.studentId, 'innovation_lead', 'second');

		const rows = await sql<{ tier: string; student_id: string }[]>`
			select tier, student_id from public.role_assignments
			where team_id = ${team.teamId} and role = 'innovation_lead' and effective_to is null`;
		expect(rows).toEqual([{ tier: 'second', student_id: alice.studentId }]);
	});

	test('assigning the same student to the same seat twice is a no-op, not a second row', async () => {
		const again = await assign(team.teamId, alice.studentId, 'innovation_lead', 'second');
		expect(again.unchanged).toBe(true);
		const [{ n }] = await sql<{ n: number }[]>`
			select count(*)::int as n from public.role_assignments
			where team_id = ${team.teamId} and role = 'innovation_lead' and effective_to is null`;
		expect(n).toBe(1);
	});

	test('role_unassign empties the seat', async () => {
		const { data, error } = await mentor.client.rpc('role_unassign', {
			p_team_id: team.teamId,
			p_role: 'innovation_lead',
			p_tier: 'second'
		});
		expect(error).toBeNull();
		expect((data as unknown as { ended: number }).ended).toBe(1);

		const row = roleRow(await resolve(team.teamId), 'innovation_lead');
		expect({ second: row.second_name, hasSecond: row.has_second }).toEqual({ second: null, hasSecond: false });
	});

	test('a role assignment cannot name a student from another team', async () => {
		const { error } = await mentor.client.rpc('role_assign', {
			p_team_id: other.teamId,
			p_student_id: alice.studentId,
			p_role: 'lead_builder',
			p_tier: 'primary'
		});
		expect(error?.message).toContain('not on that team');
	});
});
