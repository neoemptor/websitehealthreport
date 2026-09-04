<script lang="ts">
	type GscData = {
		totals: { clicks: number; impressions: number; ctr: number; position: number };
		topQueries: Array<{ query: string; clicks: number; impressions: number }>;
	};
	type Ga4Data = { sessions: number; users: number; engagementRate: number };
	type SourceResult<T> = { status: 'ok'; data: T } | { status: 'unavailable'; reason: string };

	export let data: {
		searchConsole: SourceResult<GscData>;
		ga4: SourceResult<Ga4Data>;
		range: { start: string; end: string };
	};

	function isSourceResult(v: unknown): v is SourceResult<unknown> {
		const s = v as { status?: unknown } | null;
		return !!s && (s.status === 'ok' || s.status === 'unavailable');
	}

	// data may be malformed (an unexpected shape reaching the report); never throw on it.
	$: searchConsole = isSourceResult(data?.searchConsole)
		? (data.searchConsole as SourceResult<GscData>)
		: null;
	$: ga4 = isSourceResult(data?.ga4) ? (data.ga4 as SourceResult<Ga4Data>) : null;
	$: start = typeof data?.range?.start === 'string' ? data.range.start : '?';
	$: end = typeof data?.range?.end === 'string' ? data.range.end : '?';

	$: gscData = searchConsole?.status === 'ok' ? searchConsole.data : null;
	$: gscReason = searchConsole?.status === 'unavailable' ? searchConsole.reason : null;
	$: ga4Data = ga4?.status === 'ok' ? ga4.data : null;
	$: ga4Reason = ga4?.status === 'unavailable' ? ga4.reason : null;

	$: topQueries = Array.isArray(gscData?.topQueries) ? gscData!.topQueries.slice(0, 10) : [];

	function pct(n: number): string {
		return `${(n * 100).toFixed(1)}%`;
	}
</script>

<p class="mt-2 text-[11px] text-dark-500">
	Measured by the site owner's Google account, {start} to {end}.
</p>

<h4 class="mt-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-dark-500">
	Search Console
</h4>
{#if gscData}
	<table class="mt-2 w-full break-inside-avoid border-collapse text-left">
		<tbody>
			<tr class="border-b border-dark-200">
				<td class="py-2 pr-4"><span class="block text-[12px] text-dark-700">Clicks</span></td>
				<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
					{gscData.totals.clicks.toLocaleString('en-AU')}
				</td>
			</tr>
			<tr class="border-b border-dark-200">
				<td class="py-2 pr-4"><span class="block text-[12px] text-dark-700">Impressions</span></td>
				<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
					{gscData.totals.impressions.toLocaleString('en-AU')}
				</td>
			</tr>
			<tr class="border-b border-dark-200">
				<td class="py-2 pr-4"
					><span class="block text-[12px] text-dark-700">Click-through rate</span></td
				>
				<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
					{pct(gscData.totals.ctr)}
				</td>
			</tr>
			<tr class="border-b border-dark-200 last:border-0">
				<td class="py-2 pr-4"
					><span class="block text-[12px] text-dark-700">Average position</span></td
				>
				<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
					{gscData.totals.position.toFixed(1)}
				</td>
			</tr>
		</tbody>
	</table>

	{#if topQueries.length > 0}
		<table class="mt-3 w-full border-collapse text-left">
			<thead>
				<tr class="border-b border-dark-200">
					<th class="pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-dark-500"
						>Top queries</th
					>
					<th
						class="w-20 pb-1 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-dark-500"
						>Clicks</th
					>
					<th
						class="w-24 pb-1 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-dark-500"
						>Impressions</th
					>
				</tr>
			</thead>
			<tbody>
				{#each topQueries as row}
					<tr class="break-inside-avoid border-b border-dark-200 last:border-0">
						<td class="py-2 pr-4 font-mono text-[11px] text-dark-700">{row.query}</td>
						<td class="py-2 text-right font-mono text-[11px] text-dark-700"
							>{row.clicks.toLocaleString('en-AU')}</td
						>
						<td class="py-2 text-right font-mono text-[11px] text-dark-700"
							>{row.impressions.toLocaleString('en-AU')}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
{:else}
	<p class="mt-2 text-[12px] text-dark-500">{gscReason ?? 'Search Console is not connected.'}</p>
{/if}

<h4 class="mt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-dark-500">GA4</h4>
{#if ga4Data}
	<table class="mt-2 w-full break-inside-avoid border-collapse text-left">
		<tbody>
			<tr class="border-b border-dark-200">
				<td class="py-2 pr-4"><span class="block text-[12px] text-dark-700">Sessions</span></td>
				<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
					{ga4Data.sessions.toLocaleString('en-AU')}
				</td>
			</tr>
			<tr class="border-b border-dark-200">
				<td class="py-2 pr-4"><span class="block text-[12px] text-dark-700">Users</span></td>
				<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
					{ga4Data.users.toLocaleString('en-AU')}
				</td>
			</tr>
			<tr class="border-b border-dark-200 last:border-0">
				<td class="py-2 pr-4"
					><span class="block text-[12px] text-dark-700">Engagement rate</span></td
				>
				<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
					{pct(ga4Data.engagementRate)}
				</td>
			</tr>
		</tbody>
	</table>
{:else}
	<p class="mt-2 text-[12px] text-dark-500">{ga4Reason ?? 'GA4 is not connected.'}</p>
{/if}
