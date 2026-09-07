/**
 * Opens the app's own /report/:id route in Electron and captures it.
 *
 * Boots the same loopback static server and the same IPC registration main.js
 * does, so the page's `api().loadRun(...)` works exactly as it does for the
 * operator. A plain browser cannot render this route: window.api comes from
 * the preload, and without it the page shows "Preload API unavailable".
 *
 *   npx electron .claude/skills/run-app/scripts/drive-report.cjs <runId> <out.png|out.pdf>
 *
 * Run from the repo root, after `npm run build && npm run electron:compile`.
 */
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const REPO = path.resolve(__dirname, '../../../..');
const DIST = path.join(REPO, 'dist-electron/electron');

const { createLogger } = require(path.join(DIST, 'logger.js'));
const { registerIpc } = require(path.join(DIST, 'ipc.js'));
const { startStaticServer } = require(path.join(DIST, 'server.js'));
const { exportRunPdf } = require(path.join(DIST, 'pdf.js'));

const RUN_ID = process.argv[2];
const OUT = process.argv[3];
const READY_TIMEOUT_MS = 60_000;

if (!RUN_ID || !OUT) {
	console.error('usage: drive-report.cjs <runId> <out.png|out.pdf>');
	process.exit(2);
}

/** The route sets this once it has its run; polling it beats sleeping. */
async function waitForReady(webContents) {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	for (;;) {
		const state = await webContents.executeJavaScript(
			`document.querySelector('[data-report-state]')?.getAttribute('data-report-state') ?? null`
		);
		if (state === 'ready') return;
		if (state === 'error') throw new Error('report route reported an error');
		if (Date.now() > deadline) throw new Error(`still "${state}" after ${READY_TIMEOUT_MS}ms`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

app.whenReady().then(async () => {
	const logger = createLogger(app.getPath('userData'));
	const server = await startStaticServer(path.join(REPO, 'build'));
	const window = new BrowserWindow({
		width: 1000,
		height: 1400,
		show: OUT.endsWith('.png'),
		webPreferences: {
			preload: path.join(DIST, 'preload.js'),
			nodeIntegration: false,
			contextIsolation: true
		}
	});
	registerIpc({ userDataDir: app.getPath('userData'), window, logger, rendererBase: server.base });

	try {
		if (OUT.endsWith('.pdf')) {
			// The app's own export path, so the PDF matches what the operator gets.
			await exportRunPdf({ runId: RUN_ID, rendererBase: server.base, outPath: OUT });
		} else {
			await window.loadURL(`${server.base}/report/${RUN_ID}`);
			await waitForReady(window.webContents);

			// capturePage only takes the viewport, so grow the window to the
			// whole document first — otherwise the second half of the report
			// is simply absent from the screenshot.
			const height = await window.webContents.executeJavaScript(
				'Math.min(document.documentElement.scrollHeight, 8000)'
			);
			window.setContentSize(1000, height);
			await new Promise((resolve) => setTimeout(resolve, 800));
			fs.writeFileSync(OUT, (await window.webContents.capturePage()).toPNG());
		}
		console.log('WROTE ' + OUT);
	} catch (error) {
		console.error('FAILED ' + error.message);
		process.exitCode = 1;
	} finally {
		await server.close();
		app.quit();
	}
});
