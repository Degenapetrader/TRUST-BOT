// Token blacklist service

import { BLACKLISTED_TOKENS } from '../config/jeetConstants.js';

export class TokenBlacklist {
  /**
   * Check if a token is blacklisted by address or ticker
   * @param {string} tokenAddress - Token contract address
   * @param {string} [ticker] - Optional ticker symbol
   * @returns {boolean} True if blacklisted
   */
  static isTokenBlacklisted(tokenAddress, ticker = null) {
    // Check by address first (case-insensitive)
    if (tokenAddress && BLACKLISTED_TOKENS.addresses.includes(tokenAddress.toLowerCase())) {
      return true;
    }
    
    // Check by ticker if provided (case-insensitive)
    if (ticker && BLACKLISTED_TOKENS.tickers.includes(ticker.toUpperCase())) {
      return true;
    }
    
    return false;
  }

  /**
   * Get blacklist reason for a token
   * @param {string} tokenAddress - Token contract address
   * @param {string} [ticker] - Optional ticker symbol
   * @returns {{isBlacklisted: boolean, reason: string|null}} Blacklist status and reason
   */
  static getBlacklistStatus(tokenAddress, ticker = null) {
    if (tokenAddress && BLACKLISTED_TOKENS.addresses.includes(tokenAddress.toLowerCase())) {
      return {
        isBlacklisted: true,
        reason: `address ${tokenAddress}`
      };
    }
    
    if (ticker && BLACKLISTED_TOKENS.tickers.includes(ticker.toUpperCase())) {
      return {
        isBlacklisted: true,
        reason: `ticker ${ticker}`
      };
    }
    
    return {
      isBlacklisted: false,
      reason: null
    };
  }

  /**
   * Log blacklist warning
   * @param {string} tokenAddress - Token contract address
   * @param {string} [ticker] - Optional ticker symbol
   * @param {Function} logger - Logger function to use
   */
  static logBlacklistWarning(tokenAddress, ticker, logger = console.log) {
    const status = this.getBlacklistStatus(tokenAddress, ticker);
    
    if (status.isBlacklisted) {
      logger(`\n🚫 ==================== BLACKLISTED TOKEN DETECTED ====================`);
      logger(`❌ OPERATION BLOCKED: This token is on the HARDCODED BLACKLIST`);
      logger(`🔒 Blacklisted ${status.reason}`);
      logger(`⚠️  JEETBOT WILL NOT SELL BLACKLISTED TOKENS FOR SAFETY`);
      logger(`💡 If you need to sell this token, please use sellbot directly`);
      logger(`🚫 ===================================================================`);
    }
  }

  /**
   * Get all blacklisted addresses
   * @returns {string[]} Array of blacklisted addresses
   */
  static getBlacklistedAddresses() {
    return [...BLACKLISTED_TOKENS.addresses];
  }

  /**
   * Get all blacklisted tickers
   * @returns {string[]} Array of blacklisted tickers
   */
  static getBlacklistedTickers() {
    return [...BLACKLISTED_TOKENS.tickers];
  }
} 