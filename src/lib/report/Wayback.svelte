<script lang="ts">
	export let data: {
		firstSeen: string | null;
		lastSeen: string | null;
		snapshotsByYear: Array<{ year: string; count: number }>;
	};

	// data may be malformed (an unexpected shape reaching the report); never throw on it.
	$: firstSeen = typeof data?.firstSeen === 'string' ? data.firstSeen : null;
	$: lastSeen = typeof data?.lastSeen === 'string' ? data.lastSeen : null;
	$: rows = Array.isArray(data?.snapshotsByYear) ? data.snapshotsByYear : [];
</script>

{#if firstSeen}
	<p class="mt-2 text-[12.5px] leading-relaxed text-dark-600">
		Archived since {firstSeen}, last seen {lastSeen}.
	</p>
	<table class="mt-3 w-full border-collapse text-left">
		<thead>
			<tr>
				<th class="pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-dark-500">Year</th
				>
				<th
					class="w-28 pb-1 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-dark-500"
					>Days captured</th
				>
			</tr>
		</thead>
		<tbody>
			{#each rows as row}
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
