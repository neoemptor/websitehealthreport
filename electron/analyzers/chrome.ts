import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadPuppeteer } from './puppeteer';
import type { Preflight } from './types';

/**
 * Where a system Chrome install lives, per platform. Kept separate from
 * Puppeteer's own cache: this is the browser the user installed, which is the
 * only one present on a machine that has never run `npm install` in this repo.
 */
export function chromeCandidates(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for interface symmetry with extensionRoot
	home: string
): string[] {
	switch (platform) {
		case 'win32': {
			// Chrome installs to either location depending on installer and age,
			// and the original code omitted the drive letter entirely.
			const programFiles = env['ProgramFiles'] ?? 'C:\\Program Files';
			const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
			return [
				path.win32.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
				path.win32.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe')
			];
		}
		case 'darwin':
			return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
		default:
			return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
	}
}

export type ChromeLookup =
	/** `bundled` says whether this is Puppeteer's own download rather than a system install. */
	{ path: string; bundled: boolean } | { path: null; looked: string[] };

/**
 * Puppeteer's bundled Chrome first, then a system install.
 *
 * The bundled build is preferred because it is the version Puppeteer was
 * tested against, but it only exists where `npm install` ran its postinstall.
 * A packaged app ships Puppeteer's JavaScript without the browser binary, so
 * on an end user's machine the system install is the only one there is.
 */
export async function findChrome(): Promise<ChromeLookup> {
	const looked: string[] = [];

	// executablePath() only computes a path; it throws for an unsupported
	// platform, not for a Chromium that was never downloaded or has been
	// cleared from the cache, so the existence check is the real test.
	try {
		const puppeteer = await loadPuppeteer();
		const bundled = await puppeteer.executablePath();
		if (bundled) {
			looked.push(bundled);
			if (fs.existsSync(bundled)) return { path: bundled, bundled: true };
		}
	} catch {
		// An unsupported platform for Puppeteer's own download is not fatal
		// here — a system Chrome may still be installed.
	}

	for (const candidate of chromeCandidates(process.platform, process.env, os.homedir())) {
		looked.push(candidate);
		if (fs.existsSync(candidate)) return { path: candidate, bundled: false };
	}

	return { path: null, looked };
}

/** The shared preflight for analyzers that drive Chrome through Puppeteer. */
export async function chromePreflight(): Promise<Preflight> {
	const found = await findChrome();
	if (found.path !== null) return { available: true };
	return {
		available: false,
		// "not installed" rather than a launch failure: an operator needs to
		// tell "no browser here" apart from "the browser crashed", which are
		// different problems with different fixes.
		reason: `Chrome is not installed where this analyzer can find it. Looked in:\n  ${found.looked.join(
			'\n  '
		)}\nInstall Google Chrome, or run "npx puppeteer browsers install chrome" in a checkout.`
	};
}

/** Throws rather than returning null: analyze() has no useful partial result without a browser. */
export async function chromeExecutablePath(): Promise<string> {
	const found = await findChrome();
	if (found.path === null) {
		throw new Error(
			`Chrome is not installed where this analyzer can find it. Looked in:\n  ${found.looked.join(
				'\n  '
			)}`
		);
	}
	return found.path;
}
