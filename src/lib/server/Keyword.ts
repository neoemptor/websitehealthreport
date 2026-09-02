import puppeteer from "puppeteer";

// Escape characters that carry meaning inside a regular expression, so that a
// keyword such as "garage doors (perth)" is matched literally rather than
// throwing a SyntaxError or matching the wrong thing.
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class Keyword {

    public static extract(websites: string[]): void {
        websites.forEach((site: string) => {
            Keyword.scrapeKeywordsAndCount(site)
                .then((keywordCounts) => {
                    console.log(`Keyword counts for ${site}:`);
                    keywordCounts.forEach((count, keyword) => {
                        console.log(`  ${keyword}: ${count}`);
                    });
                })
                .catch((error) => {
                    console.error(`Error scraping keywords for ${site}:`, error);
                });
        });
    }

    private static async scrapeKeywordsAndCount(site: string): Promise<Map<string, number>> {
        // Launch a new browser instance.
        const browser = await puppeteer.launch();

        try {
            const page = await browser.newPage();
            await page.goto(site, { waitUntil: 'domcontentloaded' });

            // Pull the raw keywords and the body text out of the page. The counting
            // itself happens below, in Node, so that it can share escapeRegExp —
            // page.evaluate runs in the browser and cannot see this module's scope.
            const { keywords, bodyText } = await page.evaluate(() => {
                const metaKeywords = document.querySelector('meta[name="keywords"]');
                const content = metaKeywords?.getAttribute('content')?.toLowerCase() ?? '';

                return {
                    keywords: content
                        .split(',')
                        .map((keyword) => keyword.trim())
                        .filter((keyword) => keyword.length > 0),
                    bodyText: document.body.innerText
                };
            });

            // Count occurrences of each keyword in the body text, whole words only.
            //
            // The boundaries are lookarounds rather than \b because \b only sits
            // between a word and a non-word character. A keyword ending in a symbol,
            // such as "c++", has no boundary after the final "+", so \b could never
            // match it. (?<!\w) and (?!\w) instead require that the match is not
            // glued to a surrounding word character, which behaves identically to \b
            // for ordinary keywords and also works for ones that start or end with
            // punctuation.
            const counts = new Map<string, number>();
            keywords.forEach((keyword) => {
                const regex = new RegExp(`(?<!\\w)${escapeRegExp(keyword)}(?!\\w)`, 'gi');
                counts.set(keyword, bodyText.match(regex)?.length ?? 0);
            });

            return counts;
        } finally {
            await browser.close();
        }
    }
}
