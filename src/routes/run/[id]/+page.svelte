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
		mark: string;
	} {
		if (!result) return { text: 'waiting', title: 'Waiting', status: 'pending', mark: 'pending' };
		if (result.status === 'ok') return { text: 'ok', title: 'Completed', status: 'ok', mark: 'ok' };
		if (result.status === 'unavailable')
			return { text: 'n/a', title: result.reason, status: 'unavailable', mark: 'na' };
		return { text: 'fail', title: result.error, status: 'failed', mark: 'fail' };
	}

	const tone: Record<string, string> = {
		pending: 'text-white/40',
		ok: 'text-ok-bright',
		unavailable: 'text-dark-400',
		failed: 'text-fail-bright'
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

	// An aborted run flags the last row that got any result, so the operator
	// sees where it stopped rather than inferring it from the blanks.
	$: stoppedAt =
		run && run.status === 'aborted'
			? run.domains.reduce((last, d, i) => (Object.keys(d.analyzers).length > 0 ? i : last), -1)
			: -1;

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
	<p role="alert" class="alert max-w-3xl">{error}</p>
{/if}

{#if run}
	<div class="max-w-4xl">
		<div class="flex items-start justify-between gap-6">
			<div class="min-w-0">
				<h1 class="truncate text-[28px] font-bold leading-tight">{host(run.client)}</h1>
				<p class="mt-1.5 text-[14px] text-white/60">
					{new Date(run.createdAt).toLocaleString('en-AU')}
				</p>
			</div>

			<div class="shrink-0 text-right">
				<!-- Stat figure, the guide's way: Poppins bold, orange. -->
				<p class="font-heading text-[26px] font-bold leading-none text-primary-500">
					{settled}<span class="text-white/40">/{total}</span>
				</p>
				<p class="mt-1 text-[11px] uppercase tracking-wide text-white/50">{run.status}</p>
			</div>
		</div>

		<!-- The one authored motion on screen: the register filling in. -->
		<div class="mt-5 h-1 w-full overflow-hidden rounded-full bg-white/10">
			<div
				class="h-full rounded-full bg-primary-500 transition-[width] duration-500 ease-out"
				style={`width: ${total === 0 ? 0 : Math.round((settled / total) * 100)}%`}
			/>
		</div>

		<div class="mt-7 overflow-x-auto rounded-2xl border border-white/5 bg-dark-700">
			<table class="w-full border-collapse text-left">
				<thead>
					<tr class="border-b border-white/10">
						<th
							class="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-dark-400"
						>
							Domain
						</th>
						{#each run.enabledAnalyzers as id}
							<th
								class="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-dark-400"
							>
								{id}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each run.domains as domain, i}
						<tr class="border-b border-white/5 last:border-0">
							<td class="px-5 py-3">
								<span class="block font-mono text-[14px] text-white">
									{host(domain.domain)}
								</span>
								<span class="block text-[11px] uppercase tracking-wide text-white/50">
									{domain.role}
									{#if i === stoppedAt}
										<span class="ml-2 font-semibold normal-case tracking-normal text-primary-500">
											· stopped here
										</span>
									{/if}
								</span>
							</td>
							{#each run.enabledAnalyzers as id}
								{@const c = cell(domain.analyzers[id])}
								<td class="px-5 py-3">
									<!-- title carries the reason or error: with fragile analyzers,
									     "why is this cell not ok" is the question asked most. -->
									<span class="chip {tone[c.status]}" data-mark={c.mark} title={c.title}>
										{c.text}
									</span>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="mt-8 flex items-center gap-4">
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
	<p class="font-mono text-[12px] text-white/50">Loading…</p>
{/if}
