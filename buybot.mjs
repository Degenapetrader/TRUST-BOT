/**
 * BuyBot Entry Point - Backward Compatibility Wrapper
 * This file maintains backward compatibility by wrapping the new modular buybot
 */

// Import and run the optimized buybot
import { runBuybot } from './src/bots/buybot.js';

// Pass command line arguments to the new buybot
const args = process.argv.slice(2);
runBuybot(args).then(() => process.exit(0)).catch(() => process.exit(1)); 