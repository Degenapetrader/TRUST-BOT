/**
 * FarmBot Calculator Service
 * Calculates farming amounts and handles randomization
 */

import { ethers } from 'ethers';

export class FarmCalculator {
  /**
   * Create a new FarmCalculator instance
   * @param {Object} settings - Farm settings
   */
  constructor(settings) {
    this.settings = settings;
  }
  
  /**
   * Calculate VIRTUAL amount per wallet - each wallet gets the full specified amount
   * @param {number} totalAmount - Amount per wallet specified by user
   * @param {number} walletCount - Number of wallets
   * @returns {ethers.BigNumber} Amount per wallet in wei
   */
  calculateAmountPerWallet(totalAmount, walletCount) {
    if (walletCount === 0) {
      throw new Error('No wallets selected');
    }
    
    // Each wallet gets the full amount specified (not divided)
    const amountPerWallet = ethers.parseEther(totalAmount.toString());
    const totalRequired = amountPerWallet * BigInt(walletCount);
    
    console.log(`💰 Amount Distribution:`);
    console.log(`  • Amount Per Wallet: ${totalAmount} VIRTUAL (±10% randomization)`);
    console.log(`  • Number of Wallets: ${walletCount}`);
    console.log(`  • Total Required: ${ethers.formatEther(totalRequired)} VIRTUAL`);
    
    return amountPerWallet;
  }
  
  /**
   * Apply randomization to amount if needed
   * @param {ethers.BigNumber} baseAmount - Base amount
   * @param {boolean} enableRandomization - Whether to randomize
   * @returns {ethers.BigNumber} Potentially randomized amount
   */
  applyAmountRandomization(baseAmount, enableRandomization = false) {
    if (!enableRandomization) {
      return baseAmount;
    }
    
    // Apply randomization between min and max percent
    const minPercent = this.settings.VIRTUAL_AMOUNT_MIN_PERCENT;
    const maxPercent = this.settings.VIRTUAL_AMOUNT_MAX_PERCENT;
    
    const randomPercent = Math.random() * (maxPercent - minPercent) + minPercent;
    const randomizedAmount = baseAmount * BigInt(Math.floor(randomPercent * 100)) / 100n;
    
    return randomizedAmount;
  }
  
  /**
   * Calculate total required VIRTUAL for all wallets and loops
   * @param {ethers.BigNumber} amountPerWallet - Amount per wallet
   * @param {number} walletCount - Number of wallets
   * @param {number} loops - Number of loops
   * @returns {Object} Calculation summary
   */
  calculateTotalRequirements(amountPerWallet, walletCount, loops) {
    const totalPerWallet = amountPerWallet; // Loops reuse same balance
    const grandTotal = totalPerWallet * BigInt(walletCount);
    
    return {
      amountPerLoop: ethers.formatEther(amountPerWallet),
      totalPerWallet: ethers.formatEther(totalPerWallet),
      grandTotal: ethers.formatEther(grandTotal),
      walletCount,
      loops,
      summary: `${walletCount} wallets × ${ethers.formatEther(amountPerWallet)} VIRTUAL (${loops} loops reuse same balance) = ${ethers.formatEther(grandTotal)} VIRTUAL total`
    };
  }
  
  /**
   * Calculate slippage amount
   * @param {ethers.BigNumber} amount - Base amount
   * @param {number} slippagePercent - Slippage percentage
   * @returns {ethers.BigNumber} Amount after slippage
   */
  calculateSlippage(amount, slippagePercent = null) {
    const slippage = slippagePercent || this.settings.MAX_SLIPPAGE_PERCENT;
    const slippageAmount = amount * BigInt(slippage) / 100n;
    const amountAfterSlippage = amount - slippageAmount;
    
    return {
      originalAmount: amount,
      slippagePercent: slippage,
      slippageAmount,
      amountAfterSlippage,
      minAmountOut: amountAfterSlippage
    };
  }
  
  /**
   * Calculate timing delays
   * @returns {Object} Timing configuration
   */
  calculateTimings() {
    return {
      loopDelayMin: this.settings.LOOP_DELAY_MIN,
      loopDelayMax: this.settings.LOOP_DELAY_MAX,
      txDelayMin: this.settings.DELAY_BETWEEN_TXS_MIN,
      txDelayMax: this.settings.DELAY_BETWEEN_TXS_MAX,
      estimatedTimePerLoop: (
        (this.settings.LOOP_DELAY_MIN + this.settings.LOOP_DELAY_MAX) / 2 +
        (this.settings.DELAY_BETWEEN_TXS_MIN + this.settings.DELAY_BETWEEN_TXS_MAX) / 2 +
        10 // Estimated transaction time
      )
    };
  }
  
  /**
   * Get a summary of the farming plan
   * @param {Object} params - Farming parameters
   * @returns {Object} Farming plan summary
   */
  getFarmingPlan(params) {
    const { wallets, amount, loops, tokenInfo } = params;
    
    const amountPerWallet = this.calculateAmountPerWallet(amount, wallets.length);
    const requirements = this.calculateTotalRequirements(amountPerWallet, wallets.length, loops);
    const timings = this.calculateTimings();
    const estimatedTotalTime = timings.estimatedTimePerLoop * loops * wallets.length;
    
    return {
      token: {
        symbol: tokenInfo.symbol || 'Unknown',
        address: tokenInfo.address,
        decimals: tokenInfo.decimals || 18
      },
      wallets: wallets.map(w => ({
        name: w.name,
        address: w.address
      })),
      amounts: requirements,
      timing: {
        ...timings,
        estimatedTotalTime: `${Math.ceil(estimatedTotalTime / 60)} minutes`
      },
      settings: {
        slippage: `${this.settings.MAX_SLIPPAGE_PERCENT}%`,
        gasPrice: this.settings.GAS_PRICE,
        gasLimit: this.settings.GAS_LIMIT
      }
    };
  }
} 