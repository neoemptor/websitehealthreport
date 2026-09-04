<script lang="ts">
	// Fallback for analyzers that have no component yet. Adding an analyzer can
	// never break the report — it degrades to its raw values rather than
	// disappearing or throwing.
	export let data: unknown;
</script>

<pre
	class="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-dark-100 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-dark-600">{JSON.stringify(
		data,
		null,
		2
	)}</pre>
