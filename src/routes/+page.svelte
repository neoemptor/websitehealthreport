<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import type { AnalyzerId } from '$lib/shared/types';
	import type { DiscoveryPreflight, DiscoveryResult } from '$lib/shared/discovery';
	import { DEFAULT_DISCOVERY_SETTINGS } from '$lib/shared/discovery';
	import type { Settings } from '../../electron/settings/store';

	// electron/settings/store.ts pulls in node's fs/path, so its DEFAULT_SETTINGS
	// cannot be imported as a value here; the renderer-safe shape is inlined
	// (matching that module's DEFAULT_SETTINGS) instead.
	const DEFAULT_SETTINGS_SHAPE: Settings = {
		enabledAnalyzers: ['lighthouse', 'keywords'],
		analyzers: {},
		discovery: DEFAULT_DISCOVERY_SETTINGS
	};

	let client = '';
	let competitorText = '';
	let enabled: AnalyzerId[] = ['lighthouse', 'keywords'];
	let error = '';
	let starting = false;

	const available: Array<{ id: AnalyzerId; label: string; note: string }> = [
		{ id: 'lighthouse', label: 'Lighthouse', note: 'Performance, accessibility, SEO' },
		{ id: 'keywords', label: 'Keywords', note: 'Meta keywords counted in page text' },
		{
			id: 'oldseo',
			label: 'Old SEO practices',
			note: 'Hidden text, stuffing, cloaking, duplicate pages'
		},
		{
			id: 'wayback',
			label: 'Wayback history',
			note: 'How long the site has been archived and how often'
		},
		{
			id: 'security',
			label: 'Security',
			note: 'HTTPS, certificate, security headers, cookie flags'
		},
		{
			id: 'aeo',
			label: 'AI Agent Optimisation',
			note: 'Can AI crawlers read the site without JavaScript'
		},
		{
			id: 'seoquake',
			label: 'SEO Quake',
			note: 'Semrush rank, backlinks and linking domains from the browser extension'
		},
		{
			id: 'content',
			label: 'Spelling and grammar',
			note: 'Australian English spelling offline; grammar only if switched on in settings'
		},
		{
			id: 'traffic-estimated',
			label: 'Traffic (estimated)',
			note: 'Semrush estimates; needs an API key in Settings'
		},
		{
			id: 'traffic-owned',
			label: 'Traffic (measured)',
			note: "The client's own Search Console and GA4 figures; needs their Google account connected"
		}
	];

	function toggle(id: AnalyzerId) {
		enabled = enabled.includes(id) ? enabled.filter((e) => e !== id) : [...enabled, id];
	}

	$: competitorCount = competitorText.split('\n').filter((line) => line.trim().length > 0).length;

	// Competitor discovery. The switches are remembered in settings; the
	// suggestions are not — they exist to be ticked or ignored.
	let settings: Settings | null = null;
	let readSite = true;
	let webSearch = true;
	let hint = '';
	let preflight: DiscoveryPreflight | null = null;
	let finding = false;
	let discovery: DiscoveryResult | null = null;
	let ticked: string[] = [];

	onMount(async () => {
		try {
			settings = await api().readSettings();
			readSite = settings.discovery.readSite;
			webSearch = settings.discovery.webSearch;
			hint = settings.discovery.hint;
		} catch {
			// Defaults stand; settings are a convenience, not a requirement.
		}
		try {
			preflight = await api().discoveryPreflight();
		} catch (e) {
			preflight = { available: false, reason: (e as Error).message };
		}
	});

	async function rememberDiscovery() {
		settings = {
			...(settings ?? DEFAULT_SETTINGS_SHAPE),
			discovery: { readSite, webSearch, hint }
		};
		try {
			await api().writeSettings(settings);
		} catch {
			// A failed write loses a convenience, not a result.
		}
	}

	$: canSuggest =
		!!preflight?.available &&
		client.trim().length > 0 &&
		(readSite || webSearch || hint.trim().length > 0);

	async function suggest() {
		finding = true;
		discovery = null;
		ticked = [];
		try {
			discovery = await api().suggestCompetitors({ client, readSite, webSearch, hint });
			if (discovery.status === 'ok') ticked = discovery.suggestions.map((s) => s.domain);
		} catch (e) {
			discovery = { status: 'failed', error: (e as Error).message };
		} finally {
			finding = false;
		}
	}

	async function cancelSuggest() {
		try {
			await api().cancelSuggest();
		} catch {
			// The result arrives as cancelled either way.
		}
	}

	function toggleTick(domain: string) {
		ticked = ticked.includes(domain) ? ticked.filter((d) => d !== domain) : [...ticked, domain];
	}

	function addTicked() {
		const present = new Set(
			competitorText
				.split('\n')
				.map((l) => l.trim().toLowerCase())
				.filter(Boolean)
		);
		const fresh: string[] = [];
		for (const d of ticked) {
			const key = d.toLowerCase();
			if (present.has(key)) continue;
			present.add(key);
			fresh.push(d);
		}
		competitorText = [...competitorText.split('\n').filter((l) => l.trim()), ...fresh].join('\n');
		discovery = null;
		ticked = [];
	}

	async function start() {
		error = '';
		starting = true;
		try {
			const competitors = competitorText
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line.length > 0);

			const run = await api().startRun({ client, competitors, enabledAnalyzers: enabled });
			await goto(`/run/${run.id}`);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			starting = false;
		}
	}
</script>

<div class="max-w-2xl">
	<h1 class="text-[28px] font-bold leading-tight">New report</h1>
	<p class="mt-1.5 text-[14px] text-white/60">
		Runs every selected check against the client and each competitor.
	</p>

	<div class="mt-8 space-y-7">
		<div>
			<label class="field-label" for="client">Client domain</label>
			<input id="client" bind:value={client} class="field" placeholder="cjsgaragedoors.com.au" />
		</div>

		<div>
			<label class="field-label" for="competitors">
				Competitors
				{#if competitorCount > 0}
					<span class="text-primary-500">· {competitorCount}</span>
				{/if}
			</label>
			<textarea
				id="competitors"
				bind:value={competitorText}
				rows="4"
				class="field resize-y"
				placeholder="One domain per line"
			/>
		</div>

		<!-- Competitor discovery: Claude, on the operator's own Claude Code login,
		     proposes competitors; nothing enters the list without a tick. -->
		<div class="rounded-2xl border border-white/5 bg-dark-700 px-5 py-4">
			<div class="flex items-baseline justify-between gap-4">
				<span class="field-label mb-0">Suggest competitors</span>
				{#if preflight && !preflight.available}
					<span class="text-[12px] text-white/50">{preflight.reason}</span>
				{:else if preflight?.available}
					<span class="text-[12px] text-white/40">via Claude Code {preflight.version}</span>
				{/if}
			</div>

			<div class="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
				<label class="flex cursor-pointer items-center gap-2 text-[13px] text-white/80">
					<input
						type="checkbox"
						bind:checked={readSite}
						on:change={rememberDiscovery}
						class="h-4 w-4 accent-primary-500"
					/>
					Read the site
				</label>
				<label class="flex cursor-pointer items-center gap-2 text-[13px] text-white/80">
					<input
						type="checkbox"
						bind:checked={webSearch}
						on:change={rememberDiscovery}
						class="h-4 w-4 accent-primary-500"
					/>
					Web search
				</label>
			</div>

			<div class="mt-3">
				<label class="field-label" for="hint">Hint</label>
				<input
					id="hint"
					bind:value={hint}
					on:blur={rememberDiscovery}
					class="field"
					placeholder="trade and area, e.g. garage doors, Newcastle NSW"
				/>
			</div>

			<div class="mt-4 flex items-center gap-3">
				{#if finding}
					<button class="btn btn-quiet" disabled>Finding…</button>
					<button on:click={cancelSuggest} class="btn btn-quiet">Cancel</button>
					<span class="text-[12.5px] text-white/50">
						{webSearch ? 'up to a minute or two with web search' : 'a few seconds'}
					</span>
				{:else}
					<button on:click={suggest} disabled={!canSuggest} class="btn btn-quiet">
						Suggest competitors
					</button>
				{/if}
			</div>

			{#if discovery?.status === 'ok'}
				{#if discovery.note}
					<p class="mt-4 text-[12.5px] text-white/50">{discovery.note}</p>
				{/if}
				{#if discovery.suggestions.length === 0}
					<p class="mt-4 text-[13px] text-white/60">No competitors suggested. Try a hint.</p>
				{:else}
					<ul class="mt-4 divide-y divide-white/10 rounded-lg border border-white/10">
						{#each discovery.suggestions as s (s.domain)}
							<li>
								<label class="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-white/5">
									<input
										type="checkbox"
										checked={ticked.includes(s.domain)}
										on:change={() => toggleTick(s.domain)}
										class="mt-0.5 h-4 w-4 accent-primary-500"
									/>
									<span class="min-w-0">
										<span class="block font-mono text-[13px] text-white">{s.domain}</span>
										<span class="block text-[12.5px] text-white/80">{s.name}</span>
										{#if s.reason}
											<span class="block text-[12px] text-white/50">{s.reason}</span>
										{/if}
									</span>
								</label>
							</li>
						{/each}
					</ul>
					<div class="mt-3 flex items-center gap-3">
						<button on:click={addTicked} disabled={ticked.length === 0} class="btn btn-primary">
							Add {ticked.length === 1 ? '1 competitor' : `${ticked.length} competitors`}
						</button>
						<button on:click={() => (discovery = null)} class="btn btn-quiet">Dismiss</button>
					</div>
				{/if}
			{:else if discovery?.status === 'unavailable'}
				<p class="mt-4 text-[13px] text-white/60">{discovery.reason}</p>
			{:else if discovery?.status === 'failed'}
				<p role="alert" class="alert mt-4">{discovery.error}</p>
			{:else if discovery?.status === 'cancelled'}
				<p class="mt-4 text-[13px] text-white/50">Cancelled.</p>
			{/if}
		</div>

		<fieldset>
			<legend class="field-label">Checks</legend>
			<!-- The guide's card surface: dark-700 on the dark-800 page, 16px radius,
			     hairline rows at 10% white. -->
			<div
				class="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/5 bg-dark-700"
			>
				{#each available as analyzer}
					<label
						class="flex cursor-pointer items-start gap-3 px-5 py-3.5 transition-colors duration-300 hover:bg-white/5"
					>
						<input
							type="checkbox"
							checked={enabled.includes(analyzer.id)}
							on:change={() => toggle(analyzer.id)}
							class="mt-0.5 h-4 w-4 accent-primary-500"
						/>
						<span class="min-w-0">
							<span class="block text-[14px] font-medium text-white">{analyzer.label}</span>
							<span class="block text-[12.5px] text-white/60">{analyzer.note}</span>
						</span>
					</label>
				{/each}
			</div>
		</fieldset>

		{#if error}
			<p role="alert" class="alert">{error}</p>
		{/if}

		<div class="flex items-center gap-4 pt-1">
			<button
				on:click={start}
				disabled={starting || client.trim().length === 0 || enabled.length === 0}
				class="btn btn-primary"
			>
				{starting ? 'Starting…' : 'Start run'}
			</button>
			<span class="text-[12.5px] text-white/50">
				{enabled.length * (competitorCount + 1)} checks · a few minutes
			</span>
		</div>
	</div>
</div>
