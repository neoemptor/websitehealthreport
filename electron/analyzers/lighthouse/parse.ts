export type LighthouseData = {
  scores: { performance: number; accessibility: number; bestPractices: number; seo: number };
  metrics: { lcpMs: number; cls: number; tbtMs: number };
};

type Lhr = {
  categories?: Record<string, { score?: number | null }>;
  audits?: Record<string, { numericValue?: number }>;
};

function score(lhr: Lhr, key: string): number {
  const raw = lhr.categories?.[key]?.score;
  if (typeof raw !== 'number') {
    throw new Error(`Lighthouse result is missing the ${key} category score.`);
  }
  return Math.round(raw * 100);
}

function metric(lhr: Lhr, key: string): number {
  const raw = lhr.audits?.[key]?.numericValue;
  if (typeof raw !== 'number') {
    throw new Error(`Lighthouse result is missing the ${key} audit.`);
  }
  return raw;
}

export function parseLighthouse(input: unknown): LighthouseData {
  const lhr = input as Lhr;
  if (!lhr || typeof lhr !== 'object' || !lhr.categories) {
    throw new Error('Not a Lighthouse result: no categories present.');
  }

  return {
    scores: {
      performance: score(lhr, 'performance'),
      accessibility: score(lhr, 'accessibility'),
      bestPractices: score(lhr, 'best-practices'),
      seo: score(lhr, 'seo')
    },
    metrics: {
      lcpMs: metric(lhr, 'largest-contentful-paint'),
      cls: metric(lhr, 'cumulative-layout-shift'),
      tbtMs: metric(lhr, 'total-blocking-time')
    }
  };
}
