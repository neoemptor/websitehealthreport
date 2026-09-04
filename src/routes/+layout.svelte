<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';

	// A left rail rather than a top bar: this is desktop software, not a website,
	// and the rail keeps the three tool screens one click apart at all times.
	const nav = [
		{ href: '/', label: 'New report' },
		{ href: '/runs', label: 'Runs' }
	];

	$: path = $page.url.pathname;
</script>

<div class="flex min-h-screen">
	<nav class="screen-only w-52 shrink-0 border-r border-steel bg-slate">
		<div class="border-b border-steel px-5 py-4">
			<p class="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">Website</p>
			<p class="font-mono text-[11px] uppercase tracking-[0.14em] text-[#8B949E]">Health Report</p>
		</div>

		<ul class="px-2 py-3">
			{#each nav as item}
				<li>
					<a
						href={item.href}
						class="block rounded-sm px-3 py-2 text-[13px] transition-colors
							{path === item.href ? 'bg-ink text-white' : 'text-[#8B949E] hover:bg-ink/60 hover:text-[#C9D1D9]'}"
					>
						{item.label}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<main class="min-w-0 flex-1 px-8 py-7 print:p-0">
		<slot />
	</main>
</div>
