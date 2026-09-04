declare module 'nspell' {
	type Dictionary = { aff: Buffer; dic: Buffer };
	type Nspell = {
		correct(word: string): boolean;
		suggest(word: string): string[];
	};
	function nspell(dictionary: Dictionary): Nspell;
	export default nspell;
}
