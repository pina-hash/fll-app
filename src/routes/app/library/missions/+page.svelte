<script lang="ts">
	import { MATCH_BASICS } from '$lib/content/missions';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Robot Game Missions</title></svelte:head>

<a class="back" href="/app/library">Back to the Skill Hub</a>
<p class="eyebrow">15 BIOGLOW missions + match basics</p>
<h1>Robot Game Missions</h1>
<p class="muted">
	Every mission on the BIOGLOW table, with what scores and what zeroes it. Open one and write your
	team's strategy, notes save to the team, not the device, so anyone on the team can pick up where
	someone else left off.
</p>

{#if data.missionsError}
	<p class="error">Missions did not load: {data.missionsError}</p>
{/if}

<ul class="list">
	{#each data.missions as mission (mission.id)}
		<li>
			<a class="card item" href="/app/library/missions/{mission.code}">
				<span class="item__num muted small">{mission.code}</span>
				<span class="item__title">{mission.name}</span>
				<span class="item__points muted small">{mission.points_label}</span>
			</a>
		</li>
	{/each}
</ul>

<h2>Match basics</h2>
<p class="muted small">Match-wide points that are not a mission model.</p>
<ul class="list">
	{#each MATCH_BASICS as item (item.id)}
		<li>
			<div class="card item">
				<span class="item__num muted small">{item.num}</span>
				<span class="item__title">{item.title}</span>
				<span class="item__points muted small">{item.pointsLabel}</span>
				<span class="item__desc muted small">{item.description}</span>
			</div>
		</li>
	{/each}
</ul>

<style>
	.back {
		display: inline-block;
		margin-bottom: var(--space-3);
		color: var(--glow-cyan);
	}
	h1 {
		margin: var(--space-1) 0 var(--space-2);
	}
	h2 {
		margin-top: var(--space-6);
	}
	.list {
		list-style: none;
		margin: var(--space-4) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.item {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		text-align: left;
	}
	.item__num {
		font-family: var(--font-display);
		letter-spacing: var(--track-wide);
	}
	.item__title {
		font-weight: var(--fw-bold);
		font-size: var(--fs-h4);
		color: var(--text-1);
	}
	.item__points {
		color: var(--glow-green);
	}
</style>
