import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';
import type { Principal } from '$lib/auth/principal';

declare global {
	namespace App {
		/** The verified JWT claims of the current session (null when signed out). */
		interface Claims {
			sub: string;
			email?: string;
			role?: string;
			exp?: number;
			[key: string]: unknown;
		}
		interface Error {
			message: string;
			id?: string;
		}
		interface Locals {
			supabase: SupabaseClient<Database>;
			claims: Claims | null;
			/** Who the session is in THIS app: an active mentor, an active student, or nobody. */
			principal: Principal | null;
		}
		interface PageData {
			claims?: Claims | null;
			principal?: Principal | null;
			supabase?: SupabaseClient<Database>;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
