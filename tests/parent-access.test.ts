// tests/parent-access.test.ts
//
// A PARENT LINK REACHES EXACTLY ONE CHILD. Parents are community members with
// no school account, so they hold no identity at all: `/p/<token>` is a
// capability URL and parent_view(token) is the only thing behind it.
//
// The claim this file has to nail down is a NEGATIVE one, and a negative
// claim read off an empty result is worthless -- an empty list of another
// child's photos looks the same whether the child has no photos or the token
// is doing its job. So every "the parent cannot see X" here is paired with
// the service role showing that X exists, and with the OTHER child's own
// token showing X to the person entitled to it. The second half is the other
// direction of the boundary: there is no write path on this surface for
// anyone, token or not.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	anonClient,
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
let team: SeededTeam;
let rivalTeam: SeededTeam;
let mine: SeededStudent;
let sibling: SeededStudent;
let rival: SeededStudent;
let mineClient: Client;
let siblingClient: Client;
let meetingId: string;

let myToken: string;
let siblingToken: string;
let rivalToken: string;

const myTaskId = crypto.randomUUID();
const siblingTaskId = crypto.randomUUID();
const myEvidenceId = crypto.randomUUID();
const siblingEvidenceId = crypto.randomUUID();

const anon = anonClient();
const service = serviceClient();

type ParentView = {
	team: { name: string; accent: string; fll_team_number: number | null };
	student: { first_name: string; last_initial: string; grade: number | null };
	roles: { role: string; tier: string }[];
	upcoming_meetings: { id: string; meeting_date: string; planned_start_at: string }[];
	attendance: { meeting_id: string; meeting_date: string; checked_in_at: string }[];
	tasks_done: { id: string; title: string; closed_at: string }[];
	photos: { id: string; caption: string | null; task_title: string }[];
	roster: { first_name: string; last_initial: string; is_mine: boolean }[];
};

async function issue(studentId: string): Promise<string> {
	const { data, error } = await mentor.client.rpc('parent_access_issue', { p_student_id: studentId });
	if (error) throw new Error(`parent_access_issue failed: ${error.message}`);
	return (data as { token: string }).token;
}

async function view(token: string): Promise<ParentView | null> {
	const { data, error } = await anon.rpc('parent_view', { p_token: token });
	expect(error).toBeNull();
	return data as ParentView | null;
}

beforeAll(async () => {
	mentor = await seedMentor('parent');
	team = await createTeam(mentor.client, 'Parent');
	rivalTeam = await createTeam(mentor.client, 'Parent Rival');
	mine = await createStudent(mentor.client, team, 'Ada', 'A', { grade: 6 });
	sibling = await createStudent(mentor.client, team, 'Ben', 'B', { grade: 7 });
	rival = await createStudent(mentor.client, rivalTeam, 'Cy', 'C', { grade: 5 });
	mineClient = await signIn(mine.email, mine.pin);
	siblingClient = await signIn(sibling.email, sibling.pin);

	// A role each, so "current role and whether primary or second" has
	// something to be right or wrong about.
	await mentor.client.rpc('role_assign', {
		p_team_id: team.teamId,
		p_student_id: mine.studentId,
		p_role: 'run_captain',
		p_tier: 'primary'
	});
	await mentor.client.rpc('role_assign', {
		p_team_id: team.teamId,
		p_student_id: sibling.studentId,
		p_role: 'run_captain',
		p_tier: 'second'
	});

	// A live meeting, with both children checked in.
	const { data: created } = await mentor.client.rpc('meeting_create', {
		p_kind: 'friday',
		p_meeting_date: new Date().toISOString().slice(0, 10),
		p_planned_start_at: new Date().toISOString()
	});
	meetingId = (created as { meeting_id: string }).meeting_id;
	await mentor.client.rpc('meeting_start', { p_meeting_id: meetingId });
	for (const s of [mine, sibling]) {
		const { error } = await mentor.client
			.from('attendance')
			.insert({ id: crypto.randomUUID(), meeting_id: meetingId, student_id: s.studentId });
		if (error) throw new Error(`attendance seed failed: ${error.message}`);
	}

	// A finished task each, and a photo each.
	for (const [taskId, student, title, client, evidenceId, caption] of [
		[myTaskId, mine, 'Ada finished the gripper', mineClient, myEvidenceId, 'my gripper'],
		[siblingTaskId, sibling, 'Ben finished the notebook', siblingClient, siblingEvidenceId, 'ben notebook']
	] as const) {
		const { error } = await mentor.client.from('tasks').insert({
			id: taskId,
			team_id: team.teamId,
			title,
			assigned_student_id: student.studentId,
			created_by_mentor_id: mentor.mentorId,
			status: 'done'
		});
		if (error) throw new Error(`task seed failed: ${error.message}`);
		const ev = await client.from('evidence').insert({
			id: evidenceId,
			task_id: taskId,
			team_id: team.teamId,
			storage_path: `${team.teamId}/${taskId}/${evidenceId}.jpg`,
			caption,
			uploaded_by_student_id: student.studentId
		});
		if (ev.error) throw new Error(`evidence seed failed: ${ev.error.message}`);
	}

	myToken = await issue(mine.studentId);
	siblingToken = await issue(sibling.studentId);
	rivalToken = await issue(rival.studentId);
}, 120_000);

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('a token reaches exactly one child', () => {
	test('the token is long and random, and a token nobody issued reads like a revoked one', async () => {
		expect(myToken).toMatch(/^[0-9a-f]{64}$/);
		expect(myToken).not.toBe(siblingToken);

		// Unknown, malformed and empty all answer null -- not an error, so a
		// probe cannot tell "no such link" from "revoked" from "wrong shape".
		expect(await view('f'.repeat(64))).toBeNull();
		expect(await view('not-a-token')).toBeNull();
		expect(await view('')).toBeNull();
	});

	test('it shows this child, their role, their attendance, their tasks and their photos', async () => {
		const page = await view(myToken);
		expect(page).not.toBeNull();
		expect(page!.team.name).toBe(team.name);
		expect(page!.student).toEqual({ first_name: 'Ada', last_initial: 'A', grade: 6 });
		expect(page!.roles).toEqual([{ role: 'run_captain', tier: 'primary' }]);

		expect(page!.attendance.map((a) => a.meeting_id)).toEqual([meetingId]);
		expect(page!.tasks_done.map((t) => t.id)).toEqual([myTaskId]);
		expect(page!.photos.map((p) => p.id)).toEqual([myEvidenceId]);
		expect(page!.photos[0].caption).toBe('my gripper');
		expect(page!.upcoming_meetings.map((m) => m.id)).toContain(meetingId);
	});

	test('it shows NOTHING of the other child beyond a first name and a last initial', async () => {
		const page = (await view(myToken))!;

		// POSITIVE CONTROL: the sibling genuinely has attendance, a finished
		// task and a photo. Every "not visible" below is a refusal, not an
		// empty table.
		const control = await service
			.from('evidence')
			.select('id, uploaded_by_student_id')
			.eq('id', siblingEvidenceId)
			.single();
		expect(control.data?.uploaded_by_student_id).toBe(sibling.studentId);
		const controlTask = await service.from('tasks').select('id, status').eq('id', siblingTaskId).single();
		expect(controlTask.data?.status).toBe('done');
		const controlAttendance = await service
			.from('attendance')
			.select('id')
			.eq('meeting_id', meetingId)
			.eq('student_id', sibling.studentId);
		expect((controlAttendance.data ?? []).length).toBe(1);

		// And the sibling's OWN link shows all three, so the data is reachable
		// by the person entitled to it and unreachable by this one.
		const siblingPage = (await view(siblingToken))!;
		expect(siblingPage.tasks_done.map((t) => t.id)).toEqual([siblingTaskId]);
		expect(siblingPage.photos.map((p) => p.id)).toEqual([siblingEvidenceId]);
		expect(siblingPage.attendance.map((a) => a.meeting_id)).toEqual([meetingId]);

		// Now the refusals.
		expect(page.tasks_done.map((t) => t.id)).not.toContain(siblingTaskId);
		expect(page.photos.map((p) => p.id)).not.toContain(siblingEvidenceId);
		expect(JSON.stringify(page)).not.toContain(sibling.studentId);
		expect(JSON.stringify(page)).not.toContain(sibling.slug);

		// The roster is the one place another child appears at all, and it is
		// two fields: exactly what a printed roster card already shows a room.
		const ben = page.roster.find((r) => r.first_name === 'Ben');
		expect(ben).toEqual({ first_name: 'Ben', last_initial: 'B', is_mine: false });
		for (const entry of page.roster) {
			expect(Object.keys(entry).sort()).toEqual(['first_name', 'is_mine', 'last_initial']);
		}
		expect(page.roster.filter((r) => r.is_mine).map((r) => r.first_name)).toEqual(['Ada']);
	});

	test('it shows nothing at all of another team', async () => {
		const page = (await view(myToken))!;
		expect(page.team.name).toBe(team.name);
		expect(JSON.stringify(page)).not.toContain(rivalTeam.teamId);
		expect(JSON.stringify(page)).not.toContain(rivalTeam.name);
		expect(JSON.stringify(page)).not.toContain('Cy');

		// POSITIVE CONTROL: the rival team and its student do exist, and the
		// rival's own parent link resolves to them.
		const control = await service.from('students').select('id').eq('team_id', rivalTeam.teamId);
		expect((control.data ?? []).length).toBe(1);
		const rivalPage = (await view(rivalToken))!;
		expect(rivalPage.team.name).toBe(rivalTeam.name);
		expect(rivalPage.student.first_name).toBe('Cy');
		expect(JSON.stringify(rivalPage)).not.toContain(team.teamId);
	});

	test('a photo route asks the database, and the database answers only for that child', async () => {
		const { data: mineOk } = await anon.rpc('parent_photo_path', {
			p_token: myToken,
			p_evidence_id: myEvidenceId
		});
		expect(mineOk).toBe(`${team.teamId}/${myTaskId}/${myEvidenceId}.jpg`);

		// The sibling's photo, asked for with this token. Null, not a path.
		const { data: notMine } = await anon.rpc('parent_photo_path', {
			p_token: myToken,
			p_evidence_id: siblingEvidenceId
		});
		expect(notMine).toBeNull();

		// POSITIVE CONTROL: that same evidence id resolves for the sibling's
		// own token, so the null above is the boundary and not a missing row.
		const { data: siblingOk } = await anon.rpc('parent_photo_path', {
			p_token: siblingToken,
			p_evidence_id: siblingEvidenceId
		});
		expect(siblingOk).toBe(`${team.teamId}/${siblingTaskId}/${siblingEvidenceId}.jpg`);

		// A revoked or invented token gets nothing for a photo it would
		// otherwise be entitled to.
		const { data: bogus } = await anon.rpc('parent_photo_path', {
			p_token: 'a'.repeat(64),
			p_evidence_id: myEvidenceId
		});
		expect(bogus).toBeNull();
	});
});

describe('regenerating and revoking', () => {
	test('regenerating mints a new link and kills the old one in the same breath', async () => {
		const student = await createStudent(mentor.client, team, 'Dot', 'D');
		const first = await issue(student.studentId);
		expect((await view(first))!.student.first_name).toBe('Dot');

		const second = await issue(student.studentId);
		expect(second).not.toBe(first);

		// The old URL is dead...
		expect(await view(first)).toBeNull();
		// ...and the new one is not. Together these say the old link was
		// invalidated, rather than the child having vanished.
		expect((await view(second))!.student.first_name).toBe('Dot');

		// One row per child, however many times it is reissued.
		const [{ n }] = await sql<{ n: number }[]>`
			select count(*)::int as n from public.student_parent_access where student_id = ${student.studentId}`;
		expect(n).toBe(1);
	}, 60_000);

	test('revoking turns the link off, and reissuing turns it back on', async () => {
		const student = await createStudent(mentor.client, team, 'Eli', 'E');
		const token = await issue(student.studentId);
		expect(await view(token)).not.toBeNull();

		const { error } = await mentor.client.rpc('parent_access_revoke', { p_student_id: student.studentId });
		expect(error).toBeNull();
		expect(await view(token)).toBeNull();

		// NEGATIVE CONTROL for that null: the child is still there and still
		// active, seen through the service role.
		const { data: still } = await service
			.from('students')
			.select('id, deactivated_at')
			.eq('id', student.studentId)
			.single();
		expect(still?.deactivated_at).toBeNull();

		// Revoking twice is refused in words, rather than silently succeeding.
		const again = await mentor.client.rpc('parent_access_revoke', { p_student_id: student.studentId });
		expect(expectPostgrestError(again).message).toBe('That student has no parent link turned on.');

		// POSITIVE CONTROL: reissuing works and produces a different token.
		const fresh = await issue(student.studentId);
		expect(fresh).not.toBe(token);
		expect(await view(fresh)).not.toBeNull();
		expect(await view(token)).toBeNull();
	}, 60_000);

	test('a deactivated child has no live parent link, whatever the token says', async () => {
		const student = await createStudent(mentor.client, team, 'Fay', 'F');
		const token = await issue(student.studentId);
		expect(await view(token)).not.toBeNull();

		const { error } = await mentor.client.rpc('student_deactivate', { p_student_id: student.studentId });
		expect(error).toBeNull();
		expect(await view(token)).toBeNull();

		// POSITIVE CONTROL: reactivate and the same token works again.
		await mentor.client.rpc('student_reactivate', { p_student_id: student.studentId });
		expect(await view(token)).not.toBeNull();
	}, 60_000);

	test('only a mentor issues or revokes a link', async () => {
		const asStudent = await mineClient.rpc('parent_access_issue', { p_student_id: sibling.studentId });
		expect(expectPostgrestError(asStudent).message).toBe('Only a mentor can make a parent link.');

		const revoke = await mineClient.rpc('parent_access_revoke', { p_student_id: sibling.studentId });
		expect(expectPostgrestError(revoke).message).toBe('Only a mentor can turn off a parent link.');

		// POSITIVE CONTROL: the mentor's identical call succeeds.
		const { error } = await mentor.client.rpc('parent_access_issue', { p_student_id: sibling.studentId });
		expect(error).toBeNull();
		siblingToken = await issue(sibling.studentId);
	});
});

describe('the link table itself', () => {
	test('mentors read the tokens (that is how a card gets printed) and nobody else can', async () => {
		const asMentor = await mentor.client
			.from('student_parent_access')
			.select('student_id, token')
			.eq('student_id', mine.studentId);
		expect(asMentor.error).toBeNull();
		expect((asMentor.data ?? []).length).toBe(1);

		// A teammate sees nothing. RLS on this table has one SELECT policy and
		// it names is_mentor().
		const asStudent = await mineClient.from('student_parent_access').select('student_id, token');
		expect(asStudent.error).toBeNull();
		expect(asStudent.data).toEqual([]);

		// POSITIVE CONTROL for that empty list: the rows are there.
		const control = await service.from('student_parent_access').select('student_id');
		expect((control.data ?? []).length).toBeGreaterThanOrEqual(3);

		// anon holds no grant on the table at all.
		const asAnon = await anon.from('student_parent_access').select('student_id');
		expect(expectPostgrestError(asAnon)).toBeTruthy();
	});

	test('there is no write path on this surface for anybody but the two RPCs', async () => {
		const rowId = (
			await sql<{ id: string }[]>`select id from public.student_parent_access where student_id = ${mine.studentId}`
		)[0].id;

		// A mentor can READ a token but cannot write the table: RLS has no
		// INSERT, UPDATE or DELETE policy, and there is no column grant.
		const insert = await mentor.client
			.from('student_parent_access')
			.insert({ student_id: rival.studentId, team_id: rivalTeam.teamId, token: 'b'.repeat(64) } as never)
			.select('id');
		expect(expectPostgrestError(insert)).toBeTruthy();

		const update = await mentor.client
			.from('student_parent_access')
			.update({ revoked_at: null } as never)
			.eq('id', rowId)
			.select('id');
		expect(expectPostgrestError(update)).toBeTruthy();

		// DELETE is refused one level EARLIER than RLS: there is no table grant
		// at all, so PostgREST answers 42501 rather than the zero-rows-back that
		// an RLS-filtered delete would produce. Both would be refusals; this is
		// the stronger one, and the row is still there either way.
		const remove = await mentor.client.from('student_parent_access').delete().eq('id', rowId).select('id');
		expect(expectPostgrestError(remove).code).toBe('42501');
		const [{ n }] = await sql<{ n: number }[]>`
			select count(*)::int as n from public.student_parent_access where id = ${rowId}`;
		expect(n).toBe(1);
	});

	test('a token is not a credential: holding one buys no write anywhere', async () => {
		// The parent's browser is an ordinary anon client that happens to know
		// a 64-character string. anon holds no table grant in this schema, so
		// there is nothing for the token to unlock.
		const writes = [
			anon.from('tasks').insert({ id: crypto.randomUUID(), team_id: team.teamId, title: 'x' } as never),
			anon.from('attendance').insert({ id: crypto.randomUUID(), meeting_id: meetingId, student_id: mine.studentId }),
			anon.from('students').update({ first_name: 'Hacked' }).eq('id', mine.studentId),
			anon.from('evidence').delete().eq('id', myEvidenceId)
		];
		for (const write of writes) {
			expect(expectPostgrestError(await write)).toBeTruthy();
		}

		// NEGATIVE CONTROL: nothing changed.
		const { data: student } = await service
			.from('students')
			.select('first_name')
			.eq('id', mine.studentId)
			.single();
		expect(student?.first_name).toBe('Ada');
		const { data: evidence } = await service.from('evidence').select('id').eq('id', myEvidenceId).single();
		expect(evidence?.id).toBe(myEvidenceId);

		// And parent_view itself only reads: calling it does not change the
		// child's row, only the link's own "somebody opened this" counters.
		const before = await service.from('student_parent_access').select('open_count').eq('student_id', mine.studentId).single();
		await view(myToken);
		const after = await service.from('student_parent_access').select('open_count').eq('student_id', mine.studentId).single();
		expect((after.data?.open_count ?? 0)).toBe((before.data?.open_count ?? 0) + 1);
	});
});
