/**
 * Token Selection UI Module
 * Manages the token selection interface, including loading tokens from a database,
 * filtering, searching, and selection of tokens.
 */

// Import the console logger to ensure logs reach the command prompt
try {
    const consoleLogger = require('./console-logger');
    consoleLogger.setup();
    console.log('📝 TOKEN-SELECTION: Console logger initialized');
} catch (err) {
    console.error('Error setting up console logger:', err);
}

// Token Selection Module
window.TokenSelectionUI = (function() {
    // Private variables
    let tokenDatabase = [];
    let selectedTokens = [];
    let tokenListContainer = null;
    let tokenFilterTabs = null;
    let searchInput = null;
    let searchDropdown = null;
    let currentFilter = 'all';
    
    // Initialize the module
    function init() {
        console.log('Initializing Token Selection UI');
        tokenListContainer = document.getElementById('token-list');
        tokenFilterTabs = document.querySelectorAll('.token-filter-tab');
        searchInput = document.getElementById('token-search');
        searchDropdown = document.getElementById('token-search-dropdown');
        
        // Set up event listeners
        setupEventListeners();
        
        // Load token data from base.json
        loadTokenData();
        
        // Check for tokens in memory
        if (window.TokenPersistence) {
            const memoryTokens = window.TokenPersistence.getTokens();
            if (memoryTokens && memoryTokens.length > 0) {
                console.log(`Loading ${memoryTokens.length} tokens from memory`);
                selectedTokens = [...memoryTokens];
            }
        } else if (window.selectedTickers && window.selectedTickers.length > 0) {
            console.log(`Loading ${window.selectedTickers.length} tokens from global state`);
            selectedTokens = [...window.selectedTickers];
        }
    }
    
    // Load token data from base.json
    function loadTokenData() {
        fetch('base.json')
            .then(response => response.json())
            .then(data => {
                tokenDatabase = data;
                renderTokenList();
            })
            .catch(error => {
                console.error('Error loading token database:', error);
                showMessage('Error loading token database', 'error');
            });
    }
    
    // Set up event listeners for token selection UI
    function setupEventListeners() {
        // Filter tabs
        tokenFilterTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tokenFilterTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentFilter = tab.getAttribute('data-filter');
                renderTokenList();
            });
        });
        
        // Search input
        if (searchInput) {
            searchInput.addEventListener('input', handleSearchInput);
        }
        
        // Clear all button
        const clearAllBtn = document.querySelector('.btn-clear-all');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', clearAllTokens);
        }
        
        // Add token button
        const addTokenBtn = document.getElementById('btn-add-token');
        if (addTokenBtn) {
            addTokenBtn.addEventListener('click', addCustomToken);
        }
        
        // Click outside to close dropdown
        document.addEventListener('click', (e) => {
            if (searchDropdown && !searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
                hideSearchResults();
            }
        });
    }
    
    // Handle search input with debounce
    function handleSearchInput() {
        const searchValue = searchInput.value.toLowerCase().trim();
        
        // Clear any existing timeout
        if (window.searchTimeout) {
            clearTimeout(window.searchTimeout);
        }
        
        // For empty search, hide immediately (no debounce needed)
        if (searchValue.length === 0) {
            hideSearchResults();
            return;
        }
        
        // Set new timeout for non-empty search
        window.searchTimeout = setTimeout(() => {
            // Always use the current input value at execution time
            const currentValue = searchInput.value.toLowerCase().trim();
            
            // If input is now empty, hide results
            if (currentValue.length === 0) {
                hideSearchResults();
                return;
            }
            
            // Filter tokens based on current search value
            const filteredTokens = tokenDatabase.filter(token => 
                token.symbol.toLowerCase().includes(currentValue) ||
                token.tokenAddress.toLowerCase().includes(currentValue)
            );
            
            // Show dropdown with search results
            showSearchResults(filteredTokens);
        }, 300); // 300ms debounce
    }
    
    // Show search results in dropdown
    function showSearchResults(tokens) {
        if (!searchDropdown) {
            console.error('Search dropdown element not found!');
            searchDropdown = document.getElementById('token-search-dropdown');
            if (!searchDropdown) return;
        }
        
        searchDropdown.innerHTML = '';
        searchDropdown.style.display = 'block';
        
        if (tokens.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'search-result-item';
            noResults.textContent = 'No tokens found';
            searchDropdown.appendChild(noResults);
            return;
        }
        
        // Limit to top 5 results
        const displayTokens = tokens.slice(0, 5);
        
        displayTokens.forEach(token => {
            // Strip leading $ from symbol for display
            const displaySymbol = token.symbol && token.symbol.startsWith('$') 
                ? token.symbol.substring(1) 
                : token.symbol;
        
            const resultItem = document.createElement('div');
            resultItem.className = 'search-result-item';
            resultItem.innerHTML = `
                <div class="token-symbol">${displaySymbol}</div>
                <div class="token-address">${shortenAddress(token.tokenAddress)}</div>
            `;
            
            resultItem.addEventListener('click', () => {
                selectToken(token);
                hideSearchResults();
                if (searchInput) searchInput.value = '';
            });
            
            searchDropdown.appendChild(resultItem);
        });
    }
    
    // Hide search results dropdown
    function hideSearchResults() {
        if (!searchDropdown) {
            searchDropdown = document.getElementById('token-search-dropdown');
        }
        if (searchDropdown) {
            searchDropdown.style.display = 'none';
        }
    }
    
    // Add a custom token not in the database
    function addCustomToken() {
        const address = searchInput.value.trim();
        
        if (!address || !address.startsWith('0x') || address.length !== 42) {
            showMessage('Please enter a valid token address', 'error');
            return;
        }
        
        // Check if token already exists in database
        const existingToken = tokenDatabase.find(t => 
            t.tokenAddress.toLowerCase() === address.toLowerCase()
        );
        
        if (existingToken) {
            selectToken(existingToken);
            searchInput.value = '';
            return;
        }
        
        // Create new token object
        const newToken = {
            symbol: 'CUSTOM',
            tokenAddress: address,
            lpAddress: '',
            mcapInVirtual: 0,
            isCustom: true
        };
        
        // Add to database
        tokenDatabase.push(newToken);
        
        // Select the token
        selectToken(newToken);
        searchInput.value = '';
        
        showMessage(`Custom token added: ${shortenAddress(address)}`, 'success');
    }
    
    // Initial batch size and currently visible tokens
    const INITIAL_BATCH_SIZE = 30;
    const BATCH_INCREMENT = 15;
    let visibleTokenCount = INITIAL_BATCH_SIZE;
    let currentTokensToDisplay = [];
    
    // Render the token list based on current filter
    function renderTokenList() {
        if (!tokenListContainer) return;
        
        tokenListContainer.innerHTML = '';
        
        // Apply filter
        let tokensToDisplay = tokenDatabase;
        
        if (currentFilter === 'selected') {
            tokensToDisplay = tokenDatabase.filter(token => 
                selectedTokens.some(selected => selected.tokenAddress === token.tokenAddress)
            );
        } else if (currentFilter === 'pool') {
            // Show tokens with pool (has mcapInVirtual means has pool)
            tokensToDisplay = tokenDatabase.filter(token => token.mcapInVirtual);
        }
        
        // Sort tokens alphabetically by symbol
        tokensToDisplay.sort((a, b) => a.symbol.localeCompare(b.symbol));
        
        // Save reference to current tokens for scroll loading
        currentTokensToDisplay = tokensToDisplay;
        
        // Reset visible count when filter changes
        visibleTokenCount = Math.min(INITIAL_BATCH_SIZE, tokensToDisplay.length);
        
        // Show empty state if no tokens
        if (tokensToDisplay.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'token-empty-state';
            emptyMessage.textContent = 'No tokens found matching current filter';
            tokenListContainer.appendChild(emptyMessage);
            return;
        }
        
        // Create container for tokens with scrolling
        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'token-scroll-container';
        tokenListContainer.appendChild(scrollContainer);
        
        // Create a document fragment for better performance
        const fragment = document.createDocumentFragment();
        
        // Only render the initial batch of tokens
        renderTokenBatch(0, visibleTokenCount, scrollContainer);
        
        // Add scroll event listener to container for loading more tokens
        tokenListContainer.addEventListener('scroll', handleTokenScroll);

        // Update the selected tokens count in the UI
        updateSelectedTokensCount();
    }
    
    // Function to render a batch of tokens
    function renderTokenBatch(startIdx, endIdx, container) {
        // Create a document fragment for better performance
        const fragment = document.createDocumentFragment();
        
        // Get the range of tokens to display
        const tokensSlice = currentTokensToDisplay.slice(startIdx, endIdx);
        
        // Create token items for this batch
        tokensSlice.forEach(token => {
            const isSelected = selectedTokens.some(
                selected => selected.tokenAddress === token.tokenAddress
            );
            
            const tokenItem = document.createElement('div');
            tokenItem.className = `token-item ${isSelected ? 'selected' : ''}`;
            tokenItem.setAttribute('data-address', token.tokenAddress);
            
            // Format price display
            const priceDisplay = token.mcapInVirtual 
                ? `$${formatNumber(token.mcapInVirtual)}`
                : '—';
            
            // Strip leading $ from symbol for display
            const displaySymbol = token.symbol && token.symbol.startsWith('$') 
                ? token.symbol.substring(1) 
                : token.symbol;
            
            // Use innerHTML for simplicity but could be optimized further
            tokenItem.innerHTML = `
                <input type="checkbox" ${isSelected ? 'checked' : ''}>
                <div class="token-info">
                    <span class="token-symbol">${displaySymbol}</span>
                    <span class="token-address">${shortenAddress(token.tokenAddress)}</span>
                    <span class="token-price">${priceDisplay}</span>
                </div>
            `;
            
            // Add click events
            const checkbox = tokenItem.querySelector('input[type="checkbox"]');
            
            // Checkbox change event
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    selectToken(token);
                } else {
                    deselectToken(token);
                }
            });
            
            // Click anywhere on the row also toggles the checkbox
            tokenItem.addEventListener('click', (e) => {
                // Only toggle if not clicking the checkbox directly
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                    
                    // Trigger the change event
                    const changeEvent = new Event('change');
                    checkbox.dispatchEvent(changeEvent);
                }
            });
            
            fragment.appendChild(tokenItem);
        });
        
        // Add the fragment to the container
        container.appendChild(fragment);
    }
    
    // Function to handle scroll event for loading more tokens
    function handleTokenScroll() {
        // Only load more if we haven't loaded all tokens yet
        if (visibleTokenCount >= currentTokensToDisplay.length) return;
        
        const container = tokenListContainer;
        const scrollPosition = container.scrollTop;
        const containerHeight = container.offsetHeight;
        const contentHeight = container.scrollHeight;
        
        // When user scrolls near the bottom, load more tokens
        if (contentHeight - (scrollPosition + containerHeight) < 200) {
            // Increase the number of visible tokens
            const prevVisibleCount = visibleTokenCount;
            visibleTokenCount = Math.min(visibleTokenCount + BATCH_INCREMENT, currentTokensToDisplay.length);
            
            // If we actually increased the count, render more tokens
            if (visibleTokenCount > prevVisibleCount) {
                renderTokenBatch(
                    prevVisibleCount,
                    visibleTokenCount,
                    tokenListContainer.querySelector('.token-scroll-container')
                );
            }
        }
    }
    
    // Sync with global state
    function syncWithGlobalState() {
        // Update global selectedTickers
        window.selectedTickers = [...selectedTokens];

        // Update header display
        updateHeaderTokenDisplay();
    }

    // Update the header token display
    function updateHeaderTokenDisplay() {
        const tokenDisplay = document.getElementById('selected-tokens-display');
        if (!tokenDisplay) return;

        const enabledTokens = selectedTokens.filter(token => token.enabled !== false);

        if (enabledTokens.length === 0) {
            tokenDisplay.innerHTML = '';
            return;
        }

        tokenDisplay.innerHTML = '';
        
        // Display all tokens - they'll be in a scrollbox
        const tokensToDisplay = enabledTokens;

        // Create chips for each token
        tokensToDisplay.forEach(token => {
            // Strip leading $ from symbol for display
            const rawSymbol = token.symbol || shortenAddress(token.tokenAddress);
            const symbol = rawSymbol && rawSymbol.startsWith('$') 
                ? rawSymbol.substring(1) 
                : rawSymbol;
            const tokenChip = document.createElement('span');
            tokenChip.className = 'selected-token-chip';
            tokenChip.setAttribute('data-token-id', token.id || token.address || token.symbol);

            // Create text span with truncation
            const textSpan = document.createElement('span');
            textSpan.className = 'chip-text';
            textSpan.textContent = symbol;
            tokenChip.appendChild(textSpan);

            // Create remove button
            const removeBtn = document.createElement('button');
            removeBtn.className = 'token-remove-btn';
            removeBtn.textContent = '×';
            
            // Use a cleaner reference to the original token object
            removeBtn.onclick = (function(tokenObj) {
                return function(event) {
                    event.stopPropagation();
                    console.log('Removing token:', tokenObj);
                    deselectToken(tokenObj);
                };
            })(token);
            
            tokenChip.appendChild(removeBtn);
            tokenDisplay.appendChild(tokenChip);
        });
    }

// ... (rest of the code remains the same)
    // Select a token
    function selectToken(token) {
        console.log(`🔍 TOKEN-SELECTION: Attempting to select token ${token.symbol} (${token.tokenAddress})`);
        // Check if already selected
        if (!selectedTokens.some(t => t.tokenAddress === token.tokenAddress)) {
            console.log(`➕ TOKEN-SELECTION: Adding token to selectedTokens array`);
            selectedTokens.push(token);
            console.log(`📊 TOKEN-SELECTION: Current selected tokens count: ${selectedTokens.length}`);

            // If we're in 'disabled' filter, switch to 'all' to show the selection
            if (currentFilter === 'disabled') {
                console.log(`🔄 TOKEN-SELECTION: Switching from disabled filter to all filter`);
                currentFilter = 'all';
                tokenFilterTabs.forEach(tab => {
                    if (tab.getAttribute('data-filter') === 'all') {
                        tab.click();
                    }
                });
            } else {
                // Just re-render the list
                console.log(`🎨 TOKEN-SELECTION: Re-rendering token list with current filter: ${currentFilter}`);
                renderTokenList();
            }
            
            // Update the header display
            console.log(`🖥️ TOKEN-SELECTION: Updating header token display`);
            updateHeaderTokenDisplay();
            
            // Save to persistent storage
            console.log(`💾 TOKEN-SELECTION: Checking for TokenPersistence availability...`);
            if (window.TokenPersistence && typeof window.TokenPersistence.saveTokens === 'function') {
                console.log(`📤 TOKEN-SELECTION: Calling TokenPersistence.saveTokens() with ${selectedTokens.length} tokens`);
                window.TokenPersistence.saveTokens([...selectedTokens]);
            } else {
                console.error(`❌ TOKEN-SELECTION: TokenPersistence not available or saveTokens is not a function!`);
                console.log(`TokenPersistence exists: ${!!window.TokenPersistence}`);
                if (window.TokenPersistence) {
                    console.log(`saveTokens exists: ${typeof window.TokenPersistence.saveTokens}`);
                }
            }
            
            // Make tokens available globally for other modules
            console.log(`🌐 TOKEN-SELECTION: Updating global selectedTickers array`);
            window.selectedTickers = [...selectedTokens];
            
            // Dispatch custom event for token change notification
            console.log(`📣 TOKEN-SELECTION: Dispatching token-selection-changed event`);
            const tokenEvent = new CustomEvent('token-selection-changed', { 
                detail: { selectedTokens: [...selectedTokens], action: 'add', token } 
            });
            window.dispatchEvent(tokenEvent);
            
            showMessage(`Token ${token.symbol || shortenAddress(token.tokenAddress)} selected`, 'success');
        } else {
            console.log(`⚠️ TOKEN-SELECTION: Token ${token.symbol || shortenAddress(token.tokenAddress)} already selected, ignoring`);
        }
    }
    
    // Deselect a token
    function deselectToken(token) {
        console.log(`🔍 TOKEN-SELECTION: Attempting to deselect token:`, token);
        
        // Find token by multiple possible identifiers
        let index = -1;
        
        // Try by tokenAddress first
        if (token.tokenAddress) {
            index = selectedTokens.findIndex(t => t.tokenAddress === token.tokenAddress);
        }
        
        // If not found and we have a symbol, try by symbol
        if (index === -1 && token.symbol) {
            index = selectedTokens.findIndex(t => t.symbol === token.symbol);
        }
        
        // If we have an address property, try that too
        if (index === -1 && token.address) {
            index = selectedTokens.findIndex(t => 
                t.tokenAddress === token.address || 
                (t.address && t.address === token.address)
            );
        }
        
        // Last resort: try by ticker if available
        if (index === -1 && token.ticker) {
            index = selectedTokens.findIndex(t => 
                (t.ticker && t.ticker === token.ticker) || 
                (t.symbol && t.symbol === token.ticker)
            );
        }
        
        if (index !== -1) {
            console.log(`➖ TOKEN-SELECTION: Found and removing token from selectedTokens array at index ${index}`);
            const removedToken = selectedTokens[index];
            selectedTokens.splice(index, 1);
            console.log(`📊 TOKEN-SELECTION: Current selected tokens count after removal: ${selectedTokens.length}`);
            
            // Update list UI
            renderTokenList();
            
            // Update the header display
            console.log(`🖥️ TOKEN-SELECTION: Updating header token display after deselection`);
            updateHeaderTokenDisplay();
            
            // Update selected tokens count
            updateSelectedTokensCount();
            
            // Update in-memory storage
            console.log(`💾 TOKEN-SELECTION: Updating in-memory token storage after deselection`);
            if (window.TokenPersistence && typeof window.TokenPersistence.saveTokens === 'function') {
                console.log(`📤 TOKEN-SELECTION: Calling TokenPersistence.saveTokens() with ${selectedTokens.length} tokens after removal`);
                window.TokenPersistence.saveTokens([...selectedTokens]);
            } else {
                console.log(`ℹ️ TOKEN-SELECTION: TokenPersistence not available, using global state only`);
            }
            
            // Update global state
            console.log(`🌐 TOKEN-SELECTION: Updating global selectedTickers array after deselection`);
            window.selectedTickers = [...selectedTokens];
            
            // Dispatch custom event for token change notification
            console.log(`📣 TOKEN-SELECTION: Dispatching token-selection-changed event for removal`);
            const tokenEvent = new CustomEvent('token-selection-changed', { 
                detail: { selectedTokens: [...selectedTokens], action: 'remove', token: removedToken } 
            });
            window.dispatchEvent(tokenEvent);
            
            // Show message with the most descriptive token identifier available
            const tokenName = removedToken.symbol || 
                              (removedToken.tokenAddress ? shortenAddress(removedToken.tokenAddress) : 'Token');
            showMessage(`Token ${tokenName} removed`, 'info');
        } else {
            console.log(`⚠️ TOKEN-SELECTION: Token not found in selected tokens, cannot deselect:`, token);
        }
    }
    
    // Clear all selected tokens
    function clearAllTokens() {
        console.log(`🔍 TOKEN-SELECTION: Attempting to clear all selected tokens`);
        if (selectedTokens.length === 0) {
            console.log(`⚠️ TOKEN-SELECTION: No tokens to clear, ignoring`);
            return;
        }
        
        console.log(`➖ TOKEN-SELECTION: Clearing selectedTokens array`);
        selectedTokens = [];
        console.log(`📊 TOKEN-SELECTION: Current selected tokens count: ${selectedTokens.length}`);
        renderTokenList();
        
        // Update the header display
        updateHeaderTokenDisplay();
        
        // Update selected tokens count
        updateSelectedTokensCount();
        
        // Update in-memory storage
        console.log(`💾 TOKEN-SELECTION: Updating in-memory token storage`);
        if (window.TokenPersistence && typeof window.TokenPersistence.saveTokens === 'function') {
            console.log(`📤 TOKEN-SELECTION: Calling TokenPersistence.saveTokens() with empty array`);
            window.TokenPersistence.saveTokens([]);
        } else {
            console.log(`ℹ️ TOKEN-SELECTION: TokenPersistence not available, using global state only`);
        }
        
        // Update global state
        console.log(`🌐 TOKEN-SELECTION: Updating global selectedTickers array`);
        window.selectedTickers = [];
        
        showMessage('All tokens cleared', 'info');
    }

    // Update the selected tokens count in the UI
    function updateSelectedTokensCount() {
        const countElem = document.querySelector('.token-count');
        const badgeElem = document.querySelector('.ticker-count-badge');
        
        if (countElem) {
            // Update the count number in the span
            countElem.textContent = selectedTokens.length;
        }
        
        if (badgeElem) {
            // Preserve the span element for the count
            if (selectedTokens.length > 0) {
                const tickers = selectedTokens.map(token => token.symbol).join(', ');
                badgeElem.innerHTML = `<span class="token-count">${selectedTokens.length}</span> (${tickers})`;
            } else {
                badgeElem.innerHTML = `<span class="token-count">0</span> tokens selected`;
            }
        }
    }
    
    // Show a message in the token messages area
    function showMessage(message, type = 'info') {
        const messagesContainer = document.getElementById('token-messages');
        if (!messagesContainer) return;
        
        const messageElement = document.createElement('div');
        messageElement.className = `alert alert-${type}`;
        messageElement.textContent = message;
        
        messagesContainer.innerHTML = '';
        messagesContainer.appendChild(messageElement);
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            if (messageElement.parentNode) {
                messageElement.parentNode.removeChild(messageElement);
            }
        }, 3000);
    }
    
    // Helper: Shorten address for display
    function shortenAddress(address) {
        if (!address) return '';
        return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    }
    
    // Helper: Format number with commas
    function formatNumber(num) {
        if (num === undefined || num === null) return '0';
        
        // Handle different types of inputs
        const value = typeof num === 'string' ? parseFloat(num) : num;
        
        // Round to 2 decimal places
        const rounded = Math.round(value * 100) / 100;
        
        // Format with commas
        return rounded.toLocaleString('en-US');
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
        clearAllTokens
    };
})();

// Initialize when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    if (window.location.hash === '#selection' || !window.location.hash) {
        window.TokenSelectionUI.init();
    }
});
