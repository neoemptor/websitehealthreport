<script lang="ts">
	export let data: {
		scores: { performance: number; accessibility: number; bestPractices: number; seo: number };
		metrics: { lcpMs: number; cls: number; tbtMs: number };
	};

	// Google's own banding. Stated as words as well as numbers, because a client
	// reading "62" has no idea whether that is good, and because the report is
	// printed in black and white where a colour band alone would vanish.
	function band(score: number): { word: string; tone: string } {
		if (score >= 90) return { word: 'Good', tone: 'text-ok' };
		if (score >= 50) return { word: 'Needs work', tone: 'text-[#8A5A00]' };
		return { word: 'Poor', tone: 'text-fail' };
	}

	$: scores = [
		{ label: 'Performance', value: data.scores.performance },
		{ label: 'Accessibility', value: data.scores.accessibility },
		{ label: 'Best practices', value: data.scores.bestPractices },
		{ label: 'SEO', value: data.scores.seo }
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

<div class="mt-3 grid grid-cols-4 gap-px border border-rule bg-rule">
	{#each scores as score}
		{@const b = band(score.value)}
		<div class="bg-paper px-3 py-3 text-center">
			<p class="font-mono text-[26px] leading-none {b.tone}">{score.value}</p>
			<p class="mt-1.5 text-[11px] leading-tight text-ink">{score.label}</p>
			<p class="text-[10px] uppercase tracking-wide {b.tone}">{b.word}</p>
		</div>
	{/each}
</div>

<table class="mt-4 w-full border-collapse text-left">
	<tbody>
		{#each vitals as vital}
			<tr class="border-b border-rule/70 last:border-0">
				<td class="py-1.5 pr-4">
					<span class="block text-[12px] text-ink">{vital.label}</span>
					<span class="block text-[10.5px] text-[#6B6659]">{vital.note}</span>
				</td>
				<td class="py-1.5 pr-4 text-right font-mono text-[12px] text-ink">{vital.value}</td>
				<td class="w-28 py-1.5 text-right">
					<!-- Word, not just a colour: this table is read on paper. -->
					<span
						class="font-mono text-[10px] uppercase tracking-wide {vital.good
							? 'text-ok'
							: 'text-fail'}"
					>
						{vital.good ? 'Pass' : 'Over'}
					</span>
					<span class="block text-[10px] text-[#6B6659]">target {vital.target}</span>
				</td>
			</tr>
		{/each}
	</tbody>
</table>
