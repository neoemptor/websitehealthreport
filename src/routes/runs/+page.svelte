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

	// Same mark vocabulary as the run grid and the report, so a status means
	// the same thing everywhere in the app.
	function badge(status: RunStatus): { mark: string; tone: string } {
		if (status === 'complete') return { mark: 'ok', tone: 'text-ok-bright' };
		if (status === 'aborted') return { mark: 'fail', tone: 'text-fail-bright' };
		return { mark: 'running', tone: 'text-primary-500' };
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
	<h1 class="text-[28px] font-bold leading-tight">Runs</h1>
	<p class="mt-1.5 text-[14px] text-white/60">Every run is kept, newest first.</p>

	{#if error}
		<p role="alert" class="alert mt-7">{error}</p>
	{:else if loading}
		<p class="mt-7 font-mono text-[12px] text-white/50">Loading…</p>
	{:else if runs.length === 0}
		<!-- An empty screen is an invitation to act, not a mood. -->
		<div class="mt-7 rounded-2xl border border-dashed border-white/20 px-6 py-10 text-center">
			<p class="text-[14px] text-white/60">No runs yet.</p>
			<a
				href="/"
				class="mt-4 inline-block text-[14px] font-semibold text-primary-500 hover:underline"
			>
				Start your first report →
			</a>
		</div>
	{:else}
		<ul
			class="mt-7 divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/5 bg-dark-700"
		>
			{#each runs as run}
				{@const b = badge(run.status)}
				<li>
					<a
						href={`/run/${run.id}`}
						class="flex items-baseline gap-5 px-5 py-4 transition-colors duration-300 hover:bg-white/5"
					>
						<span class="chip {b.tone}" data-mark={b.mark}>{run.status}</span>

						<span class="min-w-0 flex-1">
							<span class="block truncate font-mono text-[14px] text-white">
								{host(run.client)}
							</span>
							{#if run.competitors.length > 0}
								<span class="block text-[12.5px] text-white/50">
									vs {run.competitors.length}
									{run.competitors.length === 1 ? 'competitor' : 'competitors'}
								</span>
							{/if}
						</span>

						<span class="shrink-0 font-mono text-[12px] text-white/50">
							{new Date(run.createdAt).toLocaleString('en-AU')}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
