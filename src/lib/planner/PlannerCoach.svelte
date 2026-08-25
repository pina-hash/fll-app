<script lang="ts">
	/**
	 * THE COACH: the student walkthrough and the planner's inline help, in one
	 * card. It gets a first-time Run Captain from nothing to a working route
	 * without an adult: each step is checked off LIVE from the plan itself, so
	 * a child sees their own tap make the step turn green. It is skippable
	 * (Hide), reopenable (the Help button in the toolbar), and pure: the
	 * parent owns visibility and all the state; this renders it.
	 *
	 * Reading level is fourth grade on purpose. "Launch" and "attachment" are
	 * real FLL words the kids should learn, so each is taught in one sentence
	 * in "Words to know" rather than avoided.
	 */
	interface Props {
		/** False for a teammate who can only look; the steps read differently. */
		editable: boolean;
		hasPlan: boolean;
		waypointCount: number;
		moveCount: number;
		missionCount: number;
		returnsToBase: boolean | null;
		baseMarked: boolean;
		/** Where "See an example plan" points; hidden when absent. */
		exampleHref?: string;
		onHide: () => void;
	}

	let {
		editable,
		hasPlan,
		waypointCount,
		moveCount,
		missionCount,
		returnsToBase,
		baseMarked,
		exampleHref,
		onHide
	}: Props = $props();

	interface Step {
		text: string;
		done: boolean;
		hint?: string;
	}

	let steps = $derived.by<Step[]>(() => {
		if (!editable) return [];
		return [
			{
				text: 'Tap "Start our plan".',
				done: hasPlan
			},
			{
				text: 'Tap the mat in the bottom left corner. That is Base, where your robot starts.',
				done: waypointCount >= 1
			},
			{
				text: 'Tap where the robot should go next. A line appears, and numbers appear under "Robot moves".',
				done: waypointCount >= 2
			},
			{
				text: 'Read the numbers into your robot code: turn first, then drive.',
				done: moveCount >= 1
			},
			{
				text: 'Tap a mission button to add that mission to this trip.',
				done: missionCount >= 1
			},
			{
				text: 'Finish back in Base: make your last dot land inside Base.',
				done: returnsToBase === true,
				hint: baseMarked
					? undefined
					: 'Base is not marked on this mat yet. Your mentor marks it. For now, end near the bottom left corner.'
			}
		];
	});

	let allDone = $derived(steps.length > 0 && steps.every((s) => s.done));
</script>

<section class="coach card" aria-label="How to make your first route">
	<div class="coach__head">
		<h2 class="coach__title">Make your first route</h2>
		<button class="btn btn--ghost coach__hide" type="button" onclick={onHide}>Hide</button>
	</div>

	{#if editable}
		<ol class="coach__steps">
			{#each steps as step, i (i)}
				<li class="coach__step" class:coach__step--done={step.done}>
					<span class="coach__mark" aria-hidden="true">{step.done ? '✓' : i + 1}</span>
					<span class="coach__text">
						{step.text}
						{#if step.hint}<span class="coach__hint">{step.hint}</span>{/if}
					</span>
				</li>
			{/each}
		</ol>
		{#if allDone}
			<p class="coach__done glow">You did it. Your first route is ready to try with the real robot.</p>
		{/if}
	{:else}
		<p class="coach__watch">
			This screen shows your team's robot plan. The Run Captain draws the route by tapping the
			mat, and the app turns it into turn and drive numbers for your robot code. You can look at
			everything here.
		</p>
	{/if}

	{#if exampleHref}
		<a class="btn btn--secondary coach__example" href={exampleHref}>See an example plan</a>
	{/if}

	<details class="coach__words">
		<summary>Words to know</summary>
		<dl class="coach__dl">
			<dt>Launch</dt>
			<dd>
				A launch is one trip. Your robot starts in Base, goes out to do missions, and comes
				back. Then you can touch it, change parts, and launch again.
			</dd>
			<dt>Base</dt>
			<dd>
				Base is the corner area where your robot starts. It is the only place you may touch
				your robot. Start and end every trip in Base, or you lose points when you grab the
				robot.
			</dd>
			<dt>Mission</dt>
			<dd>
				A mission is one job on the mat that scores points, like flipping a rock or moving a
				drone. Each mission button shows its points.
			</dd>
			<dt>Attachment</dt>
			<dd>
				An attachment is the part you clip onto your robot for one trip, like a pusher or a
				hook.
			</dd>
			<dt>The 2:30 bar</dt>
			<dd>
				A match is 2 minutes 30 seconds long. The bar shows how much of that time your plan
				uses. If your plan does not fit, make a route shorter or take out a mission.
			</dd>
		</dl>
	</details>
</section>

<style>
	.coach {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-4);
	}
	.coach__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.coach__title {
		margin: 0;
		font-size: var(--fs-h3);
	}
	.coach__steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.coach__step {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
	}
	.coach__mark {
		flex: none;
		width: 2rem;
		height: 2rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		border: 2px solid var(--boundary);
		background: var(--surface-2);
		color: var(--text-1);
		font-weight: var(--fw-black);
	}
	.coach__step--done .coach__mark {
		background: var(--success);
		border-color: var(--success);
		color: var(--success-ink);
	}
	.coach__step--done .coach__text {
		color: var(--text-muted);
	}
	.coach__text {
		padding-top: 0.2rem;
	}
	.coach__hint {
		display: block;
		color: var(--warning);
		font-size: var(--fs-small);
	}
	.coach__done {
		margin: 0;
	}
	.coach__watch {
		margin: 0;
	}
	.coach__example {
		justify-self: start;
	}
	.coach__words summary {
		cursor: pointer;
		min-height: 2.75rem;
		display: flex;
		align-items: center;
		font-weight: var(--fw-bold);
	}
	.coach__dl {
		margin: 0;
		display: grid;
		gap: var(--space-2);
	}
	.coach__dl dt {
		font-weight: var(--fw-bold);
	}
	.coach__dl dd {
		margin: 0 0 var(--space-2);
	}
</style>
