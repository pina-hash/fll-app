<script lang="ts">
	/**
	 * Fixtures for the real LiveBoard component. Every number here is chosen to
	 * put the board into a state that is awkward to reach against a live
	 * database: an overrunning phase, a team with blockers, a team with nobody
	 * in two seats, a team that has closed nothing all session.
	 *
	 * The clock is FROZEN (`nowMs` is a constant offset from the fixture's
	 * timestamps, not Date.now()), so a screenshot of this page is stable and
	 * two runs are comparable.
	 */
	import LiveBoard from '$lib/console/LiveBoard.svelte';
	import type { ConnectionState } from '$lib/console/live.svelte';
	import type { BoardSnapshot } from '$lib/console/types';

	// A fixed instant so the harness never drifts: 2026-09-11 17:12 in the
	// season's timezone, mid Role Blocks on a Friday.
	const NOW = Date.parse('2026-09-12T00:12:00.000Z');
	const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

	type Scenario = 'running' | 'overrun' | 'notStarted' | 'noMeeting';

	let scenario = $state<Scenario>('overrun');
	let connection = $state<ConnectionState>('live');

	const TEAMS: BoardSnapshot['teams'] = [
		{
			team_id: 'fixture-red',
			name: 'Red Team',
			join_code: 'M4GN7A',
			accent: 'magenta',
			fll_team_number: 61234,
			roster_size: 7,
			present_count: 5,
			tasks_opened: 6,
			tasks_closed: 1,
			tasks_open_now: 5,
			open_blockers: 2,
			roles_unfilled: 1,
			roles_without_second: 2,
			last_task_closed_at: at(34)
		},
		{
			team_id: 'fixture-green',
			name: 'Green Team',
			join_code: 'CH4RT2',
			accent: 'lime',
			fll_team_number: null,
			roster_size: 6,
			present_count: 3,
			tasks_opened: 5,
			tasks_closed: 0,
			tasks_open_now: 5,
			open_blockers: 0,
			roles_unfilled: 3,
			roles_without_second: 4,
			last_task_closed_at: null
		},
		{
			team_id: 'fixture-blue',
			name: 'Blue Team',
			join_code: 'CY4N88',
			accent: 'teal',
			fll_team_number: 61236,
			roster_size: 6,
			present_count: 6,
			tasks_opened: 5,
			tasks_closed: 4,
			tasks_open_now: 1,
			open_blockers: 0,
			roles_unfilled: 0,
			roles_without_second: 0,
			last_task_closed_at: at(3)
		},
		{
			team_id: 'fixture-gold',
			name: 'Gold Team',
			join_code: '4MB3R9',
			accent: 'orange',
			fll_team_number: 61237,
			roster_size: 8,
			present_count: 7,
			tasks_opened: 4,
			tasks_closed: 2,
			tasks_open_now: 2,
			open_blockers: 0,
			roles_unfilled: 0,
			roles_without_second: 1,
			last_task_closed_at: at(11)
		}
	];

	function snapshotFor(which: Scenario): BoardSnapshot {
		const base = {
			server_now: new Date(NOW).toISOString(),
			window_from: at(42),
			window_to: new Date(NOW).toISOString(),
			teams: TEAMS
		};
		if (which === 'noMeeting') return { ...base, meeting: null };

		const meeting = {
			id: 'fixture-meeting',
			kind: 'friday' as const,
			meeting_date: '2026-09-11',
			planned_start_at: at(42),
			planned_end_at: new Date(NOW + 48 * 60_000).toISOString(),
			started_at: which === 'notStarted' ? null : at(42),
			ended_at: null,
			current_phase_id: which === 'notStarted' ? null : 'fixture-phase',
			phase_count: 4,
			phase:
				which === 'notStarted'
					? null
					: {
							id: 'fixture-phase',
							ordinal: 2,
							name: 'Role Blocks',
							planned_minutes: 60,
							// 32 minutes in of 60 when running; 68 minutes in when overrunning.
							started_at: which === 'overrun' ? at(68) : at(32),
							ended_at: null
						}
		};
		return { ...base, meeting };
	}

	let snapshot = $derived(snapshotFor(scenario));
</script>

<svelte:head><title>Live board harness</title></svelte:head>

<div class="harness">
	<header class="harness__bar">
		<p class="eyebrow">Dev harness</p>
		<h1>Live board</h1>
		<p class="muted small">
			The real <code>$lib/console/LiveBoard.svelte</code>, mounted with fixtures and a frozen clock. This route 404s
			outside <code>vite dev</code>. Resize the window to check 375px and 1440px.
		</p>
		<div class="harness__controls">
			<label class="field">
				<span>Scenario</span>
				<select class="input" bind:value={scenario}>
					<option value="overrun">Phase running long</option>
					<option value="running">Phase on time</option>
					<option value="notStarted">Meeting not started</option>
					<option value="noMeeting">No meeting today</option>
				</select>
			</label>
			<label class="field">
				<span>Connection</span>
				<select class="input" bind:value={connection}>
					<option value="live">Live</option>
					<option value="reconnecting">Reconnecting</option>
					<option value="offline">Offline</option>
				</select>
			</label>
		</div>
	</header>

	<LiveBoard {snapshot} nowMs={NOW} {connection} teamHref={() => '#'} />
</div>

<style>
	.harness {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-4);
		max-width: 96rem;
		margin: 0 auto;
	}
	.harness__bar {
		padding: var(--space-4);
		border: 1px dashed var(--boundary);
		border-radius: var(--radius-card);
		background: var(--surface-1);
	}
	.harness__bar h1 {
		margin-bottom: var(--space-2);
	}
	.harness__controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		margin-top: var(--space-3);
	}
</style>
