export type AnalyzerId =
  | 'lighthouse'
  | 'keywords'
  | 'seoquake'
  | 'wayback'
  | 'security'
  | 'aeo'
  | 'content'
  | 'traffic-owned'
  | 'traffic-estimated';

export type AnalyzerResult =
  | { status: 'ok'; data: unknown }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; error: string };

export type DomainRole = 'client' | 'competitor';

export type DomainResult = {
  domain: string;
  role: DomainRole;
  analyzers: Partial<Record<AnalyzerId, AnalyzerResult>>;
};

export type RunStatus = 'running' | 'complete' | 'aborted';

export type Run = {
  id: string;
  createdAt: string;
  client: string;
  competitors: string[];
  enabledAnalyzers: AnalyzerId[];
  status: RunStatus;
  domains: DomainResult[];
};

export function isOk(r: AnalyzerResult): r is { status: 'ok'; data: unknown } {
  return r.status === 'ok';
}

export function isUnavailable(r: AnalyzerResult): r is { status: 'unavailable'; reason: string } {
  return r.status === 'unavailable';
}

export function isFailed(r: AnalyzerResult): r is { status: 'failed'; error: string } {
  return r.status === 'failed';
}
