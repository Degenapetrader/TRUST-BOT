// Backward compatibility wrapper for jeetbot.mjs
// This file maintains the original jeetbot.mjs interface while using the new optimized structure

import { runJeetBot } from './src/bots/jeetbot.js';

// Get command line arguments (excluding node and script name)
const args = process.argv.slice(2);

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\n👋 Received SIGINT. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM. Shutting down gracefully...');
  process.exit(0);
});

// Run the bot with arguments - Copy farmbot.mjs pattern for auto-stop
runJeetBot(args).then(() => process.exit(0)).catch(() => process.exit(1));