<script lang="ts">
	import PlannerPage from '$lib/planner/PlannerPage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The (mentor) layout guarantees this, but the type union does not know it.
	let mentorId = $derived(data.principal.kind === 'mentor' ? data.principal.mentorId : '');
</script>

<svelte:head><title>{data.team.name} route plan</title></svelte:head>

<div class="mp" data-accent={data.team.accent}>
	<div class="mp__head">
		<h1 class="mp__title">Route planner</h1>
		<nav class="mp__teams" aria-label="Teams">
			{#each data.teams as t (t.id)}
				<a
					class="mp__team"
					class:mp__team--on={t.id === data.team.id}
					data-accent={t.accent}
					href="/app/plan/{t.id}"
				>
					{t.name}
				</a>
			{/each}
		</nav>
	</div>

	{#key data.team.id}
		<PlannerPage
			supabase={data.supabase}
			ownerId={mentorId}
			team={{ id: data.team.id, name: data.team.name }}
			isMentor={true}
			data={data.planner}
			exampleHref="/app/plan/example"
		/>
	{/key}
</div>

<style>
	.mp {
		display: grid;
		gap: var(--space-4);
	}
	.mp__head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.mp__title {
		margin: 0;
		font-size: var(--fs-h2);
	}
	.mp__teams {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.mp__team {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--boundary);
		color: var(--text-2);
		text-decoration: none;
		font-weight: var(--fw-bold);
	}
	.mp__team--on {
		color: var(--team-accent);
		border-color: var(--team-accent);
		background: var(--team-accent-wash);
	}
</style>
