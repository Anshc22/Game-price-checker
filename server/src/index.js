const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const pLimit = require('p-limit').default;

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Store icon URLs - Updated with more reliable sources
const storeIcons = {
    'Steam': 'https://community.cloudflare.steamstatic.com/public/shared/images/responsive/share_steam_logo.png',
    'GOG': 'https://upload.wikimedia.org/wikipedia/commons/d/d7/GOG.com_logo.png',
    'Eneba': 'https://1000logos.net/wp-content/uploads/2021/05/Eneba-Logo.png',
    'CDKeys': 'https://upload.wikimedia.org/wikipedia/commons/f/f3/CD_Keys.png',
    'Kinguin': 'https://upload.wikimedia.org/wikipedia/commons/8/8a/Kinguin_logo.png', // Alternative Kinguin logo
    'Epic Games': 'https://upload.wikimedia.org/wikipedia/commons/5/57/Epic_games_store_logo.svg',
    'Xbox Game Pass': 'https://upload.wikimedia.org/wikipedia/commons/d/d3/Xbox_Game_Pass_logo_-_colored_version.svg',
};

let browserInstance = null; // Shared Puppeteer browser instance

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

// Updated searchSteam function to extract all info from the search results page only
async function searchSteam(gameName, exclusionKeywords, userWantsExcludedContent, browser) {
  const results = [];
  let page;
  try {
    const searchUrl = `https://store.steampowered.com/search/?term=${encodeURIComponent(gameName)}`;
    console.log('Attempting to scrape Steam search results from URL:', searchUrl);

    page = await browser.newPage(); // Use the shared browser instance
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 75000 });
    
    // Check for "0 results match your search."
    const noResultsText = await page.evaluate(() => {
        const element = document.querySelector('.search_results_count');
        return element ? element.textContent.trim() : null;
    });

    if (noResultsText && noResultsText.includes('0 results match your search.')) {
        console.log(`Steam: No results found for "${gameName}". Halting search.`);
        return [];
    }

    await page.waitForSelector('#search_resultsRows .search_result_row', { timeout: 75000 });

    const html = await page.content();
    const $ = cheerio.load(html);

    // Collect lists for each field
    const titleSpans = $('#search_resultsRows .search_result_row .title').toArray();
    const priceDivs = $('#search_resultsRows .search_result_row .discount_final_price').toArray();
    const linkAs = $('#search_resultsRows .search_result_row').toArray(); // The row itself is the <a>
    const imgTags = $('#search_resultsRows .search_result_row .col.search_capsule img').toArray();

    const maxLen = Math.max(titleSpans.length, priceDivs.length, linkAs.length, imgTags.length, 8);
    for (let i = 0; i < maxLen && i < 8; i++) {
      const name = titleSpans[i] ? $(titleSpans[i]).text().trim() : '';
      const link = linkAs[i] ? $(linkAs[i]).attr('href') : '';
      let priceText = priceDivs[i] ? $(priceDivs[i]).text().trim() : '';
      let price = 0;
      if (priceText === '' || priceText.toLowerCase().includes('free')) {
        price = 0;
      } else {
        price = parseFloat(priceText.replace(/[^\d.,]/g, '').replace(',', ''));
        if (isNaN(price)) price = 0;
      }
      let image = imgTags[i] ? $(imgTags[i]).attr('src') || '' : '';
      results.push({
        name,
        price,
        website: 'Steam',
        link,
        icon: storeIcons['Steam'],
        image
      });
        }

    // Apply the same exact/secondary match logic as other stores
    const lowerCaseGameName = gameName.toLowerCase();
    const significantWordsQuery = getSignificantWords(lowerCaseGameName);
    const filteredResults = [];

    // Escape special regex characters in the game name for a safe regex construction
    const escapedGameName = lowerCaseGameName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const strictRegexWithBoundary = new RegExp(`\\b${escapedGameName}\\b`, 'i');

    const primaryMatches = results.filter(result => {
      const lowerCaseResultName = result.name.toLowerCase();
      const originalResultName = result.name;
      if (lowerCaseResultName === lowerCaseGameName) {
        return true;
      }
      if (strictRegexWithBoundary.test(originalResultName)) {
        const queryHasApostrophe = lowerCaseGameName.includes("'");
        const queryHasHyphen = lowerCaseGameName.includes("-");
        if (!queryHasApostrophe && originalResultName.match(new RegExp(`${escapedGameName}'`, 'i'))) {
          return false;
        }
        if (!queryHasHyphen && originalResultName.match(new RegExp(`-${escapedGameName}`, 'i'))) {
          return false;
        }
        if (!queryHasHyphen && originalResultName.match(new RegExp(String.raw`${escapedGameName}-`, 'i'))) {
          return false;
        }
        return true;
                }
      return false;
    });
    if (primaryMatches.length > 0) {
      filteredResults.push(...primaryMatches);
    } else {
      // Secondary match: all significant words present
      const secondaryMatches = results.filter(result => {
        const lowerCaseResultName = result.name.toLowerCase();
        const significantWordsResult = getSignificantWords(lowerCaseResultName);
        const isSecondaryExactMatch = significantWordsQuery.every(word => significantWordsResult.includes(word));
        return isSecondaryExactMatch;
      });
      if (secondaryMatches.length > 0) {
        filteredResults.push(...secondaryMatches);
      }
    }
    return filteredResults;
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

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 75000 });
    
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
    await page.waitForSelector('.pFaGHa', { timeout: 75000 });

    const html = await page.content();
    const $ = cheerio.load(html);

    const enebaGameLinks = [];
    $('.pFaGHa').each((i, element) => {
      const name = $(element).find('.GZjXOw').attr('title');
      const link = `https://www.eneba.com${$(element).find('.GZjXOw').attr('href')}`;
      let priceText = $(element).find('.L5ErLT').text().trim();
      if (name && priceText && link) {
        enebaGameLinks.push({ name, link, priceText });
      }
    });
    const enebaResults = await Promise.all(enebaGameLinks.map(async ({ name, link, priceText }) => {
      const price = normalizePrice(priceText);
      let image = '';
      let gamePage;
      try {
        gamePage = await browser.newPage();
        await gamePage.goto(link, { waitUntil: 'domcontentloaded', timeout: 75000 });
        const gameHtml = await gamePage.content();
        const $$ = cheerio.load(gameHtml);
        image = $$('picture img').attr('src') || '';
        if (!image) {
          // Try srcset for higher resolution if available
          const srcset = $$('picture img').attr('srcset');
          if (srcset) {
            // Use the last (highest-res) image in the srcset
            image = srcset.split(',').pop().split(' ')[0].trim();
          }
        }
      } catch (err) {
        console.error(`Error scraping image for "${name}" from ${link}:`, err.message);
      } finally {
        if (gamePage) await gamePage.close();
      }
      return {
        name,
        price,
        website: 'Eneba',
        link,
        icon: storeIcons['Eneba'],
        image
      };
    }));
    results.push(...enebaResults);
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

// Function to scrape CDKeys for game prices (new robust logic)
async function searchCDKeys(gameName, browser) {
  let page;
  const results = [];
  try {
    const searchUrl = `https://www.cdkeys.com/catalogsearch/result/?q=${encodeURIComponent(gameName)}`;
    console.log('Attempting to scrape CDKeys from URL:', searchUrl);

    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 75000 });
    // Wait for results to render
    try {
      await page.waitForSelector('div.p-2.5.text-white.font-semibold.uppercase.min-h-[68px].product-item-link, div.product.photo.product-item-photo', { timeout: 3000 });
      await new Promise(resolve => setTimeout(resolve, 200)); // Wait 0.2 second for dynamic content
    } catch (e) {
      console.log('CDKeys: No result selector found after waiting.');
    }

    let html = await page.content();
    let $ = cheerio.load(html);

    // Collect lists for each field
    const nameDivs = $("div.flex-grow.flex.flex-col[itemprop='item'][data-name]").toArray();
    const priceSpans = $("span[itemprop='lowPrice'].after_special").toArray();
    const productCards = $("div.product.photo.product-item-photo.block.relative").toArray();
    const linkAs = $("div.product.photo.product-item-photo a").toArray();

    console.log(`CDKeys: Found ${nameDivs.length} names, ${priceSpans.length} prices, ${linkAs.length} links, ${productCards.length} product cards.`);

    const maxLen = Math.max(nameDivs.length, priceSpans.length, linkAs.length, productCards.length);
    for (let i = 0; i < maxLen; i++) {
      // Name from data-name attribute
      const name = nameDivs[i] ? $(nameDivs[i]).attr('data-name')?.trim() || '' : '';
      // Price
      let priceText = priceSpans[i] ? $(priceSpans[i]).text().trim() : '';
      let price = 0;
      if (priceText === '' || priceText.toLowerCase().includes('free')) {
        price = 0;
      } else {
        price = parseFloat(priceText.replace(/[^\d.,]/g, '').replace(',', ''));
        if (isNaN(price)) price = 0;
      }
      // Link
      let link = linkAs[i] ? $(linkAs[i]).attr('href') : '';
      // Image: only consider the first div.image-zoom-hover under the product card
      let image = '';
      if (productCards[i]) {
        const zoomDiv = $(productCards[i]).find('div.image-zoom-hover').first();
        const img = zoomDiv.find('img').first();
        if (img.length) {
          let src = img.attr('src');
          let dataSrc = img.attr('data-src');
          let dataImage = img.attr('data-image');
          let srcset = img.attr('srcset');
          if (src && src !== 'true' && !src.startsWith('data:') && src.trim() !== '') {
            image = src;
          } else if (dataSrc && !dataSrc.startsWith('data:') && dataSrc.trim() !== '') {
            image = dataSrc;
          } else if (dataImage && !dataImage.startsWith('data:') && dataImage.trim() !== '') {
            image = dataImage;
          } else if (srcset && srcset.trim() !== '') {
            image = srcset.split(',').pop().split(' ')[0].trim();
          }
          let style = img.attr('style') || '';
          let bgMatch = style.match(/background-image:\s*url\(['"]?(.*?)['"]?\)/i);
          if (bgMatch && bgMatch[1] && !bgMatch[1].startsWith('data:')) {
            image = bgMatch[1];
          }
        }
      }
      if (image && !image.startsWith('http')) {
        image = `https://www.cdkeys.com${image}`;
      }
      if (name || link) {
        results.push({
          name,
          price,
          website: 'CDKeys',
          link,
          icon: storeIcons['CDKeys'],
          image
        });
      }
    }

    if (results.length === 0) {
      // Try again with a more relaxed query (first significant word)
      const significantWords = getSignificantWords(gameName);
      if (significantWords.length > 0) {
        const relaxedQuery = significantWords[0];
        const relaxedUrl = `https://www.cdkeys.com/catalogsearch/result/?q=${encodeURIComponent(relaxedQuery)}`;
        console.log(`CDKeys: No results for full query, retrying with relaxed query: ${relaxedQuery}`);
        await page.goto(relaxedUrl, { waitUntil: 'domcontentloaded', timeout: 75000 });
        // Wait for results to render
        try {
          await page.waitForSelector('div.p-2.5.text-white.font-semibold.uppercase.min-h-[68px].product-item-link, div.product.photo.product-item-photo', { timeout: 3000 });
          await new Promise(resolve => setTimeout(resolve, 200)); // Wait 0.2 second for dynamic content
        } catch (e) {
          console.log('CDKeys: No result selector found after waiting (relaxed query).');
        }
        html = await page.content();
        $ = cheerio.load(html);
        const nameDivs2 = $("div.flex-grow.flex.flex-col[itemprop='item'][data-name]").toArray();
        const priceSpans2 = $("span[itemprop='lowPrice'].after_special").toArray();
        const productCards2 = $("div.product.photo.product-item-photo.block.relative").toArray();
        const linkAs2 = $("div.product.photo.product-item-photo a").toArray();
        const maxLen2 = Math.max(nameDivs2.length, priceSpans2.length, linkAs2.length, productCards2.length);
        for (let i = 0; i < maxLen2; i++) {
          const name = nameDivs2[i] ? $(nameDivs2[i]).attr('data-name')?.trim() || '' : '';
          let priceText = priceSpans2[i] ? $(priceSpans2[i]).text().trim() : '';
          let price = 0;
          if (priceText === '' || priceText.toLowerCase().includes('free')) {
            price = 0;
          } else {
            price = parseFloat(priceText.replace(/[^\d.,]/g, '').replace(',', ''));
            if (isNaN(price)) price = 0;
          }
          let link = linkAs2[i] ? $(linkAs2[i]).attr('href') : '';
          let image = '';
          if (productCards2[i]) {
            const zoomDiv = $(productCards2[i]).find('div.image-zoom-hover').first();
            const img = zoomDiv.find('img').first();
            if (img.length) {
              let src = img.attr('src');
              let dataSrc = img.attr('data-src');
              let dataImage = img.attr('data-image');
              let srcset = img.attr('srcset');
              if (src && src !== 'true' && !src.startsWith('data:') && src.trim() !== '') {
                image = src;
              } else if (dataSrc && !dataSrc.startsWith('data:') && dataSrc.trim() !== '') {
                image = dataSrc;
              } else if (dataImage && !dataImage.startsWith('data:') && dataImage.trim() !== '') {
                image = dataImage;
              } else if (srcset && srcset.trim() !== '') {
                image = srcset.split(',').pop().split(' ')[0].trim();
              }
              let style = img.attr('style') || '';
              let bgMatch = style.match(/background-image:\s*url\(['"]?(.*?)['"]?\)/i);
              if (bgMatch && bgMatch[1] && !bgMatch[1].startsWith('data:')) {
                image = bgMatch[1];
              }
            }
          }
          if (image && !image.startsWith('http')) {
            image = `https://www.cdkeys.com${image}`;
          }
          if (name || link) {
            results.push({
        name,
        price,
        website: 'CDKeys',
        link,
        icon: storeIcons['CDKeys'],
        image
            });
          }
        }
      }
    }

    // Apply the same exact/secondary match logic as other stores
    const lowerCaseGameName = gameName.toLowerCase();
    const significantWordsQuery = getSignificantWords(lowerCaseGameName);
    const filteredResults = [];

    // Escape special regex characters in the game name for a safe regex construction
    const escapedGameName = lowerCaseGameName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const strictRegexWithBoundary = new RegExp(`\\b${escapedGameName}\\b`, 'i');

    const primaryMatches = results.filter(result => {
      const lowerCaseResultName = result.name.toLowerCase();
      const originalResultName = result.name;
      if (lowerCaseResultName === lowerCaseGameName) {
        return true;
      }
      if (strictRegexWithBoundary.test(originalResultName)) {
        const queryHasApostrophe = lowerCaseGameName.includes("'");
        const queryHasHyphen = lowerCaseGameName.includes("-");
        if (!queryHasApostrophe && originalResultName.match(new RegExp(`${escapedGameName}'`, 'i'))) {
          return false;
        }
        if (!queryHasHyphen && originalResultName.match(new RegExp(`-${escapedGameName}`, 'i'))) {
          return false;
        }
        if (!queryHasHyphen && originalResultName.match(new RegExp(String.raw`${escapedGameName}-`, 'i'))) {
          return false;
        }
        return true;
      }
      return false;
    });
    if (primaryMatches.length > 0) {
      filteredResults.push(...primaryMatches);
    } else {
      // Secondary match: all significant words present
      const secondaryMatches = results.filter(result => {
        const lowerCaseResultName = result.name.toLowerCase();
        const significantWordsResult = getSignificantWords(lowerCaseResultName);
        const isSecondaryExactMatch = significantWordsQuery.every(word => significantWordsResult.includes(word));
        return isSecondaryExactMatch;
      });
      if (secondaryMatches.length > 0) {
        filteredResults.push(...secondaryMatches);
      }
    }
    return filteredResults;
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
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 75000 }); // Increased to 75 seconds
    
    // Wait for an element that indicates a product card is present, or a no-results message
    // Based on the provided HTML, 'h3[itemprop="name"] a' is a good indicator within a product card
    // Increased timeout for waiting for the selector
    await page.waitForSelector('h3[itemprop="name"] a', { timeout: 75000 }); // Increased to 75 seconds

    const html = await page.content();
    const $ = cheerio.load(html);

    const kinguinGameLinks = [];
    $('.sc-iukxot').each((i, element) => {
      // Image
      const image = $(element).find('div[aria-label^="Go to the product page"] img').attr('src') || '';
      // Name and link
      const nameElement = $(element).find('h3[itemprop="name"] a');
      const name = nameElement.text().trim();
      const link = nameElement.attr('href');
      // Price
      const priceText = $(element).find('span.price-mobile[itemprop="lowPrice"]').attr('content') || $(element).find('span.price-mobile[itemprop="lowPrice"]').text().trim();
      if (name && priceText && link) {
        kinguinGameLinks.push({ name, link, priceText, image });
      }
    });
    const kinguinResults = kinguinGameLinks.map(({ name, link, priceText, image }) => {
      const price = normalizePrice(priceText);
      return {
        name,
        price,
        website: 'Kinguin',
        link,
        icon: storeIcons['Kinguin'],
        image
      };
    });
    results.push(...kinguinResults);
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
async function searchEpicGames(gameName, browser) {
  let page;
  const results = [];
  try {
    // Use the provided URL format for Epic Games search
    const searchUrl = `https://store.epicgames.com/en-US/browse?q=${encodeURIComponent(gameName)}&sortBy=relevancy&sortDir=DESC&count=40`;
    console.log('Attempting to scrape Epic Games from URL:', searchUrl);

    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 75000 });

    const html = await page.content();
    const $ = cheerio.load(html);

    // Collect lists for each field
    const titleDivs = $('.css-rgqwpc').toArray();
    const priceSpans = $('.css-12s1vua').toArray();
    const linkAs = $('a.css-g3jcms').toArray();
    const imgTags = $('img.css-1ae5wog').toArray();

    const maxLen = Math.max(titleDivs.length, priceSpans.length, linkAs.length, imgTags.length);
    for (let i = 0; i < maxLen; i++) {
      const name = titleDivs[i] ? $(titleDivs[i]).text().trim() : '';
      let priceText = priceSpans[i] ? $(priceSpans[i]).text().trim() : '';
      let price = 0;
      if (priceText === '' || priceText.toLowerCase().includes('free')) {
        price = 0;
      } else {
        price = parseFloat(priceText.replace(/[^\d.,]/g, '').replace(',', ''));
        if (isNaN(price)) price = 0;
      }
      let link = linkAs[i] ? $(linkAs[i]).attr('href') : '';
      if (link && !link.startsWith('http')) {
        link = `https://store.epicgames.com${link}`;
      }
      let image = '';
      if (imgTags[i]) {
        let src = $(imgTags[i]).attr('src');
        let dataSrc = $(imgTags[i]).attr('data-src');
        let dataImage = $(imgTags[i]).attr('data-image');
        let srcset = $(imgTags[i]).attr('srcset');
        if (dataImage && !dataImage.startsWith('data:') && dataImage.trim() !== '') {
          image = dataImage;
        } else if (dataSrc && !dataSrc.startsWith('data:') && dataSrc.trim() !== '') {
          image = dataSrc;
        } else if (src && !src.startsWith('data:') && src.trim() !== '') {
          image = src;
        } else if (srcset && srcset.trim() !== '') {
          image = srcset.split(',').pop().split(' ')[0].trim();
        }
        let style = $(imgTags[i]).attr('style') || '';
        let bgMatch = style.match(/background-image:\s*url\(['"]?(.*?)['"]?\)/i);
        if (bgMatch && bgMatch[1] && !bgMatch[1].startsWith('data:')) {
          image = bgMatch[1];
        }
      }
      results.push({
        name,
        price,
        website: 'Epic Games',
        link,
        icon: storeIcons['Epic Games'],
        image
      });
    }

    // Apply the same exact/secondary match logic as other stores
    const lowerCaseGameName = gameName.toLowerCase();
    const significantWordsQuery = getSignificantWords(lowerCaseGameName);
    const filteredResults = [];

    // Escape special regex characters in the game name for a safe regex construction
    const escapedGameName = lowerCaseGameName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const strictRegexWithBoundary = new RegExp(`\\b${escapedGameName}\\b`, 'i');

    const primaryMatches = results.filter(result => {
      const lowerCaseResultName = result.name.toLowerCase();
      const originalResultName = result.name;
      if (lowerCaseResultName === lowerCaseGameName) {
        return true;
      }
      if (strictRegexWithBoundary.test(originalResultName)) {
        const queryHasApostrophe = lowerCaseGameName.includes("'");
        const queryHasHyphen = lowerCaseGameName.includes("-");
        if (!queryHasApostrophe && originalResultName.match(new RegExp(`${escapedGameName}'`, 'i'))) {
          return false;
        }
        if (!queryHasHyphen && originalResultName.match(new RegExp(`-${escapedGameName}`, 'i'))) {
          return false;
        }
        if (!queryHasHyphen && originalResultName.match(new RegExp(String.raw`${escapedGameName}-`, 'i'))) {
          return false;
        }
        return true;
      }
      return false;
    });
    if (primaryMatches.length > 0) {
      filteredResults.push(...primaryMatches);
    } else {
      // Secondary match: all significant words present
      const secondaryMatches = results.filter(result => {
        const lowerCaseResultName = result.name.toLowerCase();
        const significantWordsResult = getSignificantWords(lowerCaseResultName);
        const isSecondaryExactMatch = significantWordsQuery.every(word => significantWordsResult.includes(word));
        return isSecondaryExactMatch;
      });
      if (secondaryMatches.length > 0) {
        filteredResults.push(...secondaryMatches);
    }
    }
    return filteredResults;
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

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 75000 });

    const html = await page.content();
    const $ = cheerio.load(html);

    // Collect lists for each field
    const titleSpans = $('product-title.small span').toArray();
    const priceSpans = $('span.final-value').toArray();
    const linkAs = $('a.product-tile.product-tile--grid').toArray();
    const imgTags = $("img[selenium-id='productTileGameCover']").toArray();

    const maxLen = Math.max(titleSpans.length, priceSpans.length, linkAs.length, imgTags.length);
    for (let i = 0; i < maxLen; i++) {
      const name = titleSpans[i] ? $(titleSpans[i]).text().trim() : '';
      let priceText = priceSpans[i] ? $(priceSpans[i]).text().trim() : '';
      let price = 0;
      if (priceText === '' || priceText.toLowerCase().includes('free')) {
        price = 0;
      } else if (priceText.includes('$')) {
        // Convert USD to INR
        let usd = parseFloat(priceText.replace(/[^\d.]/g, ''));
        if (!isNaN(usd)) {
          price = Math.round(usd * USD_TO_INR_RATE);
        } else {
          price = 0;
        }
      } else {
        price = parseFloat(priceText.replace(/[^\d.,]/g, '').replace(',', ''));
        if (isNaN(price)) price = 0;
      }
      let link = linkAs[i] ? $(linkAs[i]).attr('href') : '';
      if (link && !link.startsWith('http')) {
        link = `https://www.gog.com${link}`;
      }
      let image = '';
      if (imgTags[i]) {
        let src = $(imgTags[i]).attr('src');
        let dataSrc = $(imgTags[i]).attr('data-src');
        let dataImage = $(imgTags[i]).attr('data-image');
        let srcset = $(imgTags[i]).attr('srcset');
        if (src && src !== 'true' && !src.startsWith('data:') && src.trim() !== '') {
          image = src;
        } else if (dataSrc && !dataSrc.startsWith('data:') && dataSrc.trim() !== '') {
          image = dataSrc;
        } else if (dataImage && !dataImage.startsWith('data:') && dataImage.trim() !== '') {
          image = dataImage;
        } else if (srcset && srcset.trim() !== '') {
          image = srcset.split(',').pop().split(' ')[0].trim();
        }
        let style = $(imgTags[i]).attr('style') || '';
        let bgMatch = style.match(/background-image:\s*url\(['"]?(.*?)['"]?\)/i);
        if (bgMatch && bgMatch[1] && !bgMatch[1].startsWith('data:')) {
          image = bgMatch[1];
        }
      }
      if (!image) {
        // Fallback: check for background-image in style attribute on parent
        let parentStyle = linkAs[i] ? $(linkAs[i]).parent().attr('style') || '' : '';
        let parentBgMatch = parentStyle.match(/background-image:\s*url\(['"]?(.*?)['"]?\)/i);
        if (parentBgMatch && parentBgMatch[1] && !parentBgMatch[1].startsWith('data:')) {
          image = parentBgMatch[1];
        }
        }
      if (image && !image.startsWith('http')) {
        image = `https://www.gog.com${image}`;
      }
      if (name || link) {
        results.push({
        name,
        price,
        website: 'GOG',
        link,
        icon: storeIcons['GOG'],
        image
        });
      }
    }

    // Apply the same exact/secondary match logic as other stores
    const lowerCaseGameName = gameName.toLowerCase();
    const significantWordsQueryLocal = getSignificantWords(lowerCaseGameName);
    const filteredResults = [];

    // Escape special regex characters in the game name for a safe regex construction
    const escapedGameName = lowerCaseGameName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const strictRegexWithBoundary = new RegExp(`\\b${escapedGameName}\\b`, 'i');

    const primaryMatches = results.filter(result => {
      const lowerCaseResultName = result.name.toLowerCase();
      const originalResultName = result.name;
      if (lowerCaseResultName === lowerCaseGameName) {
        return true;
      }
      if (strictRegexWithBoundary.test(originalResultName)) {
        const queryHasApostrophe = lowerCaseGameName.includes("'");
        const queryHasHyphen = lowerCaseGameName.includes("-");
        if (!queryHasApostrophe && originalResultName.match(new RegExp(`${escapedGameName}'`, 'i'))) {
          return false;
        }
        if (!queryHasHyphen && originalResultName.match(new RegExp(`-${escapedGameName}`, 'i'))) {
          return false;
        }
        if (!queryHasHyphen && originalResultName.match(new RegExp(String.raw`${escapedGameName}-`, 'i'))) {
          return false;
        }
        return true;
      }
      return false;
    });
    if (primaryMatches.length > 0) {
      filteredResults.push(...primaryMatches);
    } else {
      // Secondary match: all significant words present
      const secondaryMatches = results.filter(result => {
        const lowerCaseResultName = result.name.toLowerCase();
        const significantWordsResult = getSignificantWords(lowerCaseResultName);
        const isSecondaryExactMatch = significantWordsQueryLocal.every(word => significantWordsResult.includes(word));
        return isSecondaryExactMatch;
      });
      if (secondaryMatches.length > 0) {
        filteredResults.push(...secondaryMatches);
      }
    }
    return filteredResults;
  } catch (error) {
    console.error('Error in searchGOG function:', error);
    return [];
  } finally {
    if (page) {
      await page.close(); // Close the search results page
    }
  }
}

// Function to scrape Xbox PC Game Pass from the search page only
async function searchXboxGamePass(gameName, browser) {
  let page;
  const results = [];
  try {
    // Use the correct Xbox search URL format
    const searchUrl = `https://www.xbox.com/en-US/search/results/games?q=${encodeURIComponent(gameName)}&IncludedInSubscription=CFQ7TTC0KGQ8`;
    console.log('Attempting to search Xbox PC Game Pass from URL:', searchUrl);

    page = await browser.newPage(); // Use the shared browser instance
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 75000 });
    // Wait for the results to appear (up to 15 seconds)
    try {
      await page.waitForSelector('span.ProductCard-module__title___nHGIp', { timeout: 15000 });
    } catch (e) {
      console.log('Xbox GP: No result selector found after waiting.');
    }

    let html = await page.content();
    let $ = cheerio.load(html);

    // Instead of looping over all main divs, collect lists for each field
    const titleSpans = $('span.ProductCard-module__title___nHGIp').toArray();
    const priceSpans = $('span.ProductCard-module__price___cs1xr').toArray();
    const linkAnchors = $('a.commonStyles-module__basicButton___go-bX').toArray();
    const imgTags = $('img.ProductCard-module__boxArt___-2vQY').toArray();

    console.log(`Xbox GP: Found ${titleSpans.length} titles, ${priceSpans.length} prices, ${linkAnchors.length} links, ${imgTags.length} images.`);

    const maxLen = Math.max(titleSpans.length, priceSpans.length, linkAnchors.length, imgTags.length);
    for (let i = 0; i < maxLen; i++) {
      // Title
      const name = titleSpans[i] ? $(titleSpans[i]).text().trim() : '';
      // Price
      let priceText = priceSpans[i] ? $(priceSpans[i]).text().trim() : '';
      let price = 0;
      if (priceText === '' || priceText.toLowerCase().includes('free')) {
        price = 0;
      } else if (priceText.includes('$')) {
        // Convert USD to INR
        let usd = parseFloat(priceText.replace(/[^\d.]/g, ''));
        if (!isNaN(usd)) {
          price = Math.round(usd * USD_TO_INR_RATE);
        } else {
          price = 0;
      }
      } else {
        price = parseFloat(priceText.replace(/[^\d.,]/g, '').replace(',', ''));
        if (isNaN(price)) price = 0;
      }
      // Image (robust extraction like Epic)
      let image = '';
      if (imgTags[i]) {
        let src = $(imgTags[i]).attr('src');
        let dataSrc = $(imgTags[i]).attr('data-src');
        let dataImage = $(imgTags[i]).attr('data-image');
        let srcset = $(imgTags[i]).attr('srcset');
        if (dataImage && !dataImage.startsWith('data:') && dataImage.trim() !== '') {
          image = dataImage;
        } else if (dataSrc && !dataSrc.startsWith('data:') && dataSrc.trim() !== '') {
          image = dataSrc;
        } else if (src && !src.startsWith('data:') && src.trim() !== '') {
          image = src;
        } else if (srcset && srcset.trim() !== '') {
          image = srcset.split(',').pop().split(' ')[0].trim();
        }
        let style = $(imgTags[i]).attr('style') || '';
        let bgMatch = style.match(/background-image:\s*url\(['"]?(.*?)['"]?\)/i);
        if (bgMatch && bgMatch[1] && !bgMatch[1].startsWith('data:')) {
          image = bgMatch[1];
        }
      }
      if (!image) {
        // Fallback: check for background-image in style attribute on parent
        let parentStyle = linkAnchors[i] ? $(linkAnchors[i]).parent().attr('style') || '' : '';
        let parentBgMatch = parentStyle.match(/background-image:\s*url\(['"]?(.*?)['"]?\)/i);
        if (parentBgMatch && parentBgMatch[1] && !parentBgMatch[1].startsWith('data:')) {
          image = parentBgMatch[1];
        }
      }
      if (image && !image.startsWith('http')) {
        image = `https://www.xbox.com${image}`;
      }
      // Link
      let link = linkAnchors[i] ? $(linkAnchors[i]).attr('href') : '';
      if (link && !link.startsWith('http')) {
        link = `https://www.xbox.com${link}`;
      }
      // Only push if at least a name or link is present
      if (name || link) {
        console.log(`Xbox GP row ${i}: name='${name}', price='${price}', link='${link}', image='${image}'`);
        results.push({
        name,
          price,
        website: 'Xbox Game Pass',
        link,
        icon: storeIcons['Xbox Game Pass'],
        image
        });
      }
    }
    if (results.length === 0) {
      // Log the main search area for debugging
      const mainHtml = $('main').html() || $.html();
      console.log('Xbox GP: No results found. Main HTML snippet:', mainHtml.substring(0, 2000));
    }
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

// Function to scrape G2A for game prices (new robust logic)
async function searchG2A(gameName, browser) {
  let page;
  const results = [];
  try {
    const searchUrl = `https://www.g2a.com/search?query=${encodeURIComponent(gameName)}`;
    console.log('Attempting to scrape G2A from URL:', searchUrl);

    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Referer': 'https://www.g2a.com/',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-User': '?1',
      'Sec-Fetch-Dest': 'document',
      'Upgrade-Insecure-Requests': '1',
    });
    await page.setViewport({ width: 1280, height: 900 });
    await page.setCookie(
      { name: '_abck', value: '2877EF9A79387', domain: '.g2a.com' },
      { name: 'store', value: 'englishus', domain: '.g2a.com' },
      { name: 'sessionId', value: '9ddf81bb-74f9-4', domain: '.g2a.com' },
      { name: 'forterToken', value: '5ad4f128372242', domain: '.g2a.com' },
      { name: 'bm_sz', value: '84EF6640251A8', domain: '.g2a.com' },
      { name: 'bm_sv', value: 'F83D329D114E9', domain: '.g2a.com' },
      { name: 'bm_ss', value: 'ab8e18ef4e', domain: '.g2a.com' },
      { name: 'bm_so', value: 'A029606161B41', domain: '.g2a.com' },
      { name: 'bm_s', value: 'YAAQH3UsMQXS', domain: '.g2a.com' },
      { name: 'bm_mi', value: 'E71AF94AB7598', domain: '.g2a.com' },
      { name: 'bm_lso', value: 'A029606161B41', domain: '.g2a.com' },
      { name: 'ak_bmsc', value: 'BAD4B71B17094', domain: '.g2a.com' }
    );
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise(resolve => setTimeout(resolve, 3500)); // Wait for JS rendering
    let foundSelector = false;
    try {
      await page.waitForSelector('h3.font-bold.text-3xl.line-clamp-1', { timeout: 4000 });
      foundSelector = true;
      await new Promise(resolve => setTimeout(resolve, 1200));
    } catch (e) {
      // Try a more general product card selector
      try {
        await page.waitForSelector('div.relative[style*="height: 227px;"]', { timeout: 4000 });
        foundSelector = true;
        await new Promise(resolve => setTimeout(resolve, 1200));
      } catch (e2) {
        console.log('G2A: No product card selector found after waiting. Dumping HTML snippet for debug.');
        const debugHtml = await page.content();
        console.log(debugHtml.slice(0, 2000)); // Log first 2000 chars for debug
      }
    }
    const html = await page.content();
    const $ = cheerio.load(html);

    // Collect lists for each field
    const nameEls = $('h3.font-bold.text-3xl.line-clamp-1').toArray();
    const priceEls = $('div.font-bold.text-foreground.text-price-2xl').toArray();
    const imgCards = $("div.relative[style*='height: 227px;']").toArray();
    const linkAs = $("div.flex.w-full.flex-col.justify-between a[href]").toArray();

    const maxLen = Math.max(nameEls.length, priceEls.length, linkAs.length, imgCards.length);
    for (let i = 0; i < maxLen; i++) {
      // Name
      const name = nameEls[i] ? $(nameEls[i]).text().trim() : '';
      // Price (convert USD to INR)
      let priceText = priceEls[i] ? $(priceEls[i]).text().trim() : '';
      let price = 0;
      if (priceText === '' || priceText.toLowerCase().includes('free')) {
        price = 0;
      } else if (priceText.match(/\d+[.,]?\d*/)) {
        let usd = parseFloat(priceText.replace(/[^\d.]/g, ''));
        if (!isNaN(usd)) {
          price = Math.round(usd * USD_TO_INR_RATE);
        } else {
          price = 0;
        }
      }
      // Link
      let link = linkAs[i] ? $(linkAs[i]).attr('href') : '';
      if (link && !link.startsWith('http')) {
        link = `https://www.g2a.com${link}`;
      }
      // Image
      let image = '';
      if (imgCards[i]) {
        const img = $(imgCards[i]).find('img').first();
        if (img.length) {
          let src = img.attr('src');
          let dataSrc = img.attr('data-src');
          let dataImage = img.attr('data-image');
          let srcset = img.attr('srcset');
          if (src && src !== 'true' && !src.startsWith('data:') && src.trim() !== '') {
            image = src;
          } else if (dataSrc && !dataSrc.startsWith('data:') && dataSrc.trim() !== '') {
            image = dataSrc;
          } else if (dataImage && !dataImage.startsWith('data:') && dataImage.trim() !== '') {
            image = dataImage;
          } else if (srcset && srcset.trim() !== '') {
            image = srcset.split(',').pop().split(' ')[0].trim();
          }
          let style = img.attr('style') || '';
          let bgMatch = style.match(/background-image:\s*url\(['"]?(.*?)['"]?\)/i);
          if (bgMatch && bgMatch[1] && !bgMatch[1].startsWith('data:')) {
            image = bgMatch[1];
          }
        }
      }
      if (image && !image.startsWith('http')) {
        image = `https://www.g2a.com${image}`;
      }
      if (name || link) {
        results.push({
          name,
          price,
          website: 'G2A',
          link,
          icon: '/icons/g2a.png',
          image
        });
      }
    }

    // Apply the same exact/secondary match logic as other stores
    const lowerCaseGameName = gameName.toLowerCase();
    const significantWordsQuery = getSignificantWords(lowerCaseGameName);
    const filteredResults = [];
    const escapedGameName = lowerCaseGameName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const strictRegexWithBoundary = new RegExp(`\\b${escapedGameName}\\b`, 'i');
    const primaryMatches = results.filter(result => {
      const lowerCaseResultName = result.name.toLowerCase();
      const originalResultName = result.name;
      if (lowerCaseResultName === lowerCaseGameName) {
        return true;
      }
      if (strictRegexWithBoundary.test(originalResultName)) {
        const queryHasApostrophe = lowerCaseGameName.includes("'");
        const queryHasHyphen = lowerCaseGameName.includes("-");
        if (!queryHasApostrophe && originalResultName.match(new RegExp(`${escapedGameName}'`, 'i'))) {
          return false;
        }
        if (!queryHasHyphen && originalResultName.match(new RegExp(`-${escapedGameName}`, 'i'))) {
          return false;
        }
        if (!queryHasHyphen && originalResultName.match(new RegExp(String.raw`${escapedGameName}-`, 'i'))) {
          return false;
        }
        return true;
      }
      return false;
    });
    if (primaryMatches.length > 0) {
      filteredResults.push(...primaryMatches);
    } else {
      // Secondary match: all significant words present
      const secondaryMatches = results.filter(result => {
        const lowerCaseResultName = result.name.toLowerCase();
        const significantWordsResult = getSignificantWords(lowerCaseResultName);
        const isSecondaryExactMatch = significantWordsQuery.every(word => significantWordsResult.includes(word));
        return isSecondaryExactMatch;
      });
      if (secondaryMatches.length > 0) {
        filteredResults.push(...secondaryMatches);
      }
    }
    return filteredResults;
  } catch (error) {
    console.error('Error scraping G2A for "' + gameName + '":', error);
    return [];
  } finally {
    if (page) {
      await page.close();
    }
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
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
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
      
      // Escape special regex characters in the game name for a safe regex construction
      const escapedGameName = lowerCaseGameName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const strictRegexWithBoundary = new RegExp(`\\b${escapedGameName}\\b`, 'i');

      const primaryMatches = websiteResults.filter(result => {
        const lowerCaseResultName = result.name.toLowerCase();
        const originalResultName = result.name; 

        // Condition 1: Exact full string match
        if (lowerCaseResultName === lowerCaseGameName) {
            return true;
        }

        // Condition 2: Whole word match with punctuation handling
        // Check for the word boundary match first
        if (strictRegexWithBoundary.test(originalResultName)) {
            const queryHasApostrophe = lowerCaseGameName.includes("'");
            const queryHasHyphen = lowerCaseGameName.includes("-");

            // Exclude if original result name contains the query followed by ' AND query does not have '
            if (!queryHasApostrophe && originalResultName.match(new RegExp(`${escapedGameName}'`, 'i'))) {
              return false; 
            }
            // Exclude if original result name contains the query preceded by - AND query does not have -
            if (!queryHasHyphen && originalResultName.match(new RegExp(`-${escapedGameName}`, 'i'))) {
              return false; 
            }
            // Exclude if original result name contains the query followed by - AND query does not have -
            if (!queryHasHyphen && originalResultName.match(new RegExp(String.raw`${escapedGameName}-`, 'i'))) {
                return false;
            }
            return true; 
        }
        return false; // No primary match
      });

      if (primaryMatches.length > 0) {
        filteredByWebsiteExactMatch.push(...primaryMatches);
      } else {
        // If no primary matches, try the secondary exact match logic (significant words)
        const secondaryMatches = websiteResults.filter(result => {
          const lowerCaseResultName = result.name.toLowerCase();
          const significantWordsResult = getSignificantWords(lowerCaseResultName);
          
          const isSecondaryExactMatch = significantWordsQuery.every(word => significantWordsResult.includes(word));
          return isSecondaryExactMatch;
        });

        if (secondaryMatches.length > 0) {
          filteredByWebsiteExactMatch.push(...secondaryMatches);
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
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('Puppeteer browser launched successfully.');
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
