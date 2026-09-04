import * as fs from 'fs/promises';
import * as path from 'path';
import type { AnalyzerId } from '../../src/lib/shared/types';
import { DEFAULT_DISCOVERY_SETTINGS, type DiscoverySettings } from '../../src/lib/shared/discovery';

export type Settings = {
	enabledAnalyzers: AnalyzerId[];
	analyzers: Partial<Record<AnalyzerId, unknown>>;
	discovery: DiscoverySettings;
};

export const DEFAULT_SETTINGS: Settings = {
	enabledAnalyzers: ['lighthouse', 'keywords'],
	analyzers: {},
	discovery: DEFAULT_DISCOVERY_SETTINGS
};

export class SettingsStore {
	private readonly file: string;

	constructor(rootDir: string) {
		this.file = path.join(rootDir, 'settings.json');
	}

	async read(): Promise<Settings> {
		try {
			return { ...DEFAULT_SETTINGS, ...JSON.parse(await fs.readFile(this.file, 'utf-8')) };
		} catch {
			// Missing or corrupt settings must never block startup.
			return DEFAULT_SETTINGS;
		}
	}

	async write(settings: Settings): Promise<void> {
		await fs.mkdir(path.dirname(this.file), { recursive: true });
		const temp = `${this.file}.${process.pid}.tmp`;
		await fs.writeFile(temp, JSON.stringify(settings, null, 2), 'utf-8');
		await fs.rename(temp, this.file);
	}
}
