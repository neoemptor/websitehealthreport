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
	<h1 class="text-[28px] font-bold leading-tight">New report</h1>
	<p class="mt-1.5 text-[14px] text-white/60">
		Runs every selected check against the client and each competitor.
	</p>

	<div class="mt-8 space-y-7">
		<div>
			<label class="field-label" for="client">Client domain</label>
			<input id="client" bind:value={client} class="field" placeholder="cjsgaragedoors.com.au" />
		</div>

		<div>
			<label class="field-label" for="competitors">
				Competitors
				{#if competitorCount > 0}
					<span class="text-primary-500">· {competitorCount}</span>
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
			<legend class="field-label">Checks</legend>
			<!-- The guide's card surface: dark-700 on the dark-800 page, 16px radius,
			     hairline rows at 10% white. -->
			<div
				class="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/5 bg-dark-700"
			>
				{#each available as analyzer}
					<label
						class="flex cursor-pointer items-start gap-3 px-5 py-3.5 transition-colors duration-300 hover:bg-white/5"
					>
						<input
							type="checkbox"
							checked={enabled.includes(analyzer.id)}
							on:change={() => toggle(analyzer.id)}
							class="mt-0.5 h-4 w-4 accent-primary-500"
						/>
						<span class="min-w-0">
							<span class="block text-[14px] font-medium text-white">{analyzer.label}</span>
							<span class="block text-[12.5px] text-white/60">{analyzer.note}</span>
						</span>
					</label>
				{/each}
			</div>
		</fieldset>

		{#if error}
			<p role="alert" class="alert">{error}</p>
		{/if}

		<div class="flex items-center gap-4 pt-1">
			<button
				on:click={start}
				disabled={starting || client.trim().length === 0 || enabled.length === 0}
				class="btn btn-primary"
			>
				{starting ? 'Starting…' : 'Start run'}
			</button>
			<span class="text-[12.5px] text-white/50">
				{enabled.length * (competitorCount + 1)} checks · a few minutes
			</span>
		</div>
	</div>
</div>
