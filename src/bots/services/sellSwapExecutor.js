/**
 * Sell Swap Executor Service
 * Handles sell swap execution including TRUSTSWAP and two-step operations
 */

import { ethers } from 'ethers';
import { executeTransactionWithReplacementFee, executeRpcWithFallback } from '../../config.js';
import { log } from '../../utils.js';
import { gasPriceService } from '../../providers/gasPriceService.js';

// Constants
const CONTRACTS = {
  TRUSTSWAP: '0x74fa2835311Da3118BF2971Fa11E8070e4ff1693',
  VIRTUAL: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
  WETH: '0x4200000000000000000000000000000000000006'
};

const TRUSTSWAP_ABI = [
  "function getAmountsOutWithFee(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts, uint256 feeAmount)",
  "function calculatePlatformFee(uint256 amount) public view returns (uint256)",
  "function swapForVirtualWithFee(address tokenIn, uint256 amountIn, uint256 amountOutMin, uint256 deadline) external returns (uint256[] memory)",
  "function swapVirtualWithFee(uint256 amountIn, uint256 amountOutMin, address tokenOut, uint256 deadline) external returns (uint256[] memory)",
  "function swapTokensForETHWithFee(address tokenIn, uint256 amountIn, uint256 amountOutMin, uint256 deadline) external returns (uint256)",
  "function swapETHForTokensWithFee(address tokenOut, uint256 amountOutMin, uint256 deadline) external payable returns (uint256)"
];

const WETH_ABI = [
  "function withdraw(uint256 amount) external",
  "function balanceOf(address account) external view returns (uint256)"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

/**
 * SellSwapExecutor - Handles sell swap execution
 */
export class SellSwapExecutor {
  /**
   * Check and approve token for TRUSTSWAP
   * @param {Object} wallet - Wallet instance
   * @param {string} tokenAddress - Token address
   * @param {string} spenderAddress - Spender address
   * @param {BigInt} amountWei - Amount in wei
   * @param {string} tokenSymbol - Token symbol
   * @param {BigInt} gasPrice - Gas price
   * @returns {boolean} True if approval was needed
   */
  static async checkAndApproveToken(wallet, tokenAddress, spenderAddress, amountWei, tokenSymbol, gasPrice) {
    const currentAllowance = await executeRpcWithFallback(async (provider) => {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      return await tokenContract.allowance(wallet.address, spenderAddress);
    }, 3, 1000);
    
    if (currentAllowance < amountWei) {
      console.log(`   📝 Approving UNLIMITED ${tokenSymbol} for ${spenderAddress === CONTRACTS.TRUSTSWAP ? 'TRUSTSWAP' : 'contract'}...`);
      
      const approvalResult = await executeTransactionWithReplacementFee(
        async (currentProvider, gasParams) => {
          const walletWithProvider = wallet.connect(currentProvider);
          const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, walletWithProvider);
          
          return await tokenContract.approve(spenderAddress, ethers.MaxUint256, {
            maxFeePerGas: gasParams.maxFeePerGas,
            maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
            gasLimit: 200000n
          });
        }
      );
      
      console.log(`   ✅ ${tokenSymbol} UNLIMITED approval confirmed: ${approvalResult.hash}`);
      return true;
    } else {
      console.log(`   ✅ ${tokenSymbol} already approved`);
      return false;
    }
  }
  
  /**
   * Execute TRUSTSWAP fallback sell (for tokens without V2 pools)
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information
   * @param {number} tokenAmount - Amount to sell
   * @param {string} customGasPrice - Custom gas price
   * @returns {Object} Transaction result
   */
  static async executeTrustSwapFallback(wallet, tokenInfo, tokenAmount, customGasPrice = null) {
    try {
      console.log(`  🔄 TRUSTSWAP Fallback: Selling ${tokenAmount} ${tokenInfo.symbol} (no V2 pool)...`);
      
      const gasPrice = customGasPrice ? 
        ethers.parseUnits(customGasPrice, 'gwei') : 
        await gasPriceService.getLegacyGasPrice();
      const gasLimit = 600000n; // Higher gas limit for fallback
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      
      const tokenAmountWei = ethers.parseUnits(tokenAmount.toString(), tokenInfo.decimals);
      
      // Check and approve token for TRUSTSWAP contract
      await this.checkAndApproveToken(wallet, tokenInfo.address, CONTRACTS.TRUSTSWAP, tokenAmountWei, tokenInfo.symbol, gasPrice);
      
      // Record VIRTUAL balance before swap
      const virtualContract = new ethers.Contract(CONTRACTS.VIRTUAL, ERC20_ABI, wallet);
      const balanceBefore = await virtualContract.balanceOf(wallet.address);
      
      // Execute swap using TRUSTSWAP contract
      const swapResult = await executeTransactionWithReplacementFee(
        async (currentProvider, gasParams) => {
          const walletWithProvider = wallet.connect(currentProvider);
          const trustSwap = new ethers.Contract(CONTRACTS.TRUSTSWAP, TRUSTSWAP_ABI, walletWithProvider);
          
          return await trustSwap.swapForVirtualWithFee(
            tokenInfo.address,
            tokenAmountWei,
            0, // Let TRUSTSWAP handle slippage internally
            deadline,
            {
              maxFeePerGas: gasParams.maxFeePerGas,
              maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
              gasLimit: gasLimit
            }
          );
        }
      );
      
      // Calculate VIRTUAL received
      const balanceAfter = await virtualContract.balanceOf(wallet.address);
      const virtualReceived = parseFloat(ethers.formatEther(balanceAfter - balanceBefore));
      
      console.log(`    ✅ Fallback Success: ${virtualReceived.toFixed(6)} VIRTUAL received`);
      
      return {
        success: true,
        txHash: swapResult.hash,
        virtualReceived: virtualReceived,
        gasUsed: swapResult.receipt.gasUsed.toString(),
        isFallback: true,
        rpcProvider: swapResult.provider
      };
      
    } catch (error) {
      console.log(`    ❌ TRUSTSWAP fallback failed: ${error.message}`);
      return { 
        success: false, 
        error: error.message,
        isFallback: true
      };
    }
  }
  
  /**
   * Execute direct sell to VIRTUAL using TRUSTSWAP
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information
   * @param {number} tokenAmount - Amount to sell
   * @param {string} customGasPrice - Custom gas price
   * @param {boolean} useFallback - Force fallback mode
   * @returns {Object} Transaction result
   */
  static async executeDirectSellToVirtual(wallet, tokenInfo, tokenAmount, customGasPrice = null, useFallback = false) {
    // Force fallback if specified, no pool available, or explicitly flagged to use fallback
    const shouldUseFallback = useFallback || tokenInfo.useTrustSwapFallback || tokenInfo.isDirectCA;
    
    if (shouldUseFallback) {
      if (tokenInfo.isDirectCA) {
        console.log(`  🎯 Direct CA input: Using TRUSTSWAP delegation for ${tokenInfo.symbol}`);
      }
      return await this.executeTrustSwapFallback(wallet, tokenInfo, tokenAmount, customGasPrice);
    }
    
    try {
      console.log(`  🔄 Selling ${tokenAmount} ${tokenInfo.symbol} for VIRTUAL (V2 Pool)...`);
      
      const gasPrice = customGasPrice ? 
        ethers.parseUnits(customGasPrice, 'gwei') : 
        await gasPriceService.getLegacyGasPrice();
      const gasLimit = 500000n;
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      
      const tokenAmountWei = ethers.parseUnits(tokenAmount.toString(), tokenInfo.decimals);
      
      // Check and approve token for TRUSTSWAP contract
      await this.checkAndApproveToken(wallet, tokenInfo.address, CONTRACTS.TRUSTSWAP, tokenAmountWei, tokenInfo.symbol, gasPrice);
      
      // Record VIRTUAL balance before swap
      const virtualContract = new ethers.Contract(CONTRACTS.VIRTUAL, ERC20_ABI, wallet);
      const balanceBefore = await virtualContract.balanceOf(wallet.address);
      
      // Execute swap using TRUSTSWAP contract
      const swapResult = await executeTransactionWithReplacementFee(
        async (currentProvider, gasParams) => {
          const walletWithProvider = wallet.connect(currentProvider);
          const trustSwap = new ethers.Contract(CONTRACTS.TRUSTSWAP, TRUSTSWAP_ABI, walletWithProvider);
          
          return await trustSwap.swapForVirtualWithFee(
            tokenInfo.address,
            tokenAmountWei,
            0, // Minimum output handled by contract
            deadline,
            {
              maxFeePerGas: gasParams.maxFeePerGas,
              maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
              gasLimit: gasLimit
            }
          );
        }
      );
      
      // Calculate VIRTUAL received
      const balanceAfter = await virtualContract.balanceOf(wallet.address);
      const virtualReceived = parseFloat(ethers.formatEther(balanceAfter - balanceBefore));
      
      console.log(`    ✅ Received: ${virtualReceived.toFixed(6)} VIRTUAL`);
      
      return {
        success: true,
        txHash: swapResult.hash,
        virtualReceived: virtualReceived,
        gasUsed: swapResult.receipt.gasUsed.toString(),
        isFallback: false,
        rpcProvider: swapResult.provider
      };
      
    } catch (error) {
      console.log(`    ❌ Direct sell failed: ${error.message}`);
      
      // Try fallback if main method fails
      if (!tokenInfo.isDirectCA) {
        console.log(`    🔄 Attempting TRUSTSWAP fallback...`);
        return await this.executeTrustSwapFallback(wallet, tokenInfo, tokenAmount, customGasPrice);
      } else {
        return { 
          success: false, 
          error: error.message,
          isFallback: true
        };
      }
    }
  }
  
  /**
   * Execute two-step sell: Token → VIRTUAL → Currency
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information
   * @param {Object} currencyInfo - Currency information
   * @param {number} tokenAmount - Amount to sell
   * @param {string} customGasPrice - Custom gas price
   * @param {Object} tracker - Transaction tracker
   * @returns {Object} Transaction result
   */
  static async executeTwoStepSell(wallet, tokenInfo, currencyInfo, tokenAmount, customGasPrice = null, tracker = null) {
    try {
      const strategyText = currencyInfo.isEth ? 'WETH unwrap' : 'TRUSTSWAP';
      console.log(`\n🔄 Two-step sell: ${tokenInfo.symbol} → VIRTUAL → ${currencyInfo.symbol} (TRUSTSWAP + ${strategyText})`);
      
      const gasPrice = customGasPrice ? 
        ethers.parseUnits(customGasPrice, 'gwei') : 
        await gasPriceService.getLegacyGasPrice();
      const gasLimit = 500000n;
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      
      // Step 1: Sell token for VIRTUAL
      console.log(`   🔄 Step 1: Selling ${tokenAmount} ${tokenInfo.symbol} for VIRTUAL...`);
      
      const step1Result = await this.executeDirectSellToVirtual(wallet, tokenInfo, tokenAmount, customGasPrice);
      
      if (!step1Result.success) {
        throw new Error(`Step 1 failed: ${step1Result.error}`);
      }
      
      console.log(`   ✅ Step 1 completed: ${step1Result.txHash}`);
      
      const virtualReceived = step1Result.virtualReceived;
      const virtualForStep2 = virtualReceived * 0.99; // Use 99% of received amount for step 2
      
      if (virtualForStep2 <= 0) {
        throw new Error('No VIRTUAL received from step 1');
      }
      
      console.log(`   💰 VIRTUAL received: ${virtualReceived.toFixed(6)} VIRTUAL`);
      
      // Step 2: Buy target currency with VIRTUAL
      console.log(`   🔄 Step 2: Buying ${currencyInfo.symbol} with ${virtualForStep2.toFixed(6)} VIRTUAL...`);
      
      const virtualAmountWei = ethers.parseUnits(virtualForStep2.toString(), 18);
      let step2Tx, step2Receipt, finalAmount, step2Result;
      
      // Check and approve VIRTUAL for TRUSTSWAP
      await this.checkAndApproveToken(wallet, CONTRACTS.VIRTUAL, CONTRACTS.TRUSTSWAP, virtualAmountWei, 'VIRTUAL', gasPrice);
      
      if (currencyInfo.isEth) {
        // Step 2a: Swap VIRTUAL for WETH using TrustSwap
        const ethBalanceBefore = await executeRpcWithFallback(async (provider) => {
          return await provider.getBalance(wallet.address);
        });
        
        step2Result = await executeTransactionWithReplacementFee(
          async (currentProvider, gasParams) => {
            const walletWithProvider = wallet.connect(currentProvider);
            const trustSwap = new ethers.Contract(CONTRACTS.TRUSTSWAP, TRUSTSWAP_ABI, walletWithProvider);
            
            return await trustSwap.swapVirtualWithFee(
              virtualAmountWei,
              0, // Minimum WETH output
              CONTRACTS.WETH, // Use WETH address for TrustSwap
              deadline,
              {
                maxFeePerGas: gasParams.maxFeePerGas,
                maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
                gasLimit: gasLimit
              }
            );
          }
        );
        
        step2Tx = { hash: step2Result.hash };
        step2Receipt = step2Result.receipt;
        
        // Step 2b: Unwrap WETH to ETH
        const wethContract = new ethers.Contract(CONTRACTS.WETH, WETH_ABI, wallet);
        const wethBalance = await wethContract.balanceOf(wallet.address);
        
        if (wethBalance > 0) {
          console.log(`   🔄 Unwrapping ${ethers.formatEther(wethBalance)} WETH to ETH...`);
          try {
            const unwrapTx = await wethContract.withdraw(wethBalance, {
              gasPrice,
              gasLimit: 50000n
            });
            await unwrapTx.wait();
            console.log(`   ✅ WETH unwrapped to ETH: ${unwrapTx.hash}`);
          } catch (unwrapError) {
            console.log(`   ⚠️ WETH unwrap failed: ${unwrapError.message} (keeping as WETH)`);
          }
        }
        
        const ethBalanceAfter = await executeRpcWithFallback(async (provider) => {
          return await provider.getBalance(wallet.address);
        });
        finalAmount = parseFloat(ethers.formatEther(ethBalanceAfter - ethBalanceBefore + step2Receipt.gasUsed * gasPrice));
        
      } else {
        // Use TRUSTSWAP for other tokens
        step2Result = await executeTransactionWithReplacementFee(
          async (currentProvider, gasParams) => {
            const walletWithProvider = wallet.connect(currentProvider);
            const trustSwap = new ethers.Contract(CONTRACTS.TRUSTSWAP, TRUSTSWAP_ABI, walletWithProvider);
            
            return await trustSwap.swapVirtualWithFee(
              virtualAmountWei,
              0, // Minimum output
              currencyInfo.address,
              deadline,
              {
                maxFeePerGas: gasParams.maxFeePerGas,
                maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
                gasLimit: gasLimit
              }
            );
          }
        );
        
        step2Tx = { hash: step2Result.hash };
        step2Receipt = step2Result.receipt;
        
        // Get final currency balance
        const currencyContract = new ethers.Contract(currencyInfo.address, ERC20_ABI, wallet);
        const finalBalance = await currencyContract.balanceOf(wallet.address);
        finalAmount = parseFloat(ethers.formatUnits(finalBalance, currencyInfo.decimals));
      }
      
      console.log(`   ✅ Step 2 completed: ${step2Tx.hash}`);
      console.log(`   🎯 Final received: ${finalAmount.toFixed(6)} ${currencyInfo.symbol}`);
      
      if (tracker) {
        tracker.addTransaction(
          wallet.address,
          tokenInfo.symbol,
          tokenAmount,
          currencyInfo.symbol,
          finalAmount
        );
      }
      
      return {
        success: true,
        step1Hash: step1Result.txHash,
        step2Hash: step2Tx.hash,
        txHash: step2Tx.hash,
        finalAmount: finalAmount,
        twoStep: true,
        step1RpcProvider: step1Result.rpcProvider,
        step2RpcProvider: step2Result ? (step2Result.provider || 'unknown') : 'unknown'
      };
      
    } catch (error) {
      console.log(`❌ Two-step sell failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Execute FSH-specific TRUSTSWAP swap
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information
   * @param {number} tokenAmount - Amount to sell
   * @param {string} customGasPrice - Custom gas price
   * @param {Object} fshConfig - FSH-specific configuration
   * @returns {Object} Transaction result
   */
  static async executeFSHTrustSwap(wallet, tokenInfo, tokenAmount, customGasPrice = null, fshConfig) {
    try {
      console.log(`  🔥 FSH-TRUSTSWAP: Selling ${tokenAmount.toFixed(6)} ${tokenInfo.symbol}...`);
      
      const gasPrice = customGasPrice ? 
        ethers.parseUnits(customGasPrice, 'gwei') : 
        await gasPriceService.getLegacyGasPrice();
      const gasLimit = BigInt(fshConfig.SETTINGS.GAS_LIMIT);
      const deadline = Math.floor(Date.now() / 1000) + (fshConfig.SETTINGS.DEADLINE_MINUTES * 60);
      
      const tokenAmountWei = ethers.parseUnits(tokenAmount.toString(), tokenInfo.decimals);
      
      // FSH-specific token approval
      await this.checkAndApproveToken(wallet, tokenInfo.address, fshConfig.CONTRACT_ADDRESS, tokenAmountWei, tokenInfo.symbol, gasPrice);
      
      // Record VIRTUAL balance before FSH swap
      const virtualContract = new ethers.Contract(CONTRACTS.VIRTUAL, ERC20_ABI, wallet);
      const balanceBefore = await virtualContract.balanceOf(wallet.address);
      
      // Execute FSH-specific TRUSTSWAP swap
      const swapResult = await executeTransactionWithReplacementFee(
        async (currentProvider, gasParams) => {
          const walletWithProvider = wallet.connect(currentProvider);
          const fshTrustSwap = new ethers.Contract(fshConfig.CONTRACT_ADDRESS, fshConfig.ABI, walletWithProvider);
          
          return await fshTrustSwap.swapForVirtualWithFee(
            tokenInfo.address,
            tokenAmountWei,
            fshConfig.SETTINGS.MIN_AMOUNT_OUT,
            deadline,
            {
              maxFeePerGas: gasParams.maxFeePerGas,
              maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
              gasLimit: gasLimit
            }
          );
        }
      );
      
      // Calculate VIRTUAL received from FSH operation
      const balanceAfter = await virtualContract.balanceOf(wallet.address);
      const virtualReceived = parseFloat(ethers.formatEther(balanceAfter - balanceBefore));
      
      console.log(`  ✅ FSH-TRUSTSWAP: Success! ${virtualReceived.toFixed(6)} VIRTUAL received`);
      
      return {
        success: true,
        txHash: swapResult.hash,
        virtualReceived: virtualReceived,
        gasUsed: swapResult.receipt.gasUsed.toString(),
        isFSHTrustSwap: true,
        contractAddress: fshConfig.CONTRACT_ADDRESS
      };
      
    } catch (error) {
      console.log(`  ❌ FSH-TRUSTSWAP: Failed - ${error.message}`);
      return { 
        success: false, 
        error: error.message,
        isFSHTrustSwap: true,
        contractAddress: fshConfig.CONTRACT_ADDRESS
      };
    }
  }

  /**
   * Execute ETH sell using TRUSTSWAP swapTokensForETHWithFee (BID-MODE)
   * @param {Object} wallet - Wallet instance
   * @param {Object} tokenInfo - Token information
   * @param {number} tokenAmount - Amount to sell
   * @param {string} customGasPrice - Custom gas price
   * @returns {Object} Transaction result
   */
  static async executeETHSell(wallet, tokenInfo, tokenAmount, customGasPrice = null) {
    try {
      console.log(`\n🎯 BID-MODE ETH Sell: ${tokenAmount} ${tokenInfo.symbol} → ETH`);
      
      const gasPrice = customGasPrice ? 
        ethers.parseUnits(customGasPrice, 'gwei') : 
        await gasPriceService.getLegacyGasPrice();
      const gasLimit = 500000n;
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      
      const tokenAmountWei = ethers.parseUnits(tokenAmount.toString(), tokenInfo.decimals);
      
      // Check and approve token for TRUSTSWAP
      console.log(`   🔍 Checking ${tokenInfo.symbol} approval for TRUSTSWAP...`);
      await this.checkAndApproveToken(wallet, tokenInfo.address, CONTRACTS.TRUSTSWAP, tokenAmountWei, tokenInfo.symbol, gasPrice);
      
      // Record ETH balance before swap
      const ethBalanceBefore = await executeRpcWithFallback(async (provider) => {
        return await provider.getBalance(wallet.address);
      });
      
      console.log(`   💰 Selling: ${tokenAmount} ${tokenInfo.symbol}`);
      console.log(`   🔄 Executing TRUSTSWAP.swapTokensForETHWithFee...`);
      
      // Execute ETH swap using TRUSTSWAP
      const swapResult = await executeTransactionWithReplacementFee(
        async (currentProvider, gasParams) => {
          const walletWithProvider = wallet.connect(currentProvider);
          const trustSwap = new ethers.Contract(CONTRACTS.TRUSTSWAP, TRUSTSWAP_ABI, walletWithProvider);
          
          return await trustSwap.swapTokensForETHWithFee(
            tokenInfo.address,
            tokenAmountWei,
            0, // Minimum ETH output (let TRUSTSWAP handle slippage)
            deadline,
            {
              maxFeePerGas: gasParams.maxFeePerGas,
              maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
              gasLimit: gasLimit
            }
          );
        }
      );
      
      // Calculate ETH received (accounting for gas used)
      const ethBalanceAfter = await executeRpcWithFallback(async (provider) => {
        return await provider.getBalance(wallet.address);
      });
      
      const gasUsed = swapResult.receipt.gasUsed;
      const gasCost = gasUsed * gasPrice;
      const ethReceived = parseFloat(ethers.formatEther(ethBalanceAfter - ethBalanceBefore + gasCost));
      
      console.log(`   ✅ ETH received: ${ethReceived.toFixed(6)} ETH`);
      console.log(`   📊 Gas used: ${gasUsed.toString()} (${ethers.formatEther(gasCost)} ETH)`);
      console.log(`   🎯 Transaction: ${swapResult.hash}`);
      
      return {
        success: true,
        txHash: swapResult.hash,
        ethReceived: ethReceived,
        gasUsed: gasUsed.toString(),
        gasCost: parseFloat(ethers.formatEther(gasCost)),
        bidMode: true,
        rpcProvider: swapResult.provider
      };
      
    } catch (error) {
      console.log(`   ❌ BID-MODE ETH sell failed: ${error.message}`);
      return { 
        success: false, 
        error: error.message,
        bidMode: true
      };
    }
  }
} 