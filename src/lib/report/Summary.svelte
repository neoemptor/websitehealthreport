<script lang="ts">
	import type { Run, AnalyzerId } from '$lib/shared/types';
	import { severityOf } from './severity';
	import { gradeOf, GRADE_LEGEND, type Grade } from './grade';

	export let run: Run;
	export let analyzerName: (id: string) => string;

	// The same tones the check sections use, so a word means the same thing
	// in the summary as it does beneath.
	const tone: Record<string, string> = {
		ok: 'text-ok',
		warn: 'text-dark-700',
		fail: 'text-fail',
		na: 'text-dark-400'
	};

	function host(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	type Row = {
		domain: string;
		role: string;
		cells: Array<{ id: AnalyzerId; word: string; tone: string }>;
		grade: Grade;
	};

	$: rows = run.domains.map<Row>((d) => ({
		domain: host(d.domain),
		role: d.role,
		cells: run.enabledAnalyzers.map((id) => {
			const result = d.analyzers[id];
			if (!result || result.status !== 'ok') return { id, word: 'n/a', tone: 'na' };
			const s = severityOf(id, result);
			return { id, word: s.word, tone: s.tone };
		}),
		grade: gradeOf(d, run.enabledAnalyzers)
	}));

	// Client first, then competitors by grade, best first; a dash sorts last.
	$: client = rows.find((r) => r.role === 'client');
	$: competitors = rows
		.filter((r) => r.role !== 'client')
		.sort((a, b) => b.grade.ratio - a.grade.ratio || a.domain.localeCompare(b.domain));
	$: ordered = client ? [client, ...competitors] : competitors;

	// One plain sentence: where the client sits among the competitors.
	function sentence(): string {
		if (!client) return '';
		const g = client.grade.letter;
		if (competitors.length === 0)
			return g === '—'
				? `${client.domain} could not be graded: no check measured it.`
				: `${client.domain} grades ${g}.`;
		const ahead = competitors.filter(
			(c) => c.grade.ratio < client!.grade.ratio || c.grade.letter === '—'
		);
		const behind = competitors.filter(
			(c) => c.grade.ratio > client!.grade.ratio && c.grade.letter !== '—'
		);
		const list = (xs: Row[]) => xs.map((x) => `${x.domain} (${x.grade.letter})`).join(', ');
		const parts: string[] = [];
		if (behind.length) parts.push(`behind ${list(behind)}`);
		if (ahead.length) parts.push(`ahead of ${list(ahead)}`);
		const level = competitors.filter((c) => !ahead.includes(c) && !behind.includes(c));
		if (level.length) parts.push(`level with ${list(level)}`);
		return `${client.domain} grades ${g}, ${parts.join(' and ')}.`;
	}
</script>

<!-- The summary: the verdict before the evidence. A reader who stops here
     knows where the client stands; everything beneath is the working. -->
<section class="mt-8 break-inside-avoid">
	<h2 class="font-heading text-[19px] font-bold text-primary-800">Summary</h2>
	{#if client}
		<p class="mt-1.5 text-[13px] leading-relaxed text-dark-700">{sentence()}</p>
	{/if}

	<div class="mt-3 overflow-x-auto print:overflow-visible">
		<table class="w-full table-fixed border-collapse text-left">
			<thead>
				<tr class="border-b border-dark-200">
					<th
						class="w-[26%] py-1.5 pr-3 text-[9px] font-semibold uppercase leading-tight tracking-[0.1em] text-dark-500"
						>Site</th
					>
					{#each run.enabledAnalyzers as id}
						<th
							class="whitespace-normal py-1.5 pr-3 text-[9px] font-semibold uppercase leading-tight tracking-[0.1em] text-dark-500"
						>
							{analyzerName(id)}
						</th>
					{/each}
					<th
						class="w-12 py-1.5 text-right text-[9px] font-semibold uppercase leading-tight tracking-[0.1em] text-dark-500"
					>
						Grade
					</th>
				</tr>
			</thead>
			<tbody>
				{#each ordered as row (row.domain)}
					<tr class="break-inside-avoid border-b border-dark-200/70 last:border-0">
						<td class="py-2 pr-3 align-top">
							<span class="block font-mono text-[12px] text-dark-700">{row.domain}</span>
							<span class="block text-[10px] uppercase tracking-[0.12em] text-dark-500"
								>{row.role}</span
							>
						</td>
						{#each row.cells as cell}
							<td
								class="whitespace-nowrap py-2 pr-3 align-top text-[10px] font-semibold uppercase tracking-wide {tone[
									cell.tone
								]}"
							>
								{cell.word}
							</td>
						{/each}
						<td
							class="py-2 text-right align-top font-heading text-[20px] font-bold leading-none {row
								.grade.letter === '—'
								? 'text-dark-400'
								: 'text-dark-700'}"
						>
							{row.grade.letter}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<p class="mt-2 text-[10.5px] text-dark-500">
		{#each GRADE_LEGEND as l, i}{i > 0 ? ' · ' : ''}<span class="font-semibold text-dark-700"
				>{l.letter}</span
			>
			{l.meaning}{/each}. A check that could not run is left out of the grade.
	</p>
</section>
