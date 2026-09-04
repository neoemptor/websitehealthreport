import { contextBridge, ipcRenderer } from 'electron';
import type { Run, AnalyzerId } from '../src/lib/shared/types';
import type { Settings } from './settings/store';
import type {
	DiscoveryInput,
	DiscoveryPreflight,
	DiscoveryResult
} from '../src/lib/shared/discovery';

export type WhrApi = {
	startRun(input: {
		client: string;
		competitors: string[];
		enabledAnalyzers: AnalyzerId[];
	}): Promise<Run>;
	resumeRun(id: string): Promise<Run>;
	cancelRun(id: string): Promise<void>;
	listRuns(): Promise<Run[]>;
	loadRun(id: string): Promise<Run>;
	readSettings(): Promise<Settings>;
	writeSettings(settings: Settings): Promise<void>;
	exportPdf(runId: string): Promise<string>;
	onRunProgress(listener: (run: Run) => void): () => void;
	discoveryPreflight(): Promise<DiscoveryPreflight>;
	suggestCompetitors(input: DiscoveryInput): Promise<DiscoveryResult>;
	cancelSuggest(): Promise<void>;
};

const api: WhrApi = {
	startRun: (input) => ipcRenderer.invoke('run:start', input),
	resumeRun: (id) => ipcRenderer.invoke('run:resume', id),
	cancelRun: (id) => ipcRenderer.invoke('run:cancel', id),
	listRuns: () => ipcRenderer.invoke('run:list'),
	loadRun: (id) => ipcRenderer.invoke('run:load', id),
	readSettings: () => ipcRenderer.invoke('settings:read'),
	writeSettings: (settings) => ipcRenderer.invoke('settings:write', settings),
	exportPdf: (runId) => ipcRenderer.invoke('pdf:export', runId),
	onRunProgress: (listener) => {
		const handler = (_: unknown, run: Run) => listener(run);
		ipcRenderer.on('run:progress', handler);
		return () => ipcRenderer.removeListener('run:progress', handler);
	},
	discoveryPreflight: () => ipcRenderer.invoke('discovery:preflight'),
	suggestCompetitors: (input) => ipcRenderer.invoke('discovery:competitors', input),
	cancelSuggest: () => ipcRenderer.invoke('discovery:cancel')
};

contextBridge.exposeInMainWorld('api', api);
