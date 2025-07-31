import { ethers } from 'ethers';
import readline from 'readline';
import { provider, executeTransactionWithReplacementFee, getRandomProvider } from '../src/config.js';
import { log, sleep, getRandomInt } from '../src/utils.js';

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

// TRUSTSWAP configuration
const TRUSTSWAP_CONTRACT = '0x74fa2835311Da3118BF2971Fa11E8070e4ff1693';
const TRUSTSWAP_ABI = [
  // View functions
  "function getAmountsOutWithFee(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts, uint256 feeAmount)",
  "function calculatePlatformFee(uint256 amount) public view returns (uint256)",
  
  // Swap functions
  "function swapForVirtualWithFee(address tokenIn, uint256 amountIn, uint256 amountOutMin, uint256 deadline) external returns (uint256[] memory)",
  "function swapVirtualWithFee(uint256 amountIn, uint256 amountOutMin, address tokenOut, uint256 deadline) external returns (uint256[] memory)",
  "function swapETHForTokensWithFee(address tokenOut, uint256 amountOutMin, uint256 deadline) payable returns (uint256)",
  "function swapTokensForETHWithFee(address tokenIn, uint256 amountIn, uint256 amountOutMin, uint256 deadline) returns (uint256)"
];

export class FarmBot {
  constructor(wallets, tokenInfo, virtualCA, defaultSettings) {
    this.wallets = wallets;
    this.tokenInfo = tokenInfo;
    this.virtualCA = virtualCA;
    this.defaultSettings = defaultSettings;
    this.fixedGasPrice = ethers.parseUnits('0.02', 'gwei');
    
    // Uses TRUSTSWAP contract for all swap operations (0.25% fee)
  }

  // Get VIRTUAL balance
  async getVirtualBalance(wallet) {
    const virtualContract = new ethers.Contract(
      this.virtualCA,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );
    const balance = await virtualContract.balanceOf(wallet.address);
    return parseFloat(ethers.formatUnits(balance, 18));
  }

  // Get token balance
  async getTokenBalance(wallet) {
    const tokenContract = new ethers.Contract(
      this.tokenInfo.address,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );
    const balance = await tokenContract.balanceOf(wallet.address);
    return parseFloat(ethers.formatUnits(balance, this.tokenInfo.decimals));
  }

  // Check and approve both VIRTUAL and token spending for TRUSTSWAP
  async checkAndApproveTokens(wallet, virtualAmount, tokenAmount) {
    // Approve VIRTUAL for TRUSTSWAP
    const virtualContract = new ethers.Contract(
      this.virtualCA,
      ['function allowance(address owner, address spender) view returns (uint256)', 'function approve(address spender, uint256 amount) returns (bool)'],
      wallet
    );

    const virtualAllowance = await virtualContract.allowance(wallet.address, TRUSTSWAP_CONTRACT);
    const virtualAmountWei = ethers.parseUnits(virtualAmount.toString(), 18);

    if (virtualAllowance < virtualAmountWei) {
      console.log(`   🔓 Approving UNLIMITED VIRTUAL for TRUSTSWAP...`);
      
      // Use replacement fee handler for approval transaction
      await executeTransactionWithReplacementFee(
        async (currentProvider, gasParams) => {
          const walletWithProvider = wallet.connect(currentProvider);
          const contractWithProvider = virtualContract.connect(walletWithProvider);
          
          return await contractWithProvider.approve(TRUSTSWAP_CONTRACT, ethers.MaxUint256, {
            maxFeePerGas: gasParams.maxFeePerGas,
            maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
            gasLimit: 200000n
          });
        }
      );
      
      console.log(`   ✅ VIRTUAL UNLIMITED TRUSTSWAP approval confirmed`);
    }

    // Approve Token for TRUSTSWAP
    const tokenContract = new ethers.Contract(
      this.tokenInfo.address,
      ['function allowance(address owner, address spender) view returns (uint256)', 'function approve(address spender, uint256 amount) returns (bool)'],
      wallet
    );

    const tokenAllowance = await tokenContract.allowance(wallet.address, TRUSTSWAP_CONTRACT);
    const tokenAmountWei = ethers.parseUnits(tokenAmount.toString(), this.tokenInfo.decimals);

    if (tokenAllowance < tokenAmountWei) {
      console.log(`   🔓 Approving UNLIMITED ${this.tokenInfo.symbol} for TRUSTSWAP...`);
      
      // Use replacement fee handler for approval transaction
      await executeTransactionWithReplacementFee(
        async (currentProvider, gasParams) => {
          const walletWithProvider = wallet.connect(currentProvider);
          const contractWithProvider = tokenContract.connect(walletWithProvider);
          
          return await contractWithProvider.approve(TRUSTSWAP_CONTRACT, ethers.MaxUint256, {
            maxFeePerGas: gasParams.maxFeePerGas,
            maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
            gasLimit: 200000n
          });
        }
      );
      
      console.log(`   ✅ ${this.tokenInfo.symbol} UNLIMITED TRUSTSWAP approval confirmed`);
    }
  }

  // Calculate expected token amount from VIRTUAL amount
  async calculateTokenFromVirtual(virtualAmount, slippage) {
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
    const virtualIsToken0 = token0.toLowerCase() === this.virtualCA.toLowerCase();

    const virtualReserve = virtualIsToken0 ? reserve0 : reserve1;
    const tokenReserve = virtualIsToken0 ? reserve1 : reserve0;

    // Calculate output using Uniswap V2 formula
    const amountInWei = ethers.parseUnits(virtualAmount.toString(), 18);
    const amountInWithFee = amountInWei * 997n;
    const numerator = amountInWithFee * tokenReserve;
    const denominator = virtualReserve * 1000n + amountInWithFee;
    const amountOut = numerator / denominator;

    // Apply slippage for minimum amount
    const slippageMultiplier = (100 - slippage) / 100;
    const minAmountOut = amountOut * BigInt(Math.floor(slippageMultiplier * 10000)) / 10000n;

    return {
      expectedTokens: parseFloat(ethers.formatUnits(amountOut, this.tokenInfo.decimals)),
      minAmountOut: minAmountOut,
      minAmountOutFormatted: parseFloat(ethers.formatUnits(minAmountOut, this.tokenInfo.decimals))
    };
  }

  // Calculate expected VIRTUAL amount from token amount
  async calculateVirtualFromToken(tokenAmount, slippage) {
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
    const virtualIsToken0 = token0.toLowerCase() === this.virtualCA.toLowerCase();

    const virtualReserve = virtualIsToken0 ? reserve0 : reserve1;
    const tokenReserve = virtualIsToken0 ? reserve1 : reserve0;

    // Calculate output using Uniswap V2 formula
    const amountInWei = ethers.parseUnits(tokenAmount.toString(), this.tokenInfo.decimals);
    const amountInWithFee = amountInWei * 997n;
    const numerator = amountInWithFee * virtualReserve;
    const denominator = tokenReserve * 1000n + amountInWithFee;
    const amountOut = numerator / denominator;

    // Apply slippage for minimum amount
    const slippageMultiplier = (100 - slippage) / 100;
    const minAmountOut = amountOut * BigInt(Math.floor(slippageMultiplier * 10000)) / 10000n;

    return {
      expectedVirtual: parseFloat(ethers.formatUnits(amountOut, 18)),
      minAmountOut: minAmountOut,
      minAmountOutFormatted: parseFloat(ethers.formatUnits(minAmountOut, 18))
    };
  }

  // Get precise balance using BigNumber
  async getVirtualBalancePrecise(wallet) {
    const virtualContract = new ethers.Contract(
      this.virtualCA,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );
    return await virtualContract.balanceOf(wallet.address);
  }

  // Get precise token balance using BigNumber
  async getTokenBalancePrecise(wallet) {
    const tokenContract = new ethers.Contract(
      this.tokenInfo.address,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );
    return await tokenContract.balanceOf(wallet.address);
  }

  // Format BigNumber to readable string with precision
  formatBalance(balance, decimals) {
    return ethers.formatUnits(balance, decimals);
  }

  // Execute farm operation with parallel buy/sell using same RPC
  async executeFarm(wallet, virtualAmount, slippage) {
    try {
      console.log(`   🔬 ACCURATE FARM ANALYSIS - Wallet: ${wallet.address.slice(0, 8)}`);
      
      // 1. Get precise balances BEFORE transactions
      const virtualBalanceBefore = await this.getVirtualBalancePrecise(wallet);
      const tokenBalanceBefore = await this.getTokenBalancePrecise(wallet);
      
      console.log(`   📊 BEFORE: VIRTUAL=${this.formatBalance(virtualBalanceBefore, 18)}, ${this.tokenInfo.symbol}=${this.formatBalance(tokenBalanceBefore, this.tokenInfo.decimals)}`);

      // 2. Check sufficient balances using precise amounts
      const virtualAmountWei = ethers.parseUnits(virtualAmount.toString(), 18);
      if (virtualBalanceBefore < virtualAmountWei) {
        return {
          success: false,
          reason: 'insufficient_virtual_balance',
          wallet: wallet.address.slice(0, 8),
          required: virtualAmount,
          available: parseFloat(this.formatBalance(virtualBalanceBefore, 18))
        };
      }

      // 3. Calculate expected amounts with current pool state
      const { expectedTokens, minAmountOut: minTokenOut } = await this.calculateTokenFromVirtual(virtualAmount, slippage);
      const tokensToSell = expectedTokens * 0.9999; // Account for rounding
      const tokensToSellWei = ethers.parseUnits(tokensToSell.toString(), this.tokenInfo.decimals);

      if (tokenBalanceBefore < tokensToSellWei) {
        return {
          success: false,
          reason: 'insufficient_token_balance',
          wallet: wallet.address.slice(0, 8),
          requiredTokens: tokensToSell,
          availableTokens: parseFloat(this.formatBalance(tokenBalanceBefore, this.tokenInfo.decimals))
        };
      }

      const { expectedVirtual, minAmountOut: minVirtualOut } = await this.calculateVirtualFromToken(tokensToSell, slippage);

      console.log(`   📈 EXPECTED: Buy ${virtualAmount} VIRTUAL → ${expectedTokens.toFixed(8)} ${this.tokenInfo.symbol}`);
      console.log(`   📈 EXPECTED: Sell ${tokensToSell.toFixed(8)} ${this.tokenInfo.symbol} → ${expectedVirtual.toFixed(8)} VIRTUAL`);
      console.log(`   📈 EXPECTED NET: ${(expectedVirtual - virtualAmount).toFixed(8)} VIRTUAL`);

      // 4. Approve tokens
      await this.checkAndApproveTokens(wallet, virtualAmount, tokensToSell);

      // 5. Get selected RPC provider for this wallet's transactions
      const selectedProvider = getRandomProvider();
      const providerName = selectedProvider._providerName || 'Unknown';
      console.log(`   🔧 Using RPC provider: ${providerName} for both transactions`);
      
      // 6. Execute transactions using TRUSTSWAP with parallel execution
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      const trustSwap = new ethers.Contract(TRUSTSWAP_CONTRACT, TRUSTSWAP_ABI, wallet);
      
      const result = await executeTransactionWithReplacementFee(
        async (currentProvider, gasParams) => {
          // Use the selected provider for both transactions
          const provider = selectedProvider;
          const walletWithProvider = wallet.connect(provider);
          const trustSwapWithProvider = trustSwap.connect(walletWithProvider);
          
          // Get base nonce
          const baseNonce = await provider.getTransactionCount(wallet.address, 'pending');
          
          console.log(`   ⚡ Executing parallel transactions with nonces ${baseNonce} and ${baseNonce + 1}`);
          
          // Buy transaction (nonce)
          const buyTx = await trustSwapWithProvider.swapVirtualWithFee(
            virtualAmountWei,
            minTokenOut,
            this.tokenInfo.address,
            deadline,
            {
              maxFeePerGas: gasParams.maxFeePerGas,
              maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
              gasLimit: 500000n,
              nonce: baseNonce
            }
          );
          
          // Sell transaction (nonce + 1)
          const sellTx = await trustSwapWithProvider.swapForVirtualWithFee(
            this.tokenInfo.address,
            tokensToSellWei,
            minVirtualOut,
            deadline,
            {
              maxFeePerGas: gasParams.maxFeePerGas,
              maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
              gasLimit: 500000n,
              nonce: baseNonce + 1
            }
          );
          
          console.log(`   🟢 Buy TX: ${buyTx.hash}`);
          console.log(`   🔴 Sell TX: ${sellTx.hash}`);
          
          // Wait for both transactions
          const [buyReceipt, sellReceipt] = await Promise.all([
            buyTx.wait(),
            sellTx.wait()
          ]);
          
          const sameBlock = buyReceipt.blockNumber === sellReceipt.blockNumber;
          console.log(`   🎯 ${sameBlock ? '✅ SAME BLOCK' : '❌ DIFFERENT BLOCKS'}: Buy block ${buyReceipt.blockNumber}, Sell block ${sellReceipt.blockNumber}`);
          
          return {
            buyTx,
            sellTx,
            buyReceipt,
            sellReceipt,
            provider: providerName,
            sameBlock
          };
        }
      );

      // 7. Get precise balances AFTER transactions
      const virtualBalanceAfter = await this.getVirtualBalancePrecise(wallet);
      const tokenBalanceAfter = await this.getTokenBalancePrecise(wallet);

      console.log(`   📊 AFTER: VIRTUAL=${this.formatBalance(virtualBalanceAfter, 18)}, ${this.tokenInfo.symbol}=${this.formatBalance(tokenBalanceAfter, this.tokenInfo.decimals)}`);

      // 8. Calculate ACTUAL amounts (using BigNumber for precision)
      const actualVirtualChange = virtualBalanceAfter - virtualBalanceBefore;
      const actualTokenChange = tokenBalanceAfter - tokenBalanceBefore;

      // 9. Convert to readable numbers for comparison
      const actualVirtualNet = parseFloat(this.formatBalance(actualVirtualChange, 18));
      const actualTokenNet = parseFloat(this.formatBalance(actualTokenChange, this.tokenInfo.decimals));
      
      // 10. Calculate accuracy
      const expectedNet = expectedVirtual - virtualAmount;
      const accuracyPercent = expectedNet !== 0 ? ((actualVirtualNet / expectedNet) * 100) : 100;

      console.log(`   🎯 ACCURACY ANALYSIS:`);
      console.log(`   💰 Expected net: ${expectedNet.toFixed(8)} VIRTUAL`);
      console.log(`   💰 Actual net: ${actualVirtualNet.toFixed(8)} VIRTUAL`);
      console.log(`   📊 Accuracy: ${accuracyPercent.toFixed(2)}%`);
      console.log(`   🔄 Same block: ${result.sameBlock ? '✅ YES' : '❌ NO'}`);
      console.log(`   ✅ Farm completed with verified amounts!`);

      return {
        success: true,
        wallet: wallet.address.slice(0, 8),
        // Expected amounts
        virtualSpent: virtualAmount,
        tokensTraded: tokensToSell,
        expectedVirtualReceived: expectedVirtual,
        expectedNetVirtual: expectedNet,
        // Actual amounts (verified from blockchain)
        actualVirtualNet: actualVirtualNet,
        actualTokenNet: actualTokenNet,
        // Use actual net instead of expected for summary
        netVirtual: actualVirtualNet,
        // Accuracy metrics
        accuracy: accuracyPercent,
        sameBlock: result.sameBlock,
        // Transaction details
        buyTxHash: result.buyTx.hash,
        sellTxHash: result.sellTx.hash,
        buyBlockNumber: result.buyReceipt.blockNumber,
        sellBlockNumber: result.sellReceipt.blockNumber,
        rpcProvider: result.provider
      };

    } catch (error) {
      console.log(`   ❌ Farm failed: ${error.message}`);
      return {
        success: false,
        reason: 'transaction_failed',
        wallet: wallet.address.slice(0, 8),
        error: error.message
      };
    }
  }

  // Run continuous farming
  async runContinuousFarming() {
    console.log('\n🔄 CONTINUOUS FARM MODE');
    console.log('=======================');

    // Get user input
    const virtualAmountInput = await askQuestion('Enter VIRTUAL amount per farm operation (or press Enter for auto): ');
    const slippageInput = await askQuestion(`Enter slippage % (default ${this.defaultSettings.MAX_SLIPPAGE_PERCENT}%): `);
    const loopsInput = await askQuestion('Enter number of loops (or press Enter for infinite): ');

    const slippage = slippageInput ? parseFloat(slippageInput) : this.defaultSettings.MAX_SLIPPAGE_PERCENT;
    const numLoops = loopsInput ? parseInt(loopsInput) : Infinity;

    let virtualAmount;
    if (virtualAmountInput) {
      virtualAmount = parseFloat(virtualAmountInput);
    } else {
      // Use percentage of balance
      const wallet = this.wallets[0];
      const balance = await this.getVirtualBalance(wallet);
      const minPercent = this.defaultSettings.VIRTUAL_AMOUNT_MIN_PERCENT;
      const maxPercent = this.defaultSettings.VIRTUAL_AMOUNT_MAX_PERCENT;
      const randomPercent = minPercent + Math.random() * (maxPercent - minPercent);
      virtualAmount = balance * (randomPercent / 100);
      console.log(`\n💡 Auto amount: ${virtualAmount.toFixed(4)} VIRTUAL (${randomPercent.toFixed(2)}% of balance)`);
    }

    console.log(`\n🚀 Starting farm operations...`);
    console.log(`💰 Amount: ${virtualAmount} VIRTUAL per operation`);
    console.log(`🛡️ Slippage: ${slippage}%`);
    console.log(`🔄 Loops: ${numLoops === Infinity ? 'infinite' : numLoops}`);
    console.log(`👛 Wallets: ${this.wallets.length}`);
    console.log(`⚡ Strategy: Sequential wallets, parallel buy/sell per wallet`);

    const allResults = [];
    let currentLoop = 0;

    while (currentLoop < numLoops || numLoops === Infinity) {
      currentLoop++;
      console.log(`\n🔄 Loop ${currentLoop}${numLoops !== Infinity ? `/${numLoops}` : ''}:`);
      
      // Process wallets sequentially
      for (let i = 0; i < this.wallets.length; i++) {
        const wallet = this.wallets[i];
        console.log(`\n📍 Wallet ${i + 1}/${this.wallets.length}: ${wallet.address.slice(0, 8)}...`);
        
        // Add some randomness to the amount (±10%)
        const randomMultiplier = 0.9 + Math.random() * 0.2; // 0.9 to 1.1
        const currentAmount = virtualAmount * randomMultiplier;
        
        const result = await this.executeFarm(wallet, currentAmount, slippage);
        allResults.push(result);
        
        if (result.success) {
          console.log(`   💰 Net result: ${result.netVirtual > 0 ? '+' : ''}${result.netVirtual.toFixed(4)} VIRTUAL`);
        }
        
        // Delay between wallets
        if (i < this.wallets.length - 1) {
          const delay = getRandomInt(this.defaultSettings.DELAY_BETWEEN_TXS_MIN, this.defaultSettings.DELAY_BETWEEN_TXS_MAX);
          console.log(`   ⏳ Waiting ${delay}s before next wallet...`);
          await sleep(delay * 1000);
        }
      }
      
      // Delay between loops
      if (currentLoop < numLoops || numLoops === Infinity) {
        const delay = getRandomInt(this.defaultSettings.LOOP_DELAY_MIN, this.defaultSettings.LOOP_DELAY_MAX);
        console.log(`   ⏳ Waiting ${delay}s before next loop...`);
        await sleep(delay * 1000);
      }
    }

    // Summary
    const successful = allResults.filter(r => r.success).length;
    const failed = allResults.filter(r => !r.success).length;
    const totalVolume = allResults.filter(r => r.success).reduce((sum, r) => sum + r.virtualSpent, 0);
    const totalNetVirtual = allResults.filter(r => r.success).reduce((sum, r) => sum + r.netVirtual, 0);
    const sameBlockCount = allResults.filter(r => r.success && r.sameBlock).length;

    console.log(`\n📊 FARM SUMMARY:`);
    console.log(`✅ Successful: ${successful}/${allResults.length}`);
    console.log(`❌ Failed: ${failed}/${allResults.length}`);
    console.log(`💰 Total volume: ${totalVolume.toFixed(4)} VIRTUAL`);
    console.log(`📊 Net VIRTUAL: ${totalNetVirtual > 0 ? '+' : ''}${totalNetVirtual.toFixed(4)}`);
    console.log(`🎯 Same block executions: ${sameBlockCount}/${successful} (${Math.round(sameBlockCount/successful*100)}%)`);

    return allResults;
  }

  // Start the farm bot
  async start() {
    console.log(`\n🔄 FARMBOT - ${this.tokenInfo.symbol}`);
    console.log('==================================');
    console.log(`📍 Token: ${this.tokenInfo.symbol} (${this.tokenInfo.name})`);
    console.log(`📄 Contract: ${this.tokenInfo.address}`);
    console.log(`🏊 Pool: ${this.tokenInfo.poolAddress}`);
    console.log(`👛 Wallets: ${this.wallets.length}`);
    console.log('');
    console.log('🎯 FARM STRATEGY:');
    console.log('   1. Process wallets sequentially');
    console.log('   2. For each wallet: Execute buy & sell in parallel');
    console.log('   3. Use same RPC provider for both transactions');
    console.log('   4. Submit with consecutive nonces (n, n+1)');
    console.log('   5. Target same block inclusion');

    console.log('\n⚠️  IMPORTANT:');
    console.log('   • Ensure wallets have both VIRTUAL and token balances');
    console.log('   • This creates artificial volume for the token');
    console.log('   • Monitor gas costs vs potential gains');

    const confirm = await askQuestion('\nProceed with volume farming? (y/n): ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('❌ Farm cancelled');
      return [];
    }

    try {
      const results = await this.runContinuousFarming();
      console.log('\n🏁 FarmBot completed!');
      return results;

    } catch (error) {
      console.log(`\n❌ FarmBot error: ${error.message}`);
      throw error;
    } finally {
      rl.close();
    }
  }
}