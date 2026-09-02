<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import type { Run } from '$lib/shared/types';

	let runs: Run[] = [];
	let error = '';

	onMount(async () => {
		try {
			runs = await api().listRuns();
		} catch (e) {
			error = (e as Error).message;
		}
	});
</script>

<h1>Previous runs</h1>
<a href="/">New report</a>

{#if error}
	<p role="alert">{error}</p>
{:else}
	<ul>
		{#each runs as run}
			<li>
				<a href={`/run/${run.id}`}>{run.client}</a>
				— {new Date(run.createdAt).toLocaleString()} ({run.status})
			</li>
		{:else}
			<li>No runs yet.</li>
		{/each}
	</ul>
{/if}
