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
    const storeFilterContainer = document.getElementById('sidebar-filters');
    const storeCheckboxes = document.querySelectorAll('#sidebar-filters input[type="checkbox"]');

    let currentSortColumn = null;
    let currentSortOrder = 'asc'; // 'asc' or 'desc'
    let fetchedResults = []; // Store the full fetched data from backend
    let displayedResults = []; // Store results after applying store filter (what's actually displayed)
    let previouslySelectedStores = []; // New: To keep track of stores from previous search/filter
    let abortController = null; // New: AbortController to cancel fetch requests

    let currentPage = 1;
    const itemsPerPage = 30; // Set items per page

    // Function to filter results by selected stores
    function filterResultsByStore() {
        const selectedValues = Array.from(storeCheckboxes)
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
            resultsToRender.forEach((item, index) => {
                console.log('Rendering item:', item); // LOG
                const row = priceTableBody.insertRow();
                row.insertCell(0).textContent = (currentPage - 1) * itemsPerPage + index + 1; // Row number
                // New: Image column
                const imageCell = row.insertCell(1);
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
                // Store Icon
                const iconCell = row.insertCell(3);
                const storeIcon = document.createElement('img');
                if (item.website === 'GOG') storeIcon.src = '/icons/GOG.png';
                else if (item.website === 'Eneba') storeIcon.src = '/icons/Eneba.png';
                else if (item.website === 'Kinguin') storeIcon.src = '/icons/Kinguin.jpg';
                else if (item.website === 'Xbox Game Pass') storeIcon.src = '/icons/Xbox.jpg';
                else if (item.website === 'G2A') storeIcon.src = '/icons/g2a.jpg';
                else storeIcon.src = item.icon;
                storeIcon.alt = item.website + ' Logo';
                storeIcon.title = item.website; // Show store name on hover
                storeIcon.classList.add('store-icon'); // Add class for styling
                iconCell.appendChild(storeIcon);
                // Price
                row.insertCell(4).textContent = (typeof item.price === 'number' && item.price === 0) ? '0' : (typeof item.price === 'number' ? `₹ ${item.price.toLocaleString('en-IN')}` : item.price);
                // Link
                const linkCell = row.insertCell(5);
                const link = document.createElement('a');
                link.href = item.link;
                link.textContent = 'Go to Store';
                link.target = '_blank';
                linkCell.appendChild(link);
            });
        }
    }

    // Function to update pagination controls (buttons, page info)
    function updatePaginationControls() {
        const totalPages = Math.ceil(displayedResults.length / itemsPerPage);
        pageInfoSpan.textContent = `Page ${currentPage} of ${totalPages || 1}`;
        pageInfoSpanBottom.textContent = `Page ${currentPage} of ${totalPages || 1}`;
        prevPageButton.disabled = currentPage === 1;
        nextPageButton.disabled = currentPage === totalPages || totalPages === 0;
        prevPageButtonBottom.disabled = currentPage === 1;
        nextPageButtonBottom.disabled = currentPage === totalPages || totalPages === 0;
        if (displayedResults.length > 0) {
            paginationControls.classList.remove('hidden');
            paginationControlsBottom.classList.remove('hidden');
        } else {
            paginationControls.classList.add('hidden');
            paginationControlsBottom.classList.add('hidden');
        }
    }

    // Function to go to a specific page
    function goToPage(page) {
        const totalPages = Math.ceil(displayedResults.length / itemsPerPage);
        if (page < 1 || (page > totalPages && totalPages > 0)) return;

        currentPage = page;
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const resultsOnPage = displayedResults.slice(startIndex, endIndex);

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

                    if (strVal === 'free' || strVal === 'game pass') { // Handle 'Free' string or 'Game Pass' string (if still somehow present)
                        return 0; 
                    }
                    // For numerical 0 (coming from backend), parseFloat("0") will handle it
                    const parsed = parseFloat(strVal.replace(/[^\d.-]/g, ''));
                    return isNaN(parsed) ? null : parsed; // Use null for true non-numeric values
                };

                let numA = parsePriceForSort(valA);
                let numB = parsePriceForSort(valB);

                console.log(`  Comparing "${valA}" (parsed: ${numA}) vs "${valB}" (parsed: ${numB})`); // DEBUG: show parsed values

                // Logic to push non-numeric values (null) to the end
                if (numA === null && numB === null) return 0;
                if (numA === null) return 1; // A is non-numeric, push A to end
                if (numB === null) return -1; // B is non-numeric, push B to end

                // Now compare numeric values (including 'Free' and 'Game Pass' as 0)
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
            filterResultsByStore();
            updateStoreFilterCounts(); // Update counts after fetching

            loadingDiv.classList.add('hidden');
            stopSearchButton.classList.add('hidden'); // Hide stop search button on completion

            if (displayedResults.length > 0) {
                sortResults(currentSortColumn, currentSortOrder);
            } else {
                noResultsP.classList.remove('hidden');
            }

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

    // Add event listeners to each store checkbox
    storeCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', (event) => {
            handleAllStoresCheckbox(event.target);
            // Apply filter immediately when checkbox changes
            filterResultsByStore();
        });
    });

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
        document.querySelectorAll('#sidebar-filters .filter-checkbox').forEach(cbDiv => {
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
});


