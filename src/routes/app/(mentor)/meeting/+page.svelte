<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { formatClock, formatDay, formatTime, phaseClock, seasonInstant, seasonToday } from '$lib/console/clock';
	import { watchTables } from '$lib/console/live.svelte';
	import type { MeetingKind } from '$lib/console/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state('');
	let message = $state('');
	let confirmAdvance = $state(false);

	// The clock ticks locally; every mutation goes through an RPC and comes back
	// through invalidateAll, so the displayed times are always the server's.
	let nowMs = $state(Date.now());

	onMount(() => {
		const tick = setInterval(() => (nowMs = Date.now()), 1000);
		// A phase advanced on another device has to land here too: this screen is
		// as likely to be the second tab as the first.
		const stop = watchTables(data.supabase, ['meetings', 'meeting_phases'], 'console-meeting', () => invalidateAll());
		return () => {
			clearInterval(tick);
			stop();
		};
	});

	let selected = $derived(data.selected);
	let running = $derived(Boolean(selected?.started_at && !selected?.ended_at));
	let currentPhase = $derived(data.phases.find((p) => p.id === selected?.current_phase_id) ?? null);
	let clock = $derived(
		currentPhase
			? phaseClock(
					{
						id: currentPhase.id,
						ordinal: currentPhase.ordinal,
						name: currentPhase.name,
						planned_minutes: currentPhase.planned_minutes,
						started_at: currentPhase.started_at,
						ended_at: currentPhase.ended_at
					},
					nowMs
				)
			: null
	);
	let isLastPhase = $derived(
		Boolean(currentPhase) && currentPhase!.ordinal >= Math.max(...data.phases.map((p) => p.ordinal), 0)
	);

	// --- the create form -----------------------------------------------------
	let kind = $state<MeetingKind>('friday');
	let date = $state(seasonToday(Date.now()));
	let startTime = $state('16:30');

	// The season's standing times; a mentor can still override before creating.
	$effect(() => {
		startTime = kind === 'saturday' ? '09:00' : '16:30';
	});

	let templateFor = $derived(data.templates.filter((t) => t.kind === kind));
	let templateMinutes = $derived(templateFor.reduce((sum, t) => sum + t.planned_minutes, 0));

	async function call(key: string, fn: () => Promise<{ error: { message: string } | null }>) {
		busy = key;
		message = '';
		const { error } = await fn();
		busy = '';
		if (error) {
			message = error.message;
			return false;
		}
		await invalidateAll();
		return true;
	}

	function createMeeting(event: SubmitEvent) {
		event.preventDefault();
		const startsAt = seasonInstant(date, startTime);
		if (!startsAt) {
			message = 'That date and time did not make sense.';
			return;
		}
		return call('create', async () =>
			data.supabase.rpc('meeting_create', {
				p_kind: kind,
				p_meeting_date: date,
				p_planned_start_at: startsAt
			})
		);
	}

	function start(id: string) {
		return call('start', async () => data.supabase.rpc('meeting_start', { p_meeting_id: id }));
	}

	async function advance(id: string) {
		if (!confirmAdvance) {
			confirmAdvance = true;
			return;
		}
		confirmAdvance = false;
		await call('advance', async () => data.supabase.rpc('meeting_advance_phase', { p_meeting_id: id }));
	}

	function end(id: string) {
		return call('end', async () => data.supabase.rpc('meeting_end', { p_meeting_id: id }));
	}

	function statusOf(m: (typeof data.meetings)[number]): string {
		if (m.ended_at) return 'ended';
		if (m.started_at) return 'live';
		return 'planned';
	}
</script>

<svelte:head><title>Meeting control</title></svelte:head>

<div class="mc">
	<aside class="mc__list card">
		<h2>Sessions</h2>
		{#if data.meetings.length === 0}
			<p class="muted">No meetings yet.</p>
		{:else}
			<ul class="mlist">
				{#each data.meetings as m (m.id)}
					<li>
						<a
							class="mlist__item"
							class:mlist__item--on={selected?.id === m.id}
							data-status={statusOf(m)}
							href="/app/meeting?meeting={m.id}"
						>
							<span class="mlist__day">{formatDay(m.meeting_date)}</span>
							<span class="muted small">
								{m.kind === 'saturday' ? 'Saturday' : 'Friday'} · {formatTime(m.planned_start_at)}
							</span>
							<span class="mlist__status">{statusOf(m)}</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}

		<h2 class="mc__newhead">New session</h2>
		<form onsubmit={createMeeting}>
			<label class="field">
				<span>Kind</span>
				<select class="input" bind:value={kind}>
					<option value="friday">Friday</option>
					<option value="saturday">Saturday</option>
				</select>
			</label>
			<label class="field">
				<span>Date</span>
				<input class="input" type="date" bind:value={date} required />
			</label>
			<label class="field">
				<span>Starts</span>
				<input class="input" type="time" bind:value={startTime} required />
			</label>
			<p class="muted small">
				{templateFor.length} phases from the {kind} template, {templateMinutes} minutes:
				{templateFor.map((t) => `${t.name} ${t.planned_minutes}`).join(', ')}.
			</p>
			<button class="btn btn--secondary" type="submit" disabled={busy === 'create'}>Create session</button>
		</form>
	</aside>

	<section class="mc__detail">
		{#if message}
			<p class="error" role="alert">{message}</p>
		{/if}
		{#if data.loadError}
			<p class="error">{data.loadError}</p>
		{/if}

		{#if !selected}
			<div class="card"><p class="muted">Create a session to run one.</p></div>
		{:else}
			<div class="card mc__now" data-state={running ? 'running' : 'idle'}>
				<p class="eyebrow">{formatDay(selected.meeting_date)} · {selected.kind}</p>

				{#if !selected.started_at}
					<h1>Not started</h1>
					<p class="muted">
						Planned {formatTime(selected.planned_start_at)} to {formatTime(selected.planned_end_at)}.
					</p>
					<button class="btn btn--primary" disabled={busy === 'start'} onclick={() => start(selected.id)}>
						Start session
					</button>
				{:else if selected.ended_at}
					<h1>Ended</h1>
					<p class="muted">
						Ran {formatTime(selected.started_at)} to {formatTime(selected.ended_at)}.
					</p>
				{:else if currentPhase && clock}
					<h1 class="mc__phase">{currentPhase.name}</h1>
					<p class="muted small">Phase {currentPhase.ordinal} of {data.phases.length}</p>
					<p class="mc__clock" class:mc__clock--over={clock.overrun}>{formatClock(clock.remainingMs)}</p>
					<p class="muted small">
						{#if clock.overrun}
							Over by {formatClock(clock.remainingMs).slice(1)} of {currentPhase.planned_minutes} planned minutes.
							Nothing advances on its own.
						{:else}
							{currentPhase.planned_minutes} minutes planned, started {formatTime(currentPhase.started_at)}.
						{/if}
					</p>
					<div class="mc__actions">
						{#if isLastPhase}
							<button class="btn btn--primary" disabled={busy === 'end'} onclick={() => end(selected.id)}>
								End session
							</button>
							<p class="muted small">That was the last phase.</p>
						{:else if confirmAdvance}
							<button class="btn btn--primary" disabled={busy === 'advance'} onclick={() => advance(selected.id)}>
								Yes, move to phase {currentPhase.ordinal + 1}
							</button>
							<button class="btn btn--ghost" onclick={() => (confirmAdvance = false)}>Stay here</button>
						{:else}
							<button class="btn btn--primary" onclick={() => advance(selected.id)}>Advance phase</button>
							<button class="btn btn--ghost" disabled={busy === 'end'} onclick={() => end(selected.id)}>
								End session
							</button>
						{/if}
					</div>
				{:else}
					<h1>Running</h1>
					<p class="muted">This session has no current phase.</p>
					<button class="btn btn--ghost" disabled={busy === 'end'} onclick={() => end(selected.id)}>
						End session
					</button>
				{/if}
			</div>

			<div class="card">
				<h2>Phases</h2>
				<ol class="phases">
					{#each data.phases as phase (phase.id)}
						<li
							class="phase"
							class:phase--now={phase.id === selected.current_phase_id}
							class:phase--done={Boolean(phase.ended_at)}
						>
							<span class="phase__name">{phase.ordinal}. {phase.name}</span>
							<span class="muted small">{phase.planned_minutes} min planned</span>
							<span class="muted small">
								{#if phase.started_at && phase.ended_at}
									{formatTime(phase.started_at)} to {formatTime(phase.ended_at)}
								{:else if phase.started_at}
									started {formatTime(phase.started_at)}
								{:else}
									not run
								{/if}
							</span>
						</li>
					{/each}
				</ol>
			</div>
		{/if}
	</section>
</div>

<style>
	.mc {
		display: grid;
		gap: var(--space-4);
	}
	.mc__newhead {
		margin-top: var(--space-5);
	}

	.mlist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.mlist__item {
		display: grid;
		gap: 0.125rem;
		min-height: 2.75rem;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--hairline);
		background: var(--surface-2);
		color: var(--text-1);
		text-decoration: none;
	}
	.mlist__item--on {
		border-color: var(--boundary);
		background: var(--surface-1);
	}
	.mlist__day {
		font-weight: var(--fw-bold);
	}
	.mlist__status {
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.mlist__item[data-status='live'] {
		border-color: var(--success);
	}
	.mlist__item[data-status='live'] .mlist__status {
		color: var(--success-text);
	}

	.mc__detail {
		display: grid;
		gap: var(--space-4);
		align-content: start;
	}
	.mc__now[data-state='running'] {
		border-color: var(--success);
	}
	.mc__phase {
		margin-bottom: 0;
	}
	.mc__clock {
		font-family: var(--font-mono);
		font-size: var(--fs-hero);
		font-weight: var(--fw-bold);
		font-variant-numeric: tabular-nums;
		color: var(--success-text);
		margin: var(--space-2) 0;
		line-height: 1;
	}
	.mc__clock--over {
		color: var(--warning);
	}
	.mc__actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}

	.phases {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.phase {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: baseline;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--hairline);
		background: var(--surface-2);
	}
	.phase__name {
		font-weight: var(--fw-bold);
		flex: 1 1 10rem;
	}
	.phase--now {
		border-color: var(--success);
	}
	.phase--now .phase__name {
		color: var(--success-text);
	}
	.phase--done .phase__name {
		color: var(--text-3);
	}

	/* Desktop-first master-detail; the single column above is the phone
	   fallback, which still has to be correct. */
	@media (min-width: 60rem) {
		.mc {
			grid-template-columns: 22rem minmax(0, 1fr);
			align-items: start;
		}
	}
</style>
