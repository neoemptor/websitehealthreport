import { contextBridge, ipcRenderer } from 'electron';
import type { Run, AnalyzerId } from '../src/lib/shared/types';
import type { Settings } from './settings/store';

export type WhrApi = {
	startRun(input: {
		client: string;
		competitors: string[];
		enabledAnalyzers: AnalyzerId[];
	}): Promise<Run>;
	resumeRun(id: string): Promise<Run>;
	listRuns(): Promise<Run[]>;
	loadRun(id: string): Promise<Run>;
	readSettings(): Promise<Settings>;
	writeSettings(settings: Settings): Promise<void>;
	exportPdf(runId: string): Promise<string>;
	onRunProgress(listener: (run: Run) => void): () => void;
};

const api: WhrApi = {
	startRun: (input) => ipcRenderer.invoke('run:start', input),
	resumeRun: (id) => ipcRenderer.invoke('run:resume', id),
	listRuns: () => ipcRenderer.invoke('run:list'),
	loadRun: (id) => ipcRenderer.invoke('run:load', id),
	readSettings: () => ipcRenderer.invoke('settings:read'),
	writeSettings: (settings) => ipcRenderer.invoke('settings:write', settings),
	exportPdf: (runId) => ipcRenderer.invoke('pdf:export', runId),
	onRunProgress: (listener) => {
		const handler = (_: unknown, run: Run) => listener(run);
		ipcRenderer.on('run:progress', handler);
		return () => ipcRenderer.removeListener('run:progress', handler);
	}
};

contextBridge.exposeInMainWorld('api', api);
