<script lang="ts">
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	// The mentor console shell already renders a header and nav around this
	// group; a student and a board device are bare everywhere in /app, so the
	// Skill Hub carries its own compact header for them, same pattern as the
	// student Team tab.
	let isMentor = $derived(data.principal.kind === 'mentor');
	let backHref = $derived(data.principal.kind === 'student' ? '/app/me' : '/app');
	let accent = $derived(data.principal.kind === 'student' ? data.principal.accent : undefined);
</script>

{#if isMentor}
	{@render children()}
{:else}
	<div class="lib" data-accent={accent}>
		<header class="lib__top">
			<a class="lib__back" href={backHref}>Back</a>
			<span class="lib__title">Skill Hub</span>
		</header>
		<main class="lib__main">
			{@render children()}
		</main>
	</div>
{/if}

<style>
	.lib {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
	}
	.lib__top {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--boundary);
		background: var(--surface-1);
	}
	.lib__back {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--boundary);
		color: var(--text-1);
		text-decoration: none;
		font-weight: var(--fw-bold);
	}
	.lib__title {
		font-family: var(--font-display);
		font-weight: var(--fw-bold);
		font-size: var(--fs-h3);
		letter-spacing: var(--track-wide);
		color: var(--success-text);
	}
	.lib__main {
		flex: 1;
		padding: var(--space-4) var(--space-3);
		max-width: 40rem;
		width: 100%;
		margin: 0 auto;
	}
</style>
