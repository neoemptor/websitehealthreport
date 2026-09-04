<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { api } from '$lib/api';
	import type { Run, AnalyzerResult } from '$lib/shared/types';

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
			<header class="border-b-2 border-ink pb-5">
				<p class="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
					Website Health Report
				</p>
				<h1 class="mt-2 font-serif text-[30px] leading-tight">{host(run.client)}</h1>
				<p class="mt-1.5 font-mono text-[11px] text-[#6B6659]">
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
			</header>

			{#each run.domains as domain, i}
				<section class="break-inside-avoid pt-8 {i > 0 ? 'print:break-before-page' : ''}">
					<div class="flex items-baseline justify-between gap-6 border-b border-rule pb-2">
						<h2 class="font-serif text-[21px]">{host(domain.domain)}</h2>
						<span class="font-mono text-[10px] uppercase tracking-[0.12em] text-[#6B6659]">
							{domain.role}
						</span>
					</div>

					<!-- Status rail: the shape of the result before any numbers. A reader
					     flipping the PDF sees at a glance what was measured and what
					     could not be. -->
					<div class="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
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
						<div class="mt-6 break-inside-avoid">
							<h3 class="font-serif text-[15px] font-semibold">{analyzerName(id)}</h3>

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
								<!-- Readable per-analyzer rendering arrives with the analyzer
								     components in a later plan. Until then the measured values
								     are shown verbatim rather than summarised inaccurately. -->
								<pre
									class="mt-2 overflow-x-auto whitespace-pre-wrap border-l-2 border-rule bg-black/[0.03] px-3 py-2 font-mono text-[10.5px] leading-relaxed text-[#3A3730]">{JSON.stringify(
										result.data,
										null,
										2
									)}</pre>
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
