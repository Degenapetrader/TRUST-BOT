import { runStargateBridge } from './src/stargateBridge.js';

// Parse arguments and execute
async function main() {
  const args = process.argv.slice(2).filter(arg => arg !== '--'); // Filter out npm's -- separator
  
  try {
    // Pass all arguments to the stargate bridge
    await runStargateBridge(args);
    
    console.log('\n🏁 Stargate Bridge completed!');
    process.exit(0);
    
  } catch (error) {
    console.log(`\n❌ Stargate Bridge error: ${error.message}`);
    console.log(`💡 Use 'npm run stargate' without arguments to see usage`);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.log(`\n❌ Fatal error: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.log(`\n❌ Unhandled rejection: ${error.message}`);
  process.exit(1);
});

// Only run main if this file is executed directly
if (process.argv[1].endsWith('stargate.mjs')) {
    main();
} 