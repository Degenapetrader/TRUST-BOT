import { log, sleep, getRandomInt } from './utils.js';
import { tradingWallets } from './wallets.js';
import { executeTrading } from './swap.js';
import { BOT_CONFIG, BOT_MODE, TRADING_STRATEGY, JEET_CONFIG } from './config.js';
import { 
  claimOnly, 
  compareDetectionMethods,
  monitorAndExecuteSameBlock
} from './jeet-functions.js';
import { ethers } from 'ethers';

// JEET Mode execution function (DETECTION + SAME-BLOCK STRATEGY)
async function executeJeetMode() {
  log('JEET Mode - DETECTION + SAME-BLOCK STRATEGY');
  log(`🎯 Detection: Monitor for token deployment`);
  log(`🚀 Strategy: CLAIM+APPROVE+SWAP in same block for maximum speed`);
  log(`Genesis Contract: ${JEET_CONFIG.genesisContract}`);
  log(`Uniswap Router: ${JEET_CONFIG.uniswapRouter}`);
  log(`JEET gas price: 0.1 gwei (hard coded)`);
  const { walletsDB } = await import('./config.js');
  const pollingInterval = walletsDB?.config?.pollIntervalMs || 10;
  log(`POLLING: ${pollingInterval}ms`);
  log(`Trading Wallets: ${tradingWallets.length}`);

  if (!JEET_CONFIG.genesisContract) {
    throw new Error('GENESIS_CONTRACT is required for JEET mode');
  }

  // Start detection and same-block execution
  log('🚀 Starting TOKEN DETECTION + SAME-BLOCK EXECUTION...');
  log('⚡ Monitoring for token deployment...');
  log('🏁 When detected → CLAIM+APPROVE+SWAP simultaneously');
  
  try {
    const results = await monitorAndExecuteSameBlock(
      tradingWallets,
      JEET_CONFIG.genesisContract,
      JEET_CONFIG.uniswapRouter,
      JEET_CONFIG.slippageBasisPoints
    );
    
    return results;
    
  } catch (error) {
    log(`Fatal error in DETECTION + SAME-BLOCK mode: ${error.message}`);
    throw error;
  }
}

// Manual Claim function for all wallets
async function executeManualClaim() {
  log('Manual Claim Mode - Claiming tokens only');
  
  const results = [];
  
  for (let i = 0; i < tradingWallets.length; i++) {
    const wallet = tradingWallets[i];
    try {
      log(`Processing Wallet ${i + 1}: ${wallet.address}`);
      
      const result = await claimOnly(wallet, JEET_CONFIG.genesisContract);
      
      results.push({
        wallet: wallet.address,
        walletIndex: i + 1,
        success: result.success,
        result: result
      });
      
      if (result.success) {
        log(`Wallet ${i + 1} claim successful`);
      } else {
        log(`Wallet ${i + 1} claim failed: ${result.reason}`);
      }
      
    } catch (error) {
      log(`Wallet ${i + 1} error: ${error.message}`);
      results.push({
        wallet: wallet.address,
        walletIndex: i + 1,
        success: false,
        error: error.message
      });
    }
    
    // Small delay between wallets
    if (i < tradingWallets.length - 1) {
      await sleep(500);
    }
  }
  
  const successCount = results.filter(r => r.success).length;
  log(`Manual Claim Summary: ${successCount}/${tradingWallets.length} successful`);
  
  return results;
}



// Main function
async function main() {
  try {
    log(`Bot Mode: ${BOT_MODE}`);
    log(`Trading Strategy: ${TRADING_STRATEGY}`);
    log(`Trading wallets: ${tradingWallets.length}`);

    if (BOT_MODE === 'JEET') {
      log(`JEET MODE - DETECTION + SAME-BLOCK STRATEGY`);
      log(`DETECTION: Monitor for token deployment`);
      log(`WORKFLOW: Token detected → CLAIM+APPROVE+SWAP in same block`);
      
      // Check command line args
      const args = process.argv.slice(2);
      
      if (args.includes('--claim-only')) {
        await executeManualClaim();
      } else if (args.includes('--compare-detection')) {
        const genesisAddress = args[args.indexOf('--compare-detection') + 1];
        if (!genesisAddress || genesisAddress.length !== 42 || !genesisAddress.startsWith('0x')) {
          log('❌ Please provide a valid Genesis contract address after --compare-detection');
          log('   Example: node src/index.js --compare-detection 0x1234...');
          process.exit(1);
        }
        log(`🏁 Starting detection comparison for Genesis: ${genesisAddress}`);
        await compareDetectionMethods(genesisAddress);
        return;
      } else {
        // Default JEET behavior: Detection + Same-Block Strategy
        await executeJeetMode();
      }
      
    } else {
      log(`REGULAR TRADING MODE`);
      log(`Number of loops: ${BOT_CONFIG.numLoops}`);
      log(`Virtual amount range: ${BOT_CONFIG.virtualAmountMin} - ${BOT_CONFIG.virtualAmountMax} VIRTUAL`);

      // Execute trading strategy
      log(`Starting ${TRADING_STRATEGY} execution for ${BOT_CONFIG.numLoops} loop(s)`);
      let totalSuccessCount = 0;
      let totalFailCount = 0;

      for (let loop = 1; loop <= BOT_CONFIG.numLoops; loop++) {
        log(`STARTING LOOP ${loop} OF ${BOT_CONFIG.numLoops}`);
        
        const results = await executeTrading();

        // Track statistics
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        totalSuccessCount += successCount;
        totalFailCount += failCount;

        log(`Loop ${loop} completed: ${successCount} successful operations, ${failCount} failed operations`);

        // If we haven't reached the last loop, add a delay before the next loop
        if (loop < BOT_CONFIG.numLoops) {
          const loopDelaySeconds = getRandomInt(BOT_CONFIG.loopDelayMin, BOT_CONFIG.loopDelayMax);
          log(`Waiting ${loopDelaySeconds} seconds before starting next loop`);
          await sleep(loopDelaySeconds * 1000);
        }
      }

      // Summary
      log(`${TRADING_STRATEGY} Strategy execution completed`);
      log(`Total Summary: ${totalSuccessCount} successful operations, ${totalFailCount} failed operations across ${BOT_CONFIG.numLoops} loops`);
      log('Bot execution completed');
    }

  } catch (error) {
    log(`Error in main execution: ${error.message}`);
    if (error.stack) {
      log(`Stack trace: ${error.stack}`);
    }
  }
}

// Execute main function
main()
  .then(() => {
    log('Bot execution completed successfully. Exiting...');
    process.exit(0);
  })
  .catch(error => {
    log(`Fatal error: ${error.message}`);
    process.exit(1);
  });