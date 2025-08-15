// Wallet Width Fix - Force wallet names to have adequate width
// This fixes the width constraint issue by setting minimum width with !important

function forceWalletWidth() {
    // Find all wallet chip text elements
    const walletTexts = document.querySelectorAll('.selected-wallet-chip .chip-text');
    
    walletTexts.forEach(textElement => {
        // Force minimum width to display at least 6 characters
        textElement.style.setProperty('min-width', '50px', 'important');
        textElement.style.setProperty('width', 'auto', 'important');
        textElement.style.setProperty('max-width', '200px', 'important');
        textElement.style.setProperty('flex-shrink', '0', 'important');
        textElement.style.setProperty('display', 'inline-block', 'important');
        
        // Also force the parent chip container
        const chipContainer = textElement.closest('.selected-wallet-chip');
        if (chipContainer) {
            chipContainer.style.setProperty('min-width', '60px', 'important');
            chipContainer.style.setProperty('width', 'auto', 'important');
            chipContainer.style.setProperty('max-width', '220px', 'important');
            chipContainer.style.setProperty('flex-shrink', '0', 'important');
        }
    });
}

// Run the fix whenever wallet display is updated
function observeWalletWidth() {
    const headerWalletsDisplay = document.getElementById('header-wallets-display');
    if (headerWalletsDisplay) {
        // Create a mutation observer to watch for changes
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList') {
                    // Delay slightly to ensure DOM is updated
                    setTimeout(forceWalletWidth, 10);
                }
            });
        });
        
        // Start observing
        observer.observe(headerWalletsDisplay, {
            childList: true,
            subtree: true
        });
        
        // Run initial fix
        forceWalletWidth();
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeWalletWidth);
} else {
    observeWalletWidth();
}

// Also run periodically as a backup
setInterval(forceWalletWidth, 1000);

// Make it globally accessible for manual testing
window.forceWalletWidth = forceWalletWidth;
