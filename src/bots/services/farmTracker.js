/**
 * FarmBot Tracker Service
 * Tracks farming transactions and provides summaries
 */

export class FarmTracker {
  constructor() {
    this.transactions = [];
    this.walletStats = new Map();
  }
  
  /**
   * Add farming results for a wallet
   * @param {string} walletName - Wallet name
   * @param {Array} loopResults - Results from farming loops
   */
  addWalletResults(walletName, loopResults) {
    const stats = {
      totalLoops: loopResults.length,
      successfulCycles: 0,
      failedBuys: 0,
      failedSells: 0,
      buyTransactions: [],
      sellTransactions: [],
      errors: []
    };
    
    for (const result of loopResults) {
      if (result.cycleSuccess) {
        stats.successfulCycles++;
      }
      
      if (result.buyTx && result.buyTx.status === 1) {
        stats.buyTransactions.push({
          loop: result.loop,
          hash: result.buyTx.hash,
          gasUsed: result.buyTx.gasUsed.toString(),
          effectiveGasPrice: result.buyTx.effectiveGasPrice.toString()
        });
      } else {
        stats.failedBuys++;
        if (result.buyError) {
          stats.errors.push({
            loop: result.loop,
            type: 'buy',
            error: result.buyError.message
          });
        }
      }
      
      if (result.sellTx && result.sellTx.status === 1) {
        stats.sellTransactions.push({
          loop: result.loop,
          hash: result.sellTx.hash,
          gasUsed: result.sellTx.gasUsed.toString(),
          effectiveGasPrice: result.sellTx.effectiveGasPrice.toString()
        });
      } else if (result.buyTx && result.buyTx.status === 1 && !result.sellTx) {
        stats.failedSells++;
        if (result.sellError) {
          stats.errors.push({
            loop: result.loop,
            type: 'sell',
            error: result.sellError.message
          });
        }
      }
      
      // Add to global transactions list
      if (result.buyTx) {
        this.transactions.push({
          wallet: walletName,
          type: 'buy',
          loop: result.loop,
          ...result.buyTx
        });
      }
      if (result.sellTx) {
        this.transactions.push({
          wallet: walletName,
          type: 'sell',
          loop: result.loop,
          ...result.sellTx
        });
      }
    }
    
    this.walletStats.set(walletName, stats);
  }
  
  /**
   * Get summary for a specific wallet
   * @param {string} walletName - Wallet name
   * @returns {Object} Wallet statistics
   */
  getWalletSummary(walletName) {
    return this.walletStats.get(walletName) || null;
  }
  
  /**
   * Get overall farming summary
   * @returns {Object} Overall statistics
   */
  getOverallSummary() {
    let totalLoops = 0;
    let totalSuccessfulCycles = 0;
    let totalBuyTxs = 0;
    let totalSellTxs = 0;
    let totalFailedBuys = 0;
    let totalFailedSells = 0;
    let totalGasUsed = 0n;
    
    for (const [walletName, stats] of this.walletStats) {
      totalLoops += stats.totalLoops;
      totalSuccessfulCycles += stats.successfulCycles;
      totalBuyTxs += stats.buyTransactions.length;
      totalSellTxs += stats.sellTransactions.length;
      totalFailedBuys += stats.failedBuys;
      totalFailedSells += stats.failedSells;
      
      // Calculate total gas used
      for (const tx of [...stats.buyTransactions, ...stats.sellTransactions]) {
        totalGasUsed += BigInt(tx.gasUsed);
      }
    }
    
    return {
      walletsUsed: this.walletStats.size,
      totalLoops,
      totalSuccessfulCycles,
      totalBuyTxs,
      totalSellTxs,
      totalFailedBuys,
      totalFailedSells,
      successRate: totalLoops > 0 ? (totalSuccessfulCycles / totalLoops * 100).toFixed(2) + '%' : '0%',
      totalGasUsed: totalGasUsed.toString(),
      walletDetails: Array.from(this.walletStats.entries()).map(([name, stats]) => ({
        wallet: name,
        ...stats
      }))
    };
  }
  
  /**
   * Display farming results
   */
  displayResults() {
    console.log('\n' + '='.repeat(60));
    console.log('🌾 FARMING RESULTS SUMMARY');
    console.log('='.repeat(60));
    
    const summary = this.getOverallSummary();
    
    console.log(`\n📊 OVERALL STATISTICS:`);
    console.log(`  • Wallets Used: ${summary.walletsUsed}`);
    console.log(`  • Total Loops: ${summary.totalLoops}`);
    console.log(`  • Successful Cycles: ${summary.totalSuccessfulCycles}`);
    console.log(`  • Success Rate: ${summary.successRate}`);
    console.log(`  • Buy Transactions: ${summary.totalBuyTxs} (${summary.totalFailedBuys} failed)`);
    console.log(`  • Sell Transactions: ${summary.totalSellTxs} (${summary.totalFailedSells} failed)`);
    
    console.log(`\n💼 WALLET BREAKDOWN:`);
    for (const walletDetail of summary.walletDetails) {
      console.log(`\n  ${walletDetail.wallet}:`);
      console.log(`    • Loops: ${walletDetail.totalLoops}`);
      console.log(`    • Successful: ${walletDetail.successfulCycles}/${walletDetail.totalLoops}`);
      console.log(`    • Buy TXs: ${walletDetail.buyTransactions.length} (${walletDetail.failedBuys} failed)`);
      console.log(`    • Sell TXs: ${walletDetail.sellTransactions.length} (${walletDetail.failedSells} failed)`);
      
      if (walletDetail.errors.length > 0) {
        console.log(`    • Errors:`);
        for (const error of walletDetail.errors) {
          console.log(`      - Loop ${error.loop} (${error.type}): ${error.error}`);
        }
      }
    }
    
    console.log('\n' + '='.repeat(60));
  }
  
  /**
   * Get all transactions
   * @returns {Array} All tracked transactions
   */
  getAllTransactions() {
    return this.transactions;
  }
  
  /**
   * Clear all tracked data
   */
  clear() {
    this.transactions = [];
    this.walletStats.clear();
  }
} 