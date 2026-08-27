// tests/device-team.test.ts
//
// THE DEVICE REMEMBERS ITS TEAM, AND THAT IS ALL IT REMEMBERS.
//
// A shared iPad keeps one join code so a returning child lands on their team's
// roster instead of on a code field they were never given a code for. These
// cases hold two things: that the memory is only ever a join code, and that a
// join code buys nothing a stranger did not already have.
//
// The second half is the one worth having. A visible roster plus a PIN is weak
// auth and is ACCEPTED here: the protected asset is a middle school team's
// robot notes and the teammates already know each other's names. What must
// still hold is that the weak door opens onto one team and no further.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	anonClient,
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
import {
	DEVICE_TEAM_COOKIE,
	DEVICE_TEAM_MAX_AGE,
	deviceTeamCookieOptions,
	rememberedJoinCode
} from '../src/lib/auth/device-team';

describe('what the device is allowed to remember', () => {
	test('a valid join code comes back normalised', () => {
		expect(rememberedJoinCode('DGM2E7')).toBe('DGM2E7');
		expect(rememberedJoinCode('dgm2e7')).toBe('DGM2E7');
		expect(rememberedJoinCode('  dgm2e7  ')).toBe('DGM2E7');
	});

	/**
	 * A COOKIE IS CLIENT-SUPPLIED INPUT WHATEVER FLAG IT CARRIES, and this one
	 * is handed straight to a database function. httpOnly stops a page script
	 * writing it; it does not stop anything else on the machine.
	 */
	test('anything that is not a join code is no memory at all', () => {
		for (const bad of [
			'',
			undefined,
			null,
			'DGM2E',
			'DGM2E77',
			'DGM2E!',
			'O0I1AB', // the four symbols the alphabet deliberately excludes
			"' or true --",
			'../../etc/passwd',
			'a'.repeat(300)
		]) {
			expect(rememberedJoinCode(bad as string | undefined)).toBeNull();
		}
	});

	test('the cookie is server-set, long-lived, and unreadable from the page', () => {
		const options = deviceTeamCookieOptions(true);
		expect(options.httpOnly).toBe(true);
		expect(options.sameSite).toBe('lax');
		expect(options.path).toBe('/');
		expect(options.secure).toBe(true);
		expect(deviceTeamCookieOptions(false).secure).toBe(false);
		// 400 days is the cap browsers now clamp Max-Age to; a season is nine
		// months, so this is "until somebody clears it".
		expect(options.maxAge).toBe(400 * 24 * 60 * 60);
		expect(DEVICE_TEAM_MAX_AGE).toBe(options.maxAge);
	});

	/**
	 * SIGNING OUT MUST NOT FORGET THE TEAM, because signing out is exactly how a
	 * shared iPad is handed to the next child. supabase.auth.signOut() clears
	 * cookies under its own storage key (`sb-<ref>-auth-token`); this one is
	 * outside that namespace by name, which is what makes the two independent.
	 */
	test('the cookie name is outside the namespace sign-out clears', () => {
		expect(DEVICE_TEAM_COOKIE).toBe('fll-device-team');
		expect(DEVICE_TEAM_COOKIE.startsWith('sb-')).toBe(false);
		expect(DEVICE_TEAM_COOKIE.includes('auth-token')).toBe(false);
	});
});

describe('what a remembered join code buys', () => {
	let mentor: SeededMentor;
	let mine: SeededTeam;
	let theirs: SeededTeam;
	let ada: SeededStudent;
	let rival: SeededStudent;

	beforeAll(async () => {
		mentor = await seedMentor('device');
		mine = await createTeam(mentor.client, 'Device Mine');
		theirs = await createTeam(mentor.client, 'Device Theirs');
		ada = await createStudent(mentor.client, mine, 'Ada', 'L', { grade: 6 });
		rival = await createStudent(mentor.client, theirs, 'Nia', 'K', { grade: 6 });
	});

	afterAll(async () => {
		await cleanupRun();
		await closeDb();
	});

	test('it lists first names, last initials and slugs, and nothing else', async () => {
		const anon = anonClient();
		const { data } = await anon.rpc('team_login_roster', { p_join_code: mine.joinCode });
		const roster = data as unknown as {
			team_name: string;
			students: Record<string, unknown>[];
		} | null;
		expect(roster).not.toBeNull();
		expect(roster!.students.length).toBeGreaterThan(0);
		for (const student of roster!.students) {
			expect(Object.keys(student).sort()).toEqual(['first_name', 'last_initial', 'slug']);
		}
	});

	test('it names ONE team: the rival roster is not in the answer', async () => {
		const anon = anonClient();
		const { data } = await anon.rpc('team_login_roster', { p_join_code: mine.joinCode });
		const names = ((data as unknown as { students: { first_name: string }[] }).students ?? []).map(
			(s) => s.first_name
		);
		expect(names).toContain(ada.firstName);
		expect(names).not.toContain(rival.firstName);

		// The positive control: the rival student DOES exist, and the service
		// role sees them. An empty answer above is a filter, not an empty table.
		const [{ count }] = await sql<{ count: number }[]>`
			select count(*)::int as count from public.students where id = ${rival.studentId}`;
		expect(count).toBe(1);
	});

	/**
	 * The whole point. Holding the code the device remembers is not a session:
	 * it opens no table, on this team or any other. The PIN is the credential
	 * and it is bcrypt in auth.users from the moment it is set.
	 */
	test('it opens no table at all, not even the team it names', async () => {
		const anon = anonClient();
		for (const table of ['students', 'teams', 'tasks', 'notebook_entries'] as const) {
			const { data, error } = await anon.from(table).select('*');
			// anon holds no table grant anywhere, so this is a refusal, not a
			// filtered read. Either shape is acceptable; a row is not.
			expect(error ? true : (data ?? []).length === 0).toBe(true);
		}
	});
});
