/**
 * Wallets module - Main entry point
 * Provides backward compatibility while using the new modular structure
 */

import { ethers } from 'ethers';
import { WalletLoader } from './loader.js';
import { WalletRepository } from './repository.js';
import { provider } from '../config.js';

// Constants - Fix: Use environment variable for wallets path set by botLauncher
// This ensures we use the correct userData path in packaged builds
const WALLETS_PATH = process.env.WALLETS_DB_PATH || 'wallets.json';

// Init module with configuration
let repository;
let loader;
let walletConfigs = [];
let walletsArray = [];
let walletsMap = {};

/**
 * Initialize the wallets module
 * @returns {Promise<void>}
 */
async function initializeWallets() {
  try {
    // Create loader instance
    loader = new WalletLoader(WALLETS_PATH);
    
    // Load wallet configurations (now async)
    walletConfigs = await loader.loadWalletConfigs();
    
    console.log(`Wallets module loaded ${walletConfigs.length} wallet configurations`);
    
    // Create repository and load wallets
    repository = new WalletRepository();
    walletsArray = repository.createWallets(walletConfigs || [], provider) || [];
    walletsMap = repository.walletMap || new Map();
    
    // Log loaded wallets
    console.log(`Loaded ${walletsArray.length} wallets`);
    
    // Count environment wallets
    const envWalletCount = walletConfigs.filter(w => w._keyFromEnv).length;
    if (envWalletCount > 0) {
      console.log(`🔐 Using ${envWalletCount} wallets with keys from environment variables`);
    }
    
    // Count decrypted wallets
    const decryptedWalletCount = walletConfigs.filter(w => w._keyDecrypted).length;
    if (decryptedWalletCount > 0) {
      console.log(`📄 Using ${decryptedWalletCount} wallets with decrypted keys from wallet database`);
    }
    
    // Log loaded wallets with source info
    walletsArray.forEach(wallet => {
      // Check if this wallet used a key from environment variables
      const keySource = wallet.metadata && wallet.metadata._keyFromEnv 
        ? "🔐 ENV" 
        : "📄 FILE";
      console.log(`✅ Loaded wallet: ${wallet.name} (${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}) [${keySource}]`);
    });
    
    // Count wallets by key source
    const envWallets = walletsArray.filter(w => w.metadata && w.metadata._keyFromEnv).length;
    const fileWallets = walletsArray.length - envWallets;
    
    console.log(`✅ Successfully loaded ${walletsArray.length} wallet(s) with provider connection`);
    if (envWallets > 0) {
      console.log(`   🔐 ${envWallets} wallet(s) using decrypted keys from environment variables`);
    }
    if (fileWallets > 0) {
      console.log(`   📄 ${fileWallets} wallet(s) using keys from wallet database file`);
    }
    
    return walletsArray;
    
  } catch (error) {
    console.error(`❌ Error initializing wallets: ${error.message}`);
    return [];
  }
}

// Create arrays that will be populated once initialization completes
export const tradingWallets = [];
export const TRADING_WALLETS = []; // Legacy export

// Add detailed wallet loading event log
const walletLoadingEvents = [];
function logWalletEvent(event, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, event, message, ...data };
  console.log(`[WALLET_EVENT ${timestamp}] ${event}: ${message}`);
  walletLoadingEvents.push(logEntry);
}

// Create a timeout promise to prevent hanging if wallet initialization fails
const walletTimeoutPromise = new Promise((resolve) => {
  setTimeout(() => {
    logWalletEvent('TIMEOUT', 'Wallet initialization timed out after 10 seconds');
    resolve({ timeout: true, wallets: [] });
  }, 10000); // 10 second timeout - increased for reliability
});

// Initialize wallets with promise wrapper - using a proper async function to capture errors
const walletPromise = (async () => {
  try {
    logWalletEvent('INIT_START', 'Starting wallet initialization');
    const wallets = await initializeWallets();
    logWalletEvent('INIT_COMPLETE', `Wallet initialization completed with ${wallets.length} wallets`);
    return { timeout: false, wallets };
  } catch (err) {
    logWalletEvent('INIT_ERROR', `Wallet initialization failed: ${err.message}`);
    console.error('Error initializing wallets:', err);
    return { timeout: false, error: err, wallets: [] };
  }
})();

// Export a promise that resolves when wallet initialization is complete or times out
export const walletsReady = Promise.race([
  walletPromise,
  walletTimeoutPromise
]).then(result => {
  if (result.timeout) {
    logWalletEvent('TIMEOUT_HANDLED', 'Using empty wallet array due to timeout');
    return [];
  }
  
  const wallets = result.wallets || [];
  logWalletEvent('POPULATING_ARRAYS', `Populating trading wallet arrays with ${wallets.length} wallets`);
  
  // Clear arrays and add new wallets
  tradingWallets.splice(0, tradingWallets.length);
  TRADING_WALLETS.splice(0, TRADING_WALLETS.length);
  
  if (wallets.length > 0) {
    tradingWallets.push(...wallets);
    TRADING_WALLETS.push(...wallets);
    logWalletEvent('ARRAYS_UPDATED', `Trading wallet arrays updated with ${wallets.length} wallets`);
    
    // Log each wallet for debugging
    wallets.forEach((wallet, idx) => {
      if (wallet && wallet.address) {
        logWalletEvent('WALLET_LOADED', `Wallet ${idx+1}: ${wallet.address.slice(0,6)}...${wallet.address.slice(-4)}`, {
          index: idx,
          address: wallet.address,
          name: wallet.name || `Wallet ${idx+1}`
        });
      }
    });
  } else {
    logWalletEvent('NO_WALLETS', 'No wallets were loaded');
  }
  
  return wallets;
}).catch(err => {
  logWalletEvent('FATAL_ERROR', `Fatal wallet initialization error: ${err.message}`);
  console.error('Fatal error initializing trading wallets:', err);
  return []; // Return empty array on error
});

/**
 * Get specific wallet by index
 * @param {number} index - Wallet index (0-based)
 * @returns {ethers.Wallet|null} Wallet instance or null if not found
 */
export function getWallet(index) {
  return repository.getByIndex(index);
}

/**
 * Get wallet count
 * @returns {number} Number of available wallets
 */
export function getWalletCount() {
  return repository.count();
}

/**
 * Get all wallet addresses
 * @returns {Array} Array of wallet addresses
 */
export function getWalletAddresses() {
  return repository.getAddresses();
}

/**
 * Get wallet summary for display
 * @returns {Array} Array of wallet summaries
 */
export function getWalletSummary() {
  return repository.getSummaries();
}

// Export new functionality
export function getWalletBySelector(selector) {
  return repository.getBySelector(selector);
}

export function getWalletByAddress(address) {
  return repository.getByAddress(address);
}

export function getWalletsBySelectors(selectors) {
  return repository.getBySelectors(selectors);
}

// Export the repository and loader for advanced usage
export { repository as walletRepository, loader as walletLoader };

// Utility to reload wallets (useful for dynamic updates)
export function reloadWallets() {
  const newWallets = initializeWallets();
  
  // Update the exported references
  tradingWallets.length = 0;
  tradingWallets.push(...newWallets);
  
  TRADING_WALLETS.length = 0;
  TRADING_WALLETS.push(...newWallets);
  
  return newWallets;
}

// Utility to update provider for all wallets
export function updateWalletProvider(newProvider) {
  repository.updateProvider(newProvider);
  console.log(`✅ Updated provider for ${repository.count()} wallet(s)`);
} 