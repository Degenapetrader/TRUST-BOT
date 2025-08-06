/**
 * Utils.js - Backward compatibility wrapper
 * This file maintains the original API by re-exporting from the modular utils structure
 */

// Import and re-export everything from the modular utils
export * from './utils/index.js';

// Also provide default export for any code using default imports
import utils from './utils/index.js';
export default utils;