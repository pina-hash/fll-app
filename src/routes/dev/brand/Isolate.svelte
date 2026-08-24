<script lang="ts">
	/**
	 * A FRESH, EMPTY BRAND REGISTER for whatever is inside it.
	 *
	 * The standalone rule is about "the same material", which this app reads
	 * as one surface. To ATTEMPT the violation from inside a page that is
	 * itself a surface with two full logos in its footer, the harness needs a
	 * way to say "pretend this box is its own surface". That is all this does:
	 * it calls provideBrandRegister(), which overrides the context for its
	 * children with an empty one.
	 *
	 * It exists only in the dev harness, and is not exported from $lib/brand,
	 * because an app surface that wanted one would be a surface trying to
	 * escape the footer's logos.
	 */
	import { provideBrandRegister } from '$lib/brand/context';

	let { children }: { children: import('svelte').Snippet } = $props();

	provideBrandRegister();
</script>

<div class="iso">{@render children()}</div>

<style>
	.iso {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
		padding: var(--space-3);
		border: 1px dashed var(--boundary);
		border-radius: var(--radius-card);
		min-height: 6rem;
	}
</style>
