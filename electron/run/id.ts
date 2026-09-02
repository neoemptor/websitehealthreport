export function makeRunId(clientUrl: string, now: Date): string {
  // Colons are legal in ISO 8601 and illegal in Windows filenames, and this id
  // is used as a filename. The full timestamp is kept in Run.createdAt.
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '');

  const host = new URL(clientUrl).hostname
    .replace(/^www\./, '')
    .replace(/[^a-zA-Z0-9]+/g, '-');

  return `${stamp}-${host}`;
}
