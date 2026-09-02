import { ipcMain, type BrowserWindow } from 'electron';
import type { AnalyzerId, Run } from '../src/lib/shared/types';
import { normaliseDomain } from '../src/lib/shared/url';
import { createRegistry } from './analyzers/registry';
import { lighthouseAnalyzer } from './analyzers/lighthouse';
import { keywordsAnalyzer } from './analyzers/keywords';
import { Orchestrator } from './run/orchestrator';
import { RunStorage } from './run/storage';
import { SettingsStore, type Settings } from './settings/store';

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
      const competitors = input.competitors.map(normaliseDomain);
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

    listRuns: () => storage.list(),
    loadRun: (id: string) => storage.load(id),
    readSettings: () => settingsStore.read(),
    writeSettings: (settings: Settings) => settingsStore.write(settings)
  };
}

export function registerIpc(deps: {
  userDataDir: string;
  window: BrowserWindow;
  logger: Logger;
}): void {
  const handlers = buildHandlers({
    userDataDir: deps.userDataDir,
    logger: deps.logger,
    emitProgress: (run) => deps.window.webContents.send('run:progress', run)
  });

  const wrap =
    <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
    async (_event: unknown, ...args: A): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error) {
        // Surfaces in the renderer as a rejected invoke, and in the log file.
        deps.logger.error(name, error);
        throw error;
      }
    };

  ipcMain.handle('run:start', wrap('run:start', handlers.startRun));
  ipcMain.handle('run:resume', wrap('run:resume', handlers.resumeRun));
  ipcMain.handle('run:list', wrap('run:list', handlers.listRuns));
  ipcMain.handle('run:load', wrap('run:load', handlers.loadRun));
  ipcMain.handle('settings:read', wrap('settings:read', handlers.readSettings));
  ipcMain.handle('settings:write', wrap('settings:write', handlers.writeSettings));
}
