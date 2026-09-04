import { describe, it, expect } from 'vitest';
import { detectDuplicate } from './duplicate';
import { AMBIGUOUS_PLACES, PLACES } from './places';
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

	it('groups two-word place names as a single {place} token', () => {
		const pages = ['Canning Vale', 'Victoria Park', 'Mandurah'].map((place, i) =>
			makeSnapshot({
				path: `/${i}`,
				title: `Doors ${place}`,
				visibleText: body(`s${i}`)
			})
		);
		const [f] = detectDuplicate(pages);
		expect(f).toMatchObject({ check: 'duplicate', severity: 'medium', page: '/0' });
		expect(f.evidence).toBe('"Doors {place}" on 3 pages');
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

	it('is quiet for ordinary English words that happen to be place names', () => {
		const pages = ['Great Roller Door Sale', 'Success Stories', 'Our Success'].map((title, i) =>
			makeSnapshot({ path: `/${i}`, title, visibleText: body(`t${i}`) })
		);
		expect(detectDuplicate(pages)).toEqual([]);
	});

	it('does not read a lower-case "sale" as the town of Sale', () => {
		const pages = [0, 1, 2].map((i) =>
			makeSnapshot({ path: `/${i}`, title: 'Doors sale', visibleText: body(`u${i}`) })
		);
		expect(detectDuplicate(pages)).toEqual([]);
	});

	it('still flags an ambiguous name when the title capitalises it', () => {
		const pages = ['Orange', 'Bathurst', 'Dubbo'].map((place, i) =>
			makeSnapshot({ path: `/${i}`, title: `Doors ${place}`, visibleText: body(`v${i}`) })
		);
		const [f] = detectDuplicate(pages);
		expect(f).toMatchObject({ check: 'duplicate', severity: 'medium', page: '/0' });
		expect(f.evidence).toBe('"Doors {place}" on 3 pages');
	});

	it('keeps the ambiguous names out of PLACES and in their own list', () => {
		for (const w of ['success', 'sale', 'york', 'orange', 'victoria']) {
			expect(PLACES.has(w)).toBe(false);
			expect(AMBIGUOUS_PLACES.has(w)).toBe(true);
		}
		// The multi-word forms are unambiguous and stay in PLACES.
		expect(PLACES.has('victoria park')).toBe(true);
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
