import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { daysUntil, inspectTls } from './tls';

describe('daysUntil', () => {
	it('counts whole days to expiry', () => {
		expect(daysUntil('Dec 31 23:59:59 2026 GMT', new Date('2026-12-01T00:00:00Z'))).toBe(30);
	});

	it('returns a negative number for an expired certificate', () => {
		expect(daysUntil('Jan 1 00:00:00 2026 GMT', new Date('2026-02-01T00:00:00Z'))).toBeLessThan(0);
	});

	it('throws on an unparseable date rather than returning NaN', () => {
		expect(() => daysUntil('not a date', new Date())).toThrow(/date/i);
	});
});

type FakeSocket = EventEmitter & {
	getPeerCertificate: () => unknown;
	getProtocol: () => string | null;
	authorized: boolean;
	authorizationError: Error | null;
	destroy: ReturnType<typeof vi.fn>;
	end: ReturnType<typeof vi.fn>;
	setTimeout: (ms: number, cb: () => void) => void;
};

function makeFakeSocket(overrides: Partial<FakeSocket> = {}): FakeSocket {
	const emitter = new EventEmitter() as FakeSocket;
	emitter.getPeerCertificate = vi.fn(() => ({
		valid_to: 'Dec 31 23:59:59 2099 GMT',
		issuer: { O: 'Example CA' }
	}));
	emitter.getProtocol = vi.fn(() => 'TLSv1.3');
	emitter.authorized = true;
	emitter.authorizationError = null;
	emitter.destroy = vi.fn();
	emitter.end = vi.fn();
	emitter.setTimeout = vi.fn();
	return Object.assign(emitter, overrides);
}

let currentSocket: FakeSocket;
let connectCallback: (() => void) | undefined;

vi.mock('tls', () => ({
	connect: vi.fn((_opts: unknown, callback: () => void) => {
		connectCallback = callback;
		return currentSocket;
	})
}));

describe('inspectTls', () => {
	beforeEach(() => {
		currentSocket = makeFakeSocket();
		connectCallback = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('resolves protocol/daysRemaining/issuer/authorized on success', async () => {
		const promise = inspectTls('example.com');
		connectCallback?.();
		const result = await promise;

		expect(result.protocol).toBe('TLSv1.3');
		expect(result.issuer).toBe('Example CA');
		expect(result.authorized).toBe(true);
		expect(result.authorizationError).toBeNull();
		expect(result.daysRemaining).toBeGreaterThan(0);
		expect(currentSocket.destroy).toHaveBeenCalled();
	});

	it('clears the idle timeout before destroying the socket on success', async () => {
		const promise = inspectTls('example.com');
		connectCallback?.();
		await promise;
		expect(currentSocket.setTimeout).toHaveBeenCalledWith(0);
	});

	it('resolves with daysRemaining: null when valid_to is unparseable', async () => {
		currentSocket.getPeerCertificate = vi.fn(() => ({
			valid_to: 'not a date',
			issuer: { O: 'Example CA' }
		}));

		const promise = inspectTls('example.com');
		connectCallback?.();
		const result = await promise;

		expect(result.daysRemaining).toBeNull();
	});

	it('rejects and destroys the socket on timeout', async () => {
		currentSocket.setTimeout = vi.fn((_ms: number, cb: () => void) => {
			cb();
		});

		await expect(inspectTls('example.com')).rejects.toThrow(/timed out/i);
		expect(currentSocket.destroy).toHaveBeenCalled();
	});

	it('rejects with /Aborted/ and destroys the socket on abort', async () => {
		const controller = new AbortController();
		const promise = inspectTls('example.com', controller.signal);
		controller.abort();

		await expect(promise).rejects.toThrow(/Aborted/);
		expect(currentSocket.destroy).toHaveBeenCalled();
	});

	it('rejects and destroys the socket on error', async () => {
		const promise = inspectTls('example.com');
		currentSocket.emit('error', new Error('connection reset'));

		await expect(promise).rejects.toThrow(/connection reset/);
		expect(currentSocket.destroy).toHaveBeenCalled();
	});
});
