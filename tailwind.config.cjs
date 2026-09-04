/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			colors: {
				// Screen surfaces read as instrument; paper reads as document.
				ink: '#14181D',
				slate: '#2A323C',
				steel: '#3D4854',
				paper: '#FBFAF7',
				rule: '#D8D5CE',
				accent: '#0F5C63',
				// Status colours are chosen to stay distinguishable in greyscale,
				// because clients print these reports in black and white. Colour is
				// never the only signal — every status also carries a glyph and a word.
				ok: '#2E7D5B',
				na: '#8A8578',
				fail: '#B3401F'
			},
			fontFamily: {
				sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
				// Serif is the report's voice. It ships on every target platform, so
				// no web font has to be bundled into an app that runs offline.
				serif: [
					'Iowan Old Style',
					'Palatino Linotype',
					'Palatino',
					'Georgia',
					'Times New Roman',
					'serif'
				],
				// Every measured value is set in mono, on screen and in print.
				mono: [
					'ui-monospace',
					'Cascadia Mono',
					'SF Mono',
					'Consolas',
					'Liberation Mono',
					'monospace'
				]
			}
		}
	},
	plugins: []
};
