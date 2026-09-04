import { describe, it, expect, afterEach, vi } from 'vitest';
import { snapshotScript } from './crawl';

/**
 * snapshotScript() is written to run inside a page, so exercising it here
 * means standing up the smallest DOM it actually touches: a tree walker over
 * text nodes, a computed style with everything at its default, and elements
 * that belong to no anchor and no chrome. Nothing here is hidden — the point
 * is which nodes get recorded at all.
 */
type FakeElement = {
	parentElement: FakeElement | null;
	id: string;
	getAttribute: (name: string) => string | null;
	closest: (selector: string) => FakeElement | null;
	getBoundingClientRect: () => { width: number; height: number; right: number; bottom: number };
};

function element(overrides: Partial<FakeElement> = {}): FakeElement {
	return {
		parentElement: null,
		id: '',
		getAttribute: () => null,
		closest: () => null,
		getBoundingClientRect: () => ({ width: 100, height: 20, right: 100, bottom: 20 }),
		...overrides
	};
}

const STYLE = {
	display: 'block',
	opacity: '1',
	visibility: 'visible',
	fontSize: '16px',
	color: 'rgb(0, 0, 0)',
	backgroundColor: 'rgb(255, 255, 255)',
	backgroundImage: 'none',
	transitionProperty: 'none',
	textIndent: '0px'
};

function stubDom(texts: Array<{ text: string; parent: FakeElement }>): void {
	let index = -1;
	vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 });
	vi.stubGlobal('getComputedStyle', () => STYLE);
	vi.stubGlobal('document', {
		title: 'Fixture',
		body: element(),
		createTreeWalker: () => ({
			nextNode: () => {
				index++;
				if (index >= texts.length) return null;
				return { textContent: texts[index].text, parentElement: texts[index].parent };
			}
		}),
		querySelector: () => null,
		querySelectorAll: () => []
	});
}

afterEach(() => vi.unstubAllGlobals());

describe('snapshotScript', () => {
	it('records a two-word text node, so short stuffed phrases are not lost', () => {
		const parent = element();
		stubDom([
			{ text: 'doors mandurah', parent },
			{ text: 'a', parent },
			{ text: 'three words here', parent }
		]);
		const raw = snapshotScript()('https://example.com/');
		expect(raw.nodes.map((n) => n.text)).toEqual(['doors mandurah', 'three words here']);
		expect(raw.nodes[0]).toMatchObject({ hidden: null, inLink: null });
	});
});
