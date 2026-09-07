<script lang="ts">
	type Rating = 'good' | 'needs-work' | 'poor';
	export let data: {
		pages: string[];
		factors: Array<{ id: string; rating: Rating; evidence: string }>;
		fixes: string[];
	};

	// Same questions as electron/analyzers/geo/prompt.ts; the renderer cannot
	// import from electron. Unknown ids fall back to the id itself.
	const QUESTIONS: Record<string, string> = {
		'direct-answers':
			"Does a page answer a customer's likely question outright, early, in plain terms?",
		citations: 'Does the content name and link the sources behind its claims?',
		statistics: 'Are there hard figures — prices, timings, measurements, counts, dates?',
		quotations: 'Are there attributed quotes from named people (owner, customers, experts)?',
		clarity: 'Is the writing plain, specific and free of filler and jargon?',
		entity: 'Is it unambiguous who the business is, where it operates and what it does?',
		structure: 'Are headings question-shaped and sections short enough to lift out whole?'
	};

	// Words, not colours: this is read on paper. The band word carries the
	// state; the class only reinforces it on screen.
	function band(rating: Rating): { word: string; label: string } {
		if (rating === 'good') return { word: 'Good', label: 'text-ok' };
		if (rating === 'needs-work') return { word: 'Needs work', label: 'text-dark-700' };
		return { word: 'Poor', label: 'text-fail' };
	}

	// data may be malformed (an unexpected shape reaching the report); render
	// the rows that can be rendered and skip the rest, never throw.
	$: factors = Array.isArray(data?.factors)
		? data.factors.filter(
				(f) =>
					f &&
					typeof f.id === 'string' &&
					(f.rating === 'good' || f.rating === 'needs-work' || f.rating === 'poor')
		  )
		: [];
	$: pages = Array.isArray(data?.pages) ? data.pages.filter((p) => typeof p === 'string') : [];
	$: fixes = Array.isArray(data?.fixes) ? data.fixes.filter((f) => typeof f === 'string') : [];

	function shortUrl(url: string): string {
		try {
			const u = new URL(url);
			return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
		} catch {
			return url;
		}
	}
</script>

<table class="mt-3 w-full border-collapse text-left">
	<tbody>
		{#each factors as factor}
			{@const b = band(factor.rating)}
			<tr class="break-inside-avoid border-b border-dark-200 last:border-0">
				<td class="py-2 pr-4">
					<span class="block text-[12px] text-dark-700">{QUESTIONS[factor.id] ?? factor.id}</span>
					{#if factor.evidence}
						<span class="block text-[10.5px] text-dark-500">{factor.evidence}</span>
					{/if}
				</td>
				<td class="w-28 py-2 text-right align-top">
					<span class="text-[10px] font-semibold uppercase tracking-wide {b.label}">{b.word}</span>
				</td>
			</tr>
		{/each}
	</tbody>
</table>

{#if pages.length > 0}
	<p class="mt-2.5 break-inside-avoid text-[10.5px] leading-relaxed text-dark-500">
		<span class="font-medium text-dark-700">Pages read:</span>
		{pages.map(shortUrl).join(' · ')}
	</p>
{/if}

{#if fixes.length > 0}
	<div class="mt-3 break-inside-avoid">
		<span class="block text-[10px] font-semibold uppercase tracking-[0.1em] text-dark-500">
			What to fix
		</span>
		<ol class="mt-1 list-decimal pl-5 text-[11.5px] leading-relaxed text-dark-700">
			{#each fixes as fix}
				<li class="pl-1">{fix}</li>
			{/each}
		</ol>
	</div>
{/if}
