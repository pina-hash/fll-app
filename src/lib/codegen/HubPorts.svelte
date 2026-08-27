<script lang="ts">
	/**
	 * THE HUB, FROM ABOVE, WITH ITS SIX PORTS. ONE QUESTION INSTEAD OF SIX.
	 *
	 * This replaces two motor dropdowns, a "movement pair" text box, two colour
	 * dropdowns and a row of six checkboxes. All of them were asking the same
	 * thing: what is plugged into which port. A child holding a driving base can
	 * answer that by looking at it, and cannot answer "movement pair" at all.
	 *
	 * Tap a port, pick what is in it. The rules that keep the answer usable live
	 * in ports.ts, not here: this component draws the map and reports taps.
	 *
	 * PORT LAYOUT IS THE REAL ONE. A SPIKE Prime hub has A, B and C down the
	 * left edge and D, E and F down the right, with the 5x5 light matrix in the
	 * middle. Drawing them anywhere else would make the picture useless for the
	 * one job it has, which is letting a child match it against the brick in
	 * front of them.
	 *
	 * DRAWN BY THIS REPO. No LEGO artwork is fetched, mirrored or reproduced;
	 * this is a rounded rectangle, six pads and a dot grid. Every colour is a
	 * token.
	 */
	import {
		PORT_ROLES,
		ROLE_LABEL,
		ROLE_SHORT,
		portsWithRole,
		roleAvailable,
		type Port,
		type PortMap,
		type PortRole
	} from './ports';

	interface Props {
		map: PortMap;
		onassign: (port: Port, role: PortRole) => void;
	}
	let { map, onassign }: Props = $props();

	/** Which port's chooser is open. Null closes it. */
	let open = $state<Port | null>(null);

	const LEFT: Port[] = ['A', 'B', 'C'];
	const RIGHT: Port[] = ['D', 'E', 'F'];
	const MATRIX = Array.from({ length: 25 }, (_, i) => i);

	function choose(port: Port, role: PortRole) {
		onassign(port, role);
		open = null;
	}

	const colourPorts = $derived(portsWithRole(map, 'colour'));
</script>

<div class="hp">
	<div class="hp__hub" role="group" aria-label="The six ports on the hub">
		<div class="hp__col">
			{#each LEFT as port (port)}
				<button
					class="hp__port"
					class:hp__port--on={open === port}
					class:hp__port--used={map[port] !== 'empty'}
					type="button"
					aria-expanded={open === port}
					onclick={() => (open = open === port ? null : port)}
				>
					<span class="hp__letter">{port}</span>
					<span class="hp__role">{ROLE_SHORT[map[port]]}</span>
				</button>
			{/each}
		</div>

		<div class="hp__face" aria-hidden="true">
			{#each MATRIX as dot (dot)}<span class="hp__dot"></span>{/each}
		</div>

		<div class="hp__col">
			{#each RIGHT as port (port)}
				<button
					class="hp__port"
					class:hp__port--on={open === port}
					class:hp__port--used={map[port] !== 'empty'}
					type="button"
					aria-expanded={open === port}
					onclick={() => (open = open === port ? null : port)}
				>
					<span class="hp__letter">{port}</span>
					<span class="hp__role">{ROLE_SHORT[map[port]]}</span>
				</button>
			{/each}
		</div>
	</div>

	{#if open}
		{@const port = open}
		<div class="hp__chooser">
			<p class="hp__ask">What is in port <strong>{port}</strong>?</p>
			<div class="hp__roles">
				{#each PORT_ROLES as role (role)}
					{@const can = roleAvailable(map, port, role)}
					<button
						class="hp__role-btn"
						class:hp__role-btn--on={map[port] === role}
						type="button"
						disabled={!can.ok}
						title={can.ok ? '' : can.why}
						onclick={() => choose(port, role)}
					>
						{ROLE_LABEL[role]}
					</button>
				{/each}
			</div>
			{#each PORT_ROLES.filter((r) => !roleAvailable(map, port, r).ok) as role (role)}
				<p class="hp__why">{roleAvailable(map, port, role).why}</p>
			{/each}
		</div>
	{:else}
		<p class="hp__hint">Tap a port to say what is in it.</p>
	{/if}

	<!--
		THE DERIVED ANSWER, SHOWN. Which colour sensor counts as "left" is decided
		by port letter, so it is printed here rather than left to be discovered:
		a team that wants them the other way round swaps the plugs.
	-->
	{#if colourPorts.length === 2}
		<p class="hp__derived">
			Left colour sensor: <strong>{colourPorts[0]}</strong> &middot; right colour sensor:
			<strong>{colourPorts[1]}</strong>
		</p>
	{/if}
</div>

<style>
	.hp {
		display: grid;
		gap: var(--space-3);
	}
	/* The hub, from above: two columns of ports with the light matrix between.
	   BOTH COLUMNS STRETCH AND EACH SPLITS ITS HEIGHT IN THREE, so A sits beside
	   D whatever the labels do. Centring them instead let one wrapped label
	   ("RIGHT DRIVE", at 375) push its own column out of step with the other,
	   and a hub picture whose ports do not line up is not a hub picture. */
	.hp__hub {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: var(--space-2);
		align-items: stretch;
		/* A hub is a brick, not a bar. Left to fill a 1440 column it became a
		   metre-wide rectangle with the ports pinned to opposite edges, which
		   is not the shape a child is holding. */
		width: 100%;
		max-width: 26rem;
		margin-inline: auto;
		padding: var(--space-3);
		border-radius: var(--radius-card);
		border: 2px solid var(--boundary);
		background: var(--bg2);
	}
	.hp__col {
		display: grid;
		grid-template-rows: repeat(3, 1fr);
		gap: var(--space-2);
	}
	/* 56px is the student runtime's slab, and the sign-in roster tiles are 88.
	   A port is tapped by a thumb on a shared iPad, so it matches the slab. */
	.hp__port {
		display: grid;
		gap: 0.1rem;
		align-content: center;
		min-height: 3.5rem;
		min-width: 5.5rem;
		padding: var(--space-2);
		border-radius: var(--radius-control);
		border: 2px solid var(--boundary);
		background: var(--bg1);
		color: var(--text-muted);
		font: inherit;
		text-align: center;
		cursor: pointer;
	}
	.hp__port--used {
		border-color: var(--accent-text);
		background: var(--accent-soft);
		color: var(--text-body);
	}
	.hp__port--on {
		border-color: var(--accent-text);
		background: var(--accent);
		color: var(--accent-ink);
	}
	.hp__letter {
		font-family: var(--font-mono);
		font-size: var(--fs-h3);
		font-weight: var(--fw-bold);
	}
	.hp__role {
		font-size: var(--fs-label);
		font-weight: var(--fw-bold);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
	}
	/* The 5x5 light matrix. Decorative, and the thing that makes the rectangle
	   read as a hub rather than as a box.
	   THE MATRIX IS SQUARE AND STAYS SQUARE. Its track was `1fr`, so on a
	   desktop column it spread the five dots across 380px and the hub read as
	   two lists with a dotted line between them. Fixed tracks and a centred
	   box keep it the shape of the real thing at every width. */
	.hp__face {
		display: grid;
		grid-template-columns: repeat(5, 0.4rem);
		gap: 0.35rem;
		padding: var(--space-3);
		justify-content: center;
		justify-self: center;
		align-self: center;
	}
	.hp__dot {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 1px;
		background: var(--fg-structure);
		opacity: 0.5;
	}

	.hp__chooser {
		padding: var(--space-3);
		border-radius: var(--radius-card);
		border: 1px solid var(--boundary);
		background: var(--surface-1);
	}
	.hp__ask {
		margin: 0 0 var(--space-3);
		font-size: var(--fs-h3);
		font-weight: var(--fw-bold);
		color: var(--text-body);
	}
	.hp__roles {
		display: grid;
		gap: var(--space-2);
	}
	.hp__role-btn {
		min-height: 3.5rem;
		padding: 0 var(--space-4);
		border-radius: var(--radius-control);
		border: 2px solid var(--boundary);
		background: var(--surface-2);
		color: var(--text-body);
		font: inherit;
		font-size: var(--fs-h3);
		font-weight: var(--fw-bold);
		cursor: pointer;
	}
	.hp__role-btn--on {
		border-color: var(--accent-text);
		background: var(--accent);
		color: var(--accent-ink);
	}
	.hp__role-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.hp__why,
	.hp__hint,
	.hp__derived {
		margin: var(--space-2) 0 0;
		font-size: var(--fs-small);
		color: var(--text-muted);
	}
	.hp__derived {
		color: var(--text-body);
	}

	@media (min-width: 30rem) {
		.hp__roles {
			grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		}
	}
</style>
