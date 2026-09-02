import { describe, it, expect } from 'vitest';
import { createRegistry } from './registry';
import type { Analyzer } from './types';

const fake = (id: string): Analyzer => ({
  id: id as Analyzer['id'],
  label: id,
  concurrency: 'parallel',
  timeoutMs: 1000,
  defaultSettings: {},
  preflight: async () => ({ available: true }),
  analyze: async () => ({})
});

describe('createRegistry', () => {
  it('returns an analyzer by id', () => {
    const registry = createRegistry([fake('keywords')]);
    expect(registry.get('keywords').label).toBe('keywords');
  });

  it('throws on an unknown id rather than returning undefined', () => {
    const registry = createRegistry([fake('keywords')]);
    expect(() => registry.get('lighthouse')).toThrow(/lighthouse/);
  });

  it('rejects duplicate registrations', () => {
    expect(() => createRegistry([fake('keywords'), fake('keywords')])).toThrow(/duplicate/i);
  });

  it('lists ids in registration order', () => {
    const registry = createRegistry([fake('lighthouse'), fake('keywords')]);
    expect(registry.ids()).toEqual(['lighthouse', 'keywords']);
  });
});
