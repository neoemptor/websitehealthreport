<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import type { Settings } from '../../../electron/settings/store';
	import type { SeoQuakeSettings } from '../../../electron/analyzers/seoquake';
	import type { ContentSettings } from '../../../electron/analyzers/content';
	import type { OldSeoSettings } from '../../../electron/analyzers/oldseo';
	import { DEFAULT_DISCOVERY_SETTINGS } from '$lib/shared/discovery';

	// electron/settings/store.ts pulls in node's fs/path, so DEFAULT_SETTINGS
	// cannot be imported as a value here; the renderer-safe shape is inlined
	// (matching that module's DEFAULT_SETTINGS), same as on the New report screen.
	const DEFAULT_SETTINGS_SHAPE: Settings = {
		enabledAnalyzers: ['lighthouse', 'keywords'],
		analyzers: {},
		discovery: DEFAULT_DISCOVERY_SETTINGS
	};

	const DEFAULT_SEOQUAKE: SeoQuakeSettings = { chromePath: null, extensionPath: null };
	const DEFAULT_CONTENT: ContentSettings = { ignoreWords: [], grammar: { provider: 'off' } };
	const DEFAULT_OLDSEO: OldSeoSettings = { maxPages: 10 };

	let settings: Settings = DEFAULT_SETTINGS_SHAPE;
	let loading = true;
	let saving = false;
	let saved = '';
	let error = '';

	// Local form fields, flattened out of settings.analyzers for simple binding.
	let grammarProvider: ContentSettings['grammar']['provider'] = DEFAULT_CONTENT.grammar.provider;
	let grammarEndpoint = '';
	let ignoreWordsText = '';
	let chromePath = '';
	let extensionPath = '';
	let maxPages = DEFAULT_OLDSEO.maxPages;

	onMount(async () => {
		try {
			settings = await api().readSettings();
		} catch {
			// Defaults stand; the form still works, it just starts empty.
		}

		const content = (settings.analyzers.content as ContentSettings | undefined) ?? DEFAULT_CONTENT;
		const seoquake =
			(settings.analyzers.seoquake as SeoQuakeSettings | undefined) ?? DEFAULT_SEOQUAKE;
		const oldseo = (settings.analyzers.oldseo as OldSeoSettings | undefined) ?? DEFAULT_OLDSEO;

		grammarProvider = content.grammar.provider;
		grammarEndpoint = content.grammar.endpoint ?? '';
		ignoreWordsText = content.ignoreWords.join('\n');
		chromePath = seoquake.chromePath ?? '';
		extensionPath = seoquake.extensionPath ?? '';
		maxPages = oldseo.maxPages;

		loading = false;
	});

	async function save() {
		saving = true;
		saved = '';
		error = '';
		try {
			const ignoreWords = ignoreWordsText
				.split('\n')
				.map((w) => w.trim())
				.filter((w) => w.length > 0);

			const grammar: ContentSettings['grammar'] =
				grammarProvider === 'languagetool-custom'
					? { provider: grammarProvider, endpoint: grammarEndpoint.trim() }
					: { provider: grammarProvider };

			const next: Settings = {
				...settings,
				analyzers: {
					...settings.analyzers,
					content: { ignoreWords, grammar } satisfies ContentSettings,
					seoquake: {
						chromePath: chromePath.trim() || null,
						extensionPath: extensionPath.trim() || null
					} satisfies SeoQuakeSettings,
					oldseo: {
						maxPages: Math.max(0, Math.min(25, Math.floor(maxPages)))
					} satisfies OldSeoSettings
				}
			};

			await api().writeSettings(next);
			settings = next;
			saved = 'Saved.';
		} catch (e) {
			error = (e as Error).message;
		} finally {
			saving = false;
		}
	}
</script>

<div class="max-w-2xl">
	<h1 class="text-[28px] font-bold leading-tight">Settings</h1>
	<p class="mt-1.5 text-[14px] text-white/60">Defaults used by the checks that need them.</p>

	{#if !loading}
		<div class="mt-8 space-y-7">
			<section class="rounded-2xl border border-white/5 bg-dark-700 px-5 py-4">
				<h2 class="field-label mb-3">Spelling and grammar</h2>

				<div>
					<label class="field-label" for="grammar-provider">Grammar provider</label>
					<select id="grammar-provider" bind:value={grammarProvider} class="field">
						<option value="off">Off</option>
						<option value="languagetool-public">LanguageTool public API</option>
						<option value="languagetool-custom">LanguageTool server</option>
					</select>
				</div>

				{#if grammarProvider === 'languagetool-public'}
					<p role="note" class="mt-2 text-[12px] text-white/50">
						This sends your client's page content to languagetool.org, a third-party service, and is
						rate limited to roughly 20 requests per minute.
					</p>
				{:else if grammarProvider === 'languagetool-custom'}
					<div class="mt-3">
						<label class="field-label" for="grammar-endpoint">Endpoint</label>
						<input
							id="grammar-endpoint"
							bind:value={grammarEndpoint}
							class="field"
							placeholder="http://localhost:8081/v2/check"
						/>
					</div>
				{/if}

				<div class="mt-4">
					<label class="field-label" for="ignore-words">Words to ignore</label>
					<textarea
						id="ignore-words"
						bind:value={ignoreWordsText}
						rows="4"
						class="field resize-y"
						placeholder="One word per line"
					/>
				</div>
			</section>

			<section class="rounded-2xl border border-white/5 bg-dark-700 px-5 py-4">
				<h2 class="field-label mb-3">SEO Quake</h2>
				<div>
					<label class="field-label" for="chrome-path">Chrome path</label>
					<input id="chrome-path" bind:value={chromePath} class="field" placeholder="Automatic" />
				</div>
				<div class="mt-3">
					<label class="field-label" for="extension-path">Extension path</label>
					<input
						id="extension-path"
						bind:value={extensionPath}
						class="field"
						placeholder="Automatic"
					/>
				</div>
				<p class="mt-2 text-[12px] text-white/50">
					Leave both empty to use Puppeteer's bundled Chrome and the default SEO Quake install.
				</p>
			</section>

			<section class="rounded-2xl border border-white/5 bg-dark-700 px-5 py-4">
				<h2 class="field-label mb-3">Old SEO practices</h2>
				<div>
					<label class="field-label" for="max-pages">Pages to read</label>
					<input
						id="max-pages"
						type="number"
						min="0"
						max="25"
						bind:value={maxPages}
						class="field"
					/>
				</div>
			</section>

			{#if error}
				<p role="alert" class="alert">{error}</p>
			{/if}

			<div class="flex items-center gap-4 pt-1">
				<button on:click={save} disabled={saving} class="btn btn-primary">
					{saving ? 'Saving…' : 'Save'}
				</button>
				{#if saved}
					<span class="text-[12.5px] text-white/50">{saved}</span>
				{/if}
			</div>
		</div>
	{/if}
</div>
