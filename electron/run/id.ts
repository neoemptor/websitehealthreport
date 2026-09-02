export function makeRunId(clientUrl: string, now: Date): string {
	// Colons are legal in ISO 8601 and illegal in Windows filenames, and this id
	// is used as a filename. The full timestamp is kept in Run.createdAt.
	const stamp = now
		.toISOString()
		.replace(/\.\d{3}Z$/, '')
		.replace(/:/g, '');

	const host = new URL(clientUrl).hostname.replace(/^www\./, '').replace(/[^a-zA-Z0-9]+/g, '-');

	return `${stamp}-${host}`;
}

// The shape makeRunId produces: 2026-09-02T081500-example-com.
const RUN_ID = /^\d{4}-\d{2}-\d{2}T\d{6}-[A-Za-z0-9-]+$/;

export function isRunId(value: unknown): value is string {
	return typeof value === 'string' && value.length <= 200 && RUN_ID.test(value);
}

/**
 * Guards the IPC boundary. A run id is interpolated straight into a file path
 * on disk, and the renderer is untrusted by construction — it is a browser
 * that happens to be ours today. Only reachable from our own pages now, but
 * that is a fact about the current UI, not a property of the handler.
 */
export function assertRunId(value: unknown): string {
	if (!isRunId(value)) {
		throw new Error(`Invalid run id: ${JSON.stringify(String(value).slice(0, 80))}`);
	}
	return value;
}
