console.log('Script loaded successfully!');

document.addEventListener('DOMContentLoaded', () => {
    console.log('Game Price Checker script loaded!');

    const gameNameInput = document.getElementById('gameNameInput');
    const searchButton = document.getElementById('searchButton');
    const priceTableBody = document.querySelector('#priceTable tbody');
    const loadingDiv = document.getElementById('loading');
    const noResultsP = document.getElementById('noResults');
    const tableHeaders = document.querySelectorAll('#priceTable th[data-sort-by]');

    // New button elements
    const stopSearchButton = document.getElementById('stopSearchButton'); // Reference to Stop Search Button

    // Pagination elements
    const paginationControls = document.getElementById('pagination-controls');
    const prevPageButton = document.getElementById('prevPage');
    const nextPageButton = document.getElementById('nextPage');
    const pageInfoSpan = document.getElementById('pageInfo');
    // New bottom controls
    const paginationControlsBottom = document.getElementById('pagination-controls-bottom');
    const prevPageButtonBottom = document.getElementById('prevPageBottom');
    const nextPageButtonBottom = document.getElementById('nextPageBottom');
    const pageInfoSpanBottom = document.getElementById('pageInfoBottom');

    // New filter elements (updated IDs)
    const storeFilterContainer = document.getElementById('filter-stores');
    let storeCheckboxes = document.querySelectorAll('#filter-stores input[type="checkbox"]');

    let currentSortColumn = null;
    let currentSortOrder = 'asc'; // 'asc' or 'desc'
    let fetchedResults = []; // Store the full fetched data from backend
    let displayedResults = []; // Store results after applying store filter (what's actually displayed)
    let previouslySelectedStores = []; // New: To keep track of stores from previous search/filter
    let abortController = null; // New: AbortController to cancel fetch requests

    let currentPage = 1;
    const itemsPerPage = 30; // Set items per page

    function populateStoreFilters() {
        const stores = [
            { id: 'allStores', value: 'All', title: 'All Stores', icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE5IDNIMTlDMTcuMzQzMSAzIDE2IDQuMzQzMTUgMTYgNlYxOEMxNiAxOS42NTY5IDE3LjM0MzEgMjEgMTkgMjFIMTlDMjAuNjU2OSAyMSAyMiAxOS42NTY5IDIyIDE4VjZDMjIgNC4zNDMxNSAyMC42NTY5IDMgMTkgM1oiIHN0cm9rZT0iY3VycmVudENvbG9yIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgo8cGF0aCBkPSJNMTIgM0gxMkMxMC4zNDMxIDMgOSA0LjM0MzE1IDkgNlYxOEMyIDE5LjY1NjkgMy4zNDMxNSAyMSAxMiAyMUgxMkMxMy42NTY5IDIxIDE1IDE5LjY1NjkgMTUgMThWNkMxNSA0LjM0MzE1IDEzLjY1NjkgMyAxMiAzWiIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CjxwYXRoIGQ9Ik01IDNINUMzLjM0MzE1IDMgMiA0LjM0MzE1IDIgNlYxOEMyIDE5LjY1NjkgMy4zNDMxNSAyMSA1IDIxSDVDNi42NTY4NSAyMSA4IDE5LjY1NjkgOCAxOFY2QzggNC4zNDMxNSA2LjY1Njg1IDMgNSAzWiIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+Cjwvc3ZnPgo=' },
            { id: 'steam', value: 'Steam', title: 'Steam', icon: 'https://community.cloudflare.steamstatic.com/public/shared/images/responsive/share_steam_logo.png' },
            { id: 'gog', value: 'GOG', title: 'GOG', icon: '/icons/GOG.png' },
            { id: 'eneba', value: 'Eneba', title: 'Eneba', icon: '/icons/Eneba.png' },
            { id: 'cdkeys', value: 'CDKeys', title: 'CDKeys', icon: 'https://upload.wikimedia.org/wikipedia/commons/f/f3/CD_Keys.png' },
            { id: 'kinguin', value: 'Kinguin', title: 'Kinguin', icon: '/icons/Kinguin.jpg' },
            { id: 'epic', value: 'Epic Games', title: 'Epic Games', icon: 'https://upload.wikimedia.org/wikipedia/commons/5/57/Epic_games_store_logo.svg' },
            { id: 'xbox', value: 'Xbox India', title: 'Xbox India', icon: '/icons/xbox.jpg' },
            { id: 'fanatical', value: 'Fanatical', title: 'Fanatical', icon: '/icons/Fanatical.png' },
            // GameSeal is temporarily disabled in the frontend filter list
            // { id: 'gameseal', value: 'GameSeal', title: 'GameSeal', icon: '/icons/seal.png' },
            // K4G is temporarily disabled in the frontend filter list
            // { id: 'K4G', value: 'K4G', title: 'K4G', icon: '/icons/k4g.png' },
        ];

        stores.forEach(store => {
            const div = document.createElement('div');
            div.className = 'filter-checkbox';

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = store.id;
            input.value = store.value;
            if (store.id === 'allStores') input.checked = true;

            const label = document.createElement('label');
            label.htmlFor = store.id;
            label.className = 'store-icon-label';
            label.title = store.title;

            const img = document.createElement('img');
            img.src = store.icon;
            img.alt = store.title;
            img.className = 'filter-store-icon';
            
            label.appendChild(img);
            div.appendChild(input);
            div.appendChild(label);
            storeFilterContainer.appendChild(div);
        });
    }

    // Function to filter results by selected stores
    function filterResultsByStore() {
        const selectedValues = Array.from(document.querySelectorAll('#filter-stores input[type="checkbox"]'))
            .filter(checkbox => checkbox.checked)
            .map(checkbox => checkbox.value);

        if (selectedValues.includes('All') || selectedValues.length === 0) {
            displayedResults = fetchedResults;
        } else {
            displayedResults = fetchedResults.filter(item => selectedValues.includes(item.website));
        }
        currentPage = 1;
        goToPage(1);
        updateStoreFilterCounts(); // Update counts after filtering
        // Always sort by price ascending after filtering
        sortResults('price', 'asc');
    }

    // Function to handle "All Stores" checkbox logic and disable/enable other checkboxes
    function handleAllStoresCheckbox(changedCheckbox) {
        console.log('handleAllStoresCheckbox called. Changed checkbox:', changedCheckbox.value, 'Checked:', changedCheckbox.checked);
        const allCheckbox = Array.from(storeCheckboxes).find(cb => cb.value === 'All');

        if (!allCheckbox) {
            console.error('All Stores checkbox not found!');
            return; // Safety check
        }

        if (changedCheckbox.value === 'All') {
            if (changedCheckbox.checked) {
                // If "All" is checked, CHECK and disable all other stores
                console.log('All Stores checked. Checking and disabling others.');
                storeCheckboxes.forEach(cb => {
                    if (cb !== allCheckbox) {
                        cb.checked = true; // Ensure they are checked
                        cb.disabled = true; // Disable the input
                        cb.parentNode.classList.add('disabled-label'); // Add class for styling and pointer-events
                        console.log(`  - Set ${cb.value}: checked=${cb.checked}, disabled=${cb.disabled}, class added`);
                    }
                });
            } else {
                // If "All" is UNCHECKED: enable all other stores
                console.log('All Stores UNCHECKED. Enabling others.');
                storeCheckboxes.forEach(cb => {
                    cb.disabled = false; // Enable the input
                    cb.parentNode.classList.remove('disabled-label'); // Remove class
                    console.log(`  - Set ${cb.value}: disabled=${cb.disabled}, class removed`);
                });

                // If "All" is unchecked, uncheck all other stores as well
                storeCheckboxes.forEach(cb => {
                    if (cb !== allCheckbox) {
                        cb.checked = false;
                    }
                });
            }
        } else { // A non-"All" store checkbox was clicked
            console.log('Non-All store checkbox clicked:', changedCheckbox.value);
            if (changedCheckbox.checked) {
                // If a specific store is checked, ensure "All" is unchecked and others are enabled
                if (allCheckbox.checked) {
                    console.log('  Specific store checked, unchecking All.');
                    allCheckbox.checked = false;
                    // Enable all other checkboxes (they should already be enabled if All was unchecked, but ensuring)
                    storeCheckboxes.forEach(cb => {
                        cb.disabled = false;
                        cb.parentNode.classList.remove('disabled-label');
                    });
                }
            } else { // A specific store was UNCHECKED
                // If all specific stores are now unchecked, uncheck "All" as well
                console.log('  Specific store UNCHECKED.');
                const anyOtherChecked = Array.from(storeCheckboxes).some(cb => cb.checked && cb.value !== 'All');
                console.log('  Any other store checked after specific unchecked:', anyOtherChecked);
                if (!anyOtherChecked) {
                    console.log('  No other specific stores checked, unchecking All and all others.');
                    allCheckbox.checked = false;
                    storeCheckboxes.forEach(cb => {
                        if (cb !== allCheckbox) {
                            cb.checked = false;
                        }
                    });
                }
            }
        }
    }

    // Function to render the table rows for the current page
    function renderTablePage(resultsToRender) {
        priceTableBody.innerHTML = ''; // Clear existing rows
        if (resultsToRender.length > 0) {
            let visibleIndex = 0;
            resultsToRender.forEach((item, index) => {
                // Skip Xbox India games with price -1
                if (item.website === 'Xbox India' && item.price === -1) return;
                visibleIndex++;
                console.log('Rendering item:', item); // LOG
                const row = priceTableBody.insertRow();
                row.insertCell(0).textContent = (currentPage - 1) * itemsPerPage + visibleIndex; // Row number starts from 1
                // New: Image column
                const imageCell = row.insertCell(1);
                imageCell.className = 'game-cover-cell'; // Add class for specific styling
                if (item.image) {
                    const img = document.createElement('img');
                    img.src = item.image;
                    img.alt = item.name + ' cover';
                    img.className = 'game-cover-thumb';
                    imageCell.appendChild(img);
                }
                // Game Name
                const nameCell = row.insertCell(2);
                if (item.link) {
                    const a = document.createElement('a');
                    a.href = item.link;
                    a.textContent = item.name;
                    a.target = '_blank';
                    a.rel = 'noopener';
                    nameCell.appendChild(a);
                } else {
                    nameCell.textContent = item.name;
                }
                if (item.website === 'Xbox India' && item.gamePass) {
                    const gpIcon = document.createElement('img');
                    gpIcon.src = '/icons/Game pass.jpg';
                    gpIcon.alt = 'Game Pass';
                    gpIcon.title = 'Available on Game Pass';
                    gpIcon.className = 'game-pass-inline-icon';
                    nameCell.appendChild(gpIcon);
                }
                if (item.website === 'Epic Games' && item.eaPlay) {
                    const eaIcon = document.createElement('img');
                    eaIcon.src = '/icons/ea.png';
                    eaIcon.alt = 'EA Play';
                    eaIcon.title = 'Available on EA Play';
                    eaIcon.className = 'game-pass-inline-icon';
                    nameCell.appendChild(eaIcon);
                }
                // Store Icon
                const iconCell = row.insertCell(3);
                const storeIcon = document.createElement('img');
                if (item.website === 'GOG') storeIcon.src = '/icons/GOG.png';
                else if (item.website === 'Eneba') storeIcon.src = '/icons/Eneba.png';
                else if (item.website === 'Kinguin') storeIcon.src = '/icons/Kinguin.jpg';
                else if (item.website === 'Xbox India') storeIcon.src = '/icons/xbox.jpg';
                else storeIcon.src = item.icon;
                storeIcon.alt = item.website + ' Logo';
                storeIcon.title = item.website; // Show store name on hover
                storeIcon.classList.add('store-icon'); // Add class for styling
                iconCell.appendChild(storeIcon);
                // Price
                let priceDisplay;
                if ((item.website === 'Xbox Game Pass' || item.website === 'Steam') && item.priceText) {
                    // Use priceText for Xbox Game Pass and Steam entries
                    priceDisplay = item.priceText;
                } else {
                    // Use existing logic for other stores
                    priceDisplay = (typeof item.price === 'number' && item.price === 0) ? '0' : (typeof item.price === 'number' ? `₹ ${item.price.toLocaleString('en-IN')}` : item.price);
                }
                row.insertCell(4).textContent = priceDisplay;
            });
        }
    }

    // Helper to get filtered results (excluding Xbox India price -1)
    function getFilteredResults() {
        return displayedResults.filter(item => !(item.website === 'Xbox India' && item.price === -1));
    }

    // Update pagination controls to use filtered results
    function updatePaginationControls() {
        const filteredResults = getFilteredResults();
        const totalPages = Math.ceil(filteredResults.length / itemsPerPage);
        pageInfoSpan.textContent = `Page ${currentPage} of ${totalPages || 1}`;
        pageInfoSpanBottom.textContent = `Page ${currentPage} of ${totalPages || 1}`;
        prevPageButton.disabled = currentPage === 1;
        nextPageButton.disabled = currentPage === totalPages || totalPages === 0;
        prevPageButtonBottom.disabled = currentPage === 1;
        nextPageButtonBottom.disabled = currentPage === totalPages || totalPages === 0;
        if (filteredResults.length > 0) {
            paginationControls.classList.remove('hidden');
            paginationControlsBottom.classList.remove('hidden');
        } else {
            paginationControls.classList.add('hidden');
            paginationControlsBottom.classList.add('hidden');
        }
    }

    // Update goToPage to use filtered results
    function goToPage(page) {
        const filteredResults = getFilteredResults();
        const totalPages = Math.ceil(filteredResults.length / itemsPerPage);
        if (page < 1 || (page > totalPages && totalPages > 0)) return;

        currentPage = page;
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const resultsOnPage = filteredResults.slice(startIndex, endIndex);

        renderTablePage(resultsOnPage);
        updatePaginationControls();
    }

    // Function to sort results with improved non-numeric handling and added debugging
    function sortResults(column, order) {
        console.log(`Sorting by ${column}, order: ${order}`);
        console.log('Displayed Results BEFORE sort:', JSON.parse(JSON.stringify(displayedResults))); // Deep copy for logging

        displayedResults.sort((a, b) => {
            let valA = a[column];
            let valB = b[column];

            if (column === 'price') {
                const parsePriceForSort = (priceStr) => {
                    // Normalize to string first if it's already a number
                    const strVal = String(priceStr).toLowerCase(); 

                    // Handle "Game Pass only" entries - they should be treated specially
                    if (strVal === 'game pass only') {
                        return -1; // Special value for "Game Pass only" entries
                    }
                    
                    // Handle "Free" entries - they should be treated specially
                    if (strVal === 'free') {
                        return -2; // Special value for "Free" entries (even lower than Game Pass only)
                    }
                    
                    if (strVal === 'game pass') { // Handle 'Game Pass' string (if still somehow present)
                        return 0; 
                    }
                    // For numerical 0 (coming from backend), parseFloat("0") will handle it
                    const parsed = parseFloat(strVal.replace(/[^\d.-]/g, ''));
                    return isNaN(parsed) ? null : parsed; // Use null for true non-numeric values
                };

                // Check if we have priceText field for special entries
                let numA, numB;
                
                // Check for special entries in priceText field first
                if (a.priceText === 'Game Pass only') {
                    numA = -1; // Special value for "Game Pass only"
                } else if (a.priceText === 'Free') {
                    numA = -2; // Special value for "Free" entries
                } else {
                    numA = parsePriceForSort(valA);
                }
                
                if (b.priceText === 'Game Pass only') {
                    numB = -1; // Special value for "Game Pass only"
                } else if (b.priceText === 'Free') {
                    numB = -2; // Special value for "Free" entries
                } else {
                    numB = parsePriceForSort(valB);
                }

                console.log(`  Comparing "${valA}" (parsed: ${numA}) vs "${valB}" (parsed: ${numB})`); // DEBUG: show parsed values

                // Logic to push non-numeric values (null) to the end
                if (numA === null && numB === null) return 0;
                if (numA === null) return 1; // A is non-numeric, push A to end
                if (numB === null) return -1; // B is non-numeric, push B to end

                // Special handling for "Free" and "Game Pass only" entries
                if (numA === -2 && numB === -2) {
                    // Both are "Free", sort by name
                    const nameA = String(a.name || '').toLowerCase();
                    const nameB = String(b.name || '').toLowerCase();
                    return nameA.localeCompare(nameB);
                }
                if (numA === -1 && numB === -1) {
                    // Both are "Game Pass only", sort by name
                    const nameA = String(a.name || '').toLowerCase();
                    const nameB = String(b.name || '').toLowerCase();
                    return nameA.localeCompare(nameB);
                }
                
                // "Free" entries come first in ascending order, last in descending order
                if (numA === -2) return order === 'asc' ? -1 : 1;
                if (numB === -2) return order === 'asc' ? 1 : -1;
                
                // "Game Pass only" entries come after "Free" in ascending order
                if (numA === -1) return order === 'asc' ? -1 : 1;
                if (numB === -1) return order === 'asc' ? 1 : -1;

                // Now compare numeric values
                if (numA < numB) {
                    return order === 'asc' ? -1 : 1;
                }
                if (numA > numB) {
                    return order === 'asc' ? 1 : -1;
                }
                return 0; // Prices are equal
            } else if (column === 'name' || column === 'website') {
                // String comparison for Game Name and Store
                valA = String(valA).toLowerCase();
                valB = String(valB).toLowerCase();
                if (valA < valB) {
                    return order === 'asc' ? -1 : 1;
                }
                if (valA > valB) {
                    return order === 'asc' ? 1 : -1;
                }
                return 0;
            } else {
                // Default to string comparison for any other columns
                valA = String(valA).toLowerCase();
                valB = String(valB).toLowerCase();
                if (valA < valB) {
                    return order === 'asc' ? -1 : 1;
                }
                if (valA > valB) {
                    return order === 'asc' ? 1 : -1;
                }
                return 0;
            }
        });
        console.log('Displayed Results AFTER sort:', JSON.parse(JSON.stringify(displayedResults))); // DEBUG: show results after sort
        goToPage(currentPage);
    }

    // Event listener for search button
    searchButton.addEventListener('click', async () => {
        const gameName = gameNameInput.value.trim();

        if (!gameName) {
            alert('Please enter a game name.');
            return;
        }

        // Fetch YouTube videos for the game (append ' review' to the query)
        fetchYouTubeVideos(gameName + ' review');

        priceTableBody.innerHTML = '';
        noResultsP.classList.add('hidden');
        loadingDiv.classList.remove('hidden');
        paginationControls.classList.add('hidden');
        stopSearchButton.classList.remove('hidden'); // Show stop search button
        
        tableHeaders.forEach(header => {
            header.classList.remove('asc', 'desc');
        });
        currentSortColumn = 'price';
        currentSortOrder = 'asc';
        currentPage = 1;

        // Initialize a new AbortController for this search
        if (abortController) {
            abortController.abort(); // Abort any previous ongoing request
        }
        abortController = new AbortController();
        const signal = abortController.signal;

        try {
            const selectedStores = Array.from(storeCheckboxes) // Read from new checkboxes
                .filter(checkbox => checkbox.checked)
                .map(checkbox => checkbox.value);
            
            // Set previouslySelectedStores for initial search
            previouslySelectedStores = [...selectedStores]; 

            const storesQuery = selectedStores.length > 0 && !selectedStores.includes('All') ? `&stores=${selectedStores.join(',')}` : '';

            const response = await fetch(`http://localhost:3000/search?gameName=${encodeURIComponent(gameName)}${storesQuery}`, { signal });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            fetchedResults = data;
            console.log('Fetched results from backend:', fetchedResults); // LOG
            
            // Re-select checkboxes after fetching results to ensure they are available
            storeCheckboxes = document.querySelectorAll('#filter-stores input[type="checkbox"]');
            
            filterResultsByStore();
            updateStoreFilterCounts(); // Update counts after fetching

            loadingDiv.classList.add('hidden');
            stopSearchButton.classList.add('hidden'); // Hide stop search button on completion

            if (displayedResults.length > 0) {
                sortResults(currentSortColumn, currentSortOrder);
            } else {
                noResultsP.classList.remove('hidden');
            }
            playSuccessSound();

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Fetch aborted by user.');
                noResultsP.textContent = 'Search stopped.';
                noResultsP.classList.remove('hidden');
            } else {
                console.error('Error fetching game prices:', error);
                noResultsP.textContent = 'Failed to load prices. Please try again.';
                noResultsP.classList.remove('hidden');
            }
            loadingDiv.classList.add('hidden');
            stopSearchButton.classList.add('hidden'); // Hide stop search button on error
            displayedResults = []; // Clear the results array on error
            updatePaginationControls(); // Reset pagination on error
        } finally {
            abortController = null; // Clear controller after request
        }
    });

    // Event listener for stop search button
    stopSearchButton.addEventListener('click', () => {
        if (abortController) {
            abortController.abort(); // Cancel the ongoing fetch request
        }
        loadingDiv.classList.add('hidden');
        stopSearchButton.classList.add('hidden'); // Hide the button
        noResultsP.textContent = 'Search stopped.';
        noResultsP.classList.remove('hidden');
        priceTableBody.innerHTML = ''; // Clear table
        paginationControls.classList.add('hidden');
        paginationControlsBottom.classList.add('hidden');
        displayedResults = []; // Clear the results array
        updatePaginationControls(); // Reset pagination display
    });

    // Event listeners for sorting
    tableHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const column = header.dataset.sortBy;
            const order = header.dataset.sortOrder; // Get current order from dataset
            const newOrder = (order === 'asc' || !order) ? 'desc' : 'asc'; // Toggle order
            // Update the dataset attribute
            header.dataset.sortOrder = newOrder;

            // Remove sort class from other headers and add to current
            tableHeaders.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
            header.classList.add(`sort-${newOrder}`);

            currentSortColumn = column;
            currentSortOrder = newOrder;
            sortResults(currentSortColumn, currentSortOrder);
        });
    });

    // Add event listeners to each store checkbox after they are created
    function setupCheckboxListeners() {
        const checkboxes = document.querySelectorAll('#filter-stores input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (event) => {
                handleAllStoresCheckbox(event.target);
                // Only apply filter if there are already results
                if (fetchedResults.length > 0) {
                    filterResultsByStore();
                }
            });
        });
    }

    // Populate filters on page load
    populateStoreFilters();
    storeCheckboxes = document.querySelectorAll('#filter-stores input[type="checkbox"]');
    setupCheckboxListeners();


    // New: Handle initial state of "All Stores" checkbox on page load
    const initialAllCheckbox = document.getElementById('allStores');
    if (initialAllCheckbox && initialAllCheckbox.checked) {
        handleAllStoresCheckbox(initialAllCheckbox);
    }

    // Pagination button event listeners
    prevPageButton.addEventListener('click', () => {
        goToPage(currentPage - 1);
    });

    nextPageButton.addEventListener('click', () => {
        goToPage(currentPage + 1);
    });

    // New bottom controls event listeners
    prevPageButtonBottom.addEventListener('click', () => {
        goToPage(currentPage - 1);
    });

    nextPageButtonBottom.addEventListener('click', () => {
        goToPage(currentPage + 1);
    });

    gameNameInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            if (!loadingDiv.classList.contains('hidden')) {
                stopSearchButton.click();
            } else {
                searchButton.click();
            }
        }
    });

    // Initial setup: ensure 'All Stores' is initially checked and others are disabled/greyed out
    const allStoresCheckbox = Array.from(storeCheckboxes).find(cb => cb.value === 'All');
    if (allStoresCheckbox) {
        handleAllStoresCheckbox(allStoresCheckbox);
    }
    goToPage(currentPage); // Initial rendering

    function updateStoreFilterCounts() {
        // Count results for each store in the currently displayed results
        const storeCounts = {};
        fetchedResults.forEach(item => {
            if (!storeCounts[item.website]) storeCounts[item.website] = 0;
            storeCounts[item.website]++;
        });
        // Update the count badges in the sidebar
        document.querySelectorAll('#filter-stores .filter-checkbox').forEach(cbDiv => {
            const input = cbDiv.querySelector('input[type="checkbox"]');
            const label = cbDiv.querySelector('label');
            if (!input || !label) return;
            // Remove any old count badge
            const oldBadge = label.querySelector('.filter-result-count');
            if (oldBadge) oldBadge.remove();
            // Skip "All Stores"
            if (input.value === 'All') return;
            // Add new badge if there are results for this store
            const count = storeCounts[input.value] || 0;
            const badge = document.createElement('span');
            badge.className = 'filter-result-count';
            badge.textContent = `(${count})`;
            label.appendChild(badge);
        });
    }

    function playSuccessSound() {
        const audio = document.getElementById('searchCompleteAudio');
        if (audio) {
            audio.volume = 0.35; // Reduce volume by 35%
            audio.currentTime = 8;
            audio.play().catch(e => console.error("Audio play failed:", e));
            setTimeout(() => {
                if (audio) {
                    audio.pause();
                }
            }, 700);
        }
    }

    // Add filter stores toggle arrow logic
    window.addEventListener('DOMContentLoaded', function() {
        const filterContainer = document.querySelector('.filter-stores-container');
        if (filterContainer) {
            // Create arrow button if not present
            let arrow = document.querySelector('.filter-stores-toggle-arrow');
            if (!arrow) {
                arrow = document.createElement('span');
                arrow.className = 'filter-stores-toggle-arrow expanded';
                arrow.innerHTML = `
                    <svg width="24" height="24" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
                `;
                filterContainer.parentElement.style.position = 'relative';
                filterContainer.parentElement.appendChild(arrow);
            }
            arrow.addEventListener('click', function() {
                const isCollapsed = filterContainer.classList.toggle('filter-stores-collapsed');
                arrow.classList.toggle('collapsed', isCollapsed);
                arrow.classList.toggle('expanded', !isCollapsed);
            });
        }
    });

    function searchGames() {
      // This function is intentionally left blank.
      // It was a duplicate and was causing a bug that prevented the store filters from loading.
    }

    async function fetchYouTubeVideos(gameName) {
        const youtubeContainer = document.getElementById('youtube-container');
        const youtubeVideosDiv = document.getElementById('youtube-videos');
        youtubeContainer.style.display = 'none'; // Hide initially
        youtubeVideosDiv.innerHTML = '';

        try {
            const response = await fetch(`http://localhost:3000/youtube-videos?q=${encodeURIComponent(gameName)}`);
            if (!response.ok) {
                throw new Error(`YouTube fetch failed with status: ${response.status}`);
            }
            const videos = await response.json();

            // Always show the container after a successful fetch
            youtubeContainer.style.display = 'block'; 

            if (videos.length > 0) {
                videos.forEach(video => {
                    const videoItem = document.createElement('div');
                    videoItem.className = 'video-item';

                    const thumbnail = document.createElement('img');
                    thumbnail.src = video.thumbnail;
                    thumbnail.alt = video.title;
                    thumbnail.className = 'video-thumbnail';

                    const videoLink = document.createElement('a');
                    videoLink.href = `https://www.youtube.com/watch?v=${video.videoId}`;
                    videoLink.target = '_blank';
                    videoLink.rel = 'noopener noreferrer';
                    
                    const videoInfo = document.createElement('div');
                    videoInfo.className = 'video-info';

                    const title = document.createElement('p');
                    title.className = 'video-title';
                    title.textContent = video.title;

                    const meta = document.createElement('p');
                    meta.className = 'video-meta';
                    const viewCountText = video.viewCount.replace(' views', '');

                    const publishedTimeSpan = document.createElement('span');
                    publishedTimeSpan.textContent = `${video.publishedTime} •`;

                    const eyeIcon = document.createElement('img');
                    eyeIcon.src = 'icons/eye.png';
                    eyeIcon.alt = 'views';
                    eyeIcon.className = 'view-icon';

                    const viewCountSpan = document.createElement('span');
                    viewCountSpan.textContent = viewCountText;

                    meta.appendChild(publishedTimeSpan);
                    meta.appendChild(eyeIcon);
                    meta.appendChild(viewCountSpan);

                    videoInfo.appendChild(title);
                    videoInfo.appendChild(meta);
                    videoLink.appendChild(thumbnail);
                    videoLink.appendChild(videoInfo);
                    videoItem.appendChild(videoLink);
                    youtubeVideosDiv.appendChild(videoItem);
                });
            } else {
                 youtubeVideosDiv.innerHTML = '<p>No videos found.</p>';
            }
        } catch (error) {
            console.error('Error fetching YouTube videos:', error);
            youtubeContainer.style.display = 'none';
        }
    }

    function displayResults(data) {
        const priceTableBody = document.getElementById('priceTable').getElementsByTagName('tfoot')[0];
        const noResults = document.getElementById('noResults');

        // Clear previous results
        priceTableBody.innerHTML = '';

        if (data.length > 0) {
            noResults.style.display = 'none';
        } else {
            noResults.style.display = 'block';
        }

        currentPage = 1;
        paginatedData = data;
        renderTablePage(currentPage);
        updatePaginationControls();
    }
});


