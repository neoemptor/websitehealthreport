
import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// Extract SEO Quake Data

// Chrome's id for the SEO Quake extension. Stable across versions.
const SEOQUAKE_EXTENSION_ID = 'akdgnmcogleenhbclghghlkkdndkjdjc';

// Where Chrome is normally installed, per platform. The first path that exists
// wins. Override with the CHROME_PATH environment variable.
function chromeCandidates(): string[] {
  switch (process.platform) {
    case 'win32': {
      const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
      return [
        path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe')
      ];
    }
    case 'darwin':
      return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
    default:
      return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
  }
}

// Where Chrome keeps its profile data, which is where unpacked extensions live.
function chromeUserDataDir(): string {
  switch (process.platform) {
    case 'win32':
      return path.join(
        process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local'),
        'Google',
        'Chrome',
        'User Data'
      );
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
    default:
      return path.join(os.homedir(), '.config', 'google-chrome');
  }
}

function resolveChromePath(): string {
  const fromEnv = process.env['CHROME_PATH'];
  if (fromEnv) {
    if (!fs.existsSync(fromEnv)) {
      throw new Error(`CHROME_PATH is set to ${fromEnv}, but no file exists there.`);
    }
    return fromEnv;
  }

  const candidates = chromeCandidates();
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `Could not find Chrome. Looked in:\n  ${candidates.join('\n  ')}\n` +
        `Set the CHROME_PATH environment variable to the Chrome executable.`
    );
  }
  return found;
}

function resolveExtensionPath(): string {
  const fromEnv = process.env['SEOQUAKE_EXTENSION_PATH'];
  if (fromEnv) {
    if (!fs.existsSync(fromEnv)) {
      throw new Error(
        `SEOQUAKE_EXTENSION_PATH is set to ${fromEnv}, but no directory exists there.`
      );
    }
    return fromEnv;
  }

  // Chrome unpacks each extension into a per-version directory, so the version
  // cannot be hardcoded. Pick the highest one present.
  const extensionRoot = path.join(
    chromeUserDataDir(),
    'Default',
    'Extensions',
    SEOQUAKE_EXTENSION_ID
  );

  if (!fs.existsSync(extensionRoot)) {
    throw new Error(
      `SEO Quake does not appear to be installed for the default Chrome profile ` +
        `(looked in ${extensionRoot}). Install it, or set SEOQUAKE_EXTENSION_PATH ` +
        `to the unpacked extension directory.`
    );
  }

  const versions = fs
    .readdirSync(extensionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const latest = versions[versions.length - 1];
  if (!latest) {
    throw new Error(`No extension version directories found in ${extensionRoot}.`);
  }

  return path.join(extensionRoot, latest);
}

export class SEOQData {
  public static extractData(): void {
    (async () => {

      const browserPath = resolveChromePath();
      const extensionPath = resolveExtensionPath();

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
    })().catch((error) => console.error('SEOQData.extractData failed:', error));
  }
}
