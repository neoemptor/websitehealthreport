<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import type { AnalyzerId } from '$lib/shared/types';

	let client = '';
	let competitorText = '';
	let enabled: AnalyzerId[] = ['lighthouse', 'keywords'];
	let error = '';
	let starting = false;

	const available: Array<{ id: AnalyzerId; label: string; note: string }> = [
		{ id: 'lighthouse', label: 'Lighthouse', note: 'Performance, accessibility, SEO' },
		{ id: 'keywords', label: 'Keywords', note: 'Meta keywords counted in page text' }
	];

	function toggle(id: AnalyzerId) {
		enabled = enabled.includes(id) ? enabled.filter((e) => e !== id) : [...enabled, id];
	}

	$: competitorCount = competitorText.split('\n').filter((line) => line.trim().length > 0).length;

	async function start() {
		error = '';
		starting = true;
		try {
			const competitors = competitorText
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line.length > 0);

			const run = await api().startRun({ client, competitors, enabledAnalyzers: enabled });
			await goto(`/run/${run.id}`);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			starting = false;
		}
	}
</script>

<div class="max-w-2xl">
	<h1 class="text-[20px] font-semibold text-white">New report</h1>
	<p class="mt-1 text-[13px] text-[#8B949E]">
		Runs every selected analyzer against the client and each competitor.
	</p>

	<div class="mt-7 space-y-6">
		<div>
			<label class="field-label" for="client">Client domain</label>
			<input id="client" bind:value={client} class="field" placeholder="cjsgaragedoors.com.au" />
		</div>

		<div>
			<label class="field-label" for="competitors">
				Competitors
				{#if competitorCount > 0}
					<span class="text-accent">· {competitorCount}</span>
				{/if}
			</label>
			<textarea
				id="competitors"
				bind:value={competitorText}
				rows="4"
				class="field resize-y"
				placeholder="One domain per line"
			/>
		</div>

		<fieldset>
			<legend class="field-label">Analyzers</legend>
			<div class="divide-y divide-steel overflow-hidden rounded-sm border border-steel">
				{#each available as analyzer}
					<label
						class="flex cursor-pointer items-start gap-3 bg-slate px-3 py-2.5 hover:bg-steel/40"
					>
						<input
							type="checkbox"
							checked={enabled.includes(analyzer.id)}
							on:change={() => toggle(analyzer.id)}
							class="mt-0.5 h-3.5 w-3.5 accent-accent"
						/>
						<span class="min-w-0">
							<span class="block text-[13px] text-[#E6EDF3]">{analyzer.label}</span>
							<span class="block text-[12px] text-[#8B949E]">{analyzer.note}</span>
						</span>
					</label>
				{/each}
			</div>
		</fieldset>

		{#if error}
			<p
				role="alert"
				class="border-l-2 border-fail bg-fail/10 px-3 py-2 font-mono text-[12px] text-[#F0B4A0]"
			>
				{error}
			</p>
		{/if}

		<div class="flex items-center gap-3 pt-1">
			<button
				on:click={start}
				disabled={starting || client.trim().length === 0 || enabled.length === 0}
				class="btn btn-primary"
			>
				{starting ? 'Starting…' : 'Start run'}
			</button>
			<span class="text-[12px] text-[#6E7681]">
				{enabled.length * (competitorCount + 1)} checks · a few minutes
			</span>
		</div>
	</div>
</div>
