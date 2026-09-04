<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import type { Run, RunStatus } from '$lib/shared/types';

	let runs: Run[] = [];
	let error = '';
	let loading = true;

	onMount(async () => {
		try {
			runs = await api().listRuns();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	});

	// Same glyph vocabulary as the run grid and the report, so a status means
	// the same thing everywhere in the app.
	function badge(status: RunStatus): { glyph: string; tone: string } {
		if (status === 'complete') return { glyph: '●', tone: 'text-ok' };
		if (status === 'aborted') return { glyph: '✕', tone: 'text-fail' };
		return { glyph: '◍', tone: 'text-accent' };
	}

	function host(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}
</script>

<div class="max-w-3xl">
	<h1 class="text-[20px] font-semibold text-white">Runs</h1>
	<p class="mt-1 text-[13px] text-[#8B949E]">Every run is kept, newest first.</p>

	{#if error}
		<p
			role="alert"
			class="mt-6 border-l-2 border-fail bg-fail/10 px-3 py-2 font-mono text-[12px] text-[#F0B4A0]"
		>
			{error}
		</p>
	{:else if loading}
		<p class="mt-6 font-mono text-[12px] text-[#6E7681]">Loading…</p>
	{:else if runs.length === 0}
		<div class="mt-6 rounded-sm border border-dashed border-steel px-5 py-8 text-center">
			<p class="text-[13px] text-[#8B949E]">No runs yet.</p>
			<a href="/" class="mt-3 inline-block text-[13px] text-accent hover:underline">
				Start your first report
			</a>
		</div>
	{:else}
		<ul class="mt-6 divide-y divide-steel overflow-hidden rounded-sm border border-steel">
			{#each runs as run}
				{@const b = badge(run.status)}
				<li>
					<a
						href={`/run/${run.id}`}
						class="flex items-baseline gap-4 bg-slate px-4 py-3 transition-colors hover:bg-steel/40"
					>
						<span class="chip {b.tone}" data-glyph={b.glyph}>{run.status}</span>

						<span class="min-w-0 flex-1">
							<span class="block truncate font-mono text-[13px] text-[#E6EDF3]">
								{host(run.client)}
							</span>
							{#if run.competitors.length > 0}
								<span class="block text-[12px] text-[#6E7681]">
									vs {run.competitors.length}
									{run.competitors.length === 1 ? 'competitor' : 'competitors'}
								</span>
							{/if}
						</span>

						<span class="shrink-0 font-mono text-[12px] text-[#6E7681]">
							{new Date(run.createdAt).toLocaleString()}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
