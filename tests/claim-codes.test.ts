// tests/claim-codes.test.ts
//
// A SEAT IS HANDED OUT, SPENT ONCE, AND NEVER SPENT TWICE. This is the file
// that replaces tests/self-enrollment.test.ts: the open join window is gone
// from the schema, and the only door a child without an account can walk
// through is student_claim_seat, holding a code a mentor printed.
//
// The three claims that matter, and the negative control for each:
//   1. SINGLE USE. The same code refused the second time -- and the positive
//      control that it worked the first time, with a real GoTrue sign-in.
//   2. VOIDED IS DEAD. A voided code refused -- and the control that the same
//      code was live one statement earlier.
//   3. THE CAP HOLDS, AGAINST CODES AS WELL AS STUDENTS. A live code holds a
//      seat, so six cards on an empty team fill it and the seventh is refused
//      before anybody types a name.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	anonClient,
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

let mentor: SeededMentor;
let team: SeededTeam;

beforeAll(async () => {
	mentor = await seedMentor('claims');
	team = await createTeam(mentor.client, 'Claims');
}, 60_000);

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

type IssueResult = {
	team_id: string;
	team_name: string;
	issued: number;
	seats_left: number;
	codes: { claim_id: string; code: string }[];
};

async function issue(client: Client, teamId: string, count: number): Promise<IssueResult> {
	const { data, error } = await client.rpc('team_claim_codes_issue', { p_team_id: teamId, p_count: count });
	if (error) throw new Error(`team_claim_codes_issue failed: ${error.message}`);
	return data as unknown as IssueResult;
}

describe('minting seats', () => {
	test('a mentor mints N codes at once, and each one is six symbols of the unambiguous alphabet', async () => {
		const fresh = await createTeam(mentor.client, 'Mint');
		const result = await issue(mentor.client, fresh.teamId, 3);

		expect(result.issued).toBe(3);
		expect(result.codes).toHaveLength(3);
		// A code is read aloud across a room and typed by a nine-year-old: no
		// I, no O, no 0, no 1.
		for (const { code } of result.codes) {
			expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
		}
		expect(new Set(result.codes.map((c) => c.code)).size).toBe(3);
		// Three of the six seats are spoken for.
		expect(result.seats_left).toBe(3);
	});

	test('a live code holds a seat, so the cap is reached without a single student', async () => {
		const fresh = await createTeam(mentor.client, 'CapCodes');
		const full = await issue(mentor.client, fresh.teamId, 6);
		expect(full.seats_left).toBe(0);

		const { error } = await mentor.client.rpc('team_claim_codes_issue', { p_team_id: fresh.teamId, p_count: 1 });
		expect(error?.message).toMatch(/every seat|room for/i);

		// POSITIVE CONTROL: the seats really are held by codes and not by
		// students, which is the whole point of counting them.
		const [{ students, codes }] = await sql<{ students: number; codes: number }[]>`
			select
				(select count(*)::int from public.students s where s.team_id = ${fresh.teamId} and s.deactivated_at is null) as students,
				(select count(*)::int from public.student_claim_codes c
					where c.team_id = ${fresh.teamId} and c.claimed_at is null and c.voided_at is null) as codes`;
		expect({ students, codes }).toEqual({ students: 0, codes: 6 });
	});

	test('minting is refused past the cap when students already hold the seats', async () => {
		const fresh = await createTeam(mentor.client, 'CapMixed');
		await createStudent(mentor.client, fresh, 'Cap', 'A');
		await createStudent(mentor.client, fresh, 'Cap', 'B');

		// Four seats left, so four is allowed and five is not.
		const { error: tooMany } = await mentor.client.rpc('team_claim_codes_issue', {
			p_team_id: fresh.teamId,
			p_count: 5
		});
		expect(tooMany?.message).toMatch(/room for 4/i);

		const ok = await issue(mentor.client, fresh.teamId, 4);
		expect(ok.seats_left).toBe(0);
	});

	test('only a mentor may mint, and the refusal is a sentence', async () => {
		const student = await createStudent(mentor.client, team, 'Not', 'M');
		const asStudent = await signIn(student.email, student.pin);
		const { error } = await asStudent.rpc('team_claim_codes_issue', { p_team_id: team.teamId, p_count: 1 });
		expect(error?.message).toBe('Only a mentor can hand out seats.');

		// NEGATIVE CONTROL: the same call from the mentor in the same state
		// succeeds, so the refusal is about who asked and not about the team.
		const ok = await issue(mentor.client, team.teamId, 1);
		expect(ok.issued).toBe(1);
	});
});

describe('spending a seat', () => {
	test('a code signs a brand new child in, and works exactly once', async () => {
		const fresh = await createTeam(mentor.client, 'Spend');
		const [{ code }] = (await issue(mentor.client, fresh.teamId, 1)).codes;

		const anon = anonClient();
		const { data, error } = await anon.rpc('student_claim_seat', {
			p_claim_code: code,
			p_first_name: 'Ada',
			p_last_initial: 'L',
			p_grade: 5,
			p_pin: '246813'
		});
		expect(error).toBeNull();
		const claimed = data as unknown as { email: string; student_id: string; slug: string; team_id: string };
		expect(claimed.slug).toBe('adal');
		expect(claimed.email).toBe(`${fresh.joinCode.toLowerCase()}-adal@fll.invalid`);

		// POSITIVE CONTROL, end to end through GoTrue: the PIN they chose is a
		// real password on a real account, which is the only thing that makes
		// this feature true.
		const session = await signIn(claimed.email, '246813');
		const { data: who } = await session.rpc('auth_whoami');
		expect((who as unknown as { kind: string }).kind).toBe('student');

		// SINGLE USE.
		const again = await anonClient().rpc('student_claim_seat', {
			p_claim_code: code,
			p_first_name: 'Bo',
			p_last_initial: 'M',
			p_grade: 6,
			p_pin: '135791'
		});
		expect(again.error?.message).toBe('That seat code has already been used. Ask a mentor for a new card.');

		// And the second attempt minted nothing: still one student on the team.
		const [{ n }] = await sql<{ n: number }[]>`
			select count(*)::int as n from public.students where team_id = ${fresh.teamId} and deactivated_at is null`;
		expect(n).toBe(1);
	});

	test('a claimed code stops holding a seat, because the student it minted holds it instead', async () => {
		const fresh = await createTeam(mentor.client, 'Handover');
		const [{ code }] = (await issue(mentor.client, fresh.teamId, 6)).codes;
		await anonClient().rpc('student_claim_seat', {
			p_claim_code: code,
			p_first_name: 'Kai',
			p_last_initial: 'P',
			p_grade: 6,
			p_pin: '112233'
		});

		const [{ students, live }] = await sql<{ students: number; live: number }[]>`
			select
				(select count(*)::int from public.students s where s.team_id = ${fresh.teamId} and s.deactivated_at is null) as students,
				(select count(*)::int from public.student_claim_codes c
					where c.team_id = ${fresh.teamId} and c.claimed_at is null and c.voided_at is null) as live`;
		// Six seats before, six seats after: one changed hands.
		expect(students + live).toBe(6);
		expect(students).toBe(1);
	});

	test('a voided code is refused, and the control is that it was live a statement earlier', async () => {
		const fresh = await createTeam(mentor.client, 'Void');
		const [{ claim_id, code }] = (await issue(mentor.client, fresh.teamId, 1)).codes;

		const [{ live_before }] = await sql<{ live_before: boolean }[]>`
			select (claimed_at is null and voided_at is null) as live_before
			from public.student_claim_codes where id = ${claim_id}`;
		expect(live_before).toBe(true);

		const { error: voidErr } = await mentor.client.rpc('team_claim_code_void', { p_claim_id: claim_id });
		expect(voidErr).toBeNull();

		const { error } = await anonClient().rpc('student_claim_seat', {
			p_claim_code: code,
			p_first_name: 'No',
			p_last_initial: 'V',
			p_grade: 6,
			p_pin: '445566'
		});
		expect(error?.message).toBe('That seat code was cancelled. Ask a mentor for a new card.');

		// Voiding gave the seat back.
		const state = await mentor.client.rpc('team_claim_codes', { p_team_id: fresh.teamId });
		const rows = state.data as unknown as { state: string }[];
		expect(rows.map((r) => r.state)).toEqual(['voided']);
	});

	test('an unknown code, and a team code typed into the seat box, each get their own sentence', async () => {
		const unknown = await anonClient().rpc('student_claim_seat', {
			p_claim_code: 'ZZZZZZ',
			p_first_name: 'Ed',
			p_last_initial: 'P',
			p_grade: 6,
			p_pin: '778899'
		});
		expect(unknown.error?.message).toBe('That seat code does not work. Check the card a mentor gave you.');

		// The confusion that will actually happen in the room.
		const teamCode = await anonClient().rpc('student_claim_seat', {
			p_claim_code: team.joinCode,
			p_first_name: 'Di',
			p_last_initial: 'O',
			p_grade: 6,
			p_pin: '778899'
		});
		expect(teamCode.error?.message).toMatch(/that is your team code, not your seat code/i);
	});

	test('the last seat can be spent, and there is no seventh: students and codes share one count', async () => {
		const fresh = await createTeam(mentor.client, 'LastSeat');
		// Five children a mentor typed in, and one card still out. That is six
		// seats, and the cap trigger is what stops a sixth student being typed in
		// beside the live card.
		for (const initial of ['A', 'B', 'C', 'D', 'E']) {
			await createStudent(mentor.client, fresh, 'Seat', initial);
		}
		const [{ code }] = (await issue(mentor.client, fresh.teamId, 1)).codes;

		await expect(createStudent(mentor.client, fresh, 'Sixth', 'X')).rejects.toThrow(/most a team can hold/i);

		// The card still works: it is holding the sixth seat for the child who
		// has it, which is exactly what it is for.
		const { error } = await anonClient().rpc('student_claim_seat', {
			p_claim_code: code,
			p_first_name: 'Sixth',
			p_last_initial: 'X',
			p_grade: 6,
			p_pin: '998877'
		});
		expect(error).toBeNull();

		const [{ students }] = await sql<{ students: number }[]>`
			select count(*)::int as students from public.students
			where team_id = ${fresh.teamId} and deactivated_at is null`;
		expect(students).toBe(6);

		// And now nothing else fits, from either door.
		const { error: noMore } = await mentor.client.rpc('team_claim_codes_issue', {
			p_team_id: fresh.teamId,
			p_count: 1
		});
		expect(noMore?.message).toMatch(/every seat/i);
	});

	test('a bad name, grade or PIN is refused before any account is minted', async () => {
		const fresh = await createTeam(mentor.client, 'BadInput');
		const codes = (await issue(mentor.client, fresh.teamId, 4)).codes;

		const cases: [Record<string, unknown>, RegExp][] = [
			[{ p_first_name: '  ', p_last_initial: 'L', p_grade: 5, p_pin: '111111' }, /type your first name/i],
			[{ p_first_name: 'Ada', p_last_initial: '', p_grade: 5, p_pin: '111111' }, /first letter of your last name/i],
			[{ p_first_name: 'Ada', p_last_initial: 'L', p_grade: null, p_pin: '111111' }, /pick your grade/i],
			[{ p_first_name: 'Ada', p_last_initial: 'L', p_grade: 5, p_pin: '12345' }, /exactly 6 numbers/i]
		];

		for (const [i, [args, matcher]] of cases.entries()) {
			const { error } = await anonClient().rpc('student_claim_seat', {
				p_claim_code: codes[i].code,
				...args
			} as never);
			expect(error?.message).toMatch(matcher);
		}

		// NOTHING WAS MINTED, and every code is still live: a refused attempt
		// must not burn the card a child is holding.
		const [{ students }] = await sql<{ students: number }[]>`
			select count(*)::int as students from public.students where team_id = ${fresh.teamId}`;
		expect(students).toBe(0);
		const state = await mentor.client.rpc('team_claim_codes', { p_team_id: fresh.teamId });
		expect((state.data as unknown as { state: string }[]).every((r) => r.state === 'open')).toBe(true);
	});
});

describe('managing the seats', () => {
	test('reissue voids the old card and hands back a new one on the same team', async () => {
		const fresh = await createTeam(mentor.client, 'Reissue');
		const [{ claim_id, code }] = (await issue(mentor.client, fresh.teamId, 1)).codes;

		const { data, error } = await mentor.client.rpc('team_claim_code_reissue', { p_claim_id: claim_id });
		expect(error).toBeNull();
		const out = data as unknown as { code: string; replaced_code: string; team_id: string };
		expect(out.replaced_code).toBe(code);
		expect(out.code).not.toBe(code);
		expect(out.team_id).toBe(fresh.teamId);

		// The seat count did not move: one card out before, one card out after.
		const [{ live }] = await sql<{ live: number }[]>`
			select count(*)::int as live from public.student_claim_codes
			where team_id = ${fresh.teamId} and claimed_at is null and voided_at is null`;
		expect(live).toBe(1);

		// The old card is dead.
		const { error: oldErr } = await anonClient().rpc('student_claim_seat', {
			p_claim_code: code,
			p_first_name: 'Old',
			p_last_initial: 'C',
			p_grade: 6,
			p_pin: '222222'
		});
		expect(oldErr?.message).toMatch(/cancelled/i);

		// The new one works.
		const { error: newErr } = await anonClient().rpc('student_claim_seat', {
			p_claim_code: out.code,
			p_first_name: 'New',
			p_last_initial: 'C',
			p_grade: 6,
			p_pin: '333333'
		});
		expect(newErr).toBeNull();
	});

	test('a spent code cannot be voided or reissued: the student is the record', async () => {
		const fresh = await createTeam(mentor.client, 'Spent');
		const [{ claim_id, code }] = (await issue(mentor.client, fresh.teamId, 1)).codes;
		await anonClient().rpc('student_claim_seat', {
			p_claim_code: code,
			p_first_name: 'Zoe',
			p_last_initial: 'H',
			p_grade: 6,
			p_pin: '444444'
		});

		const { error: voidErr } = await mentor.client.rpc('team_claim_code_void', { p_claim_id: claim_id });
		expect(voidErr?.message).toMatch(/already been used by Zoe H/i);

		const { error: reErr } = await mentor.client.rpc('team_claim_code_reissue', { p_claim_id: claim_id });
		expect(reErr?.message).toMatch(/already been used/i);
	});

	test('team_claim_codes answers a mentor and nobody else', async () => {
		const fresh = await createTeam(mentor.client, 'Listing');
		await issue(mentor.client, fresh.teamId, 2);

		const mine = await mentor.client.rpc('team_claim_codes', { p_team_id: fresh.teamId });
		expect((mine.data as unknown as unknown[]).length).toBe(2);

		// A student on another team gets an empty answer rather than an error:
		// a surface a caller may not see answers like one that does not exist.
		const student = await createStudent(mentor.client, team, 'Peek', 'S');
		const asStudent = await signIn(student.email, student.pin);
		const theirs = await asStudent.rpc('team_claim_codes', { p_team_id: fresh.teamId });
		expect(theirs.error).toBeNull();
		expect(theirs.data as unknown as unknown[]).toEqual([]);

		// POSITIVE CONTROL: the rows are really there, through the service role.
		const svc = serviceClient();
		const { data: rows } = await svc.from('student_claim_codes').select('id').eq('team_id', fresh.teamId);
		expect(rows).toHaveLength(2);
	});

	test('anon holds no read on the table itself, only the door', async () => {
		const { error } = await anonClient().from('student_claim_codes').select('id').limit(1);
		expect(error).not.toBeNull();
	});
});
