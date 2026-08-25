<script lang="ts">
	import ExamplePlan from '$lib/planner/ExamplePlan.svelte';
</script>

<svelte:head><title>dev: example plan</title></svelte:head>

<div class="harness">
	<header class="harness__bar">
		<strong>example plan harness</strong>
		<span>the real ExamplePlan component; the back link goes nowhere here</span>
	</header>
	<ExamplePlan backHref="#top" backLabel="Back (harness)" />
</div>

<style>
	.harness {
		min-height: 100dvh;
		padding: var(--space-4);
		display: grid;
		gap: var(--space-4);
		align-content: start;
	}
	.harness__bar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-4);
		padding: var(--space-2) var(--space-3);
		border: 1px dashed var(--boundary);
		border-radius: var(--radius-control);
		color: var(--text-muted);
	}
</style>
