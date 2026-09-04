import {
	BrowserWindow as ElectronBrowserWindow,
	ipcMain,
	safeStorage,
	type BrowserWindow
} from 'electron';
import * as path from 'path';
import { buildHandlers, type Logger } from './handlers';
import { CredentialStore } from './credentials';
import { normaliseDomain } from '../src/lib/shared/url';
import { assertRunId } from './run/id';

// Loopback redirect for the installed-app OAuth flow. Nothing listens on it:
// the consent window is intercepted the moment it tries to navigate there.
const GOOGLE_REDIRECT_URI = 'http://127.0.0.1:8412';

export type { Logger };

export type RegisteredIpc = { recoverInterruptedRuns(): Promise<string[]> };

export function registerIpc(deps: {
	userDataDir: string;
	window: BrowserWindow;
	logger: Logger;
	/** Origin the renderer is served from — see server.ts for why the PDF
	 *  export window needs a real HTTP origin rather than a file:// path. */
	rendererBase: string;
}): RegisteredIpc {
	const credentials = new CredentialStore(deps.userDataDir, safeStorage);

	const handlers = buildHandlers({
		userDataDir: deps.userDataDir,
		credentials,
		logger: deps.logger,
		emitProgress: (run) => deps.window.webContents.send('run:progress', run)
	});

	const wrap =
		<A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
		async (_event: unknown, ...args: A): Promise<R> => {
			try {
				return await fn(...args);
			} catch (error) {
				// Surfaces in the renderer as a rejected invoke, and in the log file.
				deps.logger.error(name, error);
				throw error;
			}
		};

	ipcMain.handle('run:start', wrap('run:start', handlers.startRun));
	ipcMain.handle('run:resume', wrap('run:resume', handlers.resumeRun));
	ipcMain.handle('run:cancel', wrap('run:cancel', handlers.cancelRun));
	ipcMain.handle('run:list', wrap('run:list', handlers.listRuns));
	ipcMain.handle('run:load', wrap('run:load', handlers.loadRun));
	ipcMain.handle('settings:read', wrap('settings:read', handlers.readSettings));
	ipcMain.handle('settings:write', wrap('settings:write', handlers.writeSettings));
	ipcMain.handle('discovery:preflight', wrap('discovery:preflight', handlers.discoveryPreflight));
	ipcMain.handle(
		'discovery:competitors',
		wrap('discovery:competitors', handlers.suggestCompetitors)
	);
	ipcMain.handle('discovery:cancel', wrap('discovery:cancel', handlers.cancelSuggest));

	ipcMain.handle('cred:set', wrap('cred:set', handlers.setCredential));
	// Deliberately no cred:get. The renderer learns only that a credential exists.
	ipcMain.handle('cred:has', wrap('cred:has', handlers.hasCredential));
	ipcMain.handle('cred:remove', wrap('cred:remove', handlers.removeCredential));

	ipcMain.handle(
		'google:authorise',
		wrap('google:authorise', async (rawDomain: string) => {
			const domain = normaliseDomain(rawDomain);
			const { buildAuthUrl, createPkce, exchangeCode, generateState, refreshTokenKey, SCOPES } =
				await import('./analyzers/traffic-owned/oauth');

			const clientId = await credentials.get('google.clientId');
			const clientSecret = await credentials.get('google.clientSecret');
			if (!clientId || !clientSecret) {
				throw new Error('Google has not been set up in Settings.');
			}

			const { verifier, challenge } = createPkce();
			const state = generateState();
			const authWindow = new ElectronBrowserWindow({
				width: 600,
				height: 800,
				webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
			});

			try {
				const code = await new Promise<string>((resolve, reject) => {
					let settled = false;
					const finish = (fn: () => void): void => {
						if (settled) return;
						settled = true;
						fn();
					};
					const onNavigate = (event: { preventDefault(): void }, url: string): void => {
						let target: URL;
						try {
							target = new URL(url);
						} catch {
							return;
						}
						if (target.origin !== GOOGLE_REDIRECT_URI) return;
						event.preventDefault();
						const params = target.searchParams;
						const returned = params.get('code');
						const returnedState = params.get('state');
						finish(() => {
							if (!returned) {
								reject(new Error(params.get('error') ?? 'Sign-in was cancelled.'));
							} else if (returnedState !== state) {
								reject(new Error('Sign-in did not complete correctly.'));
							} else {
								resolve(returned);
							}
						});
					};
					// Google's loopback redirect can arrive as any of these events
					// depending on how the consent page hands off, so all are
					// watched, and the loopback navigation is prevented so no
					// connection-refused page ever renders.
					authWindow.webContents.on('will-redirect', onNavigate);
					authWindow.webContents.on('will-navigate', onNavigate);
					authWindow.webContents.on('did-navigate', (event, url) =>
						onNavigate({ preventDefault: () => {} }, url)
					);
					authWindow.on('closed', () => finish(() => reject(new Error('Sign-in was cancelled.'))));

					void authWindow.loadURL(
						buildAuthUrl({
							clientId,
							redirectUri: GOOGLE_REDIRECT_URI,
							scopes: SCOPES,
							codeChallenge: challenge,
							state
						})
					);
				});

				const { refreshToken } = await exchangeCode({
					code,
					clientId,
					clientSecret,
					redirectUri: GOOGLE_REDIRECT_URI,
					codeVerifier: verifier
				});

				// The token never leaves the main process: this returns void.
				await credentials.set(refreshTokenKey(domain), refreshToken);
			} finally {
				if (!authWindow.isDestroyed()) authWindow.destroy();
			}
		})
	);

	ipcMain.handle(
		'pdf:export',
		wrap('pdf:export', async (rawRunId: string) => {
			// The id becomes both a URL path segment and an output file path.
			const runId = assertRunId(rawRunId);
			const { exportRunPdf } = await import('./pdf');

			// The footer carries the date the site was measured, not the date the
			// PDF happened to be printed, and in the reader's format.
			const run = await handlers.loadRun(runId);
			const footerDate = new Date(run.createdAt).toLocaleDateString('en-AU', {
				day: 'numeric',
				month: 'long',
				year: 'numeric'
			});

			// Renders the same /report/:id route the operator reviews on screen,
			// over the same origin the main window uses (see main.ts / server.ts).
			return exportRunPdf({
				runId,
				rendererBase: deps.rendererBase,
				outPath: path.join(deps.userDataDir, 'reports', `${runId}.pdf`),
				footerDate
			});
		})
	);

	return { recoverInterruptedRuns: handlers.recoverInterruptedRuns };
}
