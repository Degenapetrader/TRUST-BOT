/**
 * Sell Amount Calculator Service
 * Handles amount calculations for selling tokens including percentage and fixed amounts
 */

import { ethers } from 'ethers';
import { executeRpcWithFallback } from '../../config.js';

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

/**
 * SellAmountCalculator - Calculates amounts for sell operations
 */
export class SellAmountCalculator {
  /**
   * Get token balance for a wallet
   * @param {string} walletAddress - Wallet address
   * @param {string} tokenAddress - Token address
   * @param {number} tokenDecimals - Token decimals
   * @returns {Object} Balance information
   */
  static async getTokenBalance(walletAddress, tokenAddress, tokenDecimals) {
    try {
      const balance = await executeRpcWithFallback(async (provider) => {
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        return await tokenContract.balanceOf(walletAddress);
      });
      
      const balanceFormatted = parseFloat(ethers.formatUnits(balance, tokenDecimals));
      
      return {
        balanceWei: balance,
        balanceFormatted: balanceFormatted,
        hasBalance: balanceFormatted > 0
      };
    } catch (error) {
      console.log(`Error getting balance: ${error.message}`);
      return {
        balanceWei: 0n,
        balanceFormatted: 0,
        hasBalance: false
      };
    }
  }
  
  /**
   * Calculate sell amount based on input string (percentage or fixed)
   * @param {string} amountStr - Amount string (e.g., "100", "50%", "0.5%")
   * @param {Object} tokenBalance - Token balance object
   * @param {string} tokenSymbol - Token symbol for logging
   * @returns {Object} Calculated amount information
   */
  static calculateSellAmount(amountStr, tokenBalance, tokenSymbol) {
    if (!amountStr || !tokenBalance.hasBalance) {
      return {
        amount: 0,
        isPercentage: false,
        percentage: 0,
        error: 'No balance or amount specified'
      };
    }
    
    const isPercentage = amountStr.endsWith('%');
    let amount;
    
    if (isPercentage) {
      // Handle percentage-based amounts
      const percentage = parseFloat(amountStr.slice(0, -1));
      if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
        return {
          amount: 0,
          isPercentage: true,
          percentage: 0,
          error: 'Invalid percentage value'
        };
      }
      
      amount = (tokenBalance.balanceFormatted * percentage) / 100;
      
      console.log(`   📊 Selling ${percentage}% of ${tokenBalance.balanceFormatted.toFixed(6)} ${tokenSymbol} = ${amount.toFixed(6)} ${tokenSymbol}`);
      
      return {
        amount: amount,
        isPercentage: true,
        percentage: percentage,
        error: null
      };
    } else {
      // Handle fixed amounts
      amount = parseFloat(amountStr);
      if (isNaN(amount) || amount <= 0) {
        return {
          amount: 0,
          isPercentage: false,
          percentage: 0,
          error: 'Invalid amount value'
        };
      }
      
      if (amount > tokenBalance.balanceFormatted) {
        console.log(`   ⚠️ Requested ${amount} ${tokenSymbol} but balance is only ${tokenBalance.balanceFormatted.toFixed(6)} ${tokenSymbol}`);
        console.log(`   📊 Using full balance: ${tokenBalance.balanceFormatted.toFixed(6)} ${tokenSymbol}`);
        amount = tokenBalance.balanceFormatted;
      }
      
      return {
        amount: amount,
        isPercentage: false,
        percentage: 0,
        error: null
      };
    }
  }
  
  /**
   * Calculate multiple sell amounts for batch operations
   * @param {Array} tokenAmountPairs - Array of {tokenInfo, amount} pairs
   * @param {string} walletAddress - Wallet address
   * @returns {Array} Calculated amounts with validation
   */
  static async calculateBatchSellAmounts(tokenAmountPairs, walletAddress) {
    const calculatedAmounts = [];
    
    for (const pair of tokenAmountPairs) {
      const { tokenInfo, amount: amountStr } = pair;
      
      // Get token balance
      const balance = await this.getTokenBalance(
        walletAddress,
        tokenInfo.address,
        tokenInfo.decimals
      );
      
      if (!balance.hasBalance) {
        console.log(`   ❌ No balance for ${tokenInfo.symbol} in wallet`);
        calculatedAmounts.push({
          ...pair,
          calculatedAmount: 0,
          skip: true,
          reason: 'No balance'
        });
        continue;
      }
      
      // Calculate sell amount
      const calculated = this.calculateSellAmount(amountStr, balance, tokenInfo.symbol);
      
      if (calculated.error) {
        console.log(`   ❌ ${tokenInfo.symbol}: ${calculated.error}`);
        calculatedAmounts.push({
          ...pair,
          calculatedAmount: 0,
          skip: true,
          reason: calculated.error
        });
        continue;
      }
      
      calculatedAmounts.push({
        ...pair,
        calculatedAmount: calculated.amount,
        isPercentage: calculated.isPercentage,
        percentage: calculated.percentage,
        balance: balance.balanceFormatted,
        skip: false
      });
    }
    
    return calculatedAmounts;
  }
  
  /**
   * Validate sell amount against minimum thresholds
   * @param {number} amount - Amount to sell
   * @param {Object} tokenInfo - Token information
   * @param {number} minUsdValue - Minimum USD value (optional)
   * @returns {Object} Validation result
   */
  static validateSellAmount(amount, tokenInfo, minUsdValue = 1) {
    if (amount <= 0) {
      return {
        valid: false,
        reason: 'Amount must be greater than zero'
      };
    }
    
    // Check minimum token amount (avoid dust)
    const minTokenAmount = Math.pow(10, -Math.min(6, tokenInfo.decimals));
    if (amount < minTokenAmount) {
      return {
        valid: false,
        reason: `Amount too small (minimum: ${minTokenAmount} ${tokenInfo.symbol})`
      };
    }
    
    // Additional USD value check could be added here if price data is available
    
    return {
      valid: true,
      reason: null
    };
  }
  
  /**
   * Calculate optimal sell amounts for FSH mode
   * @param {Array} tokensWithPools - Tokens with pool information
   * @param {Object} fshSettings - FSH mode settings
   * @returns {Array} Optimized token amounts
   */
  static calculateFSHAmounts(tokensWithPools, fshSettings = {}) {
    const minBalance = fshSettings.minBalance || 100;
    const maxSlippage = fshSettings.maxSlippage || 0.05; // 5%
    
    return tokensWithPools.map(token => {
      // Skip tokens below minimum balance
      if (token.formattedBalance < minBalance) {
        return {
          ...token,
          sellAmount: 0,
          skip: true,
          reason: `Balance below minimum (${minBalance})`
        };
      }
      
      // For FSH mode, typically sell 100% of balance
      const sellAmount = token.formattedBalance * 0.999; // Keep tiny amount for gas
      
      return {
        ...token,
        sellAmount: sellAmount,
        skip: false,
        expectedSlippage: maxSlippage
      };
    });
  }
  
  /**
   * Calculate TWAP chunk sizes
   * @param {number} totalAmount - Total amount to sell
   * @param {number} duration - Duration in minutes
   * @param {Object} twapSettings - TWAP settings
   * @returns {Object} TWAP calculation details
   */
  static calculateTWAPChunks(totalAmount, duration, twapSettings = {}) {
    const minInterval = twapSettings.minInterval || 30; // seconds
    const durationSeconds = duration * 60;
    
    // Use user-specified intervals if provided, otherwise use duration-based calculation
    const chunks = twapSettings.intervals ? 
      Math.max(1, parseInt(twapSettings.intervals)) : 
      Math.max(1, Math.floor(durationSeconds / minInterval));
      
    const chunkSize = totalAmount / chunks;
    const interval = Math.floor(durationSeconds / chunks);

    return {
      totalAmount,
      chunks,
      chunkSize,
      interval,
      totalDuration: duration,
      estimatedTime: chunks * interval
    };
  }
} 