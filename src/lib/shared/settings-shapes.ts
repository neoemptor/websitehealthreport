/**
 * Renderer-safe mirrors of the settings shapes owned by
 * electron/analyzers/{seoquake,content,oldseo}. Those modules pull in
 * puppeteer and nspell (via dictionary-en-au), which svelte-check's renderer
 * type-check cannot resolve, so their types cannot be imported from a
 * .svelte file. These shapes are kept in lockstep with the analyzers by
 * hand — see the *.ts files under electron/analyzers for the source of
 * truth on the main-process side.
 */

export type GrammarSettings = {
	provider: 'off' | 'languagetool-public' | 'languagetool-custom';
	endpoint?: string;
};

export type SeoQuakeSettings = { chromePath: string | null; extensionPath: string | null };
export type ContentSettings = { ignoreWords: string[]; grammar: GrammarSettings };
export type OldSeoSettings = { maxPages: number };
