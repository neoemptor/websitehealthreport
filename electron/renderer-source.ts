import * as http from 'http';

/**
 * Where the main window loads the renderer from.
 *
 * Packaged: always the static build. Unpackaged: the Vite dev server when one
 * is answering on the dev URL, otherwise the static build — so a plain
 * `electron dist-electron/electron/main.js` after `npm run build` shows the
 * app instead of a connection error, and a stale or drifted dev server is
 * never silently assumed. The dev URL is pinned to one port; `electron:dev`
 * starts Vite with --strictPort so it cannot wander to 5174 and leave the
 * window talking to whatever happened to be on 5173.
 */
export const DEV_URL = 'http://localhost:5173';

export type RendererSource = { kind: 'dev'; base: string } | { kind: 'build' };

export function probeHttp(url: string, timeoutMs = 1500): Promise<boolean> {
	return new Promise((resolve) => {
		const request = http.get(url, (response) => {
			response.resume();
			resolve(true);
		});
		request.setTimeout(timeoutMs, () => {
			request.destroy();
			resolve(false);
		});
		request.on('error', () => resolve(false));
	});
}

export async function pickRendererSource(opts: {
	packaged: boolean;
	devUrl?: string;
	probe?: (url: string) => Promise<boolean>;
}): Promise<RendererSource> {
	if (opts.packaged) return { kind: 'build' };
	const devUrl = opts.devUrl ?? DEV_URL;
	const up = await (opts.probe ?? probeHttp)(devUrl);
	return up ? { kind: 'dev', base: devUrl } : { kind: 'build' };
}
