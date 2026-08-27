<script lang="ts">
	import { page } from '$app/state';
	import BrandLogo from '$lib/brand/BrandLogo.svelte';
	import FirstName from '$lib/brand/FirstName.svelte';
	import { SEASON } from '$lib/brand/rules';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	// Only the mentor shell renders this; students and board devices are bare
	// (see `bare` below) and carry their own header.
	let who = $derived(
		data.principal.kind === 'mentor'
			? `${data.principal.displayName}${data.principal.isAdmin ? ' · admin' : ''}`
			: data.principal.kind === 'student'
				? `${data.principal.firstName} ${data.principal.lastInitial}. · ${data.principal.teamName}`
				: data.principal.teamName
	);

	/**
	 * The console's surfaces. The live board is first because it is where
	 * a mentor lands and where they return between every other task.
	 */
	const NAV = [
		{ href: '/app/board', label: 'Board' },
		{ href: '/app/meeting', label: 'Meeting' },
		{ href: '/app/teams', label: 'Teams' },
		{ href: '/app/tasks', label: 'Tasks' },
		{ href: '/app/plan', label: 'Plan' },
		{ href: '/app/codegen', label: 'Robot code' },
		{ href: '/app/notebook', label: 'Notebook' },
		{ href: '/app/library', label: 'Library' }
	];

	let isMentor = $derived(data.principal.kind === 'mentor');
	/**
	 * A student screen and a board device are FULL BLEED: their own header, their
	 * own colour, no console chrome. The shell exists for the mentor console.
	 */
	let bare = $derived(data.principal.kind !== 'mentor');
	let current = $derived(page.url.pathname);
	const isActive = (href: string) => current === href || current.startsWith(href + '/');
</script>

{#if bare}
	{@render children()}
{:else}
	<div class="shell">
	<header class="shell__bar">
		<!--
			THE CONSOLE'S OWN MARK. The FIRST LEGO League Challenge horizontal
			stacked lockup is the preferred format (FLL guidelines p4) and is
			rendered here at 48px, above its 45px digital minimum, in its
			full-colour version on a light ground. The season is TEXT beside
			it, never artwork and never inside the mark's clear space: no
			season lockup, mat graphic or mission model is fetched or stored
			anywhere in this repo.
		-->
		<a class="shell__brand" href="/app" aria-label="Console home">
			<BrandLogo mark="fll-challenge-horizontal-stacked" height={48} />
			<span class="shell__season">
				<span class="shell__season-name">{SEASON.challenge}<sup>&trade;</sup></span>
				<span class="muted small">{SEASON.years} &middot; <FirstName name="challenge" /></span>
			</span>
		</a>
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
{/if}

<style>
	.shell {
		min-height: 100dvh;
		display: grid;
		grid-template-rows: auto auto 1fr;
		/* THE SHELL'S ONE COLUMN IS minmax(0, 1fr) AND NOT `auto`, WHICH IS THE
		   REPO'S OWN GRID RULE APPLIED TO THE THING THAT WRAPS EVERY CONSOLE
		   SCREEN. With no explicit column the implicit one is content-sized, so
		   the nav's row of tabs -- which scrolls on purpose, `overflow-x: auto`
		   below -- was still sizing the whole page from its content. Measured at
		   a 375px viewport: every mentor route scrolled sideways by 21px, header,
		   nav and main all 396px wide inside a 375px window. Naming the column
		   takes it to 0. `min-width: 0` on the nav alone does NOT fix it: the
		   overflow is the track, not the item. */
		grid-template-columns: minmax(0, 1fr);
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
		display: flex;
		align-items: center;
		gap: var(--space-3);
		text-decoration: none;
		color: var(--text-1);
		min-width: 0;
	}
	.shell__season {
		display: grid;
		gap: 0.1rem;
		min-width: 0;
	}
	.shell__season-name {
		font-family: var(--font-display);
		font-weight: var(--fw-bold);
		font-size: var(--fs-h3);
		letter-spacing: var(--track-label);
	}
	.shell__season-name sup {
		font-size: 0.55em;
		vertical-align: super;
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
		color: var(--success-text);
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
