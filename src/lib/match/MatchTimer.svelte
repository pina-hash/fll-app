<script lang="ts">
	/**
	 * THE MATCH TIMER AND RUN LOG: what a team looks at while standing at the
	 * mat with a robot in their hands.
	 *
	 * READABLE ACROSS A TABLE. The countdown is the whole top of the screen and
	 * nothing competes with it. Start, Stop and Reset are 56px slabs a thumb
	 * finds without looking, because the person tapping them is watching the
	 * robot, not the phone.
	 *
	 * THE CLOCK IS LOCAL AND MONOTONIC. `performance.now()` and nothing else --
	 * see rules.ts. It does not ask the server what time it is, it does not
	 * pause when the tab loses focus, and a clock correction mid-run cannot
	 * make it jump.
	 *
	 * LOGGING IS SEPARATE FROM TIMING, ON PURPOSE. The run ends, then the team
	 * ticks what they scored. Forcing the two together would mean either a
	 * child scoring with one hand while the robot is moving, or a run that
	 * never gets logged because the moment passed. Stopping the clock leaves
	 * the elapsed time on screen until it is logged or thrown away.
	 *
	 * PURE PROPS, NO DATA ACCESS. Nothing here touches Supabase, the session or
	 * the write queue: the page above owns all three, and /dev/match-timer
	 * mounts THIS component with fixtures. That is what makes the harness a
	 * test of the real screen rather than of a copy.
	 */
	import {
		formatMatchClock,
		previewPoints,
		MATCH_SECONDS,
		MATCH_WARN_SECONDS,
		type MatchMission,
		type ScoredLine
	} from './rules';
	import type { MatchRunLaunchDraft, MatchRunScoreDraft } from './ops';
	import type { RunHistoryRow } from './types';
	import type { TeamAccent } from '$lib/console/types';
	import type { ConnectionState } from '$lib/student/queue.svelte';

	export interface LoggedRun {
		startedAt: string;
		elapsedS: number;
		note: string;
		launches: MatchRunLaunchDraft[];
		lines: MatchRunScoreDraft[];
	}

	interface Props {
		team: { name: string; accent: TeamAccent };
		missions: MatchMission[];
		/** The current strategy's launches, if the team has a plan. */
		planLaunches?: { id: string; name: string }[];
		strategy?: { id: string; version: number; label: string | null } | null;
		history?: RunHistoryRow[];
		bestPoints?: number;
		connection?: ConnectionState;
		pendingCount?: number;
		/** False for a viewer who may look but not write (nobody, today: kept honest anyway). */
		canLog?: boolean;
		onLog?: (run: LoggedRun) => void;
		onDeleteRun?: (runId: string) => void;
		backHref?: string;
	}

	let {
		team,
		missions,
		planLaunches = [],
		strategy = null,
		history = [],
		bestPoints = 0,
		connection = 'online',
		pendingCount = 0,
		canLog = true,
		onLog,
		onDeleteRun,
		backHref = '/app/me'
	}: Props = $props();

	// --- the clock -----------------------------------------------------------
	type Phase = 'ready' | 'running' | 'stopped';
	let phase = $state<Phase>('ready');
	let elapsedMs = $state(0);
	let startedAtIso = $state('');
	let startedMonotonic = 0;
	let ticker: ReturnType<typeof setInterval> | null = null;

	let remaining = $derived(Math.max(0, MATCH_SECONDS - elapsedMs / 1000));
	let overrun = $derived(elapsedMs / 1000 > MATCH_SECONDS);
	let warning = $derived(!overrun && remaining <= MATCH_WARN_SECONDS && phase === 'running');

	function tick() {
		elapsedMs = performance.now() - startedMonotonic;
	}

	function start() {
		if (phase === 'running') return;
		startedMonotonic = performance.now();
		// The wall-clock stamp is taken ONCE, here, and travels with the run.
		// The measurement itself is the monotonic delta above.
		startedAtIso = new Date().toISOString();
		elapsedMs = 0;
		phase = 'running';
		ticker = setInterval(tick, 100);
	}

	function stop() {
		if (phase !== 'running') return;
		tick();
		if (ticker) clearInterval(ticker);
		ticker = null;
		phase = 'stopped';
	}

	function reset() {
		if (ticker) clearInterval(ticker);
		ticker = null;
		elapsedMs = 0;
		phase = 'ready';
		sheetOpen = false;
		clearDraft();
	}

	$effect(() => () => {
		if (ticker) clearInterval(ticker);
	});

	// --- the run being logged ------------------------------------------------
	let sheetOpen = $state(false);
	let note = $state('');
	let attempted = $state<Record<string, boolean>>({});
	let extraLaunches = $state<string[]>([]);
	/** `${missionId}:${lineIndex}` -> how many times. Absent means not scored. */
	let scored = $state<Record<string, number>>({});
	let openMission = $state<string | null>(null);

	function clearDraft() {
		note = '';
		attempted = {};
		extraLaunches = [];
		scored = {};
		openMission = null;
	}

	const key = (missionId: string, lineIndex: number) => `${missionId}:${lineIndex}`;

	function toggleLine(missionId: string, lineIndex: number) {
		const k = key(missionId, lineIndex);
		const next = { ...scored };
		if (next[k]) delete next[k];
		else next[k] = 1;
		scored = next;
	}

	function bump(missionId: string, lineIndex: number, by: number) {
		const k = key(missionId, lineIndex);
		const current = scored[k] ?? 0;
		const value = Math.min(20, Math.max(0, current + by));
		const next = { ...scored };
		if (value === 0) delete next[k];
		else next[k] = value;
		scored = next;
	}

	let lines = $derived.by<ScoredLine[]>(() =>
		Object.entries(scored).map(([k, quantity]) => {
			const cut = k.lastIndexOf(':');
			return { missionId: k.slice(0, cut), lineIndex: Number(k.slice(cut + 1)), quantity };
		})
	);

	let tally = $derived(previewPoints(lines, missions));
	let scoredMissionCount = $derived(new Set(lines.map((l) => l.missionId)).size);

	function missionTally(mission: MatchMission): number {
		return previewPoints(
			lines.filter((l) => l.missionId === mission.id),
			missions
		);
	}

	function save() {
		if (!canLog) return;
		const launches: MatchRunLaunchDraft[] = [
			...planLaunches.map((l, i) => ({
				id: crypto.randomUUID(),
				launchId: l.id,
				name: l.name || `Launch ${i + 1}`,
				attempted: attempted[l.id] === true,
				sortOrder: i + 1
			})),
			...extraLaunches.map((name, i) => ({
				id: crypto.randomUUID(),
				launchId: null,
				name,
				attempted: true,
				sortOrder: planLaunches.length + i + 1
			}))
		];
		onLog?.({
			startedAt: startedAtIso || new Date().toISOString(),
			elapsedS: Math.round(elapsedMs / 1000),
			note: note.trim(),
			launches,
			lines: lines.map((l) => ({
				id: crypto.randomUUID(),
				missionId: l.missionId,
				lineIndex: l.lineIndex,
				quantity: l.quantity
			}))
		});
		sheetOpen = false;
		reset();
	}

	function addLaunch() {
		extraLaunches = [...extraLaunches, `Launch ${planLaunches.length + extraLaunches.length + 1}`];
	}

	// --- the trendline -------------------------------------------------------
	// Oldest to newest, which is the direction a trend reads in. The RPC hands
	// them back newest first because that is the direction a LIST reads in.
	let trend = $derived([...history].reverse());

	const CHART_W = 320;
	const CHART_H = 90;

	let chart = $derived.by(() => {
		if (trend.length === 0) return null;
		const max = Math.max(bestPoints, ...trend.map((r) => r.points), 10);
		const step = trend.length > 1 ? CHART_W / (trend.length - 1) : 0;
		const y = (points: number) => CHART_H - (points / max) * (CHART_H - 8) - 4;
		const at = (i: number) => (trend.length > 1 ? i * step : CHART_W / 2);
		return {
			max,
			best: trend.map((r, i) => `${at(i)},${y(r.best_so_far)}`).join(' '),
			runs: trend.map((r, i) => ({ x: at(i), y: y(r.points), points: r.points }))
		};
	});

	function dateLabel(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
	function timeLabel(iso: string): string {
		return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
	}
</script>

<div class="mt" data-accent={team.accent}>
	<header class="mt__top">
		<a class="mt__back" href={backHref}>Back</a>
		<span class="mt__team">{team.name}</span>
		{#if connection !== 'online' || pendingCount > 0}
			<span class="mt__sync" role="status">
				{connection === 'offline' ? 'Saved on this phone' : 'Saving'}{pendingCount > 0
					? ` (${pendingCount})`
					: ''}
			</span>
		{/if}
	</header>

	<section class="clock" class:clock--warn={warning} class:clock--over={overrun} aria-live="off">
		<p class="clock__label">{phase === 'ready' ? 'Match' : overrun ? 'Over time' : 'Time left'}</p>
		<p class="clock__value">{formatMatchClock(overrun ? elapsedMs / 1000 - MATCH_SECONDS : remaining)}</p>
		<p class="clock__sub">
			{#if phase === 'ready'}
				2:30 on the clock
			{:else}
				Ran {formatMatchClock(elapsedMs / 1000)}
			{/if}
		</p>
	</section>

	<div class="controls">
		{#if phase === 'running'}
			<button class="slab slab--stop" type="button" onclick={stop}>Stop</button>
		{:else}
			<button class="slab slab--go" type="button" onclick={start}>
				{phase === 'stopped' ? 'Run again' : 'Start'}
			</button>
		{/if}
		<button class="slab slab--quiet" type="button" onclick={reset} disabled={phase === 'ready'}>
			Reset
		</button>
	</div>

	{#if phase === 'stopped' && !sheetOpen}
		<section class="card logcard">
			<h2>How did that go?</h2>
			<p class="muted">Tick what you scored. It only takes a minute, and it is how the number goes up.</p>
			<button class="slab slab--go" type="button" onclick={() => (sheetOpen = true)} disabled={!canLog}>
				Log this run
			</button>
			{#if !canLog}
				<p class="muted small">This screen can watch the clock but not save runs.</p>
			{/if}
		</section>
	{/if}

	{#if sheetOpen}
		<section class="card sheet" aria-label="Log this run">
			<div class="sheet__head">
				<div>
					<h2>What did you score?</h2>
					<p class="muted small">
						{scoredMissionCount} mission{scoredMissionCount === 1 ? '' : 's'} · ran {formatMatchClock(
							elapsedMs / 1000
						)}
					</p>
				</div>
				<p class="tally"><span class="tally__n">{tally}</span><span class="tally__u">points</span></p>
			</div>
			<p class="muted small">
				This total is what these ticks are worth. The saved score is worked out again on the server from the same
				mission list, so nothing here can inflate it.
			</p>

			{#if planLaunches.length > 0 || extraLaunches.length > 0}
				<h3>Launches</h3>
				<ul class="launches">
					{#each planLaunches as launch (launch.id)}
						<li>
							<label class="check">
								<input
									type="checkbox"
									checked={attempted[launch.id] === true}
									onchange={(e) =>
										(attempted = { ...attempted, [launch.id]: e.currentTarget.checked })}
								/>
								<span>{launch.name || 'Launch'}</span>
							</label>
						</li>
					{/each}
					{#each extraLaunches as name, i (i)}
						<li>
							<label class="check check--extra">
								<input type="checkbox" checked disabled />
								<input
									class="input"
									value={name}
									maxlength="120"
									aria-label="Launch name"
									onchange={(e) => {
										const next = [...extraLaunches];
										next[i] = e.currentTarget.value;
										extraLaunches = next;
									}}
								/>
							</label>
						</li>
					{/each}
				</ul>
			{/if}
			<button class="btn btn--ghost" type="button" onclick={addLaunch}>Add a launch</button>

			<h3>Missions</h3>
			<ul class="missions">
				{#each missions as mission (mission.id)}
					{@const mine = missionTally(mission)}
					<li class="mission" class:mission--scored={mine > 0}>
						<button
							class="mission__head"
							type="button"
							aria-expanded={openMission === mission.id}
							onclick={() => (openMission = openMission === mission.id ? null : mission.id)}
						>
							<span class="mission__code">{mission.code}</span>
							<span class="mission__name">{mission.name}</span>
							<span class="mission__points">{mine > 0 ? `${mine} pts` : mission.pointsLabel}</span>
						</button>
						{#if openMission === mission.id}
							<ul class="lines">
								{#each mission.scoring as line, index (index)}
									{@const count = scored[key(mission.id, index)] ?? 0}
									<li class="line">
										<label class="check">
											<input
												type="checkbox"
												checked={count > 0}
												onchange={() => toggleLine(mission.id, index)}
											/>
											<span>
												{line.label}
												<span class="line__pts">{line.points} pts{line.bonus ? ' bonus' : ''}</span>
											</span>
										</label>
										{#if count > 0}
											<div class="qty">
												<button
													class="qty__btn"
													type="button"
													aria-label={`One fewer ${line.label}`}
													onclick={() => bump(mission.id, index, -1)}>-</button
												>
												<span class="qty__n">{count}</span>
												<button
													class="qty__btn"
													type="button"
													aria-label={`One more ${line.label}`}
													onclick={() => bump(mission.id, index, 1)}>+</button
												>
											</div>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</li>
				{/each}
			</ul>

			<label class="field">
				<span>Note</span>
				<input class="input" bind:value={note} maxlength="500" placeholder="What happened?" />
			</label>

			{#if strategy}
				<p class="muted small">
					Saved against plan v{strategy.version}{strategy.label ? ` (${strategy.label})` : ''}, so you can see
					later whether it beat the last one.
				</p>
			{/if}

			<div class="sheet__actions">
				<button class="slab slab--go" type="button" onclick={save}>Save this run</button>
				<button class="btn btn--ghost" type="button" onclick={() => (sheetOpen = false)}>Not now</button>
			</div>
		</section>
	{/if}

	<section class="card history">
		<div class="history__head">
			<h2>Our runs</h2>
			<p class="best"><span class="best__n">{bestPoints}</span><span class="best__u">best</span></p>
		</div>

		{#if chart}
			<svg
				class="chart"
				viewBox={`0 0 ${CHART_W} ${CHART_H}`}
				role="img"
				aria-label={`Best score so far over ${trend.length} runs, now ${bestPoints} points`}
				preserveAspectRatio="none"
			>
				<polyline class="chart__best" points={chart.best} />
				{#each chart.runs as point, i (i)}
					<circle class="chart__dot" cx={point.x} cy={point.y} r="3" />
				{/each}
			</svg>
			<p class="muted small">
				The line is the best score so far. Every dot is one run. It only ever goes up.
			</p>
		{:else}
			<p class="muted">No runs yet. Start the clock and log the first one.</p>
		{/if}

		<ul class="runs">
			{#each history as run (run.id)}
				<li class="run" class:run--best={run.points === bestPoints && bestPoints > 0}>
					<span class="run__points">{run.points}</span>
					<span class="run__when">
						{dateLabel(run.started_at)} · {timeLabel(run.started_at)}
						{#if run.strategy_version}· plan v{run.strategy_version}{/if}
					</span>
					<span class="run__meta muted small">
						{run.lines_scored} line{run.lines_scored === 1 ? '' : 's'}
						{#if run.launches_attempted > 0}· {run.launches_attempted} launch{run.launches_attempted === 1
								? ''
								: 'es'}{/if}
						{#if run.elapsed_s !== null}· {formatMatchClock(run.elapsed_s)}{/if}
					</span>
					{#if run.note}<span class="run__note">{run.note}</span>{/if}
					{#if onDeleteRun && canLog}
						<button class="btn btn--ghost btn--small run__x" type="button" onclick={() => onDeleteRun(run.id)}>
							Remove
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
</div>

<style>
	.mt {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-3) var(--space-6);
		background:
			radial-gradient(120% 60% at 50% 0%, var(--team-accent-wash), transparent 70%),
			var(--surface-0);
	}
	.mt__top {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.mt__back {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-control);
		border: 2px solid var(--boundary);
		color: var(--text-1);
		text-decoration: none;
		font-weight: var(--fw-bold);
	}
	.mt__team {
		font-family: var(--font-display);
		font-size: var(--fs-h3);
		font-weight: var(--fw-black);
		color: var(--team-accent);
	}
	.mt__sync {
		margin-left: auto;
		font-size: var(--fs-small);
		color: var(--warning);
		font-weight: var(--fw-bold);
	}

	/* THE COUNTDOWN. Nothing else on the screen competes with it. */
	.clock {
		text-align: center;
		padding: var(--space-4) var(--space-3);
		border-radius: var(--radius-card);
		border: 2px solid var(--boundary);
		background: var(--surface-1);
	}
	.clock__label,
	.clock__sub {
		margin: 0;
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.clock__value {
		margin: var(--space-2) 0;
		font-family: var(--font-mono);
		/* Readable across a table, and still readable on a 375px phone. */
		font-size: clamp(4.5rem, 30vw, 9rem);
		font-weight: var(--fw-black);
		line-height: 0.9;
		letter-spacing: -0.02em;
		color: var(--glow-green);
		font-variant-numeric: tabular-nums;
	}
	.clock--warn {
		border-color: var(--amber);
	}
	.clock--warn .clock__value {
		color: var(--amber);
	}
	.clock--over {
		border-color: var(--coral);
	}
	.clock--over .clock__value {
		color: var(--coral);
	}

	.controls {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: var(--space-3);
	}
	.slab {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 3.5rem;
		padding: 0 var(--space-4);
		border-radius: var(--radius-tile);
		border: 2px solid transparent;
		font: inherit;
		font-size: var(--fs-h3);
		font-weight: var(--fw-black);
		cursor: pointer;
		width: 100%;
	}
	.slab:disabled {
		opacity: 0.5;
	}
	.slab--go {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.slab--stop {
		background: var(--amber);
		color: var(--surface-0);
	}
	.slab--quiet {
		background: transparent;
		color: var(--text-2);
		border-color: var(--boundary);
	}

	.logcard {
		display: grid;
		gap: var(--space-2);
	}

	.sheet {
		display: grid;
		gap: var(--space-3);
	}
	.sheet__head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-3);
	}
	.sheet__head h2 {
		margin-bottom: var(--space-1);
	}
	.tally,
	.best {
		margin: 0;
		display: grid;
		justify-items: end;
	}
	.tally__n,
	.best__n {
		font-family: var(--font-mono);
		font-size: var(--fs-h1);
		font-weight: var(--fw-black);
		color: var(--team-accent);
		line-height: 1;
	}
	.tally__u,
	.best__u {
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.sheet__actions {
		display: grid;
		gap: var(--space-2);
	}

	.launches,
	.missions,
	.lines,
	.runs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}

	.check {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 3.5rem;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--boundary);
		background: var(--surface-2);
		cursor: pointer;
	}
	.check input[type='checkbox'] {
		width: 1.75rem;
		height: 1.75rem;
		accent-color: var(--glow-green);
		flex: none;
	}
	.check--extra {
		gap: var(--space-2);
	}

	.mission {
		border-radius: var(--radius-control);
		border: 1px solid var(--boundary);
		background: var(--surface-2);
		overflow: hidden;
	}
	.mission--scored {
		border-color: var(--team-accent);
	}
	.mission__head {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		min-height: 3.5rem;
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		color: var(--text-body);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.mission__code {
		font-family: var(--font-mono);
		font-weight: var(--fw-bold);
		color: var(--text-3);
	}
	.mission__name {
		font-weight: var(--fw-bold);
	}
	.mission__points {
		font-size: var(--fs-small);
		color: var(--team-accent);
		white-space: nowrap;
	}
	.lines {
		padding: 0 var(--space-3) var(--space-3);
	}
	.line {
		display: grid;
		gap: var(--space-2);
	}
	.line__pts {
		display: block;
		font-size: var(--fs-small);
		color: var(--text-3);
	}
	.qty {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-3);
	}
	.qty__btn {
		min-width: 3rem;
		min-height: 2.75rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--boundary);
		background: var(--surface-1);
		color: var(--text-body);
		font: inherit;
		font-size: var(--fs-h3);
		font-weight: var(--fw-black);
		cursor: pointer;
	}
	.qty__n {
		font-family: var(--font-mono);
		font-size: var(--fs-h3);
		font-weight: var(--fw-bold);
		min-width: 2ch;
		text-align: center;
	}

	.history__head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-3);
	}
	.chart {
		width: 100%;
		height: 5.5rem;
		display: block;
		margin-bottom: var(--space-2);
	}
	.chart__best {
		fill: none;
		stroke: var(--team-accent);
		stroke-width: 2;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}
	.chart__dot {
		fill: var(--glow-cyan);
	}

	.run {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-areas: 'pts when' 'pts meta' 'note note' 'x x';
		align-items: center;
		column-gap: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--hairline);
		background: var(--surface-2);
	}
	.run--best {
		border-color: var(--team-accent);
	}
	.run__points {
		grid-area: pts;
		font-family: var(--font-mono);
		font-size: var(--fs-h2);
		font-weight: var(--fw-black);
		color: var(--team-accent);
		min-width: 3ch;
	}
	.run__when {
		grid-area: when;
		font-weight: var(--fw-bold);
	}
	.run__meta {
		grid-area: meta;
	}
	.run__note {
		grid-area: note;
		margin-top: var(--space-2);
		color: var(--text-2);
	}
	.run__x {
		grid-area: x;
		justify-self: start;
		margin-top: var(--space-2);
	}

	/* Desktop and the team board iPad in landscape: the clock and the log sit
	   side by side so neither has to be scrolled to. */
	@media (min-width: 48rem) {
		.mt {
			padding: var(--space-4) var(--space-5) var(--space-6);
		}
		.controls {
			grid-template-columns: 1fr 1fr;
			max-width: 32rem;
		}
		.sheet__actions {
			grid-template-columns: auto auto;
			justify-content: start;
		}
	}
</style>
