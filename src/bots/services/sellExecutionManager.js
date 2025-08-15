/**
 * Sell Execution Manager Service
 * Manages different execution modes for sellbot operations
 */

import { ethers } from 'ethers';
import { SellSwapExecutor } from './sellSwapExecutor.js';
import { SellAmountCalculator } from './sellAmountCalculator.js';
import { FSHModeHandler } from './fshModeHandler.js';
import { sleep, log } from '../../utils.js';
import { ResultProcessor } from '../../parsing/resultProcessor.js';

/**
 * SellExecutionManager - Orchestrates different sell execution strategies
 */
export class SellExecutionManager {
  /**
   * Execute sells in parallel mode
   * @param {Array} selectedWallets - Selected wallets
   * @param {Array} tokenAmountPairs - Token-amount pairs to sell
   * @param {Object} currencyInfo - Currency information
   * @param {string} customGasPrice - Custom gas price
   * @param {Object} tracker - Transaction tracker
   * @param {boolean} bidMode - Whether BID-MODE is enabled
   * @returns {Object} Execution results
   */
  static async executeParallelSells(selectedWallets, tokenAmountPairs, currencyInfo = null, customGasPrice = null, tracker = null, bidMode = false) {
    log('\n⚡ PARALLEL EXECUTION MODE');
    log('========================');
    
    const allPromises = [];
    
    for (const wallet of selectedWallets) {
      for (const pair of tokenAmountPairs) {
        const { tokenInfo, amount: amountStr } = pair;
        
        // Get balance and calculate amount
        const balance = await SellAmountCalculator.getTokenBalance(
          wallet.address,
          tokenInfo.address,
          tokenInfo.decimals
        );
        
        if (!balance.hasBalance) {
          log(`❌ ${wallet.address.slice(0,8)}: No ${tokenInfo.symbol} balance`);
          continue;
        }
        
        const calculated = SellAmountCalculator.calculateSellAmount(
          amountStr,
          balance,
          tokenInfo.symbol
        );
        
        if (calculated.error || calculated.amount <= 0) {
          log(`❌ ${wallet.address.slice(0,8)}: ${calculated.error || 'Invalid amount'}`);
          continue;
        }
        
        // Create sell promise
        const sellPromise = (async () => {
          try {
            log(`\n💼 Wallet ${wallet.address.slice(0,8)} selling ${calculated.amount.toFixed(6)} ${tokenInfo.symbol}${bidMode ? ' (BID-MODE)' : ''}`);
            
            let result;
            
            // BID-MODE: Direct Token → ETH swap using TRUSTSWAP
            // DISABLED FOR ETH: Force ETH to use working two-step path like regular BuyBot
            if (bidMode && currencyInfo && currencyInfo.isEth) {
              log(`    ⚠️ ETH with BID-MODE: Forcing two-step path (like regular BuyBot) instead of executeETHSell`);
              result = await SellSwapExecutor.executeTwoStepSell(
                wallet,
                tokenInfo,
                currencyInfo,
                calculated.amount,
                customGasPrice,
                tracker
              );
            } else if (bidMode && currencyInfo && !currencyInfo.isEth) {
              log(`    🎯 BID-MODE: Using TRUSTSWAP.swapTokensForETHWithFee`);
              result = await SellSwapExecutor.executeETHSell(
                wallet,
                tokenInfo,
                calculated.amount,
                customGasPrice
              );
              
              if (result.success && tracker) {
                tracker.addTransaction(
                  wallet.address,
                  tokenInfo.symbol,
                  calculated.amount,
                  'ETH',
                  result.ethReceived
                );
              }
            } else if (currencyInfo && !currencyInfo.isVirtual) {
              // Two-step sell
              result = await SellSwapExecutor.executeTwoStepSell(
                wallet,
                tokenInfo,
                currencyInfo,
                calculated.amount,
                customGasPrice,
                tracker
              );
            } else {
              // Direct sell to VIRTUAL
              result = await SellSwapExecutor.executeDirectSellToVirtual(
                wallet,
                tokenInfo,
                calculated.amount,
                customGasPrice
              );
              
              if (result.success && tracker) {
                tracker.addTransaction(
                  wallet.address,
                  tokenInfo.symbol,
                  calculated.amount,
                  'VIRTUAL',
                  result.virtualReceived
                );
              }
            }
            
            return {
              wallet: wallet.address,
              token: tokenInfo.symbol,
              amount: calculated.amount,
              success: result.success,
              result
            };
          } catch (error) {
            return {
              wallet: wallet.address,
              token: tokenInfo.symbol,
              amount: calculated.amount,
              success: false,
              error: error.message
            };
          }
        })();
        
        allPromises.push(sellPromise);
      }
    }
    
    if (allPromises.length === 0) {
      log('\n❌ No valid sells to execute');
      return { success: true, results: [] };
    }
    
    log(`\n🚀 Executing ${allPromises.length} sells in parallel...`);
    const results = await Promise.allSettled(allPromises);
    
    const processedResults = results.map(result => 
      result.status === 'fulfilled' ? result.value : { success: false, error: result.reason }
    );
    
    const successful = processedResults.filter(r => r.success).length;
    const failed = processedResults.filter(r => !r.success).length;
    
    log(`\n✅ Parallel execution complete: ${successful} successful, ${failed} failed`);
    
    return {
      success: true,
      results: processedResults,
      summary: { successful, failed, total: processedResults.length }
    };
  }
  
  /**
   * Execute sells in sequential mode
   * @param {Array} selectedWallets - Selected wallets
   * @param {Array} tokenAmountPairs - Token-amount pairs to sell
   * @param {Object} currencyInfo - Currency information
   * @param {string} customGasPrice - Custom gas price
   * @param {Object} tracker - Transaction tracker
   * @param {boolean} bidMode - Whether BID-MODE is enabled
   * @returns {Object} Execution results
   */
  static async executeSequentialSells(selectedWallets, tokenAmountPairs, currencyInfo = null, customGasPrice = null, tracker = null, bidMode = false) {
    log('\n🐌 SEQUENTIAL EXECUTION MODE');
    log('===========================');
    
    const results = [];
    
    for (const wallet of selectedWallets) {
      for (const pair of tokenAmountPairs) {
        const { tokenInfo, amount: amountStr } = pair;
        
        // Get balance and calculate amount
        const balance = await SellAmountCalculator.getTokenBalance(
          wallet.address,
          tokenInfo.address,
          tokenInfo.decimals
        );
        
        if (!balance.hasBalance) {
          log(`❌ ${wallet.address.slice(0,8)}: No ${tokenInfo.symbol} balance`);
          results.push({
            wallet: wallet.address,
            token: tokenInfo.symbol,
            success: false,
            error: 'No balance'
          });
          continue;
        }
        
        const calculated = SellAmountCalculator.calculateSellAmount(
          amountStr,
          balance,
          tokenInfo.symbol
        );
        
        if (calculated.error || calculated.amount <= 0) {
          log(`❌ ${wallet.address.slice(0,8)}: ${calculated.error || 'Invalid amount'}`);
          results.push({
            wallet: wallet.address,
            token: tokenInfo.symbol,
            success: false,
            error: calculated.error || 'Invalid amount'
          });
          continue;
        }
        
        try {
          log(`\n💼 Wallet ${wallet.address.slice(0,8)} selling ${calculated.amount.toFixed(6)} ${tokenInfo.symbol}${bidMode ? ' (BID-MODE)' : ''}`);
          
          let result;
          
          // BID-MODE: Direct Token → ETH swap using TRUSTSWAP
          if (bidMode && currencyInfo && currencyInfo.isEth) {
            log(`    🎯 BID-MODE: Using TRUSTSWAP.swapTokensForETHWithFee`);
            result = await SellSwapExecutor.executeETHSell(
              wallet,
              tokenInfo,
              calculated.amount,
              customGasPrice
            );
            
            if (result.success && tracker) {
              tracker.addTransaction(
                wallet.address,
                tokenInfo.symbol,
                calculated.amount,
                'ETH',
                result.ethReceived
              );
            }
          } else if (currencyInfo && !currencyInfo.isVirtual) {
            // Two-step sell
            result = await SellSwapExecutor.executeTwoStepSell(
              wallet,
              tokenInfo,
              currencyInfo,
              calculated.amount,
              customGasPrice,
              tracker
            );
          } else {
            // Direct sell to VIRTUAL
            result = await SellSwapExecutor.executeDirectSellToVirtual(
              wallet,
              tokenInfo,
              calculated.amount,
              customGasPrice
            );
            
            if (result.success && tracker) {
              tracker.addTransaction(
                wallet.address,
                tokenInfo.symbol,
                calculated.amount,
                'VIRTUAL',
                result.virtualReceived
              );
            }
          }
          
          results.push({
            wallet: wallet.address,
            token: tokenInfo.symbol,
            amount: calculated.amount,
            success: result.success,
            result
          });
          
          // Small delay between sequential operations
          await sleep(1000);
          
        } catch (error) {
          results.push({
            wallet: wallet.address,
            token: tokenInfo.symbol,
            amount: calculated.amount,
            success: false,
            error: error.message
          });
        }
      }
    }
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    log(`\n✅ Sequential execution complete: ${successful} successful, ${failed} failed`);
    
    return {
      success: true,
      results,
      summary: { successful, failed, total: results.length }
    };
  }
  
  /**
   * Execute TWAP (Time-Weighted Average Price) sell
   * @param {Array} selectedWallets - Selected wallets
   * @param {Object} tokenInfo - Token information
   * @param {string} amountStr - Amount string
   * @param {number} duration - Duration in minutes
   * @param {Object} currencyInfo - Currency information
   * @param {string} customGasPrice - Custom gas price
   * @param {Object} tracker - Transaction tracker
   * @param {boolean} bidMode - Whether BID-MODE is enabled
   * @returns {Object} Execution results
   */
  static async executeTWAPSell(selectedWallets, tokenInfo, amountStr, duration, currencyInfo = null, customGasPrice = null, tracker = null, bidMode = false, intervals = null) {
    log('\n🕐 TWAP EXECUTION MODE');
    log('=====================');
    log(`📊 Token: ${tokenInfo.symbol}`);
    log(`⏱️ Duration: ${duration} minutes`);
    if (bidMode) {
      log(`🎯 BID-MODE: Using bid.json database and ETH currency`);
    }
    
    const results = [];
    
    for (const wallet of selectedWallets) {
      try {
        // Get balance
        const balance = await SellAmountCalculator.getTokenBalance(
          wallet.address,
          tokenInfo.address,
          tokenInfo.decimals
        );
        
        if (!balance.hasBalance) {
          log(`❌ ${wallet.address.slice(0,8)}: No ${tokenInfo.symbol} balance`);
          continue;
        }
        
        // Calculate total amount
        const calculated = SellAmountCalculator.calculateSellAmount(
          amountStr,
          balance,
          tokenInfo.symbol
        );
        
        if (calculated.error || calculated.amount <= 0) {
          log(`❌ ${wallet.address.slice(0,8)}: ${calculated.error || 'Invalid amount'}`);
          continue;
        }
        
        // Calculate TWAP chunks
        const twapCalc = SellAmountCalculator.calculateTWAPChunks(
          calculated.amount,
          duration,
          { intervals } // Pass user-specified order count
        );
        
        log(`\n💼 Wallet ${wallet.address.slice(0,8)} TWAP sell:`);
        log(`   📊 Total: ${twapCalc.totalAmount.toFixed(6)} ${tokenInfo.symbol}`);
        log(`   🔢 Chunks: ${twapCalc.chunks}`);
        log(`   💰 Per chunk: ${twapCalc.chunkSize.toFixed(6)} ${tokenInfo.symbol}`);
        log(`   ⏱️ Interval: ${twapCalc.interval} seconds`);
        
        const chunkResults = [];
        
        for (let i = 0; i < twapCalc.chunks; i++) {
          // Check for termination signal
          if (global.isTerminating) {
            log('\n🛑 Termination signal received. Stopping TWAP sell execution...');
            break;
          }
          
          log(`\n   🔄 Chunk ${i + 1}/${twapCalc.chunks}${bidMode ? ' (BID-MODE)' : ''}...`);
          
          let result;
          
          // BID-MODE: Direct Token → ETH swap using TRUSTSWAP
          if (bidMode && currencyInfo && currencyInfo.isEth) {
            result = await SellSwapExecutor.executeETHSell(
              wallet,
              tokenInfo,
              twapCalc.chunkSize,
              customGasPrice
            );
            
            if (result.success && tracker) {
              tracker.addTransaction(
                wallet.address,
                tokenInfo.symbol,
                twapCalc.chunkSize,
                'ETH',
                result.ethReceived
              );
            }
          } else if (currencyInfo && !currencyInfo.isVirtual) {
            result = await SellSwapExecutor.executeTwoStepSell(
              wallet,
              tokenInfo,
              currencyInfo,
              twapCalc.chunkSize,
              customGasPrice,
              tracker
            );
          } else {
            result = await SellSwapExecutor.executeDirectSellToVirtual(
              wallet,
              tokenInfo,
              twapCalc.chunkSize,
              customGasPrice
            );
            
            if (result.success && tracker) {
              tracker.addTransaction(
                wallet.address,
                tokenInfo.symbol,
                twapCalc.chunkSize,
                'VIRTUAL',
                result.virtualReceived
              );
            }
          }
          
          chunkResults.push({
            chunk: i + 1,
            success: result.success,
            result
          });
          
          // Wait for interval (except after last chunk)
          if (i < twapCalc.chunks - 1) {
            log(`   ⏳ Waiting ${twapCalc.interval} seconds...`);
            await sleep(twapCalc.interval * 1000);
          }
        }
        
        const successfulChunks = chunkResults.filter(r => r.success).length;
        
        results.push({
          wallet: wallet.address,
          token: tokenInfo.symbol,
          totalAmount: twapCalc.totalAmount,
          chunks: twapCalc.chunks,
          successfulChunks,
          failedChunks: twapCalc.chunks - successfulChunks,
          chunkResults
        });
        
      } catch (error) {
        results.push({
          wallet: wallet.address,
          token: tokenInfo.symbol,
          success: false,
          error: error.message
        });
      }
    }
    
    log('\n✅ TWAP execution complete');
    
    return {
      success: true,
      mode: 'twap',
      results
    };
  }
  
  /**
   * Execute FSH (Flash Sell All) mode
   * @param {Array} selectedWallets - Selected wallets
   * @param {string} customGasPrice - Custom gas price
   * @param {Object} tracker - Transaction tracker
   * @param {boolean} bidMode - Whether BID-MODE is enabled
   * @returns {Object} Execution results
   */
  static async executeFSHMode(selectedWallets, customGasPrice = null, tracker = null, bidMode = false) {
    const fshHandler = new FSHModeHandler();
    
    if (bidMode) {
      log('🎯 BID-MODE FSH: Using bid.json database and ETH currency');
    }
    
    // Scan for tokens
    const scanResult = await fshHandler.executeFlashSellAll(
      selectedWallets,
      customGasPrice,
      tracker
    );
    
    if (!scanResult.success || scanResult.totalTokensToSell === 0) {
      return scanResult;
    }
    
    // Execute sells
    const { walletsToSell } = scanResult;
    const allSellPromises = [];
    
    for (const walletData of walletsToSell) {
      const { wallet, walletIndex, tokens } = walletData;
      
      for (const tokenInfo of tokens) {
        const sellPromise = (async () => {
          try {
            const fshConfig = {
              CONTRACT_ADDRESS: '0x74fa2835311Da3118BF2971Fa11E8070e4ff1693',
              ABI: [
                "function swapForVirtualWithFee(address tokenIn, uint256 amountIn, uint256 amountOutMin, uint256 deadline) external returns (uint256[] memory)"
              ],
              SETTINGS: {
                MIN_AMOUNT_OUT: 0,
                DEADLINE_MINUTES: 20,
                GAS_LIMIT: 600000
              }
            };
            
            const result = await SellSwapExecutor.executeFSHTrustSwap(
              wallet,
              tokenInfo,
              tokenInfo.formattedBalance * 0.999, // Sell 99.9%
              customGasPrice,
              fshConfig
            );
            
            if (result.success && tracker) {
              tracker.addTransaction(
                wallet.address,
                tokenInfo.symbol,
                tokenInfo.formattedBalance,
                'VIRTUAL',
                result.virtualReceived
              );
            }
            
            return {
              wallet: wallet.address,
              walletIndex,
              token: tokenInfo.symbol,
              amount: tokenInfo.formattedBalance,
              success: result.success,
              result
            };
          } catch (error) {
            return {
              wallet: wallet.address,
              walletIndex,
              token: tokenInfo.symbol,
              amount: tokenInfo.formattedBalance,
              success: false,
              error: error.message
            };
          }
        })();
        
        allSellPromises.push(sellPromise);
      }
    }
    
    log(`\n🚀 Executing ${allSellPromises.length} FSH sells in parallel...`);
    const results = await Promise.allSettled(allSellPromises);
    
    const processedResults = results.map(result => 
      result.status === 'fulfilled' ? result.value : { success: false, error: result.reason }
    );
    
    const successful = processedResults.filter(r => r.success).length;
    const failed = processedResults.filter(r => !r.success).length;
    
    log(`\n✅ FSH execution complete: ${successful} successful, ${failed} failed`);
    
    // Process results
    const resultProcessor = new ResultProcessor();
    const summary = resultProcessor.processFSHResults(processedResults);
    resultProcessor.displayFSHSummary(summary);
    
    return {
      success: true,
      mode: 'fsh',
      results: processedResults,
      summary
    };
  }
  
  /**
   * Execute sells with loop support
   * @param {Object} config - Execution configuration
   * @returns {Object} Execution results
   */
  static async executeSellsWithLoops(config) {
    const {
      selectedWallets,
      tokenAmountPairs,
      loops = 1,
      slowMode = false,
      currencyInfo = null,
      customGasPrice = null,
      tracker = null
    } = config;
    
    const allResults = [];
    
    for (let loop = 1; loop <= loops; loop++) {
      if (loops > 1) {
        log(`\n🔄 LOOP ${loop}/${loops}`);
        log('================');
      }
      
      let loopResult;
      if (slowMode) {
        loopResult = await this.executeSequentialSells(
          selectedWallets,
          tokenAmountPairs,
          currencyInfo,
          customGasPrice,
          tracker
        );
      } else {
        loopResult = await this.executeParallelSells(
          selectedWallets,
          tokenAmountPairs,
          currencyInfo,
          customGasPrice,
          tracker
        );
      }
      
      allResults.push({
        loop,
        ...loopResult
      });
      
      // Delay between loops
      if (loop < loops) {
        log('\n⏳ Waiting 5 seconds before next loop...');
        await sleep(5000);
      }
    }
    
    // Aggregate results
    const totalSuccessful = allResults.reduce((sum, r) => sum + r.summary.successful, 0);
    const totalFailed = allResults.reduce((sum, r) => sum + r.summary.failed, 0);
    const totalOperations = allResults.reduce((sum, r) => sum + r.summary.total, 0);
    
    return {
      success: true,
      loops,
      mode: slowMode ? 'sequential' : 'parallel',
      results: allResults,
      summary: {
        totalSuccessful,
        totalFailed,
        totalOperations,
        loops
      }
    };
  }
} 