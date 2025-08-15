/**
 * Market Making Bot - Main Entry Point
 * Optimized version using modular services
 */

import { MMBot } from './mm-bot-optimized.js';
import { MMCommandParser } from './services/mmCommandParser.js';
import { TokenResolver } from './services/tokenResolver.js';
import { WalletParser } from '../parsing/walletParser.js';
import { ethers } from 'ethers';
import { tradingWallets } from '../wallets.js';
import { provider } from '../config/index.js';
import { MMTracker } from './services/mmTracker.js';
import { PriceMonitor } from './services/priceMonitor.js';
import { SwapExecutor } from './services/swapExecutor.js';
import { TransactionTracker } from './services/transactionTracker.js';
import { CONTRACTS } from './config/constants.js';

// Global termination flag for graceful shutdown
let isTerminating = false;

// Export termination flag globally so other modules can check it
global.isTerminating = false;

// Signal handlers for graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM. Shutting down gracefully...');
  isTerminating = true;
  global.isTerminating = true;
});

process.on('SIGINT', () => {
  console.log('\n👋 Received SIGINT. Shutting down gracefully...');
  isTerminating = true;
  global.isTerminating = true;
});

/**
 * Main entry point for mmbot
 * @param {Array} args - Command line arguments
 */
export async function runMMBot(args) {
  console.log('=====================================');
  console.log('🚀 MMBot STARTUP DIAGNOSTIC LOG');
  console.log('=====================================');
  console.log(`📋 Command arguments: ${args ? JSON.stringify(args) : 'none'}`);
  console.log(`🔧 Node.js version: ${process.version}`);
  console.log(`⏰ Current time: ${new Date().toISOString()}`);
  
  try {
    console.log(`🔄 MMBot: Starting execution with ${args ? args.length : 0} arguments`);
    
    // Create a collection of wallets from environment variables (B1-B20)
    console.log(`🔐 MMBot: Checking for wallet private keys...`);
    
    // Collect all wallets - from env vars and wallets.json
    const allWallets = [];
    
    // First, add wallets from environment variables (B1-B20)
    const envWallets = [];
    
    // Use the imported provider from config
    console.log(`🌐 Using provider from config/index.js`);
    
    // Check for BID-MODE operation
    const isBidMode = args.some(arg => arg.toLowerCase() === 'bid-mode');
    if (isBidMode) {
      console.log(`🔵 DETECTED BID-MODE: Operating in ETH trading mode`);
    }
    
    for (let i = 1; i <= 20; i++) {
      const envName = `B${i}`;
      const privateKey = process.env[envName];
      
      if (privateKey && privateKey.length > 30) { // Simple validation
        try {
          // Create wallet with ethers
          const wallet = new ethers.Wallet(privateKey, provider);
          
          // Add metadata
          wallet.name = envName;
          wallet.metadata = { _keyFromEnv: true };
          
          envWallets.push(wallet);
          console.log(`✅ Loaded wallet ${envName} from environment variable: ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`);
        } catch (error) {
          console.error(`❌ Error loading wallet ${envName} from environment: ${error.message}`);
        }
      }
    }
    
    // Report on environment wallets
    if (envWallets.length > 0) {
      console.log(`🔐 MMBot: Found ${envWallets.length} valid wallets from environment variables`);
      
      // Add to combined wallet list
      allWallets.push(...envWallets);
    } else {
      console.log(`⚠️ MMBot: No valid wallet private keys found in environment variables`);
    }
    
    // Next, add wallets from tradingWallets array (wallets.json)
    const jsonWallets = tradingWallets.filter(wallet => 
      // Filter out any wallets that would duplicate env wallets
      !envWallets.some(envWallet => envWallet.address === wallet.address)
    );
    
    // Report on JSON wallets
    if (jsonWallets.length > 0) {
      console.log(`📄 MMBot: Adding ${jsonWallets.length} wallet(s) from wallets.json`);
      
      // Add to combined wallet list
      allWallets.push(...jsonWallets);
    }
    
    // Report on final combined wallet list
    console.log(`👛 MMBot: Using a combined total of ${allWallets.length} wallet(s) for execution`);
    console.log(`   🔐 ${envWallets.length} wallet(s) from environment variables`);
    console.log(`   📄 ${jsonWallets.length} wallet(s) from wallets.json`);
    
    console.log('🔍 DIAGNOSTIC: About to patch WalletParser');
    console.log(`🔍 DIAGNOSTIC: Available wallets count: ${allWallets.length}`);
    
    // Store original parse method
    const originalParse = WalletParser.parse;
    
    // Monkey patch WalletParser.parse to use our combined wallet list
    WalletParser.parse = function(args, _unusedWallets, options = {}) {
      console.log(`🔍 DIAGNOSTIC: Inside patched WalletParser with ${args ? args.length : 0} args`);
      console.log(`🔍 DIAGNOSTIC: Using ${allWallets.length} wallets for parsing`);
      // Call original parse method but with our combined wallet list
      try {
        return originalParse.call(this, args, allWallets, options);
      } catch (error) {
        console.error(`❌ ERROR in patched WalletParser: ${error.message}`);
        console.error(`❌ ERROR stack: ${error.stack}`);
        throw error;
      }
    };
    
    // Parse command with our patched method
    console.log('🔍 DIAGNOSTIC: About to call MMCommandParser.parseCommand');
    let config;
    try {
      config = MMCommandParser.parseCommand(args);
      console.log('✅ Command parsing successful!');
    } catch (error) {
      console.error(`❌ ERROR parsing command: ${error.message}`);
      console.error(`❌ ERROR stack: ${error.stack}`);
      throw new Error(`Command parsing failed: ${error.message}`);
    }
    
    // Restore original method
    WalletParser.parse = originalParse;
    console.log('🔄 Restored original WalletParser method');
    
    // Resolve token
    const resolver = new TokenResolver();
    const tokenInfo = await resolver.getTokenInfo(config.token);
    
    if (!tokenInfo) {
      throw new Error(`Failed to resolve token: ${config.token}`);
    }
    
    console.log(`✅ Token resolved: ${tokenInfo.symbol}`);
    
    // Check if pool exists
    if (!tokenInfo.poolAddress) {
      throw new Error(`No liquidity pool found for ${tokenInfo.symbol}. Market making requires an active pool.`);
    }
    
    // Create MMBot instance
    const mmbot = new MMBot(
      config.selectedWallets,
      tokenInfo,
      CONTRACTS.VIRTUAL,
      {
        mode: 'normal', // Can be enhanced to support different modes
        customGasPrice: config.customGasPrice
      }
    );
    
    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Received interrupt signal...');
      mmbot.stop();
      process.exit(0);
    });
    
    // Start market making
    await mmbot.start(config);
    
  } catch (error) {
    console.log('=====================================');
    console.log('❌ MMBot ERROR DIAGNOSTIC');
    console.log('=====================================');
    console.log(`❌ Error message: ${error.message}`);
    console.log(`❌ Error name: ${error.name}`);
    console.log(`❌ Error stack: ${error.stack}`);
    
    if (error.cause) {
      console.log(`❌ Error cause: ${error.cause}`);
    }
    
    // Check if tradingWallets is valid
    try {
      console.log(`🔍 DIAGNOSTIC: tradingWallets is ${typeof tradingWallets}`);
      console.log(`🔍 DIAGNOSTIC: tradingWallets length: ${tradingWallets ? tradingWallets.length : 'undefined'}`);
    } catch (diagError) {
      console.log(`❌ ERROR accessing tradingWallets: ${diagError.message}`);
    }
    
    // Check if WalletParser is valid
    try {
      console.log(`🔍 DIAGNOSTIC: WalletParser is ${typeof WalletParser}`);
      console.log(`🔍 DIAGNOSTIC: WalletParser.parse is ${typeof WalletParser.parse}`);
    } catch (diagError) {
      console.log(`❌ ERROR accessing WalletParser: ${diagError.message}`);
    }
    
    console.log('\n--- SHOWING USAGE INFO ---');
    MMCommandParser.showUsage();
    process.exit(1);
  }
}

// If called directly, run with command line args
if (process.argv[1].endsWith('mmbot.js')) {
  const args = process.argv.slice(2);
  runMMBot(args);
} 