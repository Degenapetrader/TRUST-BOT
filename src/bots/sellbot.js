/**
 * Sellbot Main Entry Point
 * Routes to the optimized SellBot implementation
 */

import { SellBot } from './sell-bot-optimized.js';

// Main execution
async function main() {
  try {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
      const { SellCommandParser } = await import('./services/sellCommandParser.js');
      SellCommandParser.showUsage();
      process.exit(0);
    }
    
    const result = await SellBot.execute(args);
    
    if (result && !result.success) {
      process.exit(1);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

// Export the SellBot class for programmatic usage
export { SellBot };
export default SellBot; 