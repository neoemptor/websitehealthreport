import * as tls from 'tls';

export type TlsInfo = {
	protocol: string | null;
	validTo: string | null;
	daysRemaining: number | null;
	issuer: string | null;
};

function normalizeIssuer(value: string | string[] | undefined): string | null {
	if (value === undefined) return null;
	return Array.isArray(value) ? value[0] ?? null : value;
}

export function daysUntil(expiry: string, now: Date): number {
	const parsed = Date.parse(expiry);
	if (Number.isNaN(parsed)) {
		throw new Error(`Could not parse certificate date: ${expiry}`);
	}
	return Math.floor((parsed - now.getTime()) / 86_400_000);
}

/**
 * Opens a single passive TLS handshake to port 443 with SNI, reads the
 * presented certificate and negotiated protocol, then closes the socket.
 * No cipher enumeration, no retries with weaker settings, no other ports.
 */
export function inspectTls(hostname: string, signal?: AbortSignal): Promise<TlsInfo> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error('Aborted: the task timed out or the run was cancelled.'));
			return;
		}

		const socket = tls.connect({ host: hostname, port: 443, servername: hostname }, () => {
			const cert = socket.getPeerCertificate();
			const info: TlsInfo = {
				protocol: socket.getProtocol(),
				validTo: cert?.valid_to ?? null,
				daysRemaining: cert?.valid_to ? daysUntil(cert.valid_to, new Date()) : null,
				issuer: normalizeIssuer(cert?.issuer?.O)
			};
			cleanup();
			socket.end();
			resolve(info);
		});

		const onAbort = (): void => {
			cleanup();
			socket.destroy();
			reject(new Error('Aborted: the task timed out or the run was cancelled.'));
		};

		const cleanup = (): void => {
			signal?.removeEventListener('abort', onAbort);
		};

		signal?.addEventListener('abort', onAbort);

		socket.setTimeout(10_000, () => {
			cleanup();
			socket.destroy();
			reject(new Error(`TLS connection to ${hostname} timed out.`));
		});
		socket.on('error', (error) => {
			cleanup();
			reject(error);
		});
	});
}
