// Rebuy manager service for executing rebuy operations after JEET mode

import { ethers } from 'ethers';
import { executeTransactionWithReplacementFee } from '../../config.js';
import { ERC20_ABI, TRUSTSWAP_CONTRACT, VIRTUAL_TOKEN_ADDRESS, TRUSTSWAP_ABI } from '../config/jeetConstants.js';

import { log } from '../../utils/logger.js';
import { sleep } from '../../utils/common.js';
import { provider } from '../../config/index.js';
import { findPoolWithMetadata } from '../../../find-pool.mjs';

/**
 * REBUY Manager - Monitors price drops and executes rebuy operations
 */
export class RebuyManager {
  constructor(wallets, tokenInfo, rebuyPercentage, intervalMinutes) {
    this.wallets = wallets;
    this.tokenInfo = tokenInfo;
    this.rebuyPercentage = rebuyPercentage; // e.g., 5 for 5%
    this.intervalMinutes = intervalMinutes;
    this.sellPrice = null; // Static sell price (base price)
    this.targetPrice = null; // Price at which to rebuy
    this.running = false;
    this.maxRetries = 3;
  }

  /**
   * Get pool address with fallback using find-pool.mjs
   * @returns {Promise<string>} Pool address
   */
  async getPoolAddress() {
    // First try: use existing pool address
    if (this.tokenInfo.poolAddress) {
      log(`✅ Using existing pool address: ${this.tokenInfo.poolAddress}`);
      return this.tokenInfo.poolAddress;
    }

    // Fallback: use find-pool.mjs to discover pool address
    log(`🔍 Pool address not available, using find-pool.mjs fallback...`);
    log(`🎯 Searching for pool: ${this.tokenInfo.address} vs VIRTUAL`);
    
    try {
      const poolResult = await findPoolWithMetadata(this.tokenInfo.address, VIRTUAL_TOKEN_ADDRESS);
      
      if (poolResult.success && poolResult.poolAddress) {
        log(`✅ Found pool via find-pool.mjs: ${poolResult.poolAddress}`);
        
        // Update tokenInfo with discovered pool address
        this.tokenInfo.poolAddress = poolResult.poolAddress;
        
        // Also update token metadata if available
        if (poolResult.tokenMetadata) {
          this.tokenInfo.symbol = poolResult.tokenMetadata.symbol || this.tokenInfo.symbol;
          this.tokenInfo.decimals = poolResult.tokenMetadata.decimals || this.tokenInfo.decimals;
        }
        
        return poolResult.poolAddress;
      } else {
        throw new Error(`find-pool.mjs could not find a valid pool for ${this.tokenInfo.address}`);
      }
    } catch (error) {
      throw new Error(`Pool discovery failed: ${error.message}`);
    }
  }

  /**
   * Get current price from Uniswap pool reserves (learned from MMBot PriceMonitor)
   * @returns {number} Current price in VIRTUAL per token
   */
  async getCurrentPrice() {
    // Get pool address with fallback
    const poolAddress = await this.getPoolAddress();
    
    const pairContract = new ethers.Contract(
      poolAddress,
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
    
    const virtualIsToken0 = token0.toLowerCase() === VIRTUAL_TOKEN_ADDRESS.toLowerCase();
    const virtualReserve = virtualIsToken0 ? reserves[0] : reserves[1];
    const tokenReserve = virtualIsToken0 ? reserves[1] : reserves[0];
    
    const virtualFormatted = parseFloat(ethers.formatUnits(virtualReserve, 18));
    const tokenFormatted = parseFloat(ethers.formatUnits(tokenReserve, this.tokenInfo.decimals));
    
    return virtualFormatted / tokenFormatted;
  }

  /**
   * Initialize thresholds - Log sell price as base price (static)
   * @param {number} sellPrice - The price at which tokens were sold
   */
  initializeThresholds(sellPrice) {
    this.sellPrice = sellPrice; // Static base price
    this.targetPrice = sellPrice * (1 - this.rebuyPercentage / 100); // Price to rebuy at
    
    log(`📊 REBUY PRICE THRESHOLDS:`);
    log(`   💰 Sell Price (Base): ${this.formatPrice(this.sellPrice)} VIRTUAL per ${this.tokenInfo.symbol}`);
    log(`   🎯 Target Rebuy Price: ${this.formatPrice(this.targetPrice)} VIRTUAL (${this.rebuyPercentage}% drop)`);
    
    return {
      sellPrice: this.sellPrice,
      targetPrice: this.targetPrice
    };
  }

  /**
   * Check current price vs sell price and calculate drop percentage
   * @returns {Object} Price analysis
   */
  async checkPriceAction() {
    const currentPrice = await this.getCurrentPrice();
    const dropPercent = ((this.sellPrice - currentPrice) / this.sellPrice) * 100;
    
    // Check if we've reached the target drop percentage
    if (currentPrice <= this.targetPrice) {
      return {
        action: 'rebuy',
        currentPrice,
        sellPrice: this.sellPrice,
        targetPrice: this.targetPrice,
        dropPercent: Math.max(0, dropPercent).toFixed(2), // Show positive drop percentage
        readyToBuy: true
      };
    }
    
    // For monitoring, show actual drop (can be negative if price went up)
    const actualDrop = Math.max(0, dropPercent); // Only show positive drops
    const priceDirection = dropPercent >= 0 ? 'dropped' : 'increased';
    const changePercent = Math.abs(dropPercent);
    
    return {
      action: 'monitor',
      currentPrice,
      sellPrice: this.sellPrice,
      targetPrice: this.targetPrice,
      dropPercent: actualDrop.toFixed(2),
      progress: `${actualDrop.toFixed(2)}%/${this.rebuyPercentage}%`,
      priceDirection,
      changePercent: changePercent.toFixed(2),
      readyToBuy: false
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
   * Execute rebuy mode with continuous price monitoring
   * @param {Array} swapResults - Results from initial swaps
   * @returns {Promise<Object>} Rebuy results
   */
  async executeRebuyMode(swapResults) {
    log(`\n🔄 ==================== REBUY MODE ====================`);
    log(`🎯 Token: ${this.tokenInfo.symbol} (${this.tokenInfo.address})`);
    log(`⏰ Monitoring interval: ${this.intervalMinutes} minute(s)`);
    log(`📉 Rebuy trigger: ${this.rebuyPercentage}% price drop`);
    log(`👛 Monitoring ${this.wallets.length} wallets`);
    log(`⚠️  Press Ctrl+C to stop REBUY monitoring`);

    // Calculate rebuy amounts
    const rebuyAmounts = await this.calculateRebuyAmounts(swapResults);
    
    if (rebuyAmounts.length === 0) {
      log(`\n❌ No valid rebuy amounts calculated`);
      return { success: false, reason: 'no_rebuy_amounts' };
    }

    log(`\n✅ ${rebuyAmounts.length} wallets ready for REBUY:`);
    rebuyAmounts.forEach(({ walletIndex, rebuyAmount, virtualReceived }) => {
      log(`   💰 B${walletIndex}: ${rebuyAmount.toFixed(6)} VIRTUAL (from ${virtualReceived.toFixed(6)} VIRTUAL received)`);
    });

    // Calculate sell price from swap results
    let totalTokensSwapped = 0;
    let totalVirtualReceived = 0;
    
    swapResults.forEach((result) => {
      if (result.success && result.virtualReceived > 0) {
        totalTokensSwapped += result.tokenAmount || 0;
        totalVirtualReceived += result.virtualReceived || 0;
      }
    });
    
    // Calculate average sell price (VIRTUAL per token)
    const sellPrice = totalTokensSwapped > 0 ? (totalVirtualReceived / totalTokensSwapped) * 1.022 : 0;
    
    if (sellPrice <= 0) {
      log(`❌ Cannot calculate sell price from swap results`);
      return { success: false, reason: 'no_sell_price' };
    }
    
    log(`📊 SELL PRICE FROM SWAP RESULTS:`);
    log(`   🪙 Total tokens swapped: ${totalTokensSwapped.toFixed(6)} ${this.tokenInfo.symbol}`);
    log(`   💰 Total VIRTUAL received: ${totalVirtualReceived.toFixed(6)} VIRTUAL`);
    log(`   💱 Average sell price: ${this.formatPrice(sellPrice)} VIRTUAL per token`);
    
    // Initialize thresholds with calculated sell price
    this.initializeThresholds(sellPrice);
    
    // Start continuous monitoring
    this.running = true;
    
    // Handle Ctrl+C gracefully
    const handleInterrupt = () => {
      log(`\n🛑 REBUY monitoring interrupted by user`);
      this.running = false;
    };
    
    process.on('SIGINT', handleInterrupt);
    process.on('SIGTERM', handleInterrupt);

    try {
      while (this.running) {
        const priceAction = await this.checkPriceAction();
        
        log(`\n⏰ [${new Date().toLocaleTimeString()}] REBUY Price Check`);
        log(`   📊 Current: ${this.formatPrice(priceAction.currentPrice)} VIRTUAL`);
        log(`   📊 Target: ${this.formatPrice(priceAction.targetPrice)} VIRTUAL`);
        
        if (priceAction.action === 'rebuy') {
          log(`   📉 Drop: ${priceAction.dropPercent}% (Target: ${this.rebuyPercentage}%)`);
          log(`\n🎯 REBUY TRIGGER: Price dropped ${priceAction.dropPercent}% to ${this.formatPrice(priceAction.currentPrice)} VIRTUAL`);
          
          // Execute rebuy transactions
          const rebuyResults = await this.executeRebuyTransactions(rebuyAmounts);
          
          // Stop monitoring after rebuy attempt (successful or failed)
          log(`\n🏁 REBUY mode completed. Stopping monitoring.`);
          this.running = false;
          
          return rebuyResults;
          
        } else {
          if (priceAction.priceDirection === 'increased') {
            log(`   📈 Price increased ${priceAction.changePercent}% (waiting for ${this.rebuyPercentage}% drop)`);
          } else {
            log(`   📉 Drop: ${priceAction.dropPercent}% (Target: ${this.rebuyPercentage}%)`);
          }
          log(`   ⏳ Progress: ${priceAction.progress} - Continue monitoring...`);
        }
        
        // Wait for next check
        await sleep(this.intervalMinutes * 60 * 1000);
      }
      
    } catch (error) {
      log(`\n❌ Error in REBUY monitoring: ${error.message}`);
      return { success: false, error: error.message };
    } finally {
      // Remove interrupt handlers
      process.removeListener('SIGINT', handleInterrupt);
      process.removeListener('SIGTERM', handleInterrupt);
    }
    
    return { success: false, reason: 'monitoring_stopped' };
  }

  /**
   * Execute ONLYREBUY mode - Skip selling, monitor price and buy at target
   * @param {number} targetPrice - Target price to buy at (VIRTUAL per token)
   * @param {number} virtualAmountPerWallet - VIRTUAL amount to spend per wallet
   * @returns {Promise<Object>} ONLYREBUY results
   */
  async executeOnlyRebuyMode(targetPrice, virtualAmountPerWallet) {
    log(`\n🎯 ==================== ONLYREBUY MODE ====================`);
    log(`🎯 Token: ${this.tokenInfo.symbol} (${this.tokenInfo.address})`);
    log(`⏰ Monitoring interval: ${this.intervalMinutes} minute(s)`);
    log(`🎯 Target buy price: ${this.formatPrice(targetPrice)} VIRTUAL per ${this.tokenInfo.symbol}`);
    log(`💰 VIRTUAL amount per wallet: ${virtualAmountPerWallet.toFixed(6)} VIRTUAL`);
    log(`👛 Monitoring ${this.wallets.length} wallets`);
    log(`⚠️  Press Ctrl+C to stop ONLYREBUY monitoring`);
    
    // Set target price directly (no sell price calculation needed)
    this.targetPrice = targetPrice;
    
    // Create rebuy amounts for all wallets with the specified amount
    const rebuyAmounts = this.wallets.map((wallet, index) => ({
      walletIndex: index + 1,
      wallet: wallet,
      rebuyAmount: virtualAmountPerWallet,
      virtualReceived: virtualAmountPerWallet // For logging consistency
    }));
    
    log(`\n✅ ${rebuyAmounts.length} wallets ready for ONLYREBUY:`);
    rebuyAmounts.forEach(({ walletIndex, rebuyAmount }) => {
      log(`   💰 B${walletIndex}: ${rebuyAmount.toFixed(6)} VIRTUAL`);
    });
    
    // Start continuous monitoring
    this.running = true;
    
    // Handle Ctrl+C gracefully
    const handleInterrupt = () => {
      log(`\n🛑 ONLYREBUY monitoring interrupted by user`);
      this.running = false;
    };
    
    process.on('SIGINT', handleInterrupt);
    process.on('SIGTERM', handleInterrupt);

    try {
      while (this.running) {
        const currentPrice = await this.getCurrentPrice();
        
        log(`\n⏰ [${new Date().toLocaleTimeString()}] ONLYREBUY Price Check`);
        log(`   📊 Current: ${this.formatPrice(currentPrice)} VIRTUAL`);
        log(`   🎯 Target: ${this.formatPrice(this.targetPrice)} VIRTUAL`);
        
        if (currentPrice <= this.targetPrice) {
          log(`\n🎯 ONLYREBUY TRIGGER: Price reached target ${this.formatPrice(this.targetPrice)} VIRTUAL`);
          log(`   📊 Current price: ${this.formatPrice(currentPrice)} VIRTUAL`);
    
    // Execute rebuy transactions
    const rebuyResults = await this.executeRebuyTransactions(rebuyAmounts);
          
          // Stop monitoring after rebuy attempt (successful or failed)
          log(`\n🏁 ONLYREBUY mode completed. Stopping monitoring.`);
          this.running = false;
    
    return rebuyResults;
          
        } else {
          const priceDiff = ((currentPrice - this.targetPrice) / this.targetPrice * 100).toFixed(2);
          log(`   📈 Price ${priceDiff}% above target - Continue monitoring...`);
        }
        
        // Wait for next check
        await sleep(this.intervalMinutes * 60 * 1000);
      }
      
    } catch (error) {
      log(`\n❌ Error in ONLYREBUY monitoring: ${error.message}`);
      return { success: false, error: error.message };
    } finally {
      // Remove interrupt handlers
      process.removeListener('SIGINT', handleInterrupt);
      process.removeListener('SIGTERM', handleInterrupt);
    }
    
    return { success: false, reason: 'monitoring_stopped' };
  }

  /**
   * Calculate rebuy amounts for each wallet (FIXED FORMULA)
   * @param {Array} swapResults - Results from initial swaps
   * @returns {Promise<Array>} Array of rebuy amounts
   */
  async calculateRebuyAmounts(swapResults) {
    const rebuyAmounts = [];
    
    log(`\n🔢 CALCULATING REBUY AMOUNTS:`);
    log(`📊 Processing ${swapResults.length} swap results for REBUY mode`);
    
    // CORRECT FORMULA: Virtual received * [(100% - x%) + 5%]
    // Example: 5% drop -> (100% - 5%) + 5% = 100% = 1.0 multiplier
    const rebuyMultiplier = (1 - this.rebuyPercentage / 100) + 0.05;
    log(`📈 Rebuy multiplier: ${rebuyMultiplier.toFixed(3)} (${this.rebuyPercentage}% drop threshold + 5% extra)`);
    
    for (let i = 0; i < swapResults.length; i++) {
      const swap = swapResults[i];
      const virtualReceived = swap?.virtualReceived || 0;
      
      if (virtualReceived > 0) {
        const rebuyAmount = virtualReceived * rebuyMultiplier;
        
        if (rebuyAmount > 0.000001) { // Minimum 0.000001 VIRTUAL
          rebuyAmounts.push({
            walletIndex: swap.walletIndex,
            wallet: this.wallets[swap.walletIndex - 1],
            rebuyAmount,
            virtualReceived
          });
          
          log(`✅ B${swap.walletIndex}: ${virtualReceived.toFixed(6)} VIRTUAL received → ${rebuyAmount.toFixed(6)} VIRTUAL rebuy`);
        } else {
          log(`❌ B${swap.walletIndex}: Rebuy amount too small (${rebuyAmount.toFixed(8)} VIRTUAL)`);
        }
      } else {
        log(`❌ B${swap.walletIndex}: No VIRTUAL received from swap`);
      }
    }
    
    log(`📊 Total rebuy amounts calculated: ${rebuyAmounts.length}`);
    return rebuyAmounts;
  }

  /**
   * Check and approve VIRTUAL spending for TRUSTSWAP if needed
   * @param {Array} rebuyAmounts - Array of rebuy amounts per wallet
   * @returns {Promise<void>}
   */
  async checkAndApproveVirtual(rebuyAmounts) {
    log(`\n🔓 CHECKING VIRTUAL APPROVALS FOR TRUSTSWAP:`);
    
    const approvalPromises = [];
    
    for (const { walletIndex, wallet, rebuyAmount } of rebuyAmounts) {
      const approvalPromise = this.checkAndApproveWalletVirtual(wallet, walletIndex, rebuyAmount);
      approvalPromises.push(approvalPromise);
    }
    
    // Execute all approvals in parallel
    const approvalResults = await Promise.allSettled(approvalPromises);
    
    let approvedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    
    approvalResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value.approved) {
          approvedCount++;
        } else {
          skippedCount++;
        }
      } else {
        failedCount++;
        log(`❌ B${rebuyAmounts[index].walletIndex}: Approval failed - ${result.reason}`);
      }
    });
    
    log(`📊 VIRTUAL Approval Summary:`);
    log(`   ✅ Approved: ${approvedCount} wallets`);
    log(`   ⏭️ Skipped: ${skippedCount} wallets (already approved)`);
    log(`   ❌ Failed: ${failedCount} wallets`);
  }

  /**
   * Check and approve VIRTUAL for a single wallet
   * @param {Object} wallet - Wallet instance
   * @param {number} walletIndex - Wallet index
   * @param {number} rebuyAmount - Amount of VIRTUAL to spend
   * @returns {Promise<Object>} Approval result
   */
  async checkAndApproveWalletVirtual(wallet, walletIndex, rebuyAmount) {
    try {
      const virtualContract = new ethers.Contract(VIRTUAL_TOKEN_ADDRESS, ERC20_ABI, wallet.connect(provider));
      
      // Check current allowance
      const currentAllowance = await virtualContract.allowance(wallet.address, TRUSTSWAP_CONTRACT);
      const requiredAmount = ethers.parseUnits(rebuyAmount.toString(), 18);
      
      if (currentAllowance >= requiredAmount) {
        log(`✅ B${walletIndex}: VIRTUAL already approved (${ethers.formatUnits(currentAllowance, 18)} >= ${rebuyAmount.toFixed(6)})`);
        return { approved: false, reason: 'already_approved' };
      }
      
      log(`🔓 B${walletIndex}: Approving UNLIMITED VIRTUAL for TRUSTSWAP...`);
      
      // Approve unlimited VIRTUAL (like other bots do)
      const result = await executeTransactionWithReplacementFee(
        async (provider, gasParams) => {
          const virtualContractWithProvider = new ethers.Contract(
            VIRTUAL_TOKEN_ADDRESS, 
            ERC20_ABI, 
            wallet.connect(provider)
          );
          
          const tx = await virtualContractWithProvider.approve(
            TRUSTSWAP_CONTRACT,
            ethers.MaxUint256, // Unlimited approval
            {
              maxFeePerGas: gasParams.maxFeePerGas,
              maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas
            }
          );
          
          return tx;
        }
      );
      
      log(`✅ B${walletIndex}: VIRTUAL approval successful! TX: ${result.hash}`);
      return { approved: true, txHash: result.hash };
      
    } catch (error) {
      log(`❌ B${walletIndex}: VIRTUAL approval failed - ${error.message}`);
      return { approved: false, error: error.message };
    }
  }

  /**
   * Execute rebuy transactions with retry logic
   * @param {Array} rebuyAmounts - Array of rebuy amounts per wallet
   * @returns {Promise<Object>} Rebuy results
   */
  async executeRebuyTransactions(rebuyAmounts) {
    log(`\n💰 EXECUTING REBUY TRANSACTIONS:`);
    
    // First, check and approve VIRTUAL spending
    await this.checkAndApproveVirtual(rebuyAmounts);
    
    const results = [];
    let successCount = 0;
    
    for (let i = 0; i < rebuyAmounts.length; i++) {
      const { walletIndex, wallet, rebuyAmount } = rebuyAmounts[i];
      
      log(`\n🔄 Wallet B${walletIndex}: Buying ${this.tokenInfo.symbol} with ${rebuyAmount.toFixed(6)} VIRTUAL...`);
      
      let success = false;
      let lastError = null;
      
      // Retry logic (max 3 attempts)
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          log(`   🔄 Attempt ${attempt}/${this.maxRetries}...`);
          
          const result = await this.executeRebuySwap(wallet, rebuyAmount);
          
          if (result.success) {
            log(`   ✅ B${walletIndex}: Rebuy successful! TX: ${result.txHash}`);
            log(`   📊 Received: ${result.tokensReceived.toFixed(6)} ${this.tokenInfo.symbol}`);
            
            results.push({
              walletIndex,
              success: true,
              txHash: result.txHash,
              tokensReceived: result.tokensReceived,
              virtualSpent: rebuyAmount
            });
            
            success = true;
            successCount++;
            break;
          } else {
            lastError = result.error;
            log(`   ❌ B${walletIndex}: Attempt ${attempt} failed: ${result.error}`);
            
            if (attempt < this.maxRetries) {
              log(`   ⏳ Retrying in 5 seconds...`);
              await sleep(5000);
            }
          }
        } catch (error) {
          lastError = error.message;
          log(`   ❌ B${walletIndex}: Attempt ${attempt} error: ${error.message}`);
          
          if (attempt < this.maxRetries) {
            log(`   ⏳ Retrying in 5 seconds...`);
            await sleep(5000);
          }
        }
      }
      
      if (!success) {
        log(`   💥 B${walletIndex}: All ${this.maxRetries} attempts failed. Final error: ${lastError}`);
        results.push({
          walletIndex,
          success: false,
          error: lastError
        });
      }
    }
    
    // Final summary
    log(`\n📊 REBUY TRANSACTION SUMMARY:`);
    log(`   ✅ Successful: ${successCount}/${rebuyAmounts.length} wallets`);
    log(`   ❌ Failed: ${rebuyAmounts.length - successCount}/${rebuyAmounts.length} wallets`);
    
    return {
      success: successCount > 0,
      totalWallets: rebuyAmounts.length,
      successfulWallets: successCount,
      failedWallets: rebuyAmounts.length - successCount,
      results
    };
  }

  /**
   * Execute a single rebuy swap using TRUSTSWAP contract
   * @param {Object} wallet - Wallet instance
   * @param {number} virtualAmount - Amount of VIRTUAL to spend
   * @returns {Promise<Object>} Swap result
   */
  async executeRebuySwap(wallet, virtualAmount) {
    try {
      // Get token balance before transaction
      const tokenContract = new ethers.Contract(this.tokenInfo.address, ERC20_ABI, wallet.connect(provider));
      const tokenBalanceBefore = await tokenContract.balanceOf(wallet.address);
      
      const result = await executeTransactionWithReplacementFee(
        async (provider, gasParams) => {
          const trustswapContract = new ethers.Contract(
            TRUSTSWAP_CONTRACT,
            TRUSTSWAP_ABI,
            wallet.connect(provider)
          );
          
          const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
          const virtualAmountWei = ethers.parseUnits(virtualAmount.toString(), 18);
          
          // Execute swap: VIRTUAL -> Token
          const tx = await trustswapContract.swapVirtualWithFee(
            virtualAmountWei,
            0, // Accept any amount of tokens
            this.tokenInfo.address,
            deadline,
            {
              maxFeePerGas: gasParams.maxFeePerGas,
              maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas
            }
          );
          
          // Return the transaction object (not the result)
          return tx;
        }
      );
      
      // Calculate tokens received after transaction
      const tokenBalanceAfter = await tokenContract.balanceOf(wallet.address);
      const tokensReceived = parseFloat(ethers.formatUnits(tokenBalanceAfter - tokenBalanceBefore, this.tokenInfo.decimals));
      
      return {
        success: true,
        txHash: result.hash,
        blockNumber: result.receipt.blockNumber,
        tokensReceived
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
} 