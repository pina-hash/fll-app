<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Robot code</title></svelte:head>

<h1>Robot code</h1>
<p class="muted">Pick a team to set up its robot and build its SPIKE files.</p>

<div class="teams">
	{#each data.teams as team (team.id)}
		<a class="tile team-tile" data-accent={team.accent} href="/app/codegen/{team.id}">
			<span class="team-tile__name">{team.name}</span>
			{#if team.fll_team_number}
				<span class="team-tile__num small muted">#{team.fll_team_number}</span>
			{/if}
		</a>
	{:else}
		<p class="muted">No teams yet. Create them on the Teams screen.</p>
	{/each}
</div>

<style>
	.teams {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: var(--space-3);
	}
	.team-tile {
		display: grid;
		gap: var(--space-1);
		text-decoration: none;
		border-left: 6px solid var(--team-accent);
	}
	.team-tile__name {
		color: var(--team-accent);
	}
</style>
