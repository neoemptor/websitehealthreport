<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { api } from '$lib/api';
	import type { Run, AnalyzerResult } from '$lib/shared/types';

	let run: Run | null = null;
	let error = '';
	let unsubscribe: (() => void) | null = null;
	let cancelling = false;

	onMount(async () => {
		// Subscribe before the first load, not after it: the run is already
		// executing in the main process by the time this page mounts, so an
		// event that lands while loadRun is in flight would otherwise be
		// dropped. Progress events carry the whole run, so the grid is always
		// consistent, and a snapshot that arrived first is never overwritten by
		// the staler copy read from disk.
		unsubscribe = api().onRunProgress((incoming) => {
			if (incoming.id === $page.params.id) run = incoming;
		});

		try {
			const loaded = await api().loadRun($page.params.id);
			run = run ?? loaded;
		} catch (e) {
			if (!run) error = (e as Error).message;
		}
	});

	onDestroy(() => unsubscribe?.());

	function cell(result: AnalyzerResult | undefined): {
		text: string;
		title: string;
		status: string;
		glyph: string;
	} {
		if (!result) return { text: 'waiting', title: 'Waiting', status: 'pending', glyph: '·' };
		if (result.status === 'ok') return { text: 'ok', title: 'Completed', status: 'ok', glyph: '●' };
		if (result.status === 'unavailable')
			return { text: 'n/a', title: result.reason, status: 'unavailable', glyph: '○' };
		return { text: 'fail', title: result.error, status: 'failed', glyph: '✕' };
	}

	const tone: Record<string, string> = {
		pending: 'text-[#6E7681]',
		ok: 'text-ok',
		unavailable: 'text-na',
		failed: 'text-fail'
	};

	// Progress is counted from the cells themselves rather than tracked
	// separately, so what the header claims and what the grid shows cannot drift.
	$: total = run ? run.domains.length * run.enabledAnalyzers.length : 0;
	$: settled = run
		? run.domains.reduce(
				(n, d) => n + run!.enabledAnalyzers.filter((id) => d.analyzers[id]).length,
				0
		  )
		: 0;

	function host(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	async function resume() {
		if (run) run = await api().resumeRun(run.id);
	}

	async function cancel() {
		if (!run) return;
		cancelling = true;
		try {
			await api().cancelRun(run.id);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			cancelling = false;
		}
	}
</script>

{#if error}
	<p
		role="alert"
		class="max-w-3xl border-l-2 border-fail bg-fail/10 px-3 py-2 font-mono text-[12px] text-[#F0B4A0]"
	>
		{error}
	</p>
{/if}

{#if run}
	<div class="max-w-4xl">
		<div class="flex items-start justify-between gap-6">
			<div class="min-w-0">
				<h1 class="truncate font-mono text-[20px] text-white">{host(run.client)}</h1>
				<p class="mt-1 text-[13px] text-[#8B949E]">
					{new Date(run.createdAt).toLocaleString()}
				</p>
			</div>

			<div class="shrink-0 text-right">
				<p class="font-mono text-[13px] text-[#E6EDF3]">{settled}/{total}</p>
				<p class="text-[11px] uppercase tracking-wide text-[#6E7681]">{run.status}</p>
			</div>
		</div>

		<!-- Progress reads as a filling bar because a full run takes minutes and
		     the operator needs to know it is still moving. -->
		<div class="mt-4 h-0.5 w-full bg-steel">
			<div
				class="h-full bg-accent transition-[width] duration-300"
				style={`width: ${total === 0 ? 0 : Math.round((settled / total) * 100)}%`}
			/>
		</div>

		<div class="mt-6 overflow-x-auto">
			<table class="w-full border-collapse text-left">
				<thead>
					<tr class="border-b border-steel">
						<th
							class="py-2 pr-6 text-[11px] font-medium uppercase tracking-[0.08em] text-[#6E7681]"
						>
							Domain
						</th>
						{#each run.enabledAnalyzers as id}
							<th
								class="py-2 pr-6 text-[11px] font-medium uppercase tracking-[0.08em] text-[#6E7681]"
							>
								{id}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each run.domains as domain}
						<tr class="border-b border-steel/60">
							<td class="py-2.5 pr-6">
								<span class="block font-mono text-[13px] text-[#E6EDF3]">
									{host(domain.domain)}
								</span>
								<span class="block text-[11px] uppercase tracking-wide text-[#6E7681]">
									{domain.role}
								</span>
							</td>
							{#each run.enabledAnalyzers as id}
								{@const c = cell(domain.analyzers[id])}
								<td class="py-2.5 pr-6">
									<!-- title carries the reason or error: with fragile analyzers,
									     "why is this cell not ok" is the question asked most. -->
									<span class="chip {tone[c.status]}" data-glyph={c.glyph} title={c.title}>
										{c.text}
									</span>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="mt-7 flex items-center gap-3">
			{#if run.status === 'running'}
				<button on:click={cancel} disabled={cancelling} class="btn btn-quiet">
					{cancelling ? 'Cancelling…' : 'Cancel run'}
				</button>
			{:else}
				<!-- An aborted run reaches here too: it keeps whatever landed before it
				     stopped, so both resuming it and reading its report must stay open. -->
				<button on:click={resume} class="btn btn-quiet">
					{run.status === 'aborted' ? 'Resume run' : 'Re-run failed'}
				</button>
				<a href={`/report/${run.id}`} class="btn btn-primary">View report</a>
			{/if}
		</div>
	</div>
{:else if !error}
	<p class="font-mono text-[12px] text-[#6E7681]">Loading…</p>
{/if}
