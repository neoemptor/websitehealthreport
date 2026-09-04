<script lang="ts">
	export let data: {
		firstSeen: string | null;
		lastSeen: string | null;
		snapshotsByYear: Array<{ year: string; count: number }>;
	};
</script>

{#if data.firstSeen}
	<p class="mt-2 text-[12.5px] leading-relaxed text-dark-600">
		Archived since {data.firstSeen}, last seen {data.lastSeen}.
	</p>
	<table class="mt-3 w-full border-collapse text-left">
		<tbody>
			{#each data.snapshotsByYear as row}
				<tr class="break-inside-avoid border-b border-dark-200 last:border-0">
					<td class="py-2 pr-4">
						<span class="block text-[12px] text-dark-700">{row.year}</span>
					</td>
					<td class="w-28 py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
						{row.count}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{:else}
	<p class="mt-2 text-[12px] text-dark-500">No archived snapshots found.</p>
{/if}
