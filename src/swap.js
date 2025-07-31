import { ERC20_ABI } from './config.js';
import { ethers } from 'ethers';
import { 
  ChainId,
  Token,
  TokenAmount,
  Pair,
  Trade,
  Route,
  Percent,
  TradeType
} from '@uniswap/sdk';
import { 
  provider, 
  TRUST_TOKEN_ADDRESS, 
  VIRTUAL_TOKEN_ADDRESS,
  POOL_ADDRESSES,
  TOKEN_ADDRESSES,
  GAS_CONFIG,
  getVirtualTokenContract,
  getTrustTokenContract,
  getTokenContract,
  BOT_CONFIG,
  BOT_MODE,
  TRADING_STRATEGY,
  STRATEGY_CONFIG,
  getPoolAddress
} from './config.js';
import { log, getRandomInt, sleep } from './utils.js';
import { tradingWallets } from './wallets.js';
import { getTokensWithPools, getDatabaseStats } from './database.js';

// Initialize tokens
const VIRTUAL = new Token(
  ChainId.BASE,
  VIRTUAL_TOKEN_ADDRESS,
  18,
  'VIRTUAL',
  'Virtual Token'
);

const TRUST = new Token(
  ChainId.BASE,
  TRUST_TOKEN_ADDRESS,
  18,
  'TRUST',
  'Trust Token'
);

// Uniswap V2 Pair ABI
import IUniswapV2PairJson from '@uniswap/v2-core/build/IUniswapV2Pair.json' with { type: "json" };
const IUniswapV2PairABI = IUniswapV2PairJson.abi;

// V2 Router configuration
const V2_ROUTER_ADDRESS = '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24'; // Base V2 Router
const V2_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external'
];

// Set fixed gas price for NON-JEET mode transactions
const fixedGasPrice = ethers.utils.parseUnits('0.02', 'gwei'); // Hard coded 0.02 gwei for non-JEET mode

// Get current pool price (VIRTUAL per TOKEN)
async function getCurrentPrice(tokenKey = 'TOKEN1') {
  const poolAddress = getPoolAddress(tokenKey);
  const pairContract = new ethers.Contract(poolAddress, [
    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() external view returns (address)',
    'function token1() external view returns (address)'
  ], provider);
  
  const [reserve0, reserve1] = await pairContract.getReserves();
  const token0Address = await pairContract.token0();
  const virtualIsToken0 = token0Address.toLowerCase() === VIRTUAL_TOKEN_ADDRESS.toLowerCase();
  
  // Calculate price as VIRTUAL per TOKEN (not TOKEN per VIRTUAL)
  if (virtualIsToken0) {
    // reserve0 = VIRTUAL, reserve1 = TOKEN
    // Price = VIRTUAL_reserve / TOKEN_reserve (how much VIRTUAL for 1 TOKEN)
    return Number(ethers.utils.formatUnits(reserve0, 18)) / Number(ethers.utils.formatUnits(reserve1, 18));
  } else {
    // reserve0 = TOKEN, reserve1 = VIRTUAL  
    // Price = VIRTUAL_reserve / TOKEN_reserve (how much VIRTUAL for 1 TOKEN)
    return Number(ethers.utils.formatUnits(reserve1, 18)) / Number(ethers.utils.formatUnits(reserve0, 18));
  }
}

// Function to swap an exact amount of VIRTUAL for any amount of TRUST
export async function swapExactVirtualAmount(wallet, virtualAmountToSpend, tokenKey = 'TOKEN1') {
  try {
    // Initialize contracts with wallet as signer
    const virtualTokenContract = getVirtualTokenContract(wallet);
    const trustTokenContract = getTrustTokenContract(wallet);
    
    // Get token decimals
    const virtualDecimals = await virtualTokenContract.decimals();
    const trustDecimals = await trustTokenContract.decimals();
    
    // Convert desired VIRTUAL amount to token units
    const desiredVirtualAmount = ethers.utils.parseUnits(virtualAmountToSpend.toString(), virtualDecimals);
    
    // Check if wallet has enough Virtual tokens
    const walletBalance = await virtualTokenContract.balanceOf(wallet.address);
    if (walletBalance.lt(desiredVirtualAmount)) {
      log(`Wallet ${wallet.address} has insufficient Virtual tokens. ` +
          `Needed: ${ethers.utils.formatUnits(desiredVirtualAmount, virtualDecimals)}, ` +
          `Has: ${ethers.utils.formatUnits(walletBalance, virtualDecimals)}`);
      
      return { 
        success: false, 
        reason: 'insufficient_balance',
        walletAddress: wallet.address
      };
    }
    
    // Get pair contract using the token-specific pool address
    const poolAddress = getPoolAddress(tokenKey);
    const pairContract = new ethers.Contract(poolAddress, [
      'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
      'function token0() external view returns (address)',
      'function token1() external view returns (address)'
    ], provider);
    
    // Get token ordering in the pair
    const token0Address = await pairContract.token0();
    const virtualIsToken0 = token0Address.toLowerCase() === VIRTUAL_TOKEN_ADDRESS.toLowerCase();
    
    // Get reserves in correct order
    const [reserve0, reserve1] = await pairContract.getReserves();
    const [virtualReserve, trustReserve] = virtualIsToken0 
      ? [reserve0, reserve1] 
      : [reserve1, reserve0];
    
    // Create Uniswap SDK Pair instance
    const uniswapPair = new Pair(
      new TokenAmount(VIRTUAL, virtualReserve.toString()),
      new TokenAmount(TRUST, trustReserve.toString())
    );
    
    // Create route
    const route = new Route([uniswapPair], VIRTUAL);
    
    // Create trade with exact input
    const trade = new Trade(
      route,
      new TokenAmount(VIRTUAL, desiredVirtualAmount.toString()),
      TradeType.EXACT_INPUT
    );
    
    // Calculate expected output with slippage
    const slippagePercent = BOT_CONFIG.maxSlippagePercent || 3.0;
    const slippageBips = Math.floor(slippagePercent * 100);
    const slippageTolerance = new Percent(slippageBips.toString(), '10000');
    const minAmountOut = trade.minimumAmountOut(slippageTolerance);

    log(`Using slippage tolerance of ${slippagePercent}%`);
    const expectedTrustAmount = parseFloat(ethers.utils.formatUnits(minAmountOut.raw.toString(), trustDecimals));
    
    // Get current TRUST balance for comparing after swap
    const trustBalanceBefore = await trustTokenContract.balanceOf(wallet.address);
    
    // Log the expected swap details
    log(`Swap Details:`);
    log(`  VIRTUAL to spend: ${virtualAmountToSpend}`);
    log(`  Expected ${tokenKey} (minimum): ${expectedTrustAmount}`);
    log(`  Price impact: ${trade.priceImpact.toSignificant(2)}%`);
    log(`  Route: ${trade.route.path.map(t => t.symbol).join(' -> ')}`);
    
    // Approve the V2 router to spend VIRTUAL tokens if needed
    const currentRouterAllowance = await virtualTokenContract.allowance(wallet.address, V2_ROUTER_ADDRESS);
    if (currentRouterAllowance.lt(desiredVirtualAmount)) {
      log(`Approving V2 router to spend Virtual tokens...`);
      const approveTx = await virtualTokenContract.approve(V2_ROUTER_ADDRESS, ethers.constants.MaxUint256, { 
        gasPrice: fixedGasPrice,
        gasLimit: ethers.BigNumber.from('200000') // Hard coded: Approve 200k
      });
      await approveTx.wait();
      log(`V2 router approval confirmed!`);
    } else {
      log(`V2 router already has sufficient allowance`);
    }

    // Get deadline
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
    
    // Get the V2 router contract
    const router = new ethers.Contract(V2_ROUTER_ADDRESS, V2_ROUTER_ABI, wallet);
    
    // Log the swap parameters
    log(`Swap Parameters:`);
    log(`  Amount In: ${ethers.utils.formatUnits(desiredVirtualAmount, virtualDecimals)} VIRTUAL`);
    log(`  Min Amount Out: ${ethers.utils.formatUnits(minAmountOut.raw.toString(), trustDecimals)} ${tokenKey}`);
    log(`  Path: ${VIRTUAL_TOKEN_ADDRESS} -> ${TRUST_TOKEN_ADDRESS}`);
    log(`  Deadline: ${new Date(deadline * 1000).toISOString()}`);

    try {
      // Use fee-supporting function for tokens with transfer fees
      log(`Using fee-supporting swap function for tokens with transfer fees`);
      
      // Hard coded gas limit for swaps
      const gasLimit = ethers.BigNumber.from('500000'); // Hard coded: Swap 500k
      log(`Gas settings: gasPrice=${ethers.utils.formatUnits(fixedGasPrice,'gwei')} gwei, gasLimit=${gasLimit.toString()}`);
      
      // Create the swap transaction using fee-supporting function
      const swapTx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        desiredVirtualAmount,
        minAmountOut.raw.toString(),
        [VIRTUAL_TOKEN_ADDRESS, TRUST_TOKEN_ADDRESS],
        wallet.address,
        deadline,
        {
          gasPrice: fixedGasPrice,
          gasLimit
        }
      );
      
      log(`Swap transaction submitted. Tx hash: ${swapTx.hash}`);
      const receipt = await swapTx.wait();
      
      // Get final balances
      const virtualBalanceAfter = await virtualTokenContract.balanceOf(wallet.address);
      const trustBalanceAfter = await trustTokenContract.balanceOf(wallet.address);
      
      // Calculate how much TRUST was received
      const trustReceived = parseFloat(ethers.utils.formatUnits(
        trustBalanceAfter.sub(trustBalanceBefore), 
        trustDecimals
      ));
      
      log(`Swap completed successfully! ✅`);
      log(`Gas used: ${receipt.gasUsed.toString()}`);
      log('Final balances:');
      log(`  VIRTUAL: ${ethers.utils.formatUnits(virtualBalanceAfter, virtualDecimals)}`);
      log(`  ${tokenKey}: ${ethers.utils.formatUnits(trustBalanceAfter, trustDecimals)}`);
      log(`  ${tokenKey} received: ${trustReceived}`);
      
      return { 
        success: true,
        trustReceived: trustReceived,
        priceImpact: parseFloat(trade.priceImpact.toSignificant(2))
      };
    } catch (error) {
      log(`Error executing swap: ${error.message}`);
      if (error.transaction) {
        log(`Transaction hash: ${error.transactionHash}`);
        log(`Transaction data: ${error.transaction.data.substring(0, 66)}...`);
      }
      return { 
        success: false, 
        reason: 'transaction_failed', 
        error: error.message,
        walletAddress: wallet.address
      };
    }
  } catch (error) {
    log(`Error swapping tokens: ${error.message}`);
    console.error(error);
    return { 
      success: false, 
      reason: 'execution_error', 
      error: error.message,
      walletAddress: wallet.address 
    };
  }
}

// Function to swap an exact amount of TRUST for any amount of VIRTUAL
export async function swapExactTrustAmount(wallet, trustAmountToSell, tokenKey = 'TOKEN1') {
  try {
    const virtualTokenContract = getVirtualTokenContract(wallet);
    const trustTokenContract = getTrustTokenContract(wallet);
    const virtualDecimals = await virtualTokenContract.decimals();
    const trustDecimals = await trustTokenContract.decimals();
    
    const desiredTrustAmount = ethers.utils.parseUnits(trustAmountToSell.toString(), trustDecimals);
    
    // Check if wallet has enough TRUST tokens
    const walletBalance = await trustTokenContract.balanceOf(wallet.address);
    if (walletBalance.lt(desiredTrustAmount)) {
      log(`Wallet ${wallet.address} has insufficient ${tokenKey} tokens. ` +
          `Needed: ${ethers.utils.formatUnits(desiredTrustAmount, trustDecimals)}, ` +
          `Has: ${ethers.utils.formatUnits(walletBalance, trustDecimals)}`);
      return { success: false, reason: 'insufficient_balance', walletAddress: wallet.address };
    }
    
    // Get pair contract using token-specific pool address
    const poolAddress = getPoolAddress(tokenKey);
    const pairContract = new ethers.Contract(poolAddress, [
      'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
      'function token0() external view returns (address)',
      'function token1() external view returns (address)'
    ], provider);
    
    const token0Address = await pairContract.token0();
    const trustIsToken0 = token0Address.toLowerCase() === TRUST_TOKEN_ADDRESS.toLowerCase();
    
    const [reserve0, reserve1] = await pairContract.getReserves();
    const [trustReserve, virtualReserve] = trustIsToken0 ? [reserve0, reserve1] : [reserve1, reserve0];
    
    // Create Uniswap SDK Pair instance
    const uniswapPair = new Pair(
      new TokenAmount(TRUST, trustReserve.toString()),
      new TokenAmount(VIRTUAL, virtualReserve.toString())
    );
    
    // Create route
    const route = new Route([uniswapPair], TRUST);
    
    // Create trade with exact input
    const trade = new Trade(
      route,
      new TokenAmount(TRUST, desiredTrustAmount.toString()),
      TradeType.EXACT_INPUT
    );
    
    // Calculate expected output with slippage
    const slippagePercent = BOT_CONFIG.maxSlippagePercent || 3.0;
    const slippageBips = Math.floor(slippagePercent * 100);
    const slippageTolerance = new Percent(slippageBips.toString(), '10000');
    const minAmountOut = trade.minimumAmountOut(slippageTolerance);
    
    log(`Using slippage tolerance of ${slippagePercent}%`);
    const expectedVirtualAmount = parseFloat(ethers.utils.formatUnits(minAmountOut.raw.toString(), virtualDecimals));
    
    // Log the expected swap details
    log(`Sell Details:`);
    log(`  ${tokenKey} to sell: ${trustAmountToSell}`);
    log(`  Expected VIRTUAL (minimum): ${expectedVirtualAmount}`);
    log(`  Price impact: ${trade.priceImpact.toSignificant(2)}%`);
    log(`  Route: ${trade.route.path.map(t => t.symbol).join(' -> ')}`);

    // Approve the V2 router to spend TRUST tokens if needed
    const currentRouterAllowance = await trustTokenContract.allowance(wallet.address, V2_ROUTER_ADDRESS);
    if (currentRouterAllowance.lt(desiredTrustAmount)) {
      log(`Approving V2 router to spend ${tokenKey} tokens...`);
      const approveTx = await trustTokenContract.approve(V2_ROUTER_ADDRESS, ethers.constants.MaxUint256, { 
        gasPrice: fixedGasPrice,
        gasLimit: ethers.BigNumber.from('200000') // Hard coded: Approve 200k
      });
      await approveTx.wait();
      log(`V2 router approval confirmed!`);
    } else {
      log(`V2 router already has sufficient allowance`);
    }
    
    // Get deadline
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
    
    // Get the V2 router contract
    const router = new ethers.Contract(V2_ROUTER_ADDRESS, V2_ROUTER_ABI, wallet);
    
    // Log the swap parameters
    log(`Sell Parameters:`);
    log(`  Amount In: ${ethers.utils.formatUnits(desiredTrustAmount, trustDecimals)} ${tokenKey}`);
    log(`  Min Amount Out: ${ethers.utils.formatUnits(minAmountOut.raw.toString(), virtualDecimals)} VIRTUAL`);
    log(`  Path: ${TRUST_TOKEN_ADDRESS} -> ${VIRTUAL_TOKEN_ADDRESS}`);
    log(`  Deadline: ${new Date(deadline * 1000).toISOString()}`);

    // Get virtualBalanceBefore before swap
    const virtualBalanceBefore = await virtualTokenContract.balanceOf(wallet.address);
    
    try {
      // Use fee-supporting function for tokens with transfer fees
      log(`Using fee-supporting swap function for tokens with transfer fees`);
      
      // Hard coded gas limit for swaps
      const gasLimit = ethers.BigNumber.from('500000'); // Hard coded: Swap 500k
      log(`Gas settings: gasPrice=${ethers.utils.formatUnits(fixedGasPrice,'gwei')} gwei, gasLimit=${gasLimit.toString()}`);
      
      // Create the swap transaction using fee-supporting function
      const swapTx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        desiredTrustAmount,
        minAmountOut.raw.toString(),
        [TRUST_TOKEN_ADDRESS, VIRTUAL_TOKEN_ADDRESS],
        wallet.address,
        deadline,
        {
          gasPrice: fixedGasPrice,
          gasLimit
        }
      );
      
      log(`Swap transaction submitted. Tx hash: ${swapTx.hash}`);
      const receipt = await swapTx.wait();
      
      // Get final balances
      const trustBalanceAfter = await trustTokenContract.balanceOf(wallet.address);
      const virtualBalanceAfter = await virtualTokenContract.balanceOf(wallet.address);
      
      // Calculate how much VIRTUAL was received
      const virtualReceived = parseFloat(ethers.utils.formatUnits(
        virtualBalanceAfter.sub(virtualBalanceBefore), 
        virtualDecimals
      ));
      
      log(`Swap completed successfully! ✅`);
      log(`Gas used: ${receipt.gasUsed.toString()}`);
      log('Final balances:');
      log(`  ${tokenKey}: ${ethers.utils.formatUnits(trustBalanceAfter, trustDecimals)}`);
      log(`  VIRTUAL: ${ethers.utils.formatUnits(virtualBalanceAfter, virtualDecimals)}`);
      log(`  VIRTUAL received: ${virtualReceived}`);
      
      return {
        success: true,
        virtualReceived: virtualReceived,
        priceImpact: parseFloat(trade.priceImpact.toSignificant(2))
      };
    } catch (error) {
      log(`Error executing swap: ${error.message}`);
      if (error.transaction) {
        log(`Transaction hash: ${error.transactionHash}`);
        log(`Transaction data: ${error.transaction.data.substring(0, 66)}...`);
      }
      return {
        success: false,
        reason: 'transaction_failed',
        error: error.message,
        walletAddress: wallet.address
      };
    }
  } catch (error) {
    log(`Error swapping tokens: ${error.message}`);
    console.error(error);
    return { success: false, reason: 'execution_error', error: error.message, walletAddress: wallet.address };
  }
}

// Strategy 1: Instant Buy/Sell (2WAY mode only)
async function executeInstantBuySell(wallets, tokenKeys) {
  log('Starting Instant Buy/Sell strategy...');
  const { virtualAmountMin, virtualAmountMax } = BOT_CONFIG;
  const { INSTANT_DELAY_MIN, INSTANT_DELAY_MAX } = STRATEGY_CONFIG;
  
  let results = [];
  
  // Cycle through tokens
  for (const tokenKey of tokenKeys) {
    log(`\n=== Processing ${tokenKey} ===`);
    
    for (const wallet of wallets) {
      try {
        // Get current price in VIRTUAL
        const currentPrice = await getCurrentPrice(tokenKey);
        log(`Current ${tokenKey} price: ${currentPrice.toFixed(6)} VIRTUAL`);
        
        // Step 1: Buy
        const randomVirtualAmount = getRandomInt(virtualAmountMin, virtualAmountMax);
        log(`\n----- Instant Buy/Sell ${wallet.address} -----`);
        log(`Step 1: Buying with ${randomVirtualAmount} VIRTUAL`);
        
        const buyResult = await swapExactVirtualAmount(wallet, randomVirtualAmount, tokenKey);
        
        if (buyResult.success) {
          // Step 2: Wait briefly then sell the EXACT amount we just bought
          const delaySeconds = getRandomInt(INSTANT_DELAY_MIN, INSTANT_DELAY_MAX);
          log(`Step 2: Waiting ${delaySeconds} seconds before selling...`);
          await sleep(delaySeconds * 1000);
          
          // Sell exactly what we bought (after fees and slippage)
          log(`Step 3: Selling exactly ${buyResult.trustReceived} ${tokenKey}`);
          const sellResult = await swapExactTrustAmount(wallet, buyResult.trustReceived, tokenKey);
          
          results.push({
            wallet: wallet.address,
            tokenKey,
            strategy: 'instant_buy_sell',
            buySuccess: true,
            sellSuccess: sellResult.success,
            virtualSpent: randomVirtualAmount,
            tokenReceived: buyResult.trustReceived,
            virtualReceived: sellResult.virtualReceived || 0,
            price: currentPrice
          });
        } else {
          results.push({
            wallet: wallet.address,
            tokenKey,
            strategy: 'instant_buy_sell',
            buySuccess: false,
            sellSuccess: false,
            reason: buyResult.reason,
            price: currentPrice
          });
        }
        
        // Delay between wallets
        await sleep(getRandomInt(1000, 3000));
      } catch (error) {
        log(`Error in instant buy/sell for wallet ${wallet.address}: ${error.message}`);
        results.push({
          wallet: wallet.address,
          tokenKey,
          strategy: 'instant_buy_sell',
          buySuccess: false,
          sellSuccess: false,
          error: error.message
        });
      }
    }
  }
  
  return results;
}

// Strategy 2: Market Maker (2WAY mode only)
async function executeMarketMaker(wallets, tokenKeys) {
  log('Starting Market Maker strategy...');
  const { MM_PRICE_RANGE_PERCENT, MM_CHECK_INTERVAL_SECONDS } = STRATEGY_CONFIG;
  const { virtualAmountMin, virtualAmountMax } = BOT_CONFIG;
  
  let results = [];
  
  // Cycle through tokens
  for (const tokenKey of tokenKeys) {
    log(`\n=== Processing ${tokenKey} ===`);
    
    // Get initial price in VIRTUAL
    const initialPrice = await getCurrentPrice(tokenKey);
    log(`Initial ${tokenKey} price: ${initialPrice.toFixed(6)} VIRTUAL`);
    
    const buyThreshold = initialPrice * (1 - MM_PRICE_RANGE_PERCENT / 100);  // Buy when price drops
    const sellThreshold = initialPrice * (1 + MM_PRICE_RANGE_PERCENT / 100); // Sell when price rises
    
    log(`Buy threshold: ${buyThreshold.toFixed(6)} VIRTUAL (${MM_PRICE_RANGE_PERCENT}% below initial)`);
    log(`Sell threshold: ${sellThreshold.toFixed(6)} VIRTUAL (${MM_PRICE_RANGE_PERCENT}% above initial)`);
    
    // Market making loop for this token
    let transactionMade = false;
    while (!transactionMade) {
      const currentPrice = await getCurrentPrice(tokenKey);
      log(`Current ${tokenKey} price: ${currentPrice.toFixed(6)} VIRTUAL`);
      
      let actionTaken = false;
      
      // Check if price dropped below buy threshold
      if (currentPrice <= buyThreshold) {
        log(`Price dropped! Executing buy orders...`);
        
        for (const wallet of wallets) {
          try {
            const randomVirtualAmount = getRandomInt(virtualAmountMin, virtualAmountMax);
            log(`Buying ${randomVirtualAmount} VIRTUAL worth of ${tokenKey} with wallet ${wallet.address}`);
            
            const buyResult = await swapExactVirtualAmount(wallet, randomVirtualAmount, tokenKey);
            
            results.push({
              wallet: wallet.address,
              tokenKey,
              strategy: 'market_maker',
              action: 'buy',
              success: buyResult.success,
              virtualSpent: randomVirtualAmount,
              tokenReceived: buyResult.trustReceived || 0,
              price: currentPrice,
              trigger: 'price_drop'
            });
            
            if (buyResult.success) {
              transactionMade = true;
              actionTaken = true;
            }
            
            // Small delay between wallet transactions
            await sleep(1000);
          } catch (error) {
            log(`Error in market maker buy for wallet ${wallet.address}: ${error.message}`);
          }
        }
      }
      // Check if price rose above sell threshold
      else if (currentPrice >= sellThreshold) {
        log(`Price rose! Executing sell orders...`);
        
        for (const wallet of wallets) {
          try {
            // Calculate how much token to sell based on virtual amount
            const randomVirtualAmount = getRandomInt(virtualAmountMin, virtualAmountMax);
            const tokenAmountToSell = randomVirtualAmount / currentPrice;
            
            log(`Selling ${tokenAmountToSell.toFixed(6)} ${tokenKey} (≈${randomVirtualAmount} VIRTUAL) with wallet ${wallet.address}`);
            
            const sellResult = await swapExactTrustAmount(wallet, tokenAmountToSell, tokenKey);
            
            results.push({
              wallet: wallet.address,
              tokenKey,
              strategy: 'market_maker',
              action: 'sell',
              success: sellResult.success,
              tokenSold: tokenAmountToSell,
              virtualReceived: sellResult.virtualReceived || 0,
              price: currentPrice,
              trigger: 'price_rise'
            });
            
            if (sellResult.success) {
              transactionMade = true;
              actionTaken = true;
            }
            
            // Small delay between wallet transactions
            await sleep(1000);
          } catch (error) {
            log(`Error in market maker sell for wallet ${wallet.address}: ${error.message}`);
          }
        }
      }
      
      if (!actionTaken) {
        log(`Price within range. Waiting ${MM_CHECK_INTERVAL_SECONDS} seconds...`);
        await sleep(MM_CHECK_INTERVAL_SECONDS * 1000);
      }
    }
  }
  
  return results;
}

// Strategy 3: DEFAULT (TWAP for single direction - BUY or SELL mode only)
async function executeDefaultTWAP(wallets, tokenKeys) {
  log('Starting DEFAULT TWAP strategy...');
  const { virtualAmountMin, virtualAmountMax, delayBetweenTxsMin, delayBetweenTxsMax } = BOT_CONFIG;
  
  let results = [];
  
  // Cycle through tokens
  for (const tokenKey of tokenKeys) {
    log(`\n=== Processing ${tokenKey} ===`);
    
    // Get current price in VIRTUAL
    const currentPrice = await getCurrentPrice(tokenKey);
    log(`Current ${tokenKey} price: ${currentPrice.toFixed(6)} VIRTUAL`);
    
    for (const wallet of wallets) {
      try {
        // Generate random amount between min and max for each wallet
        const randomVirtualAmount = getRandomInt(virtualAmountMin, virtualAmountMax);
        
        log(`\n----- ${BOT_MODE} ${wallet.address} -----`);
        log(`Selected wallet: ${wallet.address}`);
        
        let result;
        if (BOT_MODE === 'BUY') {
          log(`VIRTUAL tokens to spend: ${randomVirtualAmount}`);
          result = await swapExactVirtualAmount(wallet, randomVirtualAmount, tokenKey);
        } else if (BOT_MODE === 'SELL') {
          // For sell mode, calculate token amount based on virtual equivalent
          const tokenAmountToSell = randomVirtualAmount / currentPrice;
          log(`${tokenKey} tokens to sell: ${tokenAmountToSell.toFixed(6)} (≈${randomVirtualAmount} VIRTUAL)`);
          result = await swapExactTrustAmount(wallet, tokenAmountToSell, tokenKey);
        }
        
        results.push({
          wallet: wallet.address,
          tokenKey,
          strategy: 'default_twap',
          mode: BOT_MODE,
          virtualAmount: randomVirtualAmount,
          success: result.success,
          reason: result.reason || 'No reason provided',
          received: result.trustReceived || result.virtualReceived || 0,
          price: currentPrice
        });
        
        if (!result.success) {
          log(`${BOT_MODE} failed for wallet ${wallet.address}: ${result.reason}`);
        }
        
        // Add random delay between wallets to avoid transaction collisions
        const delayBetweenTxs = getRandomInt(delayBetweenTxsMin * 1000, delayBetweenTxsMax * 1000);
        log(`Waiting ${delayBetweenTxs / 1000} seconds before next wallet transaction...`);
        await sleep(delayBetweenTxs);
      } catch (error) {
        log(`Error in ${BOT_MODE} for wallet ${wallet.address}: ${error.message}`);
        results.push({
          wallet: wallet.address,
          tokenKey,
          strategy: 'default_twap',
          mode: BOT_MODE,
          virtualAmount: randomVirtualAmount,
          success: false,
          reason: error.message,
          received: 0,
          price: currentPrice
        });
      }
    }
  }
  
  return results;
}

// Strategy 4: FSH (Flush) - Sell all token balances to VIRTUAL
async function executeFSH(wallets, tokenKeys) {
  log('Starting FSH (Flush) strategy...');
  log('This strategy will swap ALL token balances to VIRTUAL for each wallet');
  
  let results = [];
  
  for (const wallet of wallets) {
    log(`\n=== Processing Wallet ${wallet.address} ===`);
    
    let walletResults = [];
    let totalVirtualReceived = 0;
    
    // Check balances for all tokens and swap each one
    for (const tokenKey of tokenKeys) {
      try {
        // Get token contract for this token
        const tokenContract = getTokenContract(tokenKey, wallet);
        const tokenDecimals = await tokenContract.decimals();
        
        // Check current balance
        const balance = await tokenContract.balanceOf(wallet.address);
        const balanceFormatted = parseFloat(ethers.utils.formatUnits(balance, tokenDecimals));
        
        log(`\n--- ${tokenKey} Balance Check ---`);
        log(`Wallet ${wallet.address} has ${balanceFormatted} ${tokenKey}`);
        
        if (balance.gt(0)) {  // Check raw balance instead of formatted balance
          // Get current price in VIRTUAL
          const currentPrice = await getCurrentPrice(tokenKey);
          const virtualEquivalent = balanceFormatted * currentPrice;
          
          log(`Current ${tokenKey} price: ${currentPrice.toFixed(6)} VIRTUAL`);
          log(`Token balance worth: ${virtualEquivalent.toFixed(6)} VIRTUAL`);
          log(`Swapping ALL ${balanceFormatted} ${tokenKey} to VIRTUAL...`);
          
          // Use exact balance with proper precision - reduce by 0.01% to avoid precision issues
          let exactBalanceToSell = parseFloat(ethers.utils.formatUnits(balance.mul(9999).div(10000), tokenDecimals));
          log(`Using exact balance (99.99% to avoid precision issues): ${exactBalanceToSell}`);
          
          // Swap all tokens to VIRTUAL
          let sellResult = await swapExactTrustAmount(wallet, exactBalanceToSell, tokenKey);
          
          // If still failing due to precision, try with 99% of balance
          if (!sellResult.success && sellResult.reason === 'insufficient_balance') {
            log(`Precision issue detected, trying with 99% of balance...`);
            exactBalanceToSell = parseFloat(ethers.utils.formatUnits(balance.mul(99).div(100), tokenDecimals));
            log(`Retrying with 99% balance: ${exactBalanceToSell}`);
            sellResult = await swapExactTrustAmount(wallet, exactBalanceToSell, tokenKey);
          }
          
          // If still failing, try with 95% of balance
          if (!sellResult.success && sellResult.reason === 'insufficient_balance') {
            log(`Still having precision issues, trying with 95% of balance...`);
            exactBalanceToSell = parseFloat(ethers.utils.formatUnits(balance.mul(95).div(100), tokenDecimals));
            log(`Retrying with 95% balance: ${exactBalanceToSell}`);
            sellResult = await swapExactTrustAmount(wallet, exactBalanceToSell, tokenKey);
          }
          
          if (sellResult.success) {
            totalVirtualReceived += sellResult.virtualReceived;
            log(`✅ Successfully swapped ${exactBalanceToSell} ${tokenKey} → ${sellResult.virtualReceived} VIRTUAL`);
          } else {
            log(`❌ Failed to swap ${tokenKey}: ${sellResult.reason}`);
          }
          
          walletResults.push({
            tokenKey,
            tokenBalance: exactBalanceToSell,
            originalBalance: balanceFormatted,
            virtualEquivalent: virtualEquivalent,
            swapSuccess: sellResult.success,
            virtualReceived: sellResult.virtualReceived || 0,
            reason: sellResult.reason || 'Success',
            price: currentPrice
          });
          
          // Small delay between token swaps for same wallet
          await sleep(2000);
        } else {
          log(`No ${tokenKey} balance to swap`);
          walletResults.push({
            tokenKey,
            tokenBalance: 0,
            virtualEquivalent: 0,
            swapSuccess: false,
            virtualReceived: 0,
            reason: 'No balance',
            price: await getCurrentPrice(tokenKey)
          });
        }
      } catch (error) {
        log(`Error processing ${tokenKey} for wallet ${wallet.address}: ${error.message}`);
        walletResults.push({
          tokenKey,
          tokenBalance: 0,
          virtualEquivalent: 0,
          swapSuccess: false,
          virtualReceived: 0,
          reason: error.message,
          price: 0
        });
      }
    }
    
    // Summary for this wallet
    const successfulSwaps = walletResults.filter(r => r.swapSuccess).length;
    const totalTokensChecked = walletResults.length;
    
    log(`\n=== Wallet ${wallet.address} Summary ===`);
    log(`Tokens checked: ${totalTokensChecked}`);
    log(`Successful swaps: ${successfulSwaps}`);
    log(`Total VIRTUAL received: ${totalVirtualReceived.toFixed(6)}`);
    
    results.push({
      wallet: wallet.address,
      strategy: 'fsh_flush',
      totalTokensChecked: totalTokensChecked,
      successfulSwaps: successfulSwaps,
      totalVirtualReceived: totalVirtualReceived,
      tokenResults: walletResults
    });
    
    // Delay between wallets
    if (wallets.indexOf(wallet) < wallets.length - 1) {
      log(`Waiting 5 seconds before processing next wallet...`);
      await sleep(5000);
    }
  }
  
  // Overall summary
  const totalWallets = results.length;
  const totalSuccessfulSwaps = results.reduce((sum, r) => sum + r.successfulSwaps, 0);
  const totalVirtualReceived = results.reduce((sum, r) => sum + r.totalVirtualReceived, 0);
  
  log(`\n========== FSH STRATEGY COMPLETED ==========`);
  log(`Wallets processed: ${totalWallets}`);
  log(`Total successful swaps: ${totalSuccessfulSwaps}`);
  log(`Total VIRTUAL received: ${totalVirtualReceived.toFixed(6)}`);
  log(`All token balances have been flushed to VIRTUAL! 🚀`);
  
  return results;
}

// Strategy 5: SELL ALL - Sell all detected tokens from database to VIRTUAL (Optimized with parallel execution)
async function executeSellAll(wallets) {
  log('Starting SELL ALL strategy...');
  log('This strategy will swap ALL detected tokens from database to VIRTUAL for each wallet');
  
  // Get all tokens with pools from the database
  const detectedTokens = getTokensWithPools();
  
  if (detectedTokens.length === 0) {
    log('❌ No tokens found in database. Run token detection first: npm run token-detector');
    return [];
  }
  
  log(`📊 Found ${detectedTokens.length} tokens in database with pools:`);
  detectedTokens.forEach((token, index) => {
    log(`  ${index + 1}. ${token.symbol} (${token.address}) - Pool: ${token.poolAddress}`);
  });
  
  // Process all wallets in parallel for maximum speed
  log(`🚀 Processing ${wallets.length} wallets in parallel...`);
  
  const walletPromises = wallets.map(async (wallet, walletIndex) => {
    log(`\n=== Processing Wallet ${wallet.address} ===`);
    
    let walletResults = [];
    let totalVirtualReceivedForWallet = 0;
    
    // Process tokens sequentially per wallet to avoid gas issues but process wallets in parallel
    for (const tokenData of detectedTokens) {
      try {
        // Create token contract
        const tokenContract = new ethers.Contract(tokenData.address, ERC20_ABI, wallet);
        
        // Check current balance
        const balance = await tokenContract.balanceOf(wallet.address);
        const balanceFormatted = parseFloat(ethers.utils.formatUnits(balance, tokenData.decimals));
        
        log(`\n--- ${tokenData.symbol} Balance Check (Wallet ${walletIndex + 1}) ---`);
        log(`Wallet ${wallet.address} has ${balanceFormatted} ${tokenData.symbol}`);
        
        if (balance.gt(0)) {  // Check raw balance
          // Get current price in VIRTUAL by using the pool
          const poolContract = new ethers.Contract(tokenData.poolAddress, [
            'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
            'function token0() external view returns (address)',
            'function token1() external view returns (address)'
          ], provider);
          
          const [reserve0, reserve1, token0Address] = await Promise.all([
            poolContract.getReserves().then(r => r.reserve0),
            poolContract.getReserves().then(r => r.reserve1),
            poolContract.token0()
          ]);
          
          const virtualIsToken0 = token0Address.toLowerCase() === VIRTUAL_TOKEN_ADDRESS.toLowerCase();
          const virtualReserve = virtualIsToken0 ? reserve0 : reserve1;
          const tokenReserve = virtualIsToken0 ? reserve1 : reserve0;
          
          // Calculate current price
          const currentPrice = virtualReserve.gt(0) && tokenReserve.gt(0) ?
            parseFloat(ethers.utils.formatEther(virtualReserve)) / parseFloat(ethers.utils.formatUnits(tokenReserve, tokenData.decimals)) :
            0;
          
          const virtualEquivalent = balanceFormatted * currentPrice;
          
          log(`Current ${tokenData.symbol} price: ${currentPrice.toFixed(8)} VIRTUAL`);
          log(`Token balance worth: ${virtualEquivalent.toFixed(6)} VIRTUAL`);
          log(`Swapping ALL ${balanceFormatted} ${tokenData.symbol} to VIRTUAL...`);
          
          // Use exact balance with proper precision - reduce by 0.01% to avoid precision issues
          let exactBalanceToSell = parseFloat(ethers.utils.formatUnits(balance.mul(9999).div(10000), tokenData.decimals));
          log(`Using exact balance (99.99% to avoid precision issues): ${exactBalanceToSell}`);
          
          // Swap tokens to VIRTUAL using manual swap approach
          let sellResult;
          try {
            // Create swap manually
            const virtualTokenContract = getVirtualTokenContract(wallet);
            const desiredTokenAmount = ethers.utils.parseUnits(exactBalanceToSell.toString(), tokenData.decimals);
            
            // Check if wallet has enough tokens
            const walletBalance = await tokenContract.balanceOf(wallet.address);
            if (walletBalance.lt(desiredTokenAmount)) {
              log(`Precision issue detected, trying with 99% of balance...`);
              exactBalanceToSell = parseFloat(ethers.utils.formatUnits(balance.mul(99).div(100), tokenData.decimals));
              log(`Retrying with 99% balance: ${exactBalanceToSell}`);
            }
            
            // If still having issues, try with 95% of balance
            if (walletBalance.lt(ethers.utils.parseUnits(exactBalanceToSell.toString(), tokenData.decimals))) {
              log(`Still having precision issues, trying with 95% of balance...`);
              exactBalanceToSell = parseFloat(ethers.utils.formatUnits(balance.mul(95).div(100), tokenData.decimals));
              log(`Retrying with 95% balance: ${exactBalanceToSell}`);
            }
            
            const finalTokenAmount = ethers.utils.parseUnits(exactBalanceToSell.toString(), tokenData.decimals);
            
            // Calculate minimum VIRTUAL out (with 3% slippage)
            const expectedVirtual = exactBalanceToSell * currentPrice;
            const minVirtualOut = expectedVirtual * 0.97; // 3% slippage
            const minVirtualOutBN = ethers.utils.parseEther(minVirtualOut.toString());
            
            // Approve router if needed
            const V2_ROUTER_ADDRESS = '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24';
            const currentAllowance = await tokenContract.allowance(wallet.address, V2_ROUTER_ADDRESS);
            if (currentAllowance.lt(finalTokenAmount)) {
              log(`Approving router to spend ${tokenData.symbol} tokens...`);
              const approveTx = await tokenContract.approve(V2_ROUTER_ADDRESS, ethers.constants.MaxUint256, {
                gasPrice: ethers.utils.parseUnits('0.02', 'gwei'),
                gasLimit: ethers.BigNumber.from('200000')
              });
              await approveTx.wait();
              log(`Router approval confirmed!`);
            }
            
            // Get deadline
            const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
            
            // Get router contract
            const router = new ethers.Contract(V2_ROUTER_ADDRESS, [
              'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external'
            ], wallet);
            
            // Get virtual balance before
            const virtualBalanceBefore = await virtualTokenContract.balanceOf(wallet.address);
            
            log(`Swap Parameters:`);
            log(`  Amount In: ${exactBalanceToSell} ${tokenData.symbol}`);
            log(`  Min VIRTUAL Out: ${minVirtualOut.toFixed(6)} VIRTUAL`);
            log(`  Path: ${tokenData.address} -> ${VIRTUAL_TOKEN_ADDRESS}`);
            
            // Execute swap
            const swapTx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
              finalTokenAmount,
              minVirtualOutBN,
              [tokenData.address, VIRTUAL_TOKEN_ADDRESS],
              wallet.address,
              deadline,
              {
                gasPrice: ethers.utils.parseUnits('0.02', 'gwei'),
                gasLimit: ethers.BigNumber.from('500000')
              }
            );
            
            log(`Swap transaction submitted. Tx hash: ${swapTx.hash}`);
            const receipt = await swapTx.wait();
            
            // Get virtual balance after
            const virtualBalanceAfter = await virtualTokenContract.balanceOf(wallet.address);
            const virtualReceived = parseFloat(ethers.utils.formatEther(virtualBalanceAfter.sub(virtualBalanceBefore)));
            
            sellResult = {
              success: true,
              virtualReceived: virtualReceived,
              reason: 'Success'
            };
            
            log(`✅ Successfully swapped ${exactBalanceToSell} ${tokenData.symbol} → ${virtualReceived} VIRTUAL`);
            
          } catch (error) {
            log(`❌ Failed to swap ${tokenData.symbol}: ${error.message}`);
            sellResult = {
              success: false,
              virtualReceived: 0,
              reason: error.message
            };
          }
          
          if (sellResult.success) {
            totalVirtualReceivedForWallet += sellResult.virtualReceived;
          }
          
          walletResults.push({
            tokenSymbol: tokenData.symbol,
            tokenAddress: tokenData.address,
            tokenBalance: exactBalanceToSell,
            originalBalance: balanceFormatted,
            virtualEquivalent: virtualEquivalent,
            swapSuccess: sellResult.success,
            virtualReceived: sellResult.virtualReceived || 0,
            reason: sellResult.reason || 'Success',
            price: currentPrice
          });
          
          // Small delay between token swaps for same wallet
          await sleep(1000);
        } else {
          log(`No ${tokenData.symbol} balance to swap`);
          walletResults.push({
            tokenSymbol: tokenData.symbol,
            tokenAddress: tokenData.address,
            tokenBalance: 0,
            virtualEquivalent: 0,
            swapSuccess: false,
            virtualReceived: 0,
            reason: 'No balance',
            price: 0
          });
        }
      } catch (error) {
        log(`Error processing ${tokenData.symbol} for wallet ${wallet.address}: ${error.message}`);
        walletResults.push({
          tokenSymbol: tokenData.symbol,
          tokenAddress: tokenData.address,
          tokenBalance: 0,
          virtualEquivalent: 0,
          swapSuccess: false,
          virtualReceived: 0,
          reason: error.message,
          price: 0
        });
      }
    }
    
    // Summary for this wallet
    const successfulSwaps = walletResults.filter(r => r.swapSuccess).length;
    const totalTokensChecked = walletResults.length;
    
    log(`\n=== Wallet ${wallet.address} Summary ===`);
    log(`Tokens checked: ${totalTokensChecked}`);
    log(`Successful swaps: ${successfulSwaps}`);
    log(`Total VIRTUAL received: ${totalVirtualReceivedForWallet.toFixed(6)}`);
    
    return {
      wallet: wallet.address,
      strategy: 'sell_all',
      totalTokensChecked: totalTokensChecked,
      successfulSwaps: successfulSwaps,
      totalVirtualReceived: totalVirtualReceivedForWallet,
      tokenResults: walletResults
    };
  });
  
  // Wait for all wallet processes to complete
  const walletResults = await Promise.allSettled(walletPromises);
  
  // Process results
  const results = [];
  walletResults.forEach((result, walletIndex) => {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    } else {
      log(`❌ Failed to process wallet ${walletIndex + 1}: ${result.reason}`);
      results.push({
        wallet: wallets[walletIndex].address,
        strategy: 'sell_all',
        totalTokensChecked: 0,
        successfulSwaps: 0,
        totalVirtualReceived: 0,
        tokenResults: [],
        error: result.reason
      });
    }
  });
  
  // Overall summary
  const totalWallets = results.length;
  const totalSuccessfulSwaps = results.reduce((sum, r) => sum + r.successfulSwaps, 0);
  const totalVirtualReceived = results.reduce((sum, r) => sum + r.totalVirtualReceived, 0);
  
  log(`\n========== SELL ALL STRATEGY COMPLETED ==========`);
  log(`Wallets processed: ${totalWallets}`);
  log(`Total successful swaps: ${totalSuccessfulSwaps}`);
  log(`Total VIRTUAL received: ${totalVirtualReceived.toFixed(6)}`);
  log(`All detected tokens have been sold to VIRTUAL! 🚀`);
  
  return results;
}

// Main execution functions
export async function executeTrading() {
  log(`Starting trading execution with strategy: ${TRADING_STRATEGY}, mode: ${BOT_MODE}`);
  
  // SELL_ALL strategy uses database tokens, not .env tokens
  if (TRADING_STRATEGY === 'SELL_ALL') {
    log('Using SELL_ALL strategy with database tokens');
    return await executeSellAll(tradingWallets);
  }
  
  // Get all token keys for other strategies
  const tokenKeys = Object.keys(TOKEN_ADDRESSES);
  if (tokenKeys.length === 0) {
    throw new Error('No tokens configured. Please set TOKEN1, TOKEN2, etc. in your .env file.');
  }
  
  log(`Trading tokens: ${tokenKeys.join(', ')}`);
  
  switch (TRADING_STRATEGY) {
    case 'INSTANT':
      if (BOT_MODE !== '2WAY') {
        throw new Error('INSTANT strategy only works with 2WAY mode');
      }
      return await executeInstantBuySell(tradingWallets, tokenKeys);
      
    case 'MARKET_MAKER':
      if (BOT_MODE !== '2WAY') {
        throw new Error('MARKET_MAKER strategy only works with 2WAY mode');
      }
      return await executeMarketMaker(tradingWallets, tokenKeys);
      
    case 'DEFAULT':
      if (BOT_MODE === '2WAY') {
        throw new Error('DEFAULT strategy only works with BUY or SELL mode, not 2WAY');
      }
      return await executeDefaultTWAP(tradingWallets, tokenKeys);
      
    case 'FSH':
      // FSH strategy works with any BOT_MODE but ignores it - always sells everything
      return await executeFSH(tradingWallets, tokenKeys);
      
    default:
      throw new Error(`Unknown trading strategy: ${TRADING_STRATEGY}`);
  }
}

// Backwards compatibility functions
export async function executeSingleBuy(wallets) {
  log('Note: executeSingleBuy is deprecated. Use executeTrading() instead.');
  return await executeTrading();
}

export async function executeSingleSell(wallets) {
  log('Note: executeSingleSell is deprecated. Use executeTrading() instead.');
  return await executeTrading();
}

