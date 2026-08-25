// tests/board-device.test.ts
//
// THE TEAM BOARD IS A DEVICE, NOT A PERSON.
//
// A spare iPad on the table serves the students who did not bring a phone, so
// it needs to read its own team and close its own team's tasks. It must not be
// able to do anything a named student can do: hold a role, be checked in,
// raise a blocker as somebody, upload evidence, or reach another team. This
// file asserts both halves, through a real GoTrue session.
//
// It also holds `src/lib/auth/student-identity.ts`'s `boardEmail` to 0010's
// `_board_email`, the same way tests/login-roster.test.ts holds the student
// address to `_student_email`. If those two ever disagree the iPad silently
// stops signing in.

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
import { boardEmail } from '../src/lib/auth/student-identity';

let mentor: SeededMentor;
let mine: SeededTeam;
let theirs: SeededTeam;
let student: SeededStudent;
let outsider: SeededStudent;
let board: Client;
let meetingId: string;
let myTaskId: string;
let theirTaskId: string;

const BOARD_PIN = '778899';
const service = serviceClient();

beforeAll(async () => {
	mentor = await seedMentor('board-dev');
	mine = await createTeam(mentor.client, 'bd-mine');
	theirs = await createTeam(mentor.client, 'bd-theirs');
	student = await createStudent(mentor.client, mine, 'Rhea', 'V');
	outsider = await createStudent(mentor.client, theirs, 'Sami', 'W');

	const [{ today }] = await sql<{ today: string }[]>`
		select to_char((now() at time zone 'America/Los_Angeles')::date, 'YYYY-MM-DD') as today`;
	const { data: created } = await mentor.client.rpc('meeting_create', {
		p_kind: 'friday',
		p_meeting_date: today,
		p_planned_start_at: new Date().toISOString()
	});
	meetingId = (created as unknown as { meeting_id: string }).meeting_id;
	await mentor.client.rpc('meeting_start', { p_meeting_id: meetingId });

	for (const [team, holder] of [
		[mine, student],
		[theirs, outsider]
	] as const) {
		const { data } = await mentor.client
			.from('tasks')
			.insert({ team_id: team.teamId, title: `Job for ${team.name}`, created_by_mentor_id: mentor.mentorId })
			.select('id')
			.single();
		if (team === mine) myTaskId = data!.id;
		else theirTaskId = data!.id;
		await mentor.client.rpc('role_assign', {
			p_team_id: team.teamId,
			p_student_id: holder.studentId,
			p_role: 'run_captain',
			p_tier: 'primary'
		});
	}
}, 90_000);

afterAll(async () => {
	// The kiosk auth users are not run-tagged the way mentors are, so they go
	// here; the device rows cascade with them.
	await sql`
		delete from auth.users u using public.team_board_devices d
		where d.auth_user_id = u.id and d.team_id in (${mine.teamId}, ${theirs.teamId})`;
	await cleanupRun();
	await closeDb();
});

describe('team_board_enable', () => {
	test('only a mentor can turn a board on', async () => {
		const asStudent = await signIn(
			(await sql<{ email: string }[]>`select email from auth.users where id = ${student.authUserId}`)[0].email,
			student.pin
		);
		const { error } = await asStudent.rpc('team_board_enable', { p_team_id: mine.teamId, p_pin: BOARD_PIN });
		expect(error?.message).toBe('Only a mentor can set up a team board.');
	});

	test('a four-digit PIN is refused; six digits is accepted', async () => {
		const short = await mentor.client.rpc('team_board_enable', { p_team_id: mine.teamId, p_pin: '1234' });
		expect(short.error?.message).toBe('A board PIN is exactly 6 digits.');

		const { data, error } = await mentor.client.rpc('team_board_enable', {
			p_team_id: mine.teamId,
			p_pin: BOARD_PIN
		});
		expect(error).toBeNull();
		const result = data as unknown as { board_email: string; created: boolean };
		expect(result.created).toBe(true);
		expect(result.board_email).toBe(boardEmail(mine.joinCode));
	});

	test('THE MIRROR: the client and the database agree on the board address', async () => {
		const [{ address }] = await sql<{ address: string }[]>`
			select public._board_email(${mine.joinCode}) as address`;
		expect(address).toBe(boardEmail(mine.joinCode));
		// And it can never collide with a student address: a slug is [a-z0-9].
		expect(address).toContain('board.device@fll.invalid');
	});

	test('the board device is NOT on the roster and holds no role', async () => {
		const [{ n }] = await sql<{ n: number }[]>`
			select count(*)::int as n from public.students where team_id = ${mine.teamId} and first_name = 'Rhea'`;
		expect(n).toBe(1); // the real student is there

		const roster = await service.from('students').select('id').eq('team_id', mine.teamId);
		expect(roster.data).toHaveLength(1); // and the kiosk is not

		const [{ holders }] = await sql<{ holders: number }[]>`
			select count(*)::int as holders from public.role_assignments where team_id = ${mine.teamId}`;
		expect(holders).toBe(1);
	});
});

describe('what a board device can do', () => {
	beforeAll(async () => {
		board = await signIn(boardEmail(mine.joinCode), BOARD_PIN);
	});

	test('auth_whoami calls it a board, with a team and nothing else', async () => {
		const { data } = await board.rpc('auth_whoami');
		const who = data as unknown as Record<string, unknown>;
		expect(who.kind).toBe('board');
		expect(who.team_id).toBe(mine.teamId);
		expect(who.student_id).toBeUndefined();
		expect(who.mentor_id).toBeUndefined();
	});

	test('it reads its own team and none other', async () => {
		const tasks = await board.from('tasks').select('id, team_id');
		expect(tasks.data!.length).toBeGreaterThan(0);
		expect(tasks.data!.every((t) => t.team_id === mine.teamId)).toBe(true);
		expect(tasks.data!.some((t) => t.id === theirTaskId)).toBe(false);

		const roster = await board.from('students').select('team_id');
		expect(roster.data!.every((s) => s.team_id === mine.teamId)).toBe(true);

		const teams = await board.from('teams').select('id');
		expect(teams.data!.map((t) => t.id)).toEqual([mine.teamId]);

		// POSITIVE CONTROL: the other team's task exists.
		const asService = await service.from('tasks').select('id').eq('id', theirTaskId).single();
		expect(asService.data?.id).toBe(theirTaskId);
	});

	test('it cannot read the accent palette, because a board picks no colour', async () => {
		// 0023 gave team_accent_options the caller check it had never had. The
		// gate is "a mentor or a student", and a board is neither: it is a
		// device on a table, it holds no role and chooses nothing.
		const { error } = await board.rpc('team_accent_options');
		expect(error?.message).toBe('Only a mentor or a team member can see which colours are taken.');

		// POSITIVE CONTROL, both halves of the gate, so the refusal above is
		// the check firing and not the function being broken for everyone.
		const asMentor = await mentor.client.rpc('team_accent_options');
		expect(asMentor.error).toBeNull();
		expect((asMentor.data as unknown as unknown[]).length).toBe(11);

		const asStudent = await signIn(student.email, student.pin);
		const studentRead = await asStudent.rpc('team_accent_options');
		expect(studentRead.error).toBeNull();
		expect((studentRead.data as unknown as unknown[]).length).toBe(11);
	});

	test('it resolves its own team roles through the SAME function the console uses', async () => {
		const ok = await board.rpc('team_resolve_roles', { p_team_id: mine.teamId, p_meeting_id: meetingId });
		expect(ok.error).toBeNull();
		expect((ok.data as unknown as unknown[]).length).toBe(5);

		const denied = await board.rpc('team_resolve_roles', { p_team_id: theirs.teamId });
		expect(denied.data).toEqual([]);
	});

	test('it reads the running meeting', async () => {
		const { data, error } = await board.rpc('meeting_current');
		expect(error).toBeNull();
		const now = data as unknown as { meeting: { id: string; phase: { name: string } } };
		expect(now.meeting.id).toBe(meetingId);
		expect(now.meeting.phase.name).toBe('Huddle');
	});

	test('it closes its OWN team task', async () => {
		const done = await board.from('tasks').update({ status: 'done' }).eq('id', myTaskId).select('id, status');
		expect(done.error).toBeNull();
		expect(done.data).toEqual([{ id: myTaskId, status: 'done' }]);
	});

	test('it cannot close another team task, and that task is untouched', async () => {
		const attempt = await board.from('tasks').update({ status: 'done' }).eq('id', theirTaskId).select('id');
		expect(attempt.error).toBeNull();
		expect(attempt.data).toEqual([]);

		const asService = await service.from('tasks').select('status').eq('id', theirTaskId).single();
		expect(asService.data?.status).toBe('open');
	});
});

describe('what a board device must NOT be able to do', () => {
	test('it cannot check anyone in', async () => {
		const attempt = await board
			.from('attendance')
			.insert({ meeting_id: meetingId, student_id: student.studentId });
		expect(expectPostgrestError(attempt).code).toBe('42501');
	});

	test('it cannot raise a blocker as a student', async () => {
		const attempt = await board
			.from('blockers')
			.insert({ team_id: mine.teamId, student_id: student.studentId, note: 'The iPad says so' });
		expect(expectPostgrestError(attempt).code).toBe('42501');
	});

	test('it cannot upload evidence', async () => {
		const attempt = await board.from('evidence').insert({
			task_id: myTaskId,
			team_id: mine.teamId,
			storage_path: `${mine.teamId}/${myTaskId}/kiosk.jpg`,
			uploaded_by_student_id: student.studentId
		});
		expect(expectPostgrestError(attempt).code).toBe('42501');
	});

	test('it cannot assign a role or create anything', async () => {
		const role = await board.rpc('role_assign', {
			p_team_id: mine.teamId,
			p_student_id: student.studentId,
			p_role: 'lead_builder',
			p_tier: 'primary'
		});
		expect(role.error?.message).toBe('Only a mentor can assign a role.');

		const meeting = await board.rpc('meeting_start', { p_meeting_id: meetingId });
		expect(meeting.error?.message).toBe('Only a mentor can start a meeting.');

		const board2 = await board.rpc('team_board_enable', { p_team_id: theirs.teamId, p_pin: '123456' });
		expect(board2.error?.message).toBe('Only a mentor can set up a team board.');
	});

	test('it cannot open the mentor live board', async () => {
		const { error } = await board.rpc('board_live_summary');
		expect(error?.message).toBe('Only a mentor can open the live board.');
	});

	test('nobody can mint a board account by signing up', async () => {
		// The trigger (0010) requires team_board_enable's transaction-local flag.
		const attempt = await sql`
			select 1 from auth.users limit 0`.then(async () => {
			try {
				await sql`
					insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
						email_confirmed_at, confirmation_token, recovery_token, email_change_token_new,
						email_change, email_change_token_current, email_change_confirm_status,
						phone_change, phone_change_token, reauthentication_token,
						raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous,
						created_at, updated_at)
					values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
						'zzzzzz-board.device@fll.invalid', 'x', now(), '', '', '', '', '', 0, '', '', '',
						'{}'::jsonb, '{}'::jsonb, false, false, false, now(), now())`;
				return null;
			} catch (e) {
				return (e as { message: string }).message;
			}
		});
		expect(attempt).toContain('Board devices are enabled by a mentor');
	});
});

describe('team_board_disable and re-PINning', () => {
	test('changing the PIN keeps the same device and drops the old session', async () => {
		const again = await mentor.client.rpc('team_board_enable', { p_team_id: mine.teamId, p_pin: '556677' });
		expect((again.data as unknown as { created: boolean }).created).toBe(false);

		const oldPin = await signInError(boardEmail(mine.joinCode), BOARD_PIN);
		expect(oldPin).not.toBeNull();

		const newPin = await signIn(boardEmail(mine.joinCode), '556677');
		const { data } = await newPin.rpc('auth_whoami');
		expect((data as unknown as { kind: string }).kind).toBe('board');
	});

	test('disabling removes the account, and the code and PIN stop opening a board', async () => {
		const { error } = await mentor.client.rpc('team_board_disable', { p_team_id: mine.teamId });
		expect(error).toBeNull();

		const [{ n }] = await sql<{ n: number }[]>`
			select count(*)::int as n from public.team_board_devices where team_id = ${mine.teamId}`;
		expect(n).toBe(0);

		const refused = await signInError(boardEmail(mine.joinCode), '556677');
		expect(refused).not.toBeNull();

		// And disabling a team that has no board says so rather than pretending.
		const again = await mentor.client.rpc('team_board_disable', { p_team_id: mine.teamId });
		expect(again.error?.message).toBe('That team has no board device.');
	});
});
