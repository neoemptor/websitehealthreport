import { describe, it, expect } from 'vitest';
import { countKeywords } from './parse';

const body =
	'We sell C++ books. Best c++ around. Garage doors and garage doors again. Prices from $99.';

describe('countKeywords', () => {
	it('counts a plain keyword, case insensitively', () => {
		expect(countKeywords(['garage doors'], body)).toEqual([{ keyword: 'garage doors', count: 2 }]);
	});

	it('counts a keyword ending in punctuation, which \\b cannot match', () => {
		expect(countKeywords(['c++'], body)).toEqual([{ keyword: 'c++', count: 2 }]);
	});

	it('counts a keyword starting with punctuation', () => {
		expect(countKeywords(['$99'], body)).toEqual([{ keyword: '$99', count: 1 }]);
	});

	it('does not match a keyword glued inside a longer word', () => {
		expect(countKeywords(['c++'], 'abcc++nope')).toEqual([{ keyword: 'c++', count: 0 }]);
	});

	it('does not throw on regex metacharacters', () => {
		expect(() => countKeywords(['a[b', '(unclosed'], body)).not.toThrow();
	});

	it('drops empty keywords produced by trailing commas', () => {
		expect(countKeywords(['', '   ', 'c++'], body)).toEqual([{ keyword: 'c++', count: 2 }]);
	});

	it('returns an empty array when there are no keywords', () => {
		expect(countKeywords([], body)).toEqual([]);
	});
});
