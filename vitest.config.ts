import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

/**
 * Deliberately standalone, NOT an extension of vite.config.ts: the tests are
 * node-side integration tests against the local Supabase stack and need none
 * of the SvelteKit plugin.
 *
 * `.env.test` holds the local stack's DEFAULT keys (the same on every machine
 * that runs `supabase start`); it is committed on purpose and contains no
 * secret. Set the same names in the environment to point the suite elsewhere.
 */
loadEnv({ path: fileURLToPath(new URL('./.env.test', import.meta.url)) });

export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url))
		}
	},
	test: {
		environment: 'node',
		// tests/ holds the integration suite, which needs the local stack. The
		// codegen control suite lives beside the emitter it breaks on purpose and
		// needs no database at all; both run in the one command.
		include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
		// ONE shared database for the whole run. Files create run-tagged rows and
		// remove them in afterAll; running files concurrently would make one
		// file's cleanup race another's seeding. Keep this false.
		fileParallelism: false,
		hookTimeout: 60_000,
		testTimeout: 30_000
	}
});
