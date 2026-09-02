<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import type { AnalyzerId } from '$lib/shared/types';

	let client = '';
	let competitorText = '';
	let enabled: AnalyzerId[] = ['lighthouse', 'keywords'];
	let error = '';
	let starting = false;

	const available: Array<{ id: AnalyzerId; label: string }> = [
		{ id: 'lighthouse', label: 'Lighthouse' },
		{ id: 'keywords', label: 'Keywords' }
	];

	function toggle(id: AnalyzerId) {
		enabled = enabled.includes(id) ? enabled.filter((e) => e !== id) : [...enabled, id];
	}

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

<h1>New report</h1>

<label>
	Client domain
	<input bind:value={client} placeholder="cjsgaragedoors.com.au" />
</label>

<label>
	Competitors, one per line
	<textarea bind:value={competitorText} rows="4"></textarea>
</label>

<fieldset>
	<legend>Analyzers</legend>
	{#each available as analyzer}
		<label>
			<input
				type="checkbox"
				checked={enabled.includes(analyzer.id)}
				on:change={() => toggle(analyzer.id)}
			/>
			{analyzer.label}
		</label>
	{/each}
</fieldset>

{#if error}
	<p role="alert">{error}</p>
{/if}

<button on:click={start} disabled={starting || client.trim().length === 0}>
	{starting ? 'Starting…' : 'Start run'}
</button>

<a href="/runs">Previous runs</a>
