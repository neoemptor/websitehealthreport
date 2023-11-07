
import puppeteer from 'puppeteer';
// Extract SEO Quake Data


export class SEOQData {
  public static extractData(): void {
    (async () => {

      // Path to the Chrome browser, modify it based on your OS and installation path
      const browserPath =
        '/Program Files (x86)/Google/Chrome/Application/chrome.exe';

      // Path to the SEO Quake extension, you can find this in your Chrome extensions folder
      const extensionPath =
        '/Users/infil/AppData/Local/Google/Chrome/User Data/Default/Extensions/akdgnmcogleenhbclghghlkkdndkjdjc/3.10.3_0';

      const browser = await puppeteer.launch({
        headless: false, // Set to false to see the browser in action
        devtools: true, // Set to true to see the devtools
        executablePath: browserPath,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
        slowMo: 50,
      });

      // add loading delay in the following code
      const page = await browser.newPage();
      await page.goto('https://www.robinsonswelding.com.au/');
      // Set screen size
      await page.setViewport({ width: 1920, height: 1080 });
      // Wait for some time to ensure SEO Quake data loads. Adjust as needed.
      await new Promise((resolve) => setTimeout(resolve, 10000));

      // Here, you'd add code to extract the SEO Quake data from the page's DOM
      // This will heavily depend on how SEO Quake structures its DOM elements.
      // For example:
      // const someData = await page.$eval('.seoquake-class-name', el => el.textContent);
      // await page.waitForSelector('.my-class');
      // const EXPECTED_COUNT = 4;

      await page.waitForFunction(
        (selector) =>
          document.querySelectorAll(selector).length > 0,
        { timeout: 10000 },
        '.seoquake-params-request'

      );

      const elements = await page.$('#sqseobar2');


      if (elements) {
        const theResult = await elements.$$eval('.seoquake-params-request', (nodes) => {
          // (Google Idx) (Backlinks) (SubDomain Backlinks) (Bing Idx) WhoIs Source (SM Rush Rank) Pinterest
          // const theResult: string[] = ['0', '0', '0', '0', '0', '0', '0', '0'];
          // let idx = 0;

          return nodes.map((n) => {
            if (n.textContent !== null) {
              return n.textContent;
            } else {
              return '0';
            }
          });
        });
        console.log('RESULT: ', theResult);
      } else {
        throw new Error('Elements not found');
      }
      // const googleIndexText: string = await theResult[0];
      // const backLinksText = await result[1];
      // const subDomainLinksText = await result[2];
      // const bingIndexText = await result[3];
      // const whoIsText = await result[4];
      // const sourceText = await result[5];
      // const pinterestCountText = await result[7];

      await browser.close();
    })().catch(() => console.log('error'));
  }
}
