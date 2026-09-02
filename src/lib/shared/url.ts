export function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normaliseDomain(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error('Domain is empty.');
  }

  // Reject values that look like CLI flags
  if (trimmed.startsWith('-')) {
    throw new Error(`${input} is not a valid http or https URL.`);
  }

  // A bare domain gets https. Anything already carrying a scheme keeps it,
  // so an explicit http:// is not silently upgraded.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  if (!isSafeUrl(candidate)) {
    throw new Error(`${input} is not a valid http or https URL.`);
  }

  return new URL(candidate).toString();
}
