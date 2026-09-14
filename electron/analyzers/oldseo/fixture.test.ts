import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { startStaticServer } from '../../server';
import { findChrome } from '../chrome';
import { oldSeoAnalyzer } from './index';

// Any Chrome the analyzer can reach will do, not only Puppeteer's own
// download: the analyzer falls back to a system install, so gating on the
// download alone skipped this test on machines where it would have run.
const chromium = (await findChrome()).path !== null;

describe.skipIf(!chromium)('oldseo against the fixture site', () => {
	it('finds one of each trick and honours robots', async () => {
		const server = await startStaticServer(path.join(__dirname, 'fixtures'));
		try {
			const data = await oldSeoAnalyzer.analyze(
				server.base + '/',
				{ maxPages: 10 },
				new AbortController().signal
			);
			expect(data.pagesRead).toBe(4);
			expect(data.pagesSkipped).toBe(0);
			const checks = new Set(data.findings.map((f) => f.check));
			expect(checks.has('hidden-text')).toBe(true);
			expect(checks.has('hidden-link')).toBe(true);
			expect(checks.has('stuffing')).toBe(true);
			expect(checks.has('duplicate')).toBe(true);
			expect(checks.has('stale')).toBe(true);
			expect(data.findings.some((f) => f.evidence.includes('/private'))).toBe(false);
			expect(data.findings.some((f) => f.evidence.includes('Home About Services'))).toBe(false);
			expect(
				data.findings.some(
					(f) => f.check === 'hidden-link' && f.evidence.endsWith('link-farm.example/')
				)
			).toBe(true);
			expect(
				data.findings.some(
					(f) => f.check === 'hidden-link' && f.evidence.endsWith('services-mandurah.html')
				)
			).toBe(false);
			expect(
				data.findings.some(
					(f) => f.check === 'hidden-link' && f.evidence.endsWith('services-baldivis.html')
				)
			).toBe(false);
		} finally {
			await server.close();
		}
	}, 120_000);
});
