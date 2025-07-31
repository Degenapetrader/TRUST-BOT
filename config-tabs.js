// Config Modal Tab Functionality
document.addEventListener('DOMContentLoaded', function() {
    initConfigTabs();
});

function initConfigTabs() {
    const tabs = document.querySelectorAll('.config-tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            switchConfigTab(targetTab);
        });
    });
}


// Enhanced modal functions to support tabbed interface
function showConfig() {
    document.getElementById('config-modal').style.display = 'block';
    // Ensure first tab is active when modal opens
    switchConfigTab('network');
    // Initialize wallet grid if wallets tab is accessed
    initializeWalletGridForSettings();
}

function hideConfig() {
    closeModal('config-modal');
}

// Override existing modal close function if needed
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

// Initialize wallet grid for settings page - copy-paste working pattern
function initializeWalletGridForSettings() {
    // Simply call the proven working populate function
    setTimeout(() => {
        populateWalletGridForSettings();
    }, 100);
}

// Copy-paste of the proven working populateWalletGrid function for settings
function populateWalletGridForSettings() {
    const walletGrid = document.getElementById('wallet-grid-settings');
    if (!walletGrid) return;
    
    // Clear previous content of the wallet grid
    walletGrid.innerHTML = '';
    
    // Show a simple message when no wallets are available
    if (!availableWallets || availableWallets.length === 0) {
        // Create a clean, simple message
        const messageDiv = document.createElement('div');
        messageDiv.className = 'simple-wallet-message';
        messageDiv.textContent = 'Click above to add wallets';
        walletGrid.appendChild(messageDiv);
        
        // Force the wallet grid to be visible
        walletGrid.style.display = 'block';
        return;
    }
    
    // Use document fragment for better performance
    const fragment = document.createDocumentFragment();
    
    // Generate HTML for each wallet - EXACT same pattern as working main grid
    availableWallets.forEach((wallet, index) => {
        // Get wallet name and address suffix for display
        const walletName = wallet.name || 'Unnamed Wallet';
        const address = wallet.address || '';
        const addressSuffix = address ? 
            `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : 
            'No Address';
        
        // Create wallet item element
        const walletItem = document.createElement('div');
        walletItem.className = `wallet-item ${selectedWallets.has(index) ? 'selected' : ''}`;
        walletItem.onclick = () => toggleWalletInSettings(index);
        
        // Create wallet item HTML - same as working main grid
        walletItem.innerHTML = `
            <input type="checkbox" id="wallet-settings-${index}" 
                   ${selectedWallets.has(index) ? 'checked' : ''}>
            <div class="wallet-info">
                <span class="wallet-name">${walletName}</span>
                <span class="wallet-address">${addressSuffix}</span>
            </div>
        `;
        
        // Add to fragment instead of directly to DOM
        fragment.appendChild(walletItem);
    });
    
    // Add all elements to the DOM at once (single reflow)
    walletGrid.appendChild(fragment);
    
    // Update wallet selection count - same as working main grid
    updateWalletSelection();
}

// Copy-paste of the working toggleWallet function for settings
function toggleWalletInSettings(walletIndex) {
    // Same logic as working main toggleWallet
    if (selectedWallets.has(walletIndex)) {
        selectedWallets.delete(walletIndex);
    } else {
        selectedWallets.add(walletIndex);
    }
    
    // Update checkbox and styling for settings grid
    const checkbox = document.getElementById(`wallet-settings-${walletIndex}`);
    const walletItem = checkbox ? checkbox.closest('.wallet-item') : null;
    
    if (checkbox && walletItem) {
        checkbox.checked = selectedWallets.has(walletIndex);
        if (selectedWallets.has(walletIndex)) {
            walletItem.classList.add('selected');
        } else {
            walletItem.classList.remove('selected');
        }
    }
    
    // Also update main grid to keep in sync
    const mainCheckbox = document.getElementById(`wallet-${walletIndex}`);
    const mainWalletItem = mainCheckbox ? mainCheckbox.closest('.wallet-item') : null;
    
    if (mainCheckbox && mainWalletItem) {
        mainCheckbox.checked = selectedWallets.has(walletIndex);
        if (selectedWallets.has(walletIndex)) {
            mainWalletItem.classList.add('selected');
        } else {
            mainWalletItem.classList.remove('selected');
        }
    }
    
    // Update selection counter - same as working main grid
    updateWalletSelection();
}

// Simple function to refresh settings wallet grid when needed
function refreshSettingsWalletGrid() {
    const settingsWalletGrid = document.getElementById('wallet-grid-settings');
    if (settingsWalletGrid) {
        populateWalletGridForSettings();
    }
}

// Make functions globally accessible
window.toggleWalletInSettings = toggleWalletInSettings;
window.populateWalletGridForSettings = populateWalletGridForSettings;
window.refreshSettingsWalletGrid = refreshSettingsWalletGrid;

// Update wallet count for settings page
function updateWalletCountForSettings() {
    const settingsWalletGrid = document.getElementById('wallet-grid-settings');
    const walletCountElement = document.getElementById('selected-wallet-count-settings');
    
    if (settingsWalletGrid && walletCountElement) {
        const walletCards = settingsWalletGrid.querySelectorAll('.wallet-card');
        const selectedWallets = settingsWalletGrid.querySelectorAll('.wallet-card.selected');
        
        walletCountElement.textContent = `${selectedWallets.length} of ${walletCards.length} wallets selected`;
        
        // Show/hide parallel info
        const parallelInfo = document.getElementById('wallet-parallel-info-settings');
        if (parallelInfo) {
            parallelInfo.style.display = selectedWallets.length > 1 ? 'inline' : 'none';
        }
    }
}

// Enhanced tab switching to handle wallet grid initialization
function switchConfigTab(targetTab) {
    // Remove active class from all tabs and content
    document.querySelectorAll('.config-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // Add active class to clicked tab
    document.querySelector(`[data-tab="${targetTab}"]`).classList.add('active');
    
    // Show corresponding content
    const targetContent = document.getElementById(`${targetTab}-tab`);
    if (targetContent) {
        targetContent.classList.add('active');
        
        // Initialize wallet grid when wallets tab is opened - simple working pattern
        if (targetTab === 'wallets') {
            setTimeout(() => {
                initializeWalletGridForSettings();
            }, 100);
        }
    }
}
