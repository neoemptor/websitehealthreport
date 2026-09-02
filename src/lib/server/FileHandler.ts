import { execFile } from 'child_process';
import type { FileType } from './GeneralLib';

export class FileHandler {
	// Only http(s) URLs are accepted. This keeps a site string from being
	// passed to Lighthouse as an option (e.g. a leading `--`) rather than a target.
	private static isSafeUrl(site: string): boolean {
		try {
			const url = new URL(site);
			return url.protocol === 'http:' || url.protocol === 'https:';
		} catch {
			return false;
		}
	}

	public static save(websites: string[], fileType: FileType): void {
		websites.forEach((site: string) => {
			if (!FileHandler.isSafeUrl(site)) {
				console.error(`Skipping ${site}: not a valid http(s) URL.`);
				return;
			}

			console.log(`Auditing ${site}...`);
			const outputFileName = site.replace(/[^a-zA-Z0-9]/g, '_') + '_' + fileType + '.json';

			// Run Lighthouse audit and save the results to a JSON file.
			// execFile is used without a shell, so the arguments are passed to the
			// process verbatim and cannot be interpreted as shell metacharacters.
			const args: string[] = [
				site,
				'--output=json',
				`--output-path=${outputFileName}`,
				'--chrome-flags=--headless'
			];
			execFile('lighthouse', args, { shell: false }, (error, stdout, stderr) => {
				if (error) {
					console.error(`Error: ${error.message}`);
					return;
				}
				if (stderr) {
					console.error(`Stderr: ${stderr}`);
					return;
				}
				console.log(`Lighthouse results: ${stdout}`);
				console.log(`Audit completed for ${site}. Results saved to ${outputFileName}.`);
			});
		});
	}
}
