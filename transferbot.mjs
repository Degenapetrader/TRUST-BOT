import { runTransferBot } from './src/transferBot.js';

// Parse arguments and execute
async function main() {
  const args = process.argv.slice(2);
  
  try {
    // Pass all arguments to the transfer bot
    await runTransferBot(args);
    
    console.log('\n🏁 TransferBot completed!');
    process.exit(0);
    
  } catch (error) {
    console.log(`\n❌ TransferBot error: ${error.message}`);
    console.log(`💡 Use 'npm run transferbot' without arguments to see usage`);
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
if (process.argv[1].endsWith('transferbot.mjs')) {
    main();
} 