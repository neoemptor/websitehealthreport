import { describe, it, expect } from 'vitest';
import { detectHidden } from './hidden';
import { makeSnapshot } from '../snapshot';

const w = (n: number, word = 'garage') => Array.from({ length: n }, () => word).join(' ');

describe('detectHidden', () => {
	it('flags a long hidden block as high with its reason and a text excerpt', () => {
		const page = makeSnapshot({
			path: '/',
			visibleText: 'Garage doors Perth',
			nodes: [{ text: 'cheap ' + w(30, 'doors'), hidden: 'same-colour', inLink: null }]
		});
		const [f] = detectHidden([page]);
		expect(f).toMatchObject({ check: 'hidden-text', severity: 'high', page: '/' });
		expect(f.evidence).toMatch(/^same-colour: "cheap doors/);
	});

	it('flags a short hidden block as high when it repeats the page keywords', () => {
		const page = makeSnapshot({
			path: '/p',
			visibleText:
				'roller doors roller doors roller doors sectional doors sectional doors perth perth',
			nodes: [
				{
					text: 'roller doors sectional doors perth roller doors perth cheap',
					hidden: 'off-canvas',
					inLink: null
				}
			]
		});
		expect(detectHidden([page])[0]).toMatchObject({ check: 'hidden-text', severity: 'high' });
	});

	it('reports short keyword-free hidden blocks once per page as low', () => {
		const page = makeSnapshot({
			path: '/about',
			visibleText: 'Our story',
			nodes: [
				{
					text: 'this is some ordinary collapsed paragraph text here',
					hidden: 'display-none',
					inLink: null
				},
				{
					text: 'another ordinary paragraph that is simply not shown',
					hidden: 'display-none',
					inLink: null
				}
			]
		});
		const out = detectHidden([page]);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ check: 'hidden-text', severity: 'low', page: '/about' });
		expect(out[0].evidence).toMatch(/2 hidden blocks/);
	});

	it('counts a keyword only as a whole word, not as a substring', () => {
		// "art", "sale" and "door" are the page's top phrases; the hidden block
		// contains only "cart", "wholesale" and "doorway", which are other words.
		const page = makeSnapshot({
			path: '/shop',
			visibleText: 'art sale door art sale door art sale door',
			nodes: [
				{
					text: 'add to cart for wholesale pricing along the doorway of the shed',
					hidden: 'display-none',
					inLink: null
				}
			]
		});
		const out = detectHidden([page]);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ severity: 'low' });
	});

	it('flags hidden links as high with the target', () => {
		const page = makeSnapshot({
			path: '/',
			nodes: [{ text: 'best doors', hidden: 'tiny-font', inLink: 'https://other.example/' }]
		});
		expect(detectHidden([page])[0]).toEqual({
			check: 'hidden-link',
			severity: 'high',
			page: '/',
			evidence: 'tiny-font: https://other.example/'
		});
	});

	it('ignores visible nodes and hidden nodes under 8 words', () => {
		const page = makeSnapshot({
			path: '/',
			nodes: [
				{ text: w(40), hidden: null, inLink: null },
				{ text: 'skip to content', hidden: 'off-canvas', inLink: null }
			]
		});
		expect(detectHidden([page])).toEqual([]);
	});
});
