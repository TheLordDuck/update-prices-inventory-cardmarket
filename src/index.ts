import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

const EMAIL = process.env.CARDMARKET_EMAIL!;
const PASSWORD = process.env.CARDMARKET_PASSWORD!;

async function login(page: any) {
    await page.goto('https://www.cardmarket.com/es/Magic', { waitUntil: 'domcontentloaded' });
    //await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.fill('input[name="username"]', EMAIL);
    await page.fill('input[name="userPassword"]', PASSWORD);
    await page.click('input[type="submit"]');

    await page.waitForNavigation({ waitUntil: 'domcontentloaded' });

    console.log('✅ Logged in');
}

async function scrapeInventory() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page);

    let currentPage = 1;
    const baseUrl = 'https://www.cardmarket.com/en/Magic/Stock/Offers/Singles';
    const results: string[] = [];

    while (true) {
        const url = `${baseUrl}?site=${currentPage}`;
        console.log(`Scraping: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        await page.waitForSelector('.table-body');

        const noResults = await page.$('.table-body .noResults');
        if (noResults) {
            console.log('🛑 No more results — stopping.');
            break;
        }

        const cards = await page.$$('[id^="articleRow"]');

        let cardPrice = "0"
        const percentageIncrease = 0; // 5% increase
        for (const card of cards) {
            cardPrice = "0"

            // Determine if the card is foil
            const foilIcon = await card.$('span.icon.st_SpecialIcon[aria-label="Foil"]');
            const isFoil = foilIcon ? "Y" : "N";

            // Extract the card detail page URL
            const cardLink = await card.$eval(
                '.col-sellerProductInfo.col .row.g-0 .col-seller.col-12.col-lg-auto a',
                (a) => a.getAttribute('href') || ''
            );
            const cardUrl = `https://www.cardmarket.com${cardLink}?isFoil=${isFoil}`;

            // Open the card detail page in a new tab
            const detailPage = await context.newPage();

            const maxRetries = 3;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    await detailPage.goto(cardUrl, { waitUntil: 'domcontentloaded' });

                    // Wait for the Cloudflare challenge to appear
                    const challengeSelector = 'iframe[title*="challenge"]';
                    const challengeFrame = await detailPage.waitForSelector(challengeSelector, { timeout: 5000 }).catch(() => null);

                    if (challengeFrame) {
                        console.log('Cloudflare challenge detected. Please complete the verification manually.');
                        // Wait until the challenge iframe is no longer present
                        await detailPage.waitForSelector(challengeSelector, { state: 'detached', timeout: 60000 });
                        console.log('Challenge completed. Proceeding...');
                    }

                    // Proceed with your scraping logic here

                    break; // Exit the retry loop upon successful navigation
                } catch (error) {
                    console.log(`Attempt ${attempt + 1}`);
                    if (attempt < maxRetries - 1) {
                        console.log('Retrying...');
                        await detailPage.waitForTimeout(2000); // Wait before retrying
                    } else {
                        console.log('Max retries reached. Skipping this page.');
                    }
                }
            }


            const labeledElement = await detailPage.$('.labeled');
            if (labeledElement) {
                const priceTrend = await labeledElement.evaluate(el => {
                    const dts = Array.from(el.querySelectorAll('dt'));
                    for (let i = 0; i < dts.length; i++) {
                        if (dts[i].textContent?.trim() === 'Price Trend') {
                            const dd = dts[i].nextElementSibling;
                            if (dd) return dd.textContent?.trim();
                        }
                    }
                    return null;
                });

                if (priceTrend) {
                    const priceCleaned = priceTrend.replace(/[^\d,.-]/g, '').trim();
                    const cardPriceReplaced = priceCleaned.replace(',', '.');
                    console.log('cardPriceReplaced', cardPriceReplaced);
                    cardPrice = (Number(cardPriceReplaced) + ((Number(cardPriceReplaced) * percentageIncrease) / 100))
                        .toFixed(2)
                        .replace('.', ',');
                    console.log('cardPrice', cardPrice);
                } else {
                    console.log('Price Trend not found.');
                }
            } else {
                console.log('Element with class ".labeled" not found.');
            }

            await detailPage.close();

            // Click the "Edit" button within the current card
            const editButton = await card.$('div[aria-label="Edit"] a.btn.btn-secondary');
            if (editButton) {
                await editButton.click();
                // Wait for the price input field to be visible
                const priceInput = page.locator('input[name="price"]');
                await priceInput.waitFor({ state: 'visible' });
                // Fill in the price input field
                const formattedPrice = cardPrice.replace(',', '.');
                await priceInput.fill(formattedPrice);
                // Click the "Edit article" button
                await page.click('button[type="submit"]');
            } else {
                console.log('Edit button not found for this card.');
            }
        }

        currentPage += 1;

    }

    await browser.close();

    console.log(`✅ Ended updating ${results.length} cards`);
}

scrapeInventory().catch(console.error);
