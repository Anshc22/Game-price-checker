const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const pLimit = require('p-limit').default;

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

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
    'Fanatical': '/icons/fanatical.png',
    'K4G': '/icons/k4g.png',
    'GameSeal': '/icons/seal.png',
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
    const numericRegex = /^\d+$/; // Regex to match strings that are only digits.

    return text.toLowerCase()
               .split(/\s+/) // Split by one or more whitespace characters
               .filter(word => word.length > 0 && !stopWords.has(word) && !numericRegex.test(word));
}

// New function to filter games based on key region
function filterByKeyRegion(gameName) {
    const lowerCaseName = gameName.toLowerCase();

    // Keywords for allowed regions.
    // 'row' is Rest of World. 'ww' is WorldWide.
    const includeRegions = [
        'global', 'asia', 'india', 'row', 'rest of the world', 'worldwide', 'ww','in'
    ];

    // Expanded exclusion list.
    const excludeRegions = [
        // Continents & Major Regions
        'africa', 'europe', 'north america', 'south america', 'latam', 'latin america', 'oceania', 'cis', 'ru/cis',
        // Countries and Territories (full names only, no codes)
        'afghanistan', 'aland islands', 'albania', 'algeria', 'american samoa', 'andorra', 'angola', 'anguilla', 'antarctica',
        'antigua and barbuda', 'argentina', 'armenia', 'aruba', 'australia', 'austria', 'azerbaijan',
        'bahamas', 'bahrain', 'bangladesh', 'barbados', 'belarus', 'belgium', 'belize', 'benin', 'bermuda',
        'bhutan', 'bolivia', 'bonaire, sint eustatius and saba', 'bosnia and herzegovina', 'botswana', 'bouvet island', 'brazil',
        'british indian ocean territory', 'brunei darussalam', 'bulgaria', 'burkina faso', 'burundi', 'cabo verde', 'cambodia',
        'cameroon', 'canada', 'cayman islands', 'central african republic', 'chad', 'chile', 'china', 'christmas island',
        'cocos (keeling) islands', 'colombia', 'comoros', 'congo', 'congo (democratic republic of the)', 'cook islands', 'costa rica',
        'cote d\'ivoire', 'croatia', 'cuba', 'curacao', 'cyprus', 'czechia', 'denmark', 'djibouti', 'dominica',
        'dominican republic', 'ecuador', 'egypt', 'el salvador', 'equatorial guinea', 'eritrea', 'estonia', 'eswatini',
        'ethiopia', 'falkland islands (malvinas)', 'faroe islands', 'fiji', 'finland', 'france', 'french guiana',
        'french polynesia', 'french southern territories', 'gabon', 'gambia', 'georgia', 'germany', 'ghana', 'gibraltar',
        'greece', 'greenland', 'grenada', 'guadeloupe', 'guam', 'guatemala', 'guernsey', 'guinea', 'guinea-bissau',
        'guyana', 'haiti', 'heard island and mcdonald islands', 'holy see', 'honduras', 'hong kong', 'hungary', 'iceland',
        'indonesia', 'iran', 'iraq', 'ireland', 'isle of man', 'israel', 'italy', 'jamaica', 'japan', 'jersey',
        'jordan', 'kazakhstan', 'kenya', 'kiribati', 'korea (democratic people\'s republic of)', 'korea (republic of)', 'kuwait',
        'kyrgyzstan', 'lao people\'s democratic republic', 'latvia', 'lebanon', 'lesotho', 'liberia', 'libya', 'liechtenstein',
        'lithuania', 'luxembourg', 'macao', 'madagascar', 'malawi', 'malaysia', 'maldives', 'mali', 'malta',
        'marshall islands', 'martinique', 'mauritania', 'mauritius', 'mayotte', 'mexico', 'micronesia', 'moldova',
        'monaco', 'mongolia', 'montenegro', 'montserrat', 'morocco', 'mozambique', 'myanmar', 'namibia', 'nauru',
        'nepal', 'netherlands', 'new caledonia', 'new zealand', 'nicaragua', 'niger', 'nigeria', 'niue', 'norfolk island',
        'north macedonia', 'northern mariana islands', 'norway', 'oman', 'pakistan', 'palau', 'palestine, state of', 'panama',
        'papua new guinea', 'paraguay', 'peru', 'philippines', 'pitcairn', 'poland', 'portugal', 'puerto rico', 'qatar',
        'reunion', 'romania', 'russian federation', 'rwanda', 'saint barthelemy', 'saint helena, ascension and tristan da cunha',
        'saint kitts and nevis', 'saint lucia', 'saint martin (french part)', 'saint pierre and miquelon', 'saint vincent and the grenadines',
        'samoa', 'san marino', 'sao tome and principe', 'saudi arabia', 'senegal', 'serbia', 'seychelles', 'sierra leone',
        'singapore', 'sint maarten (dutch part)', 'slovakia', 'slovenia', 'solomon islands', 'somalia', 'south africa',
        'south georgia and the south sandwich islands', 'south sudan', 'spain', 'sri lanka', 'sudan', 'suriname', 'svalbard and jan mayen',
        'sweden', 'switzerland', 'syrian arab republic', 'taiwan', 'tajikistan', 'tanzania, united republic of', 'thailand', 'timor-leste',
        'togo', 'tokelau', 'tonga', 'trinidad and tobago', 'tunisia', 'turkey', 'turkmenistan', 'turks and caicos islands',
        'tuvalu', 'uganda', 'ukraine', 'united arab emirates', 'united kingdom', 'united states minor outlying islands',
        'united states', 'uruguay', 'uzbekistan', 'vanuatu', 'venezuela', 'viet nam', 'virgin islands (british)',
        'virgin islands (u.s.)', 'wallis and futuna', 'western sahara', 'yemen', 'zambia', 'zimbabwe', 'ean' // European Article Number, often for EU region
    ];

    // First, check for any exclusion keywords. If found, immediately exclude the game.
    for (const region of excludeRegions) {
        const regex = new RegExp(`\\b${region}\\b`);
        if (regex.test(lowerCaseName)) {
            return false; // Exclude this game.
        }
    }

    // Now, determine if a region was mentioned at all.
    const allKnownRegions = [...includeRegions, ...excludeRegions];
    let hasRegionMention = false;
    for (const region of allKnownRegions) {
        const regex = new RegExp(`\\b${region}\\b`);
        if (regex.test(lowerCaseName)) {
            hasRegionMention = true;
            break;
        }
    }

    // If no region is mentioned in the title, we should include it by default.
    if (!hasRegionMention) {
        return true;
    }

    // If a region *is* mentioned, it must be on our inclusion list to be shown.
    for (const region of includeRegions) {
        const regex = new RegExp(`\\b${region}\\b`);
        if (regex.test(lowerCaseName)) {
            return true; // Include this game.
        }
    }

    // If a region is mentioned but it is not in our approved list, we exclude it.
    // This handles cases like "Game (DE)" or "Game (FR)" that we don't want.
    return false;
}

app.get('/', (req, res) => {
  res.send('Hello from the backend!');
});

// Updated searchSteam function to extract all info from the search results page only
async function searchSteam(gameName, browser) {
  const results = [];
  let page;
  const start = Date.now();
  let error = null;
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
      let displayPriceText = '';
      
      if (priceText === '' || priceText.toLowerCase().includes('free')) {
        price = 0;
        displayPriceText = 'Free';
      } else {
        price = parseFloat(priceText.replace(/[^\d.,]/g, '').replace(',', ''));
        if (isNaN(price)) {
          price = 0;
          displayPriceText = 'Free';
        } else {
          displayPriceText = `₹${price.toLocaleString('en-IN')}`;
        }
      }
      
      let image = imgTags[i] ? $(imgTags[i]).attr('src') || '' : '';
      results.push({
        name,
        price,
        priceText: displayPriceText,
        website: 'Steam',
        link,
        icon: storeIcons['Steam'],
        image
      });
        }

    return results;
  } catch (err) {
    error = err;
    return [];
  } finally {
    if (page) await page.close();
    const duration = Date.now() - start;
    console.log(`[Steam] Entries: ${results.length}, Time: ${duration}ms${error ? ', Error: ' + error.message : ''}`);
  }
}

// Function to scrape Eneba using Puppeteer (FIXED PRICE EXTRACTION)
// Updated to accept and use the shared browser instance
async function searchEneba(gameName, browser) {
  let page;
  const results = [];
  const start = Date.now();
  let error = null;
  try {
    const searchUrl = `https://www.eneba.com/store?text=${encodeURIComponent(gameName)}`;
    console.log('Attempting to scrape Eneba from URL:', searchUrl);

    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 75000 });
    
    const noResultsDivText = await page.evaluate(() => {
      const element = document.querySelector('.UQRbf4');
        return element ? element.textContent.trim() : null;
    });
    if (noResultsDivText && noResultsDivText.includes('Sorry, we could not find any match to:')) {
        console.log(`Eneba: No results found for "${gameName}". Halting search.`);
        return [];
    }

    await page.waitForSelector('.GZjXOw, .AYvEf0', { timeout: 75000 });
    const html = await page.content();
    const $ = cheerio.load(html);

    const productInfo = [];
    $('.GZjXOw').each((i, el) => {
      const anchor = $(el);
      const name = anchor.attr('title') || '';
      const href = anchor.attr('href') || '';
      const link = href.startsWith('http') ? href : `https://www.eneba.com${href}`;
      const priceText = anchor.closest('.pFaGHa').find('.L5ErLT').text().trim();
      const price = normalizePrice(priceText);
      productInfo.push({ name, link, price });
    });

    const imageUrls = [];
    $('.AYvEf0').each((i, el) => {
      const imageContainer = $(el);
      const imgTag = imageContainer.find('img');
      imageUrls.push(imgTag.length ? imgTag.attr('src') || '' : '');
    });

    for (let i = 0; i < productInfo.length; i++) {
      if (productInfo[i] && imageUrls[i] !== undefined) {
        let displayPriceText = '';
        if (productInfo[i].price === 0 || productInfo[i].price === 'N/A') {
          displayPriceText = 'Free';
        } else {
          displayPriceText = `₹${productInfo[i].price.toLocaleString('en-IN')}`;
        }
        
        results.push({
          name: productInfo[i].name,
          price: productInfo[i].price,
          priceText: displayPriceText,
        website: 'Eneba',
          link: productInfo[i].link,
        icon: storeIcons['Eneba'],
          image: imageUrls[i]
        });
      }
    }
    
    return results;
  } catch (err) {
    error = err;
    return [];
  } finally {
    if (page) await page.close();
    const duration = Date.now() - start;
    console.log(`[Eneba] Entries: ${results.length}, Time: ${duration}ms${error ? ', Error: ' + error.message : ''}`);
  }
}

// Function to scrape CDKeys for game prices (new robust logic)
async function searchCDKeys(gameName, browser) {
  let page;
  const results = [];
  const start = Date.now();
  let error = null;
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
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds for dynamic content
    } catch (e) {
      
    }

    let html = await page.content();
    let $ = cheerio.load(html);

    // Collect lists for each field
    const nameDivs = $("div.flex-grow.flex.flex-col[itemprop='item'][data-name]").toArray();
    const priceSpans = $("span[itemprop='lowPrice'].after_special").toArray();
    const productCards = $("div.product.photo.product-item-photo.block.relative").toArray();
    const linkAs = $("div.product.photo.product-item-photo a").toArray();

    // console.log(`CDKeys: Found ${nameDivs.length} names, ${priceSpans.length} prices, ${linkAs.length} links, ${productCards.length} product cards.`);

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
        // console.log(`CDKeys: No results for full query, retrying with relaxed query: ${relaxedQuery}`);
        await page.goto(relaxedUrl, { waitUntil: 'domcontentloaded', timeout: 75000 });
        // Wait for results to render
        try {
          await page.waitForSelector('div.p-2.5.text-white.font-semibold.uppercase.min-h-[68px].product-item-link, div.product.photo.product-item-photo', { timeout: 3000 });
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds for dynamic content
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

    return results;
  } catch (err) {
    error = err;
    return [];
  } finally {
    if (page) {
      try { await page.close(); } catch (e) { /* ignore */ }
    }
    const duration = Date.now() - start;
    console.log(`[CDKeys] Entries: ${results.length}, Time: ${duration}ms${error ? ', Error: ' + error.message : ''}`);
  }
}

// Function to scrape Kinguin for game prices
// Updated to accept and use the shared browser instance
async function searchKinguin(gameName, browser) {
  let page;
  const results = []; // Moved declaration to function scope
  const start = Date.now();
  let error = null;
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
    
    return results;
  } catch (err) {
    error = err;
    return [];
  } finally {
    if (page) {
      try { await page.close(); } catch (e) { /* ignore */ }
    }
    const duration = Date.now() - start;
    console.log(`[Kinguin] Entries: ${results.length}, Time: ${duration}ms${error ? ', Error: ' + error.message : ''}`);
  }
}

// Function to scrape Epic Games Store for game prices
async function searchEpicGames(gameName, browser) {
  let page;
  const results = [];
  const start = Date.now();
  let error = null;
  try {
    // Use the provided URL format for Epic Games search
    const searchUrl = `https://store.epicgames.com/en-US/browse?q=${encodeURIComponent(gameName)}&sortBy=relevancy&sortDir=DESC&count=40`;
    console.log('Attempting to scrape Epic Games from URL:', searchUrl);

    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 75000 });

    const html = await page.content();
    // console.log('--- EPIC GAMES HTML START ---');
    // console.log(html.substring(0, 2000)); // Print the first 2000 characters for brevity
    // console.log('--- EPIC GAMES HTML END ---');
    const $ = cheerio.load(html);

    const linkAs = $('a.css-g3jcms').toArray();
    const imgTags = $('.css-uwwqev').toArray();
    imgTags.splice(0, 4);
    const productTypeSpans = $('span.css-1247nep span').toArray();
    productTypeSpans.splice(0, 1);

    const maxLen = linkAs.length;
    let gameNames = [];
    for (let i = 0; i < maxLen; i++) {
      if (productTypeSpans[i]) {
        const productType = $(productTypeSpans[i]).text().trim();
        if (productType.toLowerCase() === 'add-on') {
          continue;
        }
      }
      const linkElement = linkAs[i];
      const ariaLabel = $(linkElement).attr('aria-label') || '';
      const parts = ariaLabel.split(',');
      if (parts.length < 3) continue;
      const name = parts[2].trim();
      gameNames.push(name);
      let price = 0;
      let hasPrice = false;
      if (linkElement) {
        const rupeeIndex = ariaLabel.indexOf('₹');
        if (rupeeIndex !== -1) {
          const priceText = ariaLabel.substring(rupeeIndex + 1).trim();
          const cleanedPrice = priceText.replace(/,/g, '');
          price = parseFloat(cleanedPrice);
          if (!isNaN(price)) {
            hasPrice = true;
      } else {
            price = 0;
          }
        } else if (ariaLabel.toLowerCase().includes('free')) {
          price = 0;
          hasPrice = true;
        }
      }
      if (!hasPrice) {
        continue;
      }
      let link = linkElement ? $(linkElement).attr('href') : '';
      if (link && !link.startsWith('http')) {
        link = `https://store.epicgames.com${link}`;
      }
      let image = '';
      const imageContainer = imgTags[i * 2];
      if (imageContainer) {
        const nestedImg = $(imageContainer).find('img').first();
        if (nestedImg.length) {
          image = nestedImg.attr('data-image');
        }
      }
      results.push({
        name,
        price,
        website: 'Epic Games',
        link,
        icon: storeIcons['Epic Games'],
        image,
        eaPlay: false // default, will update below
      });
    }

    // --- EA Play check ---
    // Use the EA Play filter URL
    const eaPlayUrl = `https://store.epicgames.com/en-US/browse?q=${encodeURIComponent(gameName)}&sortBy=relevancy&sortDir=DESC&tag=EA%20Play&count=40&start=0`;
    let eaPlayPage;
    try {
      eaPlayPage = await browser.newPage();
      await eaPlayPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      await eaPlayPage.goto(eaPlayUrl, { waitUntil: 'domcontentloaded', timeout: 75000 });
      const eaHtml = await eaPlayPage.content();
      const $ea = cheerio.load(eaHtml);
      const eaLinks = $ea('a.css-g3jcms').toArray();
      const eaNames = eaLinks.map(link => {
        const ariaLabel = $ea(link).attr('aria-label') || '';
        const parts = ariaLabel.split(',');
        if (parts.length < 3) return null;
        return parts[2].trim();
      }).filter(Boolean);
      // Mark results as EA Play if their name matches
      for (const result of results) {
        if (eaNames.includes(result.name)) {
          result.eaPlay = true;
        }
      }
    } catch (e) {
      console.error('Error checking EA Play for Epic Games:', e.message);
    } finally {
      if (eaPlayPage) {
        try { await eaPlayPage.close(); } catch (e) { /* ignore */ }
    }
    }
    // --- END EA Play check ---

    return results;
  } catch (err) {
    error = err;
    return [];
  } finally {
    if (page) {
      try { await page.close(); } catch (e) { /* ignore */ }
    }
    const duration = Date.now() - start;
    console.log(`[Epic Games] Entries: ${results.length}, Time: ${duration}ms${error ? ', Error: ' + error.message : ''}`);
  }
}

// Updated searchGOG function to accept and use the shared browser instance
async function searchGOG(gameName, browser) {
  let page;
  const results = [];
  const start = Date.now();
  let error = null;
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

    return results;
  } catch (err) {
    error = err;
    return [];
  } finally {
    if (page) {
      try { await page.close(); } catch (e) { /* ignore */ }
    }
    const duration = Date.now() - start;
    console.log(`[GOG] Entries: ${results.length}, Time: ${duration}ms${error ? ', Error: ' + error.message : ''}`);
  }
}

// Function to scrape Xbox PC Game Pass from the search page only
async function searchXboxGamePass(gameName, browser) {
  let page;
  const results = [];
  const start = Date.now();
  let error = null;
  try {
    // Use the correct Xbox search URL format (India)
    const searchUrl = `https://www.xbox.com/en-in/search/results/games?q=${encodeURIComponent(gameName)}&IncludedInSubscription=CFQ7TTC0KGQ8`;
    console.log('Attempting to search Xbox PC Game Pass from URL:', searchUrl);

    page = await browser.newPage(); // Use the shared browser instance
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-in,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 75000 });
    // Wait for the results to appear (up to 15 seconds)
    try {
      await page.waitForSelector('a.commonStyles-module__basicButton___go-bX', { timeout: 15000 });
    } catch (e) {
      // console.log('Xbox GP: No result selector found after waiting.');
    }

    let html = await page.content();
    let $ = cheerio.load(html);

    // Find all anchor tags with the specified class
    const linkAnchors = $('a.commonStyles-module__basicButton___go-bX').toArray();
    const imgTags = $('img.ProductCard-module__boxArt___-2vQY').toArray();

    for (let i = 0; i < linkAnchors.length; i++) {
      const anchor = $(linkAnchors[i]);
      
      // Extract name from title attribute
      const name = anchor.attr('title') || '';
      
      // Extract href
      let link = anchor.attr('href') || '';
      if (link && !link.startsWith('http')) {
        link = `https://www.xbox.com${link}`;
      }
      
      // Extract price from aria-label
      const ariaLabel = anchor.attr('aria-label') || '';
      let price = 0;
      let priceText = '';
      
      if (ariaLabel.includes('$')) {
        // Find the last $ sign and extract the price after it
        const lastDollarIndex = ariaLabel.lastIndexOf('$');
        if (lastDollarIndex !== -1) {
          const priceAfterDollar = ariaLabel.substring(lastDollarIndex + 1);
          // Extract the numeric part
          const priceMatch = priceAfterDollar.match(/[\d,]+\.?\d*/);
          if (priceMatch) {
            const usd = parseFloat(priceMatch[0].replace(/,/g, ''));
        if (!isNaN(usd)) {
          price = Math.round(usd * USD_TO_INR_RATE);
              priceText = `₹${price}`;
            }
          }
      }
      } else {
        // No $ sign found, mark as "Game Pass only"
        price = -1; // Special value for sorting
        priceText = 'Game Pass only';
      }
      
      // Image extraction (robust extraction like before)
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
        let parentStyle = anchor.parent().attr('style') || '';
        let parentBgMatch = parentStyle.match(/background-image:\s*url\(['"]?(.*?)['"]?\)/i);
        if (parentBgMatch && parentBgMatch[1] && !parentBgMatch[1].startsWith('data:')) {
          image = parentBgMatch[1];
        }
      }
      if (image && !image.startsWith('http')) {
        image = `https://www.xbox.com${image}`;
      }
      
      // Only push if at least a name or link is present
      if (name || link) {
        results.push({
        name,
          price,
          priceText, // Add priceText for display
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
      // console.log('Xbox GP: No results found. Main HTML snippet:', mainHtml.substring(0, 2000));
    }
    
    return results;
  } catch (err) {
    error = err;
    return [];
  } finally {
    if (page) {
      try { await page.close(); } catch (e) { /* ignore */ }
    }
    const duration = Date.now() - start;
    console.log(`[Xbox Game Pass] Entries: ${results.length}, Time: ${duration}ms${error ? ', Error: ' + error.message : ''}`);
  }
}

// Function to scrape Xbox India store and check Game Pass status
async function searchXboxIndia(gameName, browser) {
  let page;
  const results = [];
  const start = Date.now();
  let error = null;
  try {
    // 1. Main search (Indian store)
    const searchUrl = `https://www.xbox.com/en-in/Search/Results?q=${encodeURIComponent(gameName)}`;
    console.log('Attempting to search Xbox India from URL:', searchUrl);

    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-IN,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 75000 });
    await page.waitForSelector('a.commonStyles-module__basicButton___go-bX', { timeout: 15000 });
    let html = await page.content();
    let $ = cheerio.load(html);
    const linkAnchors = $('a.commonStyles-module__basicButton___go-bX').toArray();
    const imgTags = $('img.ProductCard-module__boxArt___-2vQY').toArray();
    
    // Extract all games from main search
    let mainGames = [];
    console.log(`[XboxIndia] Found ${linkAnchors.length} game anchors for query: ${gameName}`);
    for (let i = 0; i < linkAnchors.length; i++) {
      const anchor = $(linkAnchors[i]);
      const name = anchor.attr('title') || '';
      let link = anchor.attr('href') || '';
      if (link && !link.startsWith('http')) {
        link = `https://www.xbox.com${link}`;
      }
      
      const ariaLabel = anchor.attr('aria-label') || '';
      let price = 0;
      let priceText = '';
      if (ariaLabel.includes('₹')) {
        const lastRupeeIndex = ariaLabel.lastIndexOf('₹');
        if (lastRupeeIndex !== -1) {
          const priceAfterRupee = ariaLabel.substring(lastRupeeIndex + 1);
          const priceMatch = priceAfterRupee.match(/[\d,]+\.?\d*/);
          if (priceMatch) {
            price = parseFloat(priceMatch[0].replace(/,/g, ''));
            if (!isNaN(price)) {
              priceText = `₹${price}`;
            }
          }
        }
        } else {
        price = -1;
        priceText = 'Game Pass only';
      }
      
      // console.log(`[XboxIndia] Game: '${name}', aria-label: '${ariaLabel}', price: ${price}`);
      
      let image = '';
      if (imgTags[i]) {
        let src = $(imgTags[i]).attr('src');
        let dataSrc = $(imgTags[i]).attr('data-src');
        let dataImage = $(imgTags[i]).attr('data-image');
        let srcset = $(imgTags[i]).attr('srcset');
        if (dataImage && !dataImage.startsWith('data:') && dataImage.trim() !== '') { image = dataImage; } 
        else if (dataSrc && !dataSrc.startsWith('data:') && dataSrc.trim() !== '') { image = dataSrc; }
        else if (src && !src.startsWith('data:') && src.trim() !== '') { image = src; }
        else if (srcset && srcset.trim() !== '') { image = srcset.split(',').pop().split(' ')[0].trim(); }
        let style = $(imgTags[i]).attr('style') || '';
          let bgMatch = style.match(/background-image:\s*url\(['"]?(.*?)['"]?\)/i);
        if (bgMatch && bgMatch[1] && !bgMatch[1].startsWith('data:')) { image = bgMatch[1]; }
          }
      if (!image) {
        let parentStyle = anchor.parent().attr('style') || '';
        let parentBgMatch = parentStyle.match(/background-image:\s*url\(['"]?(.*?)['"]?\)/i);
        if (parentBgMatch && parentBgMatch[1] && !parentBgMatch[1].startsWith('data:')) { image = parentBgMatch[1]; }
      }
      if (image && !image.startsWith('http')) { image = `https://www.xbox.com${image}`; }
      
      mainGames.push({ name, price, priceText, link, image });
      }
    await page.close();

    // 2. Game Pass search (Indian Game Pass) - Wrapped in its own try/catch to be non-fatal
    const gamePassTitles = new Set();
    try {
      const gamePassUrl = `https://www.xbox.com/en-IN/search/results/games?q=${encodeURIComponent(gameName)}&IncludedInSubscription=CFQ7TTC0KGQ8`;
      page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-IN,en;q=0.9', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8' });
      await page.goto(gamePassUrl, { waitUntil: 'domcontentloaded', timeout: 75000 });
      await page.waitForSelector('a.commonStyles-module__basicButton___go-bX', { timeout: 10000 });
      html = await page.content();
      $ = cheerio.load(html);
      $('a.commonStyles-module__basicButton___go-bX').each((i, el) => {
        const title = $(el).attr('title') || '';
        gamePassTitles.add(title.trim().toLowerCase());
      });
    } catch (gpError) {
      console.warn(`[XboxIndia] Game Pass check failed or found no results (this is expected for non-GP games).`);
    } finally {
        if (page) { try { await page.close(); } catch(e) {/*ignore*/} }
    }

    // 3. Merge info
    for (const game of mainGames) {
      const isGamePass = gamePassTitles.has(game.name.trim().toLowerCase());
        results.push({
        name: game.name,
        price: game.price,
        priceText: game.priceText,
        website: 'Xbox India',
        link: game.link,
        icon: storeIcons['Xbox Game Pass'],
        image: game.image,
        gamePass: isGamePass
      });
    }
    return results;

  } catch (err) {
    error = err;
    return [];
  } finally {
    if (page && !page.isClosed()) {
      try { await page.close(); } catch (e) { /* ignore */ }
    }
    const duration = Date.now() - start;
    console.log(`[Xbox India] Entries: ${results.length}, Time: ${duration}ms${error ? ', Error: ' + error.message : ''}`);
  }
}

// Function to scrape thegamekeys.in for game prices
async function searchTheGameKeys(gameName, browser) {
  let page;
  const results = [];
  const start = Date.now();
  let error = null;
  try {
    const searchUrl = `https://thegamekeys.in/?s=${encodeURIComponent(gameName)}&post_type=product`;
    page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Referer': 'https://thegamekeys.in/'
    });
    await new Promise(resolve => setTimeout(resolve, 100 + Math.floor(Math.random() * 300)));
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait longer for dynamic content

    const html = await page.content();
    const $ = cheerio.load(html);

    // Select each product card
    $('.product-small.col.has-hover.product').each((i, card) => {
      const colInner = $(card).find('.col-inner');
      const imageFade = colInner.find('.image-fade_in_back');
      const a = imageFade.find('a[aria-label]');
      const img = a.find('img');
      const name = a.attr('aria-label') || img.attr('alt') || '';
      const link = a.attr('href') || '';
      const image = img.attr('src') || '';
      // Price: try to get the <ins> price, fallback to <bdi> directly
      let price = null;
      let priceText = '';
      const priceBdi = colInner.find('.price-wrapper ins .amount bdi').first().text() ||
                       colInner.find('.price-wrapper .amount bdi').first().text();
      if (priceBdi) {
        price = parseFloat(priceBdi.replace(/[^\d.]/g, ''));
        priceText = `₹${price}`;
      }
      if (name && link && image && price !== null) {
        results.push({
          name,
          price,
          priceText,
          website: 'TheGameKeys',
          link,
          icon: '/icons/gamekeys.png',
          image
        });
      }
    });
    return results;
  } catch (err) {
    error = err;
    return [];
  } finally {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
    const duration = Date.now() - start;
    console.log(`[TheGameKeys] Entries: ${results.length}, Time: ${duration}ms${error ? ', Error: ' + error.message : ''}`);
  }
}

const FANATICAL_TO_INR = 83; // Use the same USD to INR rate as GOG for now

async function searchFanatical(gameName, browser) {
  let page;
  const results = [];
  const start = Date.now();
  let error = null;
  try {
    const searchUrl = `https://www.fanatical.com/en/search?search=${encodeURIComponent(gameName)}`;
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Referer': 'https://www.fanatical.com/'
    });
    await new Promise(resolve => setTimeout(resolve, 100 + Math.floor(Math.random() * 300)));
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 2000));
    const html = await page.content();
    const $ = cheerio.load(html);
    $('.HitCard__main').each((i, card) => {
      const a = $(card).find('a.HitCard__main__cover');
      const img = a.find('img');
      const title = $(card).find('.hitCardStripe__seoName').text().trim() || img.attr('alt') || '';
      let link = a.attr('href') || '';
      if (link && !link.startsWith('http')) link = `https://www.fanatical.com${link}`;
      let image = img.attr('src') || '';
      if (!image && img.attr('srcset')) {
        // Use the largest image in srcset
        const srcset = img.attr('srcset').split(',').map(s => s.trim().split(' ')[0]);
        image = srcset[0] || '';
      }
      // Price: get the .card-price (current price)
      let priceText = $(card).find('.card-price').first().text().trim();
      let price = null;
      if (priceText) {
        // Remove $ and commas, parse as float
        const usd = parseFloat(priceText.replace(/[^\d.]/g, ''));
        if (!isNaN(usd)) {
          price = Math.round(usd * FANATICAL_TO_INR);
          priceText = `₹${price}`;
        } else {
          price = null;
        }
      }
      if (title && link && image && price !== null) {
        results.push({
          name: title.trim(),
          price,
          priceText,
          website: 'Fanatical',
          link,
          icon: '/icons/Fanatical.png',
          image
        });
      }
    });
    return results;
  } catch (err) {
    error = err;
    return [];
  } finally {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
    const duration = Date.now() - start;
    console.log(`[Fanatical] Entries: ${results.length}, Time: ${duration}ms${error ? ', Error: ' + error.message : ''}`);
  }
}

// Comment out K4G in storeIcons
// storeIcons['K4G'] = '/icons/k4g.png';

// Comment out K4G in /search endpoint
// if (selectedStores.includes('All') || selectedStores.includes('K4G')) {
//   searchPromises.push(searchK4G(gameName, browserInstance));
// }

// Updated app.get('/search') endpoint
app.get('/search', async (req, res) => {
  console.clear();
  const { gameName } = req.query;
  const storesParam = req.query.stores;
  const selectedStores = storesParam ? storesParam.split(',') : ['All'];

  if (!gameName) {
    return res.status(400).json({ error: 'Game name is required' });
  }

  

    const searchPromises = [];
    if (selectedStores.includes('All') || selectedStores.includes('Steam')) {
      searchPromises.push(searchSteam(gameName, browserInstance));
    }
    if (selectedStores.includes('All') || selectedStores.includes('Eneba')) {
      searchPromises.push(searchEneba(gameName, browserInstance));
    }
    if (selectedStores.includes('All') || selectedStores.includes('CDKeys')) {
      searchPromises.push(searchCDKeys(gameName, browserInstance));
    }
    if (selectedStores.includes('All') || selectedStores.includes('Kinguin')) {
      searchPromises.push(searchKinguin(gameName, browserInstance));
    }
    if (selectedStores.includes('All') || selectedStores.includes('Epic Games')) {
      searchPromises.push(searchEpicGames(gameName, browserInstance));
    }
    if (selectedStores.includes('All') || selectedStores.includes('GOG')) {
      searchPromises.push(searchGOG(gameName, browserInstance));
    }
    if (selectedStores.includes('All') || selectedStores.includes('Xbox Game Pass') || selectedStores.includes('Xbox India')) {
      searchPromises.push(searchXboxIndia(gameName, browserInstance));
    }
    if (selectedStores.includes('All') || selectedStores.includes('TheGameKeys')) {
      searchPromises.push(searchTheGameKeys(gameName, browserInstance));
    }
    if (selectedStores.includes('All') || selectedStores.includes('Fanatical')) {
      searchPromises.push(searchFanatical(gameName, browserInstance));
    }
    // if (selectedStores.includes('All') || selectedStores.includes('GameSeal')) {
    //   searchPromises.push(searchGameSeal(gameName, browserInstance));
    // }

    const allResultsArrays = await Promise.all(searchPromises);
    let allResults = allResultsArrays.flat();

    // --- FILTERING STAGE 1: Excluded Content (DLC, etc.) ---
    const lowerCaseGameName = gameName.toLowerCase();
    const exclusionKeywords = ['dlc', 'soundtrack', 'costume', 'pack', 'artbook', 'expansion'];
    const userWantsExcludedContent = exclusionKeywords.some(keyword => lowerCaseGameName.includes(keyword));

    let filteredResults = userWantsExcludedContent ? allResults : allResults.filter(result => {
        const lowerCaseResultName = (result && result.name ? result.name.toLowerCase() : '');
        return !exclusionKeywords.some(keyword => lowerCaseResultName.includes(keyword));
      });

    // --- FILTERING STAGE 2: Exact Match ---
    const significantWordsQuery = getSignificantWords(lowerCaseGameName);
      const escapedGameName = lowerCaseGameName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const strictRegex = new RegExp(`\\b${escapedGameName}\\b`, 'i');

    const primaryMatches = filteredResults.filter(result => {
        const lowerCaseResultName = (result && result.name ? result.name.toLowerCase() : '');
        if (lowerCaseResultName === lowerCaseGameName) return true;
        if (strictRegex.test(lowerCaseResultName)) {
            // Additional checks for punctuation to avoid matching 'game' with 'game-of-the-year'
            const queryHasApostrophe = lowerCaseGameName.includes("'");
            const queryHasHyphen = lowerCaseGameName.includes("-");
            if (!queryHasApostrophe && result.name.match(new RegExp(`${escapedGameName}'`, 'i'))) return false;
            if (!queryHasHyphen && result.name.match(new RegExp(`-${escapedGameName}`, 'i'))) return false;
            if (!queryHasHyphen && result.name.match(new RegExp(`${escapedGameName}-`, 'i'))) return false;
            return true; 
        }
        return false;
      });

    let matchedResults;
      if (primaryMatches.length > 0) {
        matchedResults = primaryMatches;
      } else {
        // No primary matches found, proceed to secondary matching
        matchedResults = filteredResults.filter(result => {
            const significantWordsResult = getSignificantWords(
                result && result.name ? result.name.toLowerCase() : ''
            );
            return significantWordsQuery.every(queryWord => significantWordsResult.includes(queryWord));
        });
    }
    
    // --- FILTERING STAGE 3: Key Region ---
    const finalResults = matchedResults.filter(result => filterByKeyRegion(result.name));

    try {
      res.json(finalResults);
    } catch (error) {
      console.error('Error during combined search:', error);
      res.status(500).json({ error: 'Failed to fetch game prices' });
        }
}); // <-- This closes the /search endpoint

app.get('/youtube-videos', async (req, res) => {
    const gameName = req.query.q;
    if (!gameName) {
        return res.status(400).send('Game name query parameter is required.');
    }

    const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(gameName)}+gameplay+review`;

    try {
        const { data } = await axios.get(youtubeUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });

        const scriptRegex = /var ytInitialData = (.*?);<\/script>/;
        const match = data.match(scriptRegex);

        if (match && match[1]) {
            console.log('--- YOUTUBE DEBUG: Successfully found ytInitialData script tag. ---');
            const ytInitialData = JSON.parse(match[1]);
            const videoRenderers = findVideoRenderers(ytInitialData);

            console.log(`--- YOUTUBE DEBUG: Found ${videoRenderers.length} video renderers. ---`);

            if (videoRenderers.length > 0) {
                const videos = videoRenderers.slice(0, 5).map(video => ({
                    videoId: video.videoId,
                    title: video.title.runs[0].text,
                    thumbnail: video.thumbnail.thumbnails[0].url,
                    viewCount: video.viewCountText?.simpleText || 'N/A',
                    publishedTime: video.publishedTimeText?.simpleText || 'N/A'
                }));
                // After collecting all video results, sort by viewCount descending
                videos.sort((a, b) => {
                  // Remove commas and parse as integer
                  const viewsA = parseInt((a.viewCount || '0').replace(/,/g, ''));
                  const viewsB = parseInt((b.viewCount || '0').replace(/,/g, ''));
                  return viewsB - viewsA;
                });
                res.json(videos);
            } else {
                console.log('--- YOUTUBE DEBUG: No video renderers found in the data structure. ---');
                res.json([]);
            }
        } else {
            console.error("--- YOUTUBE DEBUG: Could not find ytInitialData in YouTube response body. ---");
            res.status(500).send('Failed to parse YouTube search results.');
        }
  } catch (error) {
        console.error('--- YOUTUBE SCRAPER ERROR ---');
        console.error(`Error scraping YouTube for query: "${gameName}"`);
        console.error(error);
        res.status(500).send('Error scraping YouTube data.');
  }
});


// Start the server and launch the Puppeteer browser
app.listen(PORT, async () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  try {
    browserInstance = await puppeteer.launch({ headless: true });
    if (!browserInstance) throw new Error('Puppeteer launch returned null');
    const page = await browserInstance.newPage();
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await page.close();
    console.log('Puppeteer browser launched with stealth mode');
  } catch (err) {
    browserInstance = null;
    console.error('Failed to launch Puppeteer browser:', err);
  }
});

// Add a middleware to check browserInstance before search endpoints
app.use((req, res, next) => {
  if ((req.path === '/search' || req.path === '/search/') && !browserInstance) {
    return res.status(500).json({ error: 'Puppeteer browser is not available. Please check server logs.' });
  }
  next();
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

// Export functions for testing
module.exports = {
  filterByKeyRegion
};

const findVideoRenderers = (obj) => {
    let results = [];
    const recurse = (currentObj) => {
        if (currentObj && typeof currentObj === 'object') {
            if (currentObj.videoRenderer) {
                results.push(currentObj.videoRenderer);
            }
            for (const key in currentObj) {
                if (Object.prototype.hasOwnProperty.call(currentObj, key)) {
                    recurse(currentObj[key]);
                }
            }
        }
    };
    recurse(obj);
    return results;
};

const GAMESEAL_TO_INR = 90; // Example conversion rate, update as needed

// --- GameSeal Cookie Injection ---
// To bypass Cloudflare, paste your cookies from your browser below in this array.
// Example: [{ name: 'cf_clearance', value: '...', domain: '.gameseal.com', path: '/', httpOnly: true, secure: true }]
const GAMESEAL_COOKIES = [
  {
    name: 'session',
    value: 'ibmla969dppuchaqhfngu6tvf4uufpakk5atinugnn09a184nn6dvdpf4p9mnk78b6lamu090kmm46tq5acflcpgdfuiarbif1egq5m836mn5fcangott6047nk8recn',
    domain: '.gameseal.com',
    path: '/',
    httpOnly: true,
    secure: true
  },
  {
    name: 'cf_clearance',
    value: 'JZGcBJ_OgxQ2N7xwIEReOGpOdG2aL4HUDvO.8_19yt8-1750595794-1.2.1.1-oDatja1uXZxPsIQM2np_HJSVf.X4zJGHu9oc20bFnitOh9Fx_.hvFQP83N1Zup1q0TUCDJk0D8u6ooA9MePPHi6L_2KKhWOsufBDdT8hg_c4ce8t4CyB7McKk0nPQDETC7aq.6ijkeT81UWfsqFE2g5.PaJWSR1hp2MfAyhrgD285v3BbV0EtCM9Nt1XoR13y_YIXm04uTcp6vAB05F_xiquLDOTMziPtiCSIvbsacUGiXuSuY90zLxQdW85fYNbnC_0WGaZGzKJApfbNUoS8Qm.ybdGDSlpgFjUolMGcFZNUsDoGpEy5GXs7KZDAFBIRFq0BsVvnn_BIK0YyXdf3l8Iqe8YAH3Vzv0fmubIDjLpYBbtS0hfjNNiP7JStUCE',
    domain: '.gameseal.com',
    path: '/',
    httpOnly: true,
    secure: true
  },
  {
    name: '__cflb',
    value: '0H28vmmQFramB3q2rmWtVbBR9cYtXRAhwGBUGD9rbCB',
    domain: '.gameseal.com',
    path: '/',
    httpOnly: true,
    secure: true
  }
];

async function searchGameSeal(gameName, browser) {
  let page;
  const results = [];
  const start = Date.now();
  let error = null;
  try {
    console.log('searchGameSeal called for:', gameName);
    const searchUrl = `https://gameseal.com/search?search=${encodeURIComponent(gameName)}`;
    page = await browser.newPage();
    // Use the same user-agent and headers as Fanatical
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Referer': 'https://gameseal.com/'
    });
    // Inject cookies if provided
    if (GAMESEAL_COOKIES.length > 0) {
      await page.setCookie(...GAMESEAL_COOKIES);
      console.log('Injected GameSeal cookies');
    }
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(resolve => setTimeout(resolve, 5000));
    let found = false;
    try {
      await page.waitForSelector('.card.product-box', { timeout: 5000 });
      found = true;
    } catch (e) {
      try {
        await page.waitForSelector('.product-box', { timeout: 5000 });
        found = true;
      } catch (e2) {
        found = false;
      }
    }
    const html = await page.content();
    // console.log('--- GAMESEAL HTML RESPONSE START ---');
    console.log(html.substring(0, 2000));
    // console.log('--- GAMESEAL HTML RESPONSE END ---');
    if (!found) {
      console.warn('No product card selector found for GameSeal.');
      await page.close();
      return { store: 'GameSeal', results: [], time: Date.now() - start, error: 'No product card selector found' };
    }
    const $ = cheerio.load(html);
    $('.card.product-box, .product-box').each((i, el) => {
      const card = $(el);
      const link = card.find('a.product-image-link').attr('href') || card.find('a.product-name').attr('href');
      const href = link && !link.startsWith('http') ? `https://gameseal.com${link}` : link;
      const img = card.find('a.product-image-link img').attr('src') || card.find('img.product-image').attr('src');
      const title = card.find('a.product-name').attr('title') || card.find('a.product-image-link').attr('title') || card.find('img.product-image').attr('alt') || '';
      let priceText = card.find('.product-price-info .product-price-regular').first().text().replace(/[^\d.,]/g, '');
      if (!priceText) {
        priceText = card.find('.product-price-info .product-price-list').first().text().replace(/[^\d.,]/g, '');
      }
      let price = parseFloat(priceText.replace(',', '.'));
      if (!isNaN(price)) price = Math.round(price * GAMESEAL_TO_INR);
      else price = null;
      if (href && img && title && price !== null) {
        results.push({
          name: title.trim(),
          href,
          img,
          price,
          store: 'GameSeal',
          icon: '/icons/seal.png',
        });
      }
    });
    await page.close();
  } catch (err) {
    console.error('GameSeal error:', err);
    error = err.message || String(err);
    if (page) await page.close();
  }
  return { store: 'GameSeal', results, time: Date.now() - start, error };
}
