import type { Analyzer } from '../types';
import {
	ClaudeUnavailableError,
	type findClaude,
	type runClaude
} from '../../discovery/claude-cli';
import { SYSTEM_APPEND, SCHEMA, buildPrompt } from './prompt';
import { parseGeoResponse, type GeoData } from './parse';

export type GeoDeps = {
	runClaude: typeof runClaude;
	findClaude: typeof findClaude;
	/** userData: no project CLAUDE.md or hooks can load from there. */
	cwd: string;
};

/**
 * Generative Engine Optimization: would an AI answer engine cite this site.
 * The judgement is Claude's, made through the operator's own Claude Code
 * login exactly as competitor discovery is, so the analyzer is built from
 * its dependencies rather than importing them — tests hand in a fake CLI.
 *
 * This is the content half of the AI picture; the aeo analyzer covers the
 * technical half (can AI crawlers read the site at all).
 */
export function createGeoAnalyzer(deps: GeoDeps): Analyzer<Record<string, never>> {
	return {
		id: 'geo',
		label: 'GEO',
		// Two Claude processes at a time: each browses several pages, and a
		// batch of nine domains would otherwise open nine at once.
		concurrency: 'limited',
		// Browsing up to six pages and rating them is typically 60–150s; the
		// cap leaves room for a slow site.
		timeoutMs: 300_000,
		defaultSettings: {},

		async preflight() {
			const check = await deps.findClaude();
			return check.available ? { available: true } : { available: false, reason: check.reason };
		},

		async analyze(domain, _settings, signal): Promise<GeoData> {
			if (signal.aborted) throw new Error('Cancelled before Claude Code was started.');

			let result: unknown;
			try {
				result = await deps.runClaude({
					prompt: buildPrompt(domain),
					systemAppend: SYSTEM_APPEND,
					schema: SCHEMA,
					allowedTools: ['WebFetch'],
					signal,
					timeoutMs: 300_000,
					cwd: deps.cwd
				});
			} catch (error) {
				// Login lost between preflight and now is the same fact preflight
				// reports; the orchestrator maps this prefix to "unavailable".
				if (error instanceof ClaudeUnavailableError) {
					throw new Error(`UNAVAILABLE: ${error.message}`);
				}
				throw error;
			}

			return parseGeoResponse(result, domain);
		}
	};
}
