import * as fs from 'fs/promises';
import * as path from 'path';

export type CryptoBackend = {
	isEncryptionAvailable(): boolean;
	encryptString(value: string): Buffer;
	decryptString(value: Buffer): string;
};

type Envelope = Record<string, string>;

export class CredentialStore {
	private readonly file: string;
	private queue: Promise<void> = Promise.resolve();
	private tempCounter = 0;

	constructor(rootDir: string, private readonly crypto: CryptoBackend) {
		this.file = path.join(rootDir, 'credentials.enc');
	}

	private async readAll(): Promise<Envelope> {
		try {
			return JSON.parse(await fs.readFile(this.file, 'utf-8')) as Envelope;
		} catch {
			return {};
		}
	}

	private async writeAll(envelope: Envelope): Promise<void> {
		const dir = path.dirname(this.file);
		await fs.mkdir(dir, { recursive: true, mode: 0o700 });
		// mkdir's mode only applies to a directory it actually creates, and the
		// store lives inside Electron's userData directory, which almost always
		// already exists — so the mode is set explicitly here. Best-effort: on
		// Windows (and on a directory owned by someone else) chmod is a no-op or
		// throws, and neither is a reason to refuse to save a credential.
		await fs.chmod(dir, 0o700).catch(() => undefined);
		const temp = `${this.file}.${process.pid}.${this.tempCounter++}.tmp`;
		await fs.writeFile(temp, JSON.stringify(envelope), { encoding: 'utf-8', mode: 0o600 });
		await fs.chmod(temp, 0o600);
		await fs.rename(temp, this.file);
	}

	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const result = this.queue.then(task);
		// Keep the chain alive regardless of success/failure so later calls still run in order.
		this.queue = result.then(
			() => undefined,
			() => undefined
		);
		return result;
	}

	async set(key: string, value: string): Promise<void> {
		return this.enqueue(async () => {
			if (!this.crypto.isEncryptionAvailable()) {
				// Storing a client's refresh token in plaintext is worse than failing.
				throw new Error('OS encryption is unavailable, so credentials cannot be stored safely.');
			}
			const envelope = await this.readAll();
			envelope[key] = this.crypto.encryptString(value).toString('base64');
			await this.writeAll(envelope);
		});
	}

	async get(key: string): Promise<string | null> {
		const stored = (await this.readAll())[key];
		if (typeof stored !== 'string') return null;
		try {
			return this.crypto.decryptString(Buffer.from(stored, 'base64'));
		} catch {
			// A corrupt or foreign ciphertext must never throw out of get().
			return null;
		}
	}

	async has(key: string): Promise<boolean> {
		return Object.prototype.hasOwnProperty.call(await this.readAll(), key);
	}

	async remove(key: string): Promise<void> {
		return this.enqueue(async () => {
			const envelope = await this.readAll();
			if (!Object.prototype.hasOwnProperty.call(envelope, key)) return;
			delete envelope[key];
			await this.writeAll(envelope);
		});
	}
}
