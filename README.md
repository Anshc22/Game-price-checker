# Game Price Aggregator Web App

## Overview

This project is a full-stack web application that allows users to search and compare game prices across multiple online stores, including Steam, Epic Games, GOG, CDKeys, Xbox (India), Eneba, Kinguin, and more. The app features a modern, responsive frontend and a robust Node.js backend that scrapes live prices using Puppeteer and Cheerio.

---
## Sample

![image](https://github.com/user-attachments/assets/fd88b865-cfec-4c20-838e-50278488382b)

## Features

- **Search for any game** and instantly compare prices across supported stores.
- **Store filters**: Select which stores to include in your search.
- **Paginated, sortable results table**: Sort by game name, store, or price. Table auto-sorts by price ascending after every search or filter change.
- **Game images and store icons**: Visual results with large, clear images and store branding. Xbox and Epic Games use custom icons from the `/icons` folder.
- **Direct links**: Click to go directly to the game's page on the store.
- **Responsive UI**: Works well on desktop and mobile.
- **YouTube Reviews**: Shows a sidebar of YouTube review videos for the searched game, sorted by view count (descending). Only review videos are shown ("review" is appended to the search query).
- **Subscription Badges**: 
  - Shows a Game Pass icon next to the game name if available on Xbox Game Pass (India).
  - Shows an EA Play icon next to the game name if available on EA Play via Epic Games.
- **Region Filtering**: Only shows results for India or global/ROW/Asia regions. All other country/region-locked results are excluded using a comprehensive exclusion list (now without 2-letter codes).
- **Special Price Handling**:
  - Steam games with price 0 are shown as "Free" and sorted to the top.
  - Xbox games with price -1 (Game Pass only) are hidden from the table.
- **Audio Feedback**: Plays a short success sound when a search completes.
- **Error Handling**: Graceful handling of scraping errors, search stops, and backend issues.

---

## Supported Stores

- Steam
- Epic Games Store (with EA Play detection)
- GOG.com
- CDKeys
- Xbox (India, with Game Pass detection)
- Eneba
- Kinguin

> **Note:** G2A support was attempted but is currently disabled due to anti-bot protections.

---

## Technologies Used

- **Frontend:** HTML, CSS, JavaScript (vanilla)
- **Backend:** Node.js, Express.js
- **Scraping:** Puppeteer (headless Chrome), Cheerio

---

## How to Run

1. **Install dependencies:**
   ```sh
   npm install
   cd 'Check Game Price/server'
   npm install
   ```

2. **Start the backend:**
   ```sh
   cd 'Check Game Price/server'
   node src/index.js
   ```

3. **Open the frontend:**
   - Open `Check Game Price/client/index.html` in your browser.

---

## Restrictions & Known Issues

- **Region Filtering:** Only India/global/ROW/Asia results are shown. All other country/region-locked results are excluded.
- **G2A is disabled** due to anti-bot protections.
- **Epic Games/Eneba**: May be rate-limited or blocked by bot protection after repeated searches.
- **YouTube API**: Uses scraping, not the official API, and may break if YouTube changes its structure.
- **Xbox India**: Only Indian store is supported; US/other regions are not scraped.
- **Game Pass/EA Play**: Detection is best-effort and may miss some titles if store search changes.
- **PowerShell**: Use `;` instead of `&&` to chain commands in Windows PowerShell.

---

## Troubleshooting

- If you encounter issues with scraping (e.g., missing results, access denied), some stores may have updated their anti-bot protections.
- G2A is currently disabled due to such issues.
- For Git errors (e.g., file lock issues), ensure no other programs are using the repo and try running your terminal as administrator.
- If you see `Search stopped` or empty results, check backend logs for scraping errors or region filtering exclusions.

---

## License

This project is for educational and personal use. Please respect the terms of service of the stores you scrape.
