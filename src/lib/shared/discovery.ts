/**
 * Competitor discovery: the operator asks Claude (via the Claude Code CLI on
 * their own login) to suggest competitors for the client domain. These types
 * are the whole surface that crosses IPC — strings and booleans only.
 */
export type DiscoveryInput = {
	client: string;
	readSite: boolean;
	webSearch: boolean;
	hint: string;
};

export type Suggestion = { domain: string; name: string; reason: string };

// The analyzer contract's three states, plus cancelled, never collapsed:
// "Claude Code is not here" is a different fact from "Claude Code broke".
export type DiscoveryResult =
	| { status: 'ok'; suggestions: Suggestion[]; note?: string }
	| { status: 'unavailable'; reason: string }
	| { status: 'failed'; error: string }
	| { status: 'cancelled' };

export type DiscoveryPreflight =
	| { available: true; version: string }
	| { available: false; reason: string };

/** Remembered switches. No credential lives here or anywhere else. */
export type DiscoverySettings = { readSite: boolean; webSearch: boolean; hint: string };

export const DEFAULT_DISCOVERY_SETTINGS: DiscoverySettings = {
	readSite: true,
	webSearch: true,
	hint: ''
};
