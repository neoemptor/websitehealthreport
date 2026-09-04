<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import type { Settings } from '../../../electron/settings/store';
	import type {
		SeoQuakeSettings,
		ContentSettings,
		OldSeoSettings,
		TrafficOwnedSettings
	} from '$lib/shared/settings-shapes';
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
	const DEFAULT_TRAFFIC_OWNED: TrafficOwnedSettings = { ga4PropertyIds: {}, days: 90 };

	let settings: Settings = DEFAULT_SETTINGS_SHAPE;
	let loading = true;
	let saving = false;
	let saved = '';
	let error = '';
	// If readSettings() throws, the real settings on disk are unknown — saving
	// the defaults shape over them would silently discard whatever is really
	// there, so Save stays disabled until a load actually succeeds.
	let loadFailed = false;

	// Local form fields, flattened out of settings.analyzers for simple binding.
	let grammarProvider: ContentSettings['grammar']['provider'] = DEFAULT_CONTENT.grammar.provider;
	let grammarEndpoint = '';
	let ignoreWordsText = '';
	let chromePath = '';
	let extensionPath = '';
	let maxPages = DEFAULT_OLDSEO.maxPages;

	// GA4 property ids are edited as rows so a client can be added without
	// hand-writing a JSON object; they save with the ordinary Save button.
	let ga4Rows: Array<{ host: string; propertyId: string }> = [];
	let trafficOwnedDays = DEFAULT_TRAFFIC_OWNED.days;

	// Credentials never round-trip: this screen only ever learns whether one is
	// stored, and an input is cleared the moment its value is handed over.
	let semrushKey = '';
	let semrushStored = false;
	let googleClientId = '';
	let googleClientIdStored = false;
	let googleClientSecret = '';
	let googleClientSecretStored = false;
	let credError = '';

	let connectDomain = '';
	let connecting = false;
	let connectStatus = '';

	async function refreshCredentialState() {
		[semrushStored, googleClientIdStored, googleClientSecretStored] = await Promise.all([
			api().hasCredential('semrush.apiKey'),
			api().hasCredential('google.clientId'),
			api().hasCredential('google.clientSecret')
		]);
	}

	async function saveCredential(key: string, value: string, clear: () => void) {
		const trimmed = value.trim();
		if (trimmed.length === 0) return;
		credError = '';
		try {
			await api().setCredential(key, trimmed);
			clear();
			await refreshCredentialState();
		} catch (e) {
			credError = (e as Error).message;
		}
	}

	async function forgetCredential(key: string) {
		credError = '';
		try {
			await api().removeCredential(key);
			await refreshCredentialState();
		} catch (e) {
			credError = (e as Error).message;
		}
	}

	async function connectGoogle() {
		const domain = connectDomain.trim();
		if (domain.length === 0) return;
		connecting = true;
		connectStatus = 'Waiting for the Google sign-in window…';
		try {
			await api().authoriseGoogle(domain);
			connectStatus = `Connected ${domain}.`;
			connectDomain = '';
		} catch (e) {
			connectStatus = (e as Error).message;
		} finally {
			connecting = false;
		}
	}

	function normaliseHost(value: string): string {
		const trimmed = value.trim();
		if (trimmed.length === 0) return '';
		try {
			const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
			return new URL(withScheme).hostname.replace(/^www\./, '');
		} catch {
			return trimmed.toLowerCase().replace(/^www\./, '');
		}
	}

	function addGa4Row() {
		ga4Rows = [...ga4Rows, { host: '', propertyId: '' }];
	}

	function removeGa4Row(index: number) {
		ga4Rows = ga4Rows.filter((_, i) => i !== index);
	}

	onMount(async () => {
		try {
			settings = await api().readSettings();

			const content =
				(settings.analyzers.content as ContentSettings | undefined) ?? DEFAULT_CONTENT;
			const seoquake =
				(settings.analyzers.seoquake as SeoQuakeSettings | undefined) ?? DEFAULT_SEOQUAKE;
			const oldseo = (settings.analyzers.oldseo as OldSeoSettings | undefined) ?? DEFAULT_OLDSEO;

			grammarProvider = content.grammar.provider;
			grammarEndpoint = content.grammar.endpoint ?? '';
			ignoreWordsText = content.ignoreWords.join('\n');
			chromePath = seoquake.chromePath ?? '';
			extensionPath = seoquake.extensionPath ?? '';
			maxPages = oldseo.maxPages;

			const trafficOwned =
				(settings.analyzers['traffic-owned'] as TrafficOwnedSettings | undefined) ??
				DEFAULT_TRAFFIC_OWNED;
			trafficOwnedDays = trafficOwned.days ?? DEFAULT_TRAFFIC_OWNED.days;
			ga4Rows = Object.entries(trafficOwned.ga4PropertyIds ?? {}).map(([host, propertyId]) => ({
				host,
				propertyId
			}));

			await refreshCredentialState();
		} catch (e) {
			// The real settings on disk could not be read — never let the form
			// silently fall back to writing a defaults-shaped object over them.
			loadFailed = true;
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	});

	async function save() {
		if (loadFailed) return;

		saving = true;
		saved = '';
		error = '';
		try {
			const ignoreWords = ignoreWordsText
				.split('\n')
				.map((w) => w.trim())
				.filter((w) => w.length > 0);

			const trimmedEndpoint = grammarEndpoint.trim();
			const grammar: ContentSettings['grammar'] =
				grammarProvider === 'languagetool-custom' && trimmedEndpoint.length > 0
					? { provider: grammarProvider, endpoint: trimmedEndpoint }
					: { provider: grammarProvider };

			// A cleared field must save the documented default (10), never NaN.
			const parsedMaxPages = Number(maxPages);
			const maxPagesToSave = Number.isFinite(parsedMaxPages)
				? Math.min(25, Math.max(0, Math.floor(parsedMaxPages)))
				: 10;

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
						maxPages: maxPagesToSave
					} satisfies OldSeoSettings,
					'traffic-owned': {
						ga4PropertyIds: Object.fromEntries(
							ga4Rows
								.map((row) => [normaliseHost(row.host), row.propertyId.trim()] as const)
								.filter(([host, propertyId]) => host.length > 0 && propertyId.length > 0)
						),
						days: trafficOwnedDays
					} satisfies TrafficOwnedSettings
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
						<p role="note" class="mt-2 text-[12px] text-white/50">
							Your client's page content is sent to this server.
						</p>
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

			<section class="rounded-2xl border border-white/5 bg-dark-700 px-5 py-4">
				<h2 class="field-label mb-3">Traffic (estimated)</h2>
				<div>
					<label class="field-label" for="semrush-key">Semrush API key</label>
					<input
						id="semrush-key"
						type="password"
						bind:value={semrushKey}
						class="field"
						placeholder="Paste the key"
					/>
				</div>
				<p class="mt-2 text-[12px] text-white/50">
					{semrushStored ? 'A key is saved.' : 'No key saved.'}
				</p>
				<div class="mt-3 flex items-center gap-3">
					<button
						class="btn btn-quiet py-2 px-4 text-[13px]"
						on:click={() => saveCredential('semrush.apiKey', semrushKey, () => (semrushKey = ''))}
					>
						Save key
					</button>
					<button
						class="btn btn-quiet py-2 px-4 text-[13px]"
						on:click={() => forgetCredential('semrush.apiKey')}
					>
						Remove
					</button>
				</div>
			</section>

			<section class="rounded-2xl border border-white/5 bg-dark-700 px-5 py-4">
				<h2 class="field-label mb-3">Traffic (measured)</h2>

				<div>
					<label class="field-label" for="google-client-id">Google client ID</label>
					<input id="google-client-id" bind:value={googleClientId} class="field" />
				</div>
				<p class="mt-2 text-[12px] text-white/50">
					{googleClientIdStored ? 'A client ID is saved.' : 'No client ID saved.'}
				</p>
				<div class="mt-3 flex items-center gap-3">
					<button
						class="btn btn-quiet py-2 px-4 text-[13px]"
						on:click={() =>
							saveCredential('google.clientId', googleClientId, () => (googleClientId = ''))}
					>
						Save client ID
					</button>
					<button
						class="btn btn-quiet py-2 px-4 text-[13px]"
						on:click={() => forgetCredential('google.clientId')}
					>
						Remove
					</button>
				</div>

				<div class="mt-4">
					<label class="field-label" for="google-client-secret">Google client secret</label>
					<input
						id="google-client-secret"
						type="password"
						bind:value={googleClientSecret}
						class="field"
					/>
				</div>
				<p class="mt-2 text-[12px] text-white/50">
					{googleClientSecretStored ? 'A client secret is saved.' : 'No client secret saved.'}
				</p>
				<div class="mt-3 flex items-center gap-3">
					<button
						class="btn btn-quiet py-2 px-4 text-[13px]"
						on:click={() =>
							saveCredential(
								'google.clientSecret',
								googleClientSecret,
								() => (googleClientSecret = '')
							)}
					>
						Save client secret
					</button>
					<button
						class="btn btn-quiet py-2 px-4 text-[13px]"
						on:click={() => forgetCredential('google.clientSecret')}
					>
						Remove
					</button>
				</div>

				<h3 class="field-label mb-2 mt-6">Connect a client site</h3>
				<div>
					<label class="field-label" for="connect-domain">Site</label>
					<input
						id="connect-domain"
						bind:value={connectDomain}
						class="field"
						placeholder="cjsgaragedoors.com.au"
					/>
				</div>
				<div class="mt-3 flex items-center gap-3">
					<button
						class="btn btn-quiet py-2 px-4 text-[13px]"
						on:click={connectGoogle}
						disabled={connecting}
					>
						Connect Google account
					</button>
					{#if connectStatus}
						<span class="text-[12.5px] text-white/50">{connectStatus}</span>
					{/if}
				</div>

				<h3 class="field-label mb-2 mt-6">GA4 property ids</h3>
				<table class="w-full text-[13px]">
					<thead>
						<tr class="text-left text-white/50">
							<th class="pb-1 font-normal">Site</th>
							<th class="pb-1 font-normal">Property id</th>
							<th class="pb-1"><span class="sr-only">Remove</span></th>
						</tr>
					</thead>
					<tbody>
						{#each ga4Rows as row, i (i)}
							<tr>
								<td class="pb-2 pr-2">
									<input
										bind:value={row.host}
										class="field"
										placeholder="cjsgaragedoors.com.au"
										aria-label="Site {i + 1}"
									/>
								</td>
								<td class="pb-2 pr-2">
									<input
										bind:value={row.propertyId}
										class="field"
										placeholder="properties/123456789"
										aria-label="Property id {i + 1}"
									/>
								</td>
								<td class="pb-2">
									<button
										class="btn btn-quiet py-2 px-4 text-[13px]"
										on:click={() => removeGa4Row(i)}>Remove</button
									>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<button class="btn btn-quiet py-2 px-4 text-[13px] mt-2" on:click={addGa4Row}
					>Add a site</button
				>

				<p role="note" class="mt-4 text-[12px] text-white/50">
					Owned traffic is read only for sites whose owner has connected their Google account.
					Competitors are never read this way.
				</p>
			</section>

			{#if credError}
				<p role="alert" class="alert">{credError}</p>
			{/if}

			{#if error}
				<p role="alert" class="alert">{error}</p>
			{/if}

			<div class="flex items-center gap-4 pt-1">
				<button on:click={save} disabled={saving || loadFailed} class="btn btn-primary">
					{saving ? 'Saving…' : 'Save'}
				</button>
				{#if saved}
					<span class="text-[12.5px] text-white/50">{saved}</span>
				{/if}
			</div>
		</div>
	{/if}
</div>
