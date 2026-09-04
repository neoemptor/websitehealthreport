import { BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

export type ExportOptions = {
	runId: string;
	/** Dev: http://localhost:5173. Packaged: file:// URL of build/index.html. */
	rendererBase: string;
	outPath: string;
	/** Overridable for slow machines and tests. */
	readyTimeoutMs?: number;
	/** Shown on every page. The run date, formatted for the reader. */
	footerDate?: string;
};

const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 100;

/**
 * Repeated on every page of the exported PDF.
 *
 * Chromium renders this in an isolated context with its own tiny default font
 * size and no access to the page's stylesheet, so every rule has to be inline
 * and the size stated explicitly. `pageNumber` and `totalPages` are substituted
 * by Chromium.
 *
 * The date is interpolated rather than using Chromium's own `date` class: that
 * renders the moment of printing in the host's US-style short format, whereas
 * the client cares when the site was measured, in the format they read.
 */
function footerTemplate(dateLabel: string): string {
	return `
	<div style="width:100%;margin:0 12mm;padding-top:4mm;border-top:0.5pt solid #D8D5CE;
	            font-family:Georgia,'Times New Roman',serif;font-size:7.5pt;color:#6B6659;
	            display:flex;justify-content:space-between;">
		<span>D S Bailey Freelancer</span>
		<span>${escapeHtml(dateLabel)}</span>
		<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
	</div>
`;
}

function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
	);
}

type ReportState = { state: string | null; error: string | null } | null;

/**
 * Waits for the report route to say it has rendered its run.
 *
 * This used to be a fixed 1500ms sleep, which is not synchronised with the
 * route's async data load at all: a large run or a cold start printed the
 * "Loading…" placeholder and reported success — the wrong document, at a
 * plausible size, with no error anywhere. The route sets data-report-state on
 * its root element, so readiness is now a fact rather than a guess, and a page
 * that never becomes ready throws instead of printing a placeholder.
 */
async function waitForReport(
	webContents: { executeJavaScript(code: string): Promise<unknown> },
	runId: string,
	timeoutMs: number
): Promise<void> {
	const deadline = Date.now() + timeoutMs;

	for (;;) {
		const result = (await webContents.executeJavaScript(
			`(() => {
				const el = document.querySelector('[data-report-state]');
				return el
					? { state: el.getAttribute('data-report-state'), error: el.getAttribute('data-report-error') }
					: null;
			})()`
		)) as ReportState;

		if (result?.state === 'ready') return;

		if (result?.state === 'error') {
			throw new Error(
				`Report page could not load run ${runId}: ${result.error ?? 'unknown error'}`
			);
		}

		if (Date.now() >= deadline) {
			throw new Error(
				`Report page for run ${runId} was still "${
					result?.state ?? 'not rendered'
				}" after ${timeoutMs}ms; refusing to print a placeholder.`
			);
		}

		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}
}

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
		await waitForReport(window.webContents, opts.runId, opts.readyTimeoutMs ?? READY_TIMEOUT_MS);

		const pdf = await window.webContents.printToPDF({
			printBackground: true,
			pageSize: 'A4',
			// Chromium only repeats page furniture when it is supplied here. A
			// position:fixed footer in the page renders once, not per page, so the
			// footer lives in the print options rather than in the Svelte route —
			// the one place where screen and PDF deliberately differ.
			displayHeaderFooter: true,
			headerTemplate: '<div></div>',
			footerTemplate: footerTemplate(opts.footerDate ?? ''),
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
