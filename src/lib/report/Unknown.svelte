<script lang="ts">
	// Fallback for analyzers that have no component yet. Adding an analyzer can
	// never break the report — it degrades to its raw values rather than
	// disappearing or throwing.
	export let data: unknown;
</script>

<pre
	class="mt-2 overflow-x-auto whitespace-pre-wrap border-l-2 border-rule bg-black/[0.03] px-3 py-2 font-mono text-[10.5px] leading-relaxed text-[#3A3730]">{JSON.stringify(
		data,
		null,
		2
	)}</pre>
