<script lang="ts">
	import {
		COMP_BOT_MANUAL_SIZE,
		COMP_BOT_MANUAL_STEPS,
		COMP_BOT_MANUAL_URL
	} from '$lib/content/resources';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const p = $derived(data.principal);

	/**
	 * EVERY ROLE GETS IN. The robot is the one thing all three populations are
	 * looking at: a mentor planning Friday, a student on a phone, and the shared
	 * iPad propped on the build table. So this page sits directly under /app and
	 * joins no route group -- the mentor group would 403 a student, the student
	 * group would 403 the board, and the Skill Hub's own layout refuses a board
	 * device on purpose. The only guard above it is /app's, which asks for a
	 * principal and nothing else.
	 */
	let isMentor = $derived(p.kind === 'mentor');
	let accent = $derived(p.kind === 'mentor' ? undefined : p.accent);
	let backHref = $derived(p.kind === 'student' ? '/app/me' : p.kind === 'board' ? '/board' : '/app');
	// The Skill Hub 403s a board device (src/routes/app/library/+layout.server.ts),
	// so the board never sees a link into it.
	let canReachHub = $derived(p.kind !== 'board');
</script>

<svelte:head><title>Build the robot</title></svelte:head>

{#snippet body()}
	<p class="eyebrow">BIOGLOW 2026-27</p>
	<h1>Build the robot</h1>
	<p class="lead">
		All four teams build the same robot this season. The manual is the whole build, step 1 to step
		{COMP_BOT_MANUAL_STEPS}, from the drive wheels up to the SPIKE Prime hub.
	</p>

	<!--
		NOTHING HERE PULLS THE FILE UNTIL A THUMB SAYS SO. The manual is 23 MB
		and these tablets are on school wifi, so there is no <embed>, no <iframe>,
		no <object> and no PDF viewer in front of it: any of those start the
		transfer while the page is still painting, and a viewer would also make a
		nine-year-old wait for a library to load before seeing step 1.

		`data-sveltekit-reload` and `preload-data="off"` say the same thing to the
		router: the body carries preload-data="hover", and a path that is a static
		file rather than a route has no business being fetched because a finger
		brushed past it.
	-->
	<section class="card manual">
		<h2>The build manual</h2>
		<p class="manual__facts">
			PDF &middot; {COMP_BOT_MANUAL_STEPS} steps &middot; {COMP_BOT_MANUAL_SIZE}
		</p>
		<p class="manual__warn">
			That is a big file. On a phone it can take a minute to open, and it uses your data. On school
			wifi, open it once and leave the tab open instead of opening it again and again. Nothing
			starts loading until you tap.
		</p>
		<div class="manual__acts">
			<a
				class="btn btn--primary manual__go"
				href={COMP_BOT_MANUAL_URL}
				target="_blank"
				rel="noreferrer"
				data-sveltekit-reload
				data-sveltekit-preload-data="off"
			>
				Open the manual
			</a>
			<a
				class="btn btn--secondary manual__go"
				href={COMP_BOT_MANUAL_URL}
				download
				data-sveltekit-reload
				data-sveltekit-preload-data="off"
			>
				Save it to this device
			</a>
		</div>
		<p class="muted small">
			Saving it once means you can read it later with no wifi at all. Do that on the team iPad
			before you carry it to the build table.
		</p>
	</section>

	<h2>How to build it</h2>
	<ol class="how">
		<li>Go in order. Step 1, then step 2. Skipping ahead is how pieces go missing.</li>
		<li>Work in twos. One person finds the pieces, one person builds, then swap.</li>
		<li>Every few steps, hold your robot next to the picture and check it matches.</li>
		<li>Finish the whole driving base before you build a single attachment.</li>
	</ol>

	{#if canReachHub}
		<p class="muted">
			Want to write down how far your team has got, or who is building which part? That question
			lives on <a href="/app/library/robot/ROBOT4">The Driving Base</a> in the Skill Hub.
		</p>
	{/if}
{/snippet}

{#if isMentor}
	{@render body()}
{:else}
	<!-- Students and board devices are bare under /app (see app/+layout.svelte),
	     so this screen carries its own header, the same shape the Skill Hub uses. -->
	<div class="bare" data-accent={accent}>
		<header class="bare__top">
			<a class="bare__back" href={backHref}>Back</a>
			<span class="bare__title">Build the robot</span>
		</header>
		<main class="bare__main">
			{@render body()}
		</main>
	</div>
{/if}

<style>
	h1 {
		margin: var(--space-1) 0 var(--space-2);
	}
	h2 {
		margin-top: var(--space-6);
	}
	.lead {
		color: var(--text-2);
		max-width: 42rem;
	}
	.manual {
		margin-top: var(--space-5);
	}
	.manual h2 {
		margin-top: 0;
	}
	.manual__facts {
		color: var(--text-2);
		font-weight: var(--fw-bold);
		margin: var(--space-2) 0 var(--space-2);
	}
	/* THE SIZE WARNING IS BODY COPY, NOT A STATUS. --warning is for a thing that
	   is going wrong; a large file is just a fact a student deserves before they
	   tap, so it takes the ink ladder and sits where the thumb already is. */
	.manual__warn {
		color: var(--text-2);
		max-width: 42rem;
	}
	.manual__acts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin: var(--space-4) 0 var(--space-3);
	}
	/* 56px slabs: a student taps these, and a link they are meant to tap is a
	   button, not a line of text. */
	.manual__go {
		min-height: 3.5rem;
		flex: 1 1 14rem;
		text-decoration: none;
		font-size: var(--fs-h3);
	}
	.how {
		margin: var(--space-3) 0 0;
		padding-left: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		color: var(--text-1);
		max-width: 42rem;
	}

	/* --- the bare shell students and board devices get --------------------- */
	.bare {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background:
			radial-gradient(120% 60% at 50% 0%, var(--team-accent-wash), transparent 70%),
			var(--surface-0);
	}
	.bare__top {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--boundary);
		background: var(--surface-1);
	}
	.bare__back {
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
	/* --text-faint IS DERIVED AGAINST THE THREE SURFACES AND NOT AGAINST THE
	   TEAM WASH, AND THIS SHELL PAINTS THE WASH. Measured on the dark ground
	   with the wash at full strength (lime resolves to #2c3c23 at 50% 0%, which
	   is where the top of this column sits) the eyebrow landed at 3.83 against
	   a 4.5 floor, while measuring clean against --surface-0 alone. The wash is
	   a fourth ground -- --team-accent's own derivation already treats it as
	   one -- so the single piece of faint type on this screen steps up a rung.
	   The flat mentor rendering keeps the shared value; it has no wash. */
	.bare .eyebrow {
		color: var(--text-2);
	}
	.bare__title {
		font-family: var(--font-display);
		font-weight: var(--fw-bold);
		font-size: var(--fs-h3);
		letter-spacing: var(--track-wide);
		color: var(--text-1);
	}
	.bare__main {
		flex: 1;
		/* minmax-free, but the rule is the same one the console shell states: a
		   fixed-width child must not size this column. */
		min-width: 0;
		padding: var(--space-4) var(--space-3) var(--space-6);
		max-width: 40rem;
		width: 100%;
		margin: 0 auto;
	}
</style>
