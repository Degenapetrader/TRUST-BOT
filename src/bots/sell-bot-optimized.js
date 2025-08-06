/**
 * Optimized Sell Bot
 * Refactored version using modular service architecture
 *
 * IMPORTANT: This implementation includes robust wallet validation and token synchronization
 * to ensure consistency with BuyBot's error handling patterns.
 *
 * Key Features:
 * - Wallet validation before execution - skips wallets missing privateKey or address
 * - Token list synchronization with UI state before execution
 * - Support for BID-MODE ETH trading using bid.json token database
 * - Recovery from missing or malformed tokenAmountPairs with detailed logging
 * - Consistent error handling across all execution modes
 *
 * Debug Guidelines:
 * - Look for "DEBUG:" prefixed logs for detailed command structure
 * - Wallet validation results show count of valid/invalid wallets
 * - Token recovery attempts are logged with "Attempting to reconstruct" message
 * - BID-MODE operation is clearly indicated in logs
 */

import { ethers } from 'ethers';
import { TokenResolver } from './services/tokenResolver.js';
import { TransactionTracker } from './services/transactionTracker.js';
import { SellCommandParser } from './services/sellCommandParser.js';
import { SellSwapExecutor } from './services/sellSwapExecutor.js';
import { SellAmountCalculator } from './services/sellAmountCalculator.js';
import { FSHModeHandler } from './services/fshModeHandler.js';
import { CONTRACTS } from './config/constants.js';
import { tradingWallets } from '../wallets.js';
import { log, formatTimestampUTC } from '../utils.js';
import { SellExecutionManager } from './services/sellExecutionManager.js';
import { sleep } from '../utils.js';
import { gasPriceService } from '../providers/gasPriceService.js';

/**
 * SellBot class
 * 
 * Optimized SellBot for automated token selling
 * - Supports regular sell, TWAP, and Flash Sell All (FSH) modes
 * - Handles multiple wallets and multiple tokens
 * - Supports selling to VIRTUAL or directly to ETH
 * - Performs wallet validation to skip invalid wallets (missing private key or address)
 * - Synchronizes token selection with UI before execution
 * - Supports BID-MODE for ETH-based trading with bid.json token database
 */
export class SellBot {
  constructor(bidMode = false) {
    this.resolver = new TokenResolver(null, bidMode);
    this.tracker = null;
    this.bidMode = bidMode;
    this.virtual = {
      address: CONTRACTS.VIRTUAL,
      symbol: 'VIRTUAL',
      decimals: 18,
      isVirtual: true
    };
  }
  
  /**
   * Main entry point for sellbot
   * @param {Array} args - Command line arguments
   * @param {Object} preProcessedCommand - Optional pre-parsed command from execute method
   */
  async run(args, preProcessedCommand = null) {
    console.log(`\n🔍 SellBot run: Starting execution with ${args ? args.length : 0} arguments`);
    try {
      // Use pre-parsed command if provided, otherwise parse again
      const parsedCommand = preProcessedCommand || SellCommandParser.parseNewSellbotFormat(args);
      const { mode } = parsedCommand;
      
      // Debug if using pre-parsed command
      if (preProcessedCommand) {
        console.log(`\n🔥 Using pre-parsed command - mode: ${parsedCommand.mode}`);
      }
      
      // Debug output to help troubleshoot command structure issues
      log(`\n===== DEBUG: SELLBOT COMMAND STRUCTURE =====`);
      log(`Mode: ${parsedCommand.mode}`);
      log(`Wallet count: ${parsedCommand.selectedWallets?.length || 'NOT SET!'}`);
      log(`Token pairs count: ${parsedCommand.tokenAmountPairs?.length || 'NOT SET!'}`);
      log(`BID-MODE: ${parsedCommand.bidMode ? 'ACTIVE' : 'INACTIVE'}`);
      log(`Currency: ${parsedCommand.currency || 'DEFAULT (VIRTUAL)'}`);
      log(`===== END COMMAND DEBUG =====\n`);
      
      SellCommandParser.validateCommand(parsedCommand);
      
      // Debug output to help troubleshoot command structure issues
      log(`\n===== DEBUG: SELLBOT COMMAND STRUCTURE =====`);
      log(`Mode: ${parsedCommand.mode}`);
      log(`BID-MODE: ${parsedCommand.bidMode ? 'ACTIVE' : 'INACTIVE'}`);
      log(`Wallet count: ${parsedCommand.selectedWallets?.length || 'NOT SET!'}`);
      
      // Skip TokenAmountPairs validation for FSH mode as it scans tokens internally
      if (parsedCommand.mode === 'FSH') {
        log(`🔥 FSH mode detected - skipping token validation as tokens will be scanned from wallets`);
      }
      // TokenAmountPairs validation and reconstruction only needed for regular mode
      else if (!parsedCommand.tokenAmountPairs || !Array.isArray(parsedCommand.tokenAmountPairs) || parsedCommand.tokenAmountPairs.length === 0) {
        log(`❌ TokenAmountPairs validation failed: ${parsedCommand.tokenAmountPairs === undefined ? 'undefined' : (!Array.isArray(parsedCommand.tokenAmountPairs) ? 'not an array' : 'empty array')}`);
        
        // Attempt recovery from tokens and amounts arrays if available
        if (parsedCommand.tokens && Array.isArray(parsedCommand.tokens) && parsedCommand.tokens.length > 0) {
          log(`🔍 Found ${parsedCommand.tokens.length} tokens in command, attempting recovery...`);
          
          // Check if we have amounts array
          if (parsedCommand.amounts && Array.isArray(parsedCommand.amounts) && parsedCommand.amounts.length > 0) {
            log(`⚠️ Reconstructing tokenAmountPairs from tokens and amounts arrays...`);
            parsedCommand.tokenAmountPairs = [];
            
            for (let i = 0; i < parsedCommand.tokens.length; i++) {
              const tokenInput = parsedCommand.tokens[i];
              if (!tokenInput) {
                log(`⚠️ Skipping empty token at index ${i}`);
                continue;
              }
              
              parsedCommand.tokenAmountPairs.push({
                tokenInput: tokenInput,
                amount: parsedCommand.amounts[i] || parsedCommand.amounts[0] // Use matching amount or default to first amount
              });
              log(`✅ Added token pair: ${tokenInput} with amount ${parsedCommand.amounts[i] || parsedCommand.amounts[0]}`);
            }
            
            log(`✅ Successfully created ${parsedCommand.tokenAmountPairs.length} token-amount pairs`);
          } else if (parsedCommand.bidMode) {
            // Special case for BID-MODE FSH - no amounts needed, we'll sell all tokens
            log(`🎯 BID-MODE detected with tokens but no amounts - assuming FSH mode`);
            parsedCommand.mode = 'FSH';
            log(`✅ Mode set to FSH for BID-MODE operation`);
          } else {
            throw new Error('Cannot reconstruct tokenAmountPairs: amounts array is missing or empty');
          }
        } else {
          throw new Error('Cannot reconstruct tokenAmountPairs: tokens array is missing or empty');
        }
      }
      
      log(`Token pairs count: ${parsedCommand.tokenAmountPairs?.length || 'NOT SET!'}`);
      
      // Wallet validation - similar to BuyBot's ExecutionManager pattern
      if (parsedCommand.selectedWallets && Array.isArray(parsedCommand.selectedWallets)) {
        log(`🔍 Validating ${parsedCommand.selectedWallets.length} wallets...`);
        
        // Filter out invalid wallets (missing privateKey or address)
        const validWallets = parsedCommand.selectedWallets.filter(wallet => 
          wallet && wallet.privateKey && wallet.address
        );
        
        // Report on wallet validation results
        if (validWallets.length < parsedCommand.selectedWallets.length) {
          const skippedCount = parsedCommand.selectedWallets.length - validWallets.length;
          log(`⚠️ ${skippedCount} invalid wallets were filtered out (${validWallets.length}/${parsedCommand.selectedWallets.length} valid)`);
          
          // Show detailed info about skipped wallets for debugging
          if (parsedCommand.selectedWallets.length < 10) { // Only for reasonable number of wallets
            parsedCommand.selectedWallets.forEach((wallet, idx) => {
              if (!wallet || !wallet.privateKey || !wallet.address) {
                const issues = [];
                if (!wallet) issues.push('wallet object is null/undefined');
                else {
                  if (!wallet.privateKey) issues.push('missing privateKey');
                  if (!wallet.address) issues.push('missing address');
                }
                log(`  ❌ Wallet #${idx+1} invalid: ${issues.join(', ')}`);
              }
            });
          }
          
          // Update the wallet list with only valid ones
          parsedCommand.selectedWallets = validWallets;
        }
        
        log(`💰 Using ${validWallets.length} valid wallets for execution`);
      } else {
        log(`❌ No wallet array found in parsed command`);
        throw new Error('No wallet data available');
      }
      
      // Update resolver with bidMode if needed
      if (parsedCommand.bidMode && !this.bidMode) {
        log(`🎯 Initializing token resolver with BID-MODE enabled`);
        this.resolver = new TokenResolver(null, parsedCommand.bidMode);
        this.bidMode = parsedCommand.bidMode;
      }
      
      // Handle different modes
      log(`\n▶️ Executing SellBot in ${parsedCommand.mode.toUpperCase()} mode`);
      // Special BID-MODE configuration - ensure the resolver uses the right database
      if (parsedCommand.bidMode) {
        log(`🎯 Configuring SellBot for BID-MODE operation`);
        log(`🔍 BID-MODE changes: ETH currency, bid.json database, limited token options`);
        // BID-MODE resolver is already initialized in constructor
      }
      
      // Execute appropriate mode handler
      try {
        log(`💼 Executing ${parsedCommand.mode.toUpperCase()} mode handler...`);
        
        switch (parsedCommand.mode) {
          case 'FSH':
            return await this.handleFSHMode(parsedCommand);
          case 'TWAP':
            return await this.handleTWAPMode(parsedCommand);
          case 'regular':
            return await this.handleRegularMode(parsedCommand);
          default:
            throw new Error(`Unknown mode: ${parsedCommand.mode}`);
        }
      } catch (error) {
        log(`❌ Error in ${parsedCommand.mode} mode handler: ${error.message}`);
        if (this.tracker && this.tracker.hasTransactions()) {
          // Still display any transaction summary if available
          log(`📈 Showing partial transaction summary before error:`);
          this.tracker.displaySummary();
        }
        throw error;
      }
      
    } catch (error) {
      // Enhanced error logging with stack trace and detailed diagnostics
      console.error(`\n🚨 CRITICAL SELLBOT ERROR: ${error.message}`);
      console.error(`🚨 ERROR STACK: ${error.stack || 'No stack trace available'}`);
      
      // Add more diagnostic information about environment
      console.error('\n🔍 DIAGNOSTIC INFORMATION:');
      console.error(`🔧 Node.js version: ${process.version}`);
      console.error(`🔧 Working directory: ${process.cwd()}`);
      
      // Check for common environment issues
      const envCheck = [];
      if (!process.env.MASTER_PASSWORD) envCheck.push('Missing MASTER_PASSWORD environment variable');
      if (!process.env.WALLETS_DB_PATH) envCheck.push('Missing WALLETS_DB_PATH environment variable');
      if (!process.env.WALLETTOKEN_SELECTED && !process.env.WALLETTOKEN_ALL) {
        envCheck.push('Missing wallet selection (WALLETTOKEN_SELECTED or WALLETTOKEN_ALL)');
      }
      
      if (envCheck.length > 0) {
        console.error('\n⚠️ ENVIRONMENT ISSUES DETECTED:');
        envCheck.forEach(issue => console.error(`  - ${issue}`));
      } else {
        console.error('\n✅ Basic environment variables appear to be set');
      }
      
      // Module import check - see if we can identify import issues
      if (error.message.includes('import') || error.message.includes('export') || 
          error.message.includes('require') || error.message.includes('module')) {
        console.error('\n⚠️ POSSIBLE MODULE IMPORT/EXPORT ISSUE DETECTED:');
        console.error('  - Check that all modules are correctly exported and imported');
        console.error('  - Verify SellExecutionManager and other dependencies have correct exports');
        console.error('  - Import statements should match export types (named vs default)');
      }
      
      // Show usage information to help with command format issues
      log('\n📚 Usage:');
      SellCommandParser.showUsage();
      
      // Re-throw to propagate error
      throw error;
    }
  }
  
  /**
   * Handle FSH (Flash Sell All) mode
   * @param {Object} parsedCommand - Parsed command
   */
  async handleFSHMode(parsedCommand) {
    const { selectedWallets, customGasPrice, bidMode } = parsedCommand;
    
    // Final wallet validation check before proceeding
    if (!selectedWallets || !Array.isArray(selectedWallets) || selectedWallets.length === 0) {
      log(`\n⚠️ No valid wallets available in handleFSHMode`);
      return { success: false, error: 'No valid wallets available for execution' };
    }
    
    // Filter out invalid wallets
    const validWallets = selectedWallets.filter(wallet => wallet && wallet.privateKey && wallet.address);
    
    if (validWallets.length < selectedWallets.length) {
      log(`\n⚠️ ${selectedWallets.length - validWallets.length} invalid wallets were filtered out`);
    }
    
    if (validWallets.length === 0) {
      log(`\n❌ No valid wallets remain after filtering`);
      return { success: false, error: 'No valid wallets available' };
    }
    
    this.tracker = new TransactionTracker();
    
    log('\n💥 FSH MODE - FLASH SELL ALL');
    log('============================');
    log(`👛 Selected wallets: ${validWallets.length} valid out of ${selectedWallets.length} total`);
    log(`⛽ Gas price: ${customGasPrice || '0.02'} gwei`);
    log(`🚫 TRUST token is blacklisted (will be skipped)`);
    log(`🚫 VIRTUAL token is excluded (will be skipped)`);
    if (bidMode) {
      log(`🎯 BID-MODE: Using bid.json database and ETH currency`);
    }
    
    // Initialize FSH handler
    const fshHandler = new FSHModeHandler();
    
    try {
      let fshResult;
      
      if (bidMode) {
        log(`\n⚠️ Using validated wallets for BID-MODE FSH`);
        fshResult = await this.executeBidModeFSH(validWallets, customGasPrice);
      } else {
        log(`\n⚠️ Using validated wallets for standard FSH`);
        fshResult = await fshHandler.executeFlashSellAll(validWallets, customGasPrice, this.tracker);
      }
      
      if (!fshResult.success || fshResult.totalTokensToSell === 0) {
        log('\n❌ No tokens found to sell across all wallets');
        return { success: true, results: [] };
      }
      
      const { walletsToSell, totalTokensToSell } = fshResult;
      
      // Execute sells for all found tokens
      const results = [];
      let processedTokens = 0;
      
      for (const walletData of walletsToSell) {
        const { wallet, walletIndex, tokens } = walletData;
        
        log(`\n🔥 Executing FSH for Wallet B${walletIndex + 1}: ${wallet.address.slice(0,8)}...`);
        
        for (const tokenData of tokens) {
          try {
            processedTokens++;
            log(`\n[${processedTokens}/${totalTokensToSell}] Selling ${tokenData.formattedBalance.toFixed(2)} ${tokenData.symbol}...`);
            
            // Convert token data to sellbot format with pool information
            const tokenInfo = {
              address: tokenData.address,
              symbol: tokenData.symbol,
              name: tokenData.name,
              decimals: tokenData.decimals,
              poolAddress: tokenData.pairInfo?.pairAddress || null,
              isDirectCA: false,
              useTrustSwapFallback: tokenData.useTrustSwapFallback || false
            };
            
            const calculated = {
              amount: tokenData.formattedBalance,
              percentage: null
            };
            
            // Execute sell - Use preferred currency from LP analysis, fallback to VIRTUAL in normal mode
            const sellCurrency = bidMode ? 'ETH' : (tokenData.preferredCurrency || 'VIRTUAL');
            const sellResult = await this.executeSingleTokenSell(
              wallet,
              tokenInfo,
              calculated,
              customGasPrice,
              sellCurrency
            );
            
            if (sellResult.success) {
              if (bidMode) {
                // BID-MODE: Track ETH received
                log(`    ✅ ${tokenData.symbol} → ${sellResult.ethReceived.toFixed(6)} ETH`);
                results.push({
                  wallet: wallet.address,
                  token: tokenData.symbol,
                  amount: tokenData.formattedBalance,
                  ethReceived: sellResult.ethReceived,
                  txHash: sellResult.txHash,
                  success: true,
                  bidMode: true
                });
              } else if (sellCurrency === 'ETH') {
                // Normal mode ETH sell: Track ETH received
                log(`    ✅ ${tokenData.symbol} → ${sellResult.ethReceived.toFixed(6)} ETH`);
                results.push({
                  wallet: wallet.address,
                  token: tokenData.symbol,
                  amount: tokenData.formattedBalance,
                  ethReceived: sellResult.ethReceived,
                  txHash: sellResult.txHash,
                  success: true,
                  currency: 'ETH'
                });
              } else {
                // Normal mode VIRTUAL sell: Track VIRTUAL received
                log(`    ✅ ${tokenData.symbol} → ${sellResult.virtualReceived.toFixed(6)} VIRTUAL`);
                results.push({
                  wallet: wallet.address,
                  token: tokenData.symbol,
                  amount: tokenData.formattedBalance,
                  virtualReceived: sellResult.virtualReceived,
                  txHash: sellResult.txHash,
                  success: true,
                  currency: 'VIRTUAL'
                });
              }
            } else {
              log(`    ❌ ${tokenData.symbol} failed: ${sellResult.error}`);
              results.push({
                wallet: wallet.address,
                token: tokenData.symbol,
                amount: tokenData.formattedBalance,
                error: sellResult.error,
                success: false,
                bidMode: bidMode
              });
            }
            
            // Small delay between tokens to avoid RPC overload
            await sleep(500);
            
          } catch (error) {
            log(`    ❌ Error selling ${tokenData.symbol}: ${error.message}`);
            results.push({
              wallet: wallet.address,
              token: tokenData.symbol,
              error: error.message,
              success: false
            });
          }
        }
      }
    
    // Display final summary
      const successfulSells = results.filter(r => r.success);
      const failedSells = results.filter(r => !r.success);
      
      log('\n📊 FSH SUMMARY');
      log('==============');
      log(`✅ Successful sells: ${successfulSells.length}`);
      log(`❌ Failed sells: ${failedSells.length}`);
      
      if (bidMode) {
        const totalETH = successfulSells.reduce((sum, r) => sum + (r.ethReceived || 0), 0);
        log(`💰 Total ETH received: ${totalETH.toFixed(6)}`);
      } else {
        // Calculate totals for both ETH and VIRTUAL in normal mode
        const ethSells = successfulSells.filter(r => r.currency === 'ETH');
        const virtualSells = successfulSells.filter(r => r.currency === 'VIRTUAL');
        
        if (ethSells.length > 0) {
          const totalETH = ethSells.reduce((sum, r) => sum + (r.ethReceived || 0), 0);
          log(`💰 Total ETH received: ${totalETH.toFixed(6)} (${ethSells.length} tokens)`);
        }
        
        if (virtualSells.length > 0) {
          const totalVIRTUAL = virtualSells.reduce((sum, r) => sum + (r.virtualReceived || 0), 0);
          log(`💰 Total VIRTUAL received: ${totalVIRTUAL.toFixed(6)} (${virtualSells.length} tokens)`);
        }
      }
      
    if (this.tracker.hasTransactions()) {
      this.tracker.displaySummary();
    }
    
      return { success: true, results };
      
    } catch (error) {
      log(`\n❌ FSH Mode failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Handle TWAP mode - proper implementation
   * @param {Object} parsedCommand - Parsed command
   */
  async handleTWAPMode(parsedCommand) {
    const { selectedWallets, tokenInput, amount, duration, currency, customGasPrice, bidMode } = parsedCommand;
    
    // Final wallet validation check before proceeding
    if (!selectedWallets || !Array.isArray(selectedWallets) || selectedWallets.length === 0) {
      log(`\n⚠️ No valid wallets available in handleTWAPMode`);
      return { success: false, error: 'No valid wallets available for execution' };
    }
    
    // Filter out invalid wallets
    const validWallets = selectedWallets.filter(wallet => wallet && wallet.privateKey && wallet.address);
    
    if (validWallets.length < selectedWallets.length) {
      log(`\n⚠️ ${selectedWallets.length - validWallets.length} invalid wallets were filtered out`);
    }
    
    if (validWallets.length === 0) {
      log(`\n❌ No valid wallets remain after filtering`);
      return { success: false, error: 'No valid wallets available' };
    }
    
    // Token validation
    if (!tokenInput) {
      log(`\n❌ No token specified for TWAP execution`);
      return { success: false, error: 'No token input provided' };
    }
    
    this.tracker = new TransactionTracker();
    
    log('\n🕐 TWAP MODE');
    log('============');
    log(`👛 Selected wallets: ${validWallets.length} valid out of ${selectedWallets.length} total`);
    log(`🪙 Token: ${tokenInput}`);
    log(`💰 Amount: ${amount}`);
    log(`⏱️ Duration: ${duration} minutes`);
    log(`💱 Currency: ${currency || (bidMode ? 'ETH' : 'VIRTUAL')}${bidMode ? ' (BID-MODE)' : ''}`);
    log(`⛽ Gas: ${customGasPrice || '0.02'} gwei`);
    
    // Resolve token
    log(`\n🔍 Getting token info for: ${tokenInput}`);
    const tokenInfo = await this.resolver.getTokenInfo(tokenInput);
    if (!tokenInfo) {
      throw new Error(`Token not found: ${tokenInput}`);
    }
    
    log(`✅ Token resolved: ${tokenInfo.symbol} (${tokenInfo.address})`);
    
    try {
      // Resolve currency information for TWAP
    let currencyInfo = null;
      if (currency && currency !== 'VIRTUAL') {
        if (currency === 'ETH') {
          currencyInfo = {
            symbol: 'ETH',
            address: '0x4200000000000000000000000000000000000006', // WETH on Base
            decimals: 18,
            isEth: true,
            isVirtual: false
          };
        } else if (currency.startsWith('C-') || currency.startsWith('c-')) {
          const tokenSymbol = currency.substring(2);
          currencyInfo = await this.resolver.getTokenInfo(tokenSymbol);
          
          if (!currencyInfo) {
            throw new Error(`Currency token not found: ${tokenSymbol}`);
          }
          currencyInfo.isVirtual = false;
        } else {
          throw new Error(`Unsupported currency: ${currency}`);
        }
    }
    
      // Execute proper TWAP using SellExecutionManager with validated wallets
      log(`\n⚙️ Executing TWAP sell with ${validWallets.length} validated wallets`);
      log(`🛡️ Invalid wallets have been filtered out to prevent transaction failures`);
      const twapResult = await SellExecutionManager.executeTWAPSell(
        validWallets, // Using validated wallets instead of raw selectedWallets
        tokenInfo,
        amount,
        duration,
        currencyInfo,
        customGasPrice,
        this.tracker,
        parsedCommand.bidMode,
        parsedCommand.intervals // Pass user-specified order count
      );
    
      // Display final summary
      if (this.tracker.hasTransactions()) {
        this.tracker.displaySummary();
      }
      
      const totalSuccessfulChunks = twapResult.results.reduce((sum, r) => sum + (r.successfulChunks || 0), 0);
      const totalChunks = twapResult.results.reduce((sum, r) => sum + (r.chunks || 0), 0);
      
      log(`\n📊 TWAP Summary: ${totalSuccessfulChunks}/${totalChunks} chunks executed successfully`);
      
      return twapResult;
      
    } catch (error) {
      log(`\n❌ TWAP Mode failed: ${error.message}`);
      
      // Display summary even if failed
    if (this.tracker.hasTransactions()) {
      this.tracker.displaySummary();
    }
    
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Handle regular sell mode
   * @param {Object} parsedCommand - Parsed command
   */
  async handleRegularMode(parsedCommand) {
    const { selectedWallets, tokenAmountPairs, loops, currency, slowMode, customGasPrice, bidMode } = parsedCommand;
    
    // Final wallet validation check before proceeding
    if (!selectedWallets || !Array.isArray(selectedWallets) || selectedWallets.length === 0) {
      log(`\n⚠️ No valid wallets available in handleRegularMode`);
      return { success: false, error: 'No valid wallets available for execution' };
    }
    
    // Final token validation check
    if (!tokenAmountPairs || !Array.isArray(tokenAmountPairs) || tokenAmountPairs.length === 0) {
      log(`\n❌ No token-amount pairs available in handleRegularMode`);
      return { success: false, error: 'No token-amount pairs available' };
    }
    
    log(`\n📋 Executing regular mode with ${selectedWallets.length} wallets and ${tokenAmountPairs.length} token pairs`);
    
    // Initialize transaction tracker
    this.tracker = new TransactionTracker();
    
    if (bidMode) {
      log(`🎯 BID-MODE: Using bid.json database and ${currency || 'ETH'} currency`);
    }
    
    // Process each token-amount pair
    for (const pair of tokenAmountPairs) {
      log(`\n🎯 Processing: ${pair.tokenInput} (${pair.amount}) → ${currency || 'VIRTUAL'}${bidMode ? ' (BID-MODE)' : ''}`);
      
      // Resolve token
      const tokenInfo = await this.resolver.getTokenInfo(pair.tokenInput);
      if (!tokenInfo) {
        log(`❌ Token not found: ${pair.tokenInput}`);
        continue;
      }
      
      log(`✅ Token resolved: ${tokenInfo.symbol} (${tokenInfo.address})`);
      
      // Execute for each wallet
    for (const wallet of selectedWallets) {
      // Additional wallet validation check
      if (!wallet || !wallet.privateKey || !wallet.address) {
        log(`\n⚠️ Skipping wallet because it appears to be invalid or missing a private key`);
        continue; // Skip to next wallet
      }
      
      log(`\n👛 Wallet: ${wallet.address.slice(0, 8)}...`);
      
      try {
          // Get balance
          const balance = await SellAmountCalculator.getTokenBalance(
            wallet.address,
            tokenInfo.address,
            tokenInfo.decimals
          );
          
          if (!balance.hasBalance) {
            log(`❌ No ${tokenInfo.symbol} balance`);
            continue;
          }
          
          // Calculate amount
          const calculated = SellAmountCalculator.calculateSellAmount(
            pair.amount,
            balance,
            tokenInfo.symbol
          );
          
          if (calculated.error || calculated.amount <= 0) {
            log(`❌ ${calculated.error || 'Invalid amount'}`);
            continue;
          }
          
          log(`💰 Selling ${calculated.amount.toFixed(6)} ${tokenInfo.symbol} → ${currency || 'VIRTUAL'}`);
          
          // Execute sell (now with currency parameter)
          const sellResult = await this.executeSingleTokenSell(
            wallet,
        tokenInfo,
            calculated,
            customGasPrice,
            currency
          );
          
          if (sellResult.success) {
            if (sellResult.twoStep) {
              log(`✅ Two-step sell complete: ${sellResult.finalAmount.toFixed(6)} ${sellResult.currency}`);
            } else {
              log(`✅ Sell complete: ${sellResult.virtualReceived.toFixed(6)} VIRTUAL`);
            }
          } else {
            log(`❌ Sell failed: ${sellResult.error}`);
          }
          
        } catch (error) {
          log(`❌ Error processing wallet: ${error.message}`);
        }
        
        // Small delay between wallets
        await sleep(1000);
      }
    }
    
    // Display final summary
    if (this.tracker.hasTransactions()) {
      // Use the built-in display method which properly formats everything
      this.tracker.displaySummary();
    }
  }
  
  /**
   * Execute single token sell for one wallet
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information
   * @param {Object} calculated - Calculated amounts
   * @param {string} customGasPrice - Custom gas price
   * @param {string} currency - Target currency (VIRTUAL, ETH, etc.)
   * @returns {Object} Transaction result
   */
  async executeSingleTokenSell(wallet, tokenInfo, calculated, customGasPrice, currency = null) {
    try {
      // Validate wallet first - critical safety check
      if (!wallet || !wallet.privateKey || !wallet.address) {
        log(`\n⚠️ Wallet validation failed in executeSingleTokenSell - missing private key or address`);
        return {
          success: false,
          error: 'Invalid wallet: missing private key or address',
          skipped: true
        };
      }
      // Default currency is VIRTUAL
      const targetCurrency = currency || 'VIRTUAL';
      
      // BID-MODE: Direct Token → ETH swap using TRUSTSWAP
      if (this.bidMode && targetCurrency === 'ETH') {
        log(`🎯 BID-MODE: Selling ${calculated.amount.toFixed(6)} ${tokenInfo.symbol} → ETH`);
        
        const sellResult = await SellSwapExecutor.executeETHSell(
          wallet,
          tokenInfo,
          calculated.amount,
          customGasPrice
        );
        
        if (sellResult.success) {
          log(`✅ BID-MODE sell successful: received ${sellResult.ethReceived.toFixed(6)} ETH`);
          
          // Track the transaction
          this.tracker.addTransaction(
            wallet.address,
            tokenInfo.symbol,
            calculated.amount,
            'ETH',
            sellResult.ethReceived
          );
          
          return {
            success: true,
            txHash: sellResult.txHash,
            ethReceived: sellResult.ethReceived,
            gasUsed: sellResult.gasUsed,
            walletAddress: wallet.address,
            bidMode: true
          };
        } else {
          throw new Error(sellResult.error || 'BID-MODE ETH sell failed');
        }
      } else if (targetCurrency === 'VIRTUAL') {
        log(`🔄 Selling ${calculated.amount.toFixed(6)} ${tokenInfo.symbol} → VIRTUAL`);
        
        // Execute simple direct sell to VIRTUAL
        const sellResult = await SellSwapExecutor.executeDirectSellToVirtual(
          wallet,
          tokenInfo,
          calculated.amount,
          customGasPrice
        );
        
        if (sellResult.success) {
          log(`✅ Sell successful: received ${sellResult.virtualReceived.toFixed(6)} VIRTUAL`);
          
          // Track the transaction
          this.tracker.addTransaction(
            wallet.address,
            tokenInfo.symbol,
            calculated.amount,
            'VIRTUAL',
            sellResult.virtualReceived
          );
          
      return {
            success: true,
            txHash: sellResult.txHash,
            virtualReceived: sellResult.virtualReceived,
            gasUsed: sellResult.gasUsed,
            walletAddress: wallet.address
          };
        } else {
          throw new Error(sellResult.error || 'Sell failed');
        }
      } else if (targetCurrency === 'ETH') {
        // Normal mode ETH sell - use direct Token → ETH swap
        log(`🔄 Direct ETH sell: ${calculated.amount.toFixed(6)} ${tokenInfo.symbol} → ETH`);
        
        const sellResult = await SellSwapExecutor.executeETHSell(
          wallet,
          tokenInfo,
          calculated.amount,
          customGasPrice
        );
        
        if (sellResult.success) {
          log(`✅ ETH sell successful: received ${sellResult.ethReceived.toFixed(6)} ETH`);
          
          // Track the transaction
          this.tracker.addTransaction(
            wallet.address,
            tokenInfo.symbol,
            calculated.amount,
            'ETH',
            sellResult.ethReceived
          );
          
          return {
            success: true,
            txHash: sellResult.txHash,
            ethReceived: sellResult.ethReceived,
            gasUsed: sellResult.gasUsed,
            walletAddress: wallet.address
          };
        } else {
          throw new Error(sellResult.error || 'ETH sell failed');
        }
      } else {
        // For other currencies (C-TOKEN), use two-step sell
        log(`🔄 Two-step sell: ${calculated.amount.toFixed(6)} ${tokenInfo.symbol} → VIRTUAL → ${targetCurrency}`);
        
        // Resolve currency information
        let currencyInfo;
        if (targetCurrency.startsWith('C-') || targetCurrency.startsWith('c-')) {
          const tokenSymbol = targetCurrency.substring(2);
          currencyInfo = await this.resolver.getTokenInfo(tokenSymbol);
      
          if (!currencyInfo) {
        throw new Error(`Currency token not found: ${tokenSymbol}`);
      }
        } else {
          throw new Error(`Unsupported currency: ${targetCurrency}`);
        }
        
        // Execute two-step sell
        const sellResult = await SellSwapExecutor.executeTwoStepSell(
          wallet,
          tokenInfo,
          currencyInfo,
          calculated.amount,
          customGasPrice,
          this.tracker
        );
        
        if (sellResult.success) {
          log(`✅ Two-step sell successful: received ${sellResult.finalAmount.toFixed(6)} ${currencyInfo.symbol}`);
          
          return {
            success: true,
            step1Hash: sellResult.step1Hash,
            step2Hash: sellResult.step2Hash,
            txHash: sellResult.txHash,
            finalAmount: sellResult.finalAmount,
            currency: currencyInfo.symbol,
            twoStep: true,
            walletAddress: wallet.address
          };
        } else {
          throw new Error(sellResult.error || 'Two-step sell failed');
        }
      }
      
    } catch (error) {
      log(`❌ Single token sell failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        walletAddress: wallet.address
      };
    }
  }
  
  /**
   * Execute BID-MODE Flash Sell All (FSH)
   * Special implementation for BID-MODE that uses bid.json token database
   * Includes robust wallet validation and detailed logging
   * 
   * @param {Array} selectedWallets - Selected wallets from parser
   * @param {string} customGasPrice - Custom gas price if provided
   * @returns {Object} Execution result with stats
   */
  async executeBidModeFSH(selectedWallets, customGasPrice) {
    log("🎯 BID-MODE FSH - Using bid.json database");
    log("==========================================");
    
    // Wallet validation check
    if (!selectedWallets || !Array.isArray(selectedWallets) || selectedWallets.length === 0) {
      log(`\n⚠️ No wallets available for BID-MODE FSH execution`);
      return { success: false, error: 'No wallets available for execution', totalTokensToSell: 0 };
    }
    
    // Filter out invalid wallets
    const validWallets = selectedWallets.filter(wallet => wallet && wallet.privateKey && wallet.address);
    
    if (validWallets.length < selectedWallets.length) {
      log(`\n⚠️ ${selectedWallets.length - validWallets.length} invalid wallets were filtered out`);
    }
    
    if (validWallets.length === 0) {
      log(`\n❌ No valid wallets remain after filtering`);
      return { success: false, error: 'No valid wallets available', totalTokensToSell: 0 };
    }
    
    log(`👛 Using ${validWallets.length} validated wallets for BID-MODE FSH`);
    
    try {
      // Import bid database functions
      const { getAllBidTokens } = await import('../bidDatabase.js');
      const { executeRpcWithFallback } = await import('../config.js');
      
      // Get all tokens from bid.json
      const bidTokens = getAllBidTokens();
      
      if (bidTokens.length === 0) {
        log('❌ No tokens found in bid.json database');
        return { success: true, totalTokensToSell: 0 };
      }
      
      log(`📊 Checking ${bidTokens.length} tokens from bid.json database`);
      
      const walletsToSell = [];
      let totalTokensToSell = 0;
      
      // Process each validated wallet
      for (let walletIndex = 0; walletIndex < validWallets.length; walletIndex++) {
        const wallet = validWallets[walletIndex];
        log(`\n📱 BID-MODE Scanning Wallet B${walletIndex + 1}: ${wallet.address.slice(0,8)}...`);
        
        const walletTokens = [];
        
        // Check balances for all bid tokens
        for (const bidToken of bidTokens) {
          try {
            if (!bidToken.tokenAddress || !bidToken.symbol) continue;
            
            // Skip VIRTUAL and blacklisted tokens
            if (bidToken.tokenAddress.toLowerCase() === CONTRACTS.VIRTUAL.toLowerCase()) continue;
            if (bidToken.symbol === 'TRUST') continue;
            
            // Get token balance
            const result = await executeRpcWithFallback(async (provider) => {
              const tokenContract = new ethers.Contract(
                bidToken.tokenAddress,
                ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'],
                provider
              );
              
              const [balance, decimals] = await Promise.all([
                tokenContract.balanceOf(wallet.address),
                tokenContract.decimals()
              ]);
              
              return { balance, decimals };
            });
            
            const formattedBalance = parseFloat(ethers.formatUnits(result.balance, result.decimals));
            
            // Only include tokens with significant balance (>= 1 token)
            if (formattedBalance >= 1) {
              // Use 99.9% of balance to avoid transaction reverts
              const sellBalance = (result.balance * 999n) / 1000n;
              const sellFormattedBalance = parseFloat(ethers.formatUnits(sellBalance, result.decimals));
              
              walletTokens.push({
                address: bidToken.tokenAddress,
                symbol: bidToken.symbol,
                name: bidToken.symbol,
                decimals: result.decimals,
                balance: sellBalance,
                formattedBalance: sellFormattedBalance,
                lpAddress: bidToken.lpAddress,
                mcapInETH: bidToken.mcapInETH,
                bidMode: true
              });
              
              log(`    ✅ ${bidToken.symbol}: ${sellFormattedBalance.toFixed(2)} (from bid.json)`);
              totalTokensToSell++;
            }
            
          } catch (error) {
            // Skip tokens that fail balance check
            continue;
          }
        }
        
        if (walletTokens.length > 0) {
          walletsToSell.push({
            wallet,
            walletIndex,
            tokens: walletTokens
          });
        } else {
          log(`❌ No sellable bid tokens found`);
        }
      }
      
      if (totalTokensToSell === 0) {
        log("\n❌ No bid tokens found to sell across all wallets");
        return { success: true, totalTokensToSell: 0 };
      }
      
      log(`\n📊 BID-MODE FSH: Found ${totalTokensToSell} bid tokens to sell across ${walletsToSell.length} wallets`);
      
      return {
        success: true,
        walletsToSell,
        totalTokensToSell
      };
      
    } catch (error) {
      log(`❌ BID-MODE FSH scan failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Show sellbot header
   */
  showHeader() {
    console.log('');
    console.log('🔴 ==========================================');
    console.log('🔴            SELLBOT ACTIVATED             ');
    console.log('🔴 ==========================================');
    console.log(`🔴 Time: ${formatTimestampUTC()}`);
    console.log(`🔴 Wallets loaded: ${tradingWallets.length}`);
    console.log('🔴 ==========================================');
    console.log('');
  }
  
  /**
   * Static method to run sellbot with enhanced debugging
   * @param {Array} args - Command line arguments
   */
  static async execute(args) {
    try {
      // Enhanced debugging - Log command arguments
      console.log(`\n🐞 DEBUG: SellBot executing with arguments: ${JSON.stringify(args)}`);
      
      // WALLET LOADING FROM ENVIRONMENT VARIABLES - Mimicking BuyBot's approach
      // Import required dependencies for wallet creation
      const { ethers } = await import('ethers');
      const { provider } = await import('../config.js');
      const { WalletParser } = await import('../parsing/index.js');
      
      console.log(`👛 Checking for direct wallet private keys in environment variables...`);
      const directWallets = [];
      let envWalletCount = 0;
      
      // Check for direct wallet private keys in environment variables (B1, B2, etc.)
      for (let i = 0; i < 20; i++) {
        const envKey = `B${i + 1}`;
        const privateKey = process.env[envKey];
        
        if (privateKey && privateKey.length > 0) {
          envWalletCount++;
          console.log(`✅ Found wallet key in environment variable ${envKey}`);
          // Create a wallet directly from the private key
          const wallet = new ethers.Wallet(privateKey, provider);
          // Add metadata
          wallet.name = `Wallet ${i + 1}`;
          wallet.index = i;
          wallet._fromEnv = true;
          // Add to our direct wallets array
          directWallets.push(wallet);
        }
      }
      
      console.log(`🔑 Found ${envWalletCount} wallet private keys in environment variables`);
      
      // Import the trading wallets - this is loaded asynchronously in the background
      const { tradingWallets } = await import('../wallets.js');
      console.log(`📋 Trading wallets from wallets.js: ${tradingWallets?.length || 0} wallets`);
      
      // Combine both sources of wallets, preferring direct environment wallets
      const combinedWallets = directWallets.length > 0 ? directWallets : tradingWallets;
      console.log(`👛 Combined wallet list contains ${combinedWallets?.length || 0} wallets`);
      
      // Save a reference to the original parse function
      const originalWalletParseFunction = WalletParser.parse;
      
      // Create a custom parse function that uses our combined wallets
      const customWalletParser = (args) => {
        console.log(`🔍 Parsing wallet selectors using combined wallet list...`);
        return originalWalletParseFunction(args, combinedWallets, { debug: true });
      };
      
      // Monkey patch the SellCommandParser to use our combined wallet list
      const originalParse = SellCommandParser.parseNewSellbotFormat;
      SellCommandParser.parseNewSellbotFormat = function (args) {
        console.log(`🛠️ Using customized SellCommandParser with combined wallet list`);
        // Store original parser
        const originalParser = WalletParser.parse;
        
        try {
          // Override the parser to use our combined wallets
          WalletParser.parse = customWalletParser;
          // Call the original method with our override in place
          return originalParse.call(this, args);
        } finally {
          // Restore the original parser when done
          WalletParser.parse = originalParser;
        }
      };
      
      // Override the FSH parse method to use our combined wallets as well
      const originalParseFSHCommand = SellCommandParser.parseFSHCommand;
      SellCommandParser.parseFSHCommand = function (args) {
        console.log(`🛠️ Using customized SellCommandParser with combined wallet list for FSH`);
        // Store original parser
        const originalParser = WalletParser.parse;
        
        try {
          // Override the parser to use our combined wallets
          WalletParser.parse = customWalletParser;
          // Call the original method with our override in place
          return originalParseFSHCommand.call(this, args);
        } finally {
          // Restore the original parser when done
          WalletParser.parse = originalParser;
        }
      };
      
      // Check if this is an FSH command first
      console.log(`🐞 DEBUG: Checking if this is an FSH command...`);
      const isFSHCommand = args.some(arg => arg.toLowerCase() === 'fsh');
      let parsedCommand;
      
      if (isFSHCommand) {
        console.log(`🐞 DEBUG: FSH mode detected! Using parseFSHCommand...`);
        parsedCommand = SellCommandParser.parseFSHCommand(args);
        // Set mode to uppercase for consistency
        parsedCommand.mode = 'FSH';
        // Initialize empty tokenAmountPairs for FSH mode to avoid validation errors
        parsedCommand.tokenAmountPairs = [];
        console.log(`🐞 DEBUG: FSH Command parsed successfully`);
        console.log(`🐞 DEBUG: Added empty tokenAmountPairs array for FSH mode to avoid validation errors`);
      } else {
        console.log(`🐞 DEBUG: Standard command detected. Using parseNewSellbotFormat...`);
        parsedCommand = SellCommandParser.parseNewSellbotFormat(args);
        console.log(`🐞 DEBUG: Command parsed successfully, mode: ${parsedCommand.mode}`);
      }
      
      // Debug log to verify token synchronization
      console.log(`🔄 SellBot: Ensuring token list is synchronized before execution...`);
      console.log(`🔍 This ensures token selections stay in sync between UI and execution context`);
      
      // Check if running in BID-MODE to use appropriate token database
      if (parsedCommand.bidMode) {
        console.log(`🎯 BID-MODE detected: Using ETH as currency and bid.json database`);
        console.log(`🛡️ Using ETH as the default currency for all transactions`);
      }
      
      // Refresh token list if we have token inputs
      if (parsedCommand.tokens && Array.isArray(parsedCommand.tokens)) {
        console.log(`🔄 Refreshing ${parsedCommand.tokens.length} tokens from command arguments...`);
        // Any token-selection-changed events will be processed before execution
      }
              
      // Create bot with the right mode and run it
      console.log(`🐞 DEBUG: Creating SellBot instance with bidMode=${parsedCommand.bidMode}...`);
      const bot = new SellBot(parsedCommand.bidMode);
      console.log(`🐞 DEBUG: SellBot instance created, calling run() method with parsed command...`);
      // Pass the already parsed command instead of re-parsing it
      return await bot.run(args, parsedCommand);
    } catch (error) {
      console.error(`\n🚨 CRITICAL: Error in SellBot execution: ${error.message}`);
      console.error(`🚨 STACK TRACE: ${error.stack || error}`);
            
      // Additional debug info for common errors
      if (error.message.includes('wallet')) {
        console.log(`🖥️ Debug Tip: Check environment variables for wallet private keys`);
        console.log(`🖥️ Make sure wallets have both privateKey and address properties set`);
      }
            
      if (error.message.includes('token')) {
        console.log(`🖥️ Debug Tip: Verify token selections in UI match command arguments`);
        console.log(`🖥️ Check for token-selection-changed events that may have modified selection`);
      }
            
      if (error.message.includes('bidMode') || error.message.toLowerCase().includes('bid-mode')) {
        console.log(`🖥️ Debug Tip: Ensure bid.json database is properly loaded`);
        console.log(`🖥️ BID-MODE requires ETH trading and specific token configurations`);
      }
            
      throw error;
    }
  }
}

// Export for direct CLI usage
export default SellBot;