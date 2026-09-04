import { describe, it, expect } from 'vitest';
import { detectCloaking } from './cloaking';
import { makeSnapshot } from '../snapshot';

const prose = (seed: string) =>
	Array.from({ length: 60 }, (_, i) => `${seed}${i} sentence about doors`).join(' ');

describe('detectCloaking', () => {
	it('flags a page whose Googlebot text differs from the browser text', () => {
		const page = makeSnapshot({ path: '/', visibleText: prose('a'), botText: prose('b') });
		const [f] = detectCloaking([page]);
		expect(f).toMatchObject({ check: 'cloaking', severity: 'high', page: '/' });
		expect(f.evidence).toMatch(/^browser 240 words, Googlebot 240 words, similarity 0\.\d\d$/);
	});

	it('is quiet when the texts match', () => {
		const page = makeSnapshot({ path: '/', visibleText: prose('a'), botText: prose('a') });
		expect(detectCloaking([page])).toEqual([]);
	});

	it('is quiet when the bot only saw a JS shell (short unrelated bot text)', () => {
		const shell = Array.from({ length: 60 }, (_, i) => `shell${i}`).join(' ');
		const page = makeSnapshot({ path: '/', visibleText: prose('a'), botText: shell });
		expect(detectCloaking([page])).toEqual([]);
	});

	it('skips pages with no bot text or under 50 words', () => {
		expect(
			detectCloaking([makeSnapshot({ path: '/', visibleText: prose('a'), botText: null })])
		).toEqual([]);
		expect(
			detectCloaking([
				makeSnapshot({ path: '/', visibleText: 'short text', botText: 'other short text' })
			])
		).toEqual([]);
	});
});
