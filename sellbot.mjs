/**
 * Sellbot Main Entry Point
 * This file is now a thin wrapper that imports and runs the sellbot wrapper
 */

// Import and run the sellbot wrapper (consistent with buybot)
import { SellBot } from './src/bots/sellbot.js';

// Main execution - Copy farmbot.mjs pattern for auto-stop
const args = process.argv.slice(2);
SellBot.execute(args).then(() => process.exit(0)).catch(() => process.exit(1)); 