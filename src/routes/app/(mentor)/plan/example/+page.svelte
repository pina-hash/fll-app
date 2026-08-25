<script lang="ts">
	import ExamplePlan from '$lib/planner/ExamplePlan.svelte';
</script>

<svelte:head><title>Example route plan</title></svelte:head>

<div class="mx">
	<h1 class="mx__title">Example route plan</h1>
	<ExamplePlan backHref="/app" backLabel="Back to the console" />
</div>

<style>
	.mx {
		display: grid;
		gap: var(--space-4);
	}
	.mx__title {
		margin: 0;
		font-size: var(--fs-h2);
	}
</style>
