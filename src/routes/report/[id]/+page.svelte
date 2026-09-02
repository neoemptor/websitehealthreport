<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { api } from '$lib/api';
	import type { Run } from '$lib/shared/types';

	let run: Run | null = null;
	let exporting = false;

	onMount(async () => {
		run = await api().loadRun($page.params.id);
	});

	async function exportPdf() {
		if (!run) return;
		exporting = true;
		try {
			const saved = await api().exportPdf(run.id);
			alert(`Saved to ${saved}`);
		} finally {
			exporting = false;
		}
	}
</script>

{#if run}
	<header class="no-print">
		<button on:click={exportPdf} disabled={exporting}>
			{exporting ? 'Exporting…' : 'Export PDF'}
		</button>
	</header>

	<h1>Website Health Report</h1>
	<p>{run.client} — {new Date(run.createdAt).toLocaleDateString()}</p>

	{#each run.domains as domain}
		<section class="domain">
			<h2>{domain.domain} <small>({domain.role})</small></h2>

			{#each run.enabledAnalyzers as id}
				{@const result = domain.analyzers[id]}
				<h3>{id}</h3>
				{#if !result}
					<p>Not run.</p>
				{:else if result.status === 'unavailable'}
					<p>Unavailable — {result.reason}</p>
				{:else if result.status === 'failed'}
					<p>Failed — {result.error}</p>
				{:else}
					<pre>{JSON.stringify(result.data, null, 2)}</pre>
				{/if}
			{/each}
		</section>
	{/each}
{:else}
	<p>Loading…</p>
{/if}

<style>
	.domain {
		break-inside: avoid;
	}

	@media print {
		.no-print {
			display: none;
		}
		.domain {
			break-after: page;
		}
	}
</style>
