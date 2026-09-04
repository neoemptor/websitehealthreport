<script lang="ts">
	export let data: {
		llmsTxt: boolean;
		sitemap: boolean;
		crawlers: Array<{ agent: string; allowed: boolean }>;
		structuredData: { blocks: number; valid: number; types: string[] };
		headings: { h1Count: number; hierarchyOk: boolean };
		jsDependencyRatio: number;
	};

	// data may be malformed (an unexpected shape reaching the report); never throw on it.
	$: llmsTxt = data?.llmsTxt === true;
	$: sitemap = data?.sitemap === true;
	$: crawlers = Array.isArray(data?.crawlers) ? data.crawlers : [];
	$: structuredData =
		data?.structuredData && typeof data.structuredData === 'object' ? data.structuredData : null;
	$: structuredDataTypes = Array.isArray(structuredData?.types) ? structuredData.types : [];
	$: headings = data?.headings && typeof data.headings === 'object' ? data.headings : null;
	$: jsDependencyRatio =
		typeof data?.jsDependencyRatio === 'number' ? data.jsDependencyRatio : null;
	// A ratio under 1 must never round up to display as 100%.
	$: percentWithoutJs =
		jsDependencyRatio === null
			? null
			: jsDependencyRatio >= 1
			? 100
			: Math.min(99, Math.round(jsDependencyRatio * 100));
</script>

<!-- Findings, never a score: there is no standard for this category. -->
<table class="mt-3 w-full break-inside-avoid border-collapse text-left">
	<tbody>
		<tr class="border-b border-dark-200">
			<td class="py-2 pr-4">
				<span class="block text-[12px] text-dark-700">Text available without JavaScript</span>
				<span class="block text-[10.5px] text-dark-500">
					What AI crawlers can read without running scripts
				</span>
			</td>
			<td class="w-28 py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
				{percentWithoutJs === null ? 'not measured' : `${percentWithoutJs}%`}
			</td>
		</tr>
		<tr class="border-b border-dark-200">
			<td class="py-2 pr-4">
				<span class="block text-[12px] text-dark-700">Sitemap</span>
			</td>
			<td class="w-28 py-2 text-right">
				<span
					class="text-[10px] font-semibold uppercase tracking-wide {sitemap
						? 'text-ok'
						: 'text-dark-700'}"
				>
					{sitemap ? 'Present' : 'Missing'}
				</span>
			</td>
		</tr>
		<tr class="border-b border-dark-200">
			<td class="py-2 pr-4">
				<span class="block text-[12px] text-dark-700">llms.txt</span>
			</td>
			<td class="w-28 py-2 text-right">
				<span
					class="text-[10px] font-semibold uppercase tracking-wide {llmsTxt
						? 'text-ok'
						: 'text-dark-500'}"
				>
					{llmsTxt ? 'Present' : 'Absent'}
				</span>
			</td>
		</tr>
		<tr class="border-b border-dark-200">
			<td class="py-2 pr-4">
				<span class="block text-[12px] text-dark-700">Structured data</span>
				{#if structuredDataTypes.length > 0}
					<span class="block text-[10.5px] text-dark-500">{structuredDataTypes.join(', ')}</span>
				{/if}
			</td>
			<td class="w-28 py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
				{#if structuredData}
					{structuredData.valid} of {structuredData.blocks} valid
				{:else}
					not measured
				{/if}
			</td>
		</tr>
		<tr class="break-inside-avoid border-b border-dark-200 last:border-0">
			<td class="py-2 pr-4">
				<span class="block text-[12px] text-dark-700">Headings</span>
				<span class="block text-[10.5px] text-dark-500">
					{#if headings}
						{headings.hierarchyOk ? 'Hierarchy consistent' : 'Hierarchy skips levels'}
					{:else}
						not measured
					{/if}
				</span>
			</td>
			<td class="w-28 py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
				{headings ? `${headings.h1Count} H1` : 'not measured'}
			</td>
		</tr>
	</tbody>
</table>

<table class="mt-3 w-full border-collapse text-left">
	<tbody>
		{#each crawlers as crawler}
			<tr class="break-inside-avoid border-b border-dark-200 last:border-0">
				<td class="py-2 pr-4 font-mono text-[11px] text-dark-700">{crawler.agent}</td>
				<td class="w-28 py-2 text-right">
					<span
						class="text-[10px] font-semibold uppercase tracking-wide {crawler.allowed
							? 'text-ok'
							: 'text-fail'}"
					>
						{crawler.allowed ? 'Allowed' : 'Blocked'}
					</span>
				</td>
			</tr>
		{/each}
	</tbody>
</table>
