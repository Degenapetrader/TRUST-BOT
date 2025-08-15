// Token List Component
// Displays tokens in alphabetical order from different sources based on active mode

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initTokenList();
});

function initTokenList() {
    const container = document.getElementById('token-list-container');
    if (!container) return;

    // Create token list structure
    container.innerHTML = `
        <div class="token-list-header">
            <div class="token-list-controls">
                <div class="search-input-group">
                    <input type="text" class="token-search" placeholder="Search tokens..." />
                    <div class="token-sort-icon">
                        <i class="fas fa-sort-down" style="font-size: 24px;"></i>
                        <div class="token-sort-dropdown">
                            <div class="token-sort-option" data-sort="marketcap">Sort by Market Cap</div>
                            <div class="token-sort-option" data-sort="name">Sort by Name</div>
                            <div class="token-sort-option" data-sort="symbol">Sort by Symbol</div>
                        </div>
                    </div>
                </div>
                <div class="selected-tokens-display-right" id="selected-tokens-display-right">
                    <!-- Selected tokens will be displayed here -->
                </div>
            </div>
        </div>
        <div class="token-list-wrapper">
            <div class="token-list-loading">Loading tokens...</div>
        </div>
    `;

    const searchInput = container.querySelector('.token-search');
    const sortIcon = container.querySelector('.token-sort-icon');
    const sortDropdown = container.querySelector('.token-sort-dropdown');
    const sortOptions = container.querySelectorAll('.token-sort-option');
    const contentDiv = container.querySelector('.token-list-wrapper');
    
    // Current sort value
    let currentSortValue = 'marketcap';

    // Load tokens based on current mode
    loadTokens(contentDiv, searchInput, currentSortValue);

    // Add event listeners
    searchInput.addEventListener('input', () => {
        filterTokens(contentDiv, searchInput.value, currentSortValue);
    });
    
    // Toggle sort dropdown
    sortIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        sortDropdown.classList.toggle('active');
    });
    
    // Close dropdown when clicking elsewhere
    document.addEventListener('click', () => {
        sortDropdown.classList.remove('active');
    });
    
    // Sort options click handlers
    sortOptions.forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            currentSortValue = option.getAttribute('data-sort');
            filterTokens(contentDiv, searchInput.value, currentSortValue);
            sortDropdown.classList.remove('active');
        });
    });

    // Listen for mode changes
    document.addEventListener('bid-mode-changed', (event) => {
        loadTokens(contentDiv, searchInput, currentSortValue);
    });
}

async function loadTokens(contentDiv, searchInput, sortBy) {
    contentDiv.innerHTML = '<div class="token-list-loading">Loading tokens...</div>';
    
    try {
        let tokens = [];
        const isBidMode = document.body.classList.contains('bid-mode-active');
        
        if (isBidMode) {
            // Load BID tokens
            const bidResponse = await fetch('bid.json');
            if (!bidResponse.ok) throw new Error('Failed to load BID tokens');
            const bidData = await bidResponse.json();
            tokens = bidData.map(token => ({
                symbol: token.symbol,
                name: token.name || token.tokenName || token.symbol,
                address: token.tokenAddress,
                blockchain: 'BASE',
                marketcap: token.mcapInETH || 0
            }));
            console.log('BID mode active - loaded bid.json tokens:', tokens.length);
        } else {
            // Load only BASE tokens (ETH tokens temporarily disabled)
            const baseResponse = await fetch('base.json');
            
            if (!baseResponse.ok) throw new Error('Failed to load BASE tokens');
            
            const baseData = await baseResponse.json();
            
            // Format BASE tokens
            const baseTokens = baseData.map(token => ({
                symbol: token.symbol,
                name: token.name || token.tokenName || token.symbol,
                address: token.tokenAddress,
                blockchain: 'BASE',
                marketcap: token.mcapInVirtual || 0
            }));
            
            /* ETH tokens temporarily disabled as they're not supported yet
            const ethResponse = await fetch('eth.json');
            if (!ethResponse.ok) throw new Error('Failed to load ETH tokens');
            const ethData = await ethResponse.json();
            const ethTokens = ethData.map(token => ({
                symbol: token.symbol,
                name: token.name || token.tokenName || token.symbol,
                address: token.tokenAddress,
                blockchain: 'ETH',
                marketcap: token.mcapInVirtual || 0
            }));
            tokens = [...baseTokens, ...ethTokens];
            */
            
            tokens = baseTokens;
            console.log('Virtual mode active - loaded base.json tokens only:', tokens.length);
        }
        
        // Sort tokens by market cap by default
        tokens.sort((a, b) => b.marketcap - a.marketcap);
        
        // Display tokens
        displayTokens(contentDiv, tokens, searchInput.value, sortBy);
    } catch (error) {
        console.error('Error loading tokens:', error);
        contentDiv.innerHTML = '<div class="component-loading" style="color: #ff6b6b;">Error loading tokens. Please try again.</div>';
    }
}

function displayTokens(contentDiv, tokens, searchTerm = '', sortBy = 'marketcap') {
    // Sort tokens
    if (sortBy === 'name') {
        // Sort by name (fallback to symbol if name is not available)
        // Strip leading $ for sorting comparison
        tokens.sort((a, b) => {
            const aName = a.name || a.symbol;
            const bName = b.name || b.symbol;
            
            // Strip leading $ for comparison if present
            const aNameForSort = aName.startsWith('$') ? aName.substring(1) : aName;
            const bNameForSort = bName.startsWith('$') ? bName.substring(1) : bName;
            
            return aNameForSort.localeCompare(bNameForSort);
        });
    } else if (sortBy === 'symbol') {
        // Sort by symbol
        tokens.sort((a, b) => a.symbol.localeCompare(b.symbol));
    } else if (sortBy === 'marketcap') {
        // Sort by market cap (highest to lowest)
        tokens.sort((a, b) => b.marketcap - a.marketcap);
    }
    
    // Filter tokens if search term exists
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        tokens = tokens.filter(token => 
            token.symbol.toLowerCase().includes(term) || 
            token.address.toLowerCase().includes(term) ||
            (token.name && token.name.toLowerCase().includes(term))
        );
    }
    
    if (tokens.length === 0) {
        contentDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">No tokens found</div>';
        return;
    }
    
    // Create token list HTML
    let tokenListHTML = '<ul class="token-list">';
    
    tokenListHTML += tokens.map(token => {
        const shortAddress = `${token.address.substring(0, 6)}...${token.address.substring(token.address.length - 4)}`;
        
        // Strip leading $ from symbol for display
        const displaySymbol = token.symbol && token.symbol.startsWith('$') 
            ? token.symbol.substring(1) 
            : token.symbol;
        
        return `
            <li class="token-item" data-address="${token.address}" data-symbol="${token.symbol}" data-blockchain="${token.blockchain}">
                <div class="token-info">
                    <div class="token-symbol">${displaySymbol}</div>
                </div>
                <div class="token-address">
                    ${shortAddress}
                </div>
                <div class="token-blockchain">${token.blockchain}</div>
                <button class="token-copy-btn" data-address="${token.address}" title="Copy address">
                    <i class="fas fa-copy"></i>
                </button>
                <button class="token-add-btn" data-address="${token.address}" data-symbol="${token.symbol}" title="Add to selection">
                    <i class="fas fa-plus"></i>
                </button>
            </li>
        `;
    }).join('');
    
    tokenListHTML += '</ul>';
    contentDiv.innerHTML = tokenListHTML;
    
    // Add copy button event listeners
    const copyButtons = contentDiv.querySelectorAll('.token-copy-btn');
    copyButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const address = button.getAttribute('data-address');
            copyToClipboard(address, button);
        });
    });
    
    // Add token-add button event listeners
    const addButtons = contentDiv.querySelectorAll('.token-add-btn');
    addButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const address = button.getAttribute('data-address');
            const symbol = button.getAttribute('data-symbol');
            const blockchain = button.getAttribute('data-blockchain');
            
            // Determine if we're in BID mode or Virtuals mode
            const isBidMode = document.body.classList.contains('bid-mode-active');
            
            if (isBidMode) {
                // Add to BID mode selection using the existing BID token selection system
                if (typeof window.BidTokenSelectionUI !== 'undefined' && window.BidTokenSelectionUI.selectToken) {
                    const tokenData = {
                        symbol: symbol,
                        tokenAddress: address,
                        blockchain: blockchain
                    };
                    window.BidTokenSelectionUI.selectToken(tokenData);
                    showTokenNotification(`Added ${symbol} to BID token selection`, 'success');
                } else {
                    showTokenNotification('BID token selection system not available', 'error');
                }
            } else {
                // Directly replicate the selectToken() behavior from token-selection.js
                const tokenData = {
                    symbol: symbol,
                    tokenAddress: address,
                    address: address,
                    blockchain: blockchain,
                    id: address
                };
                
                // Access the TokenSelectionUI's private selectedTokens array via the public API
                let currentSelectedTokens = [];
                if (window.TokenSelectionUI && typeof window.TokenSelectionUI.getSelectedTokens === 'function') {
                    currentSelectedTokens = window.TokenSelectionUI.getSelectedTokens();
                }
                
                // Check if token is already selected
                const alreadySelected = currentSelectedTokens.some(t => t.tokenAddress === tokenData.tokenAddress);
                
                if (!alreadySelected) {
                    // Add to selectedTokens array
                    currentSelectedTokens.push(tokenData);
                    
                    // Update TokenSelectionUI's internal state if available
                    if (window.TokenSelectionUI && typeof window.TokenSelectionUI.setSelectedTokens === 'function') {
                        window.TokenSelectionUI.setSelectedTokens(currentSelectedTokens);
                    }
                    
                    // Update header display directly
                    updateHeaderTokenDisplay(currentSelectedTokens);
                    
                    // Update global state
                    window.selectedTickers = [...currentSelectedTokens];
                    
                    // Save to persistence
                    if (window.TokenPersistence && typeof window.TokenPersistence.saveTokens === 'function') {
                        window.TokenPersistence.saveTokens([...currentSelectedTokens]);
                    }
                    
                    // Dispatch custom event
                    const tokenEvent = new CustomEvent('token-selection-changed', { 
                        detail: { selectedTokens: [...currentSelectedTokens], action: 'add', token: tokenData } 
                    });
                    window.dispatchEvent(tokenEvent);
                    
                    showTokenNotification(`Added ${symbol} to token selection`, 'success');
                } else {
                    showTokenNotification(`${symbol} already selected`, 'info');
                }
            }
        });
    });
}

function filterTokens(contentDiv, searchTerm, sortBy) {
    // If search is cleared, reload all tokens
    if (!searchTerm || searchTerm.trim() === '') {
        loadTokens(contentDiv, document.querySelector('.token-search'), sortBy);
        return;
    }
    
    // Always reload the complete token dataset and filter from that
    // This ensures we search from all tokens, not just currently displayed ones
    loadTokens(contentDiv, document.querySelector('.token-search'), sortBy).then(() => {
        // After loading complete dataset, apply the search filter
        setTimeout(() => {
            // Get all token items from the freshly loaded complete dataset
            const tokenItems = Array.from(contentDiv.querySelectorAll('.token-item'));
            
            if (tokenItems.length === 0) return;
            
            // Extract token data from complete dataset
            const tokens = tokenItems.map(item => {
                return {
                    symbol: item.querySelector('.token-symbol').textContent,
                    address: item.getAttribute('data-address'),
                    blockchain: item.querySelector('.token-blockchain').textContent
                };
            });
            
            // Display filtered tokens from complete dataset
            displayTokens(contentDiv, tokens, searchTerm, sortBy);
        }, 50);
    }).catch(() => {
        // If loadTokens fails, just reload without search term
        loadTokens(contentDiv, document.querySelector('.token-search'), sortBy);
    });
}

// Utility function to copy to clipboard
function copyToClipboard(text, button) {
    navigator.clipboard.writeText(text)
        .then(() => {
            // Temporarily change icon to indicate success
            const icon = button.querySelector('i');
            icon.className = 'fas fa-check';
            setTimeout(() => {
                icon.className = 'fas fa-copy';
            }, 1000);
        })
        .catch(err => {
            console.error('Error copying to clipboard:', err);
        });
}

// Show notification using the main app's console system
function showTokenNotification(message, type = 'info') {
    // Try to use the main app's console system
    if (typeof window.addConsoleMessage === 'function') {
        const prefix = type === 'success' ? '✅' : 
                      type === 'error' ? '❌' : 
                      type === 'warning' ? '⚠️' : 'ℹ️';
        window.addConsoleMessage(`${prefix} Token List: ${message}`, type);
    } else {
        // Fallback to console
        console.log(`[Token List ${type.toUpperCase()}] ${message}`);
    }
}

// Update the header token display - replicated from token-selection.js
function updateHeaderTokenDisplay(selectedTokens) {
    const tokenDisplay = document.getElementById('selected-tokens-display');
    const tokenDisplayRight = document.getElementById('selected-tokens-display-right');
    if (!tokenDisplay || !tokenDisplayRight) {
        console.warn('TOKEN-LIST: selected-tokens-display element not found');
        return;
    }

    const enabledTokens = selectedTokens.filter(token => token.enabled !== false);

    if (enabledTokens.length === 0) {
        tokenDisplay.innerHTML = '';
        tokenDisplayRight.innerHTML = '';
        return;
    }
    tokenDisplay.innerHTML = '';
    tokenDisplayRight.innerHTML = '';
    
    // Display all tokens - they'll be in a scrollbox
    const tokensToDisplay = enabledTokens;

    // Create chips for each token
    tokensToDisplay.forEach(token => {
        const rawSymbol = token.symbol || shortenAddress(token.tokenAddress);
        const symbol = rawSymbol && rawSymbol.startsWith('$') 
            ? rawSymbol.substring(1) 
            : rawSymbol;
        
        // Create token chip for header display
        const tokenChip = document.createElement('span');
        tokenChip.className = 'selected-token-chip';
        tokenChip.setAttribute('data-token-id', token.id || token.address || token.symbol);

        // Create text span with truncation
        const textSpan = document.createElement('span');
        textSpan.className = 'chip-text';
        textSpan.textContent = symbol;
        tokenChip.appendChild(textSpan);

        // Create remove button for header
        const removeBtn = document.createElement('button');
        removeBtn.className = 'token-remove-btn';
        removeBtn.textContent = '×';
        
        // Handle token removal
        removeBtn.onclick = (function(tokenObj) {
            return function(event) {
                event.stopPropagation();
                console.log('TOKEN-LIST: Removing token:', tokenObj);
                removeTokenFromSelection(tokenObj);
            };
        })(token);
        
        tokenChip.appendChild(removeBtn);
        tokenDisplay.appendChild(tokenChip);
        
        // Create separate token chip for right pane display
        const tokenChipRight = document.createElement('span');
        tokenChipRight.className = 'selected-token-chip';
        tokenChipRight.setAttribute('data-token-id', token.id || token.address || token.symbol);

        // Create text span with truncation for right pane
        const textSpanRight = document.createElement('span');
        textSpanRight.className = 'chip-text';
        textSpanRight.textContent = symbol;
        tokenChipRight.appendChild(textSpanRight);

        // Create remove button for right pane
        const removeBtnRight = document.createElement('button');
        removeBtnRight.className = 'token-remove-btn';
        removeBtnRight.textContent = '×';
        
        // Handle token removal for right pane
        removeBtnRight.onclick = (function(tokenObj) {
            return function(event) {
                event.stopPropagation();
                console.log('TOKEN-LIST: Removing token from right pane:', tokenObj);
                removeTokenFromSelection(tokenObj);
            };
        })(token);
        
        tokenChipRight.appendChild(removeBtnRight);
        tokenDisplayRight.appendChild(tokenChipRight);
    });
}

// Helper function to shorten address for display
function shortenAddress(address) {
    if (!address) return '';
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

// Remove token from selection
function removeTokenFromSelection(tokenToRemove) {
    // Get current selected tokens
    let currentSelectedTokens = [];
    if (window.TokenSelectionUI && typeof window.TokenSelectionUI.getSelectedTokens === 'function') {
        currentSelectedTokens = window.TokenSelectionUI.getSelectedTokens();
    }
    
    // Remove the token
    const updatedTokens = currentSelectedTokens.filter(token => 
        token.tokenAddress !== tokenToRemove.tokenAddress
    );
    
    // Update TokenSelectionUI's internal state if available
    if (window.TokenSelectionUI && typeof window.TokenSelectionUI.setSelectedTokens === 'function') {
        window.TokenSelectionUI.setSelectedTokens(updatedTokens);
    }
    
    // Update header display
    updateHeaderTokenDisplay(updatedTokens);
    
    // Update global state
    window.selectedTickers = [...updatedTokens];
    
    // Save to persistence
    if (window.TokenPersistence && typeof window.TokenPersistence.saveTokens === 'function') {
        window.TokenPersistence.saveTokens([...updatedTokens]);
    }
    
    // Dispatch custom event
    const tokenEvent = new CustomEvent('token-selection-changed', { 
        detail: { selectedTokens: [...updatedTokens], action: 'remove', token: tokenToRemove } 
    });
    window.dispatchEvent(tokenEvent);
    
    showTokenNotification(`Removed ${tokenToRemove.symbol} from selection`, 'info');
}

// Make essential functions available globally
window.copyToClipboard = copyToClipboard;
window.showTokenNotification = showTokenNotification;
