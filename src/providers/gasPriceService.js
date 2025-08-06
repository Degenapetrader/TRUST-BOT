/**
 * Gas Price Service using Alchemy API for Base Network
 * Provides dynamic gas price estimation with 30% priority fee
 */
import { ethers } from 'ethers';
import { providerManager } from './manager.js';
import { TRANSACTION_CONFIG } from '../config/constants.js';

export class GasPriceService {
  constructor() {
    this.cachedGasPrice = null;
    this.cacheTimestamp = 0;
    this.cacheValidityMs = 60000; // 60 seconds cache - only update when needed
    this.fallbackGasPrice = '0.02'; // fallback gas price in gwei
    this.priorityFeePercentage = 50; // 50% priority fee to match gas helper
    this.gasMultiplier = 2; // 2x multiplier for all bots (JeetBot will be handled separately)
  }

  /**
   * Get current gas price from Alchemy with 50% priority fee and 2x multiplier
   * @returns {Promise<{gasPrice: string, priorityFee: string, totalGasFee: string}>} Gas price data in gwei
   */
  async getCurrentGasPrice() {
    try {
      // Return cached price if still valid
      if (this.cachedGasPrice && (Date.now() - this.cacheTimestamp) < this.cacheValidityMs) {
        return this.cachedGasPrice;
      }

      // Get gas price from Alchemy
      const alchemyConfig = providerManager.getAlchemyConfig();
      if (!alchemyConfig.available) {
        console.log('⚠️ Alchemy not available, using fallback gas price');
        return this._getFallbackGasPrice();
      }

      const baseGasPrice = await this._fetchAlchemyGasPrice(alchemyConfig);
      
      // Apply 2x multiplier to base gas price
      const multipliedGasPrice = (parseFloat(baseGasPrice) * this.gasMultiplier).toFixed(6);
      
      // Calculate priority fee (50% of multiplied gas price)
      const priorityFee = (parseFloat(multipliedGasPrice) * this.priorityFeePercentage / 100).toFixed(6);
      const totalGasFee = (parseFloat(multipliedGasPrice) + parseFloat(priorityFee)).toFixed(6);

      const result = {
        gasPrice: multipliedGasPrice,
        priorityFee: priorityFee,
        totalGasFee: totalGasFee,
        baseGasPrice: baseGasPrice, // Keep original for logging
        source: 'Alchemy',
        timestamp: Date.now()
      };

      // Cache the result
      this.cachedGasPrice = result;
      this.cacheTimestamp = Date.now();

      console.log(`⛽ Alchemy Gas: ${baseGasPrice} gwei × ${this.gasMultiplier} = ${multipliedGasPrice} gwei + ${priorityFee} gwei priority (${this.priorityFeePercentage}%) = ${totalGasFee} gwei total`);
      return result;

    } catch (error) {
      console.log(`❌ Gas price estimation failed: ${error.message}`);
      return this._getFallbackGasPrice();
    }
  }

  /**
   * Get gas price parameters for ethers transactions
   * @returns {Promise<{maxFeePerGas: BigInt, maxPriorityFeePerGas: BigInt}>} Gas parameters
   */
  async getGasParams() {
    const gasPriceData = await this.getCurrentGasPrice();
    
    return {
      maxFeePerGas: ethers.parseUnits(gasPriceData.totalGasFee, 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits(gasPriceData.priorityFee, 'gwei')
    };
  }

  /**
   * Get gas price for legacy transactions (gasPrice field)
   * @returns {Promise<BigInt>} Gas price in wei
   */
  async getLegacyGasPrice() {
    const gasPriceData = await this.getCurrentGasPrice();
    return ethers.parseUnits(gasPriceData.totalGasFee, 'gwei');
  }

  /**
   * Fetch gas price from Alchemy API
   * @private
   * @param {Object} alchemyConfig - Alchemy configuration
   * @returns {Promise<string>} Gas price in gwei
   */
  async _fetchAlchemyGasPrice(alchemyConfig) {
    try {
      // Method 1: Try eth_gasPrice first (most reliable)
      const provider = providerManager.getPrimaryProvider();
      const gasPriceWei = await provider.getGasPrice();
      const gasPriceGwei = ethers.formatUnits(gasPriceWei, 'gwei');
      
      console.log(`📊 Alchemy eth_gasPrice: ${gasPriceGwei} gwei`);
      return parseFloat(gasPriceGwei).toFixed(6);
      
    } catch (error) {
      console.log(`⚠️ eth_gasPrice failed: ${error.message}`);
      
      try {
        // Method 2: Try eth_feeHistory for EIP-1559
        const provider = providerManager.getPrimaryProvider();
        const feeData = await provider.getFeeData();
        
        if (feeData.gasPrice) {
          const gasPriceGwei = ethers.formatUnits(feeData.gasPrice, 'gwei');
          console.log(`📊 Alchemy feeData.gasPrice: ${gasPriceGwei} gwei`);
          return parseFloat(gasPriceGwei).toFixed(6);
        }
        
        // Use base fee if available
        if (feeData.maxFeePerGas) {
          const gasPriceGwei = ethers.formatUnits(feeData.maxFeePerGas, 'gwei');
          console.log(`📊 Alchemy feeData.maxFeePerGas: ${gasPriceGwei} gwei`);
          return parseFloat(gasPriceGwei).toFixed(6);
        }
        
      } catch (feeError) {
        console.log(`⚠️ feeData failed: ${feeError.message}`);
      }
      
      throw new Error('All Alchemy gas price methods failed');
    }
  }

  /**
   * Get fallback gas price with 2x multiplier and 50% priority fee
   * @returns {Object} Fallback gas price data
   * @private
   */
  _getFallbackGasPrice() {
    // Apply 2x multiplier to fallback gas price
    const multipliedFallback = (parseFloat(this.fallbackGasPrice) * this.gasMultiplier).toFixed(6);
    
    // Calculate priority fee (50% of multiplied fallback)
    const priorityFee = (parseFloat(multipliedFallback) * this.priorityFeePercentage / 100).toFixed(6);
    const totalGasFee = (parseFloat(multipliedFallback) + parseFloat(priorityFee)).toFixed(6);

    console.log(`⛽ Fallback Gas: ${this.fallbackGasPrice} gwei × ${this.gasMultiplier} = ${multipliedFallback} gwei + ${priorityFee} gwei priority (${this.priorityFeePercentage}%) = ${totalGasFee} gwei total`);
    
    return {
      gasPrice: multipliedFallback,
      priorityFee: priorityFee,
      totalGasFee: totalGasFee,
      baseGasPrice: this.fallbackGasPrice, // Keep original for logging
      source: 'Fallback',
      timestamp: Date.now()
    };
  }

  /**
   * Get current gas price with custom multiplier and 50% priority fee
   * @param {number} multiplier - Gas multiplier (1x for JeetBot, 2x for others)
   * @returns {Promise<{gasPrice: string, priorityFee: string, totalGasFee: string}>} Gas price data in gwei
   */
  async getCurrentGasPriceWithMultiplier(multiplier = 2) {
    try {
      // Return cached price if still valid and multiplier matches
      if (this.cachedGasPrice && (Date.now() - this.cacheTimestamp) < this.cacheValidityMs && this.cachedGasPrice.multiplier === multiplier) {
        return this.cachedGasPrice;
      }

      // Get gas price from Alchemy
      const alchemyConfig = providerManager.getAlchemyConfig();
      if (!alchemyConfig.available) {
        console.log('⚠️ Alchemy not available, using fallback gas price');
        return this._getFallbackGasPriceWithMultiplier(multiplier);
      }

      const baseGasPrice = await this._fetchAlchemyGasPrice(alchemyConfig);
      
      // Apply custom multiplier to base gas price
      const multipliedGasPrice = (parseFloat(baseGasPrice) * multiplier).toFixed(6);
      
      // Calculate priority fee (50% of multiplied gas price)
      const priorityFee = (parseFloat(multipliedGasPrice) * this.priorityFeePercentage / 100).toFixed(6);
      const totalGasFee = (parseFloat(multipliedGasPrice) + parseFloat(priorityFee)).toFixed(6);

      const result = {
        gasPrice: multipliedGasPrice,
        priorityFee: priorityFee,
        totalGasFee: totalGasFee,
        baseGasPrice: baseGasPrice, // Keep original for logging
        multiplier: multiplier, // Store multiplier for cache validation
        source: 'Alchemy',
        timestamp: Date.now()
      };

      // Cache the result
      this.cachedGasPrice = result;
      this.cacheTimestamp = Date.now();

      console.log(`⛽ Alchemy Gas: ${baseGasPrice} gwei × ${multiplier} = ${multipliedGasPrice} gwei + ${priorityFee} gwei priority (${this.priorityFeePercentage}%) = ${totalGasFee} gwei total`);
      return result;

    } catch (error) {
      console.log(`❌ Gas price estimation failed: ${error.message}`);
      return this._getFallbackGasPriceWithMultiplier(multiplier);
    }
  }

  /**
   * Get fallback gas price with custom multiplier and 50% priority fee
   * @param {number} multiplier - Gas multiplier (1x for JeetBot, 2x for others)
   * @returns {Object} Fallback gas price data
   * @private
   */
  _getFallbackGasPriceWithMultiplier(multiplier) {
    // Apply custom multiplier to fallback gas price
    const multipliedFallback = (parseFloat(this.fallbackGasPrice) * multiplier).toFixed(6);
    
    // Calculate priority fee (50% of multiplied fallback)
    const priorityFee = (parseFloat(multipliedFallback) * this.priorityFeePercentage / 100).toFixed(6);
    const totalGasFee = (parseFloat(multipliedFallback) + parseFloat(priorityFee)).toFixed(6);

    console.log(`⛽ Fallback Gas: ${this.fallbackGasPrice} gwei × ${multiplier} = ${multipliedFallback} gwei + ${priorityFee} gwei priority (${this.priorityFeePercentage}%) = ${totalGasFee} gwei total`);
    
    return {
      gasPrice: multipliedFallback,
      priorityFee: priorityFee,
      totalGasFee: totalGasFee,
      baseGasPrice: this.fallbackGasPrice, // Keep original for logging
      multiplier: multiplier, // Store multiplier for cache validation
      source: 'Fallback',
      timestamp: Date.now()
    };
  }

  /**
   * Clear gas price cache
   */
  clearCache() {
    this.cachedGasPrice = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Get gas price for display in GUI
   * @returns {Promise<string>} Total gas price in gwei for display
   */
  async getDisplayGasPrice() {
    const gasPriceData = await this.getCurrentGasPrice();
    return gasPriceData.totalGasFee;
  }

  /**
   * Get detailed gas price breakdown for logging
   * @returns {Promise<Object>} Detailed gas price information
   */
  async getGasPriceBreakdown() {
    const gasPriceData = await this.getCurrentGasPrice();
    return {
      baseGasPrice: gasPriceData.baseGasPrice,
      priorityFee: gasPriceData.priorityFee,
      totalGasPrice: gasPriceData.totalGasFee,
      source: gasPriceData.source,
      priorityPercentage: this.priorityFeePercentage
    };
  }
}

// Create singleton instance
export const gasPriceService = new GasPriceService(); 