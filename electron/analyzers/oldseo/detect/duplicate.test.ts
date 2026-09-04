import { describe, it, expect } from 'vitest';
import { detectDuplicate } from './duplicate';
import { PLACES } from './places';
import { makeSnapshot } from '../snapshot';

const body = (seed: string) => Array.from({ length: 120 }, (_, i) => `${seed} word${i}`).join(' ');

describe('detectDuplicate', () => {
	it('flags a near-identical pair once, naming both paths', () => {
		const a = makeSnapshot({ path: '/a', visibleText: body('x') });
		const b = makeSnapshot({ path: '/b', visibleText: body('x') + ' extra' });
		const c = makeSnapshot({ path: '/c', visibleText: body('x') });
		const out = detectDuplicate([a, b, c]);
		const pairs = out.filter((f) => f.evidence.includes('\u2248'));
		expect(pairs).toHaveLength(1);
		expect(pairs[0]).toMatchObject({ check: 'duplicate', severity: 'medium', page: '/a' });
		expect(pairs[0].evidence).toMatch(/^\/a \u2248 \/b \(0\.9\d\)$|^\/a \u2248 \/c \(1\.00\)$/);
	});

	it('flags a doorway title pattern across three places', () => {
		const pages = ['Mandurah', 'Rockingham', 'Baldivis'].map((place, i) =>
			makeSnapshot({
				path: `/${i}`,
				title: `Garage Door Repairs ${place} | CJ Doors`,
				visibleText: body(`p${i}`)
			})
		);
		const [f] = detectDuplicate(pages);
		expect(f).toMatchObject({ check: 'duplicate', severity: 'medium', page: '/0' });
		expect(f.evidence).toBe('"Garage Door Repairs {place} | CJ Doors" on 3 pages');
	});

	it('accepts a keyword from the meta keywords as the varying token', () => {
		const pages = ['roller', 'sectional', 'tilt'].map((kw, i) =>
			makeSnapshot({
				path: `/${i}`,
				title: `Cheap ${kw} doors`,
				metaKeywords: 'roller, sectional, tilt',
				visibleText: body(`q${i}`)
			})
		);
		expect(detectDuplicate(pages)).toHaveLength(1);
	});

	it('is quiet for two matching titles or for distinct pages', () => {
		const pages = ['Mandurah', 'Rockingham'].map((place, i) =>
			makeSnapshot({ path: `/${i}`, title: `Doors ${place}`, visibleText: body(`r${i}`) })
		);
		expect(detectDuplicate(pages)).toEqual([]);
	});

	it('ships the states and capitals', () => {
		for (const p of [
			'perth',
			'wa',
			'western australia',
			'mandurah',
			'rockingham',
			'newcastle',
			'nsw'
		])
			expect(PLACES.has(p)).toBe(true);
	});
});
