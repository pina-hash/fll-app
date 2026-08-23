<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatDay } from '$lib/console/clock';
	import { ROLE_LABEL, TEAM_ROLES, type TeamRole } from '$lib/console/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let title = $state('');
	let detail = $state('');
	let role = $state<TeamRole | ''>('');
	let meetingId = $state('');
	let evidenceRequired = $state(false);
	let targets = $state<string[]>([]);
	let busy = $state('');
	let message = $state('');
	let good = $state('');

	// Default to every team: the common case is one plan for all four.
	$effect(() => {
		if (targets.length === 0 && data.teams.length > 0) {
			targets = data.teams.map((t) => t.id);
		}
	});

	let allSelected = $derived(targets.length === data.teams.length);

	function toggleTeam(id: string) {
		targets = targets.includes(id) ? targets.filter((t) => t !== id) : [...targets, id];
	}

	function toggleAll() {
		targets = allSelected ? [] : data.teams.map((t) => t.id);
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		message = '';
		good = '';
		if (!title.trim()) {
			message = 'A task needs a title.';
			return;
		}
		if (targets.length === 0) {
			message = 'Pick at least one team.';
			return;
		}
		if (data.principal.kind !== 'mentor') return;

		const mentorId = data.principal.mentorId;
		const rows = targets.map((teamId) => ({
			team_id: teamId,
			title: title.trim(),
			detail: detail.trim() || null,
			role: role || null,
			meeting_id: meetingId || null,
			evidence_required: evidenceRequired,
			created_by_mentor_id: mentorId
		}));

		busy = 'create';
		// One statement, so four teams either all get the task or none do.
		const { error } = await data.supabase.from('tasks').insert(rows);
		busy = '';
		if (error) {
			message = error.message;
			return;
		}
		good = `Created on ${rows.length} team${rows.length === 1 ? '' : 's'}.`;
		title = '';
		detail = '';
		await invalidateAll();
	}

	async function remove(id: string) {
		busy = `del:${id}`;
		message = '';
		const { error } = await data.supabase.from('tasks').delete().eq('id', id);
		busy = '';
		if (error) {
			message = error.message;
			return;
		}
		await invalidateAll();
	}

	let grouped = $derived(
		data.teams.map((team) => ({
			team,
			tasks: data.tasks.filter((t) => t.team_id === team.id)
		}))
	);
</script>

<svelte:head><title>Tasks</title></svelte:head>

<div class="tasks">
	<section class="card">
		<p class="eyebrow">Tasks</p>
		<h1>Create work</h1>
		{#if message}
			<p class="error" role="alert">{message}</p>
		{/if}
		{#if good}
			<p class="notice" role="status">{good}</p>
		{/if}
		{#if data.loadError}
			<p class="error">{data.loadError}</p>
		{/if}

		<form onsubmit={create}>
			<label class="field">
				<span>Title</span>
				<input class="input" bind:value={title} maxlength="200" required />
			</label>
			<label class="field">
				<span>Detail</span>
				<textarea class="input" bind:value={detail} rows="3" maxlength="4000"></textarea>
			</label>

			<div class="grid2">
				<label class="field">
					<span>Role queue</span>
					<select class="input" bind:value={role}>
						<option value="">Anyone on the team</option>
						{#each TEAM_ROLES as r (r)}
							<option value={r}>{ROLE_LABEL[r]}</option>
						{/each}
					</select>
				</label>
				<label class="field">
					<span>Meeting</span>
					<select class="input" bind:value={meetingId}>
						<option value="">Not tied to a meeting</option>
						{#each data.meetings as m (m.id)}
							<option value={m.id}>{formatDay(m.meeting_date)} · {m.kind}</option>
						{/each}
					</select>
				</label>
			</div>

			<label class="check">
				<input type="checkbox" bind:checked={evidenceRequired} />
				<span>Evidence required to close it</span>
			</label>

			<fieldset class="teams">
				<legend>Teams</legend>
				<button class="btn btn--ghost btn--small" type="button" onclick={toggleAll}>
					{allSelected ? 'Clear all' : 'Select all four'}
				</button>
				<div class="teams__list">
					{#each data.teams as team (team.id)}
						<label class="check check--team" data-accent={team.accent}>
							<input type="checkbox" checked={targets.includes(team.id)} onchange={() => toggleTeam(team.id)} />
							<span class="accent-dot" aria-hidden="true"></span>
							<span>{team.name}</span>
						</label>
					{/each}
				</div>
			</fieldset>

			<button class="btn btn--primary" type="submit" disabled={busy === 'create'}>
				Create on {targets.length} team{targets.length === 1 ? '' : 's'}
			</button>
		</form>
	</section>

	<section class="card">
		<h2>Recent tasks</h2>
		<div class="cols">
			{#each grouped as group (group.team.id)}
				<div class="col" data-accent={group.team.accent}>
					<h3 class="col__head">{group.team.name}</h3>
					{#if group.tasks.length === 0}
						<p class="muted small">Nothing yet.</p>
					{:else}
						<ul class="tlist">
							{#each group.tasks.slice(0, 12) as task (task.id)}
								<li class="tlist__item">
									<span class="tlist__main">
										<strong>{task.title}</strong>
										<span class="muted small">
											{task.status}{#if task.role}{' · '}{ROLE_LABEL[task.role]}{/if}{#if task.evidence_required}{' · evidence'}{/if}
										</span>
									</span>
									<button
										class="btn btn--ghost btn--small"
										disabled={busy === `del:${task.id}`}
										onclick={() => remove(task.id)}>Delete</button
									>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/each}
		</div>
		<p class="muted small">
			A task tagged with a role lands in that role's queue in the student runtime. Who is actually in that seat on a
			given day is resolved by the database, never guessed here.
		</p>
	</section>
</div>

<style>
	.tasks {
		display: grid;
		gap: var(--space-4);
	}
	.grid2 {
		display: grid;
		gap: var(--space-3);
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
	.teams {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-control);
		padding: var(--space-3);
		margin: 0 0 var(--space-3);
	}
	.teams legend {
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.teams__list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.check--team :global(.accent-dot) {
		background: var(--team-accent);
	}

	.cols {
		display: grid;
		gap: var(--space-4);
	}
	.col__head {
		margin: 0 0 var(--space-2);
		color: var(--team-accent);
		font-size: var(--fs-h3);
	}
	.tlist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.tlist__item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--hairline);
		background: var(--surface-2);
	}
	.tlist__main {
		display: grid;
		gap: 0.125rem;
		min-width: 0;
	}

	@media (min-width: 48rem) {
		.grid2 {
			grid-template-columns: 1fr 1fr;
		}
	}
	@media (min-width: 68rem) {
		.cols {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
</style>
