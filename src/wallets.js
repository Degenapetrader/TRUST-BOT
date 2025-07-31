/**
 * Wallets.js - Backward compatibility wrapper
 * This file maintains the original API by re-exporting from the modular wallets structure
 */

// Import and re-export everything from the modular wallets
export * from './wallets/index.js';

// Also provide any additional exports that might be used by legacy code
import * as wallets from './wallets/index.js';
export default wallets;