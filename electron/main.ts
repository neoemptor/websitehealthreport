import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { createLogger } from './logger';
import { registerIpc } from './ipc';
import { startStaticServer } from './server';

async function createWindow(rendererBase: string): Promise<BrowserWindow> {
	const window = new BrowserWindow({
		width: 1280,
		height: 860,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			nodeIntegration: false,
			contextIsolation: true
		}
	});

	await window.loadURL(rendererBase);

	return window;
}

app.whenReady().then(async () => {
	const logger = createLogger(app.getPath('userData'));

	// The renderer is a client-only SvelteKit build (see server.ts for why
	// `file://` doesn't work for it): dev loads straight from the Vite dev
	// server, and a packaged build gets the same treatment from a loopback
	// static server so both the main window and the PDF export window (see
	// ipc.ts) navigate to real routes like `/report/:id` over HTTP.
	let rendererBase: string;
	if (app.isPackaged) {
		// tsconfig.electron.json has rootDir ".", so this file compiles to
		// dist-electron/electron/main.js — two levels below the project root,
		// where SvelteKit's adapter-static output lives in build/.
		const server = await startStaticServer(path.join(__dirname, '../../build'));
		rendererBase = server.base;
		app.on('before-quit', () => {
			void server.close();
		});
	} else {
		rendererBase = 'http://localhost:5173';
	}

	const window = await createWindow(rendererBase);
	registerIpc({ userDataDir: app.getPath('userData'), window, logger, rendererBase });

	app.on('activate', async () => {
		if (BrowserWindow.getAllWindows().length === 0) await createWindow(rendererBase);
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
