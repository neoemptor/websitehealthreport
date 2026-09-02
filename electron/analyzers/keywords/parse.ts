export type KeywordCount = { keyword: string; count: number };

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countKeywords(keywords: string[], bodyText: string): KeywordCount[] {
	return keywords
		.map((keyword) => keyword.trim())
		.filter((keyword) => keyword.length > 0)
		.map((keyword) => {
			// Lookarounds rather than \b: \b only sits between a word and a non-word
			// character, so a keyword ending in punctuation such as "c++" could never
			// match. These assert the match is not glued to a surrounding word.
			const regex = new RegExp(`(?<!\\w)${escapeRegExp(keyword)}(?!\\w)`, 'gi');
			return { keyword, count: bodyText.match(regex)?.length ?? 0 };
		});
}
