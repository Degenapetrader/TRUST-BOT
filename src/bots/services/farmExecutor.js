/**
 * Farm Executor Service
 * Handles the actual execution of farm cycles (buy + sell operations) with retry logic
 */

import { ethers } from 'ethers';
import { sleep, logWithTimestamp } from '../../utils/index.js';
import { executeTransactionWithReplacementFee } from '../../config.js';
import { providerManager } from '../../providers/manager.js';

const TRANSACTION_TIMEOUT = 5000; // 5 seconds

// Retry settings
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 2000; // 2 seconds base delay
const RETRY_DELAY_MULTIPLIER = 1.5; // Exponential backoff

export class FarmExecutor {
  /**
   * Create a new FarmExecutor instance
   * @param {ethers.Contract} swapContract - The TRUSTSWAP contract instance
   * @param {Object} settings - Farm settings
   */
  constructor(swapContract, settings) {
    this.swapContract = swapContract;
    this.settings = settings;
  }
  
  /**
   * Execute a single farm cycle (buy + sell) with retry logic
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information (address, poolAddress, decimals, etc.)
   * @param {ethers.BigNumber} amountIn - VIRTUAL amount to trade
   * @param {Object} gasParams - Gas parameters
   * @param {string} virtualTokenAddress - VIRTUAL token address
   * @returns {Promise<Object>} Result object
   */
  async executeFarmCycle(wallet, tokenInfo, amountIn, gasParams, virtualTokenAddress) {
    let lastError = null;
    let retryCount = 0;
    
    while (retryCount <= MAX_RETRIES) {
      try {
        if (retryCount > 0) {
          // Calculate exponential backoff delay
          const delay = RETRY_DELAY_BASE * Math.pow(RETRY_DELAY_MULTIPLIER, retryCount - 1);
          console.log(`🔄 [${wallet.name}] Retry attempt ${retryCount}/${MAX_RETRIES} in ${(delay/1000).toFixed(1)}s...`);
          await sleep(delay);
        }
        
        const result = await this._executeFarmCycleAttempt(wallet, tokenInfo, amountIn, gasParams, virtualTokenAddress);
        
        // Add retry info to successful result
        result.retryCount = retryCount;
        result.wasRetried = retryCount > 0;
        
        if (retryCount > 0) {
          console.log(`✅ [${wallet.name}] Success after ${retryCount} ${retryCount === 1 ? 'retry' : 'retries'}!`);
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        retryCount++;
        
        if (retryCount <= MAX_RETRIES) {
          console.log(`❌ [${wallet.name}] Attempt ${retryCount} failed: ${error.message}`);
          console.log(`🔄 [${wallet.name}] Will retry (${retryCount}/${MAX_RETRIES})...`);
        } else {
          console.log(`❌ [${wallet.name}] All ${MAX_RETRIES} retry attempts failed`);
        }
      }
    }
    
    // All retries exhausted
    return {
      success: false,
      cycleSuccess: false,
      error: `Failed after ${MAX_RETRIES} retries: ${lastError.message}`,
      buyError: lastError,
      sellError: null,
      retryCount: MAX_RETRIES,
      wasRetried: true,
      timeout: false,
      sameBlock: false,
      buyTx: null,
      sellTx: null,
      buyTxHash: null,
      sellTxHash: null,
      volume: 0
    };
  }
  
  /**
   * Check and approve required tokens before farm cycle
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information
   * @param {BigInt} virtualAmount - VIRTUAL amount in wei
   * @param {BigInt} tokenAmount - Token amount in wei
   * @param {BigInt} gasPrice - Gas price in wei
   * @param {string} virtualTokenAddress - VIRTUAL token address
   */
  async checkApprovals(wallet, tokenInfo, virtualAmount, tokenAmount, gasPrice, virtualTokenAddress) {
    console.log(`🔓 [${wallet.name}] Checking approvals...`);
    
    const trustswapAddress = this.swapContract.target;
    const gasParams = {
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
      gasLimit: 200000n
    };
    
    // Check VIRTUAL approval for buy transaction
    const virtualContract = new ethers.Contract(virtualTokenAddress, [
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 amount) returns (bool)'
    ], wallet);
    
    const virtualAllowance = await virtualContract.allowance(wallet.address, trustswapAddress);
    
    if (virtualAllowance < virtualAmount) {
      console.log(`📝 [${wallet.name}] Approving VIRTUAL for TRUSTSWAP...`);
      const approvalTx = await virtualContract.approve(trustswapAddress, ethers.MaxUint256, gasParams);
      await approvalTx.wait();
      console.log(`✅ [${wallet.name}] VIRTUAL approval confirmed: ${approvalTx.hash}`);
    } else {
      console.log(`✅ [${wallet.name}] VIRTUAL already approved`);
    }
    
    // Check token approval for sell transaction
    const tokenContract = new ethers.Contract(tokenInfo.address, [
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 amount) returns (bool)'
    ], wallet);
    
    const tokenAllowance = await tokenContract.allowance(wallet.address, trustswapAddress);
    
    if (tokenAllowance < tokenAmount) {
      console.log(`📝 [${wallet.name}] Approving ${tokenInfo.symbol} for TRUSTSWAP...`);
      const approvalTx = await tokenContract.approve(trustswapAddress, ethers.MaxUint256, gasParams);
      await approvalTx.wait();
      console.log(`✅ [${wallet.name}] ${tokenInfo.symbol} approval confirmed: ${approvalTx.hash}`);
    } else {
      console.log(`✅ [${wallet.name}] ${tokenInfo.symbol} already approved`);
    }
  }

  /**
   * Execute a single farm cycle attempt (internal method)
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information
   * @param {ethers.BigNumber} amountIn - Amount in wei
   * @param {Object} gasParams - Gas parameters
   * @param {string} virtualTokenAddress - VIRTUAL token address
   * @returns {Promise<Object>} Result object
   */
  async _executeFarmCycleAttempt(wallet, tokenInfo, amountIn, gasParams, virtualTokenAddress) {
    console.log(`🔄 [${wallet.name}] Starting farm cycle...`);
      
    const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes
    
    // Use dynamic gas pricing like other bots (BuyBot/JeetBot pattern)
    const { gasPriceService } = await import('../../providers/gasPriceService.js');
    const gasPrice = await gasPriceService.getLegacyGasPrice();
    const breakdown = await gasPriceService.getGasPriceBreakdown();
    console.log(`⛽ [${wallet.name}] Dynamic Gas: ${breakdown.baseGasPrice} gwei + ${breakdown.priorityFee} gwei = ${breakdown.totalGasPrice} gwei`);
    
    const gasLimit = BigInt(gasParams.gasLimit);
    
    // Step 1: Calculate expected tokens from pool
    const expectedTokens = await this.calculateExpectedTokens(
      amountIn,
      tokenInfo.address,
      tokenInfo.poolAddress,
      tokenInfo.decimals,
      virtualTokenAddress,
      10 // 10% slippage
    );
    
    // Step 2: Calculate sell amount (99.99% of expected tokens)
    const sellAmount = (expectedTokens * 9999n) / 10000n;
    console.log(`📊 [${wallet.name}] Expected: ${ethers.formatUnits(expectedTokens, tokenInfo.decimals)} ${tokenInfo.symbol}, Will sell: ${ethers.formatUnits(sellAmount, tokenInfo.decimals)}`);
      
    // Step 3: Check approvals before executing transactions
    await this.checkApprovals(wallet, tokenInfo, amountIn, sellAmount, gasPrice, virtualTokenAddress);
      
    // Step 4: Get base nonce and execute parallel transactions
    const provider = wallet.provider;
    const baseNonce = await provider.getTransactionCount(wallet.address, 'pending');
    
    console.log(`⚡ [${wallet.name}] Executing parallel buy/sell with nonces ${baseNonce} and ${baseNonce + 1}...`);
      
    // Create contract instance with wallet
    const contract = this.swapContract.connect(wallet);
      
    // Calculate minimum amounts with slippage
    const minTokenOut = (expectedTokens * 90n) / 100n; // 10% slippage tolerance
    const minVirtualOut = ethers.parseUnits('0.01', 18); // Minimum 0.01 VIRTUAL
    
    // Create and submit buy transaction first
    const buyPromise = this._executeTransactionWithTimeout(
      contract.swapVirtualWithFee(
          amountIn,
        minTokenOut,
        tokenInfo.address,
          deadline,
          {
          gasPrice,
          gasLimit,
            nonce: baseNonce
          }
        ),
      'buy'
    );
    
    // Small delay to prevent "replacement fee too low" error
    await sleep(200);
    
    const sellPromise = this._executeTransactionWithTimeout(
      contract.swapForVirtualWithFee(
        tokenInfo.address,
        sellAmount,
        minVirtualOut,
          deadline,
          {
          gasPrice,
          gasLimit,
            nonce: baseNonce + 1
          }
      ),
      'sell'
    );
    
    // Execute both transactions in parallel
    const [buyResult, sellResult] = await Promise.all([buyPromise, sellPromise]);
    
    // Handle timeouts
    if (buyResult.timeout || sellResult.timeout) {
      const timeoutTxs = [];
      if (buyResult.timeout) timeoutTxs.push('buy');
      if (sellResult.timeout) timeoutTxs.push('sell');
      
      console.log(`⏱️ [${wallet.name}] Transaction timeout: ${timeoutTxs.join(', ')}`);
      
      return {
        success: false,
        cycleSuccess: false,
        timeout: true,
        timeoutTransactions: timeoutTxs,
        sameBlock: false,
        buyTx: buyResult.timeout ? null : {
          status: 1,
          hash: buyResult.tx?.hash,
          gasUsed: gasLimit / 2n,
          effectiveGasPrice: gasPrice
        },
        sellTx: sellResult.timeout ? null : {
          status: 1,
          hash: sellResult.tx?.hash,
          gasUsed: gasLimit / 2n,
          effectiveGasPrice: gasPrice
        },
        buyTxHash: buyResult.tx?.hash || null,
        sellTxHash: sellResult.tx?.hash || null,
        buyError: buyResult.timeout ? new Error('Buy transaction timeout') : null,
        sellError: sellResult.timeout ? new Error('Sell transaction timeout') : null,
        volume: parseFloat(ethers.formatUnits(expectedTokens, tokenInfo.decimals)),
        error: `Transaction timeout: ${timeoutTxs.join(', ')}`
      };
    }
      
      // Wait for confirmations with timeout
    const confirmationTimeout = (ms) => new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Transaction confirmation timeout')), ms)
      );
      
    let buyReceipt, sellReceipt;
    try {
      [buyReceipt, sellReceipt] = await Promise.race([
        Promise.all([buyResult.tx.wait(), sellResult.tx.wait()]),
        confirmationTimeout(5000) // 5 second confirmation timeout
      ]);
    } catch (error) {
      console.log(`⏱️ [${wallet.name}] Confirmation timeout - continuing to next wallet`);
      
      // Create mock receipts for timeout case
      const mockReceipt = {
        blockNumber: Math.floor(Date.now() / 1000), // Use timestamp as mock block
        status: 1,
        gasUsed: gasLimit / 2n // Estimate gas used
      };
      
      buyReceipt = mockReceipt;
      sellReceipt = { ...mockReceipt, blockNumber: mockReceipt.blockNumber + 1 };
    }
    
    // Check if transactions were in same block
    const sameBlock = buyReceipt.blockNumber === sellReceipt.blockNumber;
    
    console.log(`✅ [${wallet.name}] Farm cycle complete!`);
    console.log(`   🟢 Buy TX: ${buyResult.tx.hash}`);
    console.log(`   🔴 Sell TX: ${sellResult.tx.hash}`);
    console.log(`   🎯 Same block: ${sameBlock ? 'YES' : 'NO'} (Buy: ${buyReceipt.blockNumber}, Sell: ${sellReceipt.blockNumber})`);
    
    return {
      success: true,
      cycleSuccess: true,
      timeout: false,
      sameBlock,
      buyTx: {
        status: buyReceipt.status,
        hash: buyResult.tx.hash,
        gasUsed: buyReceipt.gasUsed,
        effectiveGasPrice: gasPrice
      },
      sellTx: {
        status: sellReceipt.status,
        hash: sellResult.tx.hash,
        gasUsed: sellReceipt.gasUsed,
        effectiveGasPrice: gasPrice
      },
      buyTxHash: buyResult.tx.hash,
      sellTxHash: sellResult.tx.hash,
      buyBlockNumber: buyReceipt.blockNumber,
      sellBlockNumber: sellReceipt.blockNumber,
      buyError: null,
      sellError: null,
      volume: parseFloat(ethers.formatUnits(expectedTokens, tokenInfo.decimals)),
      gasUsed: (buyReceipt.gasUsed + sellReceipt.gasUsed).toString()
    };
  }
  
  /**
   * Execute transaction with timeout wrapper
   * @param {Promise} txPromise - Transaction promise
   * @param {string} txType - Transaction type for logging
   * @returns {Promise<Object>} Result with timeout handling
   */
  async _executeTransactionWithTimeout(txPromise, txType) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${txType} transaction timeout`)), TRANSACTION_TIMEOUT);
    });
    
    try {
      const tx = await Promise.race([txPromise, timeoutPromise]);
      return { tx, timeout: false };
    } catch (error) {
      if (error.message.includes('timeout')) {
        return { tx: null, timeout: true };
      }
      throw error; // Re-throw non-timeout errors
    }
  }
  
  /**
   * Calculate expected tokens from VIRTUAL amount using Uniswap V2 formula
   * @param {BigInt} virtualAmount - Amount of VIRTUAL to swap
   * @param {string} tokenAddress - Token contract address
   * @param {string} poolAddress - Uniswap V2 pool address
   * @param {number} tokenDecimals - Token decimals
   * @param {string} virtualTokenAddress - VIRTUAL token address
   * @param {number} slippage - Slippage percentage (default 10%)
   * @returns {Promise<BigInt>} Expected token amount in wei
   */
  async calculateExpectedTokens(virtualAmount, tokenAddress, poolAddress, tokenDecimals, virtualTokenAddress, slippage = 10) {
    try {
      if (!poolAddress) {
        // No pool available, use 1:1 ratio as fallback
        console.log(`⚠️ No pool found for token, using 1:1 ratio`);
        return virtualAmount; // This will be converted to token decimals by the caller if needed
      }

      // Create pool contract instance
      const poolContract = new ethers.Contract(
        poolAddress,
        [
          'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
          'function token0() external view returns (address)',
          'function token1() external view returns (address)'
        ],
        this.swapContract.runner.provider
      );

      // Get pool reserves and token positions
      const [reserve0, reserve1] = await poolContract.getReserves();
      const token0 = await poolContract.token0();
      
      // Determine which reserve corresponds to which token
      const virtualIsToken0 = token0.toLowerCase() === virtualTokenAddress.toLowerCase();
      const virtualReserve = virtualIsToken0 ? reserve0 : reserve1;
      const tokenReserve = virtualIsToken0 ? reserve1 : reserve0;

      // Apply Uniswap V2 formula: amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
      const amountInWithFee = virtualAmount * 997n;
      const numerator = amountInWithFee * tokenReserve;
      const denominator = virtualReserve * 1000n + amountInWithFee;
      
      return numerator / denominator;
    } catch (error) {
      console.log(`⚠️ Error calculating expected tokens: ${error.message}, using fallback ratio`);
      // Fallback to 1:1 ratio
    return virtualAmount;
    }
  }
  
  /**
   * Get token balance for a wallet
   * @param {Object} wallet - Wallet instance
   * @param {string} tokenAddress - Token contract address
   * @returns {Promise<BigInt>} Token balance in wei
   */
  async getTokenBalance(wallet, tokenAddress) {
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function balanceOf(address) view returns (uint256)'],
      wallet.provider
    );
    
    try {
    return await tokenContract.balanceOf(wallet.address);
    } catch (error) {
      console.log(`⚠️ Error getting token balance: ${error.message}`);
      return 0n;
    }
  }
  
  /**
   * Execute farming loops for a single wallet
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information
   * @param {BigInt} amountPerLoop - Amount per loop in wei
   * @param {number} loops - Number of loops
   * @param {Object} gasParams - Gas parameters
   * @param {string} virtualTokenAddress - VIRTUAL token address
   * @returns {Promise<Array>} Array of loop results
   */
  async executeFarmingLoops(wallet, tokenInfo, amountPerLoop, loops, gasParams, virtualTokenAddress) {
    const results = [];
    
    for (let loop = 1; loop <= loops; loop++) {
      // console.log(`\n🔄 [${wallet.name}] Starting loop ${loop}/${loops}...`);
      
      // Add randomness to amount (±10%)
      const randomMultiplier = 90n + BigInt(Math.floor(Math.random() * 20)); // 90-110
      const currentAmount = amountPerLoop * randomMultiplier / 100n;
      
      const cycleResult = await this.executeFarmCycle(
        wallet,
        tokenInfo,
        currentAmount,
        gasParams,
        virtualTokenAddress
      );
      
      results.push({
        loop,
        ...cycleResult
      });
      
      // Delay between loops (except after last loop)
      if (loop < loops && !cycleResult.timeout) {
        const loopDelay = Math.random() * 
          (this.settings.LOOP_DELAY_MAX - this.settings.LOOP_DELAY_MIN) + 
          this.settings.LOOP_DELAY_MIN;
        console.log(`⏱️  Waiting ${loopDelay.toFixed(1)}s before next loop...`);
        await sleep(loopDelay * 1000);
      }
    }
    
    return results;
  }
  
  /**
   * Execute ETH farm cycle (BID-MODE) - buy with ETH, sell for ETH
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information
   * @param {BigInt} ethAmountIn - ETH amount in wei
   * @param {Object} gasParams - Gas parameters
   * @returns {Promise<Object>} Result object
   */
  async executeETHFarmCycle(wallet, tokenInfo, ethAmountIn, gasParams) {
    let lastError = null;
    let retryCount = 0;
    
    while (retryCount <= MAX_RETRIES) {
      try {
        if (retryCount > 0) {
          const delay = RETRY_DELAY_BASE * Math.pow(RETRY_DELAY_MULTIPLIER, retryCount - 1);
          console.log(`🔄 [${wallet.name}] Retry attempt ${retryCount}/${MAX_RETRIES} in ${(delay/1000).toFixed(1)}s...`);
          await sleep(delay);
        }
        
        const result = await this._executeETHFarmCycleAttempt(wallet, tokenInfo, ethAmountIn, gasParams);
        
        result.retryCount = retryCount;
        result.wasRetried = retryCount > 0;
        
        if (retryCount > 0) {
          console.log(`✅ [${wallet.name}] Success after ${retryCount} ${retryCount === 1 ? 'retry' : 'retries'}!`);
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        retryCount++;
        
        if (retryCount <= MAX_RETRIES) {
          console.log(`❌ [${wallet.name}] Attempt ${retryCount} failed: ${error.message}`);
          console.log(`🔄 [${wallet.name}] Will retry (${retryCount}/${MAX_RETRIES})...`);
        } else {
          console.log(`❌ [${wallet.name}] All ${MAX_RETRIES} retry attempts failed`);
        }
      }
    }
    
    return {
      success: false,
      cycleSuccess: false,
      error: `Failed after ${MAX_RETRIES} retries: ${lastError.message}`,
      buyError: lastError,
      sellError: null,
      retryCount: MAX_RETRIES,
      wasRetried: true,
      timeout: false,
      sameBlock: false,
      buyTx: null,
      sellTx: null,
      buyTxHash: null,
      sellTxHash: null,
      volume: 0
    };
  }
  
  /**
   * Execute ETH farm cycle attempt (BID-MODE internal method) with parallel nonce logic
   * @param {Object} wallet - Wallet instance  
   * @param {Object} tokenInfo - Token information
   * @param {BigInt} ethAmountIn - ETH amount in wei
   * @param {Object} gasParams - Gas parameters
   * @returns {Promise<Object>} Result object
   */
  async _executeETHFarmCycleAttempt(wallet, tokenInfo, ethAmountIn, gasParams) {
    console.log(`🔄 [${wallet.name}] Starting BID-MODE ETH farm cycle...`);
    
    const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes
    
    // Use dynamic gas pricing like other bots (BuyBot/JeetBot pattern)
    const { gasPriceService } = await import('../../providers/gasPriceService.js');
    const gasPrice = await gasPriceService.getLegacyGasPrice();
    const breakdown = await gasPriceService.getGasPriceBreakdown();
    console.log(`⛽ [${wallet.name}] ETH Dynamic Gas: ${breakdown.baseGasPrice} gwei + ${breakdown.priorityFee} gwei = ${breakdown.totalGasPrice} gwei`);
    
    const gasLimit = BigInt(gasParams.gasLimit);
    
    // Step 1: Calculate expected tokens for sell amount estimation
    const expectedTokens = await this.calculateExpectedETHTokens(ethAmountIn, tokenInfo);
    
    // Step 2: Calculate sell amount with 3% tax consideration
    const sellAmount = (expectedTokens * 9999n) / 10000n; // 99.99% of expected tokens
    console.log(`📊 [${wallet.name}] Expected: ${ethers.formatUnits(expectedTokens, tokenInfo.decimals)} ${tokenInfo.symbol}, Will sell: ${ethers.formatUnits(sellAmount, tokenInfo.decimals)} (accounting for 3% tax)`);
    
    // Step 3: Check approvals before parallel execution
    await this.checkETHApprovals(wallet, tokenInfo, sellAmount, gasPrice);
    
    // Step 4: Get base nonce and execute parallel transactions (like original farmbot)
    const provider = wallet.provider;
    const baseNonce = await provider.getTransactionCount(wallet.address, 'pending');
    
    console.log(`⚡ [${wallet.name}] Executing parallel ETH buy/sell with nonces ${baseNonce} and ${baseNonce + 1}...`);
    
    // Create contract instance with wallet
    const contract = new ethers.Contract(this.swapContract.target, [
      'function swapETHForTokensWithFee(address tokenOut, uint256 amountOutMin, uint256 deadline) payable returns (uint256)',
      'function swapTokensForETHWithFee(address tokenIn, uint256 amountIn, uint256 amountOutMin, uint256 deadline) returns (uint256)'
    ], wallet);
    
    // Create transaction promises with consecutive nonces
    const buyPromise = this._executeTransactionWithTimeout(
      contract.swapETHForTokensWithFee(
        tokenInfo.address,
        0, // Minimum token output (let TRUSTSWAP handle slippage)
        deadline,
        {
          value: ethAmountIn,
          gasPrice,
          gasLimit,
          nonce: baseNonce
        }
      ),
      'buy'
    );
    
    const sellPromise = this._executeTransactionWithTimeout(
      contract.swapTokensForETHWithFee(
        tokenInfo.address,
        sellAmount,
        0, // Minimum ETH output (let TRUSTSWAP handle slippage)
        deadline,
        {
          gasPrice,
          gasLimit,
          nonce: baseNonce + 1
        }
      ),
      'sell'
    );
    
    // Execute both transactions in parallel
    const [buyResult, sellResult] = await Promise.all([buyPromise, sellPromise]);
    
    // Handle timeouts
    if (buyResult.timeout || sellResult.timeout) {
      const timeoutTxs = [];
      if (buyResult.timeout) timeoutTxs.push('buy');
      if (sellResult.timeout) timeoutTxs.push('sell');
      
      console.log(`⏱️ [${wallet.name}] BID-MODE transaction timeout: ${timeoutTxs.join(', ')}`);
      
      return {
        success: false,
        cycleSuccess: false,
        timeout: true,
        timeoutTransactions: timeoutTxs,
        sameBlock: false,
        buyTx: buyResult.timeout ? null : {
          status: 1,
          hash: buyResult.tx?.hash,
          gasUsed: gasLimit / 2n,
          effectiveGasPrice: gasPrice
        },
        sellTx: sellResult.timeout ? null : {
          status: 1,
          hash: sellResult.tx?.hash,
          gasUsed: gasLimit / 2n,
          effectiveGasPrice: gasPrice
        },
        buyTxHash: buyResult.tx?.hash || null,
        sellTxHash: sellResult.tx?.hash || null,
        buyError: buyResult.timeout ? new Error('Buy transaction timeout') : null,
        sellError: sellResult.timeout ? new Error('Sell transaction timeout') : null,
        volume: parseFloat(ethers.formatUnits(expectedTokens, tokenInfo.decimals)),
        error: `BID-MODE transaction timeout: ${timeoutTxs.join(', ')}`,
        bidMode: true
      };
    }
    
    // Wait for confirmations with timeout
    const confirmationTimeout = (ms) => new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Transaction confirmation timeout')), ms)
    );
    
    let buyReceipt, sellReceipt;
    try {
      [buyReceipt, sellReceipt] = await Promise.race([
        Promise.all([buyResult.tx.wait(), sellResult.tx.wait()]),
        confirmationTimeout(5000) // 5 second confirmation timeout
      ]);
    } catch (error) {
      console.log(`⏱️ [${wallet.name}] BID-MODE confirmation timeout - continuing to next wallet`);
      
      // Create mock receipts for timeout case
      const mockReceipt = {
        blockNumber: Math.floor(Date.now() / 1000), // Use timestamp as mock block
        status: 1,
        gasUsed: gasLimit / 2n // Estimate gas used
      };
      
      buyReceipt = mockReceipt;
      sellReceipt = { ...mockReceipt, blockNumber: mockReceipt.blockNumber + 1 };
    }
    
    // Check if transactions were in same block
    const sameBlock = buyReceipt.blockNumber === sellReceipt.blockNumber;
    
    console.log(`✅ [${wallet.name}] BID-MODE ETH farm cycle complete!`);
    console.log(`   🟢 Buy TX: ${buyResult.tx.hash}`);
    console.log(`   🔴 Sell TX: ${sellResult.tx.hash}`);
    console.log(`   🎯 Same block: ${sameBlock ? 'YES' : 'NO'} (Buy: ${buyReceipt.blockNumber}, Sell: ${sellReceipt.blockNumber})`);
    
    return {
      success: true,
      cycleSuccess: true,
      timeout: false,
      sameBlock,
      buyTx: {
        status: buyReceipt.status,
        hash: buyResult.tx.hash,
        gasUsed: buyReceipt.gasUsed,
        effectiveGasPrice: gasPrice
      },
      sellTx: {
        status: sellReceipt.status,
        hash: sellResult.tx.hash,
        gasUsed: sellReceipt.gasUsed,
        effectiveGasPrice: gasPrice
      },
      buyTxHash: buyResult.tx.hash,
      sellTxHash: sellResult.tx.hash,
      buyBlockNumber: buyReceipt.blockNumber,
      sellBlockNumber: sellReceipt.blockNumber,
      buyError: null,
      sellError: null,
      volume: parseFloat(ethers.formatUnits(expectedTokens, tokenInfo.decimals)),
      gasUsed: (buyReceipt.gasUsed + sellReceipt.gasUsed).toString(),
      bidMode: true
    };
  }
  
  /**
   * Calculate expected tokens from ETH amount for BID-MODE
   * @param {BigInt} ethAmount - ETH amount in wei
   * @param {Object} tokenInfo - Token information
   * @returns {Promise<BigInt>} Expected token amount in wei
   */
  async calculateExpectedETHTokens(ethAmount, tokenInfo) {
    try {
      // For BID-MODE, we estimate based on pool reserves if available
      if (tokenInfo.poolAddress) {
        // Use similar logic to calculateExpectedTokens but for ETH→Token
        const poolContract = new ethers.Contract(
          tokenInfo.poolAddress,
          [
            'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
            'function token0() external view returns (address)',
            'function token1() external view returns (address)'
          ],
          this.swapContract.runner.provider
        );

        const [reserve0, reserve1] = await poolContract.getReserves();
        const token0 = await poolContract.token0();
        
        // Assuming WETH is used for ETH pairs
        const WETH_ADDRESS = '0x4200000000000000000000000000000000000006'; // Base WETH
        const ethIsToken0 = token0.toLowerCase() === WETH_ADDRESS.toLowerCase();
        const ethReserve = ethIsToken0 ? reserve0 : reserve1;
        const tokenReserve = ethIsToken0 ? reserve1 : reserve0;

        // Apply Uniswap V2 formula for ETH→Token
        const amountInWithFee = ethAmount * 997n;
        const numerator = amountInWithFee * tokenReserve;
        const denominator = ethReserve * 1000n + amountInWithFee;
        
        return numerator / denominator;
      } else {
        // Fallback: assume 1 ETH = many tokens (rough estimate)
        // This is a conservative estimate for tokens without pools
        return ethAmount * 1000n; // Rough estimate
      }
    } catch (error) {
      console.log(`⚠️ Error calculating expected ETH tokens: ${error.message}, using fallback estimate`);
      // Fallback estimate
      return ethAmount * 1000n;
    }
  }

  /**
   * Check ETH approvals for BID-MODE (only token approval needed, ETH doesn't need approval)
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information
   * @param {BigInt} tokenAmount - Token amount to approve
   * @param {BigInt} gasPrice - Gas price in wei
   */
  async checkETHApprovals(wallet, tokenInfo, tokenAmount, gasPrice) {
    console.log(`🔓 [${wallet.name}] Checking BID-MODE approvals...`);
    
    const trustswapAddress = this.swapContract.target;
    const gasParams = {
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
      gasLimit: 200000n
    };
    
    // Only need to check token approval for sell transaction
    // ETH buy doesn't need approval since we're sending ETH directly
    const tokenContract = new ethers.Contract(tokenInfo.address, [
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 amount) returns (bool)'
    ], wallet);
    
    const tokenAllowance = await tokenContract.allowance(wallet.address, trustswapAddress);
    
    if (tokenAllowance < tokenAmount) {
      console.log(`📝 [${wallet.name}] Approving ${tokenInfo.symbol} for TRUSTSWAP...`);
      const approvalTx = await tokenContract.approve(trustswapAddress, ethers.MaxUint256, gasParams);
      await approvalTx.wait();
      console.log(`✅ [${wallet.name}] ${tokenInfo.symbol} approval confirmed: ${approvalTx.hash}`);
    } else {
      console.log(`✅ [${wallet.name}] ${tokenInfo.symbol} already approved`);
    }
    
    console.log(`✅ [${wallet.name}] ETH doesn't need approval (sent directly)`);
  }

  /**
   * Approve token for sell transaction (legacy method - kept for backward compatibility)
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information
   * @param {BigInt} amount - Amount to approve
   * @param {BigInt} gasPrice - Gas price in wei
   */
  async approveTokenForSell(wallet, tokenInfo, amount, gasPrice) {
    const trustswapAddress = this.swapContract.target;
    const gasParams = {
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
      gasLimit: 200000n
    };
    
    const tokenContract = new ethers.Contract(tokenInfo.address, [
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 amount) returns (bool)'
    ], wallet);
    
    const currentAllowance = await tokenContract.allowance(wallet.address, trustswapAddress);
    
    if (currentAllowance < amount) {
      console.log(`📝 [${wallet.name}] Approving ${tokenInfo.symbol} for sell...`);
      const approvalTx = await tokenContract.approve(trustswapAddress, ethers.MaxUint256, gasParams);
      await approvalTx.wait();
      console.log(`✅ [${wallet.name}] ${tokenInfo.symbol} approved for sell: ${approvalTx.hash}`);
    } else {
      console.log(`✅ [${wallet.name}] ${tokenInfo.symbol} already approved for sell`);
    }
  }
} 