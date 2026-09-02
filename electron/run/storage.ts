import * as fs from 'fs/promises';
import * as path from 'path';
import type { Run } from '../../src/lib/shared/types';

let tempIdCounter = 0;
function nextTempId(): number {
	return ++tempIdCounter;
}

export class RunStorage {
	private readonly runsDir: string;

	constructor(rootDir: string) {
		this.runsDir = path.join(rootDir, 'runs');
	}

	async save(run: Run): Promise<void> {
		await fs.mkdir(this.runsDir, { recursive: true });

		// Write to a temporary file and rename. Rename is atomic on all three
		// target platforms, so an interrupted write cannot leave a partial run.
		// Each call gets a unique temp filename to prevent collisions from
		// concurrent saves of the same run id.
		const target = path.join(this.runsDir, `${run.id}.json`);
		const temp = `${target}.${process.pid}.${nextTempId()}.tmp`;

		await fs.writeFile(temp, JSON.stringify(run, null, 2), 'utf-8');
		await fs.rename(temp, target);
	}

	async load(id: string): Promise<Run> {
		const target = path.join(this.runsDir, `${id}.json`);
		try {
			return JSON.parse(await fs.readFile(target, 'utf-8')) as Run;
		} catch (cause) {
			throw new Error(`Could not load run ${id}: ${(cause as Error).message}`);
		}
	}

	/**
	 * Rewrites every run still marked running as aborted. Called once at
	 * startup: nothing can be running in a process that has only just begun,
	 * so a run left on running is one the app was killed in the middle of.
	 * Left alone it is a dead end — the run screen gates both resume and the
	 * report behind "not running" — and it can never leave that state on its
	 * own. Returns the ids it rewrote.
	 */
	async markInterruptedAsAborted(): Promise<string[]> {
		const rewritten: string[] = [];
		for (const run of await this.list()) {
			if (run.status !== 'running') continue;
			run.status = 'aborted';
			await this.save(run);
			rewritten.push(run.id);
		}
		return rewritten;
	}

	async list(): Promise<Run[]> {
		let entries: string[];
		try {
			entries = await fs.readdir(this.runsDir);
		} catch {
			return [];
		}

		const runs: Run[] = [];
		for (const entry of entries.filter((e) => e.endsWith('.json'))) {
			try {
				runs.push(JSON.parse(await fs.readFile(path.join(this.runsDir, entry), 'utf-8')) as Run);
			} catch {
				// A corrupt file must not sink the whole listing.
			}
		}

		return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}
}
