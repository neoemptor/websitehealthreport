import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { CredentialStore } from './credentials';

// fs/promises is an ESM namespace, so its members cannot be redefined by
// vi.spyOn; the module is wrapped instead so chmod can be observed and made
// to fail. Every other member is the real implementation.
const chmodSpy = vi.hoisted(() => vi.fn());
vi.mock('fs/promises', async () => {
	const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
	chmodSpy.mockImplementation(actual.chmod);
	return { ...actual, default: actual, chmod: chmodSpy };
});

// Reversible stand-in for safeStorage, which needs a running Electron app.
const fakeCrypto = {
	isEncryptionAvailable: () => true,
	encryptString: (s: string) => Buffer.from(s, 'utf-8').reverse(),
	decryptString: (b: Buffer) => Buffer.from(b).reverse().toString('utf-8')
};

let dir: string;
let store: CredentialStore;

beforeEach(async () => {
	chmodSpy.mockClear();
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
		const spy = vi.spyOn(fakeCrypto, 'encryptString');
		await store.set('semrush', 'key-123');
		const entries = await fs.readdir(dir, { recursive: true } as { recursive: boolean });
		for (const entry of entries) {
			const full = path.join(dir, entry as unknown as string);
			const stat = await fs.stat(full);
			if (!stat.isFile()) continue;
			const raw = await fs.readFile(full, 'utf-8');
			expect(raw).not.toContain('key-123');
		}
		expect(spy).toHaveBeenCalledWith('key-123');
		spy.mockRestore();
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

	it.skipIf(process.platform === 'win32')(
		'restricts the store file and directory to the owner',
		async () => {
			await store.set('semrush', 'key-123');
			const filePath = path.join(dir, 'credentials.enc');
			const fileStat = await fs.stat(filePath);
			const dirStat = await fs.stat(dir);
			expect(fileStat.mode & 0o777).toBe(0o600);
			expect(dirStat.mode & 0o777).toBe(0o700);
		}
	);

	it('tightens the store directory to owner-only on write, on every platform', async () => {
		// The POSIX test above can only observe the result where modes exist;
		// this one checks the attempt is made at all, since Electron's userData
		// directory usually pre-exists and mkdir's mode would then never apply.
		await store.set('semrush', 'key-123');

		expect(chmodSpy.mock.calls).toContainEqual([dir, 0o700]);
	});

	it('still saves the credential when the directory chmod fails', async () => {
		const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
		chmodSpy.mockImplementation(async (target: unknown, mode: unknown) => {
			if (target === dir) throw new Error('EPERM');
			await actual.chmod(target as string, mode as number);
		});

		await store.set('semrush', 'key-123');

		expect(await store.get('semrush')).toBe('key-123');
		chmodSpy.mockImplementation(actual.chmod);
	});

	it('serialises overlapping set() calls so no write is lost', async () => {
		await Promise.all([store.set('a', '1'), store.set('b', '2')]);
		expect(await store.get('a')).toBe('1');
		expect(await store.get('b')).toBe('2');
	});

	it('returns null (not a throw) for a corrupt or foreign ciphertext, though has() still reports it', async () => {
		// A crypto backend that rejects anything it didn't produce itself, so a bogus
		// or foreign value in the envelope is guaranteed to fail decryption rather
		// than merely coming out garbled.
		const strictCrypto = {
			isEncryptionAvailable: () => true,
			encryptString: (s: string) => Buffer.from(`ENC:${s}`, 'utf-8').reverse(),
			decryptString: (b: Buffer) => {
				const raw = Buffer.from(b).reverse().toString('utf-8');
				if (!raw.startsWith('ENC:')) throw new Error('bad ciphertext');
				return raw.slice(4);
			}
		};
		const strictStore = new CredentialStore(dir, strictCrypto);
		await strictStore.set('semrush', 'key-123');
		const filePath = path.join(dir, 'credentials.enc');
		const envelope = JSON.parse(await fs.readFile(filePath, 'utf-8')) as Record<string, string>;
		envelope.semrush = 'not-valid-base64-ciphertext!!';
		await fs.writeFile(filePath, JSON.stringify(envelope), 'utf-8');

		await expect(strictStore.get('semrush')).resolves.toBeNull();
		// has() only proves the key is present in the envelope, not that it decrypts.
		expect(await strictStore.has('semrush')).toBe(true);
	});

	it('does not create the file when removing a key that was never set', async () => {
		await store.remove('nope');
		await expect(fs.access(path.join(dir, 'credentials.enc'))).rejects.toThrow();
	});
});
