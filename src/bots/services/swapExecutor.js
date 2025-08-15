/**
 * Swap Executor Service
 * Handles swap transaction execution with WebSocket-based approvals
 */

import { ethers } from 'ethers';
import { provider } from '../../config.js';
import { AmountCalculator } from './amountCalculator.js';
import { CONTRACTS, ABIS, DEFAULT_SETTINGS } from '../config/constants.js';
import { wsApprovalService } from './websocketApprovalService.js';
import { executeTransactionWithReplacementFee } from '../../config.js';
import { gasPriceService } from '../../providers/gasPriceService.js';

/**
 * SwapExecutor - Handles swap transaction execution with WebSocket enhancements
 */
export class SwapExecutor {
  /**
   * Check and approve token spending with WebSocket monitoring
   * @param {Object} wallet - Wallet instance
   * @param {string} tokenAddress - Token contract address
   * @param {string} spenderAddress - Spender contract address
   * @param {BigNumber} amountWei - Amount in wei
   * @param {string} tokenSymbol - Token symbol for logging
   * @param {Object} gasParams - Gas parameters
   * @returns {boolean} True if approval was needed and executed
   */
  static async checkAndApproveToken(wallet, tokenAddress, spenderAddress, amountWei, tokenSymbol, gasParams) {
    try {
      // WEBSOCKET REPLACEMENT: Use WebSocket approval service instead of polling
      console.log(`Checking ${tokenSymbol} approval via WebSocket service...`);
      
      const approvalExecuted = await wsApprovalService.checkAndApproveTokenWebSocket(
        wallet,
        tokenAddress,
        amountWei,
        spenderAddress,
        gasParams
      );
      
      if (approvalExecuted) {
        console.log(`WebSocket: ${tokenSymbol} UNLIMITED approval confirmed via event!`);
        return true;
      } else {
        console.log(`WebSocket: ${tokenSymbol} already approved`);
        return false;
      }
      
    } catch (error) {
      console.log(`WebSocket approval failed, falling back to polling: ${error.message}`);
      
      // FALLBACK: Original polling method
      const tokenContract = new ethers.Contract(tokenAddress, ABIS.ERC20_MINIMAL, wallet);
      const currentAllowance = await tokenContract.allowance(wallet.address, spenderAddress);
      
      if (currentAllowance < amountWei) {
        console.log(`Approving UNLIMITED ${tokenSymbol} for ${spenderAddress === CONTRACTS.TRUSTSWAP ? 'TRUSTSWAP' : 'contract'}...`);
        const approveTx = await tokenContract.approve(spenderAddress, ethers.MaxUint256, {
          maxFeePerGas: gasParams.maxFeePerGas,
          maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
          gasLimit: 200000n
        });
        await approveTx.wait(); // Polling fallback
        console.log(` approval confirmed: ${approveTx.hash}`);
        return true;
      } else {
        console.log(`${tokenSymbol} already approved`);
        return false;
      }
    }
  }

  /**
   * Check and approve currency with WebSocket
   * @param {Object} wallet - Wallet instance
   * @param {string} currencyAddress - Currency contract address
   * @param {number} amount - Amount to approve
   * @param {Object} gasParams - Gas parameters
   * @param {number} decimals - Token decimals
   */
  static async checkAndApproveCurrency(wallet, currencyAddress, amount, gasParams, decimals = 18) {
    // SURGICAL FIX: Truncate amount to 12 decimals to prevent NUMERIC_FAULT in TWAP mode
    const truncatedAmount = parseFloat(amount.toFixed(12)).toString();
    const amountWei = ethers.parseUnits(truncatedAmount, decimals);
    return await this.checkAndApproveToken(wallet, currencyAddress, CONTRACTS.TRUSTSWAP, amountWei, 'CURRENCY', gasParams);
  }

  /**
   * Check and approve VIRTUAL with WebSocket
   * @param {Object} wallet - Wallet instance
   * @param {number} amount - Amount to approve
   * @param {Object} gasParams - Gas parameters
   */
  static async checkAndApproveVirtual(wallet, amount, gasParams) {
    const amountWei = ethers.parseUnits(amount.toString(), 18);
    return await this.checkAndApproveToken(wallet, CONTRACTS.VIRTUAL, CONTRACTS.TRUSTSWAP, amountWei, 'VIRTUAL', gasParams);
  }

  /**
   * Execute two-step buy: currency → VIRTUAL → target token
   * @param {Object} wallet - Wallet instance
   * @param {Object} currencyInfo - Currency information
   * @param {Object} tokenInfo - Token information
   * @param {number} currencyAmount - Amount of currency to spend
   * @param {string} customGasPrice - Custom gas price
   * @param {Object} tracker - Transaction tracker
   * @returns {Object} Transaction result
   */
  static async executeTwoStepBuy(wallet, currencyInfo, tokenInfo, currencyAmount, customGasPrice = null, tracker = null) {
    try {
      console.log(`\nTwo-step buy: ${currencyInfo.symbol} → VIRTUAL → ${tokenInfo.symbol} (${currencyInfo.isEth ? 'Uniswap V2' : 'TRUSTSWAP'} + TRUSTSWAP)`);
      
      const gasPrice = customGasPrice ? 
        ethers.parseUnits(customGasPrice, 'gwei') : 
        await gasPriceService.getLegacyGasPrice();
      const gasLimit = 500000n;
      const deadline = Math.floor(Date.now() / 1000) + DEFAULT_SETTINGS.TRANSACTION_DEADLINE;
      
      // Create TRUSTSWAP contract instance with wallet signer
      const trustSwap = new ethers.Contract(CONTRACTS.TRUSTSWAP, ABIS.TRUSTSWAP, wallet);
      
      // Calculate expected amounts for both steps
      const { expectedOut: expectedVirtual, minAmountOut: minVirtualOut } = await AmountCalculator.calculateCurrencyToVirtual(
        currencyAmount, 
        currencyInfo, 
        DEFAULT_SETTINGS.MAX_SLIPPAGE_PERCENT
      );
      const virtualForStep2 = expectedVirtual * 0.99; // Conservative for step 2
      const step2Calculation = await AmountCalculator.calculateVirtualToToken(
        virtualForStep2, 
        tokenInfo, 
        DEFAULT_SETTINGS.MAX_SLIPPAGE_PERCENT
      );
      
      // Pre-approve everything before parallel execution
      if (!currencyInfo.isEth) {
        await this.checkAndApproveCurrency(wallet, currencyInfo.address, currencyAmount, customGasPrice, currencyInfo.decimals);
      }
      
      // Check and approve VIRTUAL for TRUSTSWAP contract
      const virtualAmountWei = ethers.parseUnits(virtualForStep2.toString(), 18);
      await this.checkAndApproveToken(wallet, CONTRACTS.VIRTUAL, CONTRACTS.TRUSTSWAP, virtualAmountWei, 'VIRTUAL', gasPrice);
      
      // Execute parallel transactions with consecutive nonces
      const baseNonce = await provider.getTransactionCount(wallet.address, 'pending');
      const transactions = [];
      let currentNonce = baseNonce;
      
      // Step 1: Currency → VIRTUAL (ETH uses Uniswap V2, others use TRUSTSWAP)
    // SURGICAL FIX: Truncate ETH to 12 decimals to prevent NUMERIC_FAULT in TWAP mode
    const truncatedAmount = currencyInfo.isEth ? 
      parseFloat(currencyAmount.toFixed(12)).toString() : 
      currencyAmount.toString();
    const currencyAmountWei = ethers.parseUnits(truncatedAmount, currencyInfo.decimals);
      let step1Promise;
      
      if (currencyInfo.isEth) {
        // ETH → VIRTUAL using Uniswap V2 Router (direct ETH handling)
        const uniswapRouterWithWallet = new ethers.Contract(CONTRACTS.UNISWAP_V2_ROUTER, ABIS.UNISWAP_V2, wallet);
        const path = [CONTRACTS.WETH, CONTRACTS.VIRTUAL]; // ETH → WETH → VIRTUAL
        
        step1Promise = uniswapRouterWithWallet.swapExactETHForTokens(
          minVirtualOut,
          path,
          wallet.address,
          deadline,
          {
            value: currencyAmountWei, // ETH sent with transaction
            gasPrice,
            gasLimit,
            nonce: currentNonce++
          }
        );
      } else {
        // Other currencies → VIRTUAL using TRUSTSWAP
        step1Promise = trustSwap.swapForVirtualWithFee(
          currencyInfo.address,
          currencyAmountWei,
          minVirtualOut,
          deadline,
          {
            gasPrice,
            gasLimit,
            nonce: currentNonce++
          }
        );
      }
      transactions.push(step1Promise);
      
      // Step 2: VIRTUAL → Target Token using TRUSTSWAP
      // Increase gas price by 15% to avoid "replacement fee too low" error in parallel execution
      const step2GasPrice = gasPrice + (gasPrice * 15n / 100n);
      const step2Promise = trustSwap.swapVirtualWithFee(
        virtualAmountWei,
        step2Calculation.minAmountOut,
        tokenInfo.address,
        deadline,
        {
          gasPrice: step2GasPrice,
          gasLimit,
          nonce: currentNonce++
        }
      );
      transactions.push(step2Promise);
      
      console.log(`   Executing sequential transactions: Step 1 (nonce ${baseNonce}) then Step 2 (nonce ${baseNonce + 1})`);
      
      // Execute Step 1 first
      const step1Tx = await transactions[0];
      
      // Add small delay to prevent "replacement fee too low" error
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Execute Step 2 after delay
      const step2Tx = await transactions[1];
      const [step1Receipt, step2Receipt] = await Promise.all([step1Tx.wait(), step2Tx.wait()]);
      
      const sameBlock = step1Receipt.blockNumber === step2Receipt.blockNumber;
      console.log(`   SAME BLOCK: Step 1 (${step1Receipt.blockNumber}) | Step 2 (${step2Receipt.blockNumber})`);
      
      if (tracker) {
        tracker.addTransaction(
          wallet.address,
          currencyInfo.symbol,
          currencyAmount,
          tokenInfo.symbol,
          step2Calculation.expectedTokens
        );
      }
      
      return {
        success: true,
        step1Hash: step1Tx.hash,
        step2Hash: step2Tx.hash,
        txHash: step2Tx.hash,
        sameBlock: sameBlock,
        twoStep: true,
        tokensReceived: step2Calculation.expectedTokens
      };
      
    } catch (error) {
      console.log(`Two-step buy failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute ETH buy using TRUSTSWAP swapETHForTokensWithFee (BID-MODE)
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information
   * @param {number} ethAmount - Amount of ETH to spend
   * @param {string} customGasPrice - Custom gas price
   * @param {Object} tracker - Transaction tracker
   * @returns {Object} Transaction result
   */
  static async executeETHBuy(wallet, tokenInfo, ethAmount, customGasPrice = null, tracker = null) {
    try {
      console.log(`\nBID-MODE ETH Buy: ${ethAmount} ETH → ${tokenInfo.symbol}`);
      
      const gasPrice = customGasPrice ? 
        ethers.parseUnits(customGasPrice, 'gwei') : 
        await gasPriceService.getLegacyGasPrice();
      const gasLimit = 500000n;
      const deadline = Math.floor(Date.now() / 1000) + DEFAULT_SETTINGS.TRANSACTION_DEADLINE;
      
      // Fix: Truncate ETH amount to 12 decimal places to prevent NUMERIC_FAULT in TWAP mode
      const truncatedEthAmount = parseFloat(ethAmount.toFixed(12));
      const ethAmountWei = ethers.parseUnits(truncatedEthAmount.toString(), 18);
      
      // Record token balance before swap
      const tokenContract = new ethers.Contract(tokenInfo.address, ABIS.ERC20_MINIMAL, provider);
      const tokenBalanceBefore = await tokenContract.balanceOf(wallet.address);
      
      console.log(`   Buying with: ${ethAmount} ETH`);
      console.log(`   Executing TRUSTSWAP.swapETHForTokensWithFee...`);
      
      // Execute ETH swap using TRUSTSWAP
      const swapResult = await executeTransactionWithReplacementFee(
        async (currentProvider, gasParams) => {
          const walletWithProvider = wallet.connect(currentProvider);
          const trustSwap = new ethers.Contract(CONTRACTS.TRUSTSWAP, ABIS.TRUSTSWAP, walletWithProvider);
          
          return await trustSwap.swapETHForTokensWithFee(
            tokenInfo.address,
            0, // Minimum token output (let TRUSTSWAP handle slippage)
            deadline,
            {
              value: ethAmountWei, // ETH sent with transaction
              maxFeePerGas: gasParams.maxFeePerGas,
              maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
              gasLimit: gasLimit
            }
          );
        }
      );
      
      // Calculate tokens received
      const tokenBalanceAfter = await tokenContract.balanceOf(wallet.address);
      const tokensReceived = parseFloat(ethers.formatUnits(tokenBalanceAfter - tokenBalanceBefore, tokenInfo.decimals));
      
      console.log(`   Tokens received: ${tokensReceived.toFixed(6)} ${tokenInfo.symbol}`);
      console.log(`   Gas used: ${swapResult.receipt.gasUsed.toString()}`);
      console.log(`   Transaction: ${swapResult.hash}`);
      
      // Track the transaction
      if (tracker) {
        tracker.addTransaction(
          wallet.address,
          'ETH',
          ethAmount,
          tokenInfo.symbol,
          tokensReceived
        );
      }
      
      return {
        success: true,
        txHash: swapResult.hash,
        tokensReceived: tokensReceived,
        gasUsed: swapResult.receipt.gasUsed.toString(),
        bidMode: true,
        rpcProvider: swapResult.provider
      };
      
    } catch (error) {
      console.log(`   BID-MODE ETH buy failed: ${error.message}`);
      return { 
        success: false, 
        error: error.message,
        bidMode: true
      };
    }
  }
} 