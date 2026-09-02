import { ipcMain, type BrowserWindow } from 'electron';
import * as path from 'path';
import { buildHandlers, type Logger } from './handlers';

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
	const handlers = buildHandlers({
		userDataDir: deps.userDataDir,
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

	ipcMain.handle(
		'pdf:export',
		wrap('pdf:export', async (runId: string) => {
			const { exportRunPdf } = await import('./pdf');

			// Renders the same /report/:id route the operator reviews on screen,
			// over the same origin the main window uses (see main.ts / server.ts).
			return exportRunPdf({
				runId,
				rendererBase: deps.rendererBase,
				outPath: path.join(deps.userDataDir, 'reports', `${runId}.pdf`)
			});
		})
	);

	return { recoverInterruptedRuns: handlers.recoverInterruptedRuns };
}
