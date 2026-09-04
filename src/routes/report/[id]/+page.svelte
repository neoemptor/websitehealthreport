<script lang="ts">
	import { onMount, type ComponentType } from 'svelte';
	import { page } from '$app/stores';
	import { api } from '$lib/api';
	import type { Run, AnalyzerResult, AnalyzerId } from '$lib/shared/types';
	import Lighthouse from '$lib/report/Lighthouse.svelte';
	import Keywords from '$lib/report/Keywords.svelte';
	import Unknown from '$lib/report/Unknown.svelte';
	import Letterhead from '$lib/report/Letterhead.svelte';

	// Analyzers without a component fall back to their raw values, so adding one
	// can never break the report. The remaining seven arrive with their plans.
	//
	// ComponentType, not `typeof Unknown`: each component declares the shape it
	// needs, and a component requiring a narrow shape is not assignable where one
	// accepting `unknown` is expected. Analyzer data genuinely crosses IPC as
	// `unknown`, so this map is the point where that is accepted — a malformed
	// result renders empty rather than throwing.
	const components: Partial<Record<AnalyzerId, ComponentType>> = {
		lighthouse: Lighthouse,
		keywords: Keywords
	};

	let run: Run | null = null;
	let exporting = false;
	let exportError = '';
	let saved = '';
	let error = '';

	// Read by the PDF export to know the page has actually rendered its run.
	$: state = error ? 'error' : run ? 'ready' : 'loading';

	onMount(async () => {
		try {
			run = await api().loadRun($page.params.id);
		} catch (e) {
			error = (e as Error).message;
		}
	});

	async function exportPdf() {
		if (!run) return;
		exporting = true;
		exportError = '';
		saved = '';
		try {
			saved = await api().exportPdf(run.id);
		} catch (e) {
			exportError = (e as Error).message;
		} finally {
			exporting = false;
		}
	}

	function host(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	// Analyzer ids are lowercase machine names. A client reads this document, so
	// they are titled here. The main process owns the authoritative labels, but
	// they do not cross IPC with a result — this covers all nine ids by shape.
	const NAMED: Partial<Record<string, string>> = {
		seoquake: 'SEO Quake',
		aeo: 'AI Agent Optimisation',
		content: 'Spelling and grammar',
		'traffic-owned': 'Traffic (measured)',
		'traffic-estimated': 'Traffic (estimated)'
	};

	function analyzerName(id: string): string {
		return NAMED[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
	}

	// The same glyph vocabulary as the live grid, so a status reads identically
	// on screen and on paper. Never colour alone — these get printed in mono.
	function mark(result: AnalyzerResult | undefined): { glyph: string; word: string; tone: string } {
		if (!result) return { glyph: '·', word: 'not run', tone: 'text-na' };
		if (result.status === 'ok') return { glyph: '●', word: 'ok', tone: 'text-ok' };
		if (result.status === 'unavailable') return { glyph: '○', word: 'n/a', tone: 'text-na' };
		return { glyph: '✕', word: 'failed', tone: 'text-fail' };
	}
</script>

<!-- data-report-state is the PDF export's readiness signal: printToPDF used to
     fire after a fixed sleep, which on a large run or a cold start printed the
     "Loading…" placeholder and reported success. See electron/pdf.ts. -->
<div data-report-state={state} data-report-error={error || null}>
	{#if error}
		<p
			role="alert"
			class="max-w-3xl border-l-2 border-fail bg-fail/10 px-3 py-2 font-mono text-[12px] text-[#F0B4A0]"
		>
			{error}
		</p>
	{:else if run}
		<div class="screen-only mb-5 flex max-w-[820px] items-center gap-3">
			<button on:click={exportPdf} disabled={exporting} class="btn btn-primary">
				{exporting ? 'Exporting…' : 'Export PDF'}
			</button>
			<a href={`/run/${run.id}`} class="btn btn-quiet">Back to run</a>

			{#if saved}
				<span class="font-mono text-[12px] text-ok">Saved to {saved}</span>
			{/if}
			{#if exportError}
				<!-- Export failure has to be visible here. The PDF is the deliverable,
				     and a silent failure is indistinguishable from a slow one. -->
				<span role="alert" class="font-mono text-[12px] text-fail"
					>Export failed — {exportError}</span
				>
			{/if}
		</div>

		<!-- The document itself. Light on screen as well as in print, because this
		     is a preview of a printed artifact, not another tool screen. -->
		<article
			class="max-w-[820px] bg-paper px-12 py-11 text-ink shadow-[0_1px_0_rgba(0,0,0,0.4)] print:max-w-none print:px-0 print:py-0 print:shadow-none"
		>
			<!-- Masthead: the subject on the left, the letterhead on the right. The
			     document type sits in the line beneath the heading rather than as a
			     label above it — the client's own domain is the heading, because it
			     is the thing they recognise first. -->
			<header class="flex items-start justify-between gap-8 border-b-2 border-ink pb-5">
				<div class="min-w-0">
					<h1 class="font-serif text-[30px] leading-tight">{host(run.client)}</h1>
					<!-- text-pretty stops the competitor count orphaning its last word
					     onto a line of its own beside the letterhead. -->
					<p class="mt-1.5 text-pretty text-[11.5px] text-[#6B6659]">
						Website health report ·
						{new Date(run.createdAt).toLocaleDateString('en-AU', {
							day: 'numeric',
							month: 'long',
							year: 'numeric'
						})}
						{#if run.competitors.length > 0}
							· compared against {run.competitors.length}
							{run.competitors.length === 1 ? 'competitor' : 'competitors'}
						{/if}
					</p>
				</div>

				<Letterhead />
			</header>

			<!-- A prospect may read this with nobody there to explain it, so the
			     document says up front how to read a check that produced no number.
			     Measure is held near 62ch; the article is wider than comfortable
			     for running prose. -->
			<p class="mt-6 max-w-[62ch] text-[13px] leading-relaxed text-[#3A3730]">
				{#if run.competitors.length > 0}
					Every site below was measured with the same checks, so the results can be read side by
					side.
				{:else}
					The checks below were run against this site.
				{/if}
				Where a check could not run, it says why instead of leaving a gap.
			</p>

			<!-- Domains flow continuously rather than one per page. A section is
			     therefore free to split across a page boundary — deliberately: the
			     alternative, break-inside-avoid on a section taller than a page,
			     pushes the whole thing to the next page and leaves the gap this was
			     meant to remove. What must not split is kept whole below. -->
			{#each run.domains as domain}
				<section class="pt-8">
					<!-- break-after-avoid keeps a domain heading with at least the start
					     of its content, so a name never strands at the foot of a page. -->
					<div
						class="flex items-baseline justify-between gap-6 break-inside-avoid break-after-avoid border-b border-rule pb-2"
					>
						<h2 class="font-serif text-[21px]">{host(domain.domain)}</h2>
						<span class="font-mono text-[10px] uppercase tracking-[0.12em] text-[#6B6659]">
							{domain.role}
						</span>
					</div>

					<!-- Status rail: the shape of the result before any numbers. A reader
					     flipping the PDF sees at a glance what was measured and what
					     could not be. -->
					<div class="mt-3 flex break-inside-avoid flex-wrap gap-x-6 gap-y-1.5">
						{#each run.enabledAnalyzers as id}
							{@const m = mark(domain.analyzers[id])}
							<span class="chip {m.tone}" data-glyph={m.glyph}>
								<span class="text-ink">{analyzerName(id)}</span>
								<span class="text-[#6B6659]">{m.word}</span>
							</span>
						{/each}
					</div>

					{#each run.enabledAnalyzers as id}
						{@const result = domain.analyzers[id]}
						<div class="mt-6">
							<h3 class="break-after-avoid font-serif text-[15px] font-semibold">
								{analyzerName(id)}
							</h3>

							{#if !result}
								<p class="mt-1 text-[12px] text-[#6B6659]">Not run.</p>
							{:else if result.status === 'unavailable'}
								<p class="mt-1 text-[12px] text-[#6B6659]">
									<span class="font-medium text-ink">Not measured.</span>
									{result.reason}
								</p>
							{:else if result.status === 'failed'}
								<p class="mt-1 text-[12px] text-[#6B6659]">
									<span class="font-medium text-fail">Check failed.</span>
									{result.error}
								</p>
							{:else}
								<svelte:component this={components[id] ?? Unknown} data={result.data} />
							{/if}
						</div>
					{/each}
				</section>
			{/each}
		</article>
	{:else}
		<p class="font-mono text-[12px] text-[#6E7681]">Loading…</p>
	{/if}
</div>
