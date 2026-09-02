import { describe, it, expect } from 'vitest';
import { normaliseDomain, isSafeUrl } from './url';

describe('normaliseDomain', () => {
  it('adds https and a trailing slash to a bare domain', () => {
    expect(normaliseDomain('cjsgaragedoors.com.au')).toBe('https://cjsgaragedoors.com.au/');
  });

  it('preserves an existing https URL', () => {
    expect(normaliseDomain('https://www.cjsgaragedoors.com.au/')).toBe('https://www.cjsgaragedoors.com.au/');
  });

  it('preserves http rather than upgrading it', () => {
    expect(normaliseDomain('http://example.com/')).toBe('http://example.com/');
  });

  it('trims surrounding whitespace', () => {
    expect(normaliseDomain('  example.com  ')).toBe('https://example.com/');
  });

  it('rejects a non-http scheme', () => {
    expect(() => normaliseDomain('ftp://example.com')).toThrow(/http/);
  });

  it('rejects an empty string', () => {
    expect(() => normaliseDomain('   ')).toThrow();
  });

  it('rejects a value that would be read as a CLI flag', () => {
    expect(() => normaliseDomain('--output=/etc/passwd')).toThrow();
  });
});

describe('isSafeUrl', () => {
  it('accepts https', () => {
    expect(isSafeUrl('https://example.com/')).toBe(true);
  });

  it('rejects file urls', () => {
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects unparseable input', () => {
    expect(isSafeUrl('not a url')).toBe(false);
  });
});
