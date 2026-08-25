<script lang="ts">
	import ExamplePlan from '$lib/planner/ExamplePlan.svelte';
</script>

<svelte:head><title>Example robot plan</title></svelte:head>

<div class="pp">
	<header class="pp__top">
		<a class="pp__back" href="/app/me/plan">Back</a>
		<span class="pp__team">Example plan</span>
	</header>

	<ExamplePlan backHref="/app/me/plan" />
</div>

<style>
	/* The example wears no team accent on purpose: it is nobody's plan. */
	.pp {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-3) var(--space-6);
		background: var(--surface-0);
	}
	.pp__top {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.pp__back {
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
	.pp__team {
		font-family: var(--font-display);
		font-size: var(--fs-h2);
		font-weight: var(--fw-black);
		color: var(--text-1);
	}
</style>
