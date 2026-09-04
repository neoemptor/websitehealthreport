<script lang="ts">
	export let data: { keywords: Array<{ keyword: string; count: number }> };

	// A keyword the site declares but never uses is the finding worth acting on,
	// so those are surfaced rather than left for the reader to spot in a table.
	$: unused = data.keywords.filter((k) => k.count === 0);
	$: ranked = [...data.keywords].sort((a, b) => b.count - a.count);
</script>

{#if data.keywords.length === 0}
	<p class="mt-1 text-[12px] text-[#6B6659]">
		<span class="font-medium text-ink">No keywords declared.</span>
		The page has no meta keywords tag, so there is nothing to compare against its text.
	</p>
{:else}
	<table class="mt-3 w-full border-collapse text-left">
		<thead>
			<tr class="border-b border-rule">
				<th class="py-1.5 pr-4 text-[10px] font-medium uppercase tracking-[0.1em] text-[#6B6659]">
					Keyword
				</th>
				<th
					class="w-32 py-1.5 text-right text-[10px] font-medium uppercase tracking-[0.1em] text-[#6B6659]"
				>
					Times on page
				</th>
			</tr>
		</thead>
		<tbody>
			{#each ranked as row}
				<tr class="break-inside-avoid border-b border-rule/70 last:border-0">
					<td class="py-1.5 pr-4 font-mono text-[12px] text-ink">{row.keyword}</td>
					<td
						class="py-1.5 text-right font-mono text-[12px] {row.count === 0
							? 'text-fail'
							: 'text-ink'}"
					>
						{row.count}
						{#if row.count === 0}
							<span class="ml-1 text-[10px] uppercase tracking-wide">unused</span>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	{#if unused.length > 0}
		<p class="mt-2.5 break-inside-avoid text-[11.5px] leading-relaxed text-[#6B6659]">
			<span class="font-medium text-ink">
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
