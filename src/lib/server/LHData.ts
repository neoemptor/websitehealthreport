// Lighthouse Data
// --------------------------------------
import { exec } from 'child_process';
export class LHData {
  public static extract(websites: string[]): void {
    // List of websites to audit
    // const websites: string[] = [
    //   //'https://radscafe.com.au/',
    //   'https://www.cjsgaragedoors.com.au/',
    //   //   // ... add more websites here
    // ];

    websites.forEach((site: string) => {
      console.log(`Auditing ${site}...`);
      const outputFileName = site.replace(/[^a-zA-Z0-9]/g, '_') + '.json';

      // Run Lighthouse audit and save the results to a JSON file
      const command: string = `lighthouse ${site} --output=json --output-path=${outputFileName} --chrome-flags="--headless"`;
      // execSync(command, { stdio: 'inherit' }); // Execute the command
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error: ${error.message}`);
          return;
        }
        if (stderr) {
          console.error(`Stderr: ${stderr}`);
          return;
        }
        console.log(`Lighthouse results: ${stdout}`);
      });
      console.log(
        `Audit completed for ${site}. Results saved to ${outputFileName}.`
      );
    });
  }
}
