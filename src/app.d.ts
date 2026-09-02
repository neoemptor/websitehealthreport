// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
import type { WhrApi } from '../electron/preload';

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface Platform {}
	}

	interface Window {
		api: WhrApi;
	}
}

export {};
