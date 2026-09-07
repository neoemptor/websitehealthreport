/**
 * Writes a complete run straight into the app's run storage, so the report
 * route can be opened without waiting minutes for real analyzers.
 *
 * The run id must match electron/run/id.ts's shape, or assertRunId rejects it
 * at the IPC boundary: YYYY-MM-DDTHHMMSS-<host-with-dashes>.
 *
 * Written to both userData roots, because they differ by how Electron was
 * started: `npm run electron:start` gets %APPDATA%/websitehealthreport (the
 * package name), a bare `npx electron <script>` gets %APPDATA%/Electron.
 *
 *   node .claude/skills/run-app/scripts/seed-run.cjs [outFileForId]
 */
const fs = require('fs');
const path = require('path');

const ID = '2026-09-07T090000-example-com';

const pass = (performance, accessibility, bestPractices, seo, lcpMs, cls, tbtMs) => ({
	scores: { performance, accessibility, bestPractices, seo },
	metrics: { lcpMs, cls, tbtMs }
});

// Deliberately mismatched passes: the phone is Poor and its worst category
// differs from the desktop's, which is what exercises the summary wording.
const run = {
	id: ID,
	createdAt: '2026-09-07T09:00:00.000Z',
	client: 'https://example.com/',
	competitors: [],
	enabledAnalyzers: ['lighthouse'],
	status: 'complete',
	domains: [
		{
			domain: 'https://example.com/',
			role: 'client',
			analyzers: {
				lighthouse: {
					status: 'ok',
					data: {
						mobile: pass(41, 88, 74, 91, 4120, 0.03, 610),
						desktop: pass(88, 88, 74, 91, 1800, 0.01, 90)
					}
				}
			}
		}
	]
};

for (const appName of ['websitehealthreport', 'Electron']) {
	const dir = path.join(process.env.APPDATA, appName, 'runs');
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, `${ID}.json`), JSON.stringify(run, null, 2));
}

if (process.argv[2]) fs.writeFileSync(process.argv[2], ID);
console.log(ID);
