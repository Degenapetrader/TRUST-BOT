/**
 * BID Token Selection UI Module
 * Manages the BID-MODE token selection interface, including loading tokens from bid.json,
 * filtering, searching, and selection of tokens.
 * This mirrors the functionality of token-selection.js but for BID-MODE tokens.
 */

// Create BID Token Selection UI Module
window.BidTokenSelectionUI = (function() {
    // DOM elements
    let searchInput = null;
    let searchDropdown = null;
    let tokenListContainer = null;
    let currentFilter = 'all'; // all, selected, hasPool
    let tokenDatabase = []; // Store bid.json data
    let selectedTokens = []; // Store selected tokens
    let searchTimeout = null; // For debouncing search
    let currentTokensToDisplay = []; // Filtered tokens currently displayed
    const BATCH_INCREMENT = 30; // Number of tokens to render in each batch
    let visibleTokenCount = 0; // Count of currently visible tokens
    
    /**
     * Create the BID token selection panel if it doesn't exist
     */
    function ensureBidTokenPanelExists() {
        console.log('Ensuring BID token panel exists...');
        
        // Check if the panel exists
        let bidTickerPanel = document.getElementById('bid-ticker-selection');
        
        // Create the panel if it doesn't exist
        if (!bidTickerPanel) {
            console.log('Creating BID token panel from scratch');
            bidTickerPanel = document.createElement('div');
            bidTickerPanel.id = 'bid-ticker-selection';
            bidTickerPanel.className = 'token-selection-panel';
            bidTickerPanel.style.display = 'none'; // Hidden by default
            
            // Create the structure
            bidTickerPanel.innerHTML = `
                <div class="token-panel-header">
                    <h3>BID Tokens</h3>
                </div>
                <div class="search-container">
                    <input type="text" id="bid-token-search" class="search-input" placeholder="Search tokens..." />
                </div>
                <div class="token-filter-tabs">
                    <div class="token-filter-tab active" data-filter="all">All</div>
                    <div class="token-filter-tab" data-filter="selected">Selected</div>
                    <div class="token-filter-tab" data-filter="hasPool">Has Pool</div>
                </div>
                <div id="bid-token-list" class="token-list"></div>
                <div class="token-panel-footer">
                    <div class="token-count"><span id="selected-bid-token-count">0</span> tokens selected</div>
                    <div class="token-actions">
                        <button class="select-all-btn">Select All</button>
                        <button class="clear-all-btn">Clear All</button>
                    </div>
                </div>
            `;
            
            // Add to the document in the token selection area
            const tokenWalletContainer = document.querySelector('.token-wallet-container');
            if (tokenWalletContainer) {
                tokenWalletContainer.appendChild(bidTickerPanel);
            } else {
                // As a fallback, add to main content
                const mainContent = document.querySelector('.main-content');
                if (mainContent) {
                    mainContent.appendChild(bidTickerPanel);
                }
            }
            
            // Add event listeners to the new buttons
            const selectAllBtn = bidTickerPanel.querySelector('.select-all-btn');
            const clearAllBtn = bidTickerPanel.querySelector('.clear-all-btn');
            
            if (selectAllBtn) selectAllBtn.addEventListener('click', selectAll);
            if (clearAllBtn) clearAllBtn.addEventListener('click', clearAll);
            
            // Add filter tab listeners
            const filterTabs = bidTickerPanel.querySelectorAll('.token-filter-tab');
            filterTabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    setFilter(tab.getAttribute('data-filter'));
                });
            });
        }
        
        return bidTickerPanel;
    }
    
    /**
     * Initialize the BID token selection UI
     */
    function init() {
        console.log('Initializing BID Token Selection UI...');
        
        // Ensure the panel exists first
        const bidTickerPanel = ensureBidTokenPanelExists();
        
        // Get DOM elements
        searchInput = document.getElementById('bid-token-search');
        tokenListContainer = document.getElementById('bid-token-list');
        
        // Create search dropdown if it doesn't exist
        if (!searchDropdown) {
            searchDropdown = document.createElement('div');
            searchDropdown.id = 'bid-token-search-dropdown';
            searchDropdown.className = 'search-dropdown';
            const searchContainer = document.querySelector('#bid-ticker-selection .search-container');
            if (searchContainer) {
                searchContainer.style.position = 'relative';
                searchContainer.appendChild(searchDropdown);
            }
        }
        
        // Apply consistent styling to match the regular token panel
        applyTokenPanelStyling();
        
        // Setup filter tabs with enhanced styling
        setupFilterTabs();
        
        // Style the search input container to match regular panel
        styleSearchInput();
        
        // Load token data from bid.json
        loadTokenData()
            .then(() => {
                // Set up event listeners
                setupEventListeners();
                
                // Set default filter
                setActiveFilter('all');
                
                // If there are already selected tokens in the global state, use those
                if (window.bidSelectedTickers && window.bidSelectedTickers.length > 0) {
                    selectedTokens = [...window.bidSelectedTickers];
                } else if (window.selectedTickers && window.selectedTickers.length > 0 && window.isBidModeActive) {
                    // If bid mode is active and there are selected tickers, use those
                    selectedTokens = [...window.selectedTickers];
                }
                
                // Render token list
                renderTokenList();
                
                console.log('BID Token Selection UI initialized with', tokenDatabase.length, 'tokens');
            })
            .catch(error => {
                console.error('Error initializing BID Token Selection UI:', error);
            });
    }
    
    /**
     * Apply consistent styling to match the regular token panel
     * This function is critical for ensuring the BID token panel looks good
     */
    function applyTokenPanelStyling() {
        console.log('Applying BID token panel styling...');
        
        // First ensure the panel exists
        const bidTickerPanel = document.getElementById('bid-ticker-selection');
        if (!bidTickerPanel) {
            console.log('BID token panel not found, creating it...');
            ensureBidTokenPanelExists();
        }
        
        // Apply main panel styling
        const bidTokenPanel = document.getElementById('bid-ticker-selection');
        if (bidTokenPanel) {
            bidTokenPanel.style.backgroundColor = 'rgba(15, 23, 42, 0.9)';
            bidTokenPanel.style.backdropFilter = 'blur(15px)';
            bidTokenPanel.style.borderRadius = '12px';
            bidTokenPanel.style.border = '1px solid rgba(56, 189, 248, 0.3)';
            bidTokenPanel.style.padding = '15px';
            bidTokenPanel.style.boxShadow = '0 10px 20px rgba(0, 0, 0, 0.3)';
            bidTokenPanel.style.width = '100%';
            bidTokenPanel.style.maxWidth = '450px';
            bidTokenPanel.style.margin = '0 auto';
        }
        
        // Apply search container styling
        const searchContainer = document.querySelector('#bid-ticker-selection .search-container');
        if (searchContainer) {
            searchContainer.className = 'search-container token-search-container';
            searchContainer.style.position = 'relative';
            searchContainer.style.marginBottom = '15px';
            searchContainer.style.width = '100%';
        }
        
        // Apply token list container styling
        const tokenListContainer = document.getElementById('bid-token-list');
        if (tokenListContainer) {
            tokenListContainer.className = 'token-list';
            tokenListContainer.style.maxHeight = '400px';
            tokenListContainer.style.overflowY = 'auto';
            tokenListContainer.style.border = '1px solid rgba(56, 189, 248, 0.3)';
            tokenListContainer.style.borderRadius = '10px';
            tokenListContainer.style.padding = '12px';
            tokenListContainer.style.background = 'rgba(15, 23, 42, 0.85)';
            tokenListContainer.style.backdropFilter = 'blur(15px)';
            tokenListContainer.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.3)';
        }
        
        // Style the search input to match regular panel
        styleSearchInput();
        
        // Setup filter tabs with enhanced styling
        setupFilterTabs();
    }
    
    // Style the search input with enhanced styling to match the regular panel
    function styleSearchInput() {
        console.log('Styling BID search input...');
        
        // First ensure the search input exists
        let searchInput = document.getElementById('bid-token-search');
        let searchContainer = document.querySelector('#bid-ticker-selection .search-container');
        
        if (!searchInput || !searchContainer) {
            console.log('Search input or container not found - panel may need recreation');
            ensureBidTokenPanelExists();
            // Get them again after ensuring the panel exists
            searchInput = document.getElementById('bid-token-search');
            searchContainer = document.querySelector('#bid-ticker-selection .search-container');
        }
        
        if (searchInput) {
            console.log('Found search input, applying styling...');
            // Enhance search input styling with more visible blue accents
            searchInput.style.width = '100%';
            searchInput.style.padding = '12px 12px 12px 38px'; // Extra padding for search icon
            searchInput.style.backgroundColor = 'rgba(15, 23, 42, 0.7)';
            searchInput.style.border = '1px solid rgba(56, 189, 248, 0.4)';
            searchInput.style.borderRadius = '8px';
            searchInput.style.color = '#ffffff';
            searchInput.style.fontSize = '14px';
            searchInput.style.backdropFilter = 'blur(8px)';
            searchInput.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.25)';
            searchInput.style.transition = 'all 0.2s ease';
            
            // Add focus styling
            searchInput.addEventListener('focus', () => {
                searchInput.style.borderColor = 'rgba(56, 189, 248, 0.8)';
                searchInput.style.boxShadow = '0 0 0 3px rgba(56, 189, 248, 0.25)';
                searchInput.style.outline = 'none';
                searchInput.style.backgroundColor = 'rgba(15, 23, 42, 0.9)';
            });
            
            searchInput.addEventListener('blur', () => {
                searchInput.style.borderColor = 'rgba(56, 189, 248, 0.4)';
                searchInput.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.25)';
                searchInput.style.backgroundColor = 'rgba(15, 23, 42, 0.7)';
            });
            
            // Add search icon if not already present
            if (searchContainer && !searchContainer.querySelector('.search-icon')) {
                console.log('Adding search icon...');
                const searchIcon = document.createElement('div');
                searchIcon.className = 'search-icon';
                searchIcon.innerHTML = '🔍'; // Simple search icon
                searchIcon.style.position = 'absolute';
                searchIcon.style.left = '12px';
                searchIcon.style.top = '50%';
                searchIcon.style.transform = 'translateY(-50%)';
                searchIcon.style.color = 'rgba(56, 189, 248, 0.8)';
                searchIcon.style.fontSize = '16px';
                searchIcon.style.pointerEvents = 'none';
                
                searchContainer.style.position = 'relative';
                searchContainer.insertBefore(searchIcon, searchInput);
            }
        } else {
            console.error('Failed to find search input after panel creation');
        }
    }
    
    // Load token data from bid.json
    function loadTokenData() {
        return new Promise((resolve, reject) => {
            fetch('bid.json')
                .then(response => response.json())
                .then(data => {
                    // Transform the bid.json data to match the expected format
                    tokenDatabase = data.map(token => ({
                        symbol: token.symbol || '',
                        address: token.tokenAddress || '',
                        name: token.name || token.symbol || '',
                        hasPool: !!token.hasPool
                    }));

                    console.log(`Loaded ${tokenDatabase.length} BID tokens`);
                    resolve(tokenDatabase);
                })
                .catch(error => {
                    console.error('Error loading bid.json:', error);
                    showMessage('Error loading BID token database', 'error');
                    reject(error);
                });
        });
    }
    
    // Setup filter tabs with enhanced styling to match the regular token panel
    function setupFilterTabs() {
        const filterTabsContainer = document.querySelector('#bid-ticker-selection .token-filter-tabs');
        const filterTabs = document.querySelectorAll('#bid-ticker-selection .token-filter-tab');
        
        // Apply styles to the token list container with darker styling
        if (tokenListContainer) {
            tokenListContainer.style.maxHeight = '400px';
            tokenListContainer.style.overflowY = 'auto';
            tokenListContainer.style.border = '1px solid rgba(56, 189, 248, 0.3)';
            tokenListContainer.style.borderRadius = '10px';
            tokenListContainer.style.marginTop = '10px';
            tokenListContainer.style.padding = '12px';
            tokenListContainer.style.background = 'rgba(15, 23, 42, 0.7)';
            tokenListContainer.style.backdropFilter = 'blur(15px)';
            tokenListContainer.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.3)';
        }
        
        // Apply container styling
        if (filterTabsContainer) {
            filterTabsContainer.style.display = 'flex';
            filterTabsContainer.style.justifyContent = 'space-around';
            filterTabsContainer.style.marginBottom = '15px';
            filterTabsContainer.style.borderRadius = '8px';
            filterTabsContainer.style.background = 'rgba(17, 24, 39, 0.7)';
            filterTabsContainer.style.padding = '8px';
            filterTabsContainer.style.backdropFilter = 'blur(5px)';
            filterTabsContainer.style.border = '1px solid rgba(0, 212, 255, 0.2)';
        }
        
        filterTabs.forEach(tab => {
            // Apply enhanced styling to each tab
            tab.style.padding = '8px 16px';
            tab.style.borderRadius = '6px';
            tab.style.cursor = 'pointer';
            tab.style.transition = 'all 0.2s ease';
            tab.style.color = '#cccccc';
            tab.style.fontSize = '0.9em';
            tab.style.fontWeight = 'bold';
            tab.style.textAlign = 'center';
            tab.style.minWidth = '80px';
            
            // Active tab styling
            if (tab.classList.contains('active')) {
                tab.style.background = 'rgba(0, 212, 255, 0.15)';
                tab.style.color = '#00d4ff';
                tab.style.boxShadow = '0 0 8px rgba(0, 212, 255, 0.2)';
                tab.style.border = '1px solid rgba(0, 212, 255, 0.4)';
            } else {
                tab.style.background = 'transparent';
                tab.style.border = '1px solid transparent';
            }
            
            // Add click handler
            tab.addEventListener('click', function() {
                // Remove active class and styling from all tabs
                filterTabs.forEach(t => {
                    t.classList.remove('active');
                    t.style.background = 'transparent';
                    t.style.color = '#cccccc';
                    t.style.boxShadow = 'none';
                    t.style.border = '1px solid transparent';
                });
                
                // Add active class and styling to clicked tab
                tab.classList.add('active');
                tab.style.background = 'rgba(0, 212, 255, 0.15)';
                tab.style.color = '#00d4ff';
                tab.style.boxShadow = '0 0 8px rgba(0, 212, 255, 0.2)';
                tab.style.border = '1px solid rgba(0, 212, 255, 0.4)';
                
                // Set current filter based on data attribute
                currentFilter = tab.dataset.filter || 'all';
                
                // Apply filter
                applyFilters();
                console.log(`BID token filter changed to: ${currentFilter}`);
            });
        });
    }
    
    // Set active filter and update the UI
    function setActiveFilter(filter) {
        currentFilter = filter || 'all';
        
        // Update filter tab UI
        const filterTabs = document.querySelectorAll('#bid-ticker-selection .token-filter-tab');
        filterTabs.forEach(tab => {
            if (tab.dataset.filter === currentFilter) {
                tab.classList.add('active');
                tab.style.background = 'rgba(0, 212, 255, 0.15)';
                tab.style.color = '#00d4ff';
                tab.style.boxShadow = '0 0 8px rgba(0, 212, 255, 0.2)';
                tab.style.border = '1px solid rgba(0, 212, 255, 0.4)';
            } else {
                tab.classList.remove('active');
                tab.style.background = 'transparent';
                tab.style.color = '#cccccc';
                tab.style.boxShadow = 'none';
                tab.style.border = '1px solid transparent';
            }
        });
        
        // Apply filters
        applyFilters();
    }
    
    // Apply filters to token list based on current filter
    function applyFilters() {
        // Reset current tokens to display
        let filteredTokens = [...tokenDatabase];
        
        // Apply filter
        if (currentFilter === 'selected') {
            filteredTokens = filteredTokens.filter(token => 
                selectedTokens.some(selected => 
                    selected.symbol === token.symbol || 
                    selected.address === token.address
                )
            );
        } else if (currentFilter === 'hasPool') {
            filteredTokens = filteredTokens.filter(token => token.hasPool);
        }
        
        // Render token list with filtered tokens
        currentTokensToDisplay = filteredTokens;
        renderTokenList();
    }
    
    // Set up event listeners for token selection UI
    function setupEventListeners() {
        // Setup filter tabs with enhanced styling
        setupFilterTabs();
        
        // Search input
        if (searchInput) {
            // Remove any existing listeners first
            searchInput.removeEventListener('input', handleSearchInput);
            searchInput.removeEventListener('focus', handleSearchFocus);
            searchInput.removeEventListener('blur', handleSearchBlur);
            
            // Add new listeners
            searchInput.addEventListener('input', handleSearchInput);
            searchInput.addEventListener('focus', handleSearchFocus);
            searchInput.addEventListener('blur', handleSearchBlur);
            
            // Create search dropdown if it doesn't exist
            if (!searchDropdown) {
                searchDropdown = document.createElement('div');
                searchDropdown.id = 'bid-token-search-dropdown';
                searchDropdown.className = 'search-dropdown';
                const searchContainer = document.querySelector('#bid-ticker-selection .search-container');
                if (searchContainer) {
                    searchContainer.style.position = 'relative';
                    searchContainer.appendChild(searchDropdown);
                }
            }
        }
        
        // Select all tokens function
    function selectAll() {
        if (!tokenDatabase || tokenDatabase.length === 0) {
            showMessage('No tokens available to select', 'warning');
            return;
        }
        
        // Select all tokens in the database
        selectedTokens = [...tokenDatabase];
        
        // Update UI
        renderTokenList();
        
        // Update selected count
        updateSelectedTokensCount();
        
        // Update header display
        updateHeaderTokenDisplay();
        
        // Sync with global state
        if (window.isBidModeActive) {
            window.selectedTickers = [...selectedTokens];
            if (window.bidSelectedTickers) {
                window.bidSelectedTickers = [...selectedTokens];
            }
        }
        
        showMessage(`Selected all ${selectedTokens.length} tokens`, 'success');
        console.log(`Selected all ${selectedTokens.length} BID tokens`);
    }
    
    // Clear all tokens function
    function clearAll() {
        if (selectedTokens.length === 0) {
            showMessage('No tokens currently selected', 'info');
            return;
        }
        
        const count = selectedTokens.length;
        
        // Clear selected tokens
        selectedTokens = [];
        
        // Update UI
        renderTokenList();
        
        // Update selected count
        updateSelectedTokensCount();
        
        // Update header display
        updateHeaderTokenDisplay();
        
        // Sync with global state
        if (window.isBidModeActive) {
            window.selectedTickers = [];
            if (window.bidSelectedTickers) {
                window.bidSelectedTickers = [];
            }
        }
        
        showMessage(`Cleared all ${count} selected tokens`, 'info');
        console.log(`Cleared all ${count} BID tokens`);
    }
    
    // Connect select all and clear all buttons with enhanced styling
        const selectAllBtn = document.getElementById('select-all-bid-tickers');
        const clearAllBtn = document.getElementById('clear-all-bid-tickers');
        
        if (selectAllBtn) {
            // Remove existing listeners
            selectAllBtn.onclick = null;
            const newSelectAllBtn = selectAllBtn.cloneNode(true);
            if (selectAllBtn.parentNode) {
                selectAllBtn.parentNode.replaceChild(newSelectAllBtn, selectAllBtn);
            }
            
            // Apply enhanced styling to match regular token panel
            newSelectAllBtn.style.background = 'rgba(0, 212, 255, 0.1)';
            newSelectAllBtn.style.color = '#00d4ff';
            newSelectAllBtn.style.border = '1px solid rgba(0, 212, 255, 0.3)';
            newSelectAllBtn.style.borderRadius = '6px';
            newSelectAllBtn.style.padding = '8px 12px';
            newSelectAllBtn.style.cursor = 'pointer';
            newSelectAllBtn.style.fontWeight = 'bold';
            newSelectAllBtn.style.fontSize = '0.9em';
            newSelectAllBtn.style.transition = 'all 0.2s ease';
            newSelectAllBtn.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
            
            // Add hover effects
            newSelectAllBtn.addEventListener('mouseover', function() {
                this.style.background = 'rgba(0, 212, 255, 0.2)';
                this.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
            });
            
            newSelectAllBtn.addEventListener('mouseout', function() {
                this.style.background = 'rgba(0, 212, 255, 0.1)';
                this.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
            });
            
            // Add click handler
            newSelectAllBtn.addEventListener('click', function() {
                selectAll();
                console.log('Select all BID tokens clicked');
            });
        }
        
        if (clearAllBtn) {
            // Remove existing listeners
            clearAllBtn.onclick = null;
            const newClearAllBtn = clearAllBtn.cloneNode(true);
            if (clearAllBtn.parentNode) {
                clearAllBtn.parentNode.replaceChild(newClearAllBtn, clearAllBtn);
            }
            
            // Apply enhanced styling to match regular token panel
            newClearAllBtn.style.background = 'rgba(220, 53, 69, 0.1)';
            newClearAllBtn.style.color = '#dc3545';
            newClearAllBtn.style.border = '1px solid rgba(220, 53, 69, 0.3)';
            newClearAllBtn.style.borderRadius = '6px';
            newClearAllBtn.style.padding = '8px 12px';
            newClearAllBtn.style.cursor = 'pointer';
            newClearAllBtn.style.fontWeight = 'bold';
            newClearAllBtn.style.fontSize = '0.9em';
            newClearAllBtn.style.transition = 'all 0.2s ease';
            newClearAllBtn.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
            
            // Add hover effects
            newClearAllBtn.addEventListener('mouseover', function() {
                this.style.background = 'rgba(220, 53, 69, 0.2)';
                this.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
            });
            
            newClearAllBtn.addEventListener('mouseout', function() {
                this.style.background = 'rgba(220, 53, 69, 0.1)';
                this.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
            });
            
            // Add click handler
            newClearAllBtn.addEventListener('click', function() {
                clearAll();
                console.log('Clear all BID tokens clicked');
            });
        }
        
        // Add token button
        const addTokenBtn = document.getElementById('add-custom-bid-token');
        if (addTokenBtn) {
            // Clone to remove any existing listeners
            const newAddTokenBtn = addTokenBtn.cloneNode(true);
            if (addTokenBtn.parentNode) {
                addTokenBtn.parentNode.replaceChild(newAddTokenBtn, addTokenBtn);
            }
            newAddTokenBtn.addEventListener('click', addCustomToken);
        }
        
        // Infinite scroll for token list
        if (tokenListContainer) {
            tokenListContainer.addEventListener('scroll', () => {
                if (tokenListContainer.scrollTop + tokenListContainer.clientHeight >= tokenListContainer.scrollHeight - 50) {
                    loadMoreTokens();
                }
            });
        }
        
        console.log('All BID token selection event listeners set up');
    }
    
    // Search focus handler
    function handleSearchFocus() {
        if (searchInput.value.trim().length > 0) {
            handleSearchInput();
        }
    }
    
    // Search blur handler
    function handleSearchBlur() {
        // Delay hiding to allow for click on dropdown items
        setTimeout(hideSearchResults, 200);
    }
    
    // Handle search input with debounce
    function handleSearchInput() {
        const searchValue = searchInput.value.toLowerCase().trim();
        console.log('BID Search input:', searchValue);
        
        // Clear any existing timeout
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }
        
        // Set new timeout
        searchTimeout = setTimeout(() => {
            if (searchValue.length > 0) {
                // Filter tokens based on search value
                const filteredTokens = tokenDatabase.filter(token => 
                    token.symbol.toLowerCase().includes(searchValue) ||
                    (token.name && token.name.toLowerCase().includes(searchValue)) ||
                    (token.address && token.address.toLowerCase().includes(searchValue))
                ).slice(0, 10); // Limit to 10 results for performance
                
                console.log('BID Search filtered tokens:', filteredTokens.length);
                showSearchResults(filteredTokens);
            } else {
                hideSearchResults();
            }
        }, 300);
    }
    
    // Show search results in dropdown
    function showSearchResults(tokens) {
        // Ensure search dropdown exists and is properly positioned
        if (!searchDropdown) {
            searchDropdown = document.createElement('div');
            searchDropdown.id = 'bid-token-search-dropdown';
            searchDropdown.className = 'search-dropdown';
        }
        
        // Get search container and make sure it's set to relative positioning
        const searchContainer = document.querySelector('#bid-ticker-selection .search-container');
        if (searchContainer) {
            searchContainer.style.position = 'relative';
            
            // Append dropdown if it's not already a child
            if (!searchContainer.contains(searchDropdown)) {
                searchContainer.appendChild(searchDropdown);
            }
        }
        
        // Clear dropdown content
        searchDropdown.innerHTML = '';
        
        if (tokens.length === 0) {
            searchDropdown.style.display = 'none';
            return;
        }
        
        // Limit to 10 results for performance
        const displayTokens = tokens.slice(0, 10);
        
        // Create a styled container that matches the regular token panel
        searchDropdown.className = 'search-dropdown';
        searchDropdown.style.width = '100%';
        searchDropdown.style.backgroundColor = 'rgba(17, 24, 39, 0.95)';
        searchDropdown.style.backdropFilter = 'blur(10px)';
        searchDropdown.style.borderRadius = '8px';
        searchDropdown.style.border = '1px solid rgba(0, 212, 255, 0.3)';
        searchDropdown.style.boxShadow = '0 8px 16px rgba(0, 0, 0, 0.3)';
        searchDropdown.style.overflow = 'hidden';
        searchDropdown.style.zIndex = '1000';
        
        displayTokens.forEach(token => {
            const resultItem = document.createElement('div');
            resultItem.className = 'search-result-item';
            
            // Apply token-item styling from wallet-token-styles.css
            resultItem.style.display = 'flex';
            resultItem.style.alignItems = 'center';
            resultItem.style.padding = '10px 12px';
            resultItem.style.margin = '4px';
            resultItem.style.borderRadius = '6px';
            resultItem.style.background = 'rgba(17, 24, 39, 0.7)';
            resultItem.style.border = '1px solid rgba(0, 212, 255, 0.2)';
            resultItem.style.transition = 'all 0.2s ease';
            resultItem.style.cursor = 'pointer';
            resultItem.style.position = 'relative';
            resultItem.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
            resultItem.style.backdropFilter = 'blur(5px)';
            resultItem.style.borderLeft = '3px solid rgba(0, 212, 255, 0.6)';
            
            // Symbol with bold formatting
            const symbol = document.createElement('span');
            symbol.className = 'result-symbol';
            symbol.textContent = token.symbol;
            symbol.style.fontWeight = 'bold';
            symbol.style.color = '#00d4ff';
            symbol.style.marginRight = '10px';
            
            // Token name
            const name = document.createElement('span');
            name.className = 'result-name';
            name.textContent = token.name || 'Unknown';
            name.style.color = '#cccccc';
            name.style.flex = '1';
            name.style.fontSize = '0.9em';
            name.style.overflow = 'hidden';
            name.style.textOverflow = 'ellipsis';
            name.style.whiteSpace = 'nowrap';
            name.style.margin = '0 8px';
            
            // Shortened address
            const address = document.createElement('span');
            address.className = 'result-address';
            address.textContent = shortenAddress(token.address);
            address.style.color = 'rgba(204, 204, 204, 0.6)';
            address.style.fontSize = '0.85em';
            address.style.fontFamily = 'monospace';
            
            // Add elements to the result item
            resultItem.appendChild(symbol);
            resultItem.appendChild(name);
            resultItem.appendChild(address);
            
            // Hover effect
            resultItem.addEventListener('mouseover', () => {
                resultItem.style.background = 'rgba(26, 32, 44, 0.9)';
                resultItem.style.borderColor = 'rgba(0, 212, 255, 0.5)';
                resultItem.style.transform = 'translateY(-2px)';
                resultItem.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.3)';
            });
            
            resultItem.addEventListener('mouseout', () => {
                resultItem.style.background = 'rgba(17, 24, 39, 0.7)';
                resultItem.style.borderColor = 'rgba(0, 212, 255, 0.2)';
                resultItem.style.transform = 'translateY(0)';
                resultItem.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
            });
            
            // Add click handler
            resultItem.addEventListener('click', () => {
                // Select the token if it's not already selected
                if (!isTokenSelected(token)) {
                    selectToken(token);
                    showMessage(`Added ${token.symbol} to selected tokens`, 'success');
                } else {
                    showMessage(`${token.symbol} is already selected`, 'info');
                }
                
                // Clear search input and hide results
                if (searchInput) {
                    searchInput.value = '';
                    hideSearchResults();
                }
            });
            
            // Add to dropdown
            searchDropdown.appendChild(resultItem);
        });
        
        // Show the dropdown
        searchDropdown.style.display = 'block';
        
        // Position the dropdown below the search input
        const searchRect = searchInput.getBoundingClientRect();
        searchDropdown.style.width = `${searchRect.width}px`;
        searchDropdown.style.position = 'absolute';
        searchDropdown.style.top = '100%';
        searchDropdown.style.left = '0';
        
        // Add a subtle animation
        searchDropdown.style.animation = 'fadeIn 0.2s ease-in-out';
        
        console.log('Showing search results dropdown with', displayTokens.length, 'tokens');
    }
    
    // Hide search results dropdown
    function hideSearchResults() {
        if (searchDropdown) {
            searchDropdown.style.display = 'none';
        }
    }
    
    // Add a custom token not in the database
    function addCustomToken() {
        const inputValue = searchInput.value.trim();
        
        if (!inputValue) {
            showMessage('Please enter a token symbol or address', 'warning');
            return;
        }
        
        // Check if input looks like an Ethereum address
        const isAddress = inputValue.startsWith('0x') && inputValue.length >= 40;
        
        // Create a custom token object
        const customToken = {
            symbol: isAddress ? 'CUSTOM' : inputValue.toUpperCase(),
            address: isAddress ? inputValue : '0x0000000000000000000000000000000000000000',
            name: isAddress ? 'Custom Token' : `${inputValue.toUpperCase()} Token`,
            custom: true
        };
        
        // Check if token already exists
        const exists = selectedTokens.some(token => 
            token.symbol === customToken.symbol ||
            token.address.toLowerCase() === customToken.address.toLowerCase()
        );
        
        if (exists) {
            showMessage(`Token ${customToken.symbol} already selected`, 'warning');
            return;
        }
        
        // Add to selected tokens
        selectToken(customToken);
        searchInput.value = '';
        
        showMessage(`Added custom token: ${customToken.symbol}`, 'success');
    }
    
    // Render the token list based on current filter
    function renderTokenList() {
        if (!tokenListContainer) return;
        
        // Filter tokens according to current tab
        if (currentFilter === 'selected') {
            currentTokensToDisplay = tokenDatabase.filter(token => 
                selectedTokens.some(selected => 
                    selected.symbol === token.symbol || 
                    selected.address === token.address
                )
            );
        } else if (currentFilter === 'pool') {
            currentTokensToDisplay = tokenDatabase.filter(token => token.hasPool);
        } else {
            // All tokens
            currentTokensToDisplay = [...tokenDatabase];
        }
        
        // Reset visible count and clear container
        visibleTokenCount = INITIAL_BATCH_SIZE;
        tokenListContainer.innerHTML = '';
        
        if (currentTokensToDisplay.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'empty-list-message';
            emptyMessage.textContent = currentFilter === 'selected' 
                ? 'No tokens selected yet' 
                : currentFilter === 'pool'
                    ? 'No tokens with pools found'
                    : 'No tokens available';
            tokenListContainer.appendChild(emptyMessage);
            return;
        }
        
        // Render initial batch
        renderTokenBatch(0, Math.min(visibleTokenCount, currentTokensToDisplay.length), tokenListContainer);
        
        // Update selected tokens count display
        updateSelectedTokensCount();
        
        // Also sync with global state
        window.selectedTickers = [...selectedTokens];
        
        // Update original bidSelectedTickers if it exists
        if (window.bidSelectedTickers) {
            window.bidSelectedTickers = [...selectedTokens];
        }
    }
    
    // Function to render a batch of tokens with enhanced styling
    function renderTokenBatch(startIdx, endIdx, container) {
        const fragment = document.createDocumentFragment();
        const tokensToRender = currentTokensToDisplay.slice(startIdx, endIdx);
        
        tokensToRender.forEach(token => {
            // Create token item with enhanced styling to match regular panel
            const tokenItem = document.createElement('div');
            tokenItem.className = 'token-item';
            
            // Apply enhanced styling with more visible dark blue background
            tokenItem.style.display = 'flex';
            tokenItem.style.alignItems = 'center';
            tokenItem.style.padding = '10px 12px';
            tokenItem.style.marginBottom = '5px';
            tokenItem.style.borderRadius = '8px';
            tokenItem.style.background = 'rgba(15, 23, 42, 0.85)';
            tokenItem.style.border = '1px solid rgba(56, 189, 248, 0.3)';
            tokenItem.style.transition = 'all 0.2s ease';
            tokenItem.style.cursor = 'pointer';
            tokenItem.style.position = 'relative';
            tokenItem.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.25)';
            tokenItem.style.backdropFilter = 'blur(10px)';
            tokenItem.style.borderLeft = '4px solid rgba(56, 189, 248, 0.7)';
            
            // Add selected styling if token is selected
            const isSelected = isTokenSelected(token);
            if (isSelected) {
                tokenItem.classList.add('selected');
                tokenItem.style.background = 'rgba(56, 189, 248, 0.25)';
                tokenItem.style.border = '1px solid rgba(56, 189, 248, 0.8)';
                tokenItem.style.boxShadow = '0 0 15px rgba(56, 189, 248, 0.4)';
                tokenItem.style.transform = 'translateY(-2px)';
            }
            
            // Create checkbox for selection with improved styling
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'token-checkbox';
            checkbox.checked = isSelected;
            checkbox.style.marginRight = '10px';
            checkbox.style.cursor = 'pointer';
            checkbox.style.accentColor = '#00d4ff';
            checkbox.style.width = '18px';
            checkbox.style.height = '18px';
            // Add click handler for the entire token info area (excluding checkbox)
            tokenInfo.addEventListener('click', () => {
                checkbox.checked = !checkbox.checked;
                const changeEvent = new Event('change');
                checkbox.dispatchEvent(changeEvent);
            });
            
            // Add elements to token item
            tokenItem.appendChild(checkbox);
            tokenItem.appendChild(tokenInfo);
            
            // Add to fragment
            fragment.appendChild(tokenItem);
        });
        
        // Add fragment to container
        container.appendChild(fragment);
    }
    
    // Function to handle scroll event for loading more tokens
    function handleTokenScroll() {
        if (!tokenListContainer) return;
        
        const { scrollTop, scrollHeight, clientHeight } = tokenListContainer;
        
        // If scrolled near the bottom, load more tokens
        if (scrollTop + clientHeight >= scrollHeight - 50) {
            // Check if there are more tokens to display
            if (visibleTokenCount < currentTokensToDisplay.length) {
                const startIdx = visibleTokenCount;
                visibleTokenCount = Math.min(visibleTokenCount + BATCH_INCREMENT, currentTokensToDisplay.length);
                
                // Render the next batch
                renderTokenBatch(startIdx, visibleTokenCount, tokenListContainer);
            }
        }
    }
    
    // Select a token
    function selectToken(token) {
        // Check if already selected
        const isAlreadySelected = selectedTokens.some(selected => 
            selected.symbol === token.symbol || 
            selected.address === token.address
        );
        
        if (isAlreadySelected) {
            console.log(`Token ${token.symbol} already selected, ignoring`);
            return;
        }
        
        // Add to selected tokens
        selectedTokens.push(token);
        
        // Update the UI
        renderTokenList();
        
        // Update global state
        window.selectedTickers = [...selectedTokens];
        
        // Update the header display
        updateHeaderTokenDisplay();
        
        // Update selected tokens count
        updateSelectedTokensCount();
        
        showMessage(`Added ${token.symbol} to selected tokens`, 'success');
    }
    
    // Check if a token is selected
    function isTokenSelected(token) {
        return selectedTokens.some(selected => 
            selected.symbol === token.symbol || 
            selected.address === token.address
        );
    }
    
    // Deselect a token
    function deselectToken(token) {
        // Find the token in the selected tokens
        const index = selectedTokens.findIndex(selected => 
            selected.symbol === token.symbol || 
            selected.address === token.address
        );
        
        if (index === -1) {
            console.log(`Token ${token.symbol} not in selected tokens, ignoring`);
            return;
        }
        
        // Remove from selected tokens
        selectedTokens.splice(index, 1);
        
        // Update the UI
        renderTokenList();
        
        // Update global state
        window.selectedTickers = [...selectedTokens];
        
        // Update the header display
        updateHeaderTokenDisplay();
        
        // Update selected tokens count
        updateSelectedTokensCount();
        
        showMessage(`Removed ${token.symbol} from selected tokens`, 'info');
    }
    
    // Clear all selected tokens
    function clearAllTokens() {
        if (selectedTokens.length === 0) {
            showMessage('No tokens to clear', 'info');
            return;
        }
        
        selectedTokens = [];
        renderTokenList();
        
        // Update global state
        window.selectedTickers = [];
        
        // Sync with the original bidSelectedTickers if it exists
        if (window.bidSelectedTickers) {
            window.bidSelectedTickers = [];
        }
        
        // Update the header display
        updateHeaderTokenDisplay();
        
        // Update selected tokens count
        updateSelectedTokensCount();
        
        showMessage('All tokens cleared', 'info');
        console.log('Cleared all BID tokens');
    }
    
    // Update the selected tokens count display
    function updateSelectedTokensCount() {
        const countElement = document.getElementById('bid-selected-tokens-count');
        if (countElement) {
            countElement.textContent = selectedTokens.length;
            
            // Enhanced styling
            countElement.style.fontWeight = 'bold';
            countElement.style.color = '#00d4ff';
            countElement.style.background = 'rgba(0, 212, 255, 0.15)';
            countElement.style.padding = '3px 8px';
            countElement.style.borderRadius = '12px';
            countElement.style.fontSize = '0.9em';
            countElement.style.display = 'inline-block';
            countElement.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
        }
        
        // Also update the legacy count elements
        const bidTokenCountElements = document.querySelectorAll('.bid-token-count');
        bidTokenCountElements.forEach(element => {
            element.textContent = selectedTokens.length;
        });
    }
    
    // Update the header token display
    function updateHeaderTokenDisplay() {
        const headerTokensDisplay = document.getElementById('bid-selected-tokens-display');
        if (!headerTokensDisplay) return;
        
        // Clear the current display
        headerTokensDisplay.innerHTML = '';
        
        // Show up to 5 tokens with pills
        const tokensToDisplay = selectedTokens.slice(0, 5);
        tokensToDisplay.forEach(token => {
            const tokenPill = document.createElement('span');
            tokenPill.className = 'token-pill';
            tokenPill.textContent = token.symbol;
            
            // Apply enhanced styling
            tokenPill.style.display = 'inline-block';
            tokenPill.style.padding = '2px 8px';
            tokenPill.style.margin = '0 4px 4px 0';
            tokenPill.style.borderRadius = '12px';
            tokenPill.style.fontSize = '0.85em';
            tokenPill.style.fontWeight = 'bold';
            tokenPill.style.background = 'rgba(0, 212, 255, 0.15)';
            tokenPill.style.color = '#00d4ff';
            tokenPill.style.border = '1px solid rgba(0, 212, 255, 0.3)';
            tokenPill.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
            
            headerTokensDisplay.appendChild(tokenPill);
        });
        
        // Show count if there are more tokens
        if (selectedTokens.length > 5) {
            const morePill = document.createElement('span');
            morePill.className = 'token-pill';
            morePill.textContent = `+${selectedTokens.length - 5} more`;
            
            // Style for the more pill
            morePill.style.display = 'inline-block';
            morePill.style.padding = '2px 8px';
            morePill.style.margin = '0 4px 4px 0';
            morePill.style.borderRadius = '12px';
            morePill.style.fontSize = '0.85em';
            morePill.style.fontWeight = 'bold';
            morePill.style.background = 'rgba(255, 255, 255, 0.1)';
            morePill.style.color = '#ffffff';
            morePill.style.border = '1px solid rgba(255, 255, 255, 0.2)';
            
            headerTokensDisplay.appendChild(morePill);
        }
        
        // Show a message if no tokens are selected
        if (selectedTokens.length === 0) {
            const noTokensMsg = document.createElement('span');
            noTokensMsg.textContent = 'No tokens selected';
            noTokensMsg.style.color = 'rgba(255, 255, 255, 0.6)';
            noTokensMsg.style.fontStyle = 'italic';
            noTokensMsg.style.fontSize = '0.9em';
            
            headerTokensDisplay.appendChild(noTokensMsg);
        }
        
        // Also update legacy display format
        const bidTickerCountElem = document.getElementById('selected-bid-ticker-count');
        if (bidTickerCountElem) {
            if (selectedTokens.length > 0) {
                const tickers = selectedTokens.map(token => token.symbol).join(', ');
                bidTickerCountElem.innerHTML = `<span class="bid-token-count">${selectedTokens.length}</span> (${tickers})`;
            } else {
                bidTickerCountElem.innerHTML = `<span class="bid-token-count">0</span> tokens selected`;
            }
        }
    }
    
    // Show a message in the token messages area with enhanced styling
    function showMessage(message, type = 'info') {
        const messagesContainer = document.getElementById('bid-token-messages');
        if (!messagesContainer) return;
        
        // Create message element with enhanced styling
        const messageElement = document.createElement('div');
        messageElement.className = `alert alert-${type}`;
        messageElement.innerHTML = message;
        messageElement.style.padding = '10px 15px';
        messageElement.style.margin = '8px 0';
        messageElement.style.borderRadius = '6px';
        messageElement.style.fontSize = '0.95em';
        messageElement.style.backdropFilter = 'blur(5px)';
        messageElement.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
        messageElement.style.transition = 'all 0.3s ease-in-out';
        
        // Apply type-specific styling
        switch (type) {
            case 'success':
                messageElement.style.background = 'rgba(25, 135, 84, 0.15)';
                messageElement.style.borderLeft = '4px solid #198754';
                messageElement.style.color = '#d1e7dd';
                break;
            case 'error':
                messageElement.style.background = 'rgba(220, 53, 69, 0.15)';
                messageElement.style.borderLeft = '4px solid #dc3545';
                messageElement.style.color = '#f8d7da';
                break;
            case 'warning':
                messageElement.style.background = 'rgba(255, 193, 7, 0.15)';
                messageElement.style.borderLeft = '4px solid #ffc107';
                messageElement.style.color = '#fff3cd';
                break;
            case 'info':
            default:
                messageElement.style.background = 'rgba(13, 110, 253, 0.15)';
                messageElement.style.borderLeft = '4px solid #0d6efd';
                messageElement.style.color = '#e8f4fd';
                break;
        }
        
        // Clear previous messages
        messagesContainer.innerHTML = '';
        messagesContainer.appendChild(messageElement);
        
        // Add fade-in animation
        messageElement.style.opacity = '0';
        setTimeout(() => {
            messageElement.style.opacity = '1';
        }, 10);
        
        // Auto-clear after a delay with fade-out
        setTimeout(() => {
            messageElement.style.opacity = '0';
            messageElement.style.transform = 'translateY(-10px)';
            
            setTimeout(() => {
                if (messagesContainer.contains(messageElement)) {
                    messagesContainer.removeChild(messageElement);
                }
            }, 300); // Match the CSS transition duration
        }, 5000);
    }
    
    // Helper: Shorten address for display
    function shortenAddress(address) {
        if (!address) return '';
        return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    }
    
    // Helper functions for global BID token functionality
    // These are to ensure compatibility with existing code
    
    // Compatible with the global API used by renderer.js
    function selectAllBidTickers() {
        selectAll();
    }
    
    function clearAllBidTickers() {
        clearAll();
    }
    
    // Public API
    return {
        init,
        getSelectedTokens: () => selectedTokens,
        setSelectedTokens: (tokens) => {
            selectedTokens = tokens;
            renderTokenList();
        },
        addToken: selectToken,
        removeToken: deselectToken,
        clearAll,
        selectAll,
        selectAllBidTickers,
        clearAllBidTickers
    };
})();

// Initialize when the document is ready and BID mode is active
document.addEventListener('DOMContentLoaded', () => {
    // Make functions globally accessible for compatibility with existing code
    window.selectAllBidTickers = window.BidTokenSelectionUI.selectAllBidTickers;
    window.clearAllBidTickers = window.BidTokenSelectionUI.clearAllBidTickers;
        
    // Initialize if BID mode is active
    if (window.isBidModeActive) {
        window.BidTokenSelectionUI.init();
    }
});

// Listen for BID mode toggle to initialize UI when needed
function initBidTokenUIOnBidModeChange() {
    const bidModeBtn = document.getElementById('bid-mode-toggle');
    if (bidModeBtn) {
        bidModeBtn.addEventListener('click', () => {
            // Wait a short time for toggleBidMode to complete
            setTimeout(() => {
                if (window.isBidModeActive) {
                    window.BidTokenSelectionUI.init();
                }
            }, 300);
        });
    }
}

// Initialize the event listeners
document.addEventListener('DOMContentLoaded', () => {
    initBidTokenUIOnBidModeChange();
        
    // Also initialize if BID mode is already active
    if (window.isBidModeActive) {
        window.BidTokenSelectionUI.init();
    }
        
    // Add necessary CSS styles to match the regular token panel
    addTokenPanelStyles();
});

// Add CSS styles to ensure the BID token panel matches the regular token panel
function addTokenPanelStyles() {
    const style = document.createElement('style');
    style.textContent = `
    /* Enhanced BID Token Panel Styles to match regular token panel */
    
    /* Scrollbar Styling */
    #bid-token-list::-webkit-scrollbar {
        width: 8px;
    }
    
    #bid-token-list::-webkit-scrollbar-track {
        background: rgba(17, 24, 39, 0.5);
        border-radius: 10px;
    }
    
    #bid-token-list::-webkit-scrollbar-thumb {
        background: rgba(0, 212, 255, 0.3);
        border-radius: 10px;
        border: 2px solid rgba(0, 212, 255, 0.1);
    }
    
    #bid-token-list::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 212, 255, 0.5);
    }
    
    /* BID Token Search Dropdown Styles */
    #bid-token-search-dropdown {
        position: absolute;
        width: 100%;
        max-height: 300px;
        overflow-y: auto;
        background: rgba(17, 24, 39, 0.95);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(0, 212, 255, 0.3);
        border-radius: 0 0 8px 8px;
        z-index: 1000;
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
        display: none;
        margin-top: 5px;
    }
        
    #bid-token-search-dropdown .search-result-item {
        padding: 10px 12px;
        border-bottom: 1px solid rgba(0, 212, 255, 0.1);
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        transition: all 0.2s ease;
    }
        
    #bid-token-search-dropdown .search-result-item:hover {
        background-color: rgba(0, 212, 255, 0.1);
        transform: translateX(5px);
    }
        
    #bid-token-search-dropdown .result-symbol {
        font-weight: bold;
        margin-right: 8px;
        color: #00d4ff;
        min-width: 60px;
    }
        
    #bid-token-search-dropdown .result-name {
        color: #cccccc;
        flex: 1;
        font-size: 0.9em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin: 0 8px;
    }
        
    #bid-token-search-dropdown .result-address {
        color: rgba(204, 204, 204, 0.6);
        font-size: 0.85em;
        font-family: monospace;
    }
        
    /* Token List Styles */
    #bid-token-list {
        max-height: 400px;
        overflow-y: auto;
        border: 1px solid rgba(0, 212, 255, 0.2);
        border-radius: 8px;
        margin-top: 10px;
        padding: 10px;
        background: rgba(17, 24, 39, 0.7);
        backdrop-filter: blur(10px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
        
    #bid-token-list .token-item {
        display: flex;
        align-items: center;
        padding: 10px 12px;
        margin-bottom: 5px;
        border-radius: 6px;
        background: rgba(17, 24, 39, 0.7);
        border: 1px solid rgba(0, 212, 255, 0.2);
        transition: all 0.2s ease;
        cursor: pointer;
        position: relative;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(5px);
        border-left: 3px solid rgba(0, 212, 255, 0.6);
    }
        
    #bid-token-list .token-item:hover {
        background: rgba(26, 32, 44, 0.9);
        border-color: rgba(0, 212, 255, 0.5);
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
    }
        
        #bid-token-list .token-item.selected {
            background: rgba(0, 212, 255, 0.15);
            border: 1px solid rgba(0, 212, 255, 0.4);
            box-shadow: 0 0 8px rgba(0, 212, 255, 0.2);
        }
        
        #bid-token-list .token-checkbox {
            margin-right: 10px;
            cursor: pointer;
            accent-color: #00d4ff;
            width: 18px;
            height: 18px;
        }
        
        #bid-token-list .token-symbol {
            font-weight: bold;
            margin-right: 10px;
            color: #00d4ff;
            min-width: 60px;
        }
        
        #bid-token-list .token-name {
            color: #cccccc;
            flex: 1;
            font-size: 0.9em;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            margin: 0 8px;
        }
        
        #bid-token-list .token-address {
            color: rgba(204, 204, 204, 0.6);
            font-size: 0.85em;
            font-family: monospace;
        }
        
        /* Filter Tabs Styles */
        #bid-ticker-selection .token-filter-tabs {
            display: flex;
            justify-content: space-around;
            margin-bottom: 15px;
            border-radius: 8px;
            background: rgba(17, 24, 39, 0.7);
            padding: 8px;
            backdrop-filter: blur(5px);
            border: 1px solid rgba(0, 212, 255, 0.2);
        }
        
        #bid-ticker-selection .token-filter-tab {
            background: transparent;
            border: 1px solid transparent;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s ease;
            color: #cccccc;
            font-size: 0.9em;
            font-weight: bold;
            text-align: center;
            min-width: 80px;
        }
        
        #bid-ticker-selection .token-filter-tab:hover:not(.active) {
            background: rgba(0, 212, 255, 0.05);
            color: rgba(0, 212, 255, 0.8);
        }
        
        #bid-ticker-selection .token-filter-tab.active {
            background: rgba(0, 212, 255, 0.15);
            color: #00d4ff;
            box-shadow: 0 0 8px rgba(0, 212, 255, 0.2);
            border: 1px solid rgba(0, 212, 255, 0.4);
        }
        
        /* Message Styles */
        #bid-token-messages {
            margin: 10px 0;
            min-height: 30px;
        }
        
        #bid-token-messages .alert {
            padding: 8px 12px;
            border-radius: 4px;
            margin-bottom: 10px;
        }
        
        #bid-token-messages .alert-info {
            background-color: #e8f4fd;
            border-left: 3px solid #0d6efd;
        }
        
        #bid-token-messages .alert-success {
            background-color: #d1f0d5;
            border-left: 3px solid #28a745;
        }
        
        #bid-token-messages .alert-warning {
            background-color: #fff3cd;
            border-left: 3px solid #ffc107;
        }
        
        #bid-token-messages .alert-error {
            background-color: #f8d7da;
            border-left: 3px solid #dc3545;
        }
    `;
    
    // Append the style element to the document head
    document.head.appendChild(style);
}
