/**
 * Price Monitor Service
 * Monitors token prices and determines buy/sell signals for market making
 */

import { ethers } from 'ethers';
import { provider } from '../../config.js';

/**
 * PriceMonitor - Handles price monitoring and threshold calculations
 */
export class PriceMonitor {
  constructor(tokenInfo, virtualCA) {
    this.tokenInfo = tokenInfo;
    this.virtualCA = virtualCA;
    this.basePrice = null;
    this.buyThreshold = null;
    this.sellThreshold = null;
  }
  
  /**
   * Get current price from pool reserves
   * @returns {number} Current price in VIRTUAL per token
   */
  async getCurrentPrice() {
    if (!this.tokenInfo.poolAddress) {
      throw new Error('No pool address available for price monitoring');
    }
    
    const pairContract = new ethers.Contract(
      this.tokenInfo.poolAddress,
      [
        'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
        'function token0() external view returns (address)',
        'function token1() external view returns (address)'
      ],
      provider
    );
    
    const [reserves, token0, token1] = await Promise.all([
      pairContract.getReserves(),
      pairContract.token0(),
      pairContract.token1()
    ]);
    
    const virtualIsToken0 = token0.toLowerCase() === this.virtualCA.toLowerCase();
    const virtualReserve = virtualIsToken0 ? reserves[0] : reserves[1];
    const tokenReserve = virtualIsToken0 ? reserves[1] : reserves[0];
    
    const virtualFormatted = parseFloat(ethers.formatUnits(virtualReserve, 18));
    const tokenFormatted = parseFloat(ethers.formatUnits(tokenReserve, this.tokenInfo.decimals));
    
    return virtualFormatted / tokenFormatted;
  }
  
  /**
   * Initialize base price and thresholds
   * @param {number} buyRangePercent - Buy threshold percentage below base
   * @param {number} sellRangePercent - Sell threshold percentage above base
   */
  async initializeThresholds(buyRangePercent, sellRangePercent) {
    this.basePrice = await this.getCurrentPrice();
    this.updateThresholds(buyRangePercent, sellRangePercent);
    
    return {
      basePrice: this.basePrice,
      buyThreshold: this.buyThreshold,
      sellThreshold: this.sellThreshold
    };
  }
  
  /**
   * Update thresholds based on current base price
   * @param {number} buyRangePercent - Buy threshold percentage
   * @param {number} sellRangePercent - Sell threshold percentage
   */
  updateThresholds(buyRangePercent, sellRangePercent) {
    this.buyThreshold = this.basePrice * (1 - buyRangePercent / 100);
    this.sellThreshold = this.basePrice * (1 + sellRangePercent / 100);
  }
  
  /**
   * Update base price (for CHASE mode or after trades)
   * @param {number} newBasePrice - New base price
   * @param {number} buyRangePercent - Buy threshold percentage
   * @param {number} sellRangePercent - Sell threshold percentage
   */
  updateBasePrice(newBasePrice, buyRangePercent, sellRangePercent) {
    const oldBasePrice = this.basePrice;
    this.basePrice = newBasePrice;
    this.updateThresholds(buyRangePercent, sellRangePercent);
    
    return {
      oldBasePrice,
      newBasePrice,
      changePercent: ((newBasePrice - oldBasePrice) / oldBasePrice * 100).toFixed(3)
    };
  }
  
  /**
   * Check current price and determine action
   * @returns {Object} Action recommendation
   */
  async checkPriceAction() {
    const currentPrice = await this.getCurrentPrice();
    
    // Determine action
    if (currentPrice <= this.buyThreshold) {
      return {
        action: 'buy',
        currentPrice,
        threshold: this.buyThreshold,
        percentBelow: ((this.buyThreshold - currentPrice) / this.buyThreshold * 100).toFixed(2)
      };
    } else if (currentPrice >= this.sellThreshold) {
      return {
        action: 'sell',
        currentPrice,
        threshold: this.sellThreshold,
        percentAbove: ((currentPrice - this.sellThreshold) / this.sellThreshold * 100).toFixed(2)
      };
    }
    
    return {
      action: 'hold',
      currentPrice,
      buyThreshold: this.buyThreshold,
      sellThreshold: this.sellThreshold,
      positionInRange: ((currentPrice - this.buyThreshold) / (this.sellThreshold - this.buyThreshold) * 100).toFixed(1)
    };
  }
  
  /**
   * Format price for display
   * @param {number} price - Price to format
   * @returns {string} Formatted price
   */
  formatPrice(price) {
    return price.toFixed(8);
  }
  
  /**
   * Get current state summary
   * @returns {Object} Current price monitor state
   */
  getState() {
    return {
      tokenSymbol: this.tokenInfo.symbol,
      basePrice: this.basePrice,
      buyThreshold: this.buyThreshold,
      sellThreshold: this.sellThreshold,
      spread: this.sellThreshold - this.buyThreshold,
      spreadPercent: ((this.sellThreshold - this.buyThreshold) / this.basePrice * 100).toFixed(2)
    };
  }
} 