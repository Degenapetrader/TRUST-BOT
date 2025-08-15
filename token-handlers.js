// Token Handlers Module (Memory-Only Version)
const { ipcMain } = require('electron');

// Set up enhanced logging for main process
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

// Replace console methods with more visible versions
console.log = function(...args) {
    const timestamp = new Date().toISOString();
    originalConsoleLog.apply(console, [`[${timestamp}] [MAIN] [INFO] `, ...args]);
};

console.warn = function(...args) {
    const timestamp = new Date().toISOString();
    originalConsoleWarn.apply(console, [`[${timestamp}] [MAIN] [WARNING] `, ...args]);
};

console.error = function(...args) {
    const timestamp = new Date().toISOString();
    originalConsoleError.apply(console, [`[${timestamp}] [MAIN] [ERROR] `, ...args]);
};

console.log('TOKEN-HANDLERS: Enhanced logging initialized for main process');

/**
 * Register token handlers that work with in-memory storage only
 * This version doesn't use file persistence
 */
function registerTokenHandlers() {
    console.log(`🚀 TOKEN-HANDLERS: Registering in-memory token handlers (no file persistence)`);
    
    // Handle save tokens request (we don't actually save to file anymore)
    ipcMain.on('save-selected-tokens', (event, tokens) => {
        console.log(`📡 TOKEN-HANDLERS: Received 'save-selected-tokens' IPC message with ${tokens ? tokens.length : 0} tokens`);
        console.log(`💭 TOKEN-HANDLERS: Using in-memory storage only, not saving to file`);
        
        // Send confirmation back to renderer
        try {
            event.sender.send('tokens-save-result', { success: true, count: tokens.length });
            console.log(`📤 TOKEN-HANDLERS: Sent save confirmation to renderer`);
        } catch (error) {
            console.error(`❌ TOKEN-HANDLERS: Error sending save confirmation:`, error);
        }
    });
    
    // Handle load tokens request (return empty array since we don't load from file anymore)
    ipcMain.on('load-selected-tokens', (event) => {
        console.log(`📡 TOKEN-HANDLERS: Received 'load-selected-tokens' IPC message`);
        console.log(`💭 TOKEN-HANDLERS: Using in-memory storage only, returning empty array`);
        
        try {
            event.sender.send('selected-tokens-loaded', []);
            console.log(`✅ TOKEN-HANDLERS: Sent empty tokens array to renderer`);
        } catch (error) {
            console.error(`❌ TOKEN-HANDLERS: Error sending tokens to renderer:`, error);
        }
    });
    
    console.log(`🔔 TOKEN-HANDLERS: In-memory token handlers successfully registered`);
}

module.exports = { registerTokenHandlers };
