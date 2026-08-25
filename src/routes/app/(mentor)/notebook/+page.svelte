<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Notebooks</title></svelte:head>

<div class="nbp">
	<h1 class="nbp__title">Engineering notebooks</h1>
	<p class="muted">
		One per team, assembled from the season's own record. Unfinished session recaps are counted on each tile.
	</p>

	<div class="nbp__grid">
		{#each data.teams as t (t.id)}
			<a class="tile nbp__tile" data-accent={t.accent} href="/app/notebook/{t.id}">
				<span class="nbp__name">{t.name}</span>
				{#if t.fll_team_number}<span class="muted small">Team {t.fll_team_number}</span>{/if}
				{#if t.unfinishedRecaps > 0}
					<span class="nbp__todo">{t.unfinishedRecaps} recap{t.unfinishedRecaps === 1 ? '' : 's'} unfinished</span>
				{:else}
					<span class="muted small">All recaps finished</span>
				{/if}
			</a>
		{/each}
	</div>
</div>

<style>
	.nbp {
		display: grid;
		gap: var(--space-4);
	}
	.nbp__title {
		margin: 0;
		font-size: var(--fs-h2);
	}
	.nbp__grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: var(--space-3);
	}
	.nbp__tile {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		border-left: 4px solid var(--team-accent, var(--boundary));
	}
	.nbp__name {
		font-family: var(--font-display);
		font-size: var(--fs-h3);
		font-weight: var(--fw-black);
		/* The accent, not the ink that goes ON the accent: this is a label on
		   a .tile, not on a filled chip. --team-accent-ink here was white on
		   --surface-2 at 1.20. Every accent is derived to clear 4.5 against
		   all three surfaces of its ground; see team-accents.css. */
		color: var(--team-accent, var(--text-1));
	}
	.nbp__todo {
		color: var(--warning);
		font-weight: var(--fw-bold);
	}
</style>
