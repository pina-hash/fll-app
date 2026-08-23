import { parseBoardSnapshot } from '$lib/console/types';
import type { PageServerLoad } from './$types';

/**
 * The first paint comes from the server so the board is readable before the
 * socket is up. Everything after that is the client's realtime feed
 * (`$lib/console/live.svelte.ts`), which refetches this same RPC.
 */
export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const { data, error } = await supabase.rpc('board_live_summary');
	return {
		snapshot: parseBoardSnapshot(data),
		loadError: error?.message ?? null
	};
};
