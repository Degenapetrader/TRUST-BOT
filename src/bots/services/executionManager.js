/**
 * Execution Manager Service
 * Handles different execution modes for trading operations
 */

import { ethers } from 'ethers';
import { ArgumentParser, ResultProcessor } from '../../parsing/argParser.js';
import { BuyBot } from '../buy-bot-optimized.js';
import { SwapExecutor } from './swapExecutor.js';
import { AmountCalculator } from './amountCalculator.js';
import { CONTRACTS, DEFAULT_SETTINGS } from '../config/constants.js';
import { provider } from '../../config.js';
import { sleep } from '../../utils.js';

/**
 * ExecutionManager - Manages different execution modes for trading
 */
export class ExecutionManager {
  /**
   * Calculate actual amount handling percentages
   * @param {string|number} amount - Amount or percentage string
   * @param {Object} wallet - Wallet instance
   * @param {Object} currencyInfo - Currency information
   * @returns {number} Calculated amount
   */
  static async calculateActualAmount(amount, wallet, currencyInfo) {
    if (typeof amount === 'string' && amount.includes('%')) {
      // Handle percentage amounts
      if (currencyInfo.isVirtual) {
        // Get VIRTUAL balance for percentage calculation
        const virtualContract = new ethers.Contract(CONTRACTS.VIRTUAL, [
          'function balanceOf(address) view returns (uint256)'
        ], provider);
        const balance = await virtualContract.balanceOf(wallet.address);
        const virtualBalance = parseFloat(ethers.formatUnits(balance, 18));
        
        return AmountCalculator.calculatePercentageAmount(amount, virtualBalance);
      } else {
        // Get currency balance for percentage calculation
        let currencyBalance;
        if (currencyInfo.isEth) {
          const balance = await provider.getBalance(wallet.address);
          currencyBalance = parseFloat(ethers.formatEther(balance));
        } else {
          const currencyContract = new ethers.Contract(currencyInfo.address, [
            'function balanceOf(address) view returns (uint256)'
          ], provider);
          const balance = await currencyContract.balanceOf(wallet.address);
          currencyBalance = parseFloat(ethers.formatUnits(balance, currencyInfo.decimals));
        }
        
        return AmountCalculator.calculatePercentageAmount(amount, currencyBalance);
      }
    } else {
      // Validate non-percentage amounts
      return ArgumentParser.validateAmount(amount, 'amount');
    }
  }

  /**
   * Execute single buy operation for a wallet
   * @param {Object} params - Execution parameters
   * @returns {Object} Execution result
   */
  static async executeSingleBuy(params) {
    const { wallet, walletIndex, tokenInfo, currencyInfo, amount, customGasPrice, tracker, bidMode = false } = params;
    
    try {
      console.log(`  [Wallet ${walletIndex + 1}] Buying ${tokenInfo.symbol}...`);
      
      // Calculate actual amount
      const actualAmount = await this.calculateActualAmount(amount, wallet, currencyInfo);
      console.log(`    💰 Amount: ${AmountCalculator.formatAmount(actualAmount, currencyInfo.symbol)}`);
      
      let result;
      
      // BID-MODE: Direct ETH → Token swap using TRUSTSWAP
      // DISABLED FOR ETH: Force ETH to use working two-step path like regular BuyBot
      if (bidMode && currencyInfo.isEth) {
        console.log(`    ⚠️ ETH with BID-MODE: Forcing two-step path (like regular BuyBot) instead of executeETHBuy`);
        result = await SwapExecutor.executeTwoStepBuy(wallet, currencyInfo, tokenInfo, actualAmount, customGasPrice, tracker);
      } else if (bidMode && !currencyInfo.isEth) {
        console.log(`    🎯 BID-MODE: Using TRUSTSWAP.swapETHForTokensWithFee`);
        result = await SwapExecutor.executeETHBuy(wallet, tokenInfo, actualAmount, customGasPrice, tracker);
      } else if (currencyInfo.isVirtual) {
        // Direct buy with VIRTUAL
        try {
          const buyBot = new BuyBot([wallet], tokenInfo, CONTRACTS.VIRTUAL, DEFAULT_SETTINGS, customGasPrice);
          result = await buyBot.executeBuy(wallet, actualAmount, DEFAULT_SETTINGS.MAX_SLIPPAGE_PERCENT);
          
          // Ensure result is valid
          if (!result) {
            result = {
              success: false,
              error: 'BuyBot.executeBuy returned undefined'
            };
          }
          
          if (result.success && tracker) {
            tracker.addTransaction(
              wallet.address,
              'VIRTUAL',
              actualAmount,
              tokenInfo.symbol,
              result.tokensReceived || 0
            );
          }
        } catch (buyError) {
          console.log(`    ❌ BuyBot error: ${buyError.message}`);
          result = {
            success: false,
            error: buyError.message
          };
        }
      } else {
        // Two-step buy with other currency
        result = await SwapExecutor.executeTwoStepBuy(wallet, currencyInfo, tokenInfo, actualAmount, customGasPrice, tracker);
      }
      
      const successMsg = result.twoStep ? 
        `${result.step1Hash} | ${result.step2Hash}` : 
        (result.txHash || result.error || result.reason || 'Unknown error');
      
      console.log(`  [Wallet ${walletIndex + 1}] ${result.success ? '✅ Success' : '❌ Failed'}: ${successMsg}`);
      return { ...result, walletIndex: walletIndex + 1, tokenSymbol: tokenInfo.symbol };
      
    } catch (error) {
      console.log(`  [Wallet ${walletIndex + 1}] ❌ Error: ${error.message}`);
      return { success: false, error: error.message, walletIndex: walletIndex + 1, tokenSymbol: tokenInfo.symbol };
    }
  }

  /**
   * Execute parallel buy operations (tokens sequential, wallets parallel)
   * @param {Array} tokenAmountPairs - Token-amount pairs
   * @param {Array} selectedWallets - Selected wallets
   * @param {string} customGasPrice - Custom gas price
   * @param {Object} tracker - Transaction tracker
   * @param {boolean} bidMode - Whether BID-MODE is enabled
   * @returns {Array} Execution results
   */
  static async executeParallelBuy(tokenAmountPairs, selectedWallets, customGasPrice, tracker, bidMode = false) {
    // Validate inputs with detailed error messages
    if (!Array.isArray(tokenAmountPairs)) {
      console.log('⚠️ Token-amount pairs is not an array:', typeof tokenAmountPairs);
      throw new Error('Invalid token-amount pairs: not an array');
    }
    
    if (tokenAmountPairs.length === 0) {
      console.log('⚠️ Token-amount pairs array is empty');
      throw new Error('Invalid token-amount pairs: empty array');
    }
    
    if (!Array.isArray(selectedWallets)) {
      console.log('⚠️ Selected wallets is not an array:', typeof selectedWallets);
      throw new Error('Invalid wallets: not an array');
    }
    
    if (selectedWallets.length === 0) {
      console.log('⚠️ No wallets selected for execution');
      throw new Error('Invalid wallets: empty array');
    }
    
    // Debug wallet information
    console.log(`\n===== WALLET DEBUG IN EXECUTION MANAGER =====`);
    console.log(`Selected wallets count: ${selectedWallets.length}`);
    selectedWallets.forEach((wallet, idx) => {
      if (wallet) {
        console.log(`Wallet ${idx}: Address=${wallet.address?.substring(0,10)}..., HasPrivateKey=${!!wallet.privateKey}`);
      } else {
        console.log(`Wallet ${idx}: NULL or UNDEFINED`);
      }
    });
    
    console.log('\n🚀 PARALLEL EXECUTION (tokens sequential, wallets parallel)');
    console.log('===========================================================');
    
    const allResults = [];
    
    // Process each token sequentially
    for (let tokenIndex = 0; tokenIndex < tokenAmountPairs.length; tokenIndex++) {
      const pair = tokenAmountPairs[tokenIndex];
      
      try {
        console.log(`\n🎯 ==================== TOKEN ${tokenIndex + 1}/${tokenAmountPairs.length}: ${pair.tokenInput} ====================`);
        
        const { TokenResolver } = await import('./tokenResolver.js');
        const resolver = new TokenResolver(null, bidMode);
        
        const tokenInfo = await resolver.getTokenInfo(pair.tokenInput);
        if (!tokenInfo) {
          throw new Error(`Failed to get token info for ${pair.tokenInput}`);
        }
        
        const currencyInfo = await resolver.getCurrencyInfo(pair.currency);
        if (!currencyInfo) {
          throw new Error(`Failed to get currency info for ${pair.currency}`);
        }
        
        // Display initial amount info
        if (currencyInfo.isVirtual) {
          console.log(`[Token ${tokenIndex + 1}] ${tokenInfo.symbol}: ${pair.amount} VIRTUAL per wallet`);
        } else {
          console.log(`[Token ${tokenIndex + 1}] ${tokenInfo.symbol}: ${pair.amount} ${currencyInfo.symbol} per wallet (two-step routing)`);
        }
        
        // Map wallets to execution promises
        const walletPromises = selectedWallets.map(async (wallet, walletIndex) => {
          // Validate wallet has the required properties before attempting to execute
          if (!wallet || !wallet.privateKey || !wallet.address) {
            console.log(`⚠️ Skipping wallet at index ${walletIndex} because it appears to be invalid or missing a private key`);
            // Return a dummy result instead of executing with invalid wallet
            return { 
              success: false, 
              walletIndex, 
              wallet: { address: `invalid-wallet-${walletIndex}` },
              error: 'Wallet validation failed - missing private key or address',
              skipped: true // Mark as explicitly skipped
            };
          }
          
          return this.executeSingleBuy({
            wallet,
            walletIndex,
            tokenInfo,
            currencyInfo,
            amount: pair.amount,
            customGasPrice,
            tracker,
            bidMode
          });
        });
        
        // Wait for all wallets to complete this token before moving to next token
        const { processedResults, successful, failed } = await ResultProcessor.processResults(walletPromises);
        
        console.log(`[Token ${tokenIndex + 1}] Results: ✅ ${successful}/${selectedWallets.length} (${((successful/selectedWallets.length)*100).toFixed(1)}%)`);
        
        allResults.push({ 
          status: 'fulfilled', 
          value: { tokenIndex: tokenIndex + 1, tokenInfo, successful, failed, results: processedResults }
        });
        
        // Small delay between tokens
        if (tokenIndex < tokenAmountPairs.length - 1) {
          console.log(`⏳ Moving to next token in 1 second...`);
          await sleep(1000);
        }
        
      } catch (error) {
        console.log(`[Token ${tokenIndex + 1}] ❌ Fatal error: ${error.message}`);
        allResults.push({ 
          status: 'fulfilled', 
          value: { tokenIndex: tokenIndex + 1, tokenInput: pair.tokenInput, error: error.message, successful: 0, failed: selectedWallets.length }
        });
      }
    }
    
    return allResults;
  }

  /**
   * Execute sequential buy operations
   * @param {Array} tokenAmountPairs - Token-amount pairs
   * @param {Array} selectedWallets - Selected wallets
   * @param {string} customGasPrice - Custom gas price
   * @param {Object} tracker - Transaction tracker
   * @param {boolean} bidMode - Whether BID-MODE is enabled
   * @returns {Array} Execution results
   */
  static async executeSequentialBuy(tokenAmountPairs, selectedWallets, customGasPrice, tracker, bidMode = false) {
    // Validate inputs with detailed error messages
    if (!Array.isArray(tokenAmountPairs)) {
      console.log('⚠️ Token-amount pairs is not an array:', typeof tokenAmountPairs);
      throw new Error('Invalid token-amount pairs: not an array');
    }
    
    if (tokenAmountPairs.length === 0) {
      console.log('⚠️ Token-amount pairs array is empty');
      throw new Error('Invalid token-amount pairs: empty array');
    }
    
    if (!Array.isArray(selectedWallets)) {
      console.log('⚠️ Selected wallets is not an array:', typeof selectedWallets);
      throw new Error('Invalid wallets: not an array');
    }
    
    if (selectedWallets.length === 0) {
      console.log('⚠️ No wallets selected for execution');
      throw new Error('Invalid wallets: empty array');
    }
    
    // Debug wallet information
    console.log(`\n===== WALLET DEBUG IN SEQUENTIAL EXECUTION MANAGER =====`);
    console.log(`Selected wallets count: ${selectedWallets.length}`);
    selectedWallets.forEach((wallet, idx) => {
      if (wallet) {
        console.log(`Wallet ${idx}: Address=${wallet.address?.substring(0,10)}..., HasPrivateKey=${!!wallet.privateKey}`);
      } else {
        console.log(`Wallet ${idx}: NULL or UNDEFINED`);
      }
    });
    
    console.log('\n🐌 SEQUENTIAL EXECUTION');
    console.log('========================');
    
    const allResults = [];
    
    for (let tokenIndex = 0; tokenIndex < tokenAmountPairs.length; tokenIndex++) {
      const pair = tokenAmountPairs[tokenIndex];
      
      try {
        console.log(`\n[Token ${tokenIndex + 1}/${tokenAmountPairs.length}] Processing ${pair.tokenInput}...`);
        
        const { TokenResolver } = await import('./tokenResolver.js');
        const resolver = new TokenResolver(null, bidMode);
        
        const tokenInfo = await resolver.getTokenInfo(pair.tokenInput);
        if (!tokenInfo) {
          throw new Error(`Failed to get token info for ${pair.tokenInput}`);
        }
        
        const currencyInfo = await resolver.getCurrencyInfo(pair.currency);
        if (!currencyInfo) {
          throw new Error(`Failed to get currency info for ${pair.currency}`);
        }
        
        // Display initial amount info for sequential mode
        if (currencyInfo.isVirtual) {
          console.log(`[Token ${tokenIndex + 1}] ${tokenInfo.symbol}: ${pair.amount} VIRTUAL per wallet (sequential)`);
        } else {
          console.log(`[Token ${tokenIndex + 1}] ${tokenInfo.symbol}: ${pair.amount} ${currencyInfo.symbol} per wallet (sequential, two-step routing)`);
        }
        
        const walletResults = [];
        
        // Execute for wallets one by one
        for (let walletIndex = 0; walletIndex < selectedWallets.length; walletIndex++) {
          const wallet = selectedWallets[walletIndex];
          
          // Validate wallet has the required properties before attempting to execute
          if (!wallet || !wallet.privateKey || !wallet.address) {
            console.log(`⚠️ Skipping wallet at index ${walletIndex} because it appears to be invalid or missing a private key`);
            // Don't attempt to execute with an invalid wallet - this prevents "Operation failed" messages
            continue;
          }
          
          const result = await this.executeSingleBuy({
            wallet,
            walletIndex,
            tokenInfo,
            currencyInfo,
            amount: pair.amount,
            customGasPrice,
            tracker,
            bidMode
          });
          
          walletResults.push(result);
          
          // Small delay between wallets
          if (walletIndex < selectedWallets.length - 1) {
            const delay = 3000 + Math.random() * 2000; // 3s to 5s
            console.log(`  ⏳ Waiting ${Math.round(delay/1000)}s before next wallet...`);
            await sleep(delay);
          }
        }
        
        const successful = walletResults.filter(r => r.success).length;
        const failed = walletResults.filter(r => !r.success).length;
        
        console.log(`[Token ${tokenIndex + 1}] Results: ✅ ${successful}/${selectedWallets.length} (${((successful/selectedWallets.length)*100).toFixed(1)}%)`);
        
        allResults.push({ tokenIndex: tokenIndex + 1, tokenInfo, successful, failed, results: walletResults });
        
        // Small delay between tokens
        if (tokenIndex < tokenAmountPairs.length - 1) {
          const delay = 1000 + Math.random() * 1000;
          console.log(`⏳ Waiting ${Math.round(delay)}ms before next token...`);
          await sleep(delay);
        }
      } catch (error) {
        console.log(`[Token ${tokenIndex + 1}] ❌ Fatal error: ${error.message}`);
        allResults.push({ tokenIndex: tokenIndex + 1, tokenInput: pair.tokenInput, error: error.message, successful: 0, failed: selectedWallets.length });
      }
    }
    
    return allResults;
  }

  /**
   * Execute TWAP operations
   * @param {Object} twapConfig - TWAP configuration
   * @param {Object} tracker - Transaction tracker
   * @returns {Array} Execution results
   */
  static async executeTWAP(twapConfig, tracker) {
    const { selectedWallets, tokenInput, amount, duration, intervals, currency, customGasPrice, bidMode = false } = twapConfig;
    
    // Debug logging for TWAP config
    console.log(`🔍 ExecutionManager TWAP Debug: intervals=${intervals}, type=${typeof intervals}`);
    console.log(`🔍 ExecutionManager TWAP Config:`, { tokenInput, amount, duration, intervals, currency });
    
    console.log('\n📈 TWAP EXECUTION');
    console.log('==================');
    
    console.log(`🔍 Step 1: About to import TokenResolver...`);
    const { TokenResolver } = await import('./tokenResolver.js');
    console.log(`🔍 Step 2: Creating TokenResolver instance...`);
    const resolver = new TokenResolver(null, bidMode);
    
    console.log(`🔍 Step 3: Getting token info for ${tokenInput}...`);
    const tokenInfo = await resolver.getTokenInfo(tokenInput);
    if (!tokenInfo) {
      throw new Error(`Failed to get token info for ${tokenInput}`);
    }
    console.log(`🔍 Step 4: Token info retrieved successfully`);
    
    console.log(`🔍 Step 5: Getting currency info for ${currency}...`);
    const currencyInfo = await resolver.getCurrencyInfo(currency);
    console.log(`🔍 Step 5.1: Currency info result:`, currencyInfo);
    console.log(`🔍 Step 5.2: Currency isEth=${currencyInfo?.isEth}, isVirtual=${currencyInfo?.isVirtual}`);
    if (currencyInfo?.isEth) {
      console.log(`✅ TWAP ETH DETECTED: Currency info shows isEth=true, should use two-step path`);
    } else {
      console.log(`❌ TWAP ETH NOT DETECTED: Currency info shows isEth=${currencyInfo?.isEth}, will use wrong path`);
    }
    if (!currencyInfo) {
      throw new Error(`Failed to get currency info for ${currency}`);
    }
    console.log(`🔍 Step 6: Currency info retrieved successfully`);
    
    // Step 7: Resolve percentage amounts against wallet balance - SURGICAL FIX for BuyBot TWAP
    let resolvedAmount = amount;
    const originalAmountStr = twapConfig.originalAmountStr || amount.toString();
    
    if (typeof originalAmountStr === 'string' && originalAmountStr.endsWith('%')) {
      console.log(`🔍 Step 7: Resolving percentage amount: ${originalAmountStr}`);
      
      // Get wallet balance for percentage calculation
      const wallet = selectedWallets[0]; // Use first wallet for percentage calculation
      const { executeRpcWithFallback } = await import('../../config/index.js');
      
      let walletBalance;
      if (currencyInfo.isEth) {
        // Get ETH balance
        const balanceWei = await executeRpcWithFallback('getBalance', [wallet.address]);
        walletBalance = parseFloat(ethers.formatEther(balanceWei));
      } else {
        // Get VIRTUAL balance (0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b)
        const virtualAddress = '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b';
        const virtualContract = new ethers.Contract(virtualAddress, ['function balanceOf(address) view returns (uint256)'], wallet);
        const balanceWei = await virtualContract.balanceOf(wallet.address);
        walletBalance = parseFloat(ethers.formatUnits(balanceWei, 18));
      }
      
      const percentage = parseFloat(originalAmountStr.slice(0, -1));
      if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
        throw new Error(`Invalid percentage: ${originalAmountStr}`);
      }
      
      resolvedAmount = walletBalance * (percentage / 100);
      console.log(`📊 Percentage resolution: ${percentage}% of ${walletBalance.toFixed(6)} ${currencyInfo.symbol} = ${resolvedAmount.toFixed(6)} ${currencyInfo.symbol}`);
    }
    
    // Calculate TWAP parameters
    console.log(`🔍 ExecutionManager: About to call calculateTWAPParameters(${resolvedAmount}, ${duration}, ${intervals})`);
    const { numTransactions, baseAmountPerTx, baseDelaySeconds } = AmountCalculator.calculateTWAPParameters(resolvedAmount, duration, intervals);
    console.log(`🔍 ExecutionManager: calculateTWAPParameters returned: numTransactions=${numTransactions}`);
    
    console.log(`\n🎯 TWAP Configuration:`);
    console.log(`💰 Total amount: ${AmountCalculator.formatAmount(resolvedAmount, currencyInfo.symbol)}`);
    console.log(`⏰ Duration: ${duration} minutes`);
    console.log(`📊 Transactions: ${numTransactions}`);
    console.log(`💵 Base amount per TX: ${AmountCalculator.formatAmount(baseAmountPerTx, currencyInfo.symbol)}`);
    console.log(`⏳ Base delay: ${Math.round(baseDelaySeconds)}s`);
    console.log(`🛡️ Slippage: ${DEFAULT_SETTINGS.MAX_SLIPPAGE_PERCENT}%`);
    
    const results = [];
    let remainingAmount = resolvedAmount;
    
    for (let i = 0; i < numTransactions && remainingAmount > 0; i++) {
      // Check for termination signal
      if (global.isTerminating) {
        console.log('\n🛑 Termination signal received. Stopping TWAP execution...');
        break;
      }
      
      console.log(`\n📊 TWAP Transaction ${i + 1}/${numTransactions}`);
      
      // Add randomness to amount
      const currentAmount = AmountCalculator.randomizeAmount(baseAmountPerTx, remainingAmount);
      
      if (currentAmount === 0) {
        console.log('   ⚠️ Amount too small, skipping...');
        break;
      }
      
      // Random wallet selection
      const wallet = selectedWallets[Math.floor(Math.random() * selectedWallets.length)];
      const walletIndex = selectedWallets.indexOf(wallet);
      
      const result = await this.executeSingleBuy({
        wallet,
        walletIndex,
        tokenInfo,
        currencyInfo,
        amount: currentAmount,
        customGasPrice,
        tracker,
        bidMode
      });
      
      results.push(result);
      remainingAmount -= currentAmount;
      
      // Random delay (±30% of base delay)
      if (i < numTransactions - 1 && remainingAmount > 0) {
        const randomDelayMultiplier = 0.7 + Math.random() * 0.6; // 0.7 to 1.3
        const delay = Math.round(baseDelaySeconds * randomDelayMultiplier);
        console.log(`   ⏳ Next transaction in ${delay}s... (Remaining: ${AmountCalculator.formatAmount(remainingAmount, currencyInfo.symbol)})`);
        await sleep(delay * 1000);
      }
    }
    
    // Summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalSpent = results.filter(r => r.success).reduce((sum, r) => sum + (r.inputSpent || 0), 0);
    
    console.log(`\n📊 TWAP SUMMARY:`);
    console.log(`✅ Successful: ${successful}/${results.length}`);
    console.log(`❌ Failed: ${failed}/${results.length}`);
    console.log(`💰 Total spent: ${AmountCalculator.formatAmount(totalSpent, currencyInfo.symbol)}`);
    console.log(`🎯 Target was: ${AmountCalculator.formatAmount(resolvedAmount, currencyInfo.symbol)}`);
    
    return results;
  }
} 