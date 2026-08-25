<script lang="ts">
	/**
	 * THE WORKED EXAMPLE, rendered through the REAL RoutePlanner so it looks
	 * exactly like a team's own screen: two launches against real missions,
	 * a route that starts and ends in Base, and a movement list with numbers
	 * in it.
	 *
	 * WHY IT CANNOT BE EDITED OR DELETED, AND HOW THAT IS ENFORCED: it is
	 * content (src/lib/content/example-strategy.ts), not rows. canEdit is
	 * false so every edit affordance stays hidden; no onPersist is wired so
	 * nothing could reach a queue; isMentor is false so no dot can be moved;
	 * and there is no database row behind any of it, so there is nothing a
	 * student, a captain or RLS itself could delete or overwrite. A team's
	 * own plan lives on their plan screen and this page never touches it.
	 */
	import RoutePlanner from './RoutePlanner.svelte';
	import {
		exampleMatSetup,
		exampleMissions,
		exampleRobot,
		exampleStrategy
	} from '$lib/content/example-strategy';

	interface Props {
		/** Where the back button points: the caller's own planner or console. */
		backHref: string;
		backLabel?: string;
	}

	let { backHref, backLabel = 'Back to our plan' }: Props = $props();

	const missions = exampleMissions();
	const strategies = [exampleStrategy()];
	const robot = exampleRobot();
	const matSetup = exampleMatSetup();
</script>

<div class="ex">
	<div class="ex__banner" role="note">
		<span class="ex__tag">Example</span>
		<p class="ex__text">
			This is an example plan, so your team can see what a finished one looks like: two
			launches, real missions, and a route that starts and ends in Base. Nobody can change
			it, and it is not your team's plan. The mission dots here are example spots, not the
			real rulebook spots.
		</p>
		<a class="btn btn--secondary ex__back" href={backHref}>{backLabel}</a>
	</div>

	<RoutePlanner
		team={{ id: 'example-team', name: 'Example team' }}
		isMentor={false}
		canEdit={false}
		{missions}
		{strategies}
		{robot}
		{matSetup}
		viewOnlyNote="Look around: tap a launch to see its route and its numbers."
		autoCoach={false}
	/>
</div>

<style>
	.ex {
		display: grid;
		gap: var(--space-4);
	}
	.ex__banner {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
		padding: var(--space-4);
		border: 2px dashed var(--boundary);
		border-radius: var(--radius-card);
		background: var(--surface-1);
	}
	.ex__tag {
		display: inline-flex;
		align-items: center;
		padding: 0 var(--space-3);
		min-height: 2rem;
		border-radius: var(--radius-control);
		background: var(--accent);
		color: var(--accent-ink);
		font-weight: var(--fw-black);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		font-size: var(--fs-label);
	}
	.ex__text {
		margin: 0;
	}
	.ex__back {
		margin-top: var(--space-1);
	}
</style>
