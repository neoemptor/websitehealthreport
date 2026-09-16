<script lang="ts">
	import { estimatedView } from './traffic-view';

	export let data: unknown;

	$: view = estimatedView(data);
</script>

<!-- An empty estimate renders nothing here. The section's finding already says
     "Semrush has no estimate for this site." in the line directly above (see
     trafficEstimatedSeverity), and repeating it verbatim a line later read as
     a mistake rather than as emphasis. The gap still explains itself — once,
     where the verdict belongs. -->
{#if !view.nothing}
	<p class="mt-2 text-[11px] text-dark-500">Estimates from Semrush, not measured traffic.</p>
	<table class="mt-2 w-full break-inside-avoid border-collapse text-left">
		<tbody>
			{#each view.rows as row}
				<tr class="border-b border-dark-200 last:border-0">
					<td class="py-2 pr-4">
						<span class="block text-[12px] text-dark-700">{row.label}</span>
					</td>
					<td class="py-2 text-right font-mono text-[12px] tabular-nums text-dark-700">
						{row.value}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}
