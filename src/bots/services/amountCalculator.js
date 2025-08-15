/**
 * Amount Calculator Service
 * Handles various amount calculations for trading
 */

import { ethers } from 'ethers';
import { BuyBot } from '../../../bots/buy-bot.js';
import { DEFAULT_SETTINGS } from '../config/constants.js';

/**
 * AmountCalculator - Handles amount calculations for trading operations
 */
export class AmountCalculator {
  /**
   * Calculate currency to VIRTUAL conversion
   * @param {number} currencyAmount - Amount of currency
   * @param {Object} currencyInfo - Currency information
   * @param {number} slippagePercent - Slippage percentage
   * @returns {Object} Conversion details
   */
  static async calculateCurrencyToVirtual(currencyAmount, currencyInfo, slippagePercent) {
    try {
      // Use proper pool calculations instead of rough estimates
      const tempBuyBot = new BuyBot([], { 
        address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', // VIRTUAL
        decimals: 18,
        poolAddress: currencyInfo.poolAddress
      }, currencyInfo.address, DEFAULT_SETTINGS);
      
      const { expectedOut, minAmountOut } = await tempBuyBot.calculateAmountOut(
        currencyAmount, 
        slippagePercent
      );
      
      return {
        expectedOut,
        minAmountOut // Use the BigNumber returned by BuyBot
      };
    } catch (error) {
      // Fallback to simple calculation if pool calculation fails
      console.log(`⚠️ Using fallback calculation: ${error.message}`);
      const expectedOut = currencyAmount * 0.95;
      const slippageMultiplier = (100 - slippagePercent) / 100;
      // SURGICAL FIX: Truncate to 12 decimals to prevent NUMERIC_FAULT in TWAP mode
      const truncatedAmount = parseFloat((expectedOut * slippageMultiplier).toFixed(12));
      const minAmountOut = ethers.parseUnits(truncatedAmount.toString(), 18);
      
      return { expectedOut, minAmountOut };
    }
  }

  /**
   * Calculate VIRTUAL to token conversion
   * @param {number} virtualAmount - Amount of VIRTUAL
   * @param {Object} tokenInfo - Token information
   * @param {number} slippagePercent - Slippage percentage
   * @returns {Object} Conversion details
   */
  static async calculateVirtualToToken(virtualAmount, tokenInfo, slippagePercent) {
    try {
      // Use proper pool calculations instead of rough estimates
      const tempBuyBot = new BuyBot([], tokenInfo, '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', DEFAULT_SETTINGS);
      
      const { expectedOut, minAmountOut } = await tempBuyBot.calculateAmountOut(
        virtualAmount, 
        slippagePercent
      );
      
      return {
        expectedTokens: expectedOut,
        minAmountOut // Use the BigNumber returned by BuyBot
      };
    } catch (error) {
      // Fallback to simple calculation if pool calculation fails
      console.log(`⚠️ Using fallback calculation: ${error.message}`);
      const expectedTokens = virtualAmount * 0.95;
      const slippageMultiplier = (100 - slippagePercent) / 100;
      // SURGICAL FIX: Truncate to 12 decimals to prevent NUMERIC_FAULT in TWAP mode
      const truncatedAmount = parseFloat((expectedTokens * slippageMultiplier).toFixed(12));
      const minAmountOut = ethers.parseUnits(truncatedAmount.toString(), tokenInfo.decimals);
      
      return { expectedTokens, minAmountOut };
    }
  }

  /**
   * Calculate percentage-based amount from balance
   * @param {string} percentageString - Percentage string (e.g., "50%")
   * @param {number} balance - Current balance
   * @returns {number} Calculated amount
   */
  static calculatePercentageAmount(percentageString, balance) {
    const percentage = parseFloat(percentageString.replace('%', ''));
    if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
      throw new Error(`Invalid percentage: ${percentageString}`);
    }
    return balance * (percentage / 100);
  }

  /**
   * Calculate TWAP transaction parameters
   * @param {number} totalAmount - Total amount to trade
   * @param {number} durationMinutes - Duration in minutes
   * @param {number} intervals - User-specified intervals (optional)
   * @returns {Object} TWAP parameters
   */
  static calculateTWAPParameters(totalAmount, durationMinutes, intervals = null) {
    const totalSeconds = durationMinutes * 60;
    const minInterval = 30; // seconds
    
    // Use user-specified intervals if provided, otherwise use duration-based calculation
    console.log(`🔍 AmountCalculator TWAP Debug: intervals=${intervals}, type=${typeof intervals}`);
    
    // Robust intervals validation - check for valid number
    const validIntervals = intervals && !isNaN(parseInt(intervals)) && parseInt(intervals) > 0;
    const numTransactions = validIntervals ? 
      Math.max(1, parseInt(intervals)) : 
      Math.max(1, Math.floor(totalSeconds / minInterval));
      
    console.log(`🔍 AmountCalculator TWAP Result: numTransactions=${numTransactions} (${validIntervals ? 'from intervals=' + intervals : 'from duration/minInterval fallback'})`);
    
    const baseAmountPerTx = totalAmount / numTransactions;
    const baseDelaySeconds = totalSeconds / numTransactions;
    
    return {
      numTransactions,
      baseAmountPerTx,
      baseDelaySeconds,
      totalSeconds
    };
  }

  /**
   * Add randomness to amount for TWAP
   * @param {number} baseAmount - Base amount
   * @param {number} remainingAmount - Remaining amount
   * @param {Object} options - Randomness options
   * @returns {number} Randomized amount
   */
  static randomizeAmount(baseAmount, remainingAmount, options = {}) {
    const { minMultiplier = 0.8, maxMultiplier = 1.2, minAmount = 0.000001 } = options;
    
    // Add randomness to amount (±20% by default)
    const randomMultiplier = minMultiplier + Math.random() * (maxMultiplier - minMultiplier);
    let currentAmount = Math.min(baseAmount * randomMultiplier, remainingAmount);
    
    // Ensure minimum amount
    if (currentAmount < minAmount) {
      return 0; // Signal to skip this transaction
    }
    
    return currentAmount;
  }

  /**
   * Format amount for display
   * @param {number} amount - Amount to format
   * @param {string} symbol - Token symbol
   * @param {number} decimals - Number of decimals
   * @returns {string} Formatted amount
   */
  static formatAmount(amount, symbol, decimals = 18) {
    // Always round to 18 decimals max
    const rounded = Number(amount).toFixed(decimals);
    return `${rounded} ${symbol}`;
  }
} 