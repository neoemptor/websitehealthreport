<script lang="ts">
	import type { OldSeoData, OldSeoCheck } from '$lib/shared/oldseo';

	export let data: OldSeoData;

	const NAMES: Record<OldSeoCheck, string> = {
		'hidden-text': 'Hidden text',
		'hidden-link': 'Hidden links',
		stuffing: 'Keyword stuffing',
		cloaking: 'Cloaking',
		duplicate: 'Duplicate pages',
		stale: 'Old habits'
	};
	const WORD = { high: 'Poor', medium: 'Needs work', low: 'Note' } as const;
	const TONE = { high: 'text-fail', medium: 'text-dark-700', low: 'text-dark-500' } as const;
	const ORDER: OldSeoCheck[] = [
		'hidden-text',
		'hidden-link',
		'cloaking',
		'stuffing',
		'duplicate',
		'stale'
	];

	// Grouped by check, in a fixed order that puts concealment first; the
	// analyzer already sorted findings by severity within the list.
	$: groups = ORDER.map((check) => ({
		check,
		rows: data.findings.filter((f) => f.check === check)
	})).filter((g) => g.rows.length > 0);
</script>

{#if data.findings.length === 0}
	<p class="mt-2 text-[12px] text-dark-500">
		{data.pagesRead} page{data.pagesRead === 1 ? '' : 's'} read, nothing found.
	</p>
{:else}
	<table class="mt-3 w-full border-collapse text-left">
		<tbody>
			{#each groups as group}
				<tr class="break-inside-avoid break-after-avoid border-b border-dark-200">
					<th
						colspan="3"
						class="pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-dark-500"
					>
						{NAMES[group.check]}
					</th>
				</tr>
				{#each group.rows as row}
					<tr class="break-inside-avoid border-b border-dark-200/70">
						<td
							class="w-24 py-1.5 pr-3 align-top text-[10px] font-semibold uppercase tracking-wide {TONE[
								row.severity
							]}"
						>
							{WORD[row.severity]}
						</td>
						<td class="w-44 py-1.5 pr-3 align-top font-mono text-[11px] text-dark-700"
							>{row.page}</td
						>
						<td
							class="py-1.5 align-top font-mono text-[11px] leading-snug text-dark-600 [overflow-wrap:anywhere]"
						>
							{row.evidence}
						</td>
					</tr>
				{/each}
			{/each}
		</tbody>
	</table>
{/if}
{#if data.pagesSkipped > 0}
	<p class="mt-2 text-[11px] text-dark-500">
		{data.pagesSkipped} page{data.pagesSkipped === 1 ? '' : 's'} could not be read.
	</p>
{/if}
