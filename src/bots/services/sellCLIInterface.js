/**
 * Sell CLI Interface Service
 * Handles command-line interactions for sellbot
 */

import readline from 'readline';

/**
 * SellCLIInterface - Manages CLI interactions for sellbot
 */
export class SellCLIInterface {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  
  /**
   * Ask a question and get user input
   * @param {string} question - Question to ask
   * @returns {Promise<string>} User input
   */
  askQuestion(question) {
    return new Promise((resolve) => {
      this.rl.question(question, resolve);
    });
  }
  
  /**
   * Close the readline interface
   */
  close() {
    this.rl.close();
  }
  
  /**
   * Get sell mode from user
   * @returns {Promise<string>} Selected mode
   */
  async getSellMode() {
    console.log('\n🔴 SELLBOT MODES:');
    console.log('1. Default - Single or multiple sells');
    console.log('2. TWAP - Time-weighted average price');
    console.log('3. FSH - Flash sell all tokens');
    
    const mode = await this.askQuestion('\nSelect mode (1-3): ');
    
    switch (mode) {
      case '1':
        return 'default';
      case '2':
        return 'twap';
      case '3':
        return 'fsh';
      default:
        console.log('❌ Invalid selection, using default mode');
        return 'default';
    }
  }
  
  /**
   * Get default mode parameters
   * @param {Object} tokenInfo - Token information
   * @param {Object} defaultSettings - Default settings
   * @returns {Promise<Object>} Mode parameters
   */
  async getDefaultModeParams(tokenInfo, defaultSettings) {
    const tokenAmountInput = await this.askQuestion(
      `Enter ${tokenInfo.symbol} amount to sell (or press Enter for auto): `
    );
    
    const slippageInput = await this.askQuestion(
      `Enter slippage % (default ${defaultSettings.MAX_SLIPPAGE_PERCENT}%): `
    );
    
    const slippage = slippageInput ? parseFloat(slippageInput) : defaultSettings.MAX_SLIPPAGE_PERCENT;
    
    return {
      tokenAmount: tokenAmountInput ? parseFloat(tokenAmountInput) : null,
      slippage
    };
  }
  
  /**
   * Get TWAP mode parameters
   * @param {Object} tokenInfo - Token information
   * @param {Object} defaultSettings - Default settings
   * @returns {Promise<Object>} TWAP parameters
   */
  async getTWAPModeParams(tokenInfo, defaultSettings) {
    const amountInput = await this.askQuestion(
      `Enter total amount (number for ${tokenInfo.symbol} or % for percentage, e.g., "1000" or "50%"): `
    );
    
    const hoursInput = await this.askQuestion('Enter duration in hours: ');
    
    const slippageInput = await this.askQuestion(
      `Enter slippage % (default ${defaultSettings.MAX_SLIPPAGE_PERCENT}%): `
    );
    
    const hours = parseFloat(hoursInput);
    const slippage = slippageInput ? parseFloat(slippageInput) : defaultSettings.MAX_SLIPPAGE_PERCENT;
    
    return {
      amountInput,
      hours,
      slippage
    };
  }
  
  /**
   * Get FSH mode confirmation
   * @returns {Promise<boolean>} User confirmation
   */
  async getFSHConfirmation() {
    console.log('\n⚠️ WARNING: FSH MODE WILL SELL ALL TOKENS FROM ALL WALLETS!');
    console.log('This includes all tokens except VIRTUAL and TRUST.');
    
    const confirm = await this.askQuestion('\nAre you absolutely sure? (yes/no): ');
    return confirm.toLowerCase() === 'yes';
  }
  
  /**
   * Display sell summary and get confirmation
   * @param {Object} summary - Sell summary
   * @returns {Promise<boolean>} User confirmation
   */
  async confirmSell(summary) {
    console.log('\n📋 SELL SUMMARY:');
    console.log(`💰 Amount: ${summary.amount} ${summary.token}`);
    console.log(`🛡️ Slippage: ${summary.slippage}%`);
    console.log(`👛 Wallets: ${summary.walletCount}`);
    if (summary.expectedOut) {
      console.log(`📈 Expected: ~${summary.expectedOut} ${summary.outputToken}`);
    }
    
    const confirm = await this.askQuestion('\nProceed with sell? (y/n): ');
    return confirm.toLowerCase() === 'y';
  }
  
  /**
   * Display TWAP configuration and get confirmation
   * @param {Object} config - TWAP configuration
   * @returns {Promise<boolean>} User confirmation
   */
  async confirmTWAP(config) {
    console.log(`\n🎯 TWAP Configuration:`);
    console.log(`💰 Total amount: ${config.totalAmount.toFixed(4)} ${config.token}`);
    console.log(`⏰ Duration: ${config.hours} hours`);
    console.log(`📊 Transactions: ${config.numTransactions}`);
    console.log(`💵 Base amount per TX: ${config.baseAmountPerTx.toFixed(4)} ${config.token}`);
    console.log(`⏳ Base delay: ${config.baseDelaySeconds}s`);
    console.log(`🛡️ Slippage: ${config.slippage}%`);
    
    const confirm = await this.askQuestion('\nProceed with TWAP? (y/n): ');
    return confirm.toLowerCase() === 'y';
  }
  
  /**
   * Show progress update
   * @param {string} message - Progress message
   */
  showProgress(message) {
    console.log(`\n⏳ ${message}`);
  }
  
  /**
   * Show transaction result
   * @param {Object} result - Transaction result
   * @param {number} index - Transaction index
   * @param {number} total - Total transactions
   */
  showTransactionResult(result, index, total) {
    if (result.success) {
      console.log(`✅ [${index}/${total}] Success: ${result.txHash}`);
      if (result.virtualReceived) {
        console.log(`   💰 Received: ${result.virtualReceived.toFixed(6)} VIRTUAL`);
      }
    } else {
      console.log(`❌ [${index}/${total}] Failed: ${result.error}`);
    }
  }
  
  /**
   * Display final summary
   * @param {Object} summary - Execution summary
   */
  displaySummary(summary) {
    console.log(`\n📊 FINAL SUMMARY:`);
    console.log(`✅ Successful: ${summary.successful}/${summary.total}`);
    console.log(`❌ Failed: ${summary.failed}/${summary.total}`);
    
    if (summary.totalSpent) {
      console.log(`\n💰 TOTALS:`);
      console.log(`   Spent: ${summary.totalSpent.toFixed(6)} ${summary.spentCurrency}`);
      console.log(`   Received: ${summary.totalReceived.toFixed(6)} ${summary.receivedCurrency}`);
    }
  }
} 