<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	let who = $derived(
		data.principal.kind === 'mentor'
			? `${data.principal.displayName}${data.principal.isAdmin ? ' · admin' : ''}`
			: `${data.principal.firstName} ${data.principal.lastInitial}. · ${data.principal.teamName}`
	);

	/**
	 * The console's four surfaces. The live board is first because it is where
	 * a mentor lands and where they return between every other task.
	 */
	const NAV = [
		{ href: '/app/board', label: 'Board' },
		{ href: '/app/meeting', label: 'Meeting' },
		{ href: '/app/teams', label: 'Teams' },
		{ href: '/app/tasks', label: 'Tasks' }
	];

	let isMentor = $derived(data.principal.kind === 'mentor');
	let current = $derived(page.url.pathname);
	const isActive = (href: string) => current === href || current.startsWith(href + '/');
</script>

<div class="shell">
	<header class="shell__bar">
		<a class="shell__brand" href="/app"><span class="glow">BIOGLOW</span> <span class="muted small">2026-27</span></a>
		<div class="shell__who">
			<span class="small">{who}</span>
			<form method="post" action="/auth/signout">
				<button class="btn btn--ghost btn--small" type="submit">Sign out</button>
			</form>
		</div>
	</header>

	{#if isMentor}
		<nav class="shell__nav" aria-label="Console">
			{#each NAV as item (item.href)}
				<a href={item.href} class="shell__tab" class:shell__tab--on={isActive(item.href)}>{item.label}</a>
			{/each}
		</nav>
	{/if}

	<main class="shell__main" class:shell__main--wide={isMentor}>
		{@render children()}
	</main>
</div>

<style>
	.shell {
		min-height: 100dvh;
		display: grid;
		grid-template-rows: auto auto 1fr;
	}
	.shell__bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--boundary);
		background: var(--surface-1);
	}
	.shell__brand {
		font-family: var(--font-display);
		font-weight: var(--fw-bold);
		font-size: var(--fs-h3);
		letter-spacing: var(--track-wide);
		text-decoration: none;
		color: var(--text-1);
	}
	.shell__who {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	/* Four targets a thumb can hit while walking. */
	.shell__nav {
		display: flex;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--hairline);
		background: var(--surface-1);
		overflow-x: auto;
	}
	.shell__tab {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 var(--space-4);
		border-radius: var(--radius-control);
		border: 1px solid transparent;
		color: var(--text-2);
		text-decoration: none;
		font-weight: var(--fw-bold);
		white-space: nowrap;
	}
	.shell__tab--on {
		color: var(--glow-green);
		border-color: var(--boundary);
		background: var(--surface-2);
	}

	.shell__main {
		padding: var(--space-5) var(--space-4);
		max-width: 64rem;
		width: 100%;
		margin: 0 auto;
	}
	/* The console's desktop surfaces are master-detail and want the room. */
	.shell__main--wide {
		max-width: 96rem;
	}

	@media (max-width: 26rem) {
		.shell__main {
			padding: var(--space-4) var(--space-3);
		}
		.shell__bar {
			padding: var(--space-3);
		}
		.shell__nav {
			padding: var(--space-2) var(--space-3);
		}
	}
</style>
