<script lang="ts">
	export let data: {
		spelling: { misspellings: Array<{ word: string; count: number; suggestions: string[] }> };
		grammar:
			| { status: 'ok'; findings: Array<{ message: string; context: string }> }
			| { status: 'unavailable'; reason: string }
			| { status: 'failed'; error: string };
	};

	// data may be malformed (an unexpected shape reaching the report); never throw on it.
	$: misspellings = Array.isArray(data?.spelling?.misspellings) ? data.spelling.misspellings : [];
	$: grammar = data?.grammar;
</script>

<div class="mt-3">
	<h4 class="text-[10px] font-semibold uppercase tracking-[0.1em] text-dark-500">Spelling</h4>
	{#if misspellings.length === 0}
		<p class="mt-1.5 text-[12px] text-dark-500">No misspellings found.</p>
	{:else}
		<table class="mt-1.5 w-full break-inside-avoid border-collapse text-left">
			<tbody>
				{#each misspellings as m}
					<tr class="break-inside-avoid border-b border-dark-200">
						<td class="py-1.5 pr-4 align-top font-mono text-[11px] text-dark-700">{m.word}</td>
						<td
							class="w-16 py-1.5 pr-4 align-top text-right text-[11px] tabular-nums text-dark-700"
						>
							{m.count}
						</td>
						<td class="py-1.5 align-top text-[11px] text-dark-500">
							{m.suggestions.length > 0 ? m.suggestions.join(', ') : '—'}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<div class="mt-5">
	<h4 class="text-[10px] font-semibold uppercase tracking-[0.1em] text-dark-500">Grammar</h4>
	{#if grammar?.status === 'unavailable'}
		<p class="mt-1.5 text-[12px] text-dark-500">{grammar.reason}</p>
	{:else if grammar?.status === 'failed'}
		<p class="mt-1.5 text-[12px] text-dark-500">{grammar.error}</p>
	{:else if grammar?.status === 'ok' && grammar.findings.length === 0}
		<p class="mt-1.5 text-[12px] text-dark-500">No grammar issues found.</p>
	{:else if grammar?.status === 'ok'}
		<table class="mt-1.5 w-full break-inside-avoid border-collapse text-left">
			<tbody>
				{#each grammar.findings as f}
					<tr class="break-inside-avoid border-b border-dark-200">
						<td class="py-1.5 align-top">
							<span class="block text-[12px] text-dark-700">{f.message}</span>
							<span class="block font-mono text-[11px] text-dark-500">{f.context}</span>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
