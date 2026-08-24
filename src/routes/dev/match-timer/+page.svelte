<script lang="ts">
	/**
	 * Fixtures for the real MatchTimer component.
	 *
	 * The persist log at the bottom is the harness's reason to exist: every run
	 * the component would have queued is appended there, so ticking a scoring
	 * line and saving observably becomes a `match_run_log ... 4 lines, 60 pts`
	 * entry. That is the sentinel round trip.
	 *
	 * The mission numbers here are the REAL season list (they are the same
	 * fifteen missions 0011 seeds), because the tally the component previews
	 * has to be checkable by hand against them.
	 */
	import MatchTimer, { type LoggedRun } from '$lib/match/MatchTimer.svelte';
	import { previewPoints, type MatchMission } from '$lib/match/rules';
	import type { RunHistoryRow } from '$lib/match/types';
	import type { TeamAccent } from '$lib/console/types';
	import type { ConnectionState } from '$lib/student/queue.svelte';

	type Scenario = 'fresh' | 'season' | 'board';
	let scenario = $state<Scenario>('season');
	let connection = $state<ConnectionState>('online');
	let accent = $state<TeamAccent>('cyan');
	let log = $state<string[]>([]);

	function record(run: LoggedRun) {
		const points = previewPoints(run.lines, MISSIONS);
		log = [
			...log,
			`${log.length + 1}. match_run_log started=${run.startedAt.slice(11, 19)} ran=${run.elapsedS}s ` +
				`${run.lines.length} line${run.lines.length === 1 ? '' : 's'}, ` +
				`${run.launches.filter((l) => l.attempted).length} launch attempted, ` +
				`${points} pts${run.note ? ` note="${run.note}"` : ''}`
		];
	}

	function recordDelete(runId: string) {
		log = [...log, `${log.length + 1}. match_run_delete ${runId.slice(0, 8)}`];
	}

	const M = (
		id: string,
		code: string,
		name: string,
		pointsLabel: string,
		scoring: { label: string; points: number; bonus?: boolean }[]
	): MatchMission => ({ id, code, name, pointsLabel, scoring });

	const MISSIONS: MatchMission[] = [
		M('fx-m01', 'M01', 'Drone Survey', '20 + 10 bonus', [
			{ label: 'Drone is off the mat', points: 20 },
			{ label: 'Bonus: LiDAR map flipped AND scan marker in the survey area', points: 10, bonus: true }
		]),
		M('fx-m02', 'M02', 'Exploding Seeds', '10 each seed', [{ label: 'Each seed off the stalk', points: 10 }]),
		M('fx-m03', 'M03', 'Flip the Rock', '20 + 10 bonus', [
			{ label: 'Research flag is down', points: 20 },
			{ label: 'Bonus: rock returned to the start area', points: 10, bonus: true }
		]),
		M('fx-m04', 'M04', 'Lucky Leaves', '10, or 30 with the bonus', [
			{ label: 'One leaf removed', points: 10 },
			{ label: 'Bonus: second leaf removed AND katydid still in its original position', points: 20, bonus: true }
		]),
		M('fx-m05', 'M05', 'Reaching Roots', '10 or 20', [
			{ label: 'Plant root partially extended', points: 10 },
			{ label: 'Plant root completely extended', points: 20 }
		]),
		M('fx-m08', 'M08', 'Tangled', '30', [{ label: 'Vine touching the mat', points: 30 }]),
		M('fx-m09', 'M09', 'Research Platform', '10 + 10 + 10', [
			{ label: 'Platform raised', points: 10 },
			{ label: 'Camera trap deployed', points: 10 },
			{ label: 'Seed off the tree', points: 10 }
		]),
		M('fx-m13', 'M13', 'Keystone Species', '30', [
			{ label: 'Keystone species on the restoration platform AND young trees raised', points: 30 }
		])
	];

	const PLAN_LAUNCHES = [
		{ id: 'fx-l1', name: 'Opening run' },
		{ id: 'fx-l2', name: 'Fungus and vine' },
		{ id: 'fx-l3', name: 'Come home' }
	];

	const day = (n: number) => new Date(Date.UTC(2026, 9, n, 17, 30)).toISOString();

	const run = (
		id: string,
		startedAt: string,
		points: number,
		bestSoFar: number,
		extra: Partial<RunHistoryRow> = {}
	): RunHistoryRow => ({
		id,
		started_at: startedAt,
		elapsed_s: 148,
		points,
		note: '',
		strategy_id: 'fx-strategy',
		strategy_version: 2,
		strategy_label: null,
		best_so_far: bestSoFar,
		launches_attempted: 3,
		lines_scored: 5,
		...extra
	});

	// Newest first, the way match_run_history returns them.
	const SEASON: RunHistoryRow[] = [
		run('fx-r7', day(23), 175, 190, { note: 'Dropped the vine on the way back' }),
		run('fx-r6', day(22), 190, 190, { note: 'Best yet. Ran the new gripper.' }),
		run('fx-r5', day(21), 140, 150, {}),
		run('fx-r4', day(20), 150, 150, {}),
		run('fx-r3', day(19), 95, 110, { strategy_version: 1 }),
		run('fx-r2', day(18), 110, 110, { strategy_version: 1 }),
		run('fx-r1', day(17), 60, 60, { strategy_version: 1, launches_attempted: 2, lines_scored: 3 })
	];

	let history = $derived(scenario === 'fresh' ? [] : SEASON);
	let bestPoints = $derived(scenario === 'fresh' ? 0 : 190);
	let planLaunches = $derived(scenario === 'board' ? [] : PLAN_LAUNCHES);
	let strategy = $derived(
		scenario === 'fresh' ? null : { id: 'fx-strategy', version: 2, label: null as string | null }
	);
</script>

<svelte:head><title>Match timer harness</title></svelte:head>

<div class="harness">
	<aside class="panel">
		<h1>Match timer harness</h1>
		<p class="muted small">
			Dev only. The component below is the real <code>MatchTimer.svelte</code>; only its props are fixtures.
		</p>

		<fieldset class="grp">
			<legend>Team</legend>
			{#each [['season', 'A season behind them'], ['fresh', 'First ever run'], ['board', 'Board iPad, no plan']] as [value, label] (value)}
				<label class="opt">
					<input type="radio" name="scenario" checked={scenario === value} onchange={() => (scenario = value as Scenario)} />
					<span>{label}</span>
				</label>
			{/each}
		</fieldset>

		<fieldset class="grp">
			<legend>Connection</legend>
			{#each ['online', 'syncing', 'offline'] as value (value)}
				<label class="opt">
					<input
						type="radio"
						name="connection"
						checked={connection === value}
						onchange={() => (connection = value as ConnectionState)}
					/>
					<span>{value}</span>
				</label>
			{/each}
		</fieldset>

		<fieldset class="grp">
			<legend>Accent</legend>
			{#each ['cyan', 'chartreuse', 'magenta', 'amber'] as value (value)}
				<label class="opt">
					<input type="radio" name="accent" checked={accent === value} onchange={() => (accent = value as TeamAccent)} />
					<span>{value}</span>
				</label>
			{/each}
		</fieldset>

		<h2>Persist log</h2>
		<p class="muted small">
			Every run the component would have queued. Start the clock, stop it, tick a line, save: a line appears here.
			If it does not, the harness is rendering something that is not the real component.
		</p>
		{#if log.length === 0}
			<p class="muted">Nothing logged yet.</p>
		{:else}
			<ol class="log">
				{#each log as entry, i (i)}
					<li><code>{entry}</code></li>
				{/each}
			</ol>
			<button class="btn btn--ghost btn--small" onclick={() => (log = [])}>Clear</button>
		{/if}
	</aside>

	<main class="stage">
		<MatchTimer
			team={{ name: scenario === 'board' ? 'Green Team board' : 'Green Team', accent }}
			missions={MISSIONS}
			{planLaunches}
			{strategy}
			{history}
			{bestPoints}
			{connection}
			onLog={record}
			onDeleteRun={recordDelete}
			backHref="/dev/match-timer"
		/>
	</main>
</div>

<style>
	.harness {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-4);
		align-items: start;
	}
	.panel {
		background: var(--surface-1);
		border: 1px solid var(--boundary);
		border-radius: var(--radius-card);
		padding: var(--space-4);
		display: grid;
		gap: var(--space-3);
		align-content: start;
	}
	.grp {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-control);
		padding: var(--space-2) var(--space-3);
		display: grid;
		gap: var(--space-1);
	}
	.grp legend {
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.opt {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.25rem;
	}
	.log {
		margin: 0;
		padding-left: var(--space-4);
		display: grid;
		gap: var(--space-1);
		font-size: var(--fs-small);
	}
	.stage {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-card);
		overflow: hidden;
		min-width: 0;
	}

	@media (min-width: 64rem) {
		.harness {
			grid-template-columns: 22rem minmax(0, 1fr);
		}
	}
</style>
