<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { api } from '$lib/api';
	import type { Run, AnalyzerResult } from '$lib/shared/types';

	let run: Run | null = null;
	let error = '';
	let unsubscribe: (() => void) | null = null;

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
	} {
		if (!result) return { text: '…', title: 'Waiting', status: 'pending' };
		if (result.status === 'ok') return { text: 'OK', title: 'Completed', status: 'ok' };
		if (result.status === 'unavailable')
			return { text: 'n/a', title: result.reason, status: 'unavailable' };
		return { text: 'fail', title: result.error, status: 'failed' };
	}

	async function resume() {
		if (run) run = await api().resumeRun(run.id);
	}
</script>

{#if error}
	<p role="alert">{error}</p>
{:else if run}
	<h1>{run.client}</h1>
	<p>Status: {run.status}</p>

	<table>
		<thead>
			<tr>
				<th>Domain</th>
				{#each run.enabledAnalyzers as id}<th>{id}</th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each run.domains as domain}
				<tr>
					<td>{domain.domain} ({domain.role})</td>
					{#each run.enabledAnalyzers as id}
						{@const c = cell(domain.analyzers[id])}
						<td class="cell {c.status}" title={c.title}>{c.text}</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>

	{#if run.status !== 'running'}
		<button on:click={resume}>Re-run failed</button>
		<a href={`/report/${run.id}`}>View report</a>
	{/if}
{:else}
	<p>Loading…</p>
{/if}

<style>
	table {
		border-collapse: collapse;
	}

	th,
	td {
		border: 1px solid #ccc;
		padding: 0.35rem 0.6rem;
		text-align: left;
	}

	.cell {
		font-weight: 600;
	}

	.cell.pending {
		color: #888;
		font-weight: 400;
	}

	.cell.ok {
		color: #1a7f37;
		background: #eafbf0;
	}

	.cell.unavailable {
		color: #8a6d1a;
		background: #fff8e5;
	}

	.cell.failed {
		color: #b3261e;
		background: #fdecea;
	}
</style>
