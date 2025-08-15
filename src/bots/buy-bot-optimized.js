/**
 * Optimized BuyBot Class
 * Refactored version using modular services
 */

import { ethers } from 'ethers';
import { provider, executeTransactionWithReplacementFee } from '../config.js';
import { log, sleep, getRandomInt } from '../utils.js';
import { CLIInterface } from './services/cliInterface.js';
import { CONTRACTS, ABIS, DEFAULT_SETTINGS } from './config/constants.js';
import { gasPriceService } from '../providers/gasPriceService.js';

/**
 * BuyBot - Executes buy operations for tokens
 */
export class BuyBot {
  constructor(wallets, tokenInfo, inputTokenAddress, defaultSettings, customGasPrice = null) {
    this.wallets = wallets;
    this.tokenInfo = tokenInfo; // Token to buy (output)
    this.inputTokenAddress = inputTokenAddress; // Token to sell (input) - can be VIRTUAL, ETH (zero), or other token
    this.defaultSettings = defaultSettings;
    this.customGasPrice = customGasPrice; // Store custom gas price for later use
    this.useDynamicGas = !customGasPrice; // Use dynamic gas if no custom price specified
    
    // Determine input token symbol for logging
    this.inputTokenSymbol = this.getInputTokenSymbol();
    
    // CLI interface for interactive modes
    this.cli = new CLIInterface();
  }
  
  /**
   * Get input token symbol for logging
   * @returns {string} Input token symbol
   */
  getInputTokenSymbol() {
    // Check if input is ETH (zero address)
    if (this.inputTokenAddress === ethers.ZeroAddress) {
      return 'ETH';
    }
    
    // Check if input is VIRTUAL
    if (this.inputTokenAddress.toLowerCase() === CONTRACTS.VIRTUAL.toLowerCase()) {
      return 'VIRTUAL';
    }
    
    // For other tokens, return the address (could be enhanced to fetch symbol)
    return this.inputTokenAddress.slice(0, 8) + '...';
  }

  /**
   * Get the actual token address for swap path (WETH for ETH, actual address for others)
   * @returns {string} Swap token address
   */
  getSwapTokenAddress() {
    // For ETH (zero address), use WETH in swap path
    if (this.inputTokenAddress === ethers.ZeroAddress) {
      return CONTRACTS.WETH;
    }
    
    // For other tokens, use the actual address
    return this.inputTokenAddress;
  }

  /**
   * Check if this is an ETH swap
   * @returns {boolean} True if ETH swap
   */
  isETHSwap() {
    return this.inputTokenAddress === ethers.ZeroAddress;
  }

  /**
   * Get gas price for transactions
   * @returns {Promise<BigInt>} Gas price in wei
   */
  async getGasPrice() {
    if (this.useDynamicGas) {
      // Use Alchemy dynamic gas pricing
      const gasPrice = await gasPriceService.getLegacyGasPrice();
      const breakdown = await gasPriceService.getGasPriceBreakdown();
      console.log(`⛽ Dynamic Gas: ${breakdown.baseGasPrice} gwei (Alchemy) + ${breakdown.priorityFee} gwei (${breakdown.priorityPercentage}% priority) = ${breakdown.totalGasPrice} gwei`);
      return gasPrice;
    } else {
      // Use custom gas price
      const gasPrice = ethers.parseUnits(this.customGasPrice, 'gwei');
      console.log(`⛽ Custom Gas: ${this.customGasPrice} gwei`);
      return gasPrice;
    }
  }

  /**
   * Check and approve input token spending (skip for ETH)
   * @param {Object} wallet - Wallet instance
   * @param {number} amount - Amount to approve
   * @returns {boolean} True if approval was needed and executed
   */
  async checkAndApproveInput(wallet, amount) {
    // Skip approval for ETH
    if (this.isETHSwap()) {
      return false;
    }
    
    const inputDecimals = this.inputTokenAddress.toLowerCase() === CONTRACTS.VIRTUAL.toLowerCase() ? 18 : 18; // Assume 18 decimals for now
    
    const inputContract = new ethers.Contract(
      this.inputTokenAddress,
      ABIS.ERC20_MINIMAL,
      wallet
    );

    const currentAllowance = await inputContract.allowance(wallet.address, CONTRACTS.TRUSTSWAP);
    // SURGICAL FIX: Truncate amount to 12 decimals to prevent NUMERIC_FAULT in TWAP mode
    const truncatedAmount = parseFloat(amount.toFixed(12)).toString();
    const amountWei = ethers.parseUnits(truncatedAmount, inputDecimals);

    if (currentAllowance < amountWei) {
      console.log(`   🔓 Approving UNLIMITED ${this.inputTokenSymbol} for TRUSTSWAP (${wallet.address.slice(0, 8)})...`);
      
      // Use replacement fee handler for approval transaction
      await executeTransactionWithReplacementFee(
        async (currentProvider, gasParams) => {
          const walletWithProvider = wallet.connect(currentProvider);
          const contractWithProvider = inputContract.connect(walletWithProvider);
          
          return await contractWithProvider.approve(CONTRACTS.TRUSTSWAP, ethers.MaxUint256, {
            maxFeePerGas: gasParams.maxFeePerGas,
            maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
            gasLimit: 200000n
          });
        }
      );
      
      console.log(`   ✅ ${this.inputTokenSymbol} UNLIMITED TRUSTSWAP approval confirmed`);
      return true;
    }
    return false;
  }

  /**
   * Get input token balance (ETH or token)
   * @param {Object} wallet - Wallet instance
   * @returns {number} Balance
   */
  async getInputBalance(wallet) {
    if (this.isETHSwap()) {
      // Get ETH balance
      const balance = await provider.getBalance(wallet.address);
      return parseFloat(ethers.formatEther(balance));
    } else {
      // Get token balance
      const inputDecimals = this.inputTokenAddress.toLowerCase() === CONTRACTS.VIRTUAL.toLowerCase() ? 18 : 18; // Assume 18 decimals for now
      const inputContract = new ethers.Contract(
        this.inputTokenAddress,
        ABIS.ERC20_MINIMAL,
        provider
      );
      const balance = await inputContract.balanceOf(wallet.address);
      return parseFloat(ethers.formatUnits(balance, inputDecimals));
    }
  }

  /**
   * Calculate amount out with slippage
   * @param {number} amountIn - Input amount
   * @param {number} slippage - Slippage percentage
   * @returns {Object} Calculation results
   */
  async calculateAmountOut(amountIn, slippage) {
    // Check if poolAddress exists before doing pool calculations
    if (!this.tokenInfo.poolAddress) {
      console.log(`   ⚠️ No pool address available - using TRUSTSWAP delegation mode`);
      // Return dummy values for TRUSTSWAP delegation mode
      // TRUSTSWAP will handle the calculations internally
      return {
        expectedOut: amountIn * 0.95, // Rough estimate (95% due to slippage/fees)
        // SURGICAL FIX: Truncate to 12 decimals to prevent NUMERIC_FAULT in TWAP mode
        minAmountOut: ethers.parseUnits(parseFloat((amountIn * 0.9).toFixed(12)).toString(), this.tokenInfo.decimals), // 90% for safety
        minAmountOutFormatted: amountIn * 0.9
      };
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

    const [reserve0, reserve1] = await pairContract.getReserves();
    const token0 = await pairContract.token0();
    
    // Use WETH address for ETH comparisons
    const swapTokenAddress = this.getSwapTokenAddress();
    const inputIsToken0 = token0.toLowerCase() === swapTokenAddress.toLowerCase();

    const inputReserve = inputIsToken0 ? reserve0 : reserve1;
    const outputReserve = inputIsToken0 ? reserve1 : reserve0;

    // Calculate output using AMM formula (compatible with V2-style pools)
    const inputDecimals = this.isETHSwap() ? 18 : 18; // ETH and most tokens use 18 decimals
    // SURGICAL FIX: Truncate to 12 decimals to prevent NUMERIC_FAULT in TWAP mode
    const truncatedAmountIn = parseFloat(amountIn.toFixed(12)).toString();
    const amountInWei = ethers.parseUnits(truncatedAmountIn, inputDecimals);
    const amountInWithFee = amountInWei * 997n;
    const numerator = amountInWithFee * outputReserve;
    const denominator = inputReserve * 1000n + amountInWithFee;
    const amountOut = numerator / denominator;

    // Apply slippage
    const slippageMultiplier = (100 - slippage) / 100;
    const minAmountOut = amountOut * BigInt(Math.floor(slippageMultiplier * 10000)) / 10000n;

    return {
      expectedOut: parseFloat(ethers.formatUnits(amountOut, this.tokenInfo.decimals)),
      minAmountOut: minAmountOut,
      minAmountOutFormatted: parseFloat(ethers.formatUnits(minAmountOut, this.tokenInfo.decimals))
    };
  }

  /**
   * Execute single buy transaction
   * @param {Object} wallet - Wallet instance
   * @param {number} inputAmount - Input amount
   * @param {number} slippage - Slippage percentage
   * @returns {Object} Transaction result
   */
  async executeBuy(wallet, inputAmount, slippage) {
    try {
      // Check input token balance
      const balance = await this.getInputBalance(wallet);
      if (balance < inputAmount) {
        return {
          success: false,
          reason: 'insufficient_balance',
          wallet: wallet.address.slice(0, 8),
          required: inputAmount,
          available: balance,
          error: `Insufficient balance: need ${inputAmount}, have ${balance.toFixed(6)}`
        };
      }

      // Get token balance BEFORE transaction
      const tokenContract = new ethers.Contract(
        this.tokenInfo.address,
        ABIS.ERC20_MINIMAL,
        provider
      );
      const tokenBalanceBefore = await tokenContract.balanceOf(wallet.address);

      // Check and approve if needed (skip for ETH)
      await this.checkAndApproveInput(wallet, inputAmount);

      // Calculate minimum amount out
      const { expectedOut, minAmountOut, minAmountOutFormatted } = await this.calculateAmountOut(inputAmount, slippage);

      // Prepare TRUSTSWAP swap
      const trustSwap = new ethers.Contract(CONTRACTS.TRUSTSWAP, ABIS.TRUSTSWAP, wallet);
      const deadline = Math.floor(Date.now() / 1000) + DEFAULT_SETTINGS.TRANSACTION_DEADLINE;
      const inputDecimals = this.isETHSwap() ? 18 : 18;
      // SURGICAL FIX: Truncate to 12 decimals to prevent NUMERIC_FAULT in TWAP mode
      const truncatedInputAmount = parseFloat(inputAmount.toFixed(12)).toString();
      const amountInWei = ethers.parseUnits(truncatedInputAmount, inputDecimals);

      console.log(`   💰 Buying ${this.tokenInfo.symbol} with ${inputAmount} ${this.inputTokenSymbol} (TRUSTSWAP)`);
      console.log(`   📈 Expected: ~${expectedOut.toFixed(4)} ${this.tokenInfo.symbol}`);
      console.log(`   🛡️ Min out: ${minAmountOutFormatted.toFixed(4)} ${this.tokenInfo.symbol} (${slippage}% slippage)`);
      console.log(`   💱 Method: TRUSTSWAP contract (0.25% fee)`);

      // Execute swap with replacement fee handler
      const swapResult = await executeTransactionWithReplacementFee(
        async (currentProvider, gasParams) => {
          const walletWithProvider = wallet.connect(currentProvider);
          const trustSwapWithProvider = trustSwap.connect(walletWithProvider);
          
          // Handle missing gasParams by using bot's own gas logic
          let gasOptions;
          if (gasParams && gasParams.maxFeePerGas) {
            // Use gasParams from config.js (new way)
            gasOptions = {
              maxFeePerGas: gasParams.maxFeePerGas,
              maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
              gasLimit: DEFAULT_SETTINGS.DEFAULT_GAS_LIMIT
            };
            
            // Log gas usage with detailed console logging for visibility
            const maxFeeGwei = ethers.formatUnits(gasParams.maxFeePerGas, 'gwei');
            const priorityGwei = ethers.formatUnits(gasParams.maxPriorityFeePerGas, 'gwei');
            console.log(`⛽ BuyBot Transaction: Using gasParams - maxFee: ${maxFeeGwei} gwei, priority: ${priorityGwei} gwei`);
            
            // Also add to detailed console if available
            if (typeof window !== 'undefined' && window.addConsoleMessage) {
              window.addConsoleMessage(`⛽ BuyBot Transaction: Using ${maxFeeGwei} gwei maxFee + ${priorityGwei} gwei priority`, 'info');
            }
          } else {
            // Use bot's own gas logic (original way)
            const gasPrice = await this.getGasPrice();
            gasOptions = {
              gasPrice: gasPrice,
              gasLimit: DEFAULT_SETTINGS.DEFAULT_GAS_LIMIT
            };
            
            const gasPriceGwei = ethers.formatUnits(gasPrice, 'gwei');
            console.log(`⛽ BuyBot Transaction: Using dynamic gas ${gasPriceGwei} gwei (from gas helper)`);
            
            // Also add to detailed console if available
            if (typeof window !== 'undefined' && window.addConsoleMessage) {
              window.addConsoleMessage(`⛽ BuyBot Transaction: Using dynamic gas ${gasPriceGwei} gwei (from gas helper)`, 'info');
            }
          }
          
          let swapTx;
          
          if (this.isETHSwap()) {
            // ETH → Token using TRUSTSWAP (ETH → WETH → VIRTUAL → Token) 
            // For BuyBot, we assume input is always VIRTUAL, so this should use swapVirtualWithFee
            swapTx = await trustSwapWithProvider.swapVirtualWithFee(
              amountInWei,
              minAmountOut,
              this.tokenInfo.address,
              deadline,
              gasOptions
            );
          } else {
            // VIRTUAL → Token or Token → Token using TRUSTSWAP
            if (this.inputTokenAddress.toLowerCase() === CONTRACTS.VIRTUAL.toLowerCase()) {
              // VIRTUAL → Token using TRUSTSWAP
              swapTx = await trustSwapWithProvider.swapVirtualWithFee(
                amountInWei,
                minAmountOut,
                this.tokenInfo.address,
                deadline,
                gasOptions
              );
            } else {
              // Token → VIRTUAL using TRUSTSWAP (then would need VIRTUAL → target token, but this is single swap)
              // For now, assume this is Token → VIRTUAL for the target token via swapForVirtualWithFee
              swapTx = await trustSwapWithProvider.swapForVirtualWithFee(
                this.inputTokenAddress,
                amountInWei,
                minAmountOut,
                deadline,
                gasOptions
              );
            }
          }

          console.log(`   📝 TRUSTSWAP Transaction: ${swapTx.hash}`);
          
          return swapTx;
        }
      );

      // Get token balance AFTER transaction to calculate actual tokens received
      const tokenBalanceAfter = await tokenContract.balanceOf(wallet.address);
      const tokensReceived = parseFloat(ethers.formatUnits(
        tokenBalanceAfter - tokenBalanceBefore, 
        this.tokenInfo.decimals
      ));

      console.log(`   🎯 Actual tokens received: ${tokensReceived.toFixed(6)} ${this.tokenInfo.symbol}`);

      return {
        success: true,
        wallet: wallet.address.slice(0, 8),
        inputSpent: inputAmount,
        inputSymbol: this.inputTokenSymbol,
        expectedTokens: expectedOut,
        tokensReceived: tokensReceived, // Now returning actual received amount
        txHash: swapResult.hash,
        gasUsed: swapResult.receipt.gasUsed.toString()
      };

    } catch (error) {
      console.log(`   ❌ Buy failed: ${error.message}`);
      return {
        success: false,
        reason: 'transaction_failed',
        wallet: wallet.address.slice(0, 8),
        error: error.message
      };
    }
  }

  /**
   * Default buy mode
   * @returns {Array} Results
   */
  async runDefaultMode() {
    // Clear any cached TWAP parameters to prevent state persistence
    this.twapParams = null;
    this.lastTwapConfig = null;
    this.twapDuration = null;
    this.twapAmount = null;
    this.cli.showSection('DEFAULT BUY MODE', '🎯');

    // Get user input
    const virtualAmountInput = await this.cli.askQuestion('Enter VIRTUAL amount to spend (or press Enter for auto): ');
    const slippage = await this.cli.askNumber(
      `Enter slippage %`, 
      this.defaultSettings.MAX_SLIPPAGE_PERCENT
    );

    let virtualAmount;
    if (virtualAmountInput) {
      virtualAmount = parseFloat(virtualAmountInput);
    } else {
      // Use percentage of balance
      const wallet = this.wallets[0];
      const balance = await this.getInputBalance(wallet);
      const minPercent = this.defaultSettings.VIRTUAL_AMOUNT_MIN_PERCENT;
      const maxPercent = this.defaultSettings.VIRTUAL_AMOUNT_MAX_PERCENT;
      const randomPercent = minPercent + Math.random() * (maxPercent - minPercent);
      virtualAmount = balance * (randomPercent / 100);
      console.log(`\n💡 Auto amount: ${virtualAmount.toFixed(4)} VIRTUAL (${randomPercent.toFixed(2)}% of balance)`);
    }

    console.log(`\n🚀 Starting buy operations...`);
    console.log(`💰 Amount: ${virtualAmount} VIRTUAL per wallet`);
    console.log(`🛡️ Slippage: ${slippage}%`);
    console.log(`👛 Wallets: ${this.wallets.length}`);

    const results = [];

    for (let i = 0; i < this.wallets.length; i++) {
      const wallet = this.wallets[i];
      console.log(`\n👛 Wallet ${i + 1}/${this.wallets.length}: ${wallet.address.slice(0, 8)}...`);

      const result = await this.executeBuy(wallet, virtualAmount, slippage);
      results.push(result);

      // Delay between transactions
      if (i < this.wallets.length - 1) {
        const delay = getRandomInt(
          this.defaultSettings.DELAY_BETWEEN_TXS_MIN, 
          this.defaultSettings.DELAY_BETWEEN_TXS_MAX
        );
        console.log(`   ⏳ Waiting ${delay}s before next transaction...`);
        await sleep(delay * 1000);
      }
    }

    // Summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    this.cli.showSection('SUMMARY', '📊');
    console.log(`✅ Successful: ${successful}/${this.wallets.length}`);
    console.log(`❌ Failed: ${failed}/${this.wallets.length}`);

    return results;
  }

  /**
   * Get dynamic gas price using gasPriceService (matches SwapExecutor pattern)
   * @returns {Promise<BigInt>} Gas price in wei
   */
  async getGasPrice() {
    try {
      // Use the same gas service as SwapExecutor for consistency
      return await gasPriceService.getLegacyGasPrice();
    } catch (error) {
      console.log(`⚠️ Dynamic gas failed, using fallback: ${error.message}`);
      // Fallback to 0.02 gwei if dynamic gas fails
      return ethers.parseUnits('0.06', 'gwei');
    }
  }

  /**
   * TWAP buy mode
   * @returns {Array} Results
   */
  async runTwapMode() {
    this.cli.showSection('TWAP BUY MODE', '📈');

    const amountInput = await this.cli.askQuestion('Enter total amount (number for VIRTUAL or % for percentage, e.g., "100" or "50%"): ');
    const hours = await this.cli.askNumber('Enter duration in hours');
    const slippage = await this.cli.askNumber(
      `Enter slippage %`, 
      this.defaultSettings.MAX_SLIPPAGE_PERCENT
    );

    // Parse amount (percentage or absolute)
    let totalVirtualAmount;
    let isPercentage = false;

    if (amountInput.includes('%')) {
      isPercentage = true;
      const percentage = parseFloat(amountInput.replace('%', ''));
      const wallet = this.wallets[0]; // Use first wallet for balance reference
      const balance = await this.getInputBalance(wallet);
      totalVirtualAmount = balance * (percentage / 100);
      console.log(`\n💡 ${percentage}% of balance = ${totalVirtualAmount.toFixed(4)} VIRTUAL`);
    } else {
      totalVirtualAmount = parseFloat(amountInput);
    }

    const totalSeconds = hours * 3600;
    const numTransactions = Math.max(10, Math.floor(totalSeconds / 300)); // At least 10 transactions, max 1 every 5 minutes
    const baseAmountPerTx = totalVirtualAmount / numTransactions;
    const baseDelaySeconds = totalSeconds / numTransactions;

    console.log(`\n🎯 TWAP Configuration:`);
    console.log(`💰 Total amount: ${totalVirtualAmount.toFixed(4)} VIRTUAL`);
    console.log(`⏰ Duration: ${hours} hours`);
    console.log(`📊 Transactions: ${numTransactions}`);
    console.log(`💵 Base amount per TX: ${baseAmountPerTx.toFixed(4)} VIRTUAL`);
    console.log(`⏳ Base delay: ${Math.round(baseDelaySeconds)}s`);
    console.log(`🛡️ Slippage: ${slippage}%`);

    const confirm = await this.cli.askConfirmation('\nProceed with TWAP?');
    if (!confirm) {
      console.log('❌ TWAP cancelled');
      return [];
    }

    console.log(`\n🚀 Starting TWAP buy operations...`);

    const results = [];
    let remainingAmount = totalVirtualAmount;

    for (let i = 0; i < numTransactions && remainingAmount > 0; i++) {
      console.log(`\n📊 TWAP Transaction ${i + 1}/${numTransactions}`);

      // Add randomness to amount (±20%)
      const randomMultiplier = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
      let currentAmount = Math.min(baseAmountPerTx * randomMultiplier, remainingAmount);

      // Ensure minimum amount
      if (currentAmount < 0.001) {
        console.log('   ⚠️ Amount too small, skipping...');
        break;
      }

      // Random wallet selection
      const wallet = this.wallets[Math.floor(Math.random() * this.wallets.length)];
      console.log(`👛 Selected wallet: ${wallet.address.slice(0, 8)}...`);

      const result = await this.executeBuy(wallet, currentAmount, slippage);
      results.push(result);

      remainingAmount -= currentAmount;

      // Random delay (±30% of base delay)
      if (i < numTransactions - 1 && remainingAmount > 0) {
        const randomDelayMultiplier = 0.7 + Math.random() * 0.6; // 0.7 to 1.3
        const delay = Math.round(baseDelaySeconds * randomDelayMultiplier);
        console.log(`   ⏳ Next transaction in ${delay}s... (Remaining: ${remainingAmount.toFixed(4)} VIRTUAL)`);
        await sleep(delay * 1000);
      }
    }

    // Summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalSpent = results.filter(r => r.success).reduce((sum, r) => sum + r.inputSpent, 0);

    this.cli.showSection('TWAP SUMMARY', '📊');
    console.log(`✅ Successful: ${successful}/${results.length}`);
    console.log(`❌ Failed: ${failed}/${results.length}`);
    console.log(`💰 Total spent: ${totalSpent.toFixed(4)} VIRTUAL`);
    console.log(`🎯 Target was: ${totalVirtualAmount.toFixed(4)} VIRTUAL`);

    return results;
  }

  /**
   * Start the buy bot
   * @returns {Array} Results
   */
  async start() {
    console.log(`\n🟢 BUYBOT - ${this.tokenInfo.symbol} (TRUSTSWAP)`);
    console.log('==========================================');
    console.log(`📍 Token: ${this.tokenInfo.symbol} (${this.tokenInfo.name})`);
    console.log(`📄 Contract: ${this.tokenInfo.address}`);
    console.log(`🏊 Pool: ${this.tokenInfo.poolAddress}`);
    console.log(`👛 Wallets: ${this.wallets.length}`);
    console.log(`💱 Trading: TRUSTSWAP contract (0.25% fee)`);

    const mode = await this.cli.askChoice('SELECT MODE:', [
      { value: 'default', label: '🎯 Default - Buy once with specified amount' },
      { value: 'twap', label: '📈 TWAP - Time-weighted average buying' }
    ]);

    try {
      let results;
      switch (mode) {
        case 'default':
          results = await this.runDefaultMode();
          break;
        case 'twap':
          results = await this.runTwapMode();
          break;
        default:
          throw new Error(`Unknown mode: ${mode}`);
      }
      
      return results;
    } finally {
      // Always close CLI interface
      this.cli.close();
    }
  }
} 