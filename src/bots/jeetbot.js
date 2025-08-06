/**
 * JeetBot Wrapper - Optimized Architecture
 * Handles command line integration and delegates to optimized class
 */

import { JeetBot } from './jeet-bot-optimized.js';

/**
 * Main JeetBot execution function
 * @param {string[]} args - Command line arguments
 */
export async function runJeetBot(args) {
  /// console.log('🤖 Starting JEETBOT with optimized architecture...');
  
  try {
    // Create JeetBot instance
    const jeetBot = new JeetBot();
    
    // Phase 1: Complete Initialization & Validation
    const initSuccess = await jeetBot.initializePhase1(args);
    if (!initSuccess) {
      console.log('❌ JEETBOT initialization failed. Exiting...');
      process.exit(1);
    }
    
    // Execute bot based on configured mode
    await jeetBot.execute();
    
  } catch (error) {
    console.error('❌ JEETBOT execution failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Handle command line execution
if (import.meta.url === `file://${process.argv[1]}`) {
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

  // Run the bot
  runJeetBot(args);
} 