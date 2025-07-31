/**
 * ArgParser.js - Backward compatibility wrapper
 * This file maintains the original API by re-exporting from the modular parsing structure
 */

// Import and re-export everything from the modular parsing
export * from './index.js';

// Also provide default export for any code using default imports
import * as parsing from './index.js';
export default parsing; 