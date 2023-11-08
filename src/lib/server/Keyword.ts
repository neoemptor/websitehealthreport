import puppeteer from "puppeteer";
import type {FileType} from './GeneralLib';

export class Keyword {

    public static extract(websites: string[]): void {
        websites.forEach((site: string) => {
        async function scrapeKeywordsAndCount(site: string): Promise<Map<string, number>> {
          // Launch a new browser instance.
          const browser = await puppeteer.launch();
          
          // Open a new page.
          const page = await browser.newPage();
          
          // Navigate to the URL.
          await page.goto(site, { waitUntil: 'domcontentloaded' });
          
          // Extract keywords from the meta tag and count their occurrences.
          const keywordCounts = await page.evaluate(() => {
            // Find the meta tag with name 'keywords'
            const metaKeywords = document.querySelector('meta[name="keywords"]');
            // Get the content of the meta tag, split by commas and map to lower case.
            const keywords = metaKeywords?.getAttribute('content')?.toLowerCase().split(',') || [];
            // Initialize a map to count keyword occurrences.
            const counts = new Map<string, number>();
        
            // Iterate over each keyword and count its occurrences in the document body text.
            keywords.forEach(keyword => {
              const regex = new RegExp(`\\b${keyword.trim()}\\b`, 'gi'); // Word boundary regex to match whole words only
              const matches = document.body.innerText.match(regex);
              counts.set(keyword.trim(), matches ? matches.length : 0);
            });
        
            // Convert the map to an array to return through Puppeteer.
            return Array.from(counts);
          });
          
          // Close the browser.
          await browser.close();
          
          // Convert the array back to a map and return.
          return new Map(keywordCounts);
        }
        
        // Usage example:
        scrapeKeywordsAndCount('https://example.com').then(keywordCounts => {
          keywordCounts.forEach((count, keyword) => {
            console.log(`${keyword}: ${count}`);
          });
        }).catch(error => {
          console.error('Error scraping keywords and counting:', error);
        });
    });
    }
}