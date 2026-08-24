<script lang="ts">
	/**
	 * WHAT A PARENT SEES. One child, on a phone, in a car park at pickup.
	 *
	 * The audience here is not the one the rest of this app is built for: an
	 * adult who has never seen the console, is not signed in to anything, and
	 * wants three facts (when is the next session, did my kid go, what did they
	 * do). So the order is next meeting, then their child, then the record --
	 * and there is not a single control that writes anything, because there is
	 * not a single write path behind this page.
	 *
	 * Every other child on the team appears once, as a first name and a last
	 * initial, which is exactly what a printed roster card already shows a room
	 * full of parents.
	 */
	import { ROLE_LABEL, type TeamRole } from '$lib/console/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let view = $derived(data.view);
	let child = $derived(`${view.student.first_name} ${view.student.last_initial}.`);

	let nextMeeting = $derived(
		view.upcoming_meetings.find((m) => !m.ended_at) ?? view.upcoming_meetings[0] ?? null
	);

	function roleLabel(role: string): string {
		return ROLE_LABEL[role as TeamRole] ?? role.replace(/_/g, ' ');
	}

	function dayLabel(iso: string): string {
		if (!iso) return '';
		const d = new Date(iso);
		return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
	}
	function shortDay(iso: string): string {
		if (!iso) return '';
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
	function timeRange(startIso: string, endIso: string): string {
		if (!startIso) return '';
		const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
		const start = new Date(startIso).toLocaleTimeString(undefined, opts);
		if (!endIso) return start;
		return `${start} to ${new Date(endIso).toLocaleTimeString(undefined, opts)}`;
	}
</script>

<svelte:head>
	<title>{child} · {view.team.name}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="pv" data-accent={view.team.accent}>
	<header class="pv__head">
		<p class="eyebrow">Bosco Tech · FIRST LEGO League · BIOGLOW 2026-27</p>
		<h1>{child}</h1>
		<p class="pv__team">
			{view.team.name}{#if view.team.fll_team_number}<span class="muted"> · team #{view.team.fll_team_number}</span
				>{/if}
		</p>
		<p class="muted small">
			{#if view.student.grade}Grade {view.student.grade} · {/if}
			{#if view.roles.length === 0}
				No team role yet
			{:else}
				{#each view.roles as role, i (role.role)}{i > 0 ? ', ' : ''}{roleLabel(role.role)} ({role.tier}){/each}
			{/if}
		</p>
	</header>

	<section class="card">
		<h2>Next session</h2>
		{#if nextMeeting}
			<p class="pv__next">{dayLabel(nextMeeting.planned_start_at)}</p>
			<p class="pv__time">{timeRange(nextMeeting.planned_start_at, nextMeeting.planned_end_at)}</p>
			{#if view.upcoming_meetings.length > 1}
				<h3>After that</h3>
				<ul class="plain">
					{#each view.upcoming_meetings.slice(1) as meeting (meeting.id)}
						<li>
							{dayLabel(meeting.planned_start_at)} · {timeRange(
								meeting.planned_start_at,
								meeting.planned_end_at
							)}
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			<p class="muted">Nothing on the calendar yet. Mentors add sessions as the season is planned.</p>
		{/if}
	</section>

	<section class="card">
		<h2>Sessions attended</h2>
		{#if view.attendance.length === 0}
			<p class="muted">{view.student.first_name} has not checked in to a session yet.</p>
		{:else}
			<p class="muted small">
				{view.attendance.length} session{view.attendance.length === 1 ? '' : 's'} so far.
			</p>
			<ul class="chips">
				{#each view.attendance as row (row.meeting_id)}
					<li class="chip">
						<span class="chip__day">{shortDay(row.meeting_date)}</span>
						<span class="chip__kind">{row.kind === 'saturday' ? 'Sat' : 'Fri'}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="card">
		<h2>What {view.student.first_name} finished</h2>
		{#if view.tasks_done.length === 0}
			<p class="muted">Nothing finished yet. Jobs show up here as they get ticked off.</p>
		{:else}
			<ul class="plain">
				{#each view.tasks_done as task (task.id)}
					<li>
						<span>{task.title}</span>
						{#if task.closed_at}<span class="muted small"> · {shortDay(task.closed_at)}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="card">
		<h2>Photos {view.student.first_name} took</h2>
		{#if view.photos.length === 0}
			<p class="muted">No photos yet.</p>
		{:else}
			<ul class="photos">
				{#each view.photos as photo (photo.id)}
					<li class="photo">
						<img src={`/p/${data.token}/photo/${photo.id}`} alt={photo.caption ?? photo.task_title} loading="lazy" />
						<span class="photo__cap">{photo.caption || photo.task_title}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="card">
		<h2>The team</h2>
		<ul class="chips">
			{#each view.roster as person (person.first_name + person.last_initial)}
				<li class="chip" class:chip--mine={person.is_mine}>
					{person.first_name} {person.last_initial}.
				</li>
			{/each}
		</ul>
	</section>

	<footer class="pv__foot">
		<p class="muted small">
			This page is just for {view.student.first_name}. It updates by itself. Keep the link private: anyone who has
			it can see this page. A mentor can turn it off or send you a new one.
		</p>
	</footer>
</main>

<style>
	.pv {
		min-height: 100dvh;
		display: grid;
		gap: var(--space-4);
		align-content: start;
		padding: var(--space-5) var(--space-4) var(--space-6);
		max-width: 40rem;
		margin: 0 auto;
		background:
			radial-gradient(120% 50% at 50% 0%, var(--team-accent-wash), transparent 70%),
			var(--surface-0);
	}
	.pv__head h1 {
		margin: 0 0 var(--space-1);
		color: var(--team-accent);
	}
	.pv__team {
		margin: 0 0 var(--space-1);
		font-weight: var(--fw-bold);
	}
	.pv__next {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--fs-h2);
		font-weight: var(--fw-black);
		color: var(--team-accent);
	}
	.pv__time {
		margin: 0 0 var(--space-3);
		font-size: var(--fs-h3);
	}

	.plain {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.plain li {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-control);
		background: var(--surface-2);
		border: 1px solid var(--hairline);
	}

	.chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.chip {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-control);
		background: var(--surface-2);
		border: 1px solid var(--hairline);
		font-size: var(--fs-small);
	}
	.chip--mine {
		border-color: var(--team-accent);
		color: var(--team-accent);
		font-weight: var(--fw-bold);
	}
	.chip__day {
		font-weight: var(--fw-bold);
	}
	.chip__kind {
		color: var(--text-3);
	}

	.photos {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
		gap: var(--space-3);
	}
	.photo {
		display: grid;
		gap: var(--space-1);
	}
	.photo img {
		width: 100%;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		border-radius: var(--radius-control);
		border: 1px solid var(--boundary);
		background: var(--surface-2);
	}
	.photo__cap {
		font-size: var(--fs-small);
		color: var(--text-2);
	}

	.pv__foot {
		margin-top: var(--space-2);
	}
</style>
