<script lang="ts">
	/**
	 * Fixtures for the real StudentScreen. The clock is FROZEN so a reading of
	 * this page is stable and two runs are comparable.
	 */
	import StudentScreen from '$lib/student/StudentScreen.svelte';
	import type { BoardMeeting, TeamAccent } from '$lib/console/types';
	import type { ConnectionState } from '$lib/student/queue.svelte';
	import type { MyRole, StudentTask } from '$lib/student/types';

	// 2026-09-11 17:12 in the season's timezone: mid Role Blocks on a Friday.
	const NOW = Date.parse('2026-09-12T00:12:00.000Z');
	const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

	type Scenario = 'covering' | 'primary' | 'noRole' | 'notCheckedIn' | 'noMeeting' | 'overrun';

	let scenario = $state<Scenario>('covering');
	let connection = $state<ConnectionState>('online');
	let pendingCount = $state(0);
	let showFailure = $state(false);
	let accent = $state<TeamAccent>('magenta');

	const TASKS: StudentTask[] = [
		{
			id: 'fixture-1',
			title: 'Rebuild the arm attachment',
			detail: 'The one that keeps falling off on the way to the crate.',
			role: 'lead_builder',
			status: 'open',
			assigned_student_id: 'fixture-me',
			evidence_required: true,
			evidence_count: 0
		},
		{
			id: 'fixture-2',
			title: 'Check every axle is the right length',
			detail: null,
			role: 'lead_builder',
			status: 'open',
			assigned_student_id: null,
			evidence_required: false,
			evidence_count: 0
		},
		{
			id: 'fixture-3',
			title: 'Put the spare parts back in the bin',
			detail: null,
			role: null,
			status: 'open',
			assigned_student_id: 'fixture-other',
			evidence_required: false,
			evidence_count: 0
		},
		{
			id: 'fixture-4',
			title: 'Photograph the finished build',
			detail: null,
			role: 'lead_builder',
			status: 'open',
			assigned_student_id: 'fixture-me',
			evidence_required: true,
			evidence_count: 2
		}
	];

	const ROLES: Record<string, MyRole | null> = {
		covering: { role: 'lead_builder', tier: 'second', covering: true, primaryName: 'Diego S.' },
		primary: { role: 'lead_builder', tier: 'primary', covering: false, primaryName: 'Maya R.' },
		overrun: { role: 'lead_builder', tier: 'primary', covering: false, primaryName: 'Maya R.' },
		notCheckedIn: { role: 'lead_builder', tier: 'primary', covering: false, primaryName: 'Maya R.' },
		noMeeting: null,
		noRole: null
	};

	function meetingFor(which: Scenario): BoardMeeting | null {
		if (which === 'noMeeting') return null;
		return {
			id: 'fixture-meeting',
			kind: 'friday',
			meeting_date: '2026-09-11',
			planned_start_at: at(42),
			planned_end_at: new Date(NOW + 48 * 60_000).toISOString(),
			started_at: at(42),
			ended_at: null,
			current_phase_id: 'fixture-phase',
			phase_count: 4,
			phase: {
				id: 'fixture-phase',
				ordinal: 2,
				name: 'Role Blocks',
				planned_minutes: 60,
				started_at: which === 'overrun' ? at(68) : at(32),
				ended_at: null
			}
		};
	}

	let meeting = $derived(meetingFor(scenario));
	let myRole = $derived(ROLES[scenario] ?? null);
	let checkedIn = $derived(scenario !== 'notCheckedIn');
	let failed = $derived(
		showFailure ? [{ id: 'f1', message: 'That task needs a photo before it can be finished.' }] : []
	);

	let log = $state<string[]>([]);
	const note = (line: string) => (log = [line, ...log].slice(0, 6));
</script>

<svelte:head><title>Student screen harness</title></svelte:head>

<div class="wrap">
	<aside class="panel">
		<p class="eyebrow">Dev harness</p>
		<h1>Student screen</h1>
		<p class="muted small">
			The real <code>$lib/student/StudentScreen.svelte</code>, mounted with fixtures and a frozen clock. This route
			404s outside <code>vite dev</code>.
		</p>
		<label class="field">
			<span>Scenario</span>
			<select class="input" bind:value={scenario}>
				<option value="covering">Covering for someone</option>
				<option value="primary">Holds the job</option>
				<option value="noRole">No job yet</option>
				<option value="notCheckedIn">Not checked in</option>
				<option value="noMeeting">No meeting running</option>
				<option value="overrun">Phase running long</option>
			</select>
		</label>
		<label class="field">
			<span>Connection</span>
			<select class="input" bind:value={connection}>
				<option value="online">Online</option>
				<option value="syncing">Syncing</option>
				<option value="offline">Offline</option>
			</select>
		</label>
		<label class="field">
			<span>Writes waiting</span>
			<input class="input" type="number" min="0" max="9" bind:value={pendingCount} />
		</label>
		<label class="field">
			<span>Accent</span>
			<select class="input" bind:value={accent}>
				<option value="cyan">Cyan</option>
				<option value="chartreuse">Chartreuse</option>
				<option value="magenta">Magenta</option>
				<option value="amber">Amber</option>
			</select>
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={showFailure} />
			<span>Show a refused write</span>
		</label>
		{#if log.length}
			<h2 class="small">Callbacks</h2>
			<ul class="log">
				{#each log as line, i (line + i)}<li>{line}</li>{/each}
			</ul>
		{/if}
	</aside>

	<div class="phone">
		<StudentScreen
			team={{ name: 'Red Team', accent, joinCode: 'M4GN7A' }}
			me={{ studentId: 'fixture-me', firstName: 'Maya', lastInitial: 'R' }}
			{meeting}
			nowMs={NOW}
			{checkedIn}
			{myRole}
			tasks={TASKS}
			{connection}
			{pendingCount}
			{failed}
			onCheckIn={() => note('onCheckIn()')}
			onClaim={(id) => note(`onClaim(${id})`)}
			onDone={(id) => note(`onDone(${id})`)}
			onEvidence={(id, file, cap) => note(`onEvidence(${id}, ${file.name}, "${cap}")`)}
			onStuck={(n, t) => note(`onStuck("${n}", ${t})`)}
			onDismissFailure={(id) => note(`onDismissFailure(${id})`)}
			teamHref="#"
		/>
	</div>
</div>

<style>
	.wrap {
		display: grid;
		/* minmax(0, 1fr), not the implicit `auto`: an auto track sizes to its
		   widest item, and the phone frame below asks for a fixed 375px. At a
		   375px viewport that pushed the track 16px past the padding and the
		   PAGE scrolled sideways. Measured before this line: 16px. */
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		padding: var(--space-4);
		align-items: start;
	}
	.wrap > * {
		min-width: 0;
	}
	.panel {
		padding: var(--space-4);
		border: 1px dashed var(--boundary);
		border-radius: var(--radius-card);
		background: var(--surface-1);
	}
	.panel h1 {
		margin-bottom: var(--space-2);
	}
	.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
	}
	.check input {
		width: 1.25rem;
		height: 1.25rem;
	}
	.log {
		list-style: none;
		margin: 0;
		padding: 0;
		font-family: var(--font-mono);
		font-size: var(--fs-small);
		color: var(--text-2);
		display: grid;
		gap: 0.2rem;
	}
	/* A 375px column, so the harness shows the primary target by default even
	   on a laptop. */
	.phone {
		/* The harness frames the student runtime at its design width. On a
		   screen that IS 375px there is no room for the frame as well, so it
		   gives way rather than scrolling the page. */
		width: min(375px, 100%);
		border: 1px solid var(--boundary);
		border-radius: var(--radius-card);
		overflow: hidden;
	}
	@media (min-width: 60rem) {
		.wrap {
			grid-template-columns: 22rem 375px;
			justify-content: center;
		}
	}
</style>
