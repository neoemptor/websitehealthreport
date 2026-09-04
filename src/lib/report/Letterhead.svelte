<script lang="ts">
	// Both are build-time constants read from our own files, never a run result
	// or anything that crossed IPC. The QR is generated once from the website
	// URL (`npm run qr:regen` if it ever changes); the logo is the brand's SVG
	// master, cleaned of editor metadata.
	import qrWebsite from './qr-website.svg?raw';
	import logo from './brand-logo.svg?raw';
	import { BUSINESS } from './business';
</script>

<!-- Stationery: the business name and contact on the left, the mark on the
     right, across the full width. The guide's letterhead rules: the logo as
     vector, never smaller than 25mm, with clear space equal to its own height
     on every side — the parent supplies it above and below; the contact block
     is held a full logo-height away to the left. Both are inlined rather than
     loaded as <img>: printToPDF fires the moment the report says it has
     rendered, and a separate image fetch may not have landed — a missing logo
     on a client's document is exactly what the readiness sentinel exists to
     prevent. Inline also lets the mark take the brand orange via currentColor. -->
<div class="flex items-start justify-between gap-[25mm]">
	<div>
		<p class="font-heading text-[13px] font-semibold leading-snug text-dark-700">{BUSINESS.name}</p>
		<p class="mt-1 text-[10.5px] leading-[1.6] text-dark-500">
			{BUSINESS.phoneDisplay}<br />
			{BUSINESS.email}<br />
			{BUSINESS.websiteDisplay}
		</p>
		<!-- 64px carries the 37-module QR (29 data + quiet zone) at roughly
		     0.45mm per module in print — the floor a phone camera needs. -->
		<div
			class="mt-2.5 w-[64px] text-dark-700 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
			aria-hidden="true"
		>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html qrWebsite}
		</div>
	</div>

	<div
		class="w-[25mm] shrink-0 text-primary-500 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
		aria-label={BUSINESS.name}
		role="img"
	>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html logo}
	</div>
</div>
