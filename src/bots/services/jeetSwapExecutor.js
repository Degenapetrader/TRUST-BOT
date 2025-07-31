// Jeet swap executor service for TRUSTSWAP transactions

import { ethers } from 'ethers';
import { executeTransactionWithReplacementFee } from '../../config.js';
import { 
  TRUSTSWAP_ABI, 
  VIRTUAL_TOKEN_ADDRESS,
  DEFAULT_SLIPPAGE
} from '../config/jeetConstants.js';
// Hardcoded TRUSTSWAP contract for JEETBOT operations
const TRUSTSWAP_CONTRACT = '0x2FE16B70724Df66419E125dE84e58276057A56A0';
import { log } from '../../utils/logger.js';
import { sleep } from '../../utils/common.js';

export class JeetSwapExecutor {
  /**
   * Execute TRUSTSWAP fallback swap
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information
   * @param {number} tokenAmount - Amount to swap
   * @param {Object} poolInfo - Pool information (optional)
   * @returns {Promise<Object>} Swap result
   */
  static async executeTrustSwapFallback(wallet, tokenInfo, tokenAmount, poolInfo) {
    try {
      const walletIndex = wallet._walletIndex || 'X';
      
      log(`💫 TRUSTSWAP DEFAULT: Wallet B${walletIndex} swapping ${tokenAmount} ${tokenInfo.symbol} → VIRTUAL`);
      log(`🎯 Using TRUSTSWAP contract: ${TRUSTSWAP_CONTRACT}`);
      log(`💱 Fee: 0.25% (optimized)`);
      
      // Calculate amounts
      const amountIn = ethers.parseUnits(tokenAmount.toString(), tokenInfo.decimals);
      const slippagePercent = DEFAULT_SLIPPAGE; // 25%
      
      // Store the provider and expected output for later use
      let expectedOut = 0n;
      let usedProvider = null;
      
      // Execute swap with RPC fallback
      const swapResult = await executeTransactionWithReplacementFee(
        async (currentProvider, gasParams) => {
          log(`🔄 Attempting TRUSTSWAP swap via ${currentProvider._providerName}...`);
          
          // Store provider for later use
          usedProvider = currentProvider;
          
          // Create contract with proper provider connection
          const walletWithProvider = wallet.connect(currentProvider);
          const trustswapContract = new ethers.Contract(TRUSTSWAP_CONTRACT, TRUSTSWAP_ABI, walletWithProvider);
          
          try {
            // Get expected output with fee
            const path = [tokenInfo.address, VIRTUAL_TOKEN_ADDRESS];
            const [amounts, feeAmount] = await trustswapContract.getAmountsOutWithFee(amountIn, path);
            expectedOut = amounts[amounts.length - 1];
            
            // Calculate minimum output with slippage
            const minAmountOut = expectedOut * BigInt(10000 - slippagePercent) / 10000n;
            
            log(`📊 Expected: ${ethers.formatUnits(expectedOut, 18)} VIRTUAL (after 0.25% fee)`);
            log(`📉 Min output: ${ethers.formatUnits(minAmountOut, 18)} VIRTUAL (${slippagePercent/100}% slippage)`);
            
            const deadline = Math.floor(Date.now() / 1000) + 1800; // 30 minutes
            
            const swapTx = await trustswapContract.swapForVirtualWithFee(
              tokenInfo.address,
              amountIn,
              minAmountOut,
              deadline,
              {
                maxFeePerGas: gasParams.maxFeePerGas,
                maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
                gasLimit: 350000n
              }
            );
            
            log(`✅ TRUSTSWAP swap broadcasted: ${swapTx.hash}`);
            return swapTx;
          } catch (contractError) {
            log(`❌ Contract call failed: ${contractError.message}`);
            throw contractError;
          }
        }
      );
      
      if (swapResult && swapResult.receipt) {
        // Use the stored expected output or calculate it again with final provider
        let virtualReceived;
        if (expectedOut > 0n) {
          virtualReceived = parseFloat(ethers.formatUnits(expectedOut, 18));
        } else {
          // Fallback: calculate again with final provider
          try {
            const finalProvider = usedProvider || swapResult.provider;
            if (finalProvider) {
              const walletWithProvider = wallet.connect(finalProvider);
              const trustswapContract = new ethers.Contract(TRUSTSWAP_CONTRACT, TRUSTSWAP_ABI, walletWithProvider);
              const path = [tokenInfo.address, VIRTUAL_TOKEN_ADDRESS];
              const [amounts] = await trustswapContract.getAmountsOutWithFee(amountIn, path);
              virtualReceived = parseFloat(ethers.formatUnits(amounts[amounts.length - 1], 18));
            } else {
              virtualReceived = 0; // Fallback value
            }
          } catch (fallbackError) {
            log(`⚠️ Could not calculate received amount: ${fallbackError.message}`);
            virtualReceived = 0;
          }
        }
        
        return {
          success: true,
          txHash: swapResult.hash,
          gasUsed: swapResult.receipt.gasUsed.toString(),
          virtualReceived: virtualReceived,
          method: 'TRUSTSWAP-DEFAULT',
          provider: usedProvider || swapResult.provider
        };
      }
      
      throw new Error('TRUSTSWAP swap failed - no receipt');
      
    } catch (error) {
      log(`❌ TRUSTSWAP DEFAULT failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        method: 'TRUSTSWAP-DEFAULT'
      };
    }
  }

  /**
   * Execute pool-based swap (fallback method)
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information
   * @param {number} tokenAmount - Amount to swap
   * @param {Object} poolInfo - Pool information
   * @returns {Promise<Object>} Swap result
   */
  static async executePoolBasedSwap(wallet, tokenInfo, tokenAmount, poolInfo) {
    try {
      const walletIndex = wallet._walletIndex || 'X';
      
      log(`🏊 POOL-BASED FALLBACK: Wallet B${walletIndex} swapping ${tokenAmount} ${tokenInfo.symbol} → VIRTUAL`);
      log(`🎯 Using pool: ${tokenInfo.poolAddress}`);
      
      // For now, this falls back to TRUSTSWAP as pool-based swaps are complex
      // In future, this could implement direct pool interaction
      return await this.executeTrustSwapFallback(wallet, tokenInfo, tokenAmount, poolInfo);
      
    } catch (error) {
      log(`❌ Pool-based swap failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        method: 'POOL-BASED-FALLBACK'
      };
    }
  }

  /**
   * Execute token swap with automatic fallback
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information
   * @param {number} tokenAmount - Amount to swap
   * @param {Array} wallets - All wallets array for index calculation
   * @returns {Promise<Object>} Swap result
   */
  static async executeTokenSwap(wallet, tokenInfo, tokenAmount, wallets) {
    try {
      const walletIndex = wallets.findIndex(w => w.address === wallet.address) + 1;
      wallet._walletIndex = walletIndex; // Store for use in sub-functions
      
      log(`💫 Wallet B${walletIndex}: Starting swap of ${tokenAmount} ${tokenInfo.symbol} → VIRTUAL`);
      
      // DEFAULT METHOD: Always try TRUSTSWAP fallback first
      log(`🎯 Trying TRUSTSWAP DEFAULT mode first...`);
      const trustswapResult = await this.executeTrustSwapFallback(wallet, tokenInfo, tokenAmount, null);
      
      if (trustswapResult.success) {
        log(`🎉 Wallet B${walletIndex}: TRUSTSWAP DEFAULT SUCCESS! ${tokenAmount} ${tokenInfo.symbol} → ${trustswapResult.virtualReceived.toFixed(6)} VIRTUAL`);
        log(`   💎 TX Hash: ${trustswapResult.txHash}`);
        log(`   ⛽ Gas Used: ${trustswapResult.gasUsed}`);
        log(`   💱 Method: TRUSTSWAP default (0.25% fee)`);
        
        return {
          success: true,
          walletIndex,
          tokenAmount,
          virtualReceived: trustswapResult.virtualReceived || 0,
          txHash: trustswapResult.txHash || null,
          gasUsed: trustswapResult.gasUsed || '0',
          method: 'TRUSTSWAP-DEFAULT',
          error: null
        };
      }
      
      // FALLBACK METHOD: Try pool-based swap if TRUSTSWAP failed and pool is available
      if (!tokenInfo.isTrustSwapDefault && tokenInfo.poolAddress) {
        log(`⚠️ TRUSTSWAP default failed, trying pool-based fallback...`);
        const poolResult = await this.executePoolBasedSwap(wallet, tokenInfo, tokenAmount, null);
        
        if (poolResult.success) {
          log(`🎉 Wallet B${walletIndex}: POOL-BASED FALLBACK SUCCESS! ${tokenAmount} ${tokenInfo.symbol} → ${poolResult.virtualReceived.toFixed(6)} VIRTUAL`);
          log(`   💎 TX Hash: ${poolResult.txHash}`);
          log(`   ⛽ Gas Used: ${poolResult.gasUsed}`);
          log(`   💱 Method: Pool-based fallback (0.25% fee)`);
          
          return {
            success: true,
            walletIndex,
            tokenAmount,
            virtualReceived: poolResult.virtualReceived || 0,
            txHash: poolResult.txHash || null,
            gasUsed: poolResult.gasUsed || '0',
            method: 'POOL-BASED-FALLBACK',
            error: null
          };
        }
      }
      
      // Both methods failed
      const errorMsg = tokenInfo.poolAddress ? 
        'Both TRUSTSWAP default and pool-based fallback failed' :
        'TRUSTSWAP default failed (no pool available for fallback)';
      
      log(`❌ Wallet B${walletIndex}: ALL METHODS FAILED - ${errorMsg}`);
      return {
        success: false,
        walletIndex,
        tokenAmount,
        virtualReceived: 0,
        txHash: null,
        gasUsed: '0',
        method: 'ALL-FAILED',
        error: errorMsg
      };

    } catch (error) {
      const walletIndex = wallets.findIndex(w => w.address === wallet.address) + 1;
      log(`❌ Wallet B${walletIndex}: SWAP ERROR - ${error.message}`);
      return {
        success: false,
        walletIndex,
        error: error.message,
        method: 'ERROR',
        tokenAmount,
        virtualReceived: 0,
        txHash: null,
        gasUsed: '0'
      };
    }
  }
} 