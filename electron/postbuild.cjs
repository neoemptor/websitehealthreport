const fs = require('fs');

// The project root package.json declares "type": "module" (needed by
// SvelteKit/Vite), but tsconfig.electron.json compiles to CommonJS. Node
// resolves module format by walking up to the nearest package.json, so
// without this override the compiled electron/*.js files would be loaded
// as ES modules and fail on `exports`/`require`. Scoping a CommonJS
// package.json to dist-electron/ fixes that for just this subtree.
fs.writeFileSync(
	require('path').join(__dirname, '..', 'dist-electron', 'package.json'),
	JSON.stringify({ type: 'commonjs' })
);
