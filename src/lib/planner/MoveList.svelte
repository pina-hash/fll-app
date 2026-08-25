<script lang="ts">
	/**
	 * THE MOVEMENT LIST: the planner's actual output. One row per segment, in
	 * the units the students' SPIKE Prime code takes -- turn left or right N
	 * degrees, drive N centimeters -- recomputed live as waypoints move.
	 * Fourth-grade reading level; big numbers, because these get read off a
	 * tablet propped next to the mat while someone types them into a program.
	 */
	import type { Move } from './geometry';

	interface Props {
		moves: Move[];
		editable: boolean;
	}

	let { moves, editable }: Props = $props();

	const fmtTurn = (deg: number) => `${Math.abs(Math.round(deg))}°`;
	const fmtDrive = (cm: number) => `${(Math.round(cm * 10) / 10).toFixed(1)} cm`;
</script>

<div class="ml">
	{#if moves.length === 0}
		<p class="ml__empty">
			{editable
				? 'Tap the mat to add your first point. Two points make your first move.'
				: 'No route yet. The Run Captain draws one by tapping the mat.'}
		</p>
	{:else}
		<p class="ml__aim">Before you press go, aim the robot at point 2.</p>
		<ol class="ml__list">
			{#each moves as move, i (i)}
				<li class="ml__row">
					<span class="ml__num">{i + 1}</span>
					<span class="ml__steps">
						{#if move.turnDirection}
							<span class="ml__step ml__step--turn">
								Turn {move.turnDirection}
								<strong>{fmtTurn(move.turnDeg)}</strong>
							</span>
						{/if}
						<span class="ml__step">
							Drive
							<strong>{fmtDrive(move.driveCm)}</strong>
						</span>
					</span>
				</li>
			{/each}
		</ol>
	{/if}
</div>

<style>
	.ml__empty {
		color: var(--text-muted);
		margin: 0;
		padding: var(--space-3) 0;
	}
	.ml__aim {
		color: var(--text-muted);
		font-size: var(--fs-small);
		margin: 0 0 var(--space-2);
	}
	.ml__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.ml__row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-control);
		background: var(--surface-2);
		min-height: 3rem;
	}
	.ml__num {
		flex: none;
		width: 2rem;
		height: 2rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: var(--team-accent, var(--link));
		color: var(--team-accent-ink, var(--accent-ink));
		font-weight: var(--fw-black);
		font-variant-numeric: tabular-nums;
	}
	.ml__steps {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
	}
	.ml__step {
		white-space: nowrap;
	}
	.ml__step strong {
		font-size: var(--fs-h3);
		font-variant-numeric: tabular-nums;
	}
	.ml__step--turn strong {
		color: var(--team-accent, var(--link));
	}
</style>
