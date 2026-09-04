/**
 * LanguageTool grammar provider. Off by default so no client content ever leaves the
 * machine unless the operator opts in to the public API or points at their own server.
 * Credentials are never accepted here — the public API needs none, and a custom server
 * is operator-run, so there is no key to carry through settings.json or IPC.
 */
export type GrammarSettings = {
	provider: 'off' | 'languagetool-public' | 'languagetool-custom';
	endpoint?: string;
};

export type GrammarFinding = { message: string; context: string; ruleId: string };

export type GrammarState =
	| { status: 'ok'; findings: GrammarFinding[] }
	| { status: 'unavailable'; reason: string }
	| { status: 'failed'; error: string };

const PUBLIC_ENDPOINT = 'https://api.languagetool.org/v2/check';
const DEFAULT_TIMEOUT_MS = 30_000;

export function resolveEndpoint(settings: GrammarSettings): string | null {
	switch (settings.provider) {
		case 'off':
			return null;
		case 'languagetool-public':
			return PUBLIC_ENDPOINT;
		case 'languagetool-custom':
			if (!settings.endpoint) {
				throw new Error('A custom LanguageTool server was selected but no endpoint is configured.');
			}
			return validateHttpUrl(settings.endpoint);
	}
}

function validateHttpUrl(endpoint: string): string {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		throw new Error('The grammar server address must start with http:// or https://.');
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('The grammar server address must start with http:// or https://.');
	}

	return endpoint;
}

type LanguageToolMatch = {
	message: string;
	context: { text: string; offset: number; length: number };
	rule: { id: string };
};

export function parseLanguageTool(payload: unknown): GrammarFinding[] {
	const matches = (payload as { matches?: unknown }).matches;
	if (!Array.isArray(matches)) {
		throw new Error('LanguageTool response contained no matches array.');
	}

	return (matches as LanguageToolMatch[]).map((match) => {
		if (!match.context || typeof match.context.text !== 'string') {
			throw new Error('LanguageTool response contained a malformed match context.');
		}

		const { text, offset, length } = match.context;
		if (
			!Number.isInteger(offset) ||
			!Number.isInteger(length) ||
			offset < 0 ||
			length < 0 ||
			offset + length > text.length
		) {
			throw new Error('LanguageTool response contained a malformed match context.');
		}

		return {
			message: match.message,
			// The API reports the offending span as an offset into a context window.
			context: text.slice(offset, offset + length),
			ruleId: match.rule.id
		};
	});
}

export async function checkGrammar(
	text: string,
	settings: GrammarSettings,
	signal: AbortSignal
): Promise<GrammarState> {
	let endpoint: string | null;
	try {
		endpoint = resolveEndpoint(settings);
	} catch (error) {
		return { status: 'unavailable', reason: (error as Error).message };
	}

	if (endpoint === null) {
		return { status: 'unavailable', reason: 'Grammar checking is turned off.' };
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
	const onAbort = (): void => controller.abort();
	signal.addEventListener('abort', onAbort);

	try {
		const body = new URLSearchParams({ text, language: 'en-AU' });

		const response = await fetch(endpoint, { method: 'POST', body, signal: controller.signal });
		if (!response.ok) {
			throw new Error(`LanguageTool returned ${response.status}.`);
		}

		return { status: 'ok', findings: parseLanguageTool(await response.json()) };
	} catch (error) {
		// A grammar service failure must never cost the operator their spelling
		// results, so it is returned rather than thrown.
		return { status: 'failed', error: (error as Error).message };
	} finally {
		clearTimeout(timer);
		signal.removeEventListener('abort', onAbort);
	}
}
