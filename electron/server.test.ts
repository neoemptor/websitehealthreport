import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { startStaticServer, resolveFilePath, type StaticServer } from './server';

let dir: string;
let root: string;
let server: StaticServer;

/**
 * Raw request rather than fetch(): fetch normalises "/.." out of a URL before
 * it is sent, and refuses some of the malformed paths under test, so the
 * server would never see the input that used to kill the process.
 */
function request(url: string, target: string): Promise<{ status: number; body: string }> {
	const { hostname, port } = new URL(url);
	return new Promise((resolve, reject) => {
		const req = http.request({ hostname, port, path: target, method: 'GET' }, (res) => {
			let body = '';
			res.setEncoding('utf-8');
			res.on('data', (chunk) => (body += chunk));
			res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
		});
		req.on('error', reject);
		req.end();
	});
}

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whr-server-'));
	root = path.join(dir, 'build');
	await fs.mkdir(root);
	await fs.writeFile(path.join(root, 'index.html'), '<html>fallback</html>', 'utf-8');
	await fs.writeFile(path.join(root, 'app.js'), 'console.log(1);', 'utf-8');
	// Sits next to the served root, so a traversal that escaped would find it.
	await fs.writeFile(path.join(dir, 'secret.txt'), 'TOP SECRET', 'utf-8');
	server = await startStaticServer(root);
});

afterEach(async () => {
	await server.close();
	await fs.rm(dir, { recursive: true, force: true });
});

describe('startStaticServer', () => {
	it('serves a real file with its content type', async () => {
		const res = await request(server.base, '/app.js');
		expect(res.status).toBe(200);
		expect(res.body).toContain('console.log');
	});

	it('falls back to index.html for a client-side route', async () => {
		const res = await request(server.base, '/report/2026-09-02T081500-example-com');
		expect(res.status).toBe(200);
		expect(res.body).toContain('fallback');
	});

	it('answers 400 for a malformed escape instead of crashing the process', async () => {
		// decodeURIComponent('%') throws URIError, which inside the request
		// listener became an uncaughtException and terminated Electron.
		const res = await request(server.base, '/%');
		expect(res.status).toBe(400);

		// The server is still up: the process survived the bad request.
		expect((await request(server.base, '/app.js')).status).toBe(200);
	});

	it('answers 400 for a null byte in the path', async () => {
		// fs.stat throws ERR_INVALID_ARG_VALUE synchronously on a null byte.
		const res = await request(server.base, '/x%00y');
		expect(res.status).toBe(400);
		expect((await request(server.base, '/app.js')).status).toBe(200);
	});

	it('never serves a file outside the served root', async () => {
		for (const target of ['/..%2fsecret.txt', '/..%5csecret.txt', '/%2e%2e/%2e%2e/secret.txt']) {
			const res = await request(server.base, target);
			expect(res.body).not.toContain('TOP SECRET');
		}
	});
});

describe('resolveFilePath', () => {
	const root = path.resolve('/srv/build');
	const inside = (value: string | null) =>
		value !== null && (value === root || value.startsWith(root + path.sep));

	it('keeps a normal request inside the root', () => {
		expect(resolveFilePath('/srv/build', '/app.js')).toBe(path.join(root, 'app.js'));
	});

	it('rejects a null byte', () => {
		expect(resolveFilePath('/srv/build', '/x%00y')).toBeNull();
	});

	it('anchors every traversal attempt inside the root', () => {
		// These all resolve back inside the root today, which is exactly the
		// point: containment is an emergent property of path.normalize, so the
		// startsWith guard states it as a rule instead of relying on it.
		for (const target of [
			'/..%2f..%2fetc%2fpasswd',
			'/../../secret.txt',
			'/..%5c..%5csecret.txt',
			'/../build-secrets/key.txt',
			'/%2e%2e/%2e%2e/secret.txt'
		]) {
			expect(inside(resolveFilePath('/srv/build', target))).toBe(true);
		}
	});

	it('leaves a malformed escape for the caller to turn into a 400', () => {
		expect(() => resolveFilePath('/srv/build', '/%')).toThrow();
	});
});
