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
		await fs.mkdir(path.dirname(this.file), { recursive: true });
		const temp = `${this.file}.${process.pid}.tmp`;
		await fs.writeFile(temp, JSON.stringify(envelope), 'utf-8');
		await fs.rename(temp, this.file);
	}

	async set(key: string, value: string): Promise<void> {
		if (!this.crypto.isEncryptionAvailable()) {
			// Storing a client's refresh token in plaintext is worse than failing.
			throw new Error('OS encryption is unavailable, so credentials cannot be stored safely.');
		}
		const envelope = await this.readAll();
		envelope[key] = this.crypto.encryptString(value).toString('base64');
		await this.writeAll(envelope);
	}

	async get(key: string): Promise<string | null> {
		const stored = (await this.readAll())[key];
		if (!stored) return null;
		return this.crypto.decryptString(Buffer.from(stored, 'base64'));
	}

	async has(key: string): Promise<boolean> {
		return Object.prototype.hasOwnProperty.call(await this.readAll(), key);
	}

	async remove(key: string): Promise<void> {
		const envelope = await this.readAll();
		delete envelope[key];
		await this.writeAll(envelope);
	}
}
