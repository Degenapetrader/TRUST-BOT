/**
 * Market Making Tracker Service
 * Tracks buy/sell history and manages position tracking
 */

/**
 * MMTracker - Tracks market making positions and history
 */
export class MMTracker {
  constructor(mode = 'normal') {
    this.mode = mode; // normal, bullish, bearish
    this.positions = new Map(); // wallet.address -> position data
    this.tradeHistory = [];
    this.statistics = {
      totalBuys: 0,
      totalSells: 0,
      totalVolume: 0,
      successfulLoops: 0,
      failedTransactions: 0
    };
  }
  
  /**
   * Initialize position for a wallet
   * @param {string} walletAddress - Wallet address
   */
  initializeWallet(walletAddress) {
    if (!this.positions.has(walletAddress)) {
      this.positions.set(walletAddress, {
        buyHistory: [],
        sellHistory: [],
        pendingBuy: null,
        pendingSell: null,
        lastAction: null,
        fixedAmount: null
      });
    }
  }
  
  /**
   * Track a buy transaction
   * @param {string} walletAddress - Wallet address
   * @param {number} virtualSpent - VIRTUAL amount spent
   * @param {number} tokensReceived - Tokens received
   * @param {Object} metadata - Additional transaction data
   */
  trackBuy(walletAddress, virtualSpent, tokensReceived, metadata = {}) {
    this.initializeWallet(walletAddress);
    const position = this.positions.get(walletAddress);
    
    const buyRecord = {
      timestamp: Date.now(),
      virtualSpent,
      tokensReceived,
      price: virtualSpent / tokensReceived,
      txHash: metadata.txHash,
      blockNumber: metadata.blockNumber
    };
    
    // Mode-specific tracking
    if (this.mode === 'bullish') {
      // Track token amounts for future sells
      position.buyHistory.push(tokensReceived);
      if (!position.fixedAmount) {
        position.fixedAmount = virtualSpent; // Store fixed VIRTUAL amount
      }
    } else if (this.mode === 'normal') {
      // LIFO tracking
      position.buyHistory.push(tokensReceived);
    }
    
    position.lastAction = 'buy';
    this.statistics.totalBuys++;
    this.statistics.totalVolume += virtualSpent;
    
    this.tradeHistory.push({
      type: 'buy',
      walletAddress,
      ...buyRecord
    });
    
    return buyRecord;
  }
  
  /**
   * Track a sell transaction
   * @param {string} walletAddress - Wallet address
   * @param {number} tokensSold - Tokens sold
   * @param {number} virtualReceived - VIRTUAL received
   * @param {Object} metadata - Additional transaction data
   */
  trackSell(walletAddress, tokensSold, virtualReceived, metadata = {}) {
    this.initializeWallet(walletAddress);
    const position = this.positions.get(walletAddress);
    
    const sellRecord = {
      timestamp: Date.now(),
      tokensSold,
      virtualReceived,
      price: virtualReceived / tokensSold,
      txHash: metadata.txHash,
      blockNumber: metadata.blockNumber
    };
    
    // Mode-specific tracking
    if (this.mode === 'bearish') {
      // Track VIRTUAL amounts for future buys
      position.sellHistory.push(virtualReceived);
      if (!position.fixedAmount) {
        position.fixedAmount = tokensSold; // Store fixed token amount
      }
    } else if (this.mode === 'bullish' || this.mode === 'normal') {
      // Remove from buy history (LIFO)
      if (position.buyHistory.length > 0) {
        position.buyHistory.pop();
      }
    }
    
    position.lastAction = 'sell';
    this.statistics.totalSells++;
    
    this.tradeHistory.push({
      type: 'sell',
      walletAddress,
      ...sellRecord
    });
    
    // Check if a loop is completed
    if (position.lastAction === 'buy' && this.statistics.totalBuys === this.statistics.totalSells) {
      this.statistics.successfulLoops++;
    }
    
    return sellRecord;
  }
  
  /**
   * Get next action for wallet based on mode and history
   * @param {string} walletAddress - Wallet address
   * @returns {Object} Next action recommendation
   */
  getNextAction(walletAddress) {
    this.initializeWallet(walletAddress);
    const position = this.positions.get(walletAddress);
    
    if (this.mode === 'normal') {
      // Normal mode: Can buy if no position, can sell if has position
      return {
        canBuy: true,
        canSell: position.buyHistory.length > 0,
        sellAmount: position.buyHistory[position.buyHistory.length - 1] || null
      };
    } else if (this.mode === 'bullish') {
      // Bullish mode: Always buy with fixed amount, sell tracked amounts
      return {
        canBuy: true,
        canSell: position.buyHistory.length > 0,
        buyAmount: position.fixedAmount,
        sellAmount: position.buyHistory[position.buyHistory.length - 1] || null
      };
    } else if (this.mode === 'bearish') {
      // Bearish mode: Sell fixed amount, buy back with tracked VIRTUAL
      return {
        canBuy: position.sellHistory.length > 0,
        canSell: true,
        buyAmount: position.sellHistory[position.sellHistory.length - 1] || null,
        sellAmount: position.fixedAmount
      };
    }
  }
  
  /**
   * Track failed transaction
   * @param {string} walletAddress - Wallet address
   * @param {string} action - 'buy' or 'sell'
   * @param {string} reason - Failure reason
   */
  trackFailure(walletAddress, action, reason) {
    this.statistics.failedTransactions++;
    
    this.tradeHistory.push({
      type: 'failed',
      action,
      walletAddress,
      reason,
      timestamp: Date.now()
    });
  }
  
  /**
   * Get position summary for a wallet
   * @param {string} walletAddress - Wallet address
   * @returns {Object} Position summary
   */
  getWalletPosition(walletAddress) {
    this.initializeWallet(walletAddress);
    const position = this.positions.get(walletAddress);
    
    return {
      mode: this.mode,
      buyHistory: [...position.buyHistory],
      sellHistory: [...position.sellHistory],
      pendingTokens: position.buyHistory.reduce((sum, amount) => sum + amount, 0),
      lastAction: position.lastAction,
      fixedAmount: position.fixedAmount
    };
  }
  
  /**
   * Get overall statistics
   * @returns {Object} Trading statistics
   */
  getStatistics() {
    return {
      ...this.statistics,
      successRate: this.statistics.totalBuys > 0 
        ? ((this.statistics.totalBuys - this.statistics.failedTransactions) / this.statistics.totalBuys * 100).toFixed(2) + '%'
        : '0%',
      avgLoopCompletion: this.statistics.totalBuys > 0
        ? (this.statistics.successfulLoops / Math.floor(this.statistics.totalBuys / 2) * 100).toFixed(2) + '%'
        : '0%'
    };
  }
  
  /**
   * Display summary
   */
  displaySummary() {
    console.log('\n📊 MARKET MAKING SUMMARY');
    console.log('========================');
    console.log(`🎯 Mode: ${this.mode.toUpperCase()}`);
    console.log(`📊 Total Buys: ${this.statistics.totalBuys}`);
    console.log(`📊 Total Sells: ${this.statistics.totalSells}`);
    console.log(`💰 Total Volume: ${this.statistics.totalVolume.toFixed(4)} VIRTUAL`);
    console.log(`✅ Successful Loops: ${this.statistics.successfulLoops}`);
    console.log(`❌ Failed Transactions: ${this.statistics.failedTransactions}`);
    
    // Show position summaries
    console.log('\n👛 WALLET POSITIONS:');
    for (const [address, position] of this.positions) {
      const shortAddress = address.slice(0, 8) + '...';
      const pendingTokens = position.buyHistory.reduce((sum, amount) => sum + amount, 0);
      console.log(`${shortAddress}: ${pendingTokens.toFixed(4)} tokens pending, last action: ${position.lastAction || 'none'}`);
    }
  }
  
  /**
   * Reset tracker
   */
  reset() {
    this.positions.clear();
    this.tradeHistory = [];
    this.statistics = {
      totalBuys: 0,
      totalSells: 0,
      totalVolume: 0,
      successfulLoops: 0,
      failedTransactions: 0
    };
  }
} 