<script lang="ts">
	export let data: {
		organicKeywords: number | null;
		organicTraffic: number | null;
		organicCost: number | null;
		adwordsKeywords: number | null;
		nothingFound: boolean;
	};

	// data may be malformed (an unexpected shape reaching the report); never throw on it.
	$: nothingFound = data?.nothingFound === true;
	$: organicKeywords = typeof data?.organicKeywords === 'number' ? data.organicKeywords : null;
	$: organicTraffic = typeof data?.organicTraffic === 'number' ? data.organicTraffic : null;
	$: organicCost = typeof data?.organicCost === 'number' ? data.organicCost : null;
	$: adwordsKeywords = typeof data?.adwordsKeywords === 'number' ? data.adwordsKeywords : null;
	$: allNull =
		organicKeywords === null &&
		organicTraffic === null &&
		organicCost === null &&
		adwordsKeywords === null;

	$: rows = [
		{ label: 'Monthly visits (estimate)', value: organicTraffic },
		{ label: 'Organic keywords (estimate)', value: organicKeywords },
		{ label: 'Advertised keywords (estimate)', value: adwordsKeywords },
		{ label: 'Monthly ad spend (estimate)', value: organicCost, prefix: '$' }
	].filter((row) => row.value !== null);
</script>

{#if nothingFound || allNull}
	<p class="mt-2 text-[12px] text-dark-500">Semrush has no estimate for this site.</p>
{:else}
	<p class="mt-2 text-[11px] text-dark-500">Estimates from Semrush, not measured traffic.</p>
	<table class="mt-2 w-full break-inside-avoid border-collapse text-left">
		<tbody>
			{#each rows as row}
				<tr class="border-b border-dark-200 last:border-0">
					<td class="py-2 pr-4">
						<span class="block text-[12px] text-dark-700">{row.label}</span>
					</td>
					<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
						{row.prefix ?? ''}{row.value?.toLocaleString('en-AU')}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}
