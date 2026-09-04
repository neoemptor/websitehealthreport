import { describe, it, expect } from 'vitest';
import { detectStuffing } from './stuffing';
import { makeSnapshot } from '../snapshot';

const filler = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('detectStuffing', () => {
	it('flags a repeated multi-word phrase over 5% density as high', () => {
		// 8 × "garage doors" = 16 words of 100 → 16%.
		const text = `${'garage doors '.repeat(8)}${filler(84)}`;
		const [f] = detectStuffing([makeSnapshot({ path: '/', visibleText: text })]);
		expect(f).toMatchObject({ check: 'stuffing', severity: 'high', page: '/' });
		expect(f.evidence).toBe('"garage doors" ×8, 16.0% of 100 words');
	});

	it('does not flag the same phrase at the boundary: 7 occurrences', () => {
		const text = `${'garage doors '.repeat(7)}${filler(86)}`;
		expect(detectStuffing([makeSnapshot({ path: '/', visibleText: text })])).toEqual([]);
	});

	it('flags a single word over 8% density as medium, ignoring stop words', () => {
		// 12 × "perth" interleaved with unique filler words so no 2-gram repeats.
		const perthWords = Array.from({ length: 12 }, (_, i) => `perth pfill${i}`).join(' ');
		const text = `${'the '.repeat(30)}${perthWords} ${filler(46)}`;
		const out = detectStuffing([makeSnapshot({ path: '/', visibleText: text })]);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ severity: 'medium' });
		expect(out[0].evidence).toMatch(/^"perth" ×12/);
	});

	it('flags both a high phrase finding and a medium word finding on the same page', () => {
		// 8 × "garage doors" = 16 words → high. 12 × "perth" interleaved with
		// unique filler so "perth" never repeats as a 2-gram and no 2-gram
		// other than "garage doors" reaches 8 occurrences.
		const perthWords = Array.from({ length: 12 }, (_, i) => `perth pfill${i}`).join(' ');
		const text = `${'garage doors '.repeat(8)}${perthWords} ${filler(60)}`;
		const out = detectStuffing([makeSnapshot({ path: '/', visibleText: text })]);
		expect(out).toHaveLength(2);
		expect(out[0]).toMatchObject({ severity: 'high' });
		expect(out[0].evidence).toMatch(/^"garage doors" ×8/);
		expect(out[1]).toMatchObject({ severity: 'medium' });
		expect(out[1].evidence).toMatch(/^"perth" ×12/);
	});

	it('flags a comma list of keyword phrases as medium', () => {
		const text = `Welcome to our site.\ngarage doors perth, roller doors perth, sectional doors, garage door repairs, door motors\nCall us today.`;
		const out = detectStuffing([makeSnapshot({ path: '/', visibleText: text })]);
		expect(out).toHaveLength(1);
		expect(out[0].evidence).toMatch(/^comma list of 5 phrases/);
	});

	it('flags alt text stuffing as medium', () => {
		const alt = 'garage doors perth '.repeat(10);
		const out = detectStuffing([
			makeSnapshot({ path: '/', visibleText: filler(50), altText: alt })
		]);
		expect(out).toHaveLength(1);
		expect(out[0].evidence).toMatch(/^alt text: "garage doors perth" ×10/);
	});

	it('is quiet on ordinary prose', () => {
		const text =
			'We repair and install garage doors across Mandurah and Rockingham. Our team has served the Peel region since 2002, and we offer same-day callouts for motors, springs and panels.';
		expect(detectStuffing([makeSnapshot({ path: '/', visibleText: text })])).toEqual([]);
	});
});
