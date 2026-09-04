<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import logo from '$lib/report/brand-logo.svg?raw';

	// A left rail rather than a top bar: this is desktop software, not a website,
	// and the rail keeps the tool screens one click apart at all times.
	const nav = [
		{ href: '/', label: 'New report' },
		{ href: '/runs', label: 'Runs' }
	];

	$: path = $page.url.pathname;
</script>

<div class="flex min-h-screen">
	<nav class="screen-only w-56 shrink-0 border-r border-white/10 bg-dark-700">
		<div class="flex items-center gap-3 border-b border-white/10 px-5 py-4">
			<!-- The brand mark, in brand orange. Build-time constant, our own file. -->
			<div class="h-8 w-8 shrink-0 text-primary-500 [&>svg]:h-full [&>svg]:w-full">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html logo}
			</div>
			<div class="min-w-0 leading-tight">
				<p class="truncate font-heading text-[13px] font-semibold text-white">D S Bailey</p>
				<p class="truncate text-[11px] text-white/60">Website Health Report</p>
			</div>
		</div>

		<ul class="px-3 py-3">
			{#each nav as item}
				<li>
					<!-- Active is the guide's .nav-link.active: orange, semibold. Hover
					     turns the text orange, as on the site. -->
					<a
						href={item.href}
						class="block rounded-lg px-3 py-2 text-[14px] transition-colors duration-300
							{path === item.href ? 'font-semibold text-primary-500' : 'text-white/70 hover:text-primary-500'}"
					>
						{item.label}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<main class="min-w-0 flex-1 px-10 py-8 print:p-0">
		<slot />
	</main>
</div>
