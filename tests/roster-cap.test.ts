// tests/roster-cap.test.ts
//
// SIX SEATS PER TEAM, PROVED AT THE DATABASE AND NOT AT THE UI.
// The load-bearing assertion is the first one: seven RAW inserts as
// `postgres`, bypassing PostgREST, RLS and every RPC in the schema. Six land
// and the seventh is refused, so the cap is a property of the table and not
// of any code path that could forget it. Everything after that shows the same
// trigger holding the other three ways a seat gets taken -- a mentor typing
// (student_create), a child spending a seat code (student_claim_seat), and an
// old row coming back (student_reactivate) -- plus the two things that must
// NOT count against it: a deactivated row, and a rename on a team that is
// already full.
//
// A SEAT IS NOW A STUDENT OR A PROMISE OF ONE. From 0019 an unclaimed claim
// code holds a seat too, so six printed cards fill an empty team before any
// child types a name. That is what stops a mentor printing six cards for a
// team that already has four children and turning two of them away at the
// tablet holding a card that says they have a seat.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	anonClient,
	captureError,
	cleanupRun,
	closeDb,
	createStudent,
	createTeam,
	expectPostgrestError,
	RUN,
	seedMentor,
	serviceClient,
	sql,
	type SeededMentor,
	type SeededTeam
} from './db/harness';

let mentor: SeededMentor;
let rawTeam: SeededTeam;
let rpcTeam: SeededTeam;
let enrollTeam: SeededTeam;
let reactivateTeam: SeededTeam;

const service = serviceClient();

beforeAll(async () => {
	mentor = await seedMentor('cap');
	rawTeam = await createTeam(mentor.client, 'Cap Raw');
	rpcTeam = await createTeam(mentor.client, 'Cap Rpc');
	enrollTeam = await createTeam(mentor.client, 'Cap Enroll');
	reactivateTeam = await createTeam(mentor.client, 'Cap React');
}, 60_000);

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

/**
 * One student written straight into the tables as `postgres`, with no RPC,
 * no PostgREST and no RLS anywhere in the path. The transaction-local
 * `fll.creating_student` flag is what 0002/0010's auth.users trigger wants;
 * it is raised here for the same reason student_create raises it. A refusal
 * rolls the auth user back with the students row, so a failed attempt leaves
 * nothing behind.
 */
async function rawInsertStudent(teamId: string, slug: string): Promise<string> {
	return sql.begin(async (tx) => {
		await tx`select set_config('fll.creating_student', 'on', true)`;
		const [{ id: authUserId }] = await tx<{ id: string }[]>`
			insert into auth.users (
				instance_id, id, aud, role, email, encrypted_password,
				email_confirmed_at, confirmation_token, recovery_token,
				email_change_token_new, email_change, email_change_token_current, email_change_confirm_status,
				phone_change, phone_change_token, reauthentication_token,
				raw_app_meta_data, raw_user_meta_data,
				is_super_admin, is_sso_user, is_anonymous, created_at, updated_at
			) values (
				'00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
				${`raw-${RUN}-${slug}@fll.invalid`}, extensions.crypt('246810', extensions.gen_salt('bf', 10)),
				now(), '', '', '', '', '', 0, '', '', '',
				${sql.json({ provider: 'email', providers: ['email'] })}, ${sql.json({})},
				false, false, false, now(), now()
			)
			returning id`;
		const [{ id }] = await tx<{ id: string }[]>`
			insert into public.students (team_id, first_name, last_initial, grade, slug, auth_user_id)
			values (${teamId}, ${'Raw' + slug}, 'R', 6, ${slug}, ${authUserId})
			returning id`;
		return id;
	}) as Promise<string>;
}

async function activeCount(teamId: string): Promise<number> {
	const [{ n }] = await sql<{ n: number }[]>`
		select count(*)::int as n from public.students
		where team_id = ${teamId} and deactivated_at is null`;
	return n;
}

describe('the cap is enforced by the table, not by any code path above it', () => {
	test('six raw inserts land and the seventh is refused, as `postgres`, with no RPC or RLS in the path', async () => {
		// The cap the database says it holds. Nothing in this file types 6.
		const [{ cap }] = await sql<{ cap: number }[]>`select public.team_size_cap() as cap`;
		expect(cap).toBe(6);

		// POSITIVE CONTROL: the same statement, six times, succeeds.
		for (let i = 1; i <= cap; i++) {
			const id = await rawInsertStudent(rawTeam.teamId, `rawslot${i}`);
			expect(id).toMatch(/^[0-9a-f-]{36}$/);
		}
		expect(await activeCount(rawTeam.teamId)).toBe(cap);

		// THE SEVENTH.
		const error = await captureError(() => rawInsertStudent(rawTeam.teamId, 'rawslot7'));
		expect(error.message).toContain('already has 6 students');

		// The refusal left nothing behind: no seventh student, and no orphan
		// auth user from the rolled-back half of the transaction.
		expect(await activeCount(rawTeam.teamId)).toBe(cap);
		const [{ n }] = await sql<{ n: number }[]>`
			select count(*)::int as n from auth.users where email = ${`raw-${RUN}-rawslot7@fll.invalid`}`;
		expect(n).toBe(0);
	}, 120_000);

	test('a deactivated student holds no seat, and reactivating into a full team is refused', async () => {
		for (let i = 1; i <= 6; i++) {
			await createStudent(mentor.client, reactivateTeam, `React${i}`, 'R');
		}
		expect(await activeCount(reactivateTeam.teamId)).toBe(6);

		const [{ id: parked }] = await sql<{ id: string }[]>`
			select id from public.students where team_id = ${reactivateTeam.teamId} order by slug limit 1`;

		const off = await mentor.client.rpc('student_deactivate', { p_student_id: parked });
		expect(off.error).toBeNull();
		expect(await activeCount(reactivateTeam.teamId)).toBe(5);

		// A seat opened, so a seventh NAME now fits: the cap counts active rows.
		const seventh = await createStudent(mentor.client, reactivateTeam, 'React7', 'R');
		expect(seventh.studentId).toBeTruthy();
		expect(await activeCount(reactivateTeam.teamId)).toBe(6);

		// And now the parked student cannot come back, because the team is full.
		const back = await mentor.client.rpc('student_reactivate', { p_student_id: parked });
		const error = expectPostgrestError(back);
		expect(error.message).toContain('already has 6 students');
		expect(await activeCount(reactivateTeam.teamId)).toBe(6);

		// NEGATIVE CONTROL for that refusal: the row really is still there and
		// still deactivated, seen through the service role, so "reactivate did
		// nothing" is not being read off an empty result.
		const { data: still } = await service
			.from('students')
			.select('id, deactivated_at')
			.eq('id', parked)
			.single();
		expect(still?.deactivated_at).not.toBeNull();

		// POSITIVE CONTROL: free the seat and the same call succeeds.
		const { error: offAgain } = await mentor.client.rpc('student_deactivate', {
			p_student_id: seventh.studentId
		});
		expect(offAgain).toBeNull();
		const { error: backAgain } = await mentor.client.rpc('student_reactivate', { p_student_id: parked });
		expect(backAgain).toBeNull();
		expect(await activeCount(reactivateTeam.teamId)).toBe(6);
	}, 120_000);

	test('student_create refuses the seventh, and the message is a sentence a mentor can read', async () => {
		for (let i = 1; i <= 6; i++) {
			await createStudent(mentor.client, rpcTeam, `Rpc${i}`, 'R');
		}
		const seventh = await mentor.client.rpc('student_create', {
			p_team_id: rpcTeam.teamId,
			p_first_name: 'Rpc7',
			p_last_initial: 'R',
			p_grade: 6,
			p_pin: '246810'
		});
		const error = expectPostgrestError(seventh);
		expect(error.message).toBe(
			'That team already has 6 students, which is the most a team can hold. Take somebody off the team first, or use another team.'
		);
		// Plain English: "students" is the word for children, not the name of a
		// table, and no schema, SQLSTATE or constraint name reaches the mentor.
		expect(error.message).not.toMatch(/public\.|SQLSTATE|constraint|trigger|team_id|_cap/);
		expect(await activeCount(rpcTeam.teamId)).toBe(6);
	}, 120_000);

	test('claiming a seat refuses the seventh, and the cards themselves hold the seats', async () => {
		const anon = anonClient();

		// SIX CARDS FILL AN EMPTY TEAM BEFORE ANY CHILD TYPES A NAME. That is the
		// change 0019 made to this rule: a live claim code holds a seat, so the
		// cap is reached by the cards alone.
		const { data: issued, error: issueErr } = await mentor.client.rpc('team_claim_codes_issue', {
			p_team_id: enrollTeam.teamId,
			p_count: 6
		});
		expect(issueErr).toBeNull();
		const codes = (issued as unknown as { codes: { code: string }[] }).codes;
		expect(codes).toHaveLength(6);

		const seventhCard = await mentor.client.rpc('team_claim_codes_issue', {
			p_team_id: enrollTeam.teamId,
			p_count: 1
		});
		expect(expectPostgrestError(seventhCard).message).toMatch(/every seat/i);

		// POSITIVE CONTROL: all six cards are spent, one after another, and each
		// one signs a child in.
		for (const [i, { code }] of codes.entries()) {
			const { data, error } = await anon.rpc('student_claim_seat', {
				p_claim_code: code,
				p_first_name: `Seat${i + 1}`,
				p_last_initial: 'S',
				p_grade: 5,
				p_pin: '112233'
			});
			expect(error).toBeNull();
			expect((data as { student_id: string } | null)?.student_id).toBeTruthy();
		}
		expect(await activeCount(enrollTeam.teamId)).toBe(6);

		// The seats changed hands rather than multiplying: six students, no live
		// cards, and the team is still exactly at the cap.
		const [{ live }] = await sql<{ live: number }[]>`
			select count(*)::int as live from public.student_claim_codes
			where team_id = ${enrollTeam.teamId} and claimed_at is null and voided_at is null`;
		expect(live).toBe(0);

		// And a spent card cannot be spent again to squeeze a seventh in.
		const seventh = await anon.rpc('student_claim_seat', {
			p_claim_code: codes[0].code,
			p_first_name: 'Seat7',
			p_last_initial: 'S',
			p_grade: 5,
			p_pin: '112233'
		});
		expect(expectPostgrestError(seventh).message).toBe(
			'That seat code has already been used. Ask a mentor for a new card.'
		);
		expect(await activeCount(enrollTeam.teamId)).toBe(6);

		// No half-made account was left in auth.
		const [{ n }] = await sql<{ n: number }[]>`
			select count(*)::int as n from auth.users
			where email like ${enrollTeam.joinCode.toLowerCase() + '-seat7%'}`;
		expect(n).toBe(0);
	}, 180_000);

	test('the cap does not get in the way of editing a student on a team that is already full', async () => {
		// rpcTeam has six. A rename is an UPDATE that leaves an active row on
		// the same team, which must not be counted against the cap.
		const [{ id }] = await sql<{ id: string }[]>`
			select id from public.students where team_id = ${rpcTeam.teamId} order by slug limit 1`;
		const { data, error } = await mentor.client
			.from('students')
			.update({ first_name: 'Renamed', grade: 7 })
			.eq('id', id)
			.select('id, first_name, grade');
		expect(error).toBeNull();
		expect(data).toEqual([{ id, first_name: 'Renamed', grade: 7 }]);
	}, 60_000);
});
