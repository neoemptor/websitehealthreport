<script lang="ts">
	import type { Run } from '$lib/shared/types';
	import { trafficCtaView } from './traffic-cta';
	import { BUSINESS } from './business';

	export let run: Run;

	$: view = trafficCtaView(run);
</script>

<!-- The last thing in the document, and the only place it addresses the reader
     rather than reporting on the site. It renders at all only when a traffic
     section came back blank; when the numbers are there, the report ends on
     them.

     Kept whole: it is short, and a call to action split across a page break
     reads as an afterthought. The rule above it is the same 2px primary the
     subject header uses, so the block closes the document the way the header
     opened it.

     Contact comes from BUSINESS, the same constant the letterhead and the PDF
     footer read, because a wrong phone number on a client's document is not a
     typo anyone catches by reading the code. -->
{#if view}
	<section class="mt-10 break-inside-avoid border-t-2 border-primary-500 pt-5">
		<h2 class="font-heading text-[19px] font-semibold text-primary-800">{view.heading}</h2>

		{#each view.findings as finding}
			<p class="mt-2 max-w-[62ch] text-[12.5px] leading-relaxed text-dark-600">{finding}</p>
		{/each}

		<!-- Darker than the findings above it, and separated from them: this is
		     the part the reader is meant to act on, and it has to look different
		     from the statements of fact that earned it. -->
		{#each view.offer as offer}
			<p class="mt-3.5 max-w-[62ch] text-[12.5px] leading-relaxed text-dark-700">{offer}</p>
		{/each}

		<!-- Underline and weight, no colour: the guide keeps the brand orange off
		     any type under 14pt on white, and this has to survive a mono print. -->
		<p class="mt-3.5 text-[12.5px] leading-relaxed text-dark-700">
			<span class="font-semibold">{BUSINESS.name}</span><br />
			<a class="underline decoration-dark-300 underline-offset-2" href={`tel:${BUSINESS.phone}`}>
				{BUSINESS.phoneDisplay}
			</a>
			<span class="px-1.5 text-dark-400" aria-hidden="true">·</span>
			<a class="underline decoration-dark-300 underline-offset-2" href={`mailto:${BUSINESS.email}`}>
				{BUSINESS.email}
			</a>
		</p>
	</section>
{/if}
