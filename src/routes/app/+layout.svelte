<script lang="ts">
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
	let who = $derived(
		data.principal.kind === 'mentor'
			? `${data.principal.displayName}${data.principal.isAdmin ? ' · admin' : ''}`
			: `${data.principal.firstName} ${data.principal.lastInitial}. · ${data.principal.teamName}`
	);
</script>

<div class="shell">
	<header class="shell__bar">
		<a class="shell__brand" href="/app"><span class="glow">BIOGLOW</span> <span class="muted small">2026–27</span></a>
		<div class="shell__who">
			<span class="small">{who}</span>
			<form method="post" action="/auth/signout">
				<button class="btn btn--ghost btn--small" type="submit">Sign out</button>
			</form>
		</div>
	</header>
	<main class="shell__main">
		{@render children()}
	</main>
</div>

<style>
	.shell {
		min-height: 100dvh;
		display: grid;
		grid-template-rows: auto 1fr;
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
	.shell__main {
		padding: var(--space-5) var(--space-4);
		max-width: 64rem;
		width: 100%;
		margin: 0 auto;
	}
</style>
