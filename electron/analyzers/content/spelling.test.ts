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

	it('skips capitalised words as likely proper nouns', async () => {
		const checker = await createSpellChecker();
		expect(checker.check(['Mandurah'], [])).toEqual([]);
	});

	it('skips all-caps acronyms', async () => {
		const checker = await createSpellChecker();
		expect(checker.check(['CJ', 'ABN'], [])).toEqual([]);
	});

	it('still flags a genuine misspelling mid-sentence', async () => {
		const checker = await createSpellChecker();
		const words = extractWords('Please recieve the goods.');
		const [finding] = checker.check(words, []);
		expect(finding.word).toBe('recieve');
	});

	it('splits hyphenated words and flags the misspelled part', async () => {
		const checker = await createSpellChecker();
		const words = extractWords('a well-knowen brand');
		const [finding] = checker.check(words, []);
		expect(finding.word).toBe('knowen');
	});

	it('retries a failed dictionary load on the next call', async () => {
		vi.resetModules();
		let attempts = 0;
		vi.doMock('../../esm', () => ({
			importEsm: async (specifier: string) => {
				attempts += 1;
				if (attempts === 1) throw new Error('load failed');
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

		const { createSpellChecker: createSpellCheckerRetry } = await import('./spelling');

		await expect(createSpellCheckerRetry()).rejects.toThrow('load failed');
		const checker = await createSpellCheckerRetry();
		expect(checker.check(['colour'], [])).toEqual([]);

		vi.doUnmock('../../esm');
		vi.resetModules();
	});
});
