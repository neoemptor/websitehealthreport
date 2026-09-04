<script lang="ts">
	export let data: {
		llmsTxt: boolean;
		sitemap: boolean;
		crawlers: Array<{ agent: string; allowed: boolean }>;
		structuredData: { blocks: number; valid: number; types: string[] };
		headings: { h1Count: number; hierarchyOk: boolean };
		jsDependencyRatio: number;
	};

	$: percentWithoutJs = Math.round(data.jsDependencyRatio * 100);
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
				{percentWithoutJs}%
			</td>
		</tr>
		<tr class="border-b border-dark-200">
			<td class="py-2 pr-4">
				<span class="block text-[12px] text-dark-700">Sitemap</span>
			</td>
			<td class="w-28 py-2 text-right">
				<span
					class="text-[10px] font-semibold uppercase tracking-wide {data.sitemap
						? 'text-ok'
						: 'text-dark-700'}"
				>
					{data.sitemap ? 'Present' : 'Missing'}
				</span>
			</td>
		</tr>
		<tr class="border-b border-dark-200">
			<td class="py-2 pr-4">
				<span class="block text-[12px] text-dark-700">llms.txt</span>
			</td>
			<td class="w-28 py-2 text-right">
				<span
					class="text-[10px] font-semibold uppercase tracking-wide {data.llmsTxt
						? 'text-ok'
						: 'text-dark-500'}"
				>
					{data.llmsTxt ? 'Present' : 'Absent'}
				</span>
			</td>
		</tr>
		<tr class="border-b border-dark-200">
			<td class="py-2 pr-4">
				<span class="block text-[12px] text-dark-700">Structured data</span>
				{#if data.structuredData.types.length > 0}
					<span class="block text-[10.5px] text-dark-500"
						>{data.structuredData.types.join(', ')}</span
					>
				{/if}
			</td>
			<td class="w-28 py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
				{data.structuredData.valid} of {data.structuredData.blocks} valid
			</td>
		</tr>
		<tr class="break-inside-avoid border-b border-dark-200 last:border-0">
			<td class="py-2 pr-4">
				<span class="block text-[12px] text-dark-700">Headings</span>
				<span class="block text-[10.5px] text-dark-500">
					{data.headings.hierarchyOk ? 'Hierarchy consistent' : 'Hierarchy skips levels'}
				</span>
			</td>
			<td class="w-28 py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
				{data.headings.h1Count} H1
			</td>
		</tr>
	</tbody>
</table>

<table class="mt-3 w-full border-collapse text-left">
	<tbody>
		{#each data.crawlers as crawler}
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
