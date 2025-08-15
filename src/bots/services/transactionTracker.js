/**
 * Transaction Tracker Service
 * Tracks and summarizes trading transactions
 */

/**
 * TransactionTracker - Tracks trading transactions and provides summaries
 */
export class TransactionTracker {
  constructor() {
    this.walletTotals = new Map();
    this.transactions = [];
  }

  /**
   * Add a transaction to the tracker
   * @param {string} walletAddress - Wallet address
   * @param {string} spentCurrency - Currency spent
   * @param {number} spentAmount - Amount spent
   * @param {string} receivedToken - Token received
   * @param {number} receivedAmount - Amount received
   * @param {Object} metadata - Additional transaction metadata
   */
  addTransaction(walletAddress, spentCurrency, spentAmount, receivedToken, receivedAmount, metadata = {}) {
    if (!this.walletTotals.has(walletAddress)) {
      this.walletTotals.set(walletAddress, { spent: {}, received: {} });
    }
    
    const totals = this.walletTotals.get(walletAddress);
    
    if (!totals.spent[spentCurrency]) totals.spent[spentCurrency] = 0;
    totals.spent[spentCurrency] += spentAmount;
    
    if (!totals.received[receivedToken]) totals.received[receivedToken] = 0;
    totals.received[receivedToken] += receivedAmount;
    
    // Store full transaction record
    this.transactions.push({
      timestamp: new Date(),
      walletAddress,
      spentCurrency,
      spentAmount,
      receivedToken,
      receivedAmount,
      ...metadata
    });
  }

  /**
   * Display transaction summary
   * @param {Object} options - Display options
   */
  displaySummary(options = {}) {
    const { detailed = true } = options;
    
    console.log(`\n📊 TRANSACTION SUMMARY:`);
    console.log(`════════════════════════`);
    
    let totalSpentByCurrency = {};
    let totalReceivedByToken = {};
    let walletCount = 0;
    
    this.walletTotals.forEach((totals, walletAddress) => {
      walletCount++;
      
      if (detailed) {
        console.log(`\n👛 Wallet ${walletCount} (${walletAddress.slice(0, 8)}...):`);
        
        console.log(`   💸 Spent:`);
        Object.entries(totals.spent).forEach(([currency, amount]) => {
          console.log(`      ${amount.toFixed(6)} ${currency}`);
          if (!totalSpentByCurrency[currency]) totalSpentByCurrency[currency] = 0;
          totalSpentByCurrency[currency] += amount;
        });
        
        console.log(`   💰 Received:`);
        Object.entries(totals.received).forEach(([token, amount]) => {
          console.log(`      ${amount.toFixed(6)} ${token}`);
          if (!totalReceivedByToken[token]) totalReceivedByToken[token] = 0;
          totalReceivedByToken[token] += amount;
        });
      } else {
        // Just accumulate totals for summary view
        Object.entries(totals.spent).forEach(([currency, amount]) => {
          if (!totalSpentByCurrency[currency]) totalSpentByCurrency[currency] = 0;
          totalSpentByCurrency[currency] += amount;
        });
        
        Object.entries(totals.received).forEach(([token, amount]) => {
          if (!totalReceivedByToken[token]) totalReceivedByToken[token] = 0;
          totalReceivedByToken[token] += amount;
        });
      }
    });
    
    console.log(`\n🏆 TOTAL ACROSS ALL WALLETS:`);
    console.log(`   💸 Total Spent:`);
    Object.entries(totalSpentByCurrency).forEach(([currency, amount]) => {
      console.log(`      ${amount.toFixed(6)} ${currency}`);
    });
    console.log(`   💰 Total Received:`);
    Object.entries(totalReceivedByToken).forEach(([token, amount]) => {
      console.log(`      ${amount.toFixed(6)} ${token}`);
    });
    
    console.log(`\n📈 Total Transactions: ${this.transactions.length}`);
    console.log(`👛 Active Wallets: ${walletCount}`);
  }

  /**
   * Get summary statistics
   * @returns {Object} Summary statistics
   */
  getSummaryStats() {
    let totalSpentByCurrency = {};
    let totalReceivedByToken = {};
    let activeWallets = this.walletTotals.size;
    
    this.walletTotals.forEach((totals) => {
      Object.entries(totals.spent).forEach(([currency, amount]) => {
        if (!totalSpentByCurrency[currency]) totalSpentByCurrency[currency] = 0;
        totalSpentByCurrency[currency] += amount;
      });
      
      Object.entries(totals.received).forEach(([token, amount]) => {
        if (!totalReceivedByToken[token]) totalReceivedByToken[token] = 0;
        totalReceivedByToken[token] += amount;
      });
    });
    
    return {
      totalTransactions: this.transactions.length,
      activeWallets,
      totalSpentByCurrency,
      totalReceivedByToken,
      transactions: this.transactions
    };
  }

  /**
   * Check if there are any transactions
   * @returns {boolean} True if there are transactions
   */
  hasTransactions() {
    return this.transactions.length > 0;
  }

  /**
   * Clear all tracked data
   */
  clear() {
    this.walletTotals.clear();
    this.transactions = [];
  }

  /**
   * Export transaction data to JSON
   * @returns {string} JSON string of transaction data
   */
  exportToJSON() {
    return JSON.stringify({
      summary: this.getSummaryStats(),
      walletDetails: Array.from(this.walletTotals.entries()).map(([wallet, totals]) => ({
        wallet,
        ...totals
      })),
      transactions: this.transactions
    }, null, 2);
  }
} 