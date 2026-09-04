import type { AnalyzerId, Run } from '../src/lib/shared/types';
import { normaliseDomain } from '../src/lib/shared/url';
import { createRegistry } from './analyzers/registry';
import { lighthouseAnalyzer } from './analyzers/lighthouse';
import { keywordsAnalyzer } from './analyzers/keywords';
import { oldSeoAnalyzer } from './analyzers/oldseo';
import { waybackAnalyzer } from './analyzers/wayback';
import { securityAnalyzer } from './analyzers/security';
import { aeoAnalyzer } from './analyzers/aeo';
import { seoQuakeAnalyzer } from './analyzers/seoquake';
import { contentAnalyzer } from './analyzers/content';
import { createTrafficEstimatedAnalyzer } from './analyzers/traffic-estimated';
import { createTrafficOwnedAnalyzer } from './analyzers/traffic-owned';
import type { CredentialStore } from './credentials';
import { assertRunId } from './run/id';
import { Orchestrator } from './run/orchestrator';
import { RunStorage } from './run/storage';
import { SettingsStore, type Settings } from './settings/store';
import type {
	DiscoveryInput,
	DiscoveryPreflight,
	DiscoveryResult
} from '../src/lib/shared/discovery';
import {
	findClaude,
	runClaude,
	ClaudeUnavailableError,
	ClaudeFailedError
} from './discovery/claude-cli';
import { fetchHomepage } from './discovery/homepage';
import { suggestCompetitors, type CompetitorDeps } from './discovery/competitors';

// This module must be loadable (and its handlers testable) with no
// dependency on the desktop-runtime package being resolvable at all —
// hence no import of any kind from it, not even a type-only one.
export type Logger = { info(m: string, d?: unknown): void; error(m: string, d?: unknown): void };

// The only credentials the renderer may write. A refresh token is written
// solely by the Google consent flow in the main process, so its key is
// deliberately absent: a compromised renderer cannot plant one.
const ALLOWED_CREDENTIAL_KEYS = new Set([
	'semrush.apiKey',
	'google.clientId',
	'google.clientSecret'
]);

function assertCredentialKey(key: string): string {
	if (!ALLOWED_CREDENTIAL_KEYS.has(key)) throw new Error('Unknown credential.');
	return key;
}

export type HandlerDeps = {
	userDataDir: string;
	credentials: CredentialStore;
	emitProgress: (run: Run) => void;
	logger: Logger;
	/** Test seams for competitor discovery; production uses the real modules. */
	discovery?: Partial<CompetitorDeps> & { findClaude?: typeof findClaude };
};

export type StartRunInput = {
	client: string;
	competitors: string[];
	enabledAnalyzers: AnalyzerId[];
};

export function buildHandlers(deps: HandlerDeps) {
	// Owned traffic is read only for the site whose owner connected their
	// Google account, so the analyzer needs to know which domain in a run is
	// the client. Keyed by normalised client URL, holding a refcount of the
	// runs currently executing for that client — two overlapping runs sharing
	// a client (e.g. a resume racing a fresh start) must both settle before
	// the client stops being a client.
	const clientsInFlight = new Map<string, number>();
	const isClient = (domain: string): boolean => (clientsInFlight.get(domain) ?? 0) > 0;
	const addClientInFlight = (domain: string): void => {
		clientsInFlight.set(domain, (clientsInFlight.get(domain) ?? 0) + 1);
	};
	const removeClientInFlight = (domain: string): void => {
		const count = clientsInFlight.get(domain) ?? 0;
		if (count <= 1) clientsInFlight.delete(domain);
		else clientsInFlight.set(domain, count - 1);
	};

	const registry = createRegistry([
		lighthouseAnalyzer,
		keywordsAnalyzer,
		oldSeoAnalyzer,
		waybackAnalyzer,
		securityAnalyzer,
		aeoAnalyzer,
		seoQuakeAnalyzer,
		contentAnalyzer,
		createTrafficEstimatedAnalyzer(deps.credentials),
		createTrafficOwnedAnalyzer(deps.credentials, isClient)
	]);
	const storage = new RunStorage(deps.userDataDir);
	const settingsStore = new SettingsStore(deps.userDataDir);
	const orchestrator = new Orchestrator(registry, storage, deps.emitProgress);

	const discoveryDeps: CompetitorDeps = {
		runClaude: deps.discovery?.runClaude ?? runClaude,
		fetchHomepage: deps.discovery?.fetchHomepage ?? fetchHomepage,
		cwd: deps.discovery?.cwd ?? deps.userDataDir,
		timeoutMs: deps.discovery?.timeoutMs
	};
	const probeClaude = deps.discovery?.findClaude ?? findClaude;

	// Fire-and-forget: startRun must return as soon as the run exists, so the
	// client is forgotten on a later turn rather than blocking the caller.
	const forgetClientWhenSettled = (id: string, client: string): void => {
		void orchestrator
			.settled(id)
			.catch(() => undefined)
			.finally(() => removeClientInFlight(client));
	};

	// One discovery at a time: a second click replaces the first, and the
	// replaced request reports cancelled rather than racing to the panel.
	let inFlight: AbortController | null = null;

	return {
		async startRun(input: StartRunInput): Promise<Run> {
			// Normalisation happens once, here, so no analyzer ever sees raw input.
			const client = normaliseDomain(input.client);

			// Deduped after normalisation, because two spellings of one site
			// ("cjsgaragedoors.com.au" and "https://cjsgaragedoors.com.au/")
			// only collide once they are the same string. A competitor equal to
			// the client is dropped rather than duplicated: the client row wins,
			// so the same domain is never analysed twice or shown twice.
			const competitors: string[] = [];
			for (const raw of input.competitors) {
				const domain = normaliseDomain(raw);
				if (domain === client || competitors.includes(domain)) continue;
				competitors.push(domain);
			}
			const settings = await settingsStore.read();

			deps.logger.info('run:start', { client, competitors });
			addClientInFlight(client);
			const run = await orchestrator.start({
				client,
				competitors,
				enabledAnalyzers: input.enabledAnalyzers,
				settings: settings.analyzers
			});
			forgetClientWhenSettled(run.id, client);
			return run;
		},

		async resumeRun(id: string): Promise<Run> {
			const runId = assertRunId(id);
			const settings = await settingsStore.read();
			// The client is only known from the stored run, so it is read before
			// the resume rather than passed in.
			const existing = await storage.load(runId);
			addClientInFlight(existing.client);
			const run = await orchestrator.resume(runId, settings.analyzers);
			forgetClientWhenSettled(run.id, existing.client);
			return run;
		},

		/**
		 * Not exposed over IPC. The registry closes over this, and tests assert
		 * that a run's client is a client for the life of the run.
		 */
		isClient,

		async setCredential(key: string, value: string): Promise<void> {
			await deps.credentials.set(assertCredentialKey(key), value);
		},

		// Deliberately no getCredential: the renderer learns only that a
		// credential exists, never its value.
		async hasCredential(key: string): Promise<boolean> {
			return deps.credentials.has(assertCredentialKey(key));
		},

		async removeCredential(key: string): Promise<void> {
			await deps.credentials.remove(assertCredentialKey(key));
		},

		async cancelRun(id: string): Promise<void> {
			deps.logger.info('run:cancel', { id });
			await orchestrator.cancel(assertRunId(id));
		},

		discoveryPreflight: (): Promise<DiscoveryPreflight> => probeClaude(),

		async suggestCompetitors(input: DiscoveryInput): Promise<DiscoveryResult> {
			inFlight?.abort();
			const controller = new AbortController();
			inFlight = controller;
			deps.logger.info('discovery:start', {
				client: input.client,
				readSite: input.readSite,
				webSearch: input.webSearch
			});
			try {
				const out = await suggestCompetitors(input, controller.signal, discoveryDeps);
				return { status: 'ok', ...out };
			} catch (error) {
				if (controller.signal.aborted) return { status: 'cancelled' };
				if (error instanceof ClaudeUnavailableError)
					return { status: 'unavailable', reason: error.message };
				if (error instanceof ClaudeFailedError) {
					// The raw CLI text is for the log, never the panel.
					deps.logger.error('discovery:failed', error.detail);
					return { status: 'failed', error: error.message };
				}
				const message = error instanceof Error ? error.message : String(error);
				if (/^Aborted/.test(message)) return { status: 'cancelled' };
				return { status: 'failed', error: message };
			} finally {
				if (inFlight === controller) inFlight = null;
			}
		},

		async cancelSuggest(): Promise<void> {
			inFlight?.abort();
		},

		/**
		 * Startup recovery: a run left on 'running' by a killed process can
		 * never be resumed or read otherwise.
		 */
		async recoverInterruptedRuns(): Promise<string[]> {
			const ids = await storage.markInterruptedAsAborted();
			if (ids.length > 0) deps.logger.info('run:recovered', { ids });
			return ids;
		},

		/**
		 * Resolves once the background execution of `id` has wound down. Not
		 * exposed over IPC: it exists for callers inside the main process (and
		 * tests) that must not race a run that is still writing its file.
		 */
		settled: (id: string) => orchestrator.settled(id),

		listRuns: () => storage.list(),
		// async, so a rejected id is a rejected promise at the boundary rather
		// than a synchronous throw the caller has to handle differently.
		loadRun: async (id: string) => storage.load(assertRunId(id)),
		readSettings: () => settingsStore.read(),
		writeSettings: (settings: Settings) => settingsStore.write(settings)
	};
}
