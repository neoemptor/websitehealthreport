import { BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

export type ExportOptions = {
	runId: string;
	/** Dev: http://localhost:5173. Packaged: file:// URL of build/index.html. */
	rendererBase: string;
	outPath: string;
};

/**
 * Renders the same /report/:id route the operator reviews on screen into a
 * hidden window and prints it, so screen output and PDF cannot diverge.
 */
export async function exportRunPdf(opts: ExportOptions): Promise<string> {
	const window = new BrowserWindow({
		show: false,
		webPreferences: {
			offscreen: true,
			nodeIntegration: false,
			contextIsolation: true,
			// Without this the /report/:id route's `api().loadRun(...)` throws
			// "Preload API unavailable" (window.api is never exposed), and the
			// page renders that error instead of the report — printToPDF would
			// still "succeed", just against the wrong content.
			preload: path.join(__dirname, 'preload.js')
		}
	});

	try {
		await window.loadURL(`${opts.rendererBase}/report/${opts.runId}`);
		// The route loads its run asynchronously; wait for the DOM to settle.
		await new Promise((resolve) => setTimeout(resolve, 1500));

		const pdf = await window.webContents.printToPDF({
			printBackground: true,
			pageSize: 'A4',
			// top/bottom/left/right are only honoured when marginType is
			// 'custom' — without it they're silently ignored. Electron's types
			// say these are pixels, but at runtime, with a named pageSize preset
			// like 'A4', they're compared against the page size in inches
			// (48 throws "margins must be less than or equal to pageSize"
			// against an ~8.27in-wide A4 page) — so these are inches, matching
			// the page dimensions, not pixels.
			margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
		});

		await fs.mkdir(path.dirname(opts.outPath), { recursive: true });
		await fs.writeFile(opts.outPath, pdf);
		return opts.outPath;
	} finally {
		window.destroy();
	}
}
