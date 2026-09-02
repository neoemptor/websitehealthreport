import type { AxiosResponse } from 'axios';
import axios from 'axios';
import * as fs from 'fs';

const BASE_URL = 'http://web.archive.org/cdx/search/cdx';

interface Snapshot {
	urlkey: string;
	timestamp: string;
	original: string;
	mimetype: string;
	statuscode: string;
	digest: string;
	length: string;
}

// type SnapshotEntry = string[];
type ActivityGraph = { [year: string]: number };

export class WBMData {
	private domain: string;

	constructor(domain: string) {
		this.domain = domain;
	}

	private async getSnapshots(): Promise<Snapshot[]> {
		const response: AxiosResponse<string[][]> = await axios.get(BASE_URL, {
			params: {
				url: this.domain,
				output: 'json',
				collapse: 'timestamp:4' // Collapse by year
			}
		});

		const theResponseFormatted: string[][] = response.data.slice(1);

		console.log('step 1 response:', theResponseFormatted);

		return theResponseFormatted.map(function (entry: string[]): Snapshot {
			console.log('entry:', entry);
			return {
				urlkey: entry[0],
				timestamp: entry[1],
				original: entry[2],
				mimetype: entry[3],
				statuscode: entry[4],
				digest: entry[5],
				length: entry[6]
			} as Snapshot;
		});
	}

	private saveDataAsJson(data: ActivityGraph): void {
		const filename = `${this.domain.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_activity_graph.json`;
		fs.writeFileSync(filename, JSON.stringify(data, null, 2), 'utf-8');
		console.log(`Data saved to ${filename}`);
	}

	public async fetchAndSaveSnapshotCounts(): Promise<void> {
		const snapshots = await this.getSnapshots();

		console.log('snapshots:', snapshots);
		const activityGraph: ActivityGraph = {};

		snapshots.forEach((snapshot) => {
			const year = snapshot.timestamp.substring(0, 4);
			activityGraph[year] = (activityGraph[year] || 0) + 1;
		});

		console.log('activity graph:', activityGraph);
		// this.saveDataAsJson(activityGraph);
	}

	async getActivityForLastYear(snapshots: Snapshot[]): Promise<ActivityGraph> {
		if (!snapshots.length) {
			throw new Error('No snapshots found for the given domain.');
		}

		// Find the latest year from the snapshots
		const lastYear = Math.max(...snapshots.map((s) => parseInt(s.timestamp.substring(0, 4))));

		// Initialize monthly activity counter for the last year
		const monthlyActivity: ActivityGraph = {};
		for (let i = 1; i <= 12; i++) {
			monthlyActivity[`${lastYear}-${String(i).padStart(2, '0')}`] = 0;
		}

		// Populate monthly activity based on snapshots
		for (const snapshot of snapshots) {
			const year = snapshot.timestamp.substring(0, 4);
			const month = snapshot.timestamp.substring(4, 6);

			if (parseInt(year) === lastYear) {
				monthlyActivity[`${year}-${month}`]++;
			}
		}

		return monthlyActivity;
	}
}
