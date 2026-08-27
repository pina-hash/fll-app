<script lang="ts">
	import { page } from '$app/state';
	import CodegenPage from '$lib/codegen/CodegenPage.svelte';
	import type { CodegenData, CodegenSave, CodegenSaveInput } from '$lib/codegen/storage';
	import type { TeamAccent } from '$lib/console/types';

	/**
	 * The REAL component with fixture props, the way /dev/route-planner and
	 * /dev/student-screen do it. A harness that rendered its own copy of the
	 * markup would be testing nothing.
	 *
	 * TWO PAYLOADS, ONE COMPONENT, which is the claim this harness exists to
	 * show. `?as=mentor` is the mentor surface's payload (a team picked from a
	 * URL, a longer name, a Back that goes to the picker); the default is the
	 * student's (their own team, Back to My Screen). Nothing else differs,
	 * because nothing else is allowed to.
	 *
	 * `?save=off` drops the transport, which is how "presence of a transport is
	 * presence of a control" is checked by eye rather than asserted in a comment.
	 */
	const asMentor = $derived(page.url.searchParams.get('as') === 'mentor');
	const wantsSave = $derived(page.url.searchParams.get('save') !== 'off');

	const fixture: CodegenData = { configs: [], calibrations: [], unavailable: null };

	/** Two teams, two accents, so the fixture proves the accent is data. */
	const STUDENT_TEAM: { id: string; name: string; accent: TeamAccent | null } = {
		id: 'dev-team',
		name: 'Team 1',
		accent: 'teal'
	};
	const MENTOR_TEAM: { id: string; name: string; accent: TeamAccent | null } = {
		id: 'dev-team',
		name: 'Team 3',
		accent: 'orange'
	};

	/**
	 * A transport that writes NOTHING and reports what it was handed.
	 *
	 * There is no session here, so a real one would be a lie. This one is the
	 * useful half: it makes the exact millimetres that would have been sent
	 * visible on screen, which is how the units rule gets checked in a browser
	 * rather than only in a test. Open a config in inches, change nothing, press
	 * Save, and read the number that came out.
	 */
	let sent = $state<CodegenSaveInput | null>(null);
	const stubSave: CodegenSave = async (input) => {
		sent = input;
		return { ok: true, id: null, error: null };
	};
</script>

<svelte:head><title>Codegen harness</title></svelte:head>

<nav class="dh">
	<a href="/dev/codegen">student payload</a>
	<a href="/dev/codegen?as=mentor">mentor payload</a>
	<a href="/dev/codegen?save=off">no transport</a>
	<span class="dh__now">
		{asMentor ? 'mentor' : 'student'} &middot; {wantsSave ? 'transport supplied' : 'no transport'}
	</span>
</nav>

{#if sent}
	<pre class="dh__sent">saved (nothing written): wheel {sent.config.wheelDiameterMm} mm &middot; track {sent.config
			.trackWidthMm} mm &middot; gears {sent.config.gearRatio} &middot; white {sent.calibration
			.white} black {sent.calibration.black}</pre>
{/if}

{#key `${asMentor}:${wantsSave}`}
	<CodegenPage
		save={wantsSave ? stubSave : null}
		team={asMentor ? MENTOR_TEAM : STUDENT_TEAM}
		data={fixture}
		backHref={asMentor ? '/app/codegen' : '/dev'}
	/>
{/key}

<style>
	.dh {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		background: var(--surface-2);
		font-size: var(--fs-small);
	}
	.dh__now {
		color: var(--text-muted);
	}
	.dh__sent {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		background: var(--surface-2);
		color: var(--text-body);
		font-family: var(--font-mono);
		font-size: var(--fs-small);
		overflow-x: auto;
	}
</style>
