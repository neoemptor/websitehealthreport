export const AI_CRAWLERS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot'];

export type CrawlerRule = { agent: string; allowed: boolean };

export function parseRobotsForAiCrawlers(robotsTxt: string): CrawlerRule[] {
	const lines = robotsTxt.split('\n').map((line) => line.trim());

	return AI_CRAWLERS.map((agent) => {
		let inBlock = false;
		let disallowed = false;

		for (const line of lines) {
			const userAgent = /^user-agent:\s*(.+)$/i.exec(line);
			if (userAgent) {
				inBlock = userAgent[1].trim().toLowerCase() === agent.toLowerCase();
				continue;
			}
			if (inBlock && /^disallow:\s*\/\s*$/i.test(line)) {
				disallowed = true;
			}
		}

		// No rule naming the crawler means it is not blocked.
		return { agent, allowed: !disallowed };
	});
}

export function parseStructuredData(html: string): {
	blocks: number;
	valid: number;
	types: string[];
} {
	const matches = [
		...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
	];
	const types: string[] = [];
	let valid = 0;

	for (const match of matches) {
		try {
			const parsed = JSON.parse(match[1]);
			valid++;
			for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
				if (typeof node?.['@type'] === 'string') types.push(node['@type']);
			}
		} catch {
			// An unparseable block still counts toward blocks, not valid.
		}
	}

	return { blocks: matches.length, valid, types };
}

export function parseHeadings(html: string): { h1Count: number; hierarchyOk: boolean } {
	const levels = [...html.matchAll(/<h([1-6])[^>]*>/gi)].map((m) => Number(m[1]));
	const h1Count = levels.filter((level) => level === 1).length;

	let hierarchyOk = h1Count === 1;
	for (let i = 1; i < levels.length; i++) {
		// Descending more than one level at a time skips a heading rank.
		if (levels[i] - levels[i - 1] > 1) hierarchyOk = false;
	}

	return { h1Count, hierarchyOk };
}
