<script lang="ts">
	import { onMount } from 'svelte';
	import { safeInvalidateAll } from '$lib/student/refresh';
	import { watchTables } from '$lib/console/live.svelte';
	import { ROLE_LABEL, TEAM_ROLES, type TeamAccent } from '$lib/console/types';
	import AccentPicker from '$lib/team/AccentPicker.svelte';
	import TeamName from '$lib/team/TeamName.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	onMount(() =>
		watchTables(
			data.supabase,
			['meetings', 'meeting_phases', 'tasks', 'blockers', 'attendance'],
			`student-team-${data.student.studentId}`,
			() => void safeInvalidateAll()
		)
	);

	let nameOf = $derived(new Map(data.roster.map((s) => [s.id, `${s.first_name} ${s.last_initial}.`])));
	let open = $derived(data.tasks.filter((t) => t.status !== 'done'));
	let done = $derived(data.tasks.filter((t) => t.status === 'done'));
	let hereCount = $derived(data.roster.filter((s) => s.present).length);

	// --- the team colour -----------------------------------------------------
	let accentBusy = $state(false);
	let accentMessage = $state('');
	let proposedByName = $derived.by(() => {
		const id = data.team?.accent_proposed_by;
		if (!id) return null;
		const s = data.roster.find((x) => x.id === id);
		return s ? `${s.first_name} ${s.last_initial}.` : null;
	});

	/**
	 * ONLINE ONLY, AND ON PURPOSE. Choosing a colour is a claim on a shared
	 * resource: the database decides who gets it, and a queued write replayed
	 * twenty minutes later would tell a team it won something it lost. Every
	 * refusal here is the server's own sentence, shown as it came.
	 */
	async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
		accentBusy = true;
		accentMessage = '';
		const { error } = await fn();
		accentBusy = false;
		if (error) {
			accentMessage = error.message;
			return;
		}
		await safeInvalidateAll();
	}

	const propose = (accent: TeamAccent) =>
		run(() => data.supabase.rpc('team_propose_accent', { p_accent: accent }));
	const confirm = (accent: TeamAccent | null) =>
		run(() =>
			data.supabase.rpc('team_confirm_accent', {
				p_team_id: data.student.teamId,
				...(accent ? { p_accent: accent } : {})
			})
		);
</script>

<svelte:head><title>{data.student.teamName} team</title></svelte:head>

<div class="tt" data-accent={data.student.accent}>
	<header class="tt__top">
		<a class="tt__back" href="/app/me">Back</a>
		<span class="tt__team">
			<TeamName name={data.student.teamName} shortName={data.team?.short_name} layout="inline" />
		</span>
	</header>

	{#if data.team}
		<section class="tt__card">
			<AccentPicker
				teamId={data.student.teamId}
				teamName={data.student.teamName}
				options={data.accentOptions}
				current={data.team.accent}
				proposed={data.team.accent_proposed}
				{proposedByName}
				canConfirm={data.canConfirmAccent}
				canPropose={true}
				isMentor={false}
				busy={accentBusy}
				message={accentMessage}
				onPropose={propose}
				onConfirm={confirm}
			/>
		</section>
	{/if}

	<section class="tt__card">
		<h2>Who is here</h2>
		<p class="tt__count">{hereCount} of {data.roster.length}</p>
		<ul class="tt__people">
			{#each data.roster as person (person.id)}
				<li class="person" class:person--here={person.present}>
					<span class="person__name">{person.first_name} {person.last_initial}.</span>
					<span class="person__state">{person.present ? 'here' : 'not here'}</span>
				</li>
			{/each}
		</ul>
	</section>

	<section class="tt__card">
		<h2>Jobs today</h2>
		<ul class="tt__roles">
			{#each TEAM_ROLES as role (role)}
				{@const row = data.roles.find((r) => r.role === role)}
				<li class="jrow" class:jrow--empty={!row || row.unfilled}>
					<span class="jrow__name">{ROLE_LABEL[role]}</span>
					{#if row && !row.unfilled}
						<span class="jrow__who">
							{row.active_name}
							{#if row.active_tier === 'second'}<span class="jrow__cover">covering</span>{/if}
						</span>
					{:else}
						<span class="jrow__who jrow__who--empty">Nobody is in this seat</span>
					{/if}
				</li>
			{/each}
		</ul>
	</section>

	{#if data.blockers.length > 0}
		<section class="tt__card tt__card--alarm">
			<h2>Stuck right now</h2>
			<ul class="tt__stuck">
				{#each data.blockers as blocker (blocker.id)}
					<li>
						<strong>{nameOf.get(blocker.student_id) ?? 'Someone'}</strong>
						<span>{blocker.note}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="tt__card">
		<h2>What we are doing</h2>
		{#if open.length === 0}
			<p class="muted">Nothing open right now.</p>
		{:else}
			<ul class="tt__tasks">
				{#each open as task (task.id)}
					<li class="trow">
						<span class="trow__title">{task.title}</span>
						<span class="trow__meta">
							{#if task.role}{ROLE_LABEL[task.role]}{:else}Anyone{/if}
							{#if task.assigned_student_id}{' · '}{nameOf.get(task.assigned_student_id) ?? 'claimed'}{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}

		{#if done.length > 0}
			<h3 class="tt__donehead">Finished today: {done.length}</h3>
			<ul class="tt__tasks tt__tasks--done">
				{#each done as task (task.id)}
					<li class="trow"><span class="trow__title">{task.title}</span></li>
				{/each}
			</ul>
		{/if}
	</section>

	<form class="tt__out" method="post" action="/auth/signout">
		<button class="tt__outbtn" type="submit">Sign out</button>
	</form>
</div>

<style>
	.tt {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-3) var(--space-6);
		background:
			radial-gradient(120% 60% at 50% 0%, var(--team-accent-wash), transparent 70%),
			var(--surface-0);
	}
	.tt__top {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.tt__back {
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
	.tt__team {
		font-family: var(--font-display);
		font-size: var(--fs-h2);
		font-weight: var(--fw-black);
		color: var(--team-accent);
	}

	.tt__card {
		padding: var(--space-4) var(--space-3);
		border-radius: var(--radius-card);
		background: var(--surface-1);
		border: 1px solid var(--boundary);
	}
	.tt__card--alarm {
		border-color: var(--warning);
	}
	.tt__card h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--fs-h3);
	}
	.tt__count {
		margin: 0 0 var(--space-3);
		font-family: var(--font-mono);
		font-size: var(--fs-h1);
		font-weight: var(--fw-bold);
		color: var(--team-accent);
	}

	.tt__people {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.person {
		display: grid;
		gap: 0.1rem;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-control);
		border: 2px solid var(--hairline);
		background: var(--surface-2);
		min-height: 3.25rem;
	}
	.person--here {
		border-color: var(--team-accent);
	}
	.person__name {
		font-weight: var(--fw-bold);
	}
	.person__state {
		font-size: var(--fs-small);
		color: var(--text-3);
	}
	.person--here .person__state {
		color: var(--team-accent);
	}

	.tt__roles,
	.tt__tasks,
	.tt__stuck {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.jrow,
	.trow {
		display: grid;
		gap: 0.15rem;
		padding: var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--hairline);
		background: var(--surface-2);
	}
	.jrow--empty {
		border-color: var(--warning);
	}
	.jrow__name,
	.trow__title {
		font-weight: var(--fw-bold);
		font-size: var(--fs-h3);
	}
	.jrow__who,
	.trow__meta {
		color: var(--text-2);
	}
	.jrow__who--empty {
		color: var(--warning);
		font-weight: var(--fw-semibold);
	}
	.jrow__cover {
		margin-left: var(--space-2);
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--warning);
		color: var(--warning);
		font-size: var(--fs-small);
	}
	.tt__stuck li {
		display: grid;
		gap: 0.15rem;
		padding: var(--space-3);
		border-radius: var(--radius-control);
		background: var(--warning-wash);
	}
	.tt__donehead {
		margin: var(--space-4) 0 var(--space-2);
		font-size: var(--fs-h3);
		color: var(--text-2);
	}
	.tt__tasks--done .trow__title {
		color: var(--text-3);
		text-decoration: line-through;
		font-weight: var(--fw-regular);
	}

	.tt__out {
		margin-top: var(--space-4);
		text-align: center;
	}
	.tt__outbtn {
		min-height: 3rem;
		padding: 0 var(--space-5);
		border-radius: var(--radius-control);
		border: 2px solid var(--boundary);
		background: transparent;
		color: var(--text-2);
		font: inherit;
		font-weight: var(--fw-bold);
		cursor: pointer;
	}

	@media (min-width: 40rem) {
		.tt {
			max-width: 34rem;
			margin: 0 auto;
		}
	}
</style>
