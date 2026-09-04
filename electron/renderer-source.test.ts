import { describe, it, expect } from 'vitest';
import * as http from 'http';
import { pickRendererSource, probeHttp } from './renderer-source';

describe('pickRendererSource', () => {
	it('always uses the build when packaged, without probing', async () => {
		let probed = 0;
		const source = await pickRendererSource({
			packaged: true,
			probe: async () => (probed++, true)
		});
		expect(source).toEqual({ kind: 'build' });
		expect(probed).toBe(0);
	});

	it('uses the dev server when it answers', async () => {
		const source = await pickRendererSource({
			packaged: false,
			devUrl: 'http://localhost:5173',
			probe: async () => true
		});
		expect(source).toEqual({ kind: 'dev', base: 'http://localhost:5173' });
	});

	it('falls back to the build when nothing answers on the dev port', async () => {
		const source = await pickRendererSource({ packaged: false, probe: async () => false });
		expect(source).toEqual({ kind: 'build' });
	});
});

describe('probeHttp', () => {
	it('is true for a listening server and false for a closed port', async () => {
		const server = http.createServer((_req, res) => res.end('ok'));
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
		const port = (server.address() as { port: number }).port;
		expect(await probeHttp(`http://127.0.0.1:${port}/`)).toBe(true);
		await new Promise<void>((r) => server.close(() => r()));
		expect(await probeHttp(`http://127.0.0.1:${port}/`)).toBe(false);
	});
});
