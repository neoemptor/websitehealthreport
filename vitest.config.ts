import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// SvelteKit's own $lib alias is wired up by the sveltekit() Vite plugin,
	// which this plain vitest config does not load; every test file so far
	// only ever used $lib in a type-only import (erased before resolution),
	// so the gap was invisible until severity.ts needed a runtime value from
	// $lib/shared/geo.
	resolve: {
		alias: {
			$lib: path.resolve(__dirname, 'src/lib')
		}
	},
	test: {
		include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
		environment: 'node'
	}
});
