import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// dictionary-en-au is ESM-only and is loaded through importEsm (see
// electron/esm.ts), which vitest's module mocking cannot intercept, so the
// loader itself is mocked instead. The real dictionary files are read from
// disk so the tests exercise genuine Australian spelling data.
vi.mock('../../esm', () => ({
	importEsm: async (specifier: string) => {
		if (specifier === 'dictionary-en-au') {
			const require = createRequire(import.meta.url);
			const dir = require.resolve('dictionary-en-au').replace('index.js', '');
			return {
				default: {
					aff: readFileSync(dir + 'index.aff'),
					dic: readFileSync(dir + 'index.dic')
				}
			};
		}
		throw new Error('unexpected import ' + specifier);
	}
}));

const { extractWords, createSpellChecker } = await import('./spelling');

describe('extractWords', () => {
	it('splits on whitespace and punctuation', () => {
		expect(extractWords('Hello, world! Fine.')).toEqual(['Hello', 'world', 'Fine']);
	});

	it('keeps internal apostrophes', () => {
		expect(extractWords("don't stop")).toEqual(["don't", 'stop']);
	});

	it('drops numbers and standalone symbols', () => {
		expect(extractWords('call 1300 555 now $$$')).toEqual(['call', 'now']);
	});

	it('drops words shorter than three characters, which are noise', () => {
		expect(extractWords('a an the go')).toEqual(['the']);
	});
});

describe('spell checker', () => {
	it('accepts Australian spellings that American dictionaries reject', async () => {
		const checker = await createSpellChecker();
		expect(checker.check(['colour', 'organisation', 'centre'], [])).toEqual([]);
	});

	it('flags a genuine misspelling with suggestions', async () => {
		const checker = await createSpellChecker();
		const [finding] = checker.check(['recieve'], []);
		expect(finding.word).toBe('recieve');
		expect(finding.suggestions.length).toBeGreaterThan(0);
	});

	it('counts repeated misspellings once with a count', async () => {
		const checker = await createSpellChecker();
		const [finding] = checker.check(['recieve', 'recieve'], []);
		expect(finding.count).toBe(2);
	});

	it('honours the ignore list case insensitively', async () => {
		const checker = await createSpellChecker();
		expect(checker.check(['Cjsgaragedoors'], ['cjsgaragedoors'])).toEqual([]);
	});
});
