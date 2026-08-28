// tests/notebook-isolation.test.ts
//
// WHO WRITES IN THE NOTEBOOK, proved through the runtime (PostgREST with real
// GoTrue sessions), not the UI. Since 0026 the rule is the whole rule: any
// mentor, or any student on that team, in every section. This file holds both
// directions of that claim at once. A teammate holding NO ROLE now writes,
// edits and deletes anywhere in their own team's notebook; a student on
// ANOTHER team still cannot touch a word of it, and every one of those
// denials is paired with the same row shown to exist through the service
// role, so an empty answer is never mistaken for an empty table.
//
// THE ONE THING THAT STAYED NARROW is confirming a session recap. Everyone on
// the team writes a recap's summary; only the Notebook and Values Lead (under
// team_resolve_roles' covering rule) and mentors may say it is FINISHED, and
// that is a trigger raising a sentence, not an RLS filter, so it is asserted
// as an error with a positive control beside it.
//
// Two teams; on team A a Notebook Lead (primary and second), a Lead Builder
// and a roleless teammate; on team B a rival lead and a rival with no role.

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
	sql,
	type Client,
	type SeededMentor,
	type SeededStudent,
	type SeededTeam
} from './db/harness';

let mentor: SeededMentor;
let teamA: SeededTeam;
let teamB: SeededTeam;
let noa: SeededStudent; // team A notebook_values_lead, primary
let ella: SeededStudent; // team A notebook_values_lead, second
let ben: SeededStudent; // team A lead_builder, primary
let cara: SeededStudent; // team A, no role at all
let dana: SeededStudent; // team B notebook_values_lead, primary
let finn: SeededStudent; // team B, no role at all

let noaClient: Client;
let ellaClient: Client;
let benClient: Client;
let caraClient: Client;
let danaClient: Client;
let finnClient: Client;

const service = serviceClient();

// Rows created in the tests, referenced across them.
const robotEntryId = crypto.randomUUID();
const valuesEntryId = crypto.randomUUID();
const caraEntryId = crypto.randomUUID();

let recapAId: string | null = null;
let liveMeetingId: string | null = null;

beforeAll(async () => {
	mentor = await seedMentor('nb');
	teamA = await createTeam(mentor.client, 'Notebook A');
	teamB = await createTeam(mentor.client, 'Notebook B');
	noa = await createStudent(mentor.client, teamA, 'Noa', 'V');
	ella = await createStudent(mentor.client, teamA, 'Ella', 'E');
	ben = await createStudent(mentor.client, teamA, 'Ben', 'B');
	cara = await createStudent(mentor.client, teamA, 'Cara', 'C');
	dana = await createStudent(mentor.client, teamB, 'Dana', 'D');
	finn = await createStudent(mentor.client, teamB, 'Finn', 'F');

	for (const [teamId, student, role, tier] of [
		[teamA.teamId, noa, 'notebook_values_lead', 'primary'],
		[teamA.teamId, ella, 'notebook_values_lead', 'second'],
		[teamA.teamId, ben, 'lead_builder', 'primary'],
		[teamB.teamId, dana, 'notebook_values_lead', 'primary']
	] as const) {
		const { error } = await mentor.client.rpc('role_assign', {
			p_team_id: teamId,
			p_student_id: student.studentId,
			p_role: role,
			p_tier: tier
		});
		if (error) throw new Error(`role_assign failed: ${error.message}`);
	}

	noaClient = await signIn(noa.email, noa.pin);
	ellaClient = await signIn(ella.email, ella.pin);
	benClient = await signIn(ben.email, ben.pin);
	caraClient = await signIn(cara.email, cara.pin);
	danaClient = await signIn(dana.email, dana.pin);
	finnClient = await signIn(finn.email, finn.pin);
});

afterAll(async () => {
	// A meeting left running would leak the covering rule into later files.
	if (liveMeetingId) await mentor.client.rpc('meeting_end', { p_meeting_id: liveMeetingId });
	await cleanupRun();
	await closeDb();
});

describe('the edit rule: the whole team holds the pen', () => {
	test('the Notebook Lead writes every section', async () => {
		for (const [id, section] of [
			[valuesEntryId, 'core_values'],
			[crypto.randomUUID(), 'innovation_project'],
			[crypto.randomUUID(), 'season_summary']
		] as const) {
			const res = await noaClient
				.from('notebook_entries')
				.insert({
					id,
					team_id: teamA.teamId,
					section,
					prompt_key: 'cv-teamwork',
					body: 'We built the scoop together.',
					authored_by_student_id: noa.studentId
				})
				.select('id');
			expect(res.error).toBeNull();
			expect(res.data).toHaveLength(1);
		}
	});

	test('the Lead Builder writes Robot Design, with a failed try as a first-class row', async () => {
		const res = await benClient
			.from('notebook_entries')
			.insert({
				id: robotEntryId,
				team_id: teamA.teamId,
				section: 'robot_design',
				title: 'A claw arm for the rock',
				body: 'It dropped the rock on every turn.',
				outcome: 'failed',
				change_note: 'We switched to a scoop.',
				authored_by_student_id: ben.studentId
			})
			.select('id');
		expect(res.error).toBeNull();
		expect(res.data).toHaveLength(1);
	});

	test('the Lead Builder now writes the Innovation Project and Core Values too', async () => {
		// 0016 refused both of these with 42501: Robot Design was the builder's
		// only section. THIS IS THE CHANGE 0026 MADE, asserted where it broke.
		for (const section of ['innovation_project', 'core_values'] as const) {
			const res = await benClient
				.from('notebook_entries')
				.insert({
					id: crypto.randomUUID(),
					team_id: teamA.teamId,
					section,
					body: 'Not out of my lane any more.',
					authored_by_student_id: ben.studentId
				})
				.select('id');
			expect(res.error).toBeNull();
			expect(res.data).toHaveLength(1);
		}

		// And the lead's page is his to improve: an update that RLS filters is
		// 204 with zero rows and no error, so the rows are asked for back.
		const update = await benClient
			.from('notebook_entries')
			.update({ body: 'We built the scoop together, all six of us.' })
			.eq('id', valuesEntryId)
			.select('id');
		expect(update.error).toBeNull();
		expect(update.data).toHaveLength(1);
	});

	test('a teammate with NO ROLE writes every section, and reads everything', async () => {
		const read = await caraClient.from('notebook_entries').select('id').eq('team_id', teamA.teamId);
		expect(read.error).toBeNull();
		expect(read.data?.length).toBeGreaterThanOrEqual(6);

		for (const [id, section] of [
			[caraEntryId, 'robot_design'],
			[crypto.randomUUID(), 'innovation_project'],
			[crypto.randomUUID(), 'core_values'],
			[crypto.randomUUID(), 'season_summary']
		] as const) {
			const res = await caraClient
				.from('notebook_entries')
				.insert({
					id,
					team_id: teamA.teamId,
					section,
					body: 'No role, and still my notebook.',
					authored_by_student_id: cara.studentId
				})
				.select('id');
			expect(res.error).toBeNull();
			expect(res.data).toHaveLength(1);
		}
	});

	test('a teammate with no role edits and deletes a page somebody else wrote', async () => {
		const update = await caraClient
			.from('notebook_entries')
			.update({ body: 'It dropped the rock three runs in a row.' })
			.eq('id', robotEntryId)
			.select('id');
		expect(update.error).toBeNull();
		expect(update.data).toHaveLength(1);

		// The delete policy calls the same widened function, which is stated
		// out loud in 0026's header rather than discovered later: a notebook
		// delete is soft (0020), so nothing is actually lost.
		const doomed = crypto.randomUUID();
		await service.from('notebook_entries').insert({
			id: doomed,
			team_id: teamA.teamId,
			section: 'core_values',
			body: 'A page to remove.'
		});
		const del = await caraClient.from('notebook_entries').delete().eq('id', doomed).select('id');
		expect(del.error).toBeNull();
		expect(del.data).toHaveLength(1);
	});

	test('notebook_can_edit itself answers true for a roleless teammate and false for a rival', async () => {
		for (const section of ['robot_design', 'innovation_project', 'core_values', 'season_summary'] as const) {
			const mine = await caraClient.rpc('notebook_can_edit', {
				p_team_id: teamA.teamId,
				p_section: section
			});
			expect({ section, error: mine.error, can: mine.data }).toEqual({
				section,
				error: null,
				can: true
			});

			// Both directions on the same function, same call, other caller.
			const theirs = await danaClient.rpc('notebook_can_edit', {
				p_team_id: teamA.teamId,
				p_section: section
			});
			expect({ section, error: theirs.error, can: theirs.data }).toEqual({
				section,
				error: null,
				can: false
			});
		}
	});

	test('an author cannot be forged: writing as someone else is refused', async () => {
		const forged = await caraClient.from('notebook_entries').insert({
			id: crypto.randomUUID(),
			team_id: teamA.teamId,
			section: 'core_values',
			body: 'signed with the wrong name',
			authored_by_student_id: ben.studentId
		});
		expect(expectPostgrestError(forged).code).toBe('42501');
	});

	test('the mentor edits any team and writes with no student byline', async () => {
		const res = await mentor.client
			.from('notebook_entries')
			.insert({
				id: crypto.randomUUID(),
				team_id: teamB.teamId,
				section: 'season_summary',
				body: 'Mentor note on team B.'
			})
			.select('id');
		expect(res.error).toBeNull();
		expect(res.data).toHaveLength(1);
	});
});

describe('the team boundary, which widening the rule did not move', () => {
	test('a rival reads NOTHING of team A, and the rows exist for the service role', async () => {
		for (const client of [danaClient, finnClient]) {
			const denied = await client.from('notebook_entries').select('id').eq('team_id', teamA.teamId);
			expect(denied.error).toBeNull();
			expect(denied.data).toHaveLength(0);
		}

		const control = await service.from('notebook_entries').select('id').eq('team_id', teamA.teamId);
		expect(control.error).toBeNull();
		expect(control.data?.length).toBeGreaterThan(0);
	});

	test('a rival WITH NO ROLE cannot write into team A: the widening is per team, not per app', async () => {
		// finn is to team B exactly what cara is to team A. cara writes; finn
		// does not, because current_student_team_id() is his own team.
		const denied = await finnClient.from('notebook_entries').insert({
			id: crypto.randomUUID(),
			team_id: teamA.teamId,
			section: 'core_values',
			body: 'not my notebook',
			authored_by_student_id: finn.studentId
		});
		expect(expectPostgrestError(denied).code).toBe('42501');

		const update = await finnClient
			.from('notebook_entries')
			.update({ body: 'rewritten by a stranger' })
			.eq('id', caraEntryId)
			.select('id');
		expect(update.error).toBeNull();
		expect(update.data).toHaveLength(0);

		// POSITIVE CONTROL, both halves: the row is there for the service role
		// with its words untouched, and the same statement from cara moves it.
		const still = await service.from('notebook_entries').select('id, body').eq('id', caraEntryId);
		expect(still.data).toHaveLength(1);
		expect((still.data ?? [])[0]?.body).toBe('No role, and still my notebook.');

		const control = await caraClient
			.from('notebook_entries')
			.update({ body: 'No role, and still my notebook, edited by me.' })
			.eq('id', caraEntryId)
			.select('id');
		expect(control.error).toBeNull();
		expect(control.data).toHaveLength(1);
	});

	test('a rival lead cannot write into team A, however the row is dressed', async () => {
		// Honest team_id: the policy refuses, because dana cannot edit team A.
		const honest = await danaClient.from('notebook_entries').insert({
			id: crypto.randomUUID(),
			team_id: teamA.teamId,
			section: 'core_values',
			body: 'rival graffiti',
			authored_by_student_id: dana.studentId
		});
		expect(expectPostgrestError(honest).code).toBe('42501');

		// Forged citation: an entry on dana's OWN team naming team A's photo.
		// The COMPOSITE FOREIGN KEY (evidence_id, team_id) refuses before any
		// policy question, because team A's photo does not exist under team
		// B's id.
		const taskId = crypto.randomUUID();
		const evidenceId = crypto.randomUUID();
		await service.from('tasks').insert({
			id: taskId,
			team_id: teamA.teamId,
			title: 'Team A task',
			created_by_mentor_id: mentor.mentorId
		});
		await service.from('evidence').insert({
			id: evidenceId,
			task_id: taskId,
			team_id: teamA.teamId,
			storage_path: `${teamA.teamId}/${taskId}/${evidenceId}.jpg`,
			uploaded_by_student_id: noa.studentId
		});

		const forged = await danaClient.from('notebook_entries').insert({
			id: crypto.randomUUID(),
			team_id: teamB.teamId,
			section: 'core_values',
			body: 'their photo, our notebook',
			evidence_id: evidenceId,
			authored_by_student_id: dana.studentId
		});
		expect(expectPostgrestError(forged).code).toBe('23503');
	});

	test('a rival lead cannot delete team A rows: zero rows, row still there', async () => {
		const del = await danaClient.from('notebook_entries').delete().eq('id', robotEntryId).select('id');
		expect(del.error).toBeNull();
		expect(del.data).toHaveLength(0);

		const still = await service.from('notebook_entries').select('id').eq('id', robotEntryId);
		expect(still.data).toHaveLength(1);
	});
});

describe('recaps: the team writes them, the lead and mentors finish them', () => {
	test('ending a meeting drafts a recap for every team', async () => {
		const created = await mentor.client.rpc('meeting_create', {
			p_kind: 'friday',
			p_meeting_date: new Date().toISOString().slice(0, 10),
			p_planned_start_at: new Date().toISOString()
		});
		expect(created.error).toBeNull();
		const meetingId = (created.data as { meeting_id: string }).meeting_id;
		const started = await mentor.client.rpc('meeting_start', { p_meeting_id: meetingId });
		expect(started.error).toBeNull();
		const ended = await mentor.client.rpc('meeting_end', { p_meeting_id: meetingId });
		expect(ended.error).toBeNull();
		expect((ended.data as { recaps_drafted: number }).recaps_drafted).toBeGreaterThanOrEqual(2);

		const recapA = await noaClient
			.from('meeting_recaps')
			.select('id, team_id, confirmed')
			.eq('meeting_id', meetingId)
			.eq('team_id', teamA.teamId);
		expect(recapA.error).toBeNull();
		expect(recapA.data).toHaveLength(1);
		expect(recapA.data?.[0]?.confirmed).toBe(false);
		recapAId = recapA.data?.[0]?.id ?? null;
	});

	test('a rival reads nothing of team A recaps; the service role sees them', async () => {
		const denied = await danaClient.from('meeting_recaps').select('id').eq('team_id', teamA.teamId);
		expect(denied.error).toBeNull();
		expect(denied.data).toHaveLength(0);

		const control = await service.from('meeting_recaps').select('id').eq('team_id', teamA.teamId);
		expect(control.data?.length).toBeGreaterThan(0);
	});

	test('every teammate writes the summary, and a rival still gets zero rows', async () => {
		for (const [client, words] of [
			[noaClient, 'We planned the claw and split the missions.'],
			[benClient, 'We planned the claw, and Ben measured the arm.'],
			[caraClient, 'We planned the claw, and Cara wrote it down.']
		] as const) {
			const res = await client
				.from('meeting_recaps')
				.update({ summary: words })
				.eq('id', recapAId!)
				.select('id');
			expect(res.error).toBeNull();
			expect(res.data).toHaveLength(1);
		}

		const rival = await danaClient
			.from('meeting_recaps')
			.update({ summary: 'not mine to write' })
			.eq('id', recapAId!)
			.select('id');
		expect(rival.error).toBeNull();
		expect(rival.data).toHaveLength(0);

		// Positive control on that denial: the row is there, holding the words
		// the last teammate wrote and not the rival's.
		const still = await service.from('meeting_recaps').select('id, summary').eq('id', recapAId!);
		expect(still.data).toHaveLength(1);
		expect((still.data ?? [])[0]?.summary).toBe('We planned the claw, and Cara wrote it down.');
	});

	test('CONFIRMING is not writing: a teammate is refused with a sentence, the lead is not', async () => {
		for (const client of [benClient, caraClient]) {
			const refused = await client
				.from('meeting_recaps')
				.update({ confirmed: true })
				.eq('id', recapAId!)
				.select('id');
			const err = expectPostgrestError(refused);
			// The schema raises sentences, not codes: this text is what a nine
			// year old reads in the notebook's failure banner.
			expect(err.message).toMatch(/Notebook and Values Lead or a mentor/i);
			expect(err.message).not.toMatch(/meeting_recaps|42501|row-level/i);
		}

		// Positive control: the row exists and is still unconfirmed, so the
		// refusals above stopped a real write rather than missing the row.
		const unconfirmed = await service
			.from('meeting_recaps')
			.select('id, confirmed')
			.eq('id', recapAId!);
		expect(unconfirmed.data).toHaveLength(1);
		expect((unconfirmed.data ?? [])[0]?.confirmed).toBe(false);

		// The other direction: the same statement from the lead lands, and the
		// stamps are the server's.
		const confirm = await noaClient
			.from('meeting_recaps')
			.update({ confirmed: true })
			.eq('id', recapAId!)
			.select('id, confirmed, confirmed_at, confirmed_by_student_id');
		expect(confirm.error).toBeNull();
		expect(confirm.data?.[0]?.confirmed).toBe(true);
		expect(confirm.data?.[0]?.confirmed_at).not.toBeNull();
		expect(confirm.data?.[0]?.confirmed_by_student_id).toBe(noa.studentId);
	});

	test('a teammate cannot REOPEN a confirmed recap either, but may still add words', async () => {
		const refused = await caraClient
			.from('meeting_recaps')
			.update({ confirmed: false })
			.eq('id', recapAId!)
			.select('id');
		expect(expectPostgrestError(refused).message).toMatch(/finish a session recap or reopen one/i);

		const stillConfirmed = await service
			.from('meeting_recaps')
			.select('confirmed')
			.eq('id', recapAId!);
		expect((stillConfirmed.data ?? [])[0]?.confirmed).toBe(true);

		// Writing is untouched by the confirmation gate: the trigger only
		// fires when `confirmed` itself moves.
		const words = await caraClient
			.from('meeting_recaps')
			.update({ summary: 'We planned the claw. Cara added one more line.' })
			.eq('id', recapAId!)
			.select('id');
		expect(words.error).toBeNull();
		expect(words.data).toHaveLength(1);
	});

	test('a client still cannot write the confirmation stamp, and the lead can reopen', async () => {
		const direct = await noaClient
			.from('meeting_recaps')
			.update({ confirmed_at: new Date().toISOString() } as never)
			.eq('id', recapAId!);
		expect(expectPostgrestError(direct).code).toBe('42501');

		const reopen = await noaClient
			.from('meeting_recaps')
			.update({ confirmed: false })
			.eq('id', recapAId!)
			.select('confirmed, confirmed_at, confirmed_by_student_id');
		expect(reopen.error).toBeNull();
		expect(reopen.data?.[0]?.confirmed_at).toBeNull();
		expect(reopen.data?.[0]?.confirmed_by_student_id).toBeNull();
	});

	test('a mentor confirms and reopens too', async () => {
		const confirm = await mentor.client
			.from('meeting_recaps')
			.update({ confirmed: true })
			.eq('id', recapAId!)
			.select('id, confirmed');
		expect(confirm.error).toBeNull();
		expect(confirm.data?.[0]?.confirmed).toBe(true);

		const reopen = await mentor.client
			.from('meeting_recaps')
			.update({ confirmed: false })
			.eq('id', recapAId!)
			.select('id, confirmed');
		expect(reopen.error).toBeNull();
		expect(reopen.data?.[0]?.confirmed).toBe(false);
	});
});

describe('the covering rule during a live meeting: it governs CONFIRMING, not writing', () => {
	test('with only the second lead checked in, she confirms and the absent primary does not', async () => {
		const created = await mentor.client.rpc('meeting_create', {
			p_kind: 'saturday',
			p_meeting_date: new Date().toISOString().slice(0, 10),
			p_planned_start_at: new Date().toISOString()
		});
		expect(created.error).toBeNull();
		liveMeetingId = (created.data as { meeting_id: string }).meeting_id;
		const started = await mentor.client.rpc('meeting_start', { p_meeting_id: liveMeetingId });
		expect(started.error).toBeNull();

		// Only Ella (the second) checks in: she is now the ACTIVE notebook lead.
		const checkin = await ellaClient
			.from('attendance')
			.insert({ id: crypto.randomUUID(), meeting_id: liveMeetingId!, student_id: ella.studentId });
		expect(checkin.error).toBeNull();

		const ellaConfirms = await ellaClient
			.from('meeting_recaps')
			.update({ confirmed: true })
			.eq('id', recapAId!)
			.select('id, confirmed');
		expect(ellaConfirms.error).toBeNull();
		expect(ellaConfirms.data?.[0]?.confirmed).toBe(true);

		// Noa holds the primary assignment but is not here; the seat is Ella's.
		const noaReopens = await noaClient
			.from('meeting_recaps')
			.update({ confirmed: false })
			.eq('id', recapAId!)
			.select('id');
		expect(expectPostgrestError(noaReopens).message).toMatch(/Notebook and Values Lead or a mentor/i);

		// Positive control on that denial: still confirmed, and Ella can undo
		// exactly what Noa could not.
		const still = await service.from('meeting_recaps').select('confirmed').eq('id', recapAId!);
		expect((still.data ?? [])[0]?.confirmed).toBe(true);

		const ellaReopens = await ellaClient
			.from('meeting_recaps')
			.update({ confirmed: false })
			.eq('id', recapAId!)
			.select('id');
		expect(ellaReopens.error).toBeNull();
		expect(ellaReopens.data).toHaveLength(1);
	});

	test('and BOTH of them write notebook pages, checked in or not', async () => {
		// This is what 0026 changed about the covering rule: it decides who is
		// holding a ROLE today, and the notebook no longer asks.
		for (const [client, who] of [
			[ellaClient, ella],
			[noaClient, noa],
			[caraClient, cara]
		] as const) {
			const res = await client
				.from('notebook_entries')
				.insert({
					id: crypto.randomUUID(),
					team_id: teamA.teamId,
					section: 'core_values',
					body: 'Written during the meeting.',
					authored_by_student_id: who.studentId
				})
				.select('id');
			expect({ who: who.studentId, error: res.error, rows: res.data?.length }).toEqual({
				who: who.studentId,
				error: null,
				rows: 1
			});
		}

		// And a rival is still refused while a meeting is running.
		const rival = await finnClient.from('notebook_entries').insert({
			id: crypto.randomUUID(),
			team_id: teamA.teamId,
			section: 'core_values',
			body: 'still not my notebook',
			authored_by_student_id: finn.studentId
		});
		expect(expectPostgrestError(rival).code).toBe('42501');
	});
});

describe('SQL-level sanity', () => {
	test('both gates are definer, pinned, and executable by authenticated but not anon', async () => {
		for (const name of ['notebook_can_edit', 'notebook_can_confirm']) {
			const [row] = await sql<{ prosecdef: boolean; anon: boolean; authed: boolean }[]>`
				select p.prosecdef,
				       has_function_privilege('anon', p.oid, 'execute') as anon,
				       has_function_privilege('authenticated', p.oid, 'execute') as authed
				from pg_proc p join pg_namespace n on n.oid = p.pronamespace
				where n.nspname = 'public' and p.proname = ${name}`;
			expect({ name, ...row }).toEqual({ name, prosecdef: true, anon: false, authed: true });
		}
	});

	test('notebook_can_edit KEPT its section parameter, so no policy or grant had to move', async () => {
		// Dropping p_section would change the signature, which would force
		// every policy and both 0020 RPCs to be rewritten and would leave two
		// overloads PostgREST cannot resolve between. 0026 keeps it unused on
		// purpose; this is the assertion that says so out loud.
		const rows = await sql<{ args: string }[]>`
			select pg_get_function_arguments(p.oid) as args
			from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			where n.nspname = 'public' and p.proname = 'notebook_can_edit'`;
		// Exactly one row: two overloads differing by a trailing parameter are
		// the signature trap, and PostgREST could not resolve the call.
		expect(rows).toHaveLength(1);
		expect(rows[0].args).toMatch(/^p_team_id uuid, p_section (public\.)?notebook_section$/);
	});

	test('the confirmation gate is a BEFORE UPDATE trigger on meeting_recaps', async () => {
		const rows = await sql<{ tgname: string }[]>`
			select t.tgname from pg_trigger t
			where t.tgrelid = 'public.meeting_recaps'::regclass and not t.tgisinternal
			order by t.tgname`;
		expect(rows.map((r) => r.tgname)).toContain('meeting_recaps_confirm_gate');
		// It fires BEFORE the stamp: a refused confirmation never reaches it.
		expect(rows.map((r) => r.tgname).indexOf('meeting_recaps_confirm_gate')).toBeLessThan(
			rows.map((r) => r.tgname).indexOf('meeting_recaps_confirm_stamp')
		);
	});

	test('the comment on notebook_can_edit describes the NEW rule', async () => {
		// A comment that still says "the Notebook and Values Lead edits every
		// section" is a defect: it is the first thing a future reader trusts.
		const [row] = await sql<{ description: string }[]>`
			select d.description
			from pg_proc p
			join pg_namespace n on n.oid = p.pronamespace
			left join pg_description d on d.objoid = p.oid
			where n.nspname = 'public' and p.proname = 'notebook_can_edit'`;
		expect(row.description).toMatch(/any active student on that team/i);
		expect(row.description).toMatch(/not consulted/i);
	});

	test('notebook_season_stats answers null, not an error, to a caller outside the team', async () => {
		const rival = await danaClient.rpc('notebook_season_stats', { p_team_id: teamA.teamId });
		expect(rival.error).toBeNull();
		expect(rival.data).toBeNull();

		const own = await caraClient.rpc('notebook_season_stats', { p_team_id: teamA.teamId });
		expect(own.error).toBeNull();
		expect(own.data).not.toBeNull();
	});
});
