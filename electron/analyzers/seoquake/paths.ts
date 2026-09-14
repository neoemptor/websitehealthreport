import * as path from 'path';

// chromeCandidates moved to the shared analyzer module: every Puppeteer-backed
// analyzer needs the same system-Chrome fallback, not just SEO Quake.
export { chromeCandidates } from '../chrome';

export const SEOQUAKE_EXTENSION_ID = 'akdgnmcogleenhbclghghlkkdndkjdjc';

function userDataDir(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string {
	switch (platform) {
		case 'win32':
			return path.win32.join(
				env['LOCALAPPDATA'] ?? path.win32.join(home, 'AppData', 'Local'),
				'Google',
				'Chrome',
				'User Data'
			);
		case 'darwin':
			return path.posix.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
		default:
			return path.posix.join(home, '.config', 'google-chrome');
	}
}

export function extensionRoot(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
	home: string
): string {
	const join = platform === 'win32' ? path.win32.join : path.posix.join;
	return join(userDataDir(platform, env, home), 'Default', 'Extensions', SEOQUAKE_EXTENSION_ID);
}

/** Chrome unpacks each extension into a per-version directory, so the version cannot be hardcoded. */
export function pickLatestVersion(dirs: string[]): string {
	if (dirs.length === 0) {
		throw new Error(
			'SEO Quake is installed but has no version directories under its extension folder.'
		);
	}

	const rank = (name: string) => name.split(/[._]/).map((part) => Number(part) || 0);

	return [...dirs].sort((a, b) => {
		const [x, y] = [rank(a), rank(b)];
		for (let i = 0; i < Math.max(x.length, y.length); i++) {
			if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
		}
		return 0;
	})[dirs.length - 1];
}
