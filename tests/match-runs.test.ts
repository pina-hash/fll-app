// tests/match-runs.test.ts
//
// THE NUMBER THAT GOES UP HAS TO BE TRUE. A practice run's score is derived by
// trigger from the season's mission list and the lines the team ticked;
// neither match_run_scores.points nor match_runs.points appears in any client
// grant, so a device says WHAT it scored and never how much that is worth. A
// scoreboard you can type into is not a scoreboard, and this is the number a
// nine-year-old opens the app to see.
//
// The rest of the file is the team boundary in both directions (a rival's
// runs are invisible AND provably exist), the board iPad's write path, and
// the best-so-far trendline being one SQL rule rather than a running maximum
// three screens each accumulate their own way.

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
import { boardEmail } from '../src/lib/auth/student-identity';

let mentor: SeededMentor;
let team: SeededTeam;
let rivalTeam: SeededTeam;
let student: SeededStudent;
let rival: SeededStudent;
let studentClient: Client;
let rivalClient: Client;
let boardClient: Client;

/** M01 "Drone Survey": line 0 is worth 20, line 1 is a 10-point bonus. */
let m01: string;
/** M02 "Exploding Seeds": line 0 is worth 10 each seed. */
let m02: string;

const service = serviceClient();
const BOARD_PIN = '909090';

type HistoryRun = {
	id: string;
	points: number;
	best_so_far: number;
	strategy_version: number | null;
	lines_scored: number;
	launches_attempted: number;
};
type History = { team_id: string; run_count: number; best_points: number; runs: HistoryRun[] };

async function history(client: Client, teamId: string): Promise<History | null> {
	const { data, error } = await client.rpc('match_run_history', { p_team_id: teamId });
	expect(error).toBeNull();
	return data as History | null;
}

/** One run with its scoring lines, logged the way the mat screen logs it. */
async function logRun(
	client: Client,
	teamId: string,
	lines: { missionId: string; lineIndex: number; quantity?: number }[],
	extra: { strategyId?: string; note?: string; elapsedS?: number; startedAt?: string } = {}
): Promise<string> {
	const runId = crypto.randomUUID();
	const { error } = await client.from('match_runs').insert({
		id: runId,
		team_id: teamId,
		strategy_id: extra.strategyId ?? null,
		started_at: extra.startedAt ?? new Date().toISOString(),
		elapsed_s: extra.elapsedS ?? 150,
		note: extra.note ?? ''
	});
	if (error) throw new Error(`match_runs insert failed: ${error.message}`);
	for (const line of lines) {
		const { error: scoreErr } = await client.from('match_run_scores').insert({
			id: crypto.randomUUID(),
			run_id: runId,
			team_id: teamId,
			mission_id: line.missionId,
			line_index: line.lineIndex,
			quantity: line.quantity ?? 1
		});
		if (scoreErr) throw new Error(`match_run_scores insert failed: ${scoreErr.message}`);
	}
	return runId;
}

async function pointsOf(runId: string): Promise<number> {
	const [{ points }] = await sql<{ points: number }[]>`
		select points from public.match_runs where id = ${runId}`;
	return points;
}

beforeAll(async () => {
	mentor = await seedMentor('runs');
	team = await createTeam(mentor.client, 'Runs');
	rivalTeam = await createTeam(mentor.client, 'Runs Rival');
	student = await createStudent(mentor.client, team, 'Rae', 'R');
	rival = await createStudent(mentor.client, rivalTeam, 'Vic', 'V');
	studentClient = await signIn(student.email, student.pin);
	rivalClient = await signIn(rival.email, rival.pin);

	const { error: boardErr } = await mentor.client.rpc('team_board_enable', {
		p_team_id: team.teamId,
		p_pin: BOARD_PIN
	});
	if (boardErr) throw new Error(`team_board_enable failed: ${boardErr.message}`);
	boardClient = await signIn(boardEmail(team.joinCode), BOARD_PIN);

	const missions = await sql<{ id: string; code: string }[]>`
		select id, code from public.missions where code in ('M01', 'M02')`;
	m01 = missions.find((m) => m.code === 'M01')!.id;
	m02 = missions.find((m) => m.code === 'M02')!.id;
}, 120_000);

afterAll(async () => {
	await mentor.client.rpc('team_board_disable', { p_team_id: team.teamId });
	await cleanupRun();
	await closeDb();
});

describe('a score is computed, never sent', () => {
	test('the run total is the sum of the lines, priced from the missions table', async () => {
		// M01 line 0 (20) + M01 line 1 bonus (10) + M02 line 0 x3 seeds (30).
		const runId = await logRun(studentClient, team.teamId, [
			{ missionId: m01, lineIndex: 0 },
			{ missionId: m01, lineIndex: 1 },
			{ missionId: m02, lineIndex: 0, quantity: 3 }
		]);

		// The prices come from the mission list, not from this test.
		const [{ a, b, c }] = await sql<{ a: number; b: number; c: number }[]>`
			select
				(m1.scoring -> 0 ->> 'points')::int as a,
				(m1.scoring -> 1 ->> 'points')::int as b,
				(m2.scoring -> 0 ->> 'points')::int as c
			from public.missions m1, public.missions m2
			where m1.id = ${m01} and m2.id = ${m02}`;
		expect(await pointsOf(runId)).toBe(a + b + c * 3);

		// Changing a quantity re-totals; deleting a line re-totals down.
		const { data: updated, error } = await studentClient
			.from('match_run_scores')
			.update({ quantity: 5 })
			.eq('run_id', runId)
			.eq('mission_id', m02)
			.select('id, quantity');
		expect(error).toBeNull();
		expect(updated).toHaveLength(1);
		expect(await pointsOf(runId)).toBe(a + b + c * 5);

		const { data: removed } = await studentClient
			.from('match_run_scores')
			.delete()
			.eq('run_id', runId)
			.eq('mission_id', m02)
			.select('id');
		expect(removed).toHaveLength(1);
		expect(await pointsOf(runId)).toBe(a + b);
	}, 60_000);

	test('a device cannot claim a score: points is in no client grant, on either table', async () => {
		const runId = await logRun(studentClient, team.teamId, [{ missionId: m01, lineIndex: 0 }]);
		const honest = await pointsOf(runId);

		const onRun = await studentClient
			.from('match_runs')
			.update({ points: 500 } as never)
			.eq('id', runId)
			.select('id');
		expect(expectPostgrestError(onRun).code).toBe('42501');

		const onLine = await studentClient
			.from('match_run_scores')
			.update({ points: 500 } as never)
			.eq('run_id', runId)
			.select('id');
		expect(expectPostgrestError(onLine).code).toBe('42501');

		// Inserting a line that names its own price is refused the same way.
		const onInsert = await studentClient.from('match_run_scores').insert({
			id: crypto.randomUUID(),
			run_id: runId,
			team_id: team.teamId,
			mission_id: m02,
			line_index: 0,
			points: 500
		} as never);
		expect(expectPostgrestError(onInsert).code).toBe('42501');

		// NEGATIVE CONTROL: the number never moved.
		expect(await pointsOf(runId)).toBe(honest);

		// POSITIVE CONTROL: the columns a device MAY write still work.
		const { data, error } = await studentClient
			.from('match_runs')
			.update({ note: 'stalled on the ramp', elapsed_s: 142 })
			.eq('id', runId)
			.select('note, elapsed_s');
		expect(error).toBeNull();
		expect(data).toEqual([{ note: 'stalled on the ramp', elapsed_s: 142 }]);
	}, 60_000);

	test('a scoring line that does not exist on that mission is refused by name', async () => {
		const runId = await logRun(studentClient, team.teamId, []);
		const attempt = await studentClient.from('match_run_scores').insert({
			id: crypto.randomUUID(),
			run_id: runId,
			team_id: team.teamId,
			mission_id: m02,
			line_index: 9
		});
		const error = expectPostgrestError(attempt);
		expect(error.message).toContain('does not have a scoring line number 9');
		expect(error.message).toContain('Exploding Seeds');

		// POSITIVE CONTROL: line 0 of the same mission lands.
		const { error: ok } = await studentClient.from('match_run_scores').insert({
			id: crypto.randomUUID(),
			run_id: runId,
			team_id: team.teamId,
			mission_id: m02,
			line_index: 0
		});
		expect(ok).toBeNull();
	}, 60_000);
});

describe('the trendline', () => {
	let trendTeam: SeededTeam;
	let trendClient: Client;

	test('best_so_far is the running maximum, computed once in SQL', async () => {
		trendTeam = await createTeam(mentor.client, 'Runs Trend');
		const trendStudent = await createStudent(mentor.client, trendTeam, 'Tam', 'T');
		trendClient = await signIn(trendStudent.email, trendStudent.pin);

		// Three runs, deliberately not monotonic: 20, then 60, then 10.
		const base = Date.now() - 3 * 60 * 60 * 1000;
		await logRun(trendClient, trendTeam.teamId, [{ missionId: m01, lineIndex: 0 }], {
			startedAt: new Date(base).toISOString()
		});
		await logRun(
			trendClient,
			trendTeam.teamId,
			[
				{ missionId: m01, lineIndex: 0 },
				{ missionId: m01, lineIndex: 1 },
				{ missionId: m02, lineIndex: 0, quantity: 3 }
			],
			{ startedAt: new Date(base + 60_000).toISOString() }
		);
		await logRun(trendClient, trendTeam.teamId, [{ missionId: m02, lineIndex: 0 }], {
			startedAt: new Date(base + 120_000).toISOString()
		});

		const page = (await history(trendClient, trendTeam.teamId))!;
		expect(page.run_count).toBe(3);

		// The RPC hands them back newest first; oldest first is the trendline.
		const oldestFirst = [...page.runs].reverse();
		expect(oldestFirst.map((r) => r.points)).toEqual([20, 60, 10]);
		expect(oldestFirst.map((r) => r.best_so_far)).toEqual([20, 60, 60]);
		expect(page.best_points).toBe(60);
	}, 120_000);

	test('a run can name the strategy version it was driven against', async () => {
		// The Run Captain owns the plan (0012), so make this student one.
		const [{ id: captainId }] = await sql<{ id: string }[]>`
			select id from public.students where team_id = ${trendTeam.teamId} limit 1`;
		await mentor.client.rpc('role_assign', {
			p_team_id: trendTeam.teamId,
			p_student_id: captainId,
			p_role: 'run_captain',
			p_tier: 'primary'
		});

		const strategyId = crypto.randomUUID();
		const { error: planErr } = await trendClient
			.from('strategies')
			.insert({ id: strategyId, team_id: trendTeam.teamId, version: 1, label: 'v1' });
		expect(planErr).toBeNull();

		const runId = await logRun(trendClient, trendTeam.teamId, [{ missionId: m01, lineIndex: 0 }], {
			strategyId,
			startedAt: new Date().toISOString()
		});

		const page = (await history(trendClient, trendTeam.teamId))!;
		const cited = page.runs.find((r) => r.id === runId)!;
		expect(cited.strategy_version).toBe(1);

		// A run may cite only its OWN team's plan: the composite key refuses
		// the other team's strategy id outright.
		const foreign = crypto.randomUUID();
		await mentor.client.from('strategies').insert({ id: foreign, team_id: team.teamId, version: 1 });
		const attempt = await trendClient.from('match_runs').insert({
			id: crypto.randomUUID(),
			team_id: trendTeam.teamId,
			strategy_id: foreign,
			started_at: new Date().toISOString()
		});
		expect(expectPostgrestError(attempt).code).toBe('23503');
	}, 120_000);
});

describe('the team boundary', () => {
	test('a team never sees runs that belong to another team, and the rival provably has some', async () => {
		const rivalRun = await logRun(rivalClient, rivalTeam.teamId, [{ missionId: m01, lineIndex: 0 }]);

		// The rival can see their own.
		const theirs = await rivalClient.from('match_runs').select('id').eq('team_id', rivalTeam.teamId);
		expect((theirs.data ?? []).map((r) => r.id)).toContain(rivalRun);

		// This team cannot, on any of the three tables.
		const runs = await studentClient.from('match_runs').select('id').eq('team_id', rivalTeam.teamId);
		expect(runs.error).toBeNull();
		expect(runs.data).toEqual([]);
		const scores = await studentClient.from('match_run_scores').select('id').eq('run_id', rivalRun);
		expect(scores.data).toEqual([]);
		const launches = await studentClient.from('match_run_launches').select('id').eq('run_id', rivalRun);
		expect(launches.data).toEqual([]);

		// POSITIVE CONTROL for those three empty lists: the service role sees
		// the run and its score line.
		const control = await service.from('match_runs').select('id, points').eq('id', rivalRun).single();
		expect(control.data?.id).toBe(rivalRun);
		expect(control.data?.points).toBeGreaterThan(0);

		// The history RPC answers null rather than raising, so a probe cannot
		// tell a forbidden team from one that does not exist.
		expect(await history(studentClient, rivalTeam.teamId)).toBeNull();
		expect(await history(studentClient, crypto.randomUUID())).toBeNull();
		expect((await history(rivalClient, rivalTeam.teamId))!.run_count).toBeGreaterThan(0);

		// And a write into the rival's team is refused, not silently dropped.
		const write = await studentClient.from('match_runs').insert({
			id: crypto.randomUUID(),
			team_id: rivalTeam.teamId,
			started_at: new Date().toISOString()
		});
		expect(expectPostgrestError(write).code).toBe('42501');
	}, 60_000);

	test('a mentor sees every team, which is the other direction of the same policy', async () => {
		const ours = await history(mentor.client, team.teamId);
		const theirs = await history(mentor.client, rivalTeam.teamId);
		expect(ours!.run_count).toBeGreaterThan(0);
		expect(theirs!.run_count).toBeGreaterThan(0);
	});

	test('the team board iPad logs a run for its own team, as the team and not as a person', async () => {
		const runId = await logRun(boardClient, team.teamId, [{ missionId: m01, lineIndex: 0 }], {
			note: 'logged from the board'
		});

		const { data } = await service
			.from('match_runs')
			.select('logged_by_student_id, logged_by_mentor_id, points')
			.eq('id', runId)
			.single();
		expect(data?.logged_by_student_id).toBeNull();
		expect(data?.logged_by_mentor_id).toBeNull();
		expect(data?.points).toBeGreaterThan(0);

		// It reads its own team's history...
		expect((await history(boardClient, team.teamId))!.run_count).toBeGreaterThan(0);
		// ...and not the rival's.
		expect(await history(boardClient, rivalTeam.teamId)).toBeNull();
		const rivalRows = await boardClient.from('match_runs').select('id').eq('team_id', rivalTeam.teamId);
		expect(rivalRows.data).toEqual([]);
	}, 60_000);
});

describe('what a run records about the launches', () => {
	test('a launch is kept by name as well as by reference, so an edited plan does not erase it', async () => {
		const runId = await logRun(studentClient, team.teamId, [{ missionId: m01, lineIndex: 0 }]);
		const { error } = await studentClient.from('match_run_launches').insert([
			{ id: crypto.randomUUID(), run_id: runId, team_id: team.teamId, name: 'Opening run', attempted: true, sort_order: 1 },
			{ id: crypto.randomUUID(), run_id: runId, team_id: team.teamId, name: 'Second trip', attempted: false, sort_order: 2 }
		]);
		expect(error).toBeNull();

		const page = (await history(studentClient, team.teamId))!;
		const run = page.runs.find((r) => r.id === runId)!;
		// Only the ones actually attempted are counted.
		expect(run.launches_attempted).toBe(1);
		expect(run.lines_scored).toBe(1);
	}, 60_000);

	test('deleting a run takes its lines and launches with it', async () => {
		const runId = await logRun(studentClient, team.teamId, [{ missionId: m01, lineIndex: 0 }]);
		await studentClient
			.from('match_run_launches')
			.insert({ id: crypto.randomUUID(), run_id: runId, team_id: team.teamId, name: 'Only run' });

		const { data: removed, error } = await studentClient.from('match_runs').delete().eq('id', runId).select('id');
		expect(error).toBeNull();
		expect(removed).toEqual([{ id: runId }]);

		const [{ scores, launches }] = await sql<{ scores: number; launches: number }[]>`
			select
				(select count(*)::int from public.match_run_scores where run_id = ${runId}) as scores,
				(select count(*)::int from public.match_run_launches where run_id = ${runId}) as launches`;
		expect({ scores, launches }).toEqual({ scores: 0, launches: 0 });
	}, 60_000);
});
