import { describe, it, expect, beforeEach, vi } from 'vitest';

const state = vi.hoisted(() => ({
	executablePath: '' as string,
	throws: false,
	present: new Set<string>()
}));

vi.mock('puppeteer', () => ({
	default: {
		executablePath: async () => {
			if (state.throws) throw new Error('Unsupported platform');
			return state.executablePath;
		}
	}
}));

vi.mock('fs', () => ({
	existsSync: (p: string) => state.present.has(p)
}));

const { findChrome, chromePreflight, chromeCandidates } = await import('./chrome');

const BUNDLED = '/home/u/.cache/puppeteer/chrome/mac_arm-153/chrome';

beforeEach(() => {
	state.executablePath = BUNDLED;
	state.throws = false;
	state.present = new Set();
});

describe('chromeCandidates', () => {
	it('gives absolute Windows paths for both Program Files locations', () => {
		const paths = chromeCandidates('win32', {}, 'C:\\Users\\x');
		expect(paths).toHaveLength(2);
		for (const p of paths) expect(p).toMatch(/^C:\\/);
	});

	it('points at the standard app bundle on macOS', () => {
		expect(chromeCandidates('darwin', {}, '/Users/x')[0]).toContain(
			'/Applications/Google Chrome.app'
		);
	});
});

describe('findChrome', () => {
	it("prefers Puppeteer's own download when it is on disk", async () => {
		state.present.add(BUNDLED);
		state.present.add(chromeCandidates(process.platform, process.env, '/home/u')[0]);

		expect(await findChrome()).toEqual({ path: BUNDLED, bundled: true });
	});

	it('falls back to a system install when the download never happened', async () => {
		// The packaged-app case: Puppeteer's JavaScript ships, its browser does not.
		const system = chromeCandidates(process.platform, process.env, '/home/u')[0];
		state.present.add(system);

		expect(await findChrome()).toEqual({ path: system, bundled: false });
	});

	it('still finds a system install when executablePath() throws', async () => {
		// executablePath() throws on a platform Puppeteer has no download for,
		// which says nothing about whether the user has Chrome installed.
		state.throws = true;
		const system = chromeCandidates(process.platform, process.env, '/home/u')[0];
		state.present.add(system);

		expect(await findChrome()).toEqual({ path: system, bundled: false });
	});

	it('reports every path it tried when there is no Chrome at all', async () => {
		const result = await findChrome();

		expect(result.path).toBeNull();
		expect(result.path === null && result.looked).toContain(BUNDLED);
		expect(result.path === null && result.looked.length).toBeGreaterThan(1);
	});
});

describe('chromePreflight', () => {
	it('is available once any Chrome is found', async () => {
		state.present.add(BUNDLED);
		expect(await chromePreflight()).toEqual({ available: true });
	});

	it('says not installed, not crashed, when nothing is found', async () => {
		const result = await chromePreflight();

		expect(result.available).toBe(false);
		// An operator has to tell "no browser here" apart from "it crashed".
		expect(result.available === false && result.reason).toContain('not installed');
		expect(result.available === false && result.reason).toContain(BUNDLED);
	});
});
