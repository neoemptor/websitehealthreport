/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			colors: {
				// The dsbaileyfreelancer.com.au brand, verbatim from the website's own
				// tailwind.config.js. primary-500 is the brand orange; 600 is its
				// gradient companion; 700 the pressed state. dark-800 is the page,
				// dark-700 the card surface, and the light steps carry text on dark.
				primary: {
					50: '#fff9e6',
					100: '#fff3cc',
					200: '#ffed99',
					300: '#ffe666',
					400: '#ffe033',
					500: '#fdb118',
					600: '#f7931e',
					700: '#e67e0d',
					800: '#b86307',
					900: '#8a4a05'
				},
				dark: {
					50: '#f9fafb',
					100: '#f3f4f6',
					200: '#e5e7eb',
					300: '#d1d5db',
					400: '#9ca3af',
					500: '#6b7280',
					600: '#4b5563',
					700: '#1a1a1a',
					800: '#0a0a0a',
					900: '#000000'
				},
				// Status feedback. The guide permits conventional green/red "sparingly"
				// and these are the only place they appear. Each has a DEFAULT that
				// clears 4.5:1 on white paper and a `bright` step that clears it on
				// the dark-800 screen; colour is never the only signal — every status
				// also carries a glyph and a word, because reports are printed mono.
				ok: { DEFAULT: '#2e7d5b', bright: '#4fb37f' },
				fail: { DEFAULT: '#b3401f', bright: '#e0663f' }
			},
			fontFamily: {
				// Inter for body and Poppins for headings: what the guide records the
				// site actually renders (its declared Zuume/Paralucent never load).
				// Both are OFL and ship inside the app via @fontsource, since a packaged
				// offline app cannot reach a font CDN.
				sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
				heading: ['Poppins', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
				// Measured values only — readings, domains, dates — never as a costume
				// for "technical". The brand has no mono, so this stays system-stack
				// and stays small.
				mono: [
					'ui-monospace',
					'Cascadia Mono',
					'SF Mono',
					'Consolas',
					'Liberation Mono',
					'monospace'
				]
			},
			borderRadius: {
				// The guide's radii: cards 16px, inputs 8px, buttons 10px.
				btn: '10px'
			}
		}
	},
	plugins: []
};
