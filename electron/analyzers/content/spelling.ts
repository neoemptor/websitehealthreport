import nspell from 'nspell';
import { importEsm } from '../../esm';

export type Misspelling = { word: string; count: number; suggestions: string[] };
export type SpellChecker = { check(words: string[], ignore: string[]): Misspelling[] };

type NspellInstance = ReturnType<typeof nspell>;
type Dictionary = { aff: Buffer; dic: Buffer };

export function extractWords(text: string): string[] {
	return (text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []).filter((word) => word.length >= 3);
}

let cachedSpell: Promise<NspellInstance> | undefined;

async function loadSpell(): Promise<NspellInstance> {
	const dictionary = await importEsm<{ default: Dictionary }>('dictionary-en-au');

	return nspell(dictionary.default);
}

export async function createSpellChecker(): Promise<SpellChecker> {
	if (!cachedSpell) cachedSpell = loadSpell();
	const spell = await cachedSpell;

	return {
		check(words, ignore) {
			const ignored = new Set(ignore.map((word) => word.toLowerCase()));
			const counts = new Map<string, number>();

			for (const word of words) {
				const lower = word.toLowerCase();
				if (ignored.has(lower) || spell.correct(word)) continue;
				counts.set(lower, (counts.get(lower) ?? 0) + 1);
			}

			return [...counts.entries()]
				.map(([word, count]) => ({ word, count, suggestions: spell.suggest(word).slice(0, 3) }))
				.sort((a, b) => b.count - a.count);
		}
	};
}
