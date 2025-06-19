const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let browserInstance; // Declare a variable to hold the single browser instance

// Helper function to normalize price strings
function normalizePrice(priceStr) {
  if (typeof priceStr === 'string' && priceStr.toLowerCase().includes('free')) {
    return 0;
  }

  const priceMatches = priceStr.match(/(\d[\d.,]*)$/);
  let cleanedPrice = priceMatches ? priceMatches[1] : priceStr;
  cleanedPrice = cleanedPrice.replace(/[^\d.]/g, '');

  if (cleanedPrice === '' || isNaN(parseFloat(cleanedPrice))) {
    return 'N/A';
  }
  return parseFloat(cleanedPrice);
}

// Placeholder for USD to INR conversion rate (for GOG)
const USD_TO_INR_RATE = 83; // This should be fetched from a real-time API for accuracy in a production app.

// New helper function to get significant words from a string
function getSignificantWords(text) {
    // List of common English stop words (articles, prepositions, conjunctions)
    const stopWords = new Set(['of', 'the', 'a', 'an', 'and', 'for', 'with', 'on', 'in', 'at', 'to', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'or', 'but', 'nor', 'yet', 'so', 'then']);
    return text.toLowerCase()
               .split(/\s+/) // Split by one or more whitespace characters
               .filter(word => word.length > 0 && !stopWords.has(word));
}

app.get('/', (req, res) => {
  res.send('Hello from the backend!');
});

// Updated searchSteam function to accept and use the shared browser instance
async function searchSteam(gameName, exclusionKeywords, userWantsExcludedContent, browser) {
  const results = [];
  let page;
  try {
    const searchUrl = `https://store.steampowered.com/search/?term=${encodeURIComponent(gameName)}`;
    console.log('Attempting to scrape Steam search results from URL:', searchUrl);

    page = await browser.newPage(); // Use the shared browser instance
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Check for "0 results match your search."
    const noResultsText = await page.evaluate(() => {
        const element = document.querySelector('.search_results_count');
        return element ? element.textContent.trim() : null;
    });

    if (noResultsText && noResultsText.includes('0 results match your search.')) {
        console.log(`Steam: No results found for "${gameName}". Halting search.`);
        return [];
    }

    await page.waitForSelector('#search_resultsRows .search_result_row', { timeout: 60000 });

    const html = await page.content();
    const $ = cheerio.load(html);

    const gameLinks = [];
    $('#search_resultsRows .search_result_row').each((i, element) => {
      if (gameLinks.length >= 10) {
        return false;
      }
      const name = $(element).find('.title').text().trim();
      const link = $(element).attr('href');
      if (name && link) {
        gameLinks.push({ name, link });
      }
    });

    console.log(`Found ${gameLinks.length} potential Steam games. Now visiting individual pages concurrently for prices...`);

    const pricePromises = gameLinks.map(async (game) => {
      // Early exclusion check for individual pages
      const lowerCaseGameNameInList = game.name.toLowerCase();
      if (!userWantsExcludedContent && exclusionKeywords.some(keyword => lowerCaseGameNameInList.includes(keyword))) {
          console.log(`Skipping Steam game page for excluded content: "${game.name}"`);
          return { name: game.name, price: 'N/A', website: 'Steam', link: game.link }; // Return N/A if skipped
      }

      let gamePage;
      try {
        gamePage = await browser.newPage(); // Use the shared browser instance
        await gamePage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        await gamePage.goto(game.link, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Increased timeout to 60 seconds for individual game page price selectors
        await gamePage.waitForSelector('#game_area_purchase_game_wrapper, .game_area_purchase_game, .game_purchase_action, .game_purchase_price.price, meta[itemprop="price"]', { timeout: 60000 }); 
        
        const gamePageHtml = await gamePage.content();
        const $$ = cheerio.load(gamePageHtml);

        let priceText = 'N/A';
        let purchaseSection = $$('#game_area_purchase_game_wrapper');
        if (purchaseSection.length === 0) {
            purchaseSection = $$('.game_area_purchase_game').first();
        }
        // Fallback to game_purchase_action if previous sections not found/empty
        if (purchaseSection.length === 0) {
            purchaseSection = $$('.game_purchase_action').first();
        }

        if (purchaseSection.length > 0) {
            const finalPriceElement = purchaseSection.find('.discount_final_price').first();
            const originalPriceElement = purchaseSection.find('.discount_original_price').first();
            const standardPriceElement = purchaseSection.find('.game_purchase_price.price').first();
            const freePriceElement = purchaseSection.find('.game_purchase_price.price_free');
            const dataPriceFinalAttribute = purchaseSection.find('.discount_block[data-price-final]').first().attr('data-price-final');
            const gamePurchasePriceDataFinal = standardPriceElement.attr('data-price-final');
            const metaPriceContent = $$('meta[itemprop="price"]').first().attr('content');

            // --- DEBUGGING LOGS FOR STEAM PRICE EXTRACTION ---
            console.log(`Steam Debug for "${game.name}" (${game.link}):`);
            console.log(`  finalPriceElement text: ${finalPriceElement.text().trim()}`);
            console.log(`  originalPriceElement text: ${originalPriceElement.text().trim()}`);
            console.log(`  standardPriceElement text: ${standardPriceElement.text().trim()}`);
            console.log(`  freePriceElement length: ${freePriceElement.length}`);
            console.log(`  dataPriceFinalAttribute: ${dataPriceFinalAttribute}`);
            console.log(`  gamePurchasePriceDataFinal (from .game_purchase_price.price): ${gamePurchasePriceDataFinal}`);
            console.log(`  metaPriceContent: ${metaPriceContent}`);
            console.log(`  purchaseSection text (excerpt): ${purchaseSection.text().trim().substring(0, 100)}...`);
            // --- END DEBUGGING LOGS ---

            // Prioritize metaPriceContent first as it's often a direct numerical value
            if (metaPriceContent) { 
                priceText = metaPriceContent;
            } else if (dataPriceFinalAttribute) {
                priceText = (parseInt(dataPriceFinalAttribute) / 100).toFixed(2);
            } else if (gamePurchasePriceDataFinal) {
                priceText = (parseInt(gamePurchasePriceDataFinal) / 100).toFixed(2);
            } else if (finalPriceElement.length > 0 && finalPriceElement.text().trim() !== '') {
                priceText = finalPriceElement.text().trim();
            } else if (originalPriceElement.length > 0 && originalPriceElement.text().trim() !== '') {
                priceText = originalPriceElement.text().trim();
            } else if (standardPriceElement.length > 0 && standardPriceElement.text().trim() !== '') {
                priceText = standardPriceElement.text().trim();
            } else if (freePriceElement.length > 0) {
                priceText = 'Free';
            }
             // Final fallback: try to get any text from the purchase action area
            if (priceText === 'N/A' || priceText === '') {
                const actionPriceText = purchaseSection.text().trim();
                if (actionPriceText) {
                    priceText = actionPriceText;
                }
            }
        }

        const price = normalizePrice(priceText);
        console.log(`Steam Debug for "${game.name}": Final Raw PriceText="${priceText}", Normalized Price="${price}"`); // Final debug log

        return {
          name: game.name,
          price: price,
          website: 'Steam',
          link: game.link
        };

      } catch (gamePageError) {
        console.error(`Error scraping price for "${game.name}" from ${game.link}:`, gamePageError.message);
        return {
          name: game.name,
          price: 'N/A',
          website: 'Steam',
          link: game.link
        };
      } finally {
        if (gamePage) {
          await gamePage.close(); // Close the individual page
        }
      }
    });

    const results = await Promise.all(pricePromises);

    console.log('Steam Scraped Results:', results);
    return results;
  } catch (error) {
    console.error('Error in searchSteam function:', error);
    return [];
  } finally {
    if (page) {
      await page.close(); // Close the search results page
    }
    // DO NOT close the browser here
  }
}

// Function to scrape Eneba using Puppeteer (FIXED PRICE EXTRACTION)
// Updated to accept and use the shared browser instance
async function searchEneba(gameName, browser) {
  let page;
  const results = []; // Moved declaration to function scope
  try {
    const searchUrl = `https://www.eneba.com/store?text=${encodeURIComponent(gameName)}`;
    console.log('Attempting to scrape Eneba from URL:', searchUrl);

    page = await browser.newPage(); // Use the shared browser instance
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Check for "Sorry, we could not find any match to:"
    const noResultsDivText = await page.evaluate(() => {
        const element = document.querySelector('.UQRbf4'); // Assuming this is the div containing the message
        return element ? element.textContent.trim() : null;
    });

    if (noResultsDivText && noResultsDivText.includes('Sorry, we could not find any match to:')) {
        console.log(`Eneba: No results found for "${gameName}". Halting search.`);
        return [];
    }

    // Wait for the product card container
    await page.waitForSelector('.pFaGHa', { timeout: 60000 });

    const html = await page.content();
    const $ = cheerio.load(html);

    $('.pFaGHa').each((i, element) => {
      const name = $(element).find('.GZjXOw').attr('title'); // title attribute holds the full name
      const link = `https://www.eneba.com${$(element).find('.GZjXOw').attr('href')}`;
      let priceText = $(element).find('.L5ErLT').text().trim(); // Selector for the price

      if (name && priceText && link) {
        // If Eneba's price text contains multiple numbers due to sale, take the last one
        const price = normalizePrice(priceText);
        results.push({
          name: name,
          price: price,
          website: 'Eneba',
          link: link
        });
      }
    });
    console.log('Eneba Scraped Results:', results);
    return results;
  } catch (error) {
    console.error('Error scraping Eneba for "' + gameName + '":', error);
    return [];
  } finally {
    if (page) {
      await page.close(); // Close the page
    }
    // DO NOT close the browser here
  }
}

// Function to scrape CDKeys for game prices
// Updated to accept and use the shared browser instance
async function searchCDKeys(gameName, browser) {
  let page;
  const results = []; // Moved declaration to function scope
  try {
    const searchUrl = `https://www.cdkeys.com/catalogsearch/result/?q=${encodeURIComponent(gameName)}`;
    console.log('Attempting to scrape CDKeys from URL:', searchUrl);

    page = await browser.newPage(); // Use the shared browser instance
    // Set a realistic User-Agent to mimic a browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    // Increase navigation timeout and wait for a specific product item selector
    await page.goto(searchUrl, {
      waitUntil: 'networkidle2', // Changed to networkidle2 for better content loading
      timeout: 120000 // Increased timeout to 120 seconds (already 120)
    });

    // Check for "No products for query"
    const noResultsDivText = await page.evaluate(() => {
        const element = document.querySelector('.no-results');
        return element ? element.textContent.trim() : null;
    });

    if (noResultsDivText && noResultsDivText.includes('No products for query')) {
        console.log(`CDKeys: No results found for "${gameName}". Halting search.`);
        return [];
    }

    // Wait for at least one product item to appear, targeting a more specific element within it
    await page.waitForSelector('.product-info p[itemprop="name"] a', { timeout: 60000 }); // Increased to 60 seconds

    const html = await page.content();
    const $ = cheerio.load(html);

    $('.product-info').each((i, element) => { // Iterate over .product-info as the main item container
      // New selectors based on provided HTML snippet
      const nameElement = $(element).find('p[itemprop="name"] a');
      const name = nameElement.text().trim();
      const link = nameElement.attr('href');
      
      let priceText = '';
      const metaPriceElement = $(element).find('meta[itemprop="price"]');
      const spanPriceElement = $(element).find('span[itemprop="lowPrice"]');

      if (metaPriceElement.length > 0 && metaPriceElement.attr('content')) {
          priceText = metaPriceElement.attr('content');
      } else if (spanPriceElement.length > 0) {
          priceText = spanPriceElement.text().trim();
      }

      if (name && priceText && link) {
        const price = normalizePrice(priceText);
        results.push({
          name: name,
          price: price,
          website: 'CDKeys',
          link: link
        });
      }
    });
    console.log('CDKeys Scraped Results:', results);
    return results;
  } catch (error) {
    console.error('Error scraping CDKeys for "' + gameName + '":', error);
    return [];
  } finally {
    if (page) {
      await page.close(); // Close the page
    }
    // DO NOT close the browser here
  }
}

// Function to scrape Kinguin for game prices
// Updated to accept and use the shared browser instance
async function searchKinguin(gameName, browser) {
  let page;
  const results = []; // Moved declaration to function scope
  try {
    // Construct the search URL using the more robust parameter format
    const searchUrl = `https://www.kinguin.net/listing?production_products_bestsellers_desc%5Bquery%5D=${encodeURIComponent(gameName)}`;
    console.log('Attempting to scrape Kinguin from URL:', searchUrl);

    page = await browser.newPage(); // Use the shared browser instance
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    // Increased timeout for page navigation and changed waitUntil strategy
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 120000 }); // Increased to 120 seconds (already 120)
    
    // Wait for an element that indicates a product card is present, or a no-results message
    // Based on the provided HTML, 'h3[itemprop="name"] a' is a good indicator within a product card
    // Increased timeout for waiting for the selector
    await page.waitForSelector('h3[itemprop="name"] a', { timeout: 60000 }); // Increased to 60 seconds

    const html = await page.content();
    const $ = cheerio.load(html);

    $('div[class*="sc-bTfYFJ"]').each((i, element) => { 
      // Extract name and link from the <a> tag within the h3
      const nameLinkElement = $(element).find('h3[itemprop="name"] a');
      const name = nameLinkElement.text().trim();
      const link = nameLinkElement.attr('href');

      let priceText = '';
      // Prioritize the 'content' attribute of 'span[itemprop="lowPrice"]'
      const lowPriceSpan = $(element).find('span[itemprop="lowPrice"]');
      if (lowPriceSpan.length > 0) {
        priceText = lowPriceSpan.attr('content') || lowPriceSpan.text().trim(); // Get content attribute first, then text
      }

      if (name && priceText && link) {
        const price = normalizePrice(priceText);
        results.push({
          name: name,
          price: price,
          website: 'Kinguin',
          link: link
        });
      }
    });
    console.log('Kinguin Scraped Results:', results);
    return results;
  } catch (error) {
    console.error('Error scraping Kinguin for "' + gameName + '":', error);
    return [];
  } finally {
    if (page) {
      await page.close(); // Close the page
    }
    // DO NOT close the browser here
  }
}

// Function to scrape Epic Games Store for game prices
// Updated to accept and use the shared browser instance
async function searchEpicGames(gameName, browser) {
  let page;
  const results = [];
  try {
    const searchUrl = `https://store.epicgames.com/en-US/browse?q=${encodeURIComponent(gameName)}&sortBy=relevancy&sortDir=DESC&category=Game&count=40&start=0`;
    console.log('Attempting to scrape Epic Games from URL:', searchUrl);

    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 120000 }); // Increased to 120 seconds (already 120)

    const noResultsEpic = await page.evaluate(() => {
        const element = document.querySelector('div.css-1g5l6v9'); // This selector might need adjustment based on actual Epic Games no results page
        if (element && element.textContent.includes('No results found')) {
            return element.textContent;
        }
        return null;
    });

    if (noResultsEpic) {
        console.log(`Epic Games: No results found for "${gameName}". Halting search.`);
        return [];
    }

    // Increased timeout for waiting for the main product card selector
    await page.waitForSelector('li.css-lrwy1y a.css-g3jcms', { timeout: 60000 }); // Increased to 60 seconds

    const html = await page.content();
    const $ = cheerio.load(html);

    $('li.css-lrwy1y').each((i, element) => {
      const name = $(element).find('div.css-s98few span.eds_1ypbntd0 div.css-lgj0h8 div.css-rgqwpc').text().trim();
      const link = `https://store.epicgames.com${$(element).find('a.css-g3jcms').attr('href')}`;
      let priceText = $(element).find('div.css-1q7njkh span.eds_1ypbntd0').text().trim();

      if (name && link) {
        const price = normalizePrice(priceText);
        results.push({
          name: name,
          price: price,
          website: 'Epic Games',
          link: link
        });
      }
    });
    console.log('Epic Games Scraped Results:', results);
    return results;
  } catch (error) {
    console.error('Error scraping Epic Games for "' + gameName + '":', error);
    return [];
  } finally {
    if (page) {
      await page.close();
    }
  }
}

// Updated searchGOG function to accept and use the shared browser instance
async function searchGOG(gameName, exclusionKeywords, userWantsExcludedContent, browser, significantWordsQuery) {
  let page;
  const results = [];
  try {
    const searchUrl = `https://www.gog.com/en/games?query=${encodeURIComponent(gameName)}&order=desc:score`;
    console.log('Attempting to scrape GOG search results from URL:', searchUrl);

    page = await browser.newPage(); // Use the shared browser instance
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Check for "We couldn't find anything matching your criteria"
    const noResultsHeader = await page.evaluate(() => {
        // More robust check: find any h2 that contains the text
        const h2Elements = Array.from(document.querySelectorAll('h2'));
        const foundElement = h2Elements.find(el => el.textContent.includes("We couldn't find anything matching your criteria"));
        return foundElement ? foundElement.textContent.trim() : null;
    });

    if (noResultsHeader && noResultsHeader.includes("We couldn't find anything matching your criteria")) {
        console.log(`GOG: No results found for "${gameName}". Halting search.`);
        return [];
    }

    // New GOG 0 games check
    const zeroGamesHeader = await page.evaluate(() => {
        const h1Elements = Array.from(document.querySelectorAll('h1'));
        const foundElement = h1Elements.find(el => el.textContent.includes('Showing 0 games'));
        return foundElement ? foundElement.textContent.trim() : null;
    });

    if (zeroGamesHeader && zeroGamesHeader.includes('Showing 0 games')) {
        console.log(`GOG: Detected "Showing 0 games" header: "${zeroGamesHeader}". Halting search.`);
        return [];
    }

    await page.waitForSelector('a.product-tile--grid', { timeout: 60000 });

    const html = await page.content();
    const $ = cheerio.load(html);

    const initialGameLinks = []; // Store all game links found on search page
    let count = 0;
    $('a.product-tile--grid').each((i, element) => {
      if (count >= 8) return false;
      const name = $(element).find('.product-tile__title').attr('title') || 
                   $(element).find('.product-tile__title span').text().trim() ||
                   $(element).find('img[selenium-id="productTileGameCover"]').attr('alt');
      const link = $(element).attr('href');
      if (name && link) {
        initialGameLinks.push({ name, link });
        count++;
      }
    });

    console.log(`Found ${initialGameLinks.length} potential GOG games from search results.`);

    // --- NEW: Filter gameLinks before visiting individual pages ---
    const lowerCaseGameName = gameName.toLowerCase();
    const escapedGameName = lowerCaseGameName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const strictSearchRegex = new RegExp(`\\b${escapedGameName}\\b`, 'i');

    const filteredGameLinks = initialGameLinks.filter(game => {
      const lowerCaseGameNameInList = game.name.toLowerCase();

      // Apply exclusion filter
      if (!userWantsExcludedContent && exclusionKeywords.some(keyword => lowerCaseGameNameInList.includes(keyword))) {
          console.log(`Skipping GOG game "${game.name}" due to exclusion keyword on search page.`);
          return false; // Exclude
      }

      // Apply exact match logic
      // First, strict whole-word match
      if (strictSearchRegex.test(lowerCaseGameNameInList)) {
          return true; // Include this strict match
      }

      // If no strict match, try secondary (significant words) exact match
      const significantWordsResult = getSignificantWords(lowerCaseGameNameInList);
      const isSecondaryExactMatch = significantWordsQuery.every(word => significantWordsResult.includes(word));
      
      if (isSecondaryExactMatch) {
          return true; // Include this secondary match
      }

      console.log(`Skipping GOG game "${game.name}" as it's not an exact match on search page.`);
      return false; // Exclude if neither exact match type is found
    });

    console.log(`After pre-navigation filtering, ${filteredGameLinks.length} GOG games remain.`);
    // --- END NEW FILTERING ---

    const pricePromises = filteredGameLinks.map(async (game) => { // Map over filtered links
      let gamePage;
      try {
        gamePage = await browser.newPage(); // Use the shared browser instance
        await gamePage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        await gamePage.goto(game.link, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Increased timeout to 60 seconds for price selectors
        await gamePage.waitForSelector('.product-actions-price__final-amount, .price__value, .product-actions__buy-button--free, .product-actions__lowest-price-before-discount ._price', { timeout: 60000 }); 
        
        const gamePageHtml = await gamePage.content();
        const $$ = cheerio.load(gamePageHtml);

        let priceText = 'N/A';
        const finalAmountElement = $$('.product-actions-price__final-amount').first(); // New selector
        const priceElement = $$('.price__value').first();
        const freeButton = $$('.product-actions__buy-button--free');
        const lowestPriceBeforeDiscountElement = $$('.product-actions__lowest-price-before-discount ._price').first(); // New element

        if (freeButton.length > 0) {
            priceText = 'Free';
        } else if (finalAmountElement.length > 0) { // Prioritize the new final amount selector
            priceText = finalAmountElement.text().trim();
        } else if (priceElement.length > 0) {
            priceText = priceElement.text().trim();
        } else if (lowestPriceBeforeDiscountElement.length > 0) { // Fallback to lowest price before discount
            priceText = lowestPriceBeforeDiscountElement.text().trim();
        }

        console.log(`GOG - Raw Price for "${game.name}" from game page: "${priceText}"`);
        let price = normalizePrice(priceText);
        
        // Convert USD to INR if the price is numeric and from GOG
        if (typeof price === 'number' && price !== 0 && price !== 'N/A') {
            price = price * USD_TO_INR_RATE;
        }

        console.log(`GOG - Normalized Price for "${game.name}": "${price}"`);

        return {
          name: game.name,
          price: price,
          website: 'GOG',
          link: game.link
        };

      } catch (gamePageError) {
        console.error(`Error scraping price for "${game.name}" from ${game.link}:`, gamePageError.message);
        return {
          name: game.name,
          price: 'N/A',
          website: 'GOG',
          link: game.link
        };
      } finally {
        if (gamePage) {
          await gamePage.close(); // Close the individual page
        }
      }
    });

    const results = await Promise.all(pricePromises);

    console.log('GOG Scraped Results:', results);
    return results;

  } catch (error) {
    console.error('Error in searchGOG function:', error);
    return [];
  } finally {
    if (page) {
      await page.close(); // Close the search results page
    }
  }
}

// Updated function to search Xbox PC Game Pass with additional final logging
// Updated to accept and use the shared browser instance
async function searchXboxGamePass(gameName, browser) {
  let page;
  const results = [];
  try {
    const searchUrl = `https://www.xbox.com/en-us/search/results/games?q=${encodeURIComponent(gameName)}&IncludedInSubscription=CFQ7TTC0KGQ8`;
    console.log('Attempting to search Xbox PC Game Pass from URL:', searchUrl);

    page = await browser.newPage(); // Use the shared browser instance
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Check for "Games (0)" in the tab button's aria-label
    const gamesZeroButton = await page.evaluate(() => {
        const button = document.querySelector('button.Tabs-module__tabButton___wRKYV[aria-label*="Games, 0 results shown"]');
        return button ? button.textContent.trim() : null;
    });

    if (gamesZeroButton && gamesZeroButton.includes('Games (0)')) {
        console.log(`Xbox Game Pass: "Games (0)" found for "${gameName}". Halting search.`);
        return [];
    }

    // Check for "Sorry looks like we have nothing here."
    const noResultsXbox = await page.evaluate(() => {
        const element = document.querySelector('h4.ErrorWithImage-module__errorHeading___xEheO');
        return element ? element.textContent.trim() : null;
    });

    if (noResultsXbox && noResultsXbox.includes('Sorry looks like we have nothing here.')) {
        console.log(`Xbox Game Pass: No results found for "${gameName}". Halting search.`);
        return [];
    }

    await page.waitForSelector('li div.ProductCard-module__cardWrapper___6Ls86', { timeout: 60000 });

    const html = await page.content();
    const $ = cheerio.load(html);

    const lowerCaseGameName = gameName.toLowerCase();
    const significantWordsQuery = getSignificantWords(lowerCaseGameName);

    console.log(`Xbox Game Pass - Searching for significant words: [${significantWordsQuery.join(', ')}]`);

    $('li div.ProductCard-module__cardWrapper___6Ls86').each((i, element) => {
      // Updated selectors based on the provided HTML snippet
      const name = $(element).find('.ProductCard-module__title___nHGIp').text().trim();
      const link = `https://www.xbox.com${$(element).find('a.commonStyles-module__basicButton___go-bX').attr('href')}`;
      
      // Price is handled by setting it to 0 for Game Pass titles as per previous request
      const priceText = 'Game Pass'; 

      if (name && link) {
        const lowerCaseName = name.toLowerCase();
        const significantWordsResult = getSignificantWords(lowerCaseName);

        // Check for "Game Pass" in the name itself, or if the result name contains all significant words from the query
        const isExactMatch = lowerCaseName.includes('game pass') || significantWordsQuery.every(word => significantWordsResult.includes(word));
        
        if (isExactMatch) {
            results.push({
                name: name,
                price: 0, // Show as 0 for Game Pass
                website: 'Xbox Game Pass',
                link: link
            });
        }
      }
    });
    console.log('Xbox Game Pass Scraped Results:', results);
    return results;
  } catch (error) {
    console.error('Error scraping Xbox Game Pass for "' + gameName + '":', error);
    return [];
  } finally {
    if (page) {
      await page.close(); // Close the page
    }
    // DO NOT close the browser here
  }
}

// Updated app.get('/search') endpoint
app.get('/search', async (req, res) => {
  const gameName = req.query.gameName;
  const storesParam = req.query.stores;
  const selectedStores = storesParam ? storesParam.split(',') : ['All'];

  if (!gameName) {
    return res.status(400).json({ error: 'Game name is required' });
  }

  const lowerCaseGameName = gameName.toLowerCase();
  const significantWordsQuery = getSignificantWords(lowerCaseGameName); // Get significant words for the query
  
  const exclusionKeywords = ['dlc', 'soundtrack', 'soundtracks', 'costume', 'costumes', 'pack', 'bundle'];
  const userWantsExcludedContent = exclusionKeywords.some(keyword => lowerCaseGameName.includes(keyword));

  let combinedFilteredResults = [];

  try {
    // Ensure browser instance is available before starting searches
    if (!browserInstance) {
        browserInstance = await puppeteer.launch({
            args: [...chromium.args(), '--disable-gpu'],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            timeout: 60000,
        });
    }

    const searchPromises = [];
    if (selectedStores.includes('All') || selectedStores.includes('Steam')) {
      searchPromises.push(searchSteam(gameName, exclusionKeywords, userWantsExcludedContent, browserInstance)); // Pass browserInstance
    }
    if (selectedStores.includes('All') || selectedStores.includes('Eneba')) {
      searchPromises.push(searchEneba(gameName, browserInstance)); // Pass browserInstance
    }
    if (selectedStores.includes('All') || selectedStores.includes('CDKeys')) {
      searchPromises.push(searchCDKeys(gameName, browserInstance)); // Pass browserInstance
    }
    if (selectedStores.includes('All') || selectedStores.includes('Kinguin')) {
      searchPromises.push(searchKinguin(gameName, browserInstance)); // Pass browserInstance
    }
    if (selectedStores.includes('All') || selectedStores.includes('Epic Games')) {
      searchPromises.push(searchEpicGames(gameName, browserInstance)); // Pass browserInstance
    }
    if (selectedStores.includes('All') || selectedStores.includes('GOG')) {
      searchPromises.push(searchGOG(gameName, exclusionKeywords, userWantsExcludedContent, browserInstance, significantWordsQuery)); // Pass significantWordsQuery
    }
    if (selectedStores.includes('All') || selectedStores.includes('Xbox Game Pass')) {
      searchPromises.push(searchXboxGamePass(gameName, browserInstance)); // Pass browserInstance
    }

    const allResultsArrays = await Promise.all(searchPromises);
    let allResults = [].concat(...allResultsArrays);

    if (!userWantsExcludedContent) {
      allResults = allResults.filter(result => {
        const lowerCaseResultName = result.name.toLowerCase();
        return !(exclusionKeywords.some(keyword => lowerCaseResultName.includes(keyword)));
      });
    }

    const filteredByWebsiteExactMatch = [];

    const applyWebsiteFilter = (websiteName) => {
      const websiteResults = allResults.filter(result => result.website === websiteName);
      
      const lowerCaseGameName = gameName.toLowerCase(); // Ensure this is available here
      // Escape special regex characters in the game name for a safe regex construction
      const escapedGameName = lowerCaseGameName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      let strictExactMatches = [];

      // Primary Strict Match Logic:
      // 1. Exact match of the entire string
      if (websiteResults.some(result => result.name.toLowerCase() === lowerCaseGameName)) {
        strictExactMatches = websiteResults.filter(result => result.name.toLowerCase() === lowerCaseGameName);
      } else {
        // 2. Match the game name as a whole word, considering specific delimiters.
        // This regex looks for:
        // (start of string OR a non-alphanumeric character that is NOT apostrophe/hyphen)
        // followed by the escaped game name
        // followed by (end of string OR a non-alphanumeric character that is NOT apostrophe/hyphen)
        // Using `[^\w']` will exclude word chars AND apostrophe. This is tricky.
        // Let's use `\b` but then manually check for apostrophes/hyphens.

        // A more robust regex for strict whole-word matching, allowing for common delimiters like spaces, commas, periods etc.
        // but *not* matching if the word is immediately adjacent to an apostrophe or hyphen (e.g., "Hades'" or "-Hades").
        // This regex ensures the word is preceded/followed by a non-word boundary or string start/end,
        // AND not directly adjacent to ' or -.
        // This pattern might be too complex for a single regex in a robust way due to variable negative lookaheads/behinds in JS regex.

        // Alternative for strict exact match:
        // Split the result name by common delimiters (spaces, commas, colons, periods, etc.)
        // but NOT by apostrophes or hyphens for this first level of strictness.
        const delimitersRegex = /[ ,.:;!?"()\/\\]+/g; // Common delimiters, excluding ' and -
        
        strictExactMatches = websiteResults.filter(result => {
          const lowerCaseResultName = result.name.toLowerCase();
          // Replace delimiters with spaces, then split into words.
          const resultWords = lowerCaseResultName
            .replace(delimitersRegex, ' ')
            .split(' ')
            .filter(word => word.length > 0); // Remove empty strings from splitting

          // Check if the lowerCaseGameName exists as a whole word in the list of resultWords.
          // This ensures "Hades: The Game" contains "hades", but "Shades" does not.
          // For "Hades'" or "-Hades", if the inner word is extracted as "hades", this will still match.
          // We need an additional check for direct adjacency of ' or -.

          // To explicitly exclude 'Hades'' or '-Hades' for 'Hades':
          // We can combine the strict regex with `\b` and then check if the *original* name contains the undesirable patterns.
          const strictRegexWithBoundary = new RegExp(`\\b${escapedGameName}\\b`, 'i');
          const originalResultName = result.name; // Use original name for checks

          if (strictRegexWithBoundary.test(originalResultName)) {
            // Further check for unwanted encapsulation:
            // If the original game name contains the search term immediately followed by an apostrophe or preceded by a hyphen
            // and the search term itself does not contain these, then it's not a strict match.
            const queryHasApostrophe = lowerCaseGameName.includes("'");
            const queryHasHyphen = lowerCaseGameName.includes("-");

            if (!queryHasApostrophe && originalResultName.match(new RegExp(`${escapedGameName}'`, 'i'))) {
              return false; // Exclude "Hades'" if searching for "Hades"
            }
            if (!queryHasHyphen && originalResultName.match(new RegExp(`-${escapedGameName}`, 'i'))) {
              return false; // Exclude "-Hades" if searching for "Hades"
            }
            return true; // It's a strict match based on boundary and no undesirable encapsulation
          }
          return false; // No strict match
        });
      }

      if (strictExactMatches.length > 0) {
        filteredByWebsiteExactMatch.push(...strictExactMatches);
      } else {
        // If no strict exact matches, try the secondary exact match logic (significant words)
        const secondaryExactMatches = websiteResults.filter(result => {
          const lowerCaseResultName = result.name.toLowerCase();
          const significantWordsResult = getSignificantWords(lowerCaseResultName);
          
          const isSecondaryExactMatch = significantWordsQuery.every(word => significantWordsResult.includes(word));
          return isSecondaryExactMatch;
        });

        if (secondaryExactMatches.length > 0) {
          filteredByWebsiteExactMatch.push(...secondaryExactMatches);
        }
        // If neither strict nor secondary matches are found, nothing is pushed for this website
      }
    };

    applyWebsiteFilter('Steam');
    applyWebsiteFilter('Eneba');
    applyWebsiteFilter('CDKeys');
    applyWebsiteFilter('Kinguin');
    applyWebsiteFilter('Epic Games');
    applyWebsiteFilter('GOG');
    
    // Xbox Game Pass results already have an inherent exact match logic in searchXboxGamePass
    // So, we just push them directly.
    filteredByWebsiteExactMatch.push(...allResults.filter(result => result.website === 'Xbox Game Pass'));

    res.json(filteredByWebsiteExactMatch);

  } catch (error) {
    console.error('Error during combined search:', error);
    res.status(500).json({ error: 'Failed to fetch game prices' });
  }
});

// Start the server and launch the Puppeteer browser
app.listen(port, async () => {
  console.log(`Server running on port ${port}`);
  try {
    browserInstance = await puppeteer.launch({
        args: [...chromium.args(), '--disable-gpu'],
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        timeout: 60000,
    });
    console.log('Puppeteer browser launched successfully using @sparticuz/chromium.');
  } catch (error) {
    console.error('Failed to launch Puppeteer browser:', error);
    process.exit(1); // Exit if browser fails to launch
  }
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Server shutting down. Closing Puppeteer browser...');
  if (browserInstance) {
    await browserInstance.close();
    console.log('Puppeteer browser closed.');
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Server shutting down. Closing Puppeteer browser...');
  if (browserInstance) {
    await browserInstance.close();
    console.log('Puppeteer browser closed.');
  }
  process.exit(0);
});
