import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { CredentialStore } from './credentials';

// Reversible stand-in for safeStorage, which needs a running Electron app.
const fakeCrypto = {
	isEncryptionAvailable: () => true,
	encryptString: (s: string) => Buffer.from(s, 'utf-8').reverse(),
	decryptString: (b: Buffer) => Buffer.from(b).reverse().toString('utf-8')
};

let dir: string;
let store: CredentialStore;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whr-cred-'));
	store = new CredentialStore(dir, fakeCrypto);
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe('CredentialStore', () => {
	it('round-trips a secret', async () => {
		await store.set('semrush', 'key-123');
		expect(await store.get('semrush')).toBe('key-123');
	});

	it('never writes the plaintext to disk', async () => {
		await store.set('semrush', 'key-123');
		const raw = await fs.readFile(path.join(dir, 'credentials.enc'), 'utf-8');
		expect(raw).not.toContain('key-123');
	});

	it('reports presence without exposing the value', async () => {
		expect(await store.has('semrush')).toBe(false);
		await store.set('semrush', 'key-123');
		expect(await store.has('semrush')).toBe(true);
	});

	it('returns null for a missing key', async () => {
		expect(await store.get('nope')).toBeNull();
	});

	it('removes a secret', async () => {
		await store.set('semrush', 'key-123');
		await store.remove('semrush');
		expect(await store.get('semrush')).toBeNull();
	});

	it('throws when OS encryption is unavailable rather than storing plaintext', async () => {
		const insecure = new CredentialStore(dir, {
			...fakeCrypto,
			isEncryptionAvailable: () => false
		});
		await expect(insecure.set('semrush', 'key-123')).rejects.toThrow(/encryption/i);
	});
});
