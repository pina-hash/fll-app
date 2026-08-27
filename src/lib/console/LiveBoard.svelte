<script lang="ts">
	/**
	 * THE LIVE BOARD. Phone-first: this is the surface a mentor reads while
	 * walking between four tables holding a phone in one hand, so it has to be
	 * excellent at 375px and merely correct at 1440px.
	 *
	 * PURE PROPS, NO DATA ACCESS. Nothing in here touches Supabase, the session
	 * or the clock: the page above it owns the realtime subscription and the
	 * server-corrected time, and the dev harness at /dev/live-board mounts THIS
	 * component with a fixture. That is what makes the harness a test of the
	 * real board rather than of a copy of its markup.
	 *
	 * The order of `snapshot.teams` is the database's (0009 sorts by open
	 * blockers, then unfilled roles, then idle time). It is deliberately not
	 * re-sorted here: two sort implementations would drift.
	 */
	import { formatClock, formatSince, phaseClock } from './clock';
	import { ROLE_SHORT, type BoardSnapshot } from './types';

	interface Props {
		snapshot: BoardSnapshot;
		/** Server-corrected wall clock in milliseconds. */
		nowMs: number;
		connection?: 'live' | 'reconnecting' | 'offline';
		/** Where a team card points. The harness passes a no-op. */
		teamHref?: (teamId: string) => string;
	}

	let {
		snapshot,
		nowMs,
		connection = 'live',
		teamHref = (teamId: string) => `/app/board/${teamId}`
	}: Props = $props();

	let meeting = $derived(snapshot.meeting);
	let phase = $derived(meeting?.phase ?? null);
	let clock = $derived(phaseClock(phase, nowMs));
	let running = $derived(Boolean(meeting?.started_at && !meeting?.ended_at));

	const connectionLabel = {
		live: 'Live',
		reconnecting: 'Reconnecting',
		offline: 'Offline'
	} as const;

	function needsAttention(team: BoardSnapshot['teams'][number]): boolean {
		return team.open_blockers > 0;
	}
</script>

<section class="board" aria-label="Live board">
	<header class="board__phase" data-state={running ? 'running' : 'idle'}>
		{#if !meeting}
			<p class="board__phase-name">No meeting today</p>
			<p class="board__phase-sub muted small">Start one from Meeting control.</p>
		{:else if !running && !meeting.ended_at}
			<p class="board__phase-name">{meeting.kind === 'saturday' ? 'Saturday' : 'Friday'} session</p>
			<p class="board__phase-sub muted small">Not started yet.</p>
		{:else if meeting.ended_at}
			<p class="board__phase-name">Session ended</p>
			<p class="board__phase-sub muted small">Numbers below are the final ones.</p>
		{:else if phase && clock}
			<div class="board__phase-line">
				<p class="board__phase-name">
					{phase.name}
					<span class="muted small">{phase.ordinal} of {meeting.phase_count}</span>
				</p>
				<p class="board__clock" class:board__clock--over={clock.overrun} aria-live="off">
					{formatClock(clock.remainingMs)}
				</p>
			</div>
			<div
				class="board__bar"
				class:board__bar--over={clock.overrun}
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={phase.planned_minutes}
				aria-valuenow={Math.round(clock.elapsedMs / 60000)}
				aria-label="{phase.name} progress"
			>
				<span style:width="{clock.fraction * 100}%"></span>
			</div>
			<p class="board__phase-sub muted small">
				{#if clock.overrun}
					Over by {formatClock(clock.remainingMs).slice(1)} of {phase.planned_minutes} min. Advance when you are ready.
				{:else}
					{phase.planned_minutes} min planned.
				{/if}
			</p>
		{:else}
			<p class="board__phase-name">Session running</p>
			<p class="board__phase-sub muted small">No phase selected.</p>
		{/if}

		<p class="board__conn" data-connection={connection}>
			<span class="board__conn-dot" aria-hidden="true"></span>
			{connectionLabel[connection]}
		</p>
	</header>

	{#if snapshot.teams.length === 0}
		<p class="muted">No teams yet.</p>
	{:else}
		<ul class="board__teams">
			{#each snapshot.teams as team (team.team_id)}
				<li>
					<a
						class="tcard"
						class:tcard--loud={needsAttention(team)}
						data-accent={team.accent}
						href={teamHref(team.team_id)}
					>
						<span class="tcard__head">
							<span class="tcard__name">{team.name}</span>
							{#if team.fll_team_number}
								<span class="tcard__num muted small">#{team.fll_team_number}</span>
							{/if}
						</span>

						<span class="tcard__stats">
							<span class="stat">
								<span class="stat__value">{team.present_count}<span class="stat__of">/{team.roster_size}</span></span>
								<span class="stat__label">here</span>
							</span>
							<span class="stat">
								<span class="stat__value">{team.tasks_closed}<span class="stat__of">/{team.tasks_opened}</span></span>
								<span class="stat__label">done</span>
							</span>
							<span class="stat" class:stat--alarm={team.open_blockers > 0}>
								<span class="stat__value">{team.open_blockers}</span>
								<span class="stat__label">blocked</span>
							</span>
							<span class="stat" class:stat--warn={team.roles_unfilled > 0}>
								<span class="stat__value">{team.roles_unfilled}</span>
								<span class="stat__label">no one</span>
							</span>
						</span>

						<span class="tcard__foot small">
							{#if team.open_blockers > 0}
								<span class="tcard__flag tcard__flag--alarm"
									>{team.open_blockers} blocker{team.open_blockers === 1 ? '' : 's'} waiting</span
								>
							{:else if team.roles_unfilled > 0}
								<span class="tcard__flag tcard__flag--warn"
									>{team.roles_unfilled} role{team.roles_unfilled === 1 ? '' : 's'} with nobody in the seat</span
								>
							{:else}
								<span class="muted">All five roles covered</span>
							{/if}
							<span class="muted">Last close {formatSince(team.last_task_closed_at, nowMs)}</span>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	<p class="muted small board__legend">
		Sorted by who needs you most: blockers first, then roles with nobody in the seat, then the team that has been
		quiet longest. Roles are {Object.values(ROLE_SHORT).join(', ')}.
	</p>
</section>

<style>
	.board {
		display: grid;
		gap: var(--space-4);
	}

	/* --- the phase strip: pinned, because it is the thing being checked ---- */
	.board__phase {
		position: sticky;
		top: 0;
		z-index: 2;
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--boundary);
		border-radius: var(--radius-card);
		background: var(--surface-1);
		box-shadow: var(--shadow-card);
	}
	.board__phase[data-state='running'] {
		border-color: var(--success);
	}
	.board__phase-line {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.board__phase-name {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--fs-h2);
		font-weight: var(--fw-bold);
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.board__phase-sub {
		margin: 0;
	}
	.board__clock {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--fs-h1);
		font-weight: var(--fw-bold);
		font-variant-numeric: tabular-nums;
		color: var(--text-1);
	}
	.board__clock--over {
		color: var(--warning);
	}
	.board__bar {
		height: 0.5rem;
		border-radius: 999px;
		background: var(--surface-2);
		border: 1px solid var(--hairline);
		overflow: hidden;
	}
	.board__bar span {
		display: block;
		height: 100%;
		background: var(--success);
	}
	.board__bar--over span {
		background: var(--warning);
	}

	.board__conn {
		margin: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.board__conn-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 999px;
		background: var(--success);
	}
	.board__conn[data-connection='reconnecting'] {
		color: var(--warning);
	}
	.board__conn[data-connection='reconnecting'] .board__conn-dot {
		background: var(--warning);
	}
	.board__conn[data-connection='offline'] {
		color: var(--danger-text);
	}
	.board__conn[data-connection='offline'] .board__conn-dot {
		background: var(--danger);
	}

	/* --- team cards -------------------------------------------------------- */
	.board__teams {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-3);
	}

	.tcard {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-4);
		border-radius: var(--radius-card);
		border: 1px solid var(--boundary);
		border-left: 6px solid var(--team-accent);
		background: linear-gradient(180deg, var(--team-accent-wash), transparent 70%), var(--surface-1);
		color: var(--text-1);
		text-decoration: none;
		min-height: 8rem;
	}
	.tcard--loud {
		border-color: var(--warning);
		border-left-color: var(--team-accent);
		box-shadow: 0 0 0 1px var(--warning) inset;
	}
	.tcard__head {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}
	.tcard__name {
		font-family: var(--font-display);
		font-size: var(--fs-h2);
		font-weight: var(--fw-black);
		color: var(--team-accent);
	}
	.tcard__num {
		font-family: var(--font-mono);
	}

	.tcard__stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--space-2);
	}
	.stat {
		display: grid;
		justify-items: center;
		gap: 0.125rem;
		padding: var(--space-2) 0;
		border-radius: var(--radius-control);
		background: var(--surface-2);
	}
	.stat__value {
		font-family: var(--font-mono);
		font-size: var(--fs-h2);
		font-weight: var(--fw-bold);
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}
	.stat__of {
		font-size: var(--fs-small);
		color: var(--text-3);
	}
	.stat__label {
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.stat--alarm {
		background: var(--danger-wash);
	}
	.stat--alarm .stat__value {
		color: var(--danger-text);
	}
	.stat--warn {
		background: var(--warning-wash);
	}
	.stat--warn .stat__value {
		color: var(--warning);
	}

	.tcard__foot {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.tcard__flag--alarm {
		color: var(--danger-text);
		font-weight: var(--fw-bold);
	}
	.tcard__flag--warn {
		color: var(--warning);
		font-weight: var(--fw-semibold);
	}

	.board__legend {
		margin: 0;
	}

	/* A blocked card breathes, so it is findable without reading. Gated by the
	   media query, as every animation in this repo is.

	   IT BREATHES ITS RULE, NOT A HALO. The outer half of this used to be a
	   1.5rem amber glow in a hard-coded rgba, which is the bioluminescent
	   theme's last survivor on the console and the one thing the FIRST
	   guidelines are most explicit about not putting near a mark. The inset
	   rule thickens instead: same "look here" at a glance, no light spilling
	   onto the page, and it reads on both grounds because --warning is a
	   token that reverses with them. */
	@media (prefers-reduced-motion: no-preference) {
		.tcard--loud {
			animation: tcard-loud 2.6s ease-in-out infinite;
		}
		@keyframes tcard-loud {
			0%,
			100% {
				box-shadow: 0 0 0 1px var(--warning) inset;
			}
			50% {
				box-shadow: 0 0 0 4px var(--warning) inset;
			}
		}
	}

	/* --- desktop: the same board, wider. Phone is the priority; this end only
	       has to be correct. ---------------------------------------------- */
	@media (min-width: 52rem) {
		.board__teams {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.board__phase {
			padding: var(--space-4) var(--space-5);
		}
	}
	@media (min-width: 80rem) {
		.board__teams {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
</style>
