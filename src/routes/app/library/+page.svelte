<script lang="ts">
	import { CATEGORIES } from '$lib/content/categories';

	const MISSIONS_TILE = {
		id: 'missions',
		icon: '🤖',
		label: 'Robot Game Missions',
		short: 'Missions',
		tagline: '15 BIOGLOW missions + match basics'
	};
</script>

<svelte:head><title>Skill Hub</title></svelte:head>

<p class="eyebrow">BIOGLOW 2026-27</p>
<h1>The Skill Hub</h1>
<p class="muted">
	Everything about this season in one place: the robot, the missions, the values, the project, and
	every guide we link out to. Nothing here is locked. Look anything up, any time.
</p>

<div class="grid">
	<a class="tile" href="/app/library/missions">
		<span class="tile__icon">{MISSIONS_TILE.icon}</span>
		<span class="tile__label">{MISSIONS_TILE.label}</span>
		<span class="tile__tagline muted small">{MISSIONS_TILE.tagline}</span>
	</a>
	{#each CATEGORIES as cat (cat.id)}
		<a class="tile" href={cat.kind === 'media' ? '/app/library/media' : `/app/library/${cat.id}`}>
			<span class="tile__icon">{cat.icon}</span>
			<span class="tile__label">{cat.label}</span>
			<span class="tile__tagline muted small">{cat.tagline}</span>
		</a>
	{/each}
	<a class="tile" href="/app/library/documents">
		<span class="tile__icon">📄</span>
		<span class="tile__label">Official Season Documents</span>
		<span class="tile__tagline muted small">The real FIRST BIOGLOW publications</span>
	</a>
</div>

<style>
	h1 {
		margin: var(--space-2) 0 var(--space-2);
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
		margin-top: var(--space-5);
	}
	@media (min-width: 34rem) {
		.grid {
			grid-template-columns: 1fr 1fr;
		}
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		align-items: flex-start;
		text-align: left;
		min-height: 5.5rem;
		padding: var(--space-4);
	}
	.tile__icon {
		font-size: var(--fs-h2);
	}
	.tile__label {
		font-weight: var(--fw-bold);
		color: var(--text-1);
	}
</style>
