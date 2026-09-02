// Lighthouse Data
// --------------------------------------
import { FileType } from './GeneralLib';
import { FileHandler } from './FileHandler';
export class LHData {
	public static extract(websites: string[]): void {
		FileHandler.save(websites, FileType.LHData);
	}
}
