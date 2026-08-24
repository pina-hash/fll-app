<script lang="ts">
	/**
	 * THE COLOUR A TEAM CHOOSES FOR ITSELF.
	 *
	 * WHAT IS CLAIMED IS SHOWN. Every swatch says whether it is free, held by
	 * this team, or held by another team AND WHICH -- because "that one is
	 * gone" is a smaller disappointment than tapping it and being refused.
	 * The list comes from `team_accent_options()`, one statement in SQL of
	 * which colours exist and who holds them, so a stale client cannot invent
	 * a swatch or hide a taken one.
	 *
	 * WHO MAY DO WHAT, decided by the DATABASE and only reflected here:
	 *   any member          may PROPOSE      (team_propose_accent)
	 *   Run Captain, mentor may CONFIRM      (team_confirm_accent)
	 *   mentor              may SET outright (team_set_accent)
	 * `canConfirm` is strategy_can_edit()'s own answer, fetched by the page,
	 * so the affordance and the enforcement cannot drift.
	 *
	 * THE RACE IS NOT HANDLED HERE. Two children tapping the same swatch in
	 * the same second are resolved by a partial unique index in Postgres; the
	 * loser gets a sentence naming the winner, which this component simply
	 * shows. Nothing here tries to be clever about it, and nothing depends on
	 * a refetch arriving in time.
	 *
	 * COLOUR IS NEVER THE ONLY SIGNAL. Every swatch carries its name, and the
	 * chosen one is marked in words as well as in colour.
	 */
	import { ACCENT_LABEL, type TeamAccent } from '$lib/console/types';

	export interface AccentOption {
		accent: TeamAccent;
		taken_by_team_id: string | null;
		taken_by: string | null;
	}

	interface Props {
		teamId: string;
		teamName: string;
		options: AccentOption[];
		current: TeamAccent | null;
		proposed: TeamAccent | null;
		proposedByName: string | null;
		/** May this caller confirm? strategy_can_edit()'s own answer. */
		canConfirm: boolean;
		/** May this caller propose? Any member of this team. */
		canPropose: boolean;
		/** A mentor may set any team's colour and may clear it. */
		isMentor: boolean;
		busy?: boolean;
		message?: string;
		onPropose?: (accent: TeamAccent) => void;
		onConfirm?: (accent: TeamAccent | null) => void;
		onSet?: (accent: TeamAccent | null) => void;
	}

	let {
		teamId,
		teamName,
		options,
		current,
		proposed,
		proposedByName,
		canConfirm,
		canPropose,
		isMentor,
		busy = false,
		message = '',
		onPropose,
		onConfirm,
		onSet
	}: Props = $props();

	function stateOf(o: AccentOption): 'ours' | 'free' | 'taken' {
		if (o.taken_by_team_id === teamId) return 'ours';
		return o.taken_by_team_id ? 'taken' : 'free';
	}

	function pick(o: AccentOption) {
		if (busy) return;
		const state = stateOf(o);
		// A mentor may take a colour off nobody, but not off another team by
		// tapping: that needs clearing the other team first, and the RPC says
		// so. Everyone else can only reach for a free colour.
		if (state === 'taken') return;
		if (isMentor) onSet?.(o.accent);
		else if (canConfirm) onConfirm?.(o.accent);
		else if (canPropose) onPropose?.(o.accent);
	}

	let canTap = $derived(isMentor || canConfirm || canPropose);
</script>

<section class="ap">
	<div class="ap__head">
		<h3 class="ap__title">Team colour</h3>
		<p class="ap__now">
			{#if current}
				<span class="accent-dot" data-accent={current}></span>
				{teamName} is <strong>{ACCENT_LABEL[current]}</strong>.
			{:else}
				{teamName} has not chosen a colour yet.
			{/if}
		</p>
	</div>

	{#if proposed && proposed !== current}
		<p class="ap__proposed">
			<span class="accent-dot" data-accent={proposed}></span>
			<span>
				<strong>{ACCENT_LABEL[proposed]}</strong> is suggested{proposedByName
					? ` by ${proposedByName}`
					: ''}.
				{#if canConfirm}
					The Run Captain or a mentor says yes.
				{:else}
					Waiting on the Run Captain or a mentor.
				{/if}
			</span>
			{#if canConfirm}
				<button
					class="btn btn--primary btn--small"
					type="button"
					disabled={busy}
					onclick={() => (isMentor ? onSet?.(proposed) : onConfirm?.(proposed))}
				>
					Yes, use it
				</button>
			{/if}
		</p>
	{/if}

	{#if message}
		<p class="error ap__msg" role="alert">{message}</p>
	{/if}

	<ul class="ap__grid" role="list">
		{#each options as o (o.accent)}
			{@const state = stateOf(o)}
			<li>
				<button
					class="ap__swatch"
					class:ap__swatch--ours={state === 'ours'}
					class:ap__swatch--taken={state === 'taken'}
					type="button"
					data-accent={o.accent}
					data-state={state}
					disabled={busy || state === 'taken' || !canTap}
					aria-pressed={state === 'ours'}
					onclick={() => pick(o)}
				>
					<span class="ap__chip"></span>
					<span class="ap__name">{ACCENT_LABEL[o.accent]}</span>
					<span class="ap__state">
						{#if state === 'ours'}
							Ours
						{:else if state === 'taken'}
							{o.taken_by}
						{:else if !canTap}
							Free
						{:else if isMentor || canConfirm}
							Free, tap to take
						{:else}
							Free, tap to suggest
						{/if}
					</span>
				</button>
			</li>
		{/each}
	</ul>

	{#if isMentor && current}
		<button class="btn btn--ghost btn--small" type="button" disabled={busy} onclick={() => onSet?.(null)}>
			Give the colour back
		</button>
	{/if}

	{#if !canTap}
		<p class="small muted">Someone on the team can suggest a colour from their own screen.</p>
	{/if}
</section>

<style>
	.ap {
		display: grid;
		gap: var(--space-3);
	}
	.ap__title {
		margin: 0;
		font-size: var(--fs-h3);
	}
	.ap__now {
		margin: var(--space-1) 0 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-2);
	}
	.ap__proposed {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-3);
		margin: 0;
		padding: var(--space-3);
		border: 1px solid var(--boundary);
		border-radius: var(--radius-card);
		background: var(--surface-1);
	}
	.ap__msg {
		margin: 0;
	}

	.ap__grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
		gap: var(--space-2);
	}

	/* 44px minimum, on every one of them: the fingers doing this are nine. */
	.ap__swatch {
		width: 100%;
		min-height: 3.5rem;
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-rows: auto auto;
		align-items: center;
		gap: 0 var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--boundary);
		border-radius: var(--radius-control);
		background: var(--surface-0);
		color: var(--text-1);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.ap__swatch:disabled {
		cursor: default;
	}
	.ap__chip {
		grid-row: 1 / span 2;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: var(--radius-control);
		background: var(--team-accent);
		border: 1px solid var(--boundary);
	}
	.ap__name {
		font-weight: var(--fw-bold);
	}
	.ap__state {
		grid-column: 2;
		font-size: var(--fs-label);
		color: var(--text-3);
	}
	.ap__swatch--ours {
		border-color: var(--team-accent);
		border-width: 2px;
		background: var(--team-accent-wash);
	}
	.ap__swatch--ours .ap__state {
		color: var(--text-2);
		font-weight: var(--fw-bold);
	}
	.ap__swatch--taken {
		opacity: 0.55;
	}
	.ap__swatch--taken .ap__chip {
		/* A held colour is shown, not hidden: a team can see what is gone. */
		opacity: 0.6;
	}
</style>
