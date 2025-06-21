# Game Price Aggregator Web App

## Overview

This project is a full-stack web application that allows users to search and compare game prices across multiple online stores, including Steam, Epic Games, GOG, CDKeys, Xbox Game Pass, and more. The app features a modern, responsive frontend and a robust Node.js backend that scrapes live prices using Puppeteer and Cheerio.

---
## Sample

![image](https://github.com/user-attachments/assets/fd88b865-cfec-4c20-838e-50278488382b)


## Features

- **Search for any game** and instantly compare prices across supported stores.
- **Store filters**: Select which stores to include in your search.
- **Paginated, sortable results table**: Sort by game name, store, or price.
- **Game images and store icons**: Visual results with large, clear images and store branding.
- **Direct links**: Click to go directly to the game's page on the store.
- **Responsive UI**: Works well on desktop and mobile.
- **Youtube Reviews** - Shows reviews on side
- **Subscriptions** - Shows if available on Games Pass or Ea Play


---

## Supported Stores

- Steam
- Epic Games Store
- GOG.com
- CDKeys
- Xbox Game Pass
- Eneba
- Kinguin

> **Note:** G2A support was attempted but is currently disabled due to anti-bot protections.

---

## Technologies Used

- **Frontend:** HTML, CSS, JavaScript (vanilla)
- **Backend:** Node.js, Express.js
- **Scraping:** Puppeteer (headless Chrome), Cheerio
- **Other:** Excel parsing (for movie catalog), Python (for IMDB heatmap), and more

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

## Troubleshooting

- If you encounter issues with scraping (e.g., missing results, access denied), some stores may have updated their anti-bot protections.
- G2A is currently disabled due to such issues.
- For Git errors (e.g., file lock issues), ensure no other programs are using the repo and try running your terminal as administrator.

---



## License

This project is for educational and personal use. Please respect the terms of service of the stores you scrape. 
