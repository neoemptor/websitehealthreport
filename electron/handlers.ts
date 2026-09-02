import type { AnalyzerId, Run } from '../src/lib/shared/types';
import { normaliseDomain } from '../src/lib/shared/url';
import { createRegistry } from './analyzers/registry';
import { lighthouseAnalyzer } from './analyzers/lighthouse';
import { keywordsAnalyzer } from './analyzers/keywords';
import { Orchestrator } from './run/orchestrator';
import { RunStorage } from './run/storage';
import { SettingsStore, type Settings } from './settings/store';

// This module must be loadable (and its handlers testable) with no
// dependency on the desktop-runtime package being resolvable at all —
// hence no import of any kind from it, not even a type-only one.
export type Logger = { info(m: string, d?: unknown): void; error(m: string, d?: unknown): void };

export type HandlerDeps = {
	userDataDir: string;
	emitProgress: (run: Run) => void;
	logger: Logger;
};

export type StartRunInput = {
	client: string;
	competitors: string[];
	enabledAnalyzers: AnalyzerId[];
};

export function buildHandlers(deps: HandlerDeps) {
	const registry = createRegistry([lighthouseAnalyzer, keywordsAnalyzer]);
	const storage = new RunStorage(deps.userDataDir);
	const settingsStore = new SettingsStore(deps.userDataDir);
	const orchestrator = new Orchestrator(registry, storage, deps.emitProgress);

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
			return orchestrator.start({
				client,
				competitors,
				enabledAnalyzers: input.enabledAnalyzers,
				settings: settings.analyzers
			});
		},

		async resumeRun(id: string): Promise<Run> {
			const settings = await settingsStore.read();
			return orchestrator.resume(id, settings.analyzers);
		},

		async cancelRun(id: string): Promise<void> {
			deps.logger.info('run:cancel', { id });
			await orchestrator.cancel(id);
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
		loadRun: (id: string) => storage.load(id),
		readSettings: () => settingsStore.read(),
		writeSettings: (settings: Settings) => settingsStore.write(settings)
	};
}
