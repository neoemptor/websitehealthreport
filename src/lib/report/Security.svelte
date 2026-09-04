<script lang="ts">
	type HeaderFinding = {
		header: string;
		present: boolean;
		value: string | null;
		severity: 'high' | 'medium' | 'low';
		note: string;
	};
	type CookieFinding = {
		name: string;
		secure: boolean;
		httpOnly: boolean;
		sameSite: string | null;
	};
	type Tls =
		| {
				protocol: string | null;
				validTo: string | null;
				daysRemaining: number | null;
				issuer: string | null;
				authorized: boolean;
				authorizationError: string | null;
		  }
		| { error: string };

	export let data: {
		headers: HeaderFinding[];
		cookies: CookieFinding[];
		tls: Tls;
		servedOverHttps: boolean;
	};

	const SEVERITY_TONE = {
		high: 'text-fail',
		medium: 'text-dark-700',
		low: 'text-dark-500'
	} as const;
	const SEVERITY_WORD = { high: 'High', medium: 'Medium', low: 'Low' } as const;

	function headerTitle(header: string): string {
		return header
			.split('-')
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join('-');
	}

	$: tlsError = 'error' in data.tls ? data.tls.error : null;
	$: tls = 'error' in data.tls ? null : data.tls;
</script>

<table class="mt-3 w-full break-inside-avoid border-collapse text-left">
	<tbody>
		<tr class="border-b border-dark-200">
			<td class="py-2 pr-4">
				<span class="block text-[12px] text-dark-700">Served over HTTPS</span>
			</td>
			<td class="w-28 py-2 text-right">
				<span
					class="text-[10px] font-semibold uppercase tracking-wide {data.servedOverHttps
						? 'text-ok'
						: 'text-fail'}"
				>
					{data.servedOverHttps ? 'Yes' : 'No'}
				</span>
			</td>
		</tr>
		<tr class="break-inside-avoid border-b border-dark-200 last:border-0">
			<td class="py-2 pr-4">
				<span class="block text-[12px] text-dark-700">Certificate</span>
				{#if tlsError}
					<span class="block text-[10.5px] text-dark-500">Could not be inspected — {tlsError}</span>
				{:else if tls}
					<span class="block text-[10.5px] text-dark-500">
						{tls.issuer ?? 'Unknown issuer'}, expires in {tls.daysRemaining ?? '?'} days
						{#if tls.authorizationError}— {tls.authorizationError}{/if}
					</span>
				{/if}
			</td>
			<td class="w-28 py-2 text-right">
				{#if tls && !tls.authorized}
					<span class="text-[10px] font-semibold uppercase tracking-wide text-fail">Invalid</span>
				{:else if tls}
					<span class="text-[10px] font-semibold uppercase tracking-wide text-ok">Valid</span>
				{:else}
					<span class="text-[10px] font-semibold uppercase tracking-wide text-dark-500">
						Unknown
					</span>
				{/if}
			</td>
		</tr>
	</tbody>
</table>

<table class="mt-3 w-full border-collapse text-left">
	<tbody>
		{#each data.headers as finding}
			<tr class="break-inside-avoid border-b border-dark-200 last:border-0">
				<td class="py-2 pr-4">
					<span class="block text-[12px] text-dark-700">{headerTitle(finding.header)}</span>
					<span class="block text-[10.5px] text-dark-500">{finding.note}</span>
				</td>
				<td class="w-28 py-2 text-right">
					{#if finding.present}
						<span class="text-[10px] font-semibold uppercase tracking-wide text-ok">Present</span>
					{:else}
						<span
							class="text-[10px] font-semibold uppercase tracking-wide {SEVERITY_TONE[
								finding.severity
							]}"
						>
							Missing
						</span>
						<span class="block text-[10px] text-dark-500">{SEVERITY_WORD[finding.severity]}</span>
					{/if}
				</td>
			</tr>
		{/each}
	</tbody>
</table>

{#if data.cookies.length > 0}
	<table class="mt-3 w-full border-collapse text-left">
		<thead>
			<tr class="border-b border-dark-200">
				<th class="pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-dark-500"
					>Cookie</th
				>
				<th
					class="w-16 pb-1 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-dark-500"
					>Secure</th
				>
				<th
					class="w-20 pb-1 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-dark-500"
					>HttpOnly</th
				>
				<th
					class="w-20 pb-1 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-dark-500"
					>SameSite</th
				>
			</tr>
		</thead>
		<tbody>
			{#each data.cookies as cookie}
				<tr class="break-inside-avoid border-b border-dark-200 last:border-0">
					<td class="py-2 pr-4 font-mono text-[11px] text-dark-700">{cookie.name}</td>
					<td class="py-2 text-right font-mono text-[11px] text-dark-700">
						{cookie.secure ? 'yes' : 'no'}
					</td>
					<td class="py-2 text-right font-mono text-[11px] text-dark-700">
						{cookie.httpOnly ? 'yes' : 'no'}
					</td>
					<td class="py-2 text-right font-mono text-[11px] text-dark-700">
						{cookie.sameSite ?? 'not set'}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}
