<script lang="ts">
	export let data: {
		semrushRank: number | null;
		backlinks: number | null;
		linkingDomains: number | null;
		pinterest: number | null;
	};

	// data may be malformed (an unexpected shape reaching the report); never throw on it.
	// null is not zero — it means SEO Quake reported no figure for that reading,
	// so it must never be shown as 0.
	function reading(value: unknown): number | null {
		return typeof value === 'number' && Number.isFinite(value) ? value : null;
	}

	$: rows = [
		{ label: 'Semrush rank', value: reading(data?.semrushRank) },
		{ label: 'Backlinks', value: reading(data?.backlinks) },
		{ label: 'Linking domains', value: reading(data?.linkingDomains) },
		{ label: 'Pinterest', value: reading(data?.pinterest) }
	];
</script>

<table class="mt-3 w-full break-inside-avoid border-collapse text-left">
	<tbody>
		{#each rows as row}
			<tr class="break-inside-avoid border-b border-dark-200">
				<td class="py-2 pr-4 text-[12px] text-dark-700">{row.label}</td>
				<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
					{#if row.value === null}
						<span class="text-dark-500">no data</span>
					{:else}
						{row.value.toLocaleString('en-AU')}
					{/if}
				</td>
			</tr>
		{/each}
	</tbody>
</table>
