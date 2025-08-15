/**
 * Optimized BuyBot Entry Point
 * Main entry point for the buybot with modular architecture
 */

import { ethers } from 'ethers';
import { Alchemy, Network } from 'alchemy-sdk';
import { tradingWallets, walletsReady } from '../wallets.js';
import { getAlchemyConfig } from '../config.js';
import { CommandParser } from './services/commandParser.js';
import { TokenResolver } from './services/tokenResolver.js';
import { TransactionTracker } from './services/transactionTracker.js';
import { ExecutionManager } from './services/executionManager.js';
import { EXECUTION_MODES } from './config/constants.js';
import { provider } from '../config.js';

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
 * Main function to run the buybot
 * @param {Array} args - Command line arguments
 */
async function main(args) {
  try {
    console.log('\n🟢 BUYBOT INITIALIZED');
    console.log('======================');
    
    // Wait for wallets to be initialized before proceeding
    console.log('⏳ Waiting for wallet initialization...');
    const walletInitResult = await Promise.race([
      walletsReady,
      new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 10000))
    ]);
    
    // Check if wallet initialization timed out
    if (walletInitResult && walletInitResult.timeout) {
      console.warn('⚠️ Wallet initialization timed out after 10 seconds');
    } else {
      console.log(`✅ Wallet initialization complete. ${tradingWallets.length} wallets available.`);
    }
    
    // Log environment variables related to wallets
    console.log('\n===== WALLET ENVIRONMENT VARIABLES =====');
    let envWalletCount = 0;
    const directWallets = [];
    
    // Check for direct wallet private keys in environment variables (B1, B2, etc.)
    for (let i = 0; i < 20; i++) { // Check up to 20 possible wallets
      const envKey = `B${i + 1}`;
      const privateKey = process.env[envKey];
      
      if (privateKey && privateKey.length > 0) {
        envWalletCount++;
        console.log(`Found wallet private key in ${envKey} (length: ${privateKey.length})`);
        
        try {
          // Create a wallet directly from the private key
          const wallet = new ethers.Wallet(privateKey, provider);
          console.log(`✅ Created wallet ${i+1} from environment: ${wallet.address}`);
          
          // Add metadata to help identify the wallet
          wallet.name = `Wallet ${i+1}`;
          wallet.index = i;
          wallet._fromEnv = true;
          
          // Add to our direct wallets array
          directWallets.push(wallet);
        } catch (error) {
          console.error(`❌ Error creating wallet from ${envKey}: ${error.message}`);
        }
      }
    }
    
    console.log(`Found ${envWalletCount} wallet keys in environment variables`);
    console.log(`Successfully created ${directWallets.length} wallets directly from environment`);
    
    // Initialize Alchemy if available
    const alchemyConfig = getAlchemyConfig();
    let alchemy = null;
    if (alchemyConfig.available) {
      alchemy = new Alchemy({
        apiKey: alchemyConfig.apiKey,
        network: Network.BASE_MAINNET,
      });
      console.log('✅ Alchemy SDK initialized');
    }
    
    // Debug wallet status
    console.log('\n===== WALLET AVAILABILITY CHECK =====');
    console.log(`tradingWallets array length: ${tradingWallets.length}`);
    console.log(`Direct environment wallets: ${directWallets.length}`);
    
    // Combine both sources of wallets, preferring direct environment wallets if available
    const combinedWallets = directWallets.length > 0 ? directWallets : tradingWallets;
    
    console.log(`🔍 Final wallet count: ${combinedWallets.length} wallets available`);
    
    // Log detailed information about each wallet
    if (combinedWallets.length > 0) {
      console.log('\n===== AVAILABLE WALLETS =====');
      combinedWallets.forEach((wallet, idx) => {
        const source = wallet._fromEnv ? 'ENV VARIABLE' : 'WALLET MODULE';
        console.log(`[${idx}] ${wallet.name || `Wallet ${idx+1}`}: ${wallet.address} [Source: ${source}]`);
      });
    }
    
    // Fail if no wallets are available from any source
    if (combinedWallets.length === 0) {
      console.error('❌ CRITICAL ERROR: No wallets are available from any source!');
      console.error('This could be due to:');
      console.error('1. No wallet private keys in environment variables (B1, B2, etc.)');
      console.error('2. Wallet module failed to initialize any wallets');
      console.error('3. Master password may be incorrect or missing');
      console.error('⚠️ Without wallets, the operation cannot continue.');
      process.exit(1);
    }
    
    // Parse command with our combined wallets
    console.log('\n===== PARSING COMMAND WITH COMBINED WALLETS =====');
    
    // Import WalletParser directly to avoid async issues
    const { WalletParser } = await import('../parsing/walletParser.js');
    
    // Create our custom walletParser function that uses combinedWallets instead of tradingWallets
    const customParse = (args) => {
      // This overrides the parseAndSelectWallets method in ArgumentParser
      return WalletParser.parse(args, combinedWallets, { debug: true });
    };
    
    // Monkey patch the CommandParser's wallet selection to use our combined wallets
    const originalMethod = CommandParser.parseNewCommandFormat;
    CommandParser.parseNewCommandFormat = function(args) {
      // Check if we have WALLETTOKEN_SELECTED or WALLETTOKEN_ALL environment variables
      const selectedIndicesStr = process.env.WALLETTOKEN_SELECTED;
      const useAllWallets = process.env.WALLETTOKEN_ALL === 'true' || args.includes('WALLETTOKEN');
      
      console.log(`\n===== CHECKING WALLETTOKEN ENVIRONMENT VARIABLES =====`);
      console.log(`WALLETTOKEN_SELECTED: ${selectedIndicesStr || 'Not set'}`);
      console.log(`WALLETTOKEN_ALL: ${process.env.WALLETTOKEN_ALL || 'Not set'}`);
      console.log(`WALLETTOKEN in args: ${args.includes('WALLETTOKEN')}`);
      
      // If WALLETTOKEN_SELECTED is set, use those specific wallet indices
      if (selectedIndicesStr) {
        try {
          // Parse the selected indices - IMPORTANT: main.js sends 0-based indices, but
          // when a wallet like B3 is selected, it's actually index 2 (0-based)
          const selectedIndices = selectedIndicesStr.split(',').map(Number);
          console.log(`🔑 Using specific wallets from WALLETTOKEN_SELECTED: [${selectedIndices.join(', ')}]`);
          
          // Special debug for B3 wallet (index 2)
          if (selectedIndices.includes(2)) {
            console.log('\n===== SPECIAL DEBUG FOR B3 WALLET =====');
            console.log('Detected B3 wallet selection (index 2)');
            console.log(`B3 environment variable length: ${process.env.B3 ? process.env.B3.length : 'not set'}`);
          }
          
          // Find the corresponding wallets from our combined wallets array
          const selectedWallets = [];
          
          // Direct lookup based on B1, B2, B3, etc. environment variables
          for (const index of selectedIndices) {
            const oneBasedIndex = index + 1; // Convert to 1-based for B1, B2, etc.
            const envKey = `B${oneBasedIndex}`;
            const privateKey = process.env[envKey];
            
            console.log(`Looking for wallet from ${envKey} environment variable`);
            
            // If we have a valid private key in this environment variable
            if (privateKey && privateKey.length > 0) {
              try {
                // Create wallet directly from the private key
                const wallet = new ethers.Wallet(privateKey, provider);
                console.log(`✅ Found wallet ${envKey} from environment variable: ${wallet.address}`);
                
                // Add metadata to help identify the wallet
                wallet.name = `Wallet ${oneBasedIndex}`;
                wallet.index = index;
                wallet._fromEnv = true;
                
                selectedWallets.push(wallet);
              } catch (error) {
                console.error(`❌ Error creating wallet from ${envKey}: ${error.message}`);
                // Explicitly log that we're skipping this wallet
                console.log(`⚠️ SKIPPING ${envKey} due to invalid private key`);
              }
            } else {
              console.log(`No private key found in ${envKey} environment variable`);
              console.log(`⚠️ SKIPPING ${envKey} due to missing private key`);
              
              // Don't try to find fallbacks for explicitly selected wallets
              // This ensures we only use wallets that were explicitly selected in the UI
            }
          }
          
          console.log(`Selected ${selectedWallets.length} wallets from indices ${selectedIndicesStr}`);
          
          // If no valid wallets were found from the selected indices, log an error
          if (selectedWallets.length === 0) {
            console.log(`❌ ERROR: None of the selected wallets (${selectedIndices.join(', ')}) have valid private keys`);
            console.log(`❌ Please check that the wallet private keys are correctly set in environment variables`);
            // Don't fall back to other wallets - respect the user's explicit selection
          }
          
          // Return the selected wallets
          return {
            ...originalMethod.call(this, args),
            selectedWallets: selectedWallets
          };
        } catch (error) {
          console.error(`Error parsing WALLETTOKEN_SELECTED: ${error.message}`);
        }
      }

      // If WALLETTOKEN is in args or WALLETTOKEN_ALL is true, use all wallets
      if (useAllWallets) {
        console.log('🔑 WALLETTOKEN detected - using all available wallets');
        return {
          ...originalMethod.call(this, args.filter(arg => arg !== 'WALLETTOKEN')),
          selectedWallets: combinedWallets,
        };
      }
      
      // Parse wallet selectors from arguments
      const walletResult = customParse(args);
      const remainingArgs = walletResult.remainingArgs;
      
      // Get the parsed command without wallet selection
      const result = originalMethod.call(this, remainingArgs);
      
      // Override the selected wallets with our parsed ones
      result.selectedWallets = walletResult.selectedWallets;
      
      return result;
    };
    
    // Parse the command with our enhanced parser
    const parsedCommand = CommandParser.parseNewCommandFormat(args);
    console.log(`👛 Selected wallets: ${parsedCommand.selectedWallets?.length || 0} of ${combinedWallets.length} available`);
    if (parsedCommand.selectedWallets.length > 0) {
      parsedCommand.selectedWallets.forEach((wallet, idx) => {
        console.log(`  - Wallet ${idx+1}: ${wallet.name || `Wallet ${idx+1}`} (${wallet.address})`); 
      });
    }
    
    // Validate the command
    CommandParser.validateCommand(parsedCommand);
    
    // Initialize services
    const tokenResolver = new TokenResolver(alchemy, parsedCommand.bidMode);
    const tracker = new TransactionTracker();
  
    // Execute based on mode
    let results = [];
    const startTime = Date.now();
    
    // Debug output to help troubleshoot the "Cannot read properties of undefined" error
    console.log(`\n===== DEBUG: PARSED COMMAND STRUCTURE =====`);
    console.log(`Mode: ${parsedCommand.mode}`);
    console.log(`Wallet count: ${parsedCommand.selectedWallets?.length || 'NOT SET!'}`);
    console.log(`Token pairs count: ${parsedCommand.tokenAmountPairs?.length || 'NOT SET!'}`);
    
    // Ensure tokenAmountPairs exists and is valid
    if (!parsedCommand.tokenAmountPairs || !Array.isArray(parsedCommand.tokenAmountPairs)) {
      console.error(`❌ ERROR: tokenAmountPairs is ${parsedCommand.tokenAmountPairs === undefined ? 'undefined' : 'not an array'}`);
      if (parsedCommand.tokens && parsedCommand.amounts) {
        console.log(`⚠️ Attempting to recreate tokenAmountPairs from tokens and amounts arrays...`);
        parsedCommand.tokenAmountPairs = parsedCommand.tokens.map((token, index) => ({
          tokenInfo: token,
          amount: parsedCommand.amounts[index] || parsedCommand.amounts[0]
        }));
        console.log(`✅ Created ${parsedCommand.tokenAmountPairs.length} token-amount pairs`);
      } else {
        throw new Error('Cannot create tokenAmountPairs: tokens or amounts are missing');
      }
    }
    
    // Log about the wallet handoff to execution manager
    console.log(`\n===== HANDING OFF ${parsedCommand.selectedWallets?.length || 0} WALLETS TO EXECUTION MANAGER =====`);
    
    if (parsedCommand.mode === EXECUTION_MODES.TWAP) {
      console.log(`📈 Executing TWAP mode with ${parsedCommand.selectedWallets.length} wallets`);
      results = await ExecutionManager.executeTWAP(parsedCommand, tracker);
    } else {
      // Handle loops
      const loops = parsedCommand.loops || 1;
      
      for (let loop = 1; loop <= loops; loop++) {
        if (loops > 1) {
          console.log(`\n🔄 =============== LOOP ${loop}/${loops} ===============`);
        }
        
        let loopResults;
        if (parsedCommand.mode === EXECUTION_MODES.SEQUENTIAL) {
          console.log(`🔄 Executing SEQUENTIAL mode with ${parsedCommand.selectedWallets.length} wallets`);
          loopResults = await ExecutionManager.executeSequentialBuy(
            parsedCommand.tokenAmountPairs,
            parsedCommand.selectedWallets,
            parsedCommand.customGasPrice,
            tracker,
            parsedCommand.bidMode
          );
        } else {
          console.log(`⚡ Executing PARALLEL mode with ${parsedCommand.selectedWallets.length} wallets`);
          loopResults = await ExecutionManager.executeParallelBuy(
            parsedCommand.tokenAmountPairs,
            parsedCommand.selectedWallets,
            parsedCommand.customGasPrice,
            tracker,
            parsedCommand.bidMode
          );
        }
        
        results.push(...loopResults);
        
        // Delay between loops
        if (loop < loops) {
          const delay = 3000 + Math.random() * 2000;
          console.log(`\n⏳ Waiting ${Math.round(delay/1000)}s before next loop...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // Display final summary
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n⏱️ Total execution time: ${elapsedTime}s`);
    
    // Display transaction summary
    tracker.displaySummary({ detailed: true });
    
    const totalTransactions = results.length;
    const successfulTransactions = results.filter(r => 
      r.status === 'fulfilled' && (!r.value.error)
    ).reduce((sum, r) => sum + (r.value.successful || 0), 0);
    
    const totalAttempts = results.filter(r => 
      r.status === 'fulfilled' && (!r.value.error)
    ).reduce((sum, r) => sum + (r.value.successful || 0) + (r.value.failed || 0), 0);
    
  } catch (error) {
    console.error(`\n❌ FATAL ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}


// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  main(args);
}

export { main as runBuybot }; 