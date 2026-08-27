<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import type { ScoringLine } from '$lib/content/types';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let scoring = $derived((data.mission.scoring as ScoringLine[] | null) ?? []);
	let noteText = $state(untrack(() => data.note));
	let selectedTeamId = $state(untrack(() => data.selectedTeamId ?? ''));
	let saving = $state(false);

	// A fresh navigation to a different mission or team resets the draft to
	// what the server just sent, rather than carrying over a stale edit.
	$effect(() => {
		noteText = data.note;
		selectedTeamId = data.selectedTeamId ?? '';
	});

	function changeTeam(event: Event) {
		const teamId = (event.currentTarget as HTMLSelectElement).value;
		const target = new URL(window.location.href);
		if (teamId) target.searchParams.set('team', teamId);
		else target.searchParams.delete('team');
		window.location.href = target.toString();
	}
</script>

<svelte:head><title>{data.content.title}</title></svelte:head>

<a class="back" href="/app/library/missions">Back to missions</a>
<p class="eyebrow">{data.mission.code} · {data.mission.points_label}</p>
<h1>{data.content.title}</h1>

<div class="card">
	<p>{data.content.description}</p>
	<ul class="scoring">
		{#each scoring as line}
			<li class:bonus={line.bonus}>
				<span>{line.label}</span>
				<span class="points">{line.points} pt{line.points === 1 ? '' : 's'}</span>
			</li>
		{/each}
	</ul>
	{#if data.content.caveats.length}
		<ul class="caveats">
			{#each data.content.caveats as caveat}
				<li>{caveat}</li>
			{/each}
		</ul>
	{/if}
</div>

{#if data.mission.position_x_mm !== null && data.mission.position_y_mm !== null}
	<p class="muted small">
		Mat position: {data.mission.position_x_mm} mm, {data.mission.position_y_mm} mm.
	</p>
{/if}

<div class="card prompt">
	<p class="eyebrow">Think about it</p>
	<p>{data.content.prompt}</p>
</div>

<section class="notes">
	<h2>Your team's strategy</h2>
	{#if data.teams.length}
		<label class="field">
			<span>Team</span>
			<select class="input" value={selectedTeamId} onchange={changeTeam}>
				<option value="">Choose a team</option>
				{#each data.teams as team (team.id)}
					<option value={team.id}>{team.name}</option>
				{/each}
			</select>
		</label>
	{/if}

	{#if selectedTeamId}
		<form
			method="POST"
			action="?/saveNote"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					await update();
					saving = false;
				};
			}}
		>
			<input type="hidden" name="teamId" value={selectedTeamId} />
			<label class="field">
				<span>Notes save to the whole team, not just this device.</span>
				<textarea class="input" name="note" rows="6" bind:value={noteText}></textarea>
			</label>
			<button class="btn btn--primary" type="submit" disabled={saving}>
				{saving ? 'Saving...' : 'Save notes'}
			</button>
			{#if form?.saved}<p class="notice">Saved.</p>{/if}
			{#if form?.message}<p class="error">{form.message}</p>{/if}
		</form>
	{:else}
		<p class="muted small">Choose a team to read or write its strategy note.</p>
	{/if}
</section>

<style>
	.back {
		display: inline-block;
		margin-bottom: var(--space-3);
		color: var(--link);
	}
	h1 {
		margin: var(--space-1) 0 var(--space-4);
	}
	.scoring {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.scoring li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.scoring li.bonus {
		color: var(--link);
	}
	.points {
		font-weight: var(--fw-bold);
		white-space: nowrap;
	}
	.caveats {
		margin-top: var(--space-3);
		padding-left: var(--space-4);
		color: var(--warning);
	}
	/* BRASS, THE CALLOUT ACCENT, WHICH WAS SITTING UNUSED. A strategy prompt is
	   content, and the content accents are brass, patina and copper; --accent is
	   the pathway green and its jobs are identity, the one active state and the
	   primary action. This is the pattern the whole bundle is about: a semantic
	   token existed and the green got used because it was the green that was
	   handy. */
	.prompt {
		margin-top: var(--space-4);
		border-color: var(--brass);
	}
	.notes {
		margin-top: var(--space-6);
	}
	.notes form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}
</style>
