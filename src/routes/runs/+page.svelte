<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import type { Run } from '$lib/shared/types';

	let runs: Run[] = [];

	onMount(async () => {
		runs = await api().listRuns();
	});
</script>

<h1>Previous runs</h1>
<a href="/">New report</a>

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
