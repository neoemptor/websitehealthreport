import type { WhrApi } from '../../electron/preload';

/**
 * Single accessor so components never touch window directly, and so a missing
 * preload fails with a clear message rather than "cannot read property of undefined".
 */
export function api(): WhrApi {
	if (typeof window === 'undefined' || !window.api) {
		throw new Error('Preload API unavailable — the renderer is not running inside Electron.');
	}
	return window.api;
}
