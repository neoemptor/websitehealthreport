<script lang="ts">
	export let data: {
		scores: { performance: number; accessibility: number; bestPractices: number; seo: number };
		metrics: { lcpMs: number; cls: number; tbtMs: number };
	};

	// Google's own banding. Stated as words as well as numbers, because a client
	// reading "62" has no idea whether that is good, and because the report is
	// printed in black and white where a colour band alone would vanish. The
	// figure may take primary-800 — at 20px it clears the guide's 14pt floor for
	// orange type on white — but the 10px band word stays dark: the word is the
	// state, not the colour.
	function band(score: number): { word: string; figure: string; label: string } {
		if (score >= 90) return { word: 'Good', figure: 'text-ok', label: 'text-ok' };
		if (score >= 50)
			return { word: 'Needs work', figure: 'text-primary-800', label: 'text-dark-700' };
		return { word: 'Poor', figure: 'text-fail', label: 'text-fail' };
	}

	$: scores = [
		{
			label: 'Performance',
			note: 'How quickly the page loads and responds',
			value: data.scores.performance
		},
		{
			label: 'Accessibility',
			note: 'Whether people using assistive technology can use it',
			value: data.scores.accessibility
		},
		{
			label: 'Best practices',
			note: 'Whether the page follows current, safe web practice',
			value: data.scores.bestPractices
		},
		{ label: 'SEO', note: 'How well search engines can read the page', value: data.scores.seo }
	];

	// Core Web Vitals thresholds, as published by Google.
	$: vitals = [
		{
			label: 'Largest Contentful Paint',
			note: 'Time until the main content appears',
			value: `${(data.metrics.lcpMs / 1000).toFixed(1)}s`,
			good: data.metrics.lcpMs <= 2500,
			target: 'under 2.5s'
		},
		{
			label: 'Cumulative Layout Shift',
			note: 'How much the page moves while loading',
			value: data.metrics.cls.toFixed(3),
			good: data.metrics.cls <= 0.1,
			target: 'under 0.1'
		},
		{
			label: 'Total Blocking Time',
			note: 'How long the page ignores taps and clicks',
			value: `${Math.round(data.metrics.tbtMs)}ms`,
			good: data.metrics.tbtMs <= 200,
			target: 'under 200ms'
		}
	];
</script>

<!-- Scores are rows in the same result column as the vitals, not a tile grid:
     one register, read down the right-hand edge. The figure is set the guide's
     way — Poppins bold — and kept whole with its band word. -->
<table class="mt-3 w-full break-inside-avoid border-collapse text-left">
	<tbody>
		{#each scores as score}
			{@const b = band(score.value)}
			<tr class="border-b border-dark-200">
				<td class="py-2 pr-4">
					<span class="block text-[12px] text-dark-700">{score.label}</span>
					<span class="block text-[10.5px] text-dark-500">{score.note}</span>
				</td>
				<td
					class="py-2 pr-4 text-right font-heading text-[20px] font-bold leading-none tabular-nums {b.figure}"
				>
					{score.value}
				</td>
				<td class="w-28 py-2 text-right">
					<span class="text-[10px] font-semibold uppercase tracking-wide {b.label}">{b.word}</span>
					<span class="block text-[10px] text-dark-500">out of 100</span>
				</td>
			</tr>
		{/each}
	</tbody>
</table>

<table class="mt-3 w-full border-collapse text-left">
	<tbody>
		{#each vitals as vital}
			<tr class="break-inside-avoid border-b border-dark-200 last:border-0">
				<td class="py-2 pr-4">
					<span class="block text-[12px] text-dark-700">{vital.label}</span>
					<span class="block text-[10.5px] text-dark-500">{vital.note}</span>
				</td>
				<td class="py-2 pr-4 text-right font-mono text-[12px] tabular-nums text-dark-700">
					{vital.value}
				</td>
				<td class="w-28 py-2 text-right">
					<!-- Word, not just a colour: this table is read on paper. -->
					<span
						class="text-[10px] font-semibold uppercase tracking-wide {vital.good
							? 'text-ok'
							: 'text-fail'}"
					>
						{vital.good ? 'Pass' : 'Over'}
					</span>
					<span class="block text-[10px] text-dark-500">target {vital.target}</span>
				</td>
			</tr>
		{/each}
	</tbody>
</table>
