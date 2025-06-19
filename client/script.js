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

    // New filter elements (updated IDs)
    const filterToggleButton = document.getElementById('filterToggleButton');
    const storeFilterDropdown = document.getElementById('storeFilterDropdown');
    const storeCheckboxes = document.querySelectorAll('#storeFilterDropdown input[type="checkbox"]');
    const applyFilterButton = document.getElementById('applyFilterButton');
    const clearFilterButton = document.getElementById('clearFilterButton'); // New clear button
    const appliedFiltersDisplay = document.getElementById('appliedFiltersDisplay');

    let currentSortColumn = null;
    let currentSortOrder = 'asc'; // 'asc' or 'desc'
    let fetchedResults = []; // Store the full fetched data from backend
    let displayedResults = []; // Store results after applying store filter (what's actually displayed)
    let previouslySelectedStores = []; // New: To keep track of stores from previous search/filter
    let abortController = null; // New: AbortController to cancel fetch requests

    let currentPage = 1;
    const itemsPerPage = 30; // Set items per page

    // Function to toggle the filter dropdown visibility
    function toggleFilterDropdown() {
        storeFilterDropdown.classList.toggle('hidden');
    }

    // Function to update the display of applied filters
    function updateAppliedFiltersDisplay() {
        const selectedOptions = Array.from(storeCheckboxes)
            .filter(checkbox => checkbox.checked)
            .map(checkbox => checkbox.parentNode.textContent.trim()); // Get label text

        if (selectedOptions.length === 0 || selectedOptions.includes('All Stores')) {
            appliedFiltersDisplay.textContent = 'Active Filters: All Stores';
            // Removed: Logic to ensure 'All' checkbox is checked/unchecked here.
            // This is now handled solely by handleAllStoresCheckbox.
        } else {
            appliedFiltersDisplay.textContent = `Active Filters: ${selectedOptions.join(', ')}`;
            // Removed: Logic to ensure 'All' checkbox is checked/unchecked here.
            // This is now handled solely by handleAllStoresCheckbox.
        }
    }

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
    }

    // Function to handle "All Stores" checkbox logic and disable/enable other checkboxes
    function handleAllStoresCheckbox(changedCheckbox) {
        const allCheckbox = Array.from(storeCheckboxes).find(cb => cb.value === 'All');

        if (!allCheckbox) return; // Safety check

        if (changedCheckbox.value === 'All') {
            if (changedCheckbox.checked) {
                // If "All" is checked, uncheck and disable all other stores
                storeCheckboxes.forEach(cb => {
                    if (cb !== allCheckbox) {
                        cb.checked = false; // Ensure they are unchecked
                        cb.disabled = true; // Disable the input
                        cb.parentNode.classList.add('disabled-label'); // Add class for styling and pointer-events
                    }
                });
            } else {
                // If "All" is UNCHECKED: enable all other stores
                storeCheckboxes.forEach(cb => {
                    cb.disabled = false; // Enable the input
                    cb.parentNode.classList.remove('disabled-label'); // Remove class
                });

                // IMPORTANT: If "All" was just unchecked, and no other specific store is checked,
                // automatically re-check "All" to prevent an empty filter selection.
                const anyOtherChecked = Array.from(storeCheckboxes).some(cb => cb.checked && cb.value !== 'All');
                if (!anyOtherChecked) {
                    allCheckbox.checked = true; // Re-check "All"
                    // Since "All" is re-checked, re-disable others
                    storeCheckboxes.forEach(cb => {
                        if (cb !== allCheckbox) {
                            cb.disabled = true;
                            cb.parentNode.classList.add('disabled-label');
                        }
                    });
                }
            }
        } else { // A non-"All" store checkbox was clicked
            if (changedCheckbox.checked) {
                // If a specific store is checked, ensure "All" is unchecked and others are enabled
                if (allCheckbox.checked) {
                    allCheckbox.checked = false;
                    // Enable all other checkboxes (they should already be enabled if All was unchecked, but ensuring)
                    storeCheckboxes.forEach(cb => {
                        cb.disabled = false;
                        cb.parentNode.classList.remove('disabled-label');
                    });
                }
            } else { // A specific store was UNCHECKED
                // If all specific stores are now unchecked, re-check "All" and disable others
                const anyOtherChecked = Array.from(storeCheckboxes).some(cb => cb.checked && cb.value !== 'All');
                if (!anyOtherChecked) {
                    allCheckbox.checked = true;
                    storeCheckboxes.forEach(cb => {
                        if (cb !== allCheckbox) {
                            cb.disabled = true;
                            cb.parentNode.classList.add('disabled-label');
                        }
                    });
                }
            }
        }
        updateAppliedFiltersDisplay(); // Always update display after state changes
    }

    // Function to render the table rows for the current page
    function renderTablePage(resultsToRender) {
        priceTableBody.innerHTML = ''; // Clear existing rows
        if (resultsToRender.length > 0) {
            resultsToRender.forEach((item, index) => {
                const row = priceTableBody.insertRow();
                row.insertCell(0).textContent = (currentPage - 1) * itemsPerPage + index + 1; // Row number
                row.insertCell(1).textContent = item.name;
                row.insertCell(2).textContent = item.website;
                row.insertCell(3).textContent = (typeof item.price === 'number' && item.price === 0) ? '0' : (typeof item.price === 'number' ? `₹ ${item.price.toLocaleString('en-IN')}` : item.price);
                const linkCell = row.insertCell(4);
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

        prevPageButton.disabled = currentPage === 1;
        nextPageButton.disabled = currentPage === totalPages || totalPages === 0;

        if (displayedResults.length > 0) {
            paginationControls.classList.remove('hidden');
        } else {
            paginationControls.classList.add('hidden');
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
            } else {
                // Default to string comparison for name and website
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
            
            filterResultsByStore();
            updateAppliedFiltersDisplay();

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

    // Event listener for filter toggle button
    filterToggleButton.addEventListener('click', toggleFilterDropdown);

    // Event listener for applying filters
    applyFilterButton.addEventListener('click', async () => {
        toggleFilterDropdown(); // Close the dropdown

        const gameName = gameNameInput.value.trim();
        const currentSelectedStores = Array.from(storeCheckboxes)
            .filter(checkbox => checkbox.checked)
            .map(checkbox => checkbox.value);

        // Find newly selected stores (stores in currentSelectedStores but not in previouslySelectedStores)
        const newlySelectedStores = currentSelectedStores.filter(store => !previouslySelectedStores.includes(store));

        if (gameName && newlySelectedStores.length > 0) {
            // Only fetch data for newly selected stores if there's an existing search
            loadingDiv.classList.remove('hidden');
            noResultsP.classList.add('hidden');
            paginationControls.classList.add('hidden');
            priceTableBody.innerHTML = ''; // Clear current display while fetching new data
            stopSearchButton.classList.remove('hidden'); // Show stop search button

            // Initialize a new AbortController for this filter application
            if (abortController) {
                abortController.abort();
            }
            abortController = new AbortController();
            const signal = abortController.signal;

            try {
                const storesQuery = `&stores=${newlySelectedStores.join(',')}`;
                const response = await fetch(`http://localhost:3000/search?gameName=${encodeURIComponent(gameName)}${storesQuery}`, { signal });
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const newData = await response.json();
                
                // Merge new data with existing fetchedResults
                fetchedResults = fetchedResults.concat(newData);
                
                // Update previouslySelectedStores
                previouslySelectedStores = [...currentSelectedStores];

                // Now filter all results based on the new filter
                filterResultsByStore();
                updateAppliedFiltersDisplay();

                loadingDiv.classList.add('hidden');
                stopSearchButton.classList.add('hidden'); // Hide stop search button
                if (displayedResults.length > 0) {
                    sortResults(currentSortColumn, currentSortOrder);
                } else {
                    noResultsP.classList.remove('hidden');
                }

            } catch (error) {
                if (error.name === 'AbortError') {
                    console.log('Filter fetch aborted by user.');
                    noResultsP.textContent = 'Filter application stopped.';
                    noResultsP.classList.remove('hidden');
                } else {
                    console.error('Error fetching new game prices for added stores:', error);
                    noResultsP.textContent = 'Failed to load prices for new stores. Please try again.';
                    noResultsP.classList.remove('hidden');
                }
                loadingDiv.classList.add('hidden');
                stopSearchButton.classList.add('hidden'); // Hide stop search button
            } finally {
                abortController = null; // Clear controller after request
            }
        } else {
            // If no game name or no new stores, just apply the filter on existing data
            previouslySelectedStores = [...currentSelectedStores]; // Update for next comparison
            filterResultsByStore();
            updateAppliedFiltersDisplay();
            if (displayedResults.length > 0) {
                sortResults(currentSortColumn, currentSortOrder);
            } else {
                noResultsP.classList.remove('hidden');
            }
        }
    });

    // Event listener for clearing filters
    clearFilterButton.addEventListener('click', () => {
        // This button now needs to explicitly reset to "All Stores" state
        const allCheckbox = Array.from(storeCheckboxes).find(cb => cb.value === 'All');
        if (allCheckbox) {
            allCheckbox.checked = true; // Ensure "All Stores" is checked
            allCheckbox.dispatchEvent(new Event('change')); // Trigger change to update other checkboxes
        }
        previouslySelectedStores = ['All']; // Reset previously selected stores
        filterResultsByStore(); // Re-apply filter (will show all fetched results)
        updateAppliedFiltersDisplay(); // Update display
        // toggleFilterDropdown(); // Decide if you want to close the dropdown on clear
    });

    // Add event listeners to store checkboxes
    storeCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', (event) => {
            handleAllStoresCheckbox(event.target);
        });
    });

    // Close dropdown if clicked outside
    document.addEventListener('click', (event) => {
        if (!storeFilterDropdown.contains(event.target) && !filterToggleButton.contains(event.target)) {
            if (!storeFilterDropdown.classList.contains('hidden')) {
                toggleFilterDropdown();
            }
        }
    });

    // Event listeners for table headers
    tableHeaders.forEach(header => {
        header.addEventListener('click', () => {
            if (displayedResults.length === 0) return;

            const column = header.dataset.sortBy;

            if (currentSortColumn === column) {
                currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortColumn = column;
                currentSortOrder = 'asc';
            }

            tableHeaders.forEach(h => h.classList.remove('asc', 'desc'));
            header.classList.add(currentSortOrder);

            sortResults(currentSortColumn, currentSortOrder);
        });
    });

    // Pagination button event listeners
    prevPageButton.addEventListener('click', () => {
        goToPage(currentPage - 1);
    });

    nextPageButton.addEventListener('click', () => {
        goToPage(currentPage + 1);
    });

    // Initial setup: ensure 'All Stores' is initially checked and others are disabled/greyed out
    const initialAllCheckbox = Array.from(storeCheckboxes).find(cb => cb.value === 'All');
    if (initialAllCheckbox) {
        handleAllStoresCheckbox(initialAllCheckbox);
    }
    updateAppliedFiltersDisplay();
    goToPage(currentPage); // Initial rendering
});

