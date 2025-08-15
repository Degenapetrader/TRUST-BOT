/**
 * MMBot Entry Point - Backward Compatibility Wrapper
 * This file maintains backward compatibility by wrapping the new modular mmbot
 */

// Import and run the optimized mmbot
import { runMMBot } from './src/bots/mmbot.js';

// Pass command line arguments to the new mmbot
const args = process.argv.slice(2);
runMMBot(args).then(() => process.exit(0)).catch(() => process.exit(1)); 