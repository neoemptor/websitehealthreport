import { describe, it, expect } from 'vitest';
import { chromeCandidates, extensionRoot, pickLatestVersion } from './paths';

describe('chromeCandidates', () => {
	it('checks both Program Files locations on Windows', () => {
		const paths = chromeCandidates(
			'win32',
			{ ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
			'C:\\Users\\x'
		);
		expect(paths).toHaveLength(2);
		expect(paths[0]).toContain('Program Files\\Google');
		expect(paths[1]).toContain('Program Files (x86)');
	});

	it('always produces absolute Windows paths with a drive letter', () => {
		for (const p of chromeCandidates('win32', {}, 'C:\\Users\\x')) {
			expect(p).toMatch(/^[A-Z]:\\/);
		}
	});

	it('returns the app bundle path on macOS', () => {
		expect(chromeCandidates('darwin', {}, '/Users/x')[0]).toContain(
			'/Applications/Google Chrome.app'
		);
	});

	it('returns several binary names on Linux', () => {
		expect(chromeCandidates('linux', {}, '/home/x').length).toBeGreaterThan(1);
	});
});

describe('extensionRoot', () => {
	it('uses LOCALAPPDATA on Windows', () => {
		const root = extensionRoot(
			'win32',
			{ LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' },
			'C:\\Users\\x'
		);
		expect(root).toContain('User Data');
		expect(root).toContain('akdgnmcogleenhbclghghlkkdndkjdjc');
	});

	it('uses Application Support on macOS', () => {
		expect(extensionRoot('darwin', {}, '/Users/x')).toContain('Application Support');
	});
});

describe('pickLatestVersion', () => {
	it('picks the highest version, not the lexically largest', () => {
		expect(pickLatestVersion(['3.9.1_0', '3.13.5_0', '3.10.3_0'])).toBe('3.13.5_0');
	});

	it('throws when there are no versions', () => {
		expect(() => pickLatestVersion([])).toThrow(/version/i);
	});
});
