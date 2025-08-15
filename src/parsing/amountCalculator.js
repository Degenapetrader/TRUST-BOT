import { ethers } from 'ethers';

/**
 * AmountCalculator - Handles automatic amount calculations for trading
 */
export class AmountCalculator {
  /**
   * Calculate auto amount for a wallet based on currency type
   * @param {Object} params - Calculation parameters
   * @returns {Object} Calculated amount details
   */
  static async calculateAmount(params) {
    const {
      wallet,
      currencyInfo,
      settings,
      provider,
      customSettings = {}
    } = params;
    
    // Merge settings with custom settings
    const finalSettings = { ...settings, ...customSettings };
    
    // Get balance based on currency type
    const balanceInfo = await this.getBalance(wallet, currencyInfo, provider);
    
    // Calculate random percentage
    const minPercent = finalSettings.VIRTUAL_AMOUNT_MIN_PERCENT || 10;
    const maxPercent = finalSettings.VIRTUAL_AMOUNT_MAX_PERCENT || 30;
    const randomPercent = minPercent + Math.random() * (maxPercent - minPercent);
    
    // Calculate amount
    const amount = balanceInfo.formatted * (randomPercent / 100);
    
    return {
      amount,
      randomPercent,
      balance: balanceInfo.formatted,
      balanceWei: balanceInfo.wei.toString(),
      currencySymbol: currencyInfo.symbol || 'TOKEN'
    };
  }
  
  /**
   * Get balance for different currency types
   * @private
   */
  static async getBalance(wallet, currencyInfo, provider) {
    if (currencyInfo.isVirtual) {
      return await this.getTokenBalance(
        wallet,
        currencyInfo.address,
        18,
        provider
      );
    } else if (currencyInfo.isEth) {
      return await this.getEthBalance(wallet, provider);
    } else {
      return await this.getTokenBalance(
        wallet,
        currencyInfo.address,
        currencyInfo.decimals || 18,
        provider
      );
    }
  }
  
  /**
   * Get ETH balance
   * @private
   */
  static async getEthBalance(wallet, provider) {
    const balance = await provider.getBalance(wallet.address);
    
    return {
      wei: balance,
      formatted: parseFloat(ethers.formatEther(balance))
    };
  }
  
  /**
   * Get token balance
   * @private
   */
  static async getTokenBalance(wallet, tokenAddress, decimals, provider) {
    const contract = new ethers.Contract(
      tokenAddress,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );
    
    const balance = await contract.balanceOf(wallet.address);
    
    return {
      wei: balance,
      formatted: parseFloat(ethers.formatUnits(balance, decimals))
    };
  }
  
  /**
   * Calculate amounts for multiple wallets
   * @param {Object} params - Calculation parameters
   * @returns {Array} Array of calculated amounts
   */
  static async calculateMultipleAmounts(params) {
    const {
      wallets,
      currencyInfo,
      settings,
      provider,
      customSettings = {}
    } = params;
    
    const calculations = await Promise.all(
      wallets.map(wallet => 
        this.calculateAmount({
          wallet,
          currencyInfo,
          settings,
          provider,
          customSettings
        })
      )
    );
    
    // Add wallet index to results
    return calculations.map((calc, index) => ({
      ...calc,
      walletIndex: index,
      walletAddress: wallets[index].address
    }));
  }
  
  /**
   * Calculate percentage-based amount
   * @param {number} balance - Current balance
   * @param {number} percentage - Percentage to calculate
   * @returns {number} Calculated amount
   */
  static calculatePercentageAmount(balance, percentage) {
    return balance * (percentage / 100);
  }
  
  /**
   * Calculate fixed amount with balance check
   * @param {number} balance - Current balance
   * @param {number} requestedAmount - Requested amount
   * @param {Object} options - Calculation options
   * @returns {Object} Calculation result
   */
  static calculateFixedAmount(balance, requestedAmount, options = {}) {
    const {
      minBalance = 0,
      maxPercent = 100,
      allowOverBalance = false
    } = options;
    
    // Check if balance is sufficient
    if (balance < minBalance) {
      return {
        success: false,
        error: 'Insufficient balance',
        balance,
        minRequired: minBalance
      };
    }
    
    // Check if requested amount exceeds balance
    if (requestedAmount > balance && !allowOverBalance) {
      return {
        success: false,
        error: 'Amount exceeds balance',
        balance,
        requested: requestedAmount
      };
    }
    
    // Check if amount exceeds max percentage
    const percentOfBalance = (requestedAmount / balance) * 100;
    if (percentOfBalance > maxPercent) {
      return {
        success: false,
        error: `Amount exceeds ${maxPercent}% of balance`,
        balance,
        requested: requestedAmount,
        maxAmount: this.calculatePercentageAmount(balance, maxPercent)
      };
    }
    
    return {
      success: true,
      amount: Math.min(requestedAmount, balance),
      balance,
      percentOfBalance
    };
  }
  
  /**
   * Format amount for display
   * @param {number} amount - Amount to format
   * @param {Object} options - Formatting options
   * @returns {string} Formatted amount
   */
  static formatAmount(amount, options = {}) {
    const {
      decimals = 6,
      symbol = '',
      includeCommas = true
    } = options;
    
    let formatted = amount.toFixed(decimals);
    
    if (includeCommas) {
      const parts = formatted.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      formatted = parts.join('.');
    }
    
    return symbol ? `${formatted} ${symbol}` : formatted;
  }
} 