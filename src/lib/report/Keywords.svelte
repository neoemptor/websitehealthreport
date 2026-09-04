<script lang="ts">
	export let data: { keywords: Array<{ keyword: string; count: number }> };

	// A keyword the site declares but never uses is the finding worth acting on,
	// so those are surfaced rather than left for the reader to spot in a table.
	$: unused = data.keywords.filter((k) => k.count === 0);
	$: ranked = [...data.keywords].sort((a, b) => b.count - a.count);
</script>

<!-- No keywords: the severity finding above already says so; nothing to add. -->
{#if data.keywords.length > 0}
	<!-- A short list is kept whole: a four-row table broken two rows either
	     side of a page reads as an error. A long one may still run over a
	     page — rows never split mid-row and Chromium repeats the header. -->
	<table
		class="mt-3 w-full border-collapse text-left {data.keywords.length <= 8
			? 'break-inside-avoid'
			: ''}"
	>
		<thead>
			<tr class="border-b border-dark-200">
				<th class="py-1.5 pr-4 text-[10px] font-semibold uppercase tracking-[0.1em] text-dark-500">
					Keyword
				</th>
				<th
					class="w-32 py-1.5 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-dark-500"
				>
					Times on page
				</th>
			</tr>
		</thead>
		<tbody>
			{#each ranked as row}
				<tr class="break-inside-avoid border-b border-dark-200/70 last:border-0">
					<td class="py-1.5 pr-4 font-mono text-[12px] text-dark-700">{row.keyword}</td>
					<td
						class="py-1.5 text-right font-mono text-[12px] tabular-nums {row.count === 0
							? 'text-fail'
							: 'text-dark-700'}"
					>
						{row.count}
						{#if row.count === 0}
							<span class="ml-1 text-[10px] font-semibold uppercase tracking-wide">unused</span>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	{#if unused.length > 0}
		<p class="mt-2.5 max-w-[62ch] break-inside-avoid text-[11.5px] leading-relaxed text-dark-500">
			<span class="font-medium text-dark-700">
				{unused.length}
				{unused.length === 1
					? 'keyword is targeted but never appears'
					: 'keywords are targeted but never appear'} in the page text.
			</span>
			Search engines weigh the words actually on the page, so a keyword declared in the tag and absent
			from the copy does no work.
		</p>
	{/if}
{/if}
