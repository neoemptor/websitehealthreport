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
	const RANK = { high: 0, medium: 1, low: 2 } as const;

	// data may be malformed (an unexpected shape reaching the report); never throw on it.
	$: findings = Array.isArray(data?.findings) ? data.findings : [];
	$: pagesRead = typeof data?.pagesRead === 'number' ? data.pagesRead : 0;
	$: pagesSkipped = typeof data?.pagesSkipped === 'number' ? data.pagesSkipped : 0;

	// Grouped by check, worst-severity-first: the group whose best (lowest
	// RANK) row is most severe leads, ties broken by the fixed ORDER above.
	// The analyzer already sorted findings by severity within each list.
	$: groups = ORDER.map((check) => ({
		check,
		rows: findings.filter((f) => f.check === check)
	}))
		.filter((g) => g.rows.length > 0)
		.map((g, i) => ({ ...g, orderIndex: i }))
		.sort((a, b) => {
			const bestA = Math.min(...a.rows.map((r) => RANK[r.severity]));
			const bestB = Math.min(...b.rows.map((r) => RANK[r.severity]));
			return bestA - bestB || a.orderIndex - b.orderIndex;
		});
</script>

{#if findings.length === 0}
	<p class="mt-2 text-[12px] text-dark-500">
		{pagesRead} page{pagesRead === 1 ? '' : 's'} read, nothing found.
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
{#if pagesSkipped > 0}
	<p class="mt-2 text-[11px] text-dark-500">
		{pagesSkipped} page{pagesSkipped === 1 ? '' : 's'} could not be read.
	</p>
{/if}
