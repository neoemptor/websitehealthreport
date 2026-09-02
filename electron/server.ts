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
export function startStaticServer(rootDir: string): Promise<StaticServer> {
  const server = http.createServer((req, res) => {
    const requestPath = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
    const normalised = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
    let filePath = path.join(rootDir, normalised);

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        filePath = path.join(rootDir, 'index.html');
      }
      fs.readFile(filePath, (readErr, data) => {
        if (readErr) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(filePath);
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
