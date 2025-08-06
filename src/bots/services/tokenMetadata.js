// Minimal token metadata service for Base network
// Addresses: Do we need token name/decimals? Most Base ERC-20 are 18 decimals but some exceptions exist

import { ethers } from 'ethers';
import { ERC20_ABI } from '../config/jeetConstants.js';
import { log } from '../../utils/logger.js';

/**
 * Token metadata service optimized for Base network
 * 
 * User Question: Do we need token name/decimals? All tokens are ERC-20 on Base, so default decimals is 18, right?
 * Answer: MOSTLY true, but some tokens (USDC=6, WBTC=8) have different decimals. We should check to be accurate.
 * 
 * Token name is mainly for display/logging purposes and not critical for swaps.
 */
export class TokenMetadata {
  static cache = new Map(); // Cache to avoid repeated metadata calls
  
  /**
   * Get essential token metadata (optimized for Base network)
   * @param {string} tokenAddress - Token contract address
   * @param {Object} provider - Ethers provider
   * @param {boolean} skipName - Skip fetching name (saves RPC call) - default true
   * @returns {Promise<Object>} Token metadata
   */
  static async getTokenMetadata(tokenAddress, provider, skipName = true) {
    const cacheKey = `${tokenAddress.toLowerCase()}-${skipName}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < 300000) { // 5 minute cache
        return cached.data;
      }
    }
    
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      
      // Get symbol and decimals (always needed)
      const [symbol, decimals] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.decimals()
      ]);
      
      let name = null;
      if (!skipName) {
        try {
          name = await tokenContract.name();
        } catch (error) {
          log(`⚠️ Could not fetch token name for ${tokenAddress.slice(0, 8)}...: ${error.message}`);
          name = 'Unknown Token';
        }
      }
      
      // Check for non-standard decimals on Base
      const isStandardDecimals = decimals === 18;
      
      const metadata = {
        address: tokenAddress,
        symbol: symbol || 'UNKNOWN',
        name: name,
        decimals: Number(decimals),
        isStandardDecimals,
        needsDecimalCheck: !isStandardDecimals
      };
      
      // Log warning for non-standard decimals
      if (!isStandardDecimals) {
        log(`⚠️ Non-standard decimals detected: ${symbol} has ${decimals} decimals (not 18)`);
      }
      
      // Cache result
      this.cache.set(cacheKey, {
        data: metadata,
        timestamp: Date.now()
      });
      
      return metadata;
      
    } catch (error) {
      log(`❌ Failed to get token metadata for ${tokenAddress.slice(0, 8)}...: ${error.message}`);
      
      // Return defaults for failed metadata calls
      return {
        address: tokenAddress,
        symbol: 'UNKNOWN',
        name: skipName ? null : 'Unknown Token',
        decimals: 18, // Default assumption for Base
        isStandardDecimals: true,
        needsDecimalCheck: false,
        error: error.message
      };
    }
  }
  
  /**
   * Get minimal metadata (symbol + decimals only) - saves RPC calls
   * @param {string} tokenAddress - Token contract address
   * @param {Object} provider - Ethers provider
   * @returns {Promise<Object>} Minimal token metadata
   */
  static async getMinimalMetadata(tokenAddress, provider) {
    return this.getTokenMetadata(tokenAddress, provider, true);
  }
  
  /**
   * Get full metadata (symbol + decimals + name) - for display purposes
   * @param {string} tokenAddress - Token contract address
   * @param {Object} provider - Ethers provider
   * @returns {Promise<Object>} Full token metadata
   */
  static async getFullMetadata(tokenAddress, provider) {
    return this.getTokenMetadata(tokenAddress, provider, false);
  }
  
  /**
   * Check if token has standard 18 decimals (quick check)
   * @param {string} tokenAddress - Token contract address
   * @param {Object} provider - Ethers provider
   * @returns {Promise<boolean>} True if 18 decimals
   */
  static async hasStandardDecimals(tokenAddress, provider) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const decimals = await tokenContract.decimals();
      return Number(decimals) === 18;
    } catch (error) {
      log(`⚠️ Could not check decimals for ${tokenAddress.slice(0, 8)}..., assuming 18`);
      return true; // Default assumption
    }
  }
  
  /**
   * Format token amount with correct decimals
   * @param {BigInt|string} amount - Token amount in wei
   * @param {number} decimals - Token decimals
   * @param {number} displayDecimals - Display precision (default 6)
   * @returns {string} Formatted amount
   */
  static formatTokenAmount(amount, decimals = 18, displayDecimals = 6) {
    try {
      const formatted = ethers.formatUnits(amount, decimals);
      return parseFloat(formatted).toFixed(displayDecimals);
    } catch (error) {
      return '0.000000';
    }
  }
  
  /**
   * Parse token amount to wei with correct decimals
   * @param {string|number} amount - Human readable amount
   * @param {number} decimals - Token decimals
   * @returns {BigInt} Amount in wei
   */
  static parseTokenAmount(amount, decimals = 18) {
    try {
      return ethers.parseUnits(amount.toString(), decimals);
    } catch (error) {
      throw new Error(`Invalid amount: ${amount}`);
    }
  }
  
  /**
   * Common Base network token decimals (for reference)
   */
  static KNOWN_DECIMALS = {
    // Standard ERC-20 (18 decimals)
    'VIRTUAL': 18,
    'TRUST': 18,
    'VADER': 18,
    'ETH': 18,
    'WETH': 18,
    
    // Stablecoins (6 decimals)
    'USDC': 6,
    'USDT': 6,
    
    // Bitcoin (8 decimals)
    'WBTC': 8,
    'BTC': 8
  };
  
  /**
   * Get expected decimals for known tokens
   * @param {string} symbol - Token symbol
   * @returns {number} Expected decimals or 18 as default
   */
  static getExpectedDecimals(symbol) {
    return this.KNOWN_DECIMALS[symbol.toUpperCase()] || 18;
  }
  
  /**
   * Clear metadata cache
   */
  static clearCache() {
    this.cache.clear();
    log(`🗑️ Token metadata cache cleared`);
  }
  
  /**
   * Get cache statistics
   */
  static getCacheStats() {
    return {
      entries: this.cache.size,
      tokens: Array.from(this.cache.keys()).map(key => key.split('-')[0])
    };
  }
}

/**
 * User Questions Answered:
 * 
 * Q: Do we need token name and decimals? All tokens are ERC-20 on Base, so default decimals is 18, right?
 * A: MOSTLY correct, but:
 *    - Decimals: Most are 18, but USDC=6, USDT=6, WBTC=8, etc. We should check for accuracy.
 *    - Name: Not critical for swaps, mainly for display/logging. Can be skipped to save RPC calls.
 * 
 * Q: Did we have token name before this step?
 * A: Yes, we were fetching it in tokenInfoResolver.js, but it's not essential for trading.
 * 
 * This service provides:
 * - getMinimalMetadata() - Just symbol + decimals (saves RPC calls)
 * - getFullMetadata() - Includes name for display
 * - Smart caching to reduce repeated calls
 * - Non-standard decimal detection and warnings
 */ 