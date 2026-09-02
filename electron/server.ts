import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const MIME_TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2'
};

export type StaticServer = {
	base: string;
	close: () => Promise<void>;
};

/**
 * Serves a SvelteKit adapter-static build over a loopback-only HTTP server,
 * falling back to index.html for any path that has no file on disk.
 *
 * The renderer is a client-only build (`ssr = false` at the root layout).
 * Its adapter-static output always emits root-absolute asset paths for the
 * fallback page (`/_app/...`), and dynamic routes such as `/report/:id`
 * have no corresponding file on disk at all — only `index.html` does. Both
 * break under `file://`: absolute paths resolve against the filesystem
 * root rather than the build directory, and there is nothing at
 * `build/report/<id>` to load. Serving the same directory over a real HTTP
 * origin fixes both, the same way `vite dev` does for the dev server: every
 * request that doesn't match a real file gets index.html instead, and the
 * client-side router then renders the requested route from
 * `location.pathname`.
 */
/**
 * Resolves a request path to a file inside `rootDir`, or null when the request
 * is malformed or would escape the root.
 *
 * Exported for testing: the failure modes here are the ones that used to kill
 * the process, so they are asserted directly as well as over HTTP.
 */
export function resolveFilePath(rootDir: string, url: string): string | null {
	const root = path.resolve(rootDir);
	const requestPath = decodeURIComponent(url.split('?')[0].split('#')[0]);

	// A null byte makes every fs and path call throw synchronously.
	if (requestPath.includes('\0')) return null;

	const normalised = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
	const filePath = path.join(root, normalised);

	// Asserted, not inferred. Containment currently falls out of what
	// path.normalize happens to do with leading "..", which is a property of
	// an implementation rather than a rule anything enforces.
	if (filePath !== root && !filePath.startsWith(root + path.sep)) return null;

	return filePath;
}

export function startStaticServer(rootDir: string): Promise<StaticServer> {
	const root = path.resolve(rootDir);

	const server = http.createServer((req, res) => {
		// Everything inside this listener runs on the main process's stack: an
		// exception here is an uncaughtException that terminates Electron and
		// loses the in-flight run. decodeURIComponent throws on "/%", and fs
		// and path throw on a null byte ("/x%00y"), so any local process — or a
		// browser page that guessed the ephemeral port — could kill the app.
		let filePath: string | null;
		try {
			filePath = resolveFilePath(root, req.url ?? '/');
		} catch {
			filePath = null;
		}

		if (filePath === null) {
			res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end('Bad request');
			return;
		}

		const target: string = filePath;
		fs.stat(target, (err, stats) => {
			// The fallback path is built from the root, so it can never be the
			// malformed value that would make readFile throw.
			const toRead = err || !stats.isFile() ? path.join(root, 'index.html') : target;
			fs.readFile(toRead, (readErr, data) => {
				if (readErr) {
					res.writeHead(404);
					res.end('Not found');
					return;
				}
				const ext = path.extname(toRead);
				res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
				res.end(data);
			});
		});
	});

	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			resolve({
				base: `http://127.0.0.1:${port}`,
				close: () => new Promise((res) => server.close(() => res()))
			});
		});
	});
}
