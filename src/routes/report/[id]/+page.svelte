<script lang="ts">
	import { onMount, type ComponentType } from 'svelte';
	import { page } from '$app/stores';
	import { api } from '$lib/api';
	import type { Run, AnalyzerResult, AnalyzerId } from '$lib/shared/types';
	import Lighthouse from '$lib/report/Lighthouse.svelte';
	import Keywords from '$lib/report/Keywords.svelte';
	import OldSeo from '$lib/report/OldSeo.svelte';
	import Wayback from '$lib/report/Wayback.svelte';
	import Security from '$lib/report/Security.svelte';
	import Aeo from '$lib/report/Aeo.svelte';
	import SeoQuake from '$lib/report/SeoQuake.svelte';
	import Content from '$lib/report/Content.svelte';
	import Unknown from '$lib/report/Unknown.svelte';
	import Letterhead from '$lib/report/Letterhead.svelte';
	import Summary from '$lib/report/Summary.svelte';
	import { severityOf } from '$lib/report/severity';

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
		keywords: Keywords,
		oldseo: OldSeo,
		wayback: Wayback,
		security: Security,
		aeo: Aeo,
		seoquake: SeoQuake,
		content: Content
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
		'traffic-estimated': 'Traffic (estimated)',
		oldseo: 'Old SEO practices',
		wayback: 'Wayback history',
		security: 'Security'
	};

	function analyzerName(id: string): string {
		return NAMED[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
	}

	// The same mark vocabulary as the live grid, so a status reads identically
	// on screen and on paper. Never colour alone — these get printed in mono.
	function mark(result: AnalyzerResult | undefined): { mark: string; word: string; tone: string } {
		if (!result) return { mark: 'pending', word: 'not run', tone: 'text-dark-500' };
		if (result.status === 'ok') return { mark: 'ok', word: 'ok', tone: 'text-ok' };
		if (result.status === 'unavailable') return { mark: 'na', word: 'n/a', tone: 'text-dark-500' };
		return { mark: 'fail', word: 'failed', tone: 'text-fail' };
	}

	// Severity words on paper. Warn is plain dark-700: the guide keeps orange
	// off any type under 14pt on white, and the word itself carries the state.
	const severityTone: Record<string, string> = {
		ok: 'text-ok',
		warn: 'text-dark-700',
		fail: 'text-fail',
		na: 'text-dark-500'
	};
</script>

<!-- data-report-state is the PDF export's readiness signal: printToPDF used to
     fire after a fixed sleep, which on a large run or a cold start printed the
     "Loading…" placeholder and reported success. See electron/pdf.ts. -->
<div data-report-state={state} data-report-error={error || null}>
	{#if error}
		<p role="alert" class="alert max-w-3xl">{error}</p>
	{:else if run}
		<div class="screen-only mb-6 flex max-w-[820px] items-center gap-4">
			<button on:click={exportPdf} disabled={exporting} class="btn btn-primary">
				{exporting ? 'Exporting…' : 'Export PDF'}
			</button>
			<a href={`/run/${run.id}`} class="btn btn-quiet">Back to run</a>

			{#if saved}
				<span class="font-mono text-[12px] text-ok-bright">Saved to {saved}</span>
			{/if}
			{#if exportError}
				<!-- Export failure has to be visible here. The PDF is the deliverable,
				     and a silent failure is indistinguishable from a slow one. -->
				<span role="alert" class="font-mono text-[12px] text-fail-bright">
					Export failed — {exportError}
				</span>
			{/if}
		</div>

		<!-- The document itself: the guide's light print variant, on screen as
		     well as in print, because this is a preview of a printed artifact and
		     not another tool screen. White stock, dark-700 text, orange reserved
		     for headings, rules and the mark. -->
		<article
			class="max-w-[820px] bg-white px-12 py-11 text-dark-700 shadow-[0_2px_24px_rgba(0,0,0,0.5)] print:max-w-none print:px-0 print:py-0 print:shadow-none"
		>
			<!-- Letterhead first, full width, as stationery is: the guide's 25mm mark
			     with clear space equal to its own height beneath it, before the
			     subject. A two-column masthead cannot honour that clear space and
			     keep a domain whole on A4, so the row is not attempted. The 9mm on
			     paper adds to the 16mm page margin to make the clear space above. -->
			<div class="pb-[25mm] print:pt-[9mm]">
				<Letterhead />
			</div>

			<!-- The subject: the client's own domain is the heading, because it is
			     the thing they recognise first; the document type sits beneath it.
			     break-words only for a domain longer than a full line, where
			     breaking beats overflowing the page. -->
			<header class="border-b-2 border-primary-500 pb-5">
				<div>
					<h1 class="break-words font-heading text-[30px] font-bold leading-tight text-dark-700">
						{host(run.client)}
					</h1>
					<p class="mt-1.5 text-pretty text-[11.5px] text-dark-500">
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
			</header>

			<!-- One line on how to read it; the legend beneath explains the rest. -->
			<p class="mt-5 text-[13px] leading-relaxed text-dark-600">
				{#if run.competitors.length > 0}
					Every site below was measured with the same checks; each opens with a verdict, then the
					readings.
				{:else}
					Each check below opens with a verdict, then the readings.
				{/if}
			</p>

			<!-- The status legend, once: the three states explained in a symbol
			     table at the head of the register. -->
			<dl class="mt-4 flex flex-wrap gap-x-7 gap-y-1.5 border-y border-dark-200 py-2.5">
				<div class="flex items-baseline gap-2">
					<dt class="chip text-ok" data-mark="ok">ok</dt>
					<dd class="text-[11px] text-dark-500">measured</dd>
				</div>
				<div class="flex items-baseline gap-2">
					<dt class="chip text-dark-500" data-mark="na">n/a</dt>
					<dd class="text-[11px] text-dark-500">not available on the machine that ran this</dd>
				</div>
				<div class="flex items-baseline gap-2">
					<dt class="chip text-fail" data-mark="fail">failed</dt>
					<dd class="text-[11px] text-dark-500">the check ran and could not complete</dd>
				</div>
			</dl>

			{#if run.domains.length > 0}
				<Summary {run} {analyzerName} />
			{/if}

			<!-- Domains flow continuously rather than one per page. A section is
			     therefore free to split across a page boundary — deliberately: the
			     alternative, break-inside-avoid on a section taller than a page,
			     pushes the whole thing to the next page and leaves the gap this was
			     meant to remove. What must not split is kept whole below. -->
			{#each run.domains as domain}
				<section class="pt-9">
					<!-- break-after-avoid keeps a domain heading with at least the start
					     of its content, so a name never strands at the foot of a page. -->
					<div
						class="flex items-baseline justify-between gap-6 break-inside-avoid break-after-avoid border-b border-dark-200 pb-2"
					>
						<h2 class="font-heading text-[21px] font-bold text-dark-700">{host(domain.domain)}</h2>
						<span class="text-[10px] font-semibold uppercase tracking-[0.12em] text-dark-500">
							{domain.role}
						</span>
					</div>

					<!-- Status rail: the shape of the result before any numbers. It refuses
					     a break after it as well as inside, so a domain heading and its
					     rail are never left at the foot of a page with the first check
					     overleaf — the chain of avoid-after runs from the heading through
					     the first check's finding. -->
					<div class="mt-3 flex break-inside-avoid break-after-avoid flex-wrap gap-x-6 gap-y-1.5">
						{#each run.enabledAnalyzers as id}
							{@const m = mark(domain.analyzers[id])}
							<span class="chip {m.tone}" data-mark={m.mark}>
								<span class="text-dark-700">{analyzerName(id)}</span>
								<span class="text-dark-500">{m.word}</span>
							</span>
						{/each}
					</div>

					{#each run.enabledAnalyzers as id}
						{@const result = domain.analyzers[id]}
						{@const sev = severityOf(id, result)}
						<!-- A check may run over a page: kept whole, a seven-row check
						     lifts off a half-empty page. What must not split is held
						     smaller — heading and finding refuse a break after them, so
						     a verdict is never stranded with its readings overleaf, and
						     each table keeps its rows (and a short table itself) whole. -->
						<div class="mt-7">
							<!-- The inspection's device: an orange check heading, the
							     severity word in the right-hand result column that rules
							     the page, then the finding — before any number. 19px is
							     the guide's floor for orange type on white (14pt). -->
							<div
								class="flex items-baseline justify-between gap-6 break-inside-avoid break-after-avoid"
							>
								<h3 class="font-heading text-[19px] font-semibold text-primary-800">
									{analyzerName(id)}
								</h3>
								<span
									class="font-heading text-[12px] font-bold uppercase tracking-[0.08em] {severityTone[
										sev.tone
									]}"
								>
									{sev.word}
								</span>
							</div>
							<p
								class="mt-1 max-w-[62ch] break-inside-avoid break-after-avoid text-[12.5px] leading-relaxed text-dark-600"
							>
								{sev.finding}
							</p>

							{#if result && result.status === 'ok'}
								<svelte:component this={components[id] ?? Unknown} data={result.data} />
							{/if}
						</div>
					{/each}
				</section>
			{/each}
		</article>
	{:else}
		<p class="font-mono text-[12px] text-white/50">Loading…</p>
	{/if}
</div>
