// tests/notebook-recap.test.ts
//
// THE AUTO-DRAFT PULLS FROM REAL SESSION DATA. A meeting is run through the
// real RPCs; students check in, close a task, raise and resolve a blocker,
// record a photo, log a practice run; a strategy version is saved. Advancing
// into the LAST phase (the Close) drafts a recap per team, and the draft is
// checked to contain what actually happened -- names, titles, notes, caption,
// points. Then the two halves of "confirmed": an unconfirmed draft is
// regenerated at meeting end (late work picked up), a confirmed one is frozen.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	cleanupRun,
	closeDb,
	createStudent,
	createTeam,
	seedMentor,
	serviceClient,
	signIn,
	type Client,
	type SeededMentor,
	type SeededStudent,
	type SeededTeam
} from './db/harness';
import type { RecapFacts } from '../src/lib/notebook/types';
import { parseRecapFacts } from '../src/lib/notebook/types';

let mentor: SeededMentor;
let teamX: SeededTeam;
let teamY: SeededTeam;
let amy: SeededStudent; // team X notebook lead
let bo: SeededStudent; // team X builder
let cy: SeededStudent; // team Y notebook lead

let amyClient: Client;
let boClient: Client;
let cyClient: Client;

const service = serviceClient();

let meetingId: string;
const taskId = crypto.randomUUID();
const evidenceId = crypto.randomUUID();
const runId = crypto.randomUUID();
const blockerNote = 'The motor cable keeps popping out.';
const photoCaption = 'The scoop holding the rock.';

async function draftFor(teamId: string): Promise<RecapFacts> {
	const { data } = await service
		.from('meeting_recaps')
		.select('draft')
		.eq('meeting_id', meetingId)
		.eq('team_id', teamId)
		.single();
	const facts = parseRecapFacts(data?.draft);
	if (!facts) throw new Error('The recap draft did not parse.');
	return facts;
}

beforeAll(async () => {
	mentor = await seedMentor('recap');
	teamX = await createTeam(mentor.client, 'Recap X');
	teamY = await createTeam(mentor.client, 'Recap Y');
	amy = await createStudent(mentor.client, teamX, 'Amy', 'A');
	bo = await createStudent(mentor.client, teamX, 'Bo', 'B');
	cy = await createStudent(mentor.client, teamY, 'Cy', 'C');

	for (const [teamId, student, role] of [
		[teamX.teamId, amy, 'notebook_values_lead'],
		[teamX.teamId, bo, 'lead_builder'],
		[teamY.teamId, cy, 'notebook_values_lead']
	] as const) {
		const { error } = await mentor.client.rpc('role_assign', {
			p_team_id: teamId,
			p_student_id: student.studentId,
			p_role: role,
			p_tier: 'primary'
		});
		if (error) throw new Error(`role_assign failed: ${error.message}`);
	}

	amyClient = await signIn(amy.email, amy.pin);
	boClient = await signIn(bo.email, bo.pin);
	cyClient = await signIn(cy.email, cy.pin);
});

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('a session, lived through the real RPCs', () => {
	test('the meeting runs and the team does real work', async () => {
		const created = await mentor.client.rpc('meeting_create', {
			p_kind: 'friday',
			p_meeting_date: new Date().toISOString().slice(0, 10),
			p_planned_start_at: new Date().toISOString()
		});
		expect(created.error).toBeNull();
		meetingId = (created.data as { meeting_id: string }).meeting_id;
		const started = await mentor.client.rpc('meeting_start', { p_meeting_id: meetingId });
		expect(started.error).toBeNull();

		// Amy and Bo check in; Cy does too on team Y.
		for (const [client, student] of [
			[amyClient, amy],
			[boClient, bo],
			[cyClient, cy]
		] as const) {
			const checkin = await client
				.from('attendance')
				.insert({ id: crypto.randomUUID(), meeting_id: meetingId, student_id: student.studentId });
			expect(checkin.error).toBeNull();
		}

		// Bo closes a build task.
		const task = await boClient
			.from('tasks')
			.insert({
				id: taskId,
				team_id: teamX.teamId,
				title: 'Build the scoop attachment',
				role: 'lead_builder',
				status: 'done',
				created_by_student_id: bo.studentId
			})
			.select('id, closed_at');
		expect(task.error).toBeNull();
		expect(task.data?.[0]?.closed_at).not.toBeNull();

		// Bo records a photo on it (the row is what the recap reads; the file
		// itself lives in storage and is not needed for this proof).
		const photo = await boClient.from('evidence').insert({
			id: evidenceId,
			task_id: taskId,
			team_id: teamX.teamId,
			storage_path: `${teamX.teamId}/${taskId}/${evidenceId}.jpg`,
			caption: photoCaption,
			uploaded_by_student_id: bo.studentId
		});
		expect(photo.error).toBeNull();

		// Amy raises a blocker; the mentor resolves it.
		const blockerId = crypto.randomUUID();
		const blocker = await amyClient.from('blockers').insert({
			id: blockerId,
			team_id: teamX.teamId,
			student_id: amy.studentId,
			note: blockerNote
		});
		expect(blocker.error).toBeNull();
		const resolved = await mentor.client
			.from('blockers')
			.update({ resolved_at: new Date().toISOString(), resolved_by_mentor_id: mentor.mentorId })
			.eq('id', blockerId)
			.select('id');
		expect(resolved.error).toBeNull();
		expect(resolved.data).toHaveLength(1);

		// Bo logs a practice run with one scored line; the trigger prices it.
		const { data: missions } = await boClient
			.from('missions')
			.select('id')
			.eq('code', 'M01')
			.single();
		const run = await boClient.from('match_runs').insert({
			id: runId,
			team_id: teamX.teamId,
			elapsed_s: 150,
			logged_by_student_id: bo.studentId
		});
		expect(run.error).toBeNull();
		const score = await boClient.from('match_run_scores').insert({
			id: crypto.randomUUID(),
			run_id: runId,
			team_id: teamX.teamId,
			mission_id: missions!.id,
			line_index: 0,
			quantity: 1
		});
		expect(score.error).toBeNull();

		// The mentor saves a strategy version for team X.
		const strategy = await mentor.client
			.from('strategies')
			.insert({ id: crypto.randomUUID(), team_id: teamX.teamId, version: 1, label: 'Scoop first' })
			.select('id');
		expect(strategy.error).toBeNull();
	});

	test('entering the last phase drafts a recap per team, from what actually happened', async () => {
		// The friday template has four phases; three advances reach the Close.
		for (let i = 0; i < 3; i += 1) {
			const advanced = await mentor.client.rpc('meeting_advance_phase', { p_meeting_id: meetingId });
			expect(advanced.error).toBeNull();
			const payload = advanced.data as { phase_ordinal: number; recaps_drafted: number };
			if (i < 2) expect(payload.recaps_drafted).toBe(0);
			else expect(payload.recaps_drafted).toBeGreaterThanOrEqual(2);
		}

		const facts = await draftFor(teamX.teamId);
		expect(facts.present).toEqual(['Amy A.', 'Bo B.']);
		expect(facts.rosterSize).toBe(2);
		expect(facts.tasksClosed.map((t) => t.title)).toContain('Build the scoop attachment');
		expect(facts.tasksClosed.find((t) => t.title === 'Build the scoop attachment')?.role).toBe('lead_builder');
		expect(facts.photos.map((p) => p.caption)).toContain(photoCaption);
		expect(facts.photos[0]?.storagePath).toBe(`${teamX.teamId}/${taskId}/${evidenceId}.jpg`);
		expect(facts.blockersRaised.map((b) => b.note)).toContain(blockerNote);
		expect(facts.blockersRaised.find((b) => b.note === blockerNote)?.resolved).toBe(true);
		expect(facts.blockersResolved.map((b) => b.note)).toContain(blockerNote);
		expect(facts.runsCount).toBe(1);
		// M01 line 0 is worth 20 points; the number came from the pricing
		// trigger, not from anything this test sent.
		expect(facts.runsBest).toBe(20);
		expect(facts.strategyVersions).toEqual([{ version: 1, label: 'Scoop first' }]);

		// Team Y's draft holds team Y's session, not team X's.
		const factsY = await draftFor(teamY.teamId);
		expect(factsY.present).toEqual(['Cy C.']);
		expect(factsY.tasksClosed).toHaveLength(0);
		expect(factsY.runsCount).toBe(0);
	});

	test('a confirmed recap freezes; an unconfirmed one picks up late work at meeting end', async () => {
		// Amy confirms team X's recap during the Close.
		const { data: recapX } = await amyClient
			.from('meeting_recaps')
			.select('id')
			.eq('meeting_id', meetingId)
			.eq('team_id', teamX.teamId)
			.single();
		const confirmed = await amyClient
			.from('meeting_recaps')
			.update({ confirmed: true, summary: 'The scoop worked. Next week: the second launch.' })
			.eq('id', recapX!.id)
			.select('confirmed, confirmed_by_student_id');
		expect(confirmed.error).toBeNull();
		expect(confirmed.data?.[0]?.confirmed).toBe(true);
		expect(confirmed.data?.[0]?.confirmed_by_student_id).toBe(amy.studentId);

		// Late work on BOTH teams, after the Close drafts were generated.
		for (const [client, team, student, title] of [
			[boClient, teamX, bo, 'Late task on X'],
			[cyClient, teamY, cy, 'Late task on Y']
		] as const) {
			const late = await client.from('tasks').insert({
				id: crypto.randomUUID(),
				team_id: team.teamId,
				title,
				status: 'done',
				created_by_student_id: student.studentId
			});
			expect(late.error).toBeNull();
		}

		const ended = await mentor.client.rpc('meeting_end', { p_meeting_id: meetingId });
		expect(ended.error).toBeNull();

		// Team X confirmed: frozen, the late task is NOT in its draft.
		const factsX = await draftFor(teamX.teamId);
		expect(factsX.tasksClosed.map((t) => t.title)).not.toContain('Late task on X');

		// Team Y unconfirmed: regenerated over the final window.
		const factsY = await draftFor(teamY.teamId);
		expect(factsY.tasksClosed.map((t) => t.title)).toContain('Late task on Y');
	});

	test('the season stats RPC counts what the session left behind', async () => {
		const { data } = await amyClient.rpc('notebook_season_stats', { p_team_id: teamX.teamId });
		const stats = data as Record<string, unknown>;
		expect(stats.tasks_closed).toBe(2);
		expect(stats.blockers_resolved).toBe(1);
		expect(stats.photos).toBe(1);
		expect(stats.runs).toBe(1);
		expect(stats.best_points).toBe(20);
		expect(stats.strategy_versions).toBe(1);
		expect(stats.recaps_confirmed).toBe(1);
	});
});
