import type { AnalyzerId } from '../../src/lib/shared/types';
import type { Analyzer } from './types';

export type Registry = {
  get(id: AnalyzerId): Analyzer;
  all(): Analyzer[];
  ids(): AnalyzerId[];
};

export function createRegistry(analyzers: Analyzer[]): Registry {
  const byId = new Map<AnalyzerId, Analyzer>();

  for (const analyzer of analyzers) {
    if (byId.has(analyzer.id)) {
      throw new Error(`Duplicate analyzer registration: ${analyzer.id}`);
    }
    byId.set(analyzer.id, analyzer);
  }

  return {
    get(id) {
      const found = byId.get(id);
      if (!found) {
        throw new Error(`No analyzer registered with id ${id}`);
      }
      return found;
    },
    all: () => [...byId.values()],
    ids: () => [...byId.keys()]
  };
}
