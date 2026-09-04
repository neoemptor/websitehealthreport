<script lang="ts">
	import { ownedView } from './traffic-view';

	export let data: unknown;

	$: view = ownedView(data);
	$: range = view.range;
	$: searchConsole = view.searchConsole;
	$: ga4 = view.ga4;
	$: topQueries = searchConsole.kind === 'ok' ? searchConsole.topQueries : [];
</script>

<p class="mt-2 text-[11px] text-dark-500">
	Measured by the site owner's Google account, {range?.start ?? '?'} to {range?.end ?? '?'}.
</p>

<h4 class="mt-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-dark-500">
	Search Console
</h4>
{#if searchConsole.kind === 'ok'}
	<table class="mt-2 w-full break-inside-avoid border-collapse text-left">
		<tbody>
			<tr class="border-b border-dark-200">
				<td class="py-2 pr-4"><span class="block text-[12px] text-dark-700">Clicks</span></td>
				<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
					{searchConsole.clicks.toLocaleString('en-AU')}
				</td>
			</tr>
			<tr class="border-b border-dark-200">
				<td class="py-2 pr-4"><span class="block text-[12px] text-dark-700">Impressions</span></td>
				<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
					{searchConsole.impressions.toLocaleString('en-AU')}
				</td>
			</tr>
			<tr class="border-b border-dark-200">
				<td class="py-2 pr-4"
					><span class="block text-[12px] text-dark-700">Click-through rate</span></td
				>
				<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
					{searchConsole.ctrPct}
				</td>
			</tr>
			<tr class="border-b border-dark-200 last:border-0">
				<td class="py-2 pr-4"
					><span class="block text-[12px] text-dark-700">Average position</span></td
				>
				<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
					{searchConsole.position}
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
	<p class="mt-2 text-[12px] text-dark-500">{searchConsole.reason}</p>
{/if}

<h4 class="mt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-dark-500">GA4</h4>
{#if ga4.kind === 'ok'}
	<table class="mt-2 w-full break-inside-avoid border-collapse text-left">
		<tbody>
			<tr class="border-b border-dark-200">
				<td class="py-2 pr-4"><span class="block text-[12px] text-dark-700">Sessions</span></td>
				<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
					{ga4.sessions.toLocaleString('en-AU')}
				</td>
			</tr>
			<tr class="border-b border-dark-200">
				<td class="py-2 pr-4"><span class="block text-[12px] text-dark-700">Users</span></td>
				<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
					{ga4.users.toLocaleString('en-AU')}
				</td>
			</tr>
			<tr class="border-b border-dark-200 last:border-0">
				<td class="py-2 pr-4"
					><span class="block text-[12px] text-dark-700">Engagement rate</span></td
				>
				<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
					{ga4.engagementPct}
				</td>
			</tr>
		</tbody>
	</table>
{:else}
	<p class="mt-2 text-[12px] text-dark-500">{ga4.reason}</p>
{/if}
