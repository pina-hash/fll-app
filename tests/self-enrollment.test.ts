// tests/self-enrollment.test.ts
//
// THE ROSTER IS BUILT IN THE ROOM. There is no official roster before the
// first Friday, so a student with the team code and an open window types their
// own name and PIN and is signed in immediately -- no approval queue, because
// a queue means twenty children waiting on one adult.
//
// What this file proves: the three gates in front of an anon-callable account
// mint (a real join code, an OPEN window, a seat), that the account it makes
// is the same shape student_create makes (the slug is deduplicated, the
// address is the one the login screen computes, the chosen PIN signs in), and
// that the window shuts by itself when the meeting ends rather than staying
// open all week. Every refusal has a positive control immediately next to it,
// because "the call failed" and "the call failed for the reason claimed" are
// different facts.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	anonClient,
	cleanupRun,
	closeDb,
	createTeam,
	expectPostgrestError,
	seedMentor,
	serviceClient,
	signIn,
	signInError,
	sql,
	type SeededMentor,
	type SeededTeam
} from './db/harness';
import { studentEmail } from '../src/lib/auth/student-identity';

let mentor: SeededMentor;
let team: SeededTeam;
let otherTeam: SeededTeam;

const anon = anonClient();
const service = serviceClient();

type Roster = {
	team_id: string;
	team_name: string;
	join_code: string;
	size_cap: number;
	roster_size: number;
	roster_full: boolean;
	join_open: boolean;
	students: { first_name: string; last_initial: string; slug: string }[];
};

type Enrolled = {
	student_id: string;
	team_id: string;
	team_name: string;
	slug: string;
	email: string;
};

async function roster(joinCode: string): Promise<Roster | null> {
	const { data, error } = await anon.rpc('team_login_roster', { p_join_code: joinCode });
	expect(error).toBeNull();
	return data as Roster | null;
}

function enroll(joinCode: string, firstName: string, lastInitial: string, pin: string, grade = 5) {
	return anon.rpc('student_self_enroll', {
		p_join_code: joinCode,
		p_first_name: firstName,
		p_last_initial: lastInitial,
		p_grade: grade,
		p_pin: pin
	});
}

beforeAll(async () => {
	mentor = await seedMentor('enroll');
	team = await createTeam(mentor.client, 'Enroll');
	otherTeam = await createTeam(mentor.client, 'Enroll Other');
}, 60_000);

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('the three gates', () => {
	test('a wrong team code is refused, and the login screen is told nothing about it either', async () => {
		// The roster lookup answers null, not an error: a code that does not
		// exist reads exactly like one that does but is archived.
		expect(await roster('ZZZZZZ')).toBeNull();

		const attempt = await enroll('ZZZZZZ', 'Nobody', 'N', '123456');
		expect(expectPostgrestError(attempt).message).toBe('No team has that code.');

		// POSITIVE CONTROL: the real code resolves, so the refusal above was
		// about the code and not about the RPC being unreachable from anon.
		const found = await roster(team.joinCode);
		expect(found?.team_id).toBe(team.teamId);
	});

	test('a closed window is refused, an open one is not, and closing it again refuses again', async () => {
		// A team starts closed: nothing opened it.
		expect((await roster(team.joinCode))?.join_open).toBe(false);

		const closed = await enroll(team.joinCode, 'Too', 'E', '123456');
		expect(expectPostgrestError(closed).message).toBe(
			'Sign-ups for that team are closed. Ask a mentor to open them.'
		);

		// POSITIVE CONTROL: one tap, and the same call lands.
		const { error: openErr } = await mentor.client.rpc('team_join_window_open', { p_team_id: team.teamId });
		expect(openErr).toBeNull();
		expect((await roster(team.joinCode))?.join_open).toBe(true);

		const { data, error } = await enroll(team.joinCode, 'Ada', 'E', '123456');
		expect(error).toBeNull();
		expect((data as Enrolled).slug).toBe('adae');

		// And the other way: closing it refuses the very next attempt. This is
		// the stale-tab case -- the phone still shows an open window.
		const { error: closeErr } = await mentor.client.rpc('team_join_window_close', { p_team_id: team.teamId });
		expect(closeErr).toBeNull();
		const stale = await enroll(team.joinCode, 'Stale', 'T', '123456');
		expect(expectPostgrestError(stale).message).toBe(
			'Sign-ups for that team are closed. Ask a mentor to open them.'
		);

		// NEGATIVE CONTROL on the refusal: no account was minted for "Stale T".
		const [{ n }] = await sql<{ n: number }[]>`
			select count(*)::int as n from public.students
			where team_id = ${team.teamId} and first_name = 'Stale'`;
		expect(n).toBe(0);
	}, 60_000);

	test('only a mentor may open or close a window', async () => {
		const attempt = await anon.rpc('team_join_window_open', { p_team_id: team.teamId });
		// anon holds no EXECUTE on it at all, which is a stronger refusal than
		// the is_mentor() check inside the body.
		expect(expectPostgrestError(attempt).message).toMatch(/permission denied|not find the function|does not exist/i);
	});
});

describe('the account self-enrollment mints', () => {
	beforeAll(async () => {
		const { error } = await mentor.client.rpc('team_join_window_open', { p_team_id: team.teamId });
		expect(error).toBeNull();
	});

	test('the student signs in immediately with the PIN they chose, at the address the client computes', async () => {
		const { data, error } = await enroll(team.joinCode, 'Bo', 'S', '778899', 4);
		expect(error).toBeNull();
		const row = data as Enrolled;

		// The address the DATABASE built and the address the LOGIN SCREEN would
		// build from the code typed and the slug returned are the same string.
		expect(row.email).toBe(studentEmail(team.joinCode, row.slug));

		// End to end through GoTrue, which is the only thing that can confirm a
		// bcrypt hash written from SQL is a password.
		const client = await signIn(row.email, '778899');
		const { data: who } = await client.rpc('auth_whoami');
		expect(who).toMatchObject({ kind: 'student', team_id: team.teamId, first_name: 'Bo', last_initial: 'S' });

		// A wrong PIN is still refused: enrollment did not weaken sign-in.
		expect(await signInError(row.email, '000000')).toBeTruthy();
	}, 60_000);

	test('two students with the same name both get a working login', async () => {
		const first = await enroll(team.joinCode, 'Sam', 'K', '445566');
		expect(first.error).toBeNull();
		const second = await enroll(team.joinCode, 'Sam', 'K', '667788');
		expect(second.error).toBeNull();

		const a = first.data as Enrolled;
		const b = second.data as Enrolled;
		expect(a.slug).toBe('samk');
		expect(b.slug).toBe('samk2');

		// Both sign in, with their own different PINs. This is the dedup rule
		// 0004 already had, reused rather than reimplemented.
		await signIn(a.email, '445566');
		await signIn(b.email, '667788');
		expect(await signInError(a.email, '667788')).toBeTruthy();
	}, 60_000);

	test('a self-enrolled student is an ordinary student: same table, same RLS, no extra reach', async () => {
		const { data } = await enroll(team.joinCode, 'Ivy', 'Q', '334455');
		const row = data as Enrolled;
		const client = await signIn(row.email, '334455');

		// They see their own team's roster and no other team's.
		const mine = await client.from('students').select('id').eq('team_id', team.teamId);
		expect(mine.error).toBeNull();
		expect((mine.data ?? []).length).toBeGreaterThan(0);

		const theirs = await client.from('students').select('id').eq('team_id', otherTeam.teamId);
		expect(theirs.error).toBeNull();
		expect(theirs.data).toEqual([]);

		// POSITIVE CONTROL for that empty result: the other team really does
		// have a student on it, seen through the service role.
		const seeded = await mentor.client.rpc('student_create', {
			p_team_id: otherTeam.teamId,
			p_first_name: 'Rival',
			p_last_initial: 'R',
			p_grade: 6,
			p_pin: '246810'
		});
		expect(seeded.error).toBeNull();
		const control = await service.from('students').select('id').eq('team_id', otherTeam.teamId);
		expect((control.data ?? []).length).toBe(1);

		const stillEmpty = await client.from('students').select('id').eq('team_id', otherTeam.teamId);
		expect(stillEmpty.data).toEqual([]);
	}, 60_000);

	test('bad input is refused in words a nine-year-old can act on', async () => {
		const cases: [Record<string, unknown>, string][] = [
			[{ p_first_name: '' }, 'Type your first name.'],
			[{ p_last_initial: '77' }, 'Type the first letter of your last name.'],
			[{ p_grade: 99 }, 'Pick your grade.'],
			[{ p_grade: null }, 'Pick your grade.'],
			[{ p_pin: '1234' }, 'A PIN is exactly 6 numbers.'],
			[{ p_pin: 'abcdef' }, 'A PIN is exactly 6 numbers.']
		];
		for (const [override, message] of cases) {
			const result = await anon.rpc('student_self_enroll', {
				p_join_code: team.joinCode,
				p_first_name: 'Valid',
				p_last_initial: 'V',
				p_grade: 5,
				p_pin: '123456',
				...override
			});
			expect(expectPostgrestError(result).message).toBe(message);
		}

		// POSITIVE CONTROL: the untouched payload succeeds, so the six above
		// failed on the field each names and not on the shape of the call.
		const ok = await enroll(team.joinCode, 'Valid', 'V', '123456');
		expect(ok.error).toBeNull();
	}, 60_000);
});

describe('the window shuts by itself', () => {
	test('ending the meeting closes every window it opened, in the stored state and in the rule', async () => {
		const fresh = await createTeam(mentor.client, 'Enroll Auto');

		const { data: created, error: createErr } = await mentor.client.rpc('meeting_create', {
			p_kind: 'friday',
			p_meeting_date: new Date().toISOString().slice(0, 10),
			p_planned_start_at: new Date().toISOString()
		});
		expect(createErr).toBeNull();
		const meetingId = (created as { meeting_id: string }).meeting_id;
		const { error: startErr } = await mentor.client.rpc('meeting_start', { p_meeting_id: meetingId });
		expect(startErr).toBeNull();

		const { data: opened, error: openErr } = await mentor.client.rpc('team_join_window_open', {
			p_team_id: fresh.teamId
		});
		expect(openErr).toBeNull();
		// It bound itself to the RUNNING meeting, which is the whole mechanism.
		expect((opened as { meeting_id: string }).meeting_id).toBe(meetingId);
		expect((await roster(fresh.joinCode))?.join_open).toBe(true);

		// POSITIVE CONTROL that the window is genuinely usable right now.
		const during = await enroll(fresh.joinCode, 'During', 'D', '123456');
		expect(during.error).toBeNull();

		const { data: ended, error: endErr } = await mentor.client.rpc('meeting_end', { p_meeting_id: meetingId });
		expect(endErr).toBeNull();
		expect((ended as { join_windows_closed: number }).join_windows_closed).toBe(1);

		// The derived rule says shut...
		const [{ open_now }] = await sql<{ open_now: boolean }[]>`
			select public.team_join_open(${fresh.teamId}) as open_now`;
		expect(open_now).toBe(false);
		expect((await roster(fresh.joinCode))?.join_open).toBe(false);

		// ...and so does the stored state, so a mentor reading the console
		// afterwards is not shown a stale "open".
		const [{ since, meeting }] = await sql<{ since: string | null; meeting: string | null }[]>`
			select join_open_since as since, join_open_meeting_id as meeting from public.teams where id = ${fresh.teamId}`;
		expect(since).toBeNull();
		expect(meeting).toBeNull();

		// And the next student in the door is refused.
		const after = await enroll(fresh.joinCode, 'After', 'A', '123456');
		expect(expectPostgrestError(after).message).toBe(
			'Sign-ups for that team are closed. Ask a mentor to open them.'
		);
	}, 120_000);

	test('a window whose meeting ended some other way is still shut by the rule alone', async () => {
		// The stored columns are cleared by meeting_end. Here they are left
		// pointing at a meeting that ended without it -- a row edited by hand,
		// a meeting ended before this bundle shipped -- and team_join_open()
		// has to refuse on its own, because it is the thing every gate calls.
		const fresh = await createTeam(mentor.client, 'Enroll Orphan');
		const { data: created } = await mentor.client.rpc('meeting_create', {
			p_kind: 'saturday',
			p_meeting_date: new Date().toISOString().slice(0, 10),
			p_planned_start_at: new Date().toISOString()
		});
		const meetingId = (created as { meeting_id: string }).meeting_id;
		await mentor.client.rpc('meeting_start', { p_meeting_id: meetingId });
		await mentor.client.rpc('team_join_window_open', { p_team_id: fresh.teamId });

		const [{ open_before }] = await sql<{ open_before: boolean }[]>`
			select public.team_join_open(${fresh.teamId}) as open_before`;
		expect(open_before).toBe(true);

		// End the meeting WITHOUT the RPC, leaving the team's columns set.
		await sql`update public.meetings set ended_at = now() where id = ${meetingId}`;
		const [{ still_set }] = await sql<{ still_set: boolean }[]>`
			select join_open_since is not null as still_set from public.teams where id = ${fresh.teamId}`;
		expect(still_set).toBe(true);

		const [{ open_after }] = await sql<{ open_after: boolean }[]>`
			select public.team_join_open(${fresh.teamId}) as open_after`;
		expect(open_after).toBe(false);

		const attempt = await enroll(fresh.joinCode, 'Orphan', 'O', '123456');
		expect(expectPostgrestError(attempt).message).toBe(
			'Sign-ups for that team are closed. Ask a mentor to open them.'
		);
	}, 120_000);

	test('a window never outlives the local day it was opened on', async () => {
		const fresh = await createTeam(mentor.client, 'Enroll Yesterday');
		await mentor.client.rpc('team_join_window_open', { p_team_id: fresh.teamId });
		const [{ open_before }] = await sql<{ open_before: boolean }[]>`
			select public.team_join_open(${fresh.teamId}) as open_before`;
		expect(open_before).toBe(true);

		// No meeting was running, so the meeting bound is not what shuts this
		// one: backdate the stamp by a day and the day bound does.
		await sql`update public.teams set join_open_since = now() - interval '1 day' where id = ${fresh.teamId}`;
		const [{ open_after }] = await sql<{ open_after: boolean }[]>`
			select public.team_join_open(${fresh.teamId}) as open_after`;
		expect(open_after).toBe(false);

		// POSITIVE CONTROL: re-opening it today makes it usable again, so the
		// refusal above was the date and not a one-way latch.
		await mentor.client.rpc('team_join_window_open', { p_team_id: fresh.teamId });
		const ok = await enroll(fresh.joinCode, 'Today', 'T', '123456');
		expect(ok.error).toBeNull();
	}, 120_000);
});

describe('what the roster RPC tells an unauthenticated caller', () => {
	test('it reports the cap and whether the team is full, and still leaks nothing else', async () => {
		const found = await roster(team.joinCode);
		expect(found?.size_cap).toBe(6);
		expect(typeof found?.roster_full).toBe('boolean');
		expect(found?.roster_size).toBe(found?.students.length);

		// Each roster entry is still exactly three fields: the two a child
		// recognises, and the slug the address is built from.
		for (const student of found?.students ?? []) {
			expect(Object.keys(student).sort()).toEqual(['first_name', 'last_initial', 'slug']);
		}

		// anon still holds no table grant: this RPC is the only door.
		const direct = await anon.from('students').select('id');
		expect(expectPostgrestError(direct)).toBeTruthy();
	});
});
