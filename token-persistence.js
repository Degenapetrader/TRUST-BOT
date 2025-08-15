// Token Persistence Module - Handles managing selected tokens in memory

// Import the console logger to ensure logs reach the command prompt
try {
    const consoleLogger = require('./console-logger');
    consoleLogger.setup();
    console.log('📝 TOKEN-PERSISTENCE: Console logger initialized');
} catch (err) {
    console.error('Error setting up console logger:', err);
}

// Global cache of selected tokens
let cachedSelectedTokens = [];

// Initialize the module
function initTokenPersistence() {
    console.log(`🚀 TOKEN-PERSISTENCE: Initializing in-memory token storage`);
    
    // No loading needed since we're only using in-memory storage now
    console.log(`💾 TOKEN-PERSISTENCE: Using in-memory storage only, no file persistence`);
    
    // Check if we have any tokens already in global state
    if (window.selectedTickers && Array.isArray(window.selectedTickers) && window.selectedTickers.length > 0) {
        console.log(`👁 TOKEN-PERSISTENCE: Found ${window.selectedTickers.length} tokens in global state, using those`);
        cachedSelectedTokens = [...window.selectedTickers];
    } else {
        console.log(`📁 TOKEN-PERSISTENCE: No tokens found in global state, starting with empty list`);
        cachedSelectedTokens = [];
        window.selectedTickers = [];
    }
}

// Save selected tokens to in-memory storage
function saveSelectedTokens(tokens) {
    console.log(`⚡ TOKEN-PERSISTENCE: saveSelectedTokens called with ${tokens.length} tokens`);
    console.log(`🔍 TOKEN-PERSISTENCE: First token (if any):`, tokens.length > 0 ? `${tokens[0].symbol} (${tokens[0].tokenAddress})` : 'none');
    
    // Cache locally
    console.log(`📦 TOKEN-PERSISTENCE: Caching tokens in memory`);
    cachedSelectedTokens = [...tokens];
    
    // Update global state
    console.log(`🌐 TOKEN-PERSISTENCE: Updating global selectedTickers array`);
    window.selectedTickers = [...tokens];
    
    console.log(`💾 TOKEN-PERSISTENCE: Saved ${tokens.length} tokens to memory`);
    return true;
}

// Load selected tokens from memory
function loadSelectedTokens() {
    console.log(`⚡ TOKEN-PERSISTENCE: loadSelectedTokens called`);
    console.log(`💾 TOKEN-PERSISTENCE: Using in-memory tokens only`);
    
    // Return the cached tokens
    console.log(`📚 TOKEN-PERSISTENCE: Returning ${cachedSelectedTokens.length} tokens from memory cache`);
    
    // Update token selection UI if it exists
    console.log(`🖼️ TOKEN-PERSISTENCE: Checking for TokenSelectionUI to update with cached tokens...`);
    if (window.TokenSelectionUI && typeof window.TokenSelectionUI.setSelectedTokens === 'function') {
        console.log(`✅ TOKEN-PERSISTENCE: TokenSelectionUI found, updating selection`);
        window.TokenSelectionUI.setSelectedTokens(cachedSelectedTokens);
    }
    
    // Also ensure global state is in sync - this is critical for bot execution
    console.log(`🌐 TOKEN-PERSISTENCE: Ensuring global selectedTickers is in sync with ${cachedSelectedTokens.length} tokens`);
    if (window.selectedTickers) {
        window.selectedTickers = [...cachedSelectedTokens];
    }
    
    // Log if there's a mismatch between what we think we have and global state
    if (window.selectedTickers && window.selectedTickers.length !== cachedSelectedTokens.length) {
        console.warn(`⚠️ TOKEN-PERSISTENCE: Mismatch between cache (${cachedSelectedTokens.length}) and global state (${window.selectedTickers.length})`);
    }
    
    return cachedSelectedTokens;
}

// Public API
window.TokenPersistence = {
    init: initTokenPersistence,
    saveTokens: saveSelectedTokens,
    loadTokens: loadSelectedTokens,
    getTokens: () => cachedSelectedTokens
};

// Initialize token persistence on page load
document.addEventListener('DOMContentLoaded', () => {
    console.log(`🚀 TOKEN-PERSISTENCE: DOMContentLoaded fired, initializing token persistence`);
    // Initialize through the global interface to ensure window.TokenPersistence is available
    window.TokenPersistence.init();
    console.log(`✅ TOKEN-PERSISTENCE: window.TokenPersistence initialized and available:`, 
               !!window.TokenPersistence);
});
