/**
 * Optimized Market Making Bot
 * Refactored version using modular service architecture
 */

import { ethers } from 'ethers';
import { BuyBot } from './buy-bot-optimized.js';
import { SellBot } from './sell-bot-optimized.js';
import { PriceMonitor } from './services/priceMonitor.js';
import { MMTracker } from './services/mmTracker.js';
import { CONTRACTS, ABIS } from './config/constants.js';
import { log, sleep } from '../utils.js';
import { executeTransactionWithReplacementFee } from '../config.js';
import { gasPriceService } from '../providers/gasPriceService.js';

/**
 * Optimized MMBot class
 */
export class MMBot {
  constructor(wallets, tokenInfo, virtualCA, settings) {
    this.wallets = wallets;
    this.tokenInfo = tokenInfo;
    this.virtualCA = virtualCA;
    this.settings = settings;
    
    // Initialize services
    this.priceMonitor = new PriceMonitor(tokenInfo, virtualCA);
    this.tracker = new MMTracker(settings.mode || 'normal');
    
    // Bot instances for buy/sell operations
    this.buyBot = new BuyBot(wallets, tokenInfo, virtualCA, settings, settings.customGasPrice);
    this.sellBot = new SellBot();
    
    // Market making state
    this.running = false;
    this.completedLoops = 0;
    this.nextAction = null;
    this.actionCount = 0;
    
    // Retry configuration
    this.maxRetries = 5;
    this.retryDelay = 5000; // 5 seconds
  }
  
  /**
   * Check and approve token spending if needed
   * @param {Object} wallet - Wallet instance
   * @param {number} amount - Amount to approve
   * @returns {boolean} True if approval was needed and completed
   */
  async checkAndApproveToken(wallet, amount) {
    try {
      const tokenContract = new ethers.Contract(
        this.tokenInfo.address,
        ABIS.ERC20_MINIMAL,
        wallet
      );

      const currentAllowance = await tokenContract.allowance(wallet.address, CONTRACTS.TRUSTSWAP);
      const amountWei = ethers.parseUnits(amount.toString(), this.tokenInfo.decimals);

      if (currentAllowance < amountWei) {
        console.log(`   🔓 Approving UNLIMITED ${this.tokenInfo.symbol} for TRUSTSWAP (${wallet.address.slice(0, 8)})...`);
        
        // Use replacement fee handler for approval transaction
        await executeTransactionWithReplacementFee(
          async (currentProvider, gasParams) => {
            const walletWithProvider = wallet.connect(currentProvider);
            const contractWithProvider = tokenContract.connect(walletWithProvider);
            
            return await contractWithProvider.approve(CONTRACTS.TRUSTSWAP, ethers.MaxUint256, {
              maxFeePerGas: gasParams.maxFeePerGas,
              maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
              gasLimit: 200000n
            });
          }
        );
        
        console.log(`   ✅ ${this.tokenInfo.symbol} UNLIMITED TRUSTSWAP approval confirmed`);
        return true;
      }
      return false;
    } catch (error) {
      console.log(`   ❌ Approval failed: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get wallet balances
   * @param {Array} wallets - Wallet instances
   * @returns {Array} Balance information
   */
  async getWalletBalances(wallets) {
    console.log('\n💰 Checking wallet balances...');
    
    const balances = [];
    
    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];
      
      try {
        // Get VIRTUAL balance
        const virtualContract = new ethers.Contract(this.virtualCA, [
          'function balanceOf(address) view returns (uint256)'
        ], wallet);
        const virtualBalance = await virtualContract.balanceOf(wallet.address);
        const virtualFormatted = parseFloat(ethers.formatUnits(virtualBalance, 18));
        
        // Get TOKEN balance
        const tokenContract = new ethers.Contract(this.tokenInfo.address, [
          'function balanceOf(address) view returns (uint256)'
        ], wallet);
        const tokenBalance = await tokenContract.balanceOf(wallet.address);
        const tokenFormatted = parseFloat(ethers.formatUnits(tokenBalance, this.tokenInfo.decimals));
        
        balances.push({
          walletIndex: i + 1,
          address: wallet.address,
          virtualBalance: virtualFormatted,
          tokenBalance: tokenFormatted
        });
        
        console.log(`   👛 Wallet ${i + 1}: ${virtualFormatted.toFixed(6)} VIRTUAL, ${tokenFormatted.toFixed(6)} ${this.tokenInfo.symbol}`);
        
      } catch (error) {
        console.log(`   ❌ Wallet ${i + 1}: Error getting balances - ${error.message}`);
        balances.push({
          walletIndex: i + 1,
          address: wallet.address,
          virtualBalance: 0,
          tokenBalance: 0,
          error: error.message
        });
      }
    }
    
    return balances;
  }
  
  /**
   * Calculate trading amounts based on V-/T- formats
   * @param {Object} config - Configuration
   * @param {Array} balances - Wallet balances
   * @param {Array} originalAmounts - Original trading amounts (optional, for preserving fixed amounts)
   * @returns {Array} Trading amounts
   */
  calculateTradingAmounts(config, balances, originalAmounts = null) {
    console.log('\n💱 Calculating trading amounts...');
    
    const amounts = balances.map((balance, index) => {
      const { walletIndex, virtualBalance, tokenBalance } = balance;
      
      // Calculate VIRTUAL amount for buying
      let virtualAmount;
      if (config.virtualAmount.includes('%')) {
        const percentage = parseFloat(config.virtualAmount.replace('%', ''));
        virtualAmount = virtualBalance * (percentage / 100);
      } else {
        // For fixed VIRTUAL amounts, always use the original config value
        virtualAmount = parseFloat(config.virtualAmount);
      }
      
      // Calculate TOKEN amount for selling
      let tokenAmount;
      if (config.tokenAmount.includes('%')) {
        const percentage = parseFloat(config.tokenAmount.replace('%', ''));
        tokenAmount = tokenBalance * (percentage / 100);
      } else {
        // For fixed TOKEN amounts (like T-1000), preserve the original amount
        // Only use new balance if we don't have original amounts or this is the first calculation
        if (originalAmounts && originalAmounts[index] && originalAmounts[index].tokenAmount) {
          tokenAmount = originalAmounts[index].tokenAmount;
      } else {
        tokenAmount = parseFloat(config.tokenAmount);
        }
      }
      
      // Validate amounts
      virtualAmount = Math.max(0, virtualAmount);
      tokenAmount = Math.max(0, tokenAmount);
      
      console.log(`   👛 Wallet ${walletIndex}: Buy with ${virtualAmount.toFixed(6)} VIRTUAL, Sell ${tokenAmount.toFixed(6)} TOKEN`);
      
      return {
        walletIndex,
        virtualAmount,
        tokenAmount,
        canBuy: virtualAmount > 0 && virtualBalance >= virtualAmount,
        canSell: tokenAmount > 0 && tokenBalance >= tokenAmount
      };
    });
    
    return amounts;
  }
  
  /**
   * Execute operation with retry logic
   * @param {Function} operation - Operation to execute
   * @param {string} operationName - Name for logging
   * @param {number} walletIndex - Wallet index for logging
   * @returns {Object} Result
   */
  async executeWithRetry(operation, operationName, walletIndex) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`   🔄 Wallet ${walletIndex}: ${operationName} attempt ${attempt}/${this.maxRetries}`);
        const result = await operation();
        
        if (result.success) {
          if (attempt > 1) {
            console.log(`   ✅ Wallet ${walletIndex}: ${operationName} succeeded on attempt ${attempt}`);
          }
          return result;
        } else {
          lastError = result.error || 'Unknown error';
          if (attempt < this.maxRetries) {
            console.log(`   ⚠️ Wallet ${walletIndex}: ${operationName} failed on attempt ${attempt}, retrying in ${this.retryDelay/1000}s...`);
            await sleep(this.retryDelay);
          }
        }
      } catch (error) {
        lastError = error.message;
        if (attempt < this.maxRetries) {
          console.log(`   ❌ Wallet ${walletIndex}: ${operationName} error on attempt ${attempt}: ${error.message}`);
          console.log(`   ⏳ Retrying in ${this.retryDelay/1000}s...`);
          await sleep(this.retryDelay);
        }
      }
    }
    
    console.log(`   💥 Wallet ${walletIndex}: ${operationName} failed after ${this.maxRetries} attempts. Final error: ${lastError}`);
    return { success: false, error: lastError };
  }
  
  /**
   * Execute buy for all wallets
   * @param {Array} tradingAmounts - Trading amounts per wallet
   * @returns {Array} Results
   */
  async executeBuyForAllWallets(tradingAmounts) {
    console.log(`🟢 Executing buy for all ${this.wallets.length} wallets...`);
    
    const results = [];
    
    for (let i = 0; i < this.wallets.length; i++) {
      const wallet = this.wallets[i];
      const amount = tradingAmounts[i];
      
      if (!amount.canBuy) {
        console.log(`   ⚠️ Wallet ${i + 1}: Insufficient VIRTUAL balance`);
        this.tracker.trackFailure(wallet.address, 'buy', 'insufficient_balance');
        results.push({ success: false, reason: 'insufficient_balance' });
        continue;
      }
      
      const buyOperation = async () => {
        return await this.buyBot.executeBuy(wallet, amount.virtualAmount, 15); // 15% slippage
      };
      
      const result = await this.executeWithRetry(buyOperation, 'Buy', i + 1);
        
        if (result.success) {
          console.log(`   ✅ Wallet ${i + 1}: Buy successful - ${result.txHash}`);
          this.tracker.trackBuy(wallet.address, amount.virtualAmount, result.tokensReceived, {
            txHash: result.txHash,
            blockNumber: result.blockNumber
          });
        } else {
          this.tracker.trackFailure(wallet.address, 'buy', result.error);
      }
      
          results.push(result);
      
      // Small delay between wallets
      if (i < this.wallets.length - 1) {
        await sleep(500);
      }
    }
    
    const successful = results.filter(r => r.success).length;
    console.log(`✅ Buy completed: ${successful}/${this.wallets.length} wallets successful`);
    
    return results;
  }
  
  /**
   * Validate and calculate sell amount
   * @param {Object} wallet - Wallet instance
   * @param {Object} amount - Trading amount configuration
   * @param {Object} nextAction - Next action from tracker
   * @returns {number|null} Valid sell amount or null
   */
  async validateSellAmount(wallet, amount, nextAction) {
    // Get current token balance
    const tokenContract = new ethers.Contract(this.tokenInfo.address, [
      'function balanceOf(address) view returns (uint256)'
    ], wallet);
    const actualBalance = await tokenContract.balanceOf(wallet.address);
    const actualBalanceFormatted = parseFloat(ethers.formatUnits(actualBalance, this.tokenInfo.decimals));
    
    // Priority: 1) Tracker recommended amount, 2) Config amount, 3) Actual balance
    let sellAmount = null;
    
    if (nextAction.sellAmount && nextAction.sellAmount > 0) {
      sellAmount = Math.min(nextAction.sellAmount, actualBalanceFormatted);
    } else if (amount.tokenAmount && amount.tokenAmount > 0) {
      sellAmount = Math.min(amount.tokenAmount, actualBalanceFormatted);
    } else {
      sellAmount = actualBalanceFormatted;
    }
    
    // Ensure minimum valid amount (0.000001 tokens)
    const minAmount = 0.000001;
    if (sellAmount < minAmount) {
      return null;
    }
    
    // Ensure amount doesn't exceed balance
    if (sellAmount > actualBalanceFormatted) {
      sellAmount = actualBalanceFormatted;
    }
    
    return sellAmount;
  }
  
  /**
   * Execute sell for all wallets
   * @param {Array} tradingAmounts - Trading amounts per wallet
   * @returns {Array} Results
   */
  async executeSellForAllWallets(tradingAmounts) {
    console.log(`🔴 Executing sell for all ${this.wallets.length} wallets...`);
    
    const results = [];
    
    for (let i = 0; i < this.wallets.length; i++) {
      const wallet = this.wallets[i];
      const amount = tradingAmounts[i];
      
      // Get next action from tracker
      const nextAction = this.tracker.getNextAction(wallet.address);
      
      // Validate and calculate sell amount
      let sellAmount;
      try {
        sellAmount = await this.validateSellAmount(wallet, amount, nextAction);
      } catch (error) {
        console.log(`   ❌ Wallet ${i + 1}: Error validating sell amount - ${error.message}`);
        results.push({ success: false, error: error.message });
        continue;
      }
      
      if (!sellAmount || sellAmount <= 0) {
        console.log(`   ⚠️ Wallet ${i + 1}: No valid tokens to sell`);
        results.push({ success: false, reason: 'no_tokens' });
        continue;
      }
      
      console.log(`   📊 Wallet ${i + 1}: Selling ${sellAmount.toFixed(6)} ${this.tokenInfo.symbol}`);
      
      const sellOperation = async () => {
        return await this.executeSellDirect(wallet, sellAmount);
      };
      
      const result = await this.executeWithRetry(sellOperation, 'Sell', i + 1);
        
        if (result.success) {
          console.log(`   ✅ Wallet ${i + 1}: Sell successful - ${result.txHash}`);
          this.tracker.trackSell(wallet.address, sellAmount, result.virtualReceived, {
            txHash: result.txHash,
            blockNumber: result.blockNumber
          });
        } else {
          this.tracker.trackFailure(wallet.address, 'sell', result.error);
      }
      
          results.push(result);
      
      // Small delay between wallets
      if (i < this.wallets.length - 1) {
        await sleep(500);
      }
    }
    
    const successful = results.filter(r => r.success).length;
    console.log(`✅ Sell completed: ${successful}/${this.wallets.length} wallets successful`);
    
    return results;
  }
  
  /**
   * Direct sell implementation (simplified from SellBot)
   * @param {Object} wallet - Wallet instance
   * @param {number} tokenAmount - Amount to sell
   * @returns {Object} Result
   */
  async executeSellDirect(wallet, tokenAmount) {
    try {
      // Validate input amount
      if (!tokenAmount || tokenAmount <= 0 || !isFinite(tokenAmount)) {
        throw new Error(`Invalid token amount: ${tokenAmount}`);
      }
      
      // Check and approve token spending BEFORE executing swap
      await this.checkAndApproveToken(wallet, tokenAmount);
      
    const trustSwap = new ethers.Contract(CONTRACTS.TRUSTSWAP, [
      'function swapForVirtualWithFee(address tokenIn, uint256 amountIn, uint256 amountOutMin, uint256 deadline) external returns (uint256[] memory)'
    ], wallet);
    
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      
      // Validate tokenAmount before parsing
      const decimals = Number(this.tokenInfo.decimals); // Convert BigInt to number
      const tokenAmountStr = tokenAmount.toFixed(decimals);
      const tokenAmountWei = ethers.parseUnits(tokenAmountStr, this.tokenInfo.decimals);
      
      // Additional validation of parsed amount
      if (tokenAmountWei <= 0n) {
        throw new Error(`Invalid token amount after parsing: ${tokenAmountWei.toString()}`);
      }
      
      console.log(`     💱 Selling ${tokenAmountStr} tokens (${tokenAmountWei.toString()} wei)`);
    
    // Get VIRTUAL balance before
    const virtualContract = new ethers.Contract(this.virtualCA, [
      'function balanceOf(address) view returns (uint256)'
    ], wallet);
    const virtualBefore = await virtualContract.balanceOf(wallet.address);
    
    const tx = await trustSwap.swapForVirtualWithFee(
      this.tokenInfo.address,
      tokenAmountWei,
      0, // Accept any amount
      deadline
    );
    
    const receipt = await tx.wait();
      
      // Check if transaction was successful
      if (receipt.status === 0) {
        throw new Error('Transaction reverted');
      }
    
    // Get VIRTUAL balance after
    const virtualAfter = await virtualContract.balanceOf(wallet.address);
    const virtualReceived = parseFloat(ethers.formatUnits(virtualAfter - virtualBefore, 18));
    
    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      virtualReceived
    };
    } catch (error) {
      console.log(`     ❌ Sell direct error: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Start market making
   * @param {Object} config - Configuration
   */
  async start(config) {
    console.log('\n🚀 MMBOT - SINGLE TOKEN MARKET MAKING');
    console.log('=====================================');
    console.log(`🎯 Token: ${this.tokenInfo.symbol} (${this.tokenInfo.address})`);
    console.log(`👛 Wallets: ${this.wallets.length}`);
    console.log(`💰 VIRTUAL Amount: ${config.virtualAmount} per wallet`);
    console.log(`🎯 TOKEN Amount: ${config.tokenAmount} per wallet`);
    console.log(`📉 Lower Range: ${config.lowerRange}% (buy when price drops)`);
    console.log(`📈 Higher Range: ${config.higherRange}% (sell when price rises)`);
    console.log(`⏰ Check Interval: ${config.checkInterval}s`);
    console.log(`🔄 Loops: ${config.loops ? config.loops + ' (alternating buy/sell cycles)' : 'INFINITE (continuous market making)'}`);
    console.log(`🎯 Chase Mode: ${config.chaseMode ? 'ENABLED' : 'DISABLED'}`);
    console.log(`💱 Trading: TRUSTSWAP contract for all operations (0.25% fee)`);
    console.log(`⛽ Gas: ${config.customGasPrice || '0.02'} gwei`);
    console.log(`🔄 Retry Logic: ${this.maxRetries} attempts with ${this.retryDelay/1000}s delay`);
    console.log('');
    
    // Initialize price monitoring
    const { basePrice, buyThreshold, sellThreshold } = await this.priceMonitor.initializeThresholds(
      config.lowerRange,
      config.higherRange
    );
    
    console.log(`\n📊 INITIAL PRICE SETUP:`);
    console.log(`   📊 Base Price: ${this.priceMonitor.formatPrice(basePrice)} VIRTUAL per ${this.tokenInfo.symbol}`);
    console.log(`   🟢 Buy Threshold: ${this.priceMonitor.formatPrice(buyThreshold)} VIRTUAL (${config.lowerRange}% below base)`);
    console.log(`   🔴 Sell Threshold: ${this.priceMonitor.formatPrice(sellThreshold)} VIRTUAL (${config.higherRange}% above base)`);
    
    // Get initial balances and trading amounts
    const balances = await this.getWalletBalances(this.wallets);
    let tradingAmounts = this.calculateTradingAmounts(config, balances);
    
    // Store original trading amounts to preserve fixed amounts (like T-1000)
    const originalTradingAmounts = JSON.parse(JSON.stringify(tradingAmounts));
    
    // Start monitoring
    console.log('\n🔄 STARTING MARKET MAKING...');
    console.log('⚠️ Press Ctrl+C to stop');
    
    this.running = true;
    
    // Main loop
    while (this.running && (config.loops === null || this.completedLoops < config.loops)) {
      try {
        // Check price and get action
        const priceAction = await this.priceMonitor.checkPriceAction();
        
        console.log(`\n⏰ [${new Date().toLocaleTimeString()}] Price Check`);
        console.log(`Current: ${this.priceMonitor.formatPrice(priceAction.currentPrice)} VIRTUAL`);
        
        // Handle CHASE mode
        if (config.chaseMode && priceAction.action === 'hold') {
          const currentPrice = priceAction.currentPrice;
          if (Math.abs(currentPrice - basePrice) / basePrice > 0.001) { // >0.1% change
            const update = this.priceMonitor.updateBasePrice(currentPrice, config.lowerRange, config.higherRange);
            console.log(`🎯 CHASE: Base ${this.priceMonitor.formatPrice(update.oldBasePrice)} → ${this.priceMonitor.formatPrice(update.newBasePrice)} (${update.changePercent}%)`);
          }
        }
        
        // Enforce alternating logic for finite loops
        if (config.loops > 0 && this.nextAction) {
          if (this.nextAction === 'buy' && priceAction.action === 'sell') {
            console.log(`🔄 Waiting for buy signal (alternating logic)`);
            priceAction.action = 'hold';
          } else if (this.nextAction === 'sell' && priceAction.action === 'buy') {
            console.log(`🔄 Waiting for sell signal (alternating logic)`);
            priceAction.action = 'hold';
          }
        }
        
        // Execute actions
        if (priceAction.action === 'buy') {
          console.log(`🟢 BUY TRIGGER: Price ${this.priceMonitor.formatPrice(priceAction.currentPrice)} <= ${this.priceMonitor.formatPrice(priceAction.threshold)}`);
          
          const results = await this.executeBuyForAllWallets(tradingAmounts);
          const successful = results.filter(r => r.success).length;
          
          if (successful > 0) {
            this.actionCount++;
            if (config.loops !== null) {
              this.nextAction = 'sell';
            }
            
            // Update base price after successful buy
            const newPrice = await this.priceMonitor.getCurrentPrice();
            this.priceMonitor.updateBasePrice(newPrice, config.lowerRange, config.higherRange);
            console.log(`📊 Base price updated after buy`);
            
            // Update balances
            const newBalances = await this.getWalletBalances(this.wallets);
            tradingAmounts = this.calculateTradingAmounts(config, newBalances, originalTradingAmounts);
          }
          
        } else if (priceAction.action === 'sell') {
          console.log(`🔴 SELL TRIGGER: Price ${this.priceMonitor.formatPrice(priceAction.currentPrice)} >= ${this.priceMonitor.formatPrice(priceAction.threshold)}`);
          
          const results = await this.executeSellForAllWallets(tradingAmounts);
          const successful = results.filter(r => r.success).length;
          
          if (successful > 0) {
            this.actionCount++;
            if (config.loops !== null) {
              this.nextAction = 'buy';
            }
            
            // Update base price after successful sell
            const newPrice = await this.priceMonitor.getCurrentPrice();
            this.priceMonitor.updateBasePrice(newPrice, config.lowerRange, config.higherRange);
            console.log(`📊 Base price updated after sell`);
            
            // Update balances
            const newBalances = await this.getWalletBalances(this.wallets);
            tradingAmounts = this.calculateTradingAmounts(config, newBalances, originalTradingAmounts);
          }
          
        } else {
          const state = this.priceMonitor.getState();
          console.log(`Price Check Current: ${this.priceMonitor.formatPrice(priceAction.currentPrice)} VIRTUAL`);
          console.log(`Range Low: ${this.priceMonitor.formatPrice(state.buyThreshold)} VIRTUAL`);
          console.log(`Range High: ${this.priceMonitor.formatPrice(state.sellThreshold)} VIRTUAL`);
        }
        
        // Check loop completion
        if (config.loops !== null && this.actionCount >= 2 && this.actionCount % 2 === 0) {
          this.completedLoops = Math.floor(this.actionCount / 2);
          console.log(`🎉 Loop ${this.completedLoops}/${config.loops} completed!`);
          
          if (this.completedLoops >= config.loops) {
            console.log(`\n✅ All ${config.loops} loops completed!`);
            break;
          }
        }
        
        // Wait for next check
        await sleep(config.checkInterval * 1000);
        
      } catch (error) {
        console.log(`❌ Error in market making: ${error.message}`);
        await sleep(config.checkInterval * 1000);
      }
    }
    
    // Display final summary
    this.tracker.displaySummary();
    console.log('\n🏁 Market making completed!');
  }
  
  /**
   * Stop market making
   */
  stop() {
    console.log('\n🛑 Stopping market making...');
    this.running = false;
  }
} 