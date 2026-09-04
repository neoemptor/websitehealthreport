<script lang="ts">
	// Generated once at build time from the website URL — a constant — so there
	// is no QR library in the bundle and no runtime work. Regenerate with
	// `npm run qr:regen` if the URL ever changes.
	import qrWebsite from './qr-website.svg?raw';
	import { BUSINESS } from './business';
</script>

<div class="flex items-start gap-4">
	<div class="text-right">
		<p class="font-serif text-[13px] leading-snug text-ink">{BUSINESS.name}</p>
		<p class="mt-1.5 font-mono text-[10px] leading-[1.5] text-[#6B6659]">
			{BUSINESS.phoneDisplay}<br />
			{BUSINESS.email}<br />
			{BUSINESS.websiteDisplay}
		</p>
	</div>

	<!-- Scannable on paper, which is one of the four ways this document reaches
	     a reader. Inherits the ink colour rather than shipping black on white.
	     The generated SVG carries a viewBox but no intrinsic size, so it is
	     sized here explicitly — left to itself it lays out at the SVG default
	     width and runs off the edge of the page. -->
	<!-- 88px carries 37 modules (29 data + the 4-module quiet zone each side) at
	     roughly 0.6mm per module in print, which is above the size a phone
	     camera needs. Smaller looks tidier and stops scanning, which would make
	     it decoration. -->
	<div
		class="w-[88px] shrink-0 text-ink [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
		aria-hidden="true"
	>
		<!--
			Inlined rather than loaded as <img src>, for two reasons that both bite
			in the PDF:

			1. printToPDF fires as soon as the report says it has rendered. An <img>
			   is a separate fetch that may not have landed by then, and a silently
			   missing QR in a client's document is exactly the class of failure the
			   readiness sentinel exists to prevent.
			2. currentColor only resolves against the document when the SVG is
			   inline; inside an <img> it falls back to black and stops matching the
			   report's ink.

			It is not user input: a build-time constant read from our own generated
			file, never a run result or anything that crossed IPC.
		-->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html qrWebsite}
	</div>
</div>
