<script lang="ts">
	/**
	 * "Team 3", with the name the team chose UNDER it.
	 *
	 * The number is the identity: it is what a mentor calls across a room,
	 * what a tournament sheet carries, and what the login screen shows. The
	 * chosen name is what the children care about, so it is always there and
	 * always secondary. One component so the two never swap places on one
	 * screen and not another.
	 *
	 * The chosen name is filtered in the DATABASE (0018), not here: a student
	 * runtime replays queued writes and a board device posts directly, so a
	 * client-side check is one forgotten screen away from useless. Nothing in
	 * this component sanitises anything, on purpose -- Svelte escapes the
	 * text, and what a name is ALLOWED to be is a rule, and rules live in SQL.
	 */
	interface Props {
		/** teams.name -- "Team 1" through "Team 4". */
		name: string;
		/** teams.short_name -- what the team called itself, or null. */
		shortName?: string | null;
		/** 'inline' puts the two on one line; 'stacked' puts the name under. */
		layout?: 'inline' | 'stacked';
	}

	let { name, shortName = null, layout = 'stacked' }: Props = $props();
</script>

<span class="tn" class:tn--inline={layout === 'inline'}>
	<span class="tn__number">{name}</span>
	{#if shortName}<span class="tn__chosen">{shortName}</span>{/if}
</span>

<style>
	.tn {
		display: inline-grid;
		gap: 0.1em;
		min-width: 0;
	}
	.tn--inline {
		display: inline-flex;
		align-items: baseline;
		gap: 0.5em;
		flex-wrap: wrap;
	}
	.tn__number {
		font: inherit;
		font-weight: var(--fw-bold);
	}
	.tn__chosen {
		font-size: 0.75em;
		font-weight: var(--fw-regular);
		color: var(--text-2);
		overflow-wrap: anywhere;
	}
</style>
