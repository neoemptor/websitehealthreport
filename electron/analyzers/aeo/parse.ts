export const AI_CRAWLERS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot'];

export type CrawlerRule = { agent: string; allowed: boolean };

type RobotsGroup = { agents: string[]; disallowRoot: boolean };

/**
 * Groups consecutive User-agent lines together, then attaches the Allow/
 * Disallow directives that follow until the next group starts.
 */
function parseRobotsGroups(robotsTxt: string): RobotsGroup[] {
	const lines = robotsTxt.split('\n').map((line) => line.trim());
	const groups: RobotsGroup[] = [];
	let current: RobotsGroup | null = null;
	let sawDirective = false;

	for (const line of lines) {
		const userAgent = /^user-agent:\s*(.+)$/i.exec(line);
		if (userAgent) {
			if (!current || sawDirective) {
				current = { agents: [], disallowRoot: false };
				groups.push(current);
				sawDirective = false;
			}
			current.agents.push(userAgent[1].trim().toLowerCase());
			continue;
		}
		if (!current) continue;
		if (/^disallow:\s*\/\s*$/i.test(line)) {
			current.disallowRoot = true;
			sawDirective = true;
		} else if (/^(allow|disallow):/i.test(line)) {
			sawDirective = true;
		}
	}

	return groups;
}

export function parseRobotsForAiCrawlers(robotsTxt: string): CrawlerRule[] {
	const groups = parseRobotsGroups(robotsTxt);

	return AI_CRAWLERS.map((agent) => {
		const ownGroup = groups.find((group) => group.agents.includes(agent.toLowerCase()));
		if (ownGroup) return { agent, allowed: !ownGroup.disallowRoot };

		// No group of its own: it falls back to whatever the wildcard group says.
		const wildcardGroup = groups.find((group) => group.agents.includes('*'));
		return { agent, allowed: wildcardGroup ? !wildcardGroup.disallowRoot : true };
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
				collectTypes(node, types);
			}
		} catch {
			// An unparseable block still counts toward blocks, not valid.
		}
	}

	return { blocks: matches.length, valid, types };
}

/** Collects every `@type` string from a node, descending into `@graph` arrays. */
function collectTypes(node: unknown, types: string[]): void {
	if (node === null || typeof node !== 'object') return;
	const record = node as Record<string, unknown>;

	const type = record['@type'];
	if (typeof type === 'string') {
		types.push(type);
	} else if (Array.isArray(type)) {
		for (const entry of type) {
			if (typeof entry === 'string') types.push(entry);
		}
	}

	if (Array.isArray(record['@graph'])) {
		for (const child of record['@graph'] as unknown[]) {
			collectTypes(child, types);
		}
	}
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
