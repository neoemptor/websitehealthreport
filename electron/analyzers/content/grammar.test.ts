import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveEndpoint, parseLanguageTool, checkGrammar } from './grammar';

afterEach(() => vi.unstubAllGlobals());

describe('resolveEndpoint', () => {
	it('returns null when the provider is off', () => {
		expect(resolveEndpoint({ provider: 'off' })).toBeNull();
	});

	it('returns the public endpoint', () => {
		expect(resolveEndpoint({ provider: 'languagetool-public' })).toContain('languagetool.org');
	});

	it('returns the configured endpoint for a custom server', () => {
		expect(
			resolveEndpoint({
				provider: 'languagetool-custom',
				endpoint: 'http://localhost:8081/v2/check'
			})
		).toBe('http://localhost:8081/v2/check');
	});

	it('throws when custom is selected without an endpoint', () => {
		expect(() => resolveEndpoint({ provider: 'languagetool-custom' })).toThrow(/endpoint/i);
	});

	it('throws a readable reason when the custom endpoint is not http(s)', () => {
		expect(() =>
			resolveEndpoint({ provider: 'languagetool-custom', endpoint: 'ftp://example.com/check' })
		).toThrow('The grammar server address must start with http:// or https://.');
	});

	it('throws a readable reason when the custom endpoint is not a valid URL', () => {
		expect(() =>
			resolveEndpoint({ provider: 'languagetool-custom', endpoint: 'not a url' })
		).toThrow('The grammar server address must start with http:// or https://.');
	});
});

describe('parseLanguageTool', () => {
	it('maps matches to findings', () => {
		const payload = {
			matches: [
				{
					message: 'Possible typo',
					context: { text: 'a teh b', offset: 2, length: 3 },
					rule: { id: 'TYPO' }
				}
			]
		};
		expect(parseLanguageTool(payload)).toEqual([
			{ message: 'Possible typo', context: 'teh', ruleId: 'TYPO' }
		]);
	});

	it('returns an empty array when there are no matches', () => {
		expect(parseLanguageTool({ matches: [] })).toEqual([]);
	});

	it('throws on a malformed payload', () => {
		expect(() => parseLanguageTool({ nope: 1 })).toThrow(/matches/i);
	});

	it('throws when offset is non-numeric', () => {
		const payload = {
			matches: [
				{
					message: 'Possible typo',
					context: { text: 'a teh b', offset: 'two', length: 3 },
					rule: { id: 'TYPO' }
				}
			]
		};
		expect(() => parseLanguageTool(payload)).toThrow(/malformed/i);
	});

	it('throws when length is out of range', () => {
		const payload = {
			matches: [
				{
					message: 'Possible typo',
					context: { text: 'a teh b', offset: 2, length: 100 },
					rule: { id: 'TYPO' }
				}
			]
		};
		expect(() => parseLanguageTool(payload)).toThrow(/malformed/i);
	});

	it('throws when offset is negative', () => {
		const payload = {
			matches: [
				{
					message: 'Possible typo',
					context: { text: 'a teh b', offset: -1, length: 3 },
					rule: { id: 'TYPO' }
				}
			]
		};
		expect(() => parseLanguageTool(payload)).toThrow(/malformed/i);
	});

	it('throws when a match has no context object', () => {
		const payload = {
			matches: [{ message: 'Possible typo', rule: { id: 'TYPO' } }]
		};
		expect(() => parseLanguageTool(payload)).toThrow(/malformed/i);
	});

	it('throws when context.text is not a string', () => {
		const payload = {
			matches: [
				{
					message: 'Possible typo',
					context: { text: 123, offset: 0, length: 1 },
					rule: { id: 'TYPO' }
				}
			]
		};
		expect(() => parseLanguageTool(payload)).toThrow(/malformed/i);
	});
});

describe('checkGrammar', () => {
	it('reports unavailable when the provider is off, without calling out', async () => {
		const spy = vi.fn();
		vi.stubGlobal('fetch', spy);
		const state = await checkGrammar('text', { provider: 'off' }, new AbortController().signal);
		expect(state).toEqual({ status: 'unavailable', reason: 'Grammar checking is turned off.' });
		expect(spy).not.toHaveBeenCalled();
	});

	it('reports failed rather than throwing when the service errors', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 500 }))
		);
		const state = await checkGrammar(
			'text',
			{ provider: 'languagetool-custom', endpoint: 'http://localhost:8081/v2/check' },
			new AbortController().signal
		);
		expect(state.status).toBe('failed');
	});
});
