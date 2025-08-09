/**
 * FSH Mode Handler Service
 * Handles Flash Sell All operations including token detection and batch processing
 */

import { ethers } from 'ethers';
import { Alchemy, Network } from 'alchemy-sdk';
import { getAlchemyConfig, executeRpcWithFallback } from '../../config.js';
import { log } from '../../utils.js';

/**
 * FSHModeHandler - Manages Flash Sell All operations
 */
export class FSHModeHandler {
  constructor() {
    this.VIRTUAL_CA = '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b';
    this.WETH_CA = '0x4200000000000000000000000000000000000006'; // WETH on Base
    this.EXCLUDED_TOKEN = '0xC841b4eaD3F70bE99472FFdB88E5c3C7aF6A481a'; // TRUST token
    this.MINIMUM_BALANCE = 20; // Minimum token balance to consider (changed from 100 to 20)
    this.POOL_BATCH_SIZE = 20; // Batch size for pool validation
    this.UNISWAP_V2_FACTORY = '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6';
    
    // Initialize Alchemy if available
    const alchemyConfig = getAlchemyConfig();
    this.alchemy = null;
    if (alchemyConfig.available) {
      this.alchemy = new Alchemy({
        apiKey: alchemyConfig.apiKey,
        network: Network.BASE_MAINNET,
      });
    }
  }
  
  /**
   * Get wallet token balances using Alchemy or RPC fallback
   * @param {string} walletAddress - Wallet address
   * @returns {Array} Token balances
   */
  async getWalletTokenBalances(walletAddress) {
    if (this.alchemy) {
      try {
        log(`🔍 Fetching token balances for ${walletAddress.slice(0,8)} via Alchemy...`);
        const balances = await this.alchemy.core.getTokenBalances(walletAddress);
        return await this.processTokenBalancesAlchemy(balances, walletAddress);
      } catch (error) {
        log(`❌ Alchemy API failed: ${error.message}`);
      }
    }
    
    // Fallback to RPC scanning
    return await this.getWalletTokenBalancesRpcFallback(walletAddress);
  }
  
  /**
   * Process token balances from Alchemy API
   * @param {Object} balances - Alchemy token balances response
   * @param {string} walletAddress - Wallet address
   * @returns {Array} Processed token balances
   */
  async processTokenBalancesAlchemy(balances, walletAddress) {
    log(`📊 Alchemy found ${balances.tokenBalances.length} total token balances`);
    
    const allTokens = balances.tokenBalances;
    const excludedTokens = [];
    const zeroBalanceTokens = [];
    
    const nonZeroTokens = allTokens.filter(token => {
      if (!token.contractAddress) {
        excludedTokens.push({ reason: 'No contract address', address: 'N/A' });
        return false;
      }
      
      if (token.tokenBalance === '0x' || token.tokenBalance === '0') {
        zeroBalanceTokens.push({ address: token.contractAddress, symbol: 'Unknown' });
        return false;
      }
      
      if (token.contractAddress.toLowerCase() === this.VIRTUAL_CA.toLowerCase()) {
        excludedTokens.push({ reason: 'VIRTUAL token (excluded)', address: token.contractAddress });
        return false;
      }
      
      if (token.contractAddress.toLowerCase() === this.EXCLUDED_TOKEN.toLowerCase()) {
        excludedTokens.push({ reason: 'TRUST token (excluded)', address: token.contractAddress });
        return false;
      }
      
      return true;
    });
    
    log(`📊 Token filtering results:`);
    log(`   → ${nonZeroTokens.length} tokens with non-zero balance`);
    log(`   → ${zeroBalanceTokens.length} tokens with zero balance (skipped)`);
    log(`   → ${excludedTokens.length} tokens excluded by rules`);
    
    if (excludedTokens.length > 0) {
      excludedTokens.forEach(excluded => {
        log(`     - ${excluded.reason}: ${excluded.address.slice(0,8)}...`);
      });
    }
    
    if (nonZeroTokens.length === 0) {
      log(`❌ No sellable tokens with balance found after filtering`);
      return [];
    }
    
    const significantTokens = [];
    let belowMinimumCount = 0;
    let fallbackCount = 0;
    let errorCount = 0;
    
    // Process in batches to avoid rate limits
    for (let i = 0; i < nonZeroTokens.length; i += 30) {
      const batch = nonZeroTokens.slice(i, i + 30);
      const metadataPromises = batch.map(async (tokenBalance) => {
        try {
          const metadata = await this.alchemy.core.getTokenMetadata(tokenBalance.contractAddress);
          
          // Use fallback values instead of excluding tokens with missing metadata
          const decimals = metadata.decimals || 18; // Default to 18 decimals
          const symbol = metadata.symbol || `TOKEN_${tokenBalance.contractAddress.slice(0,8)}`;
          const name = metadata.name || symbol;
          
          const balance = BigInt(tokenBalance.tokenBalance);
          const formattedBalance = parseFloat(ethers.formatUnits(balance, decimals));
          
          if (formattedBalance >= this.MINIMUM_BALANCE) {
            // Use 99.99% of balance to avoid transaction reverts
            const sellBalance = (balance * 9999n) / 10000n;
            const sellFormattedBalance = parseFloat(ethers.formatUnits(sellBalance, decimals));
            
            return {
              address: tokenBalance.contractAddress,
              symbol: symbol,
              name: name,
              decimals: decimals,
              balance: sellBalance,
              formattedBalance: sellFormattedBalance,
              metadataFallback: !metadata.decimals || !metadata.symbol
            };
          } else {
            // Track tokens below minimum balance
            return {
              address: tokenBalance.contractAddress,
              symbol: symbol,
              formattedBalance: formattedBalance,
              belowMinimum: true,
              metadataFallback: !metadata.decimals || !metadata.symbol
            };
          }
        } catch (error) {
          // Handle errors gracefully with fallbacks instead of excluding token
          log(`⚠️ Metadata fetch failed for ${tokenBalance.contractAddress.slice(0,8)}, using fallbacks`);
          
          const balance = BigInt(tokenBalance.tokenBalance);
          const decimals = 18; // Default decimals
          const symbol = `TOKEN_${tokenBalance.contractAddress.slice(0,8)}`;
          const formattedBalance = parseFloat(ethers.formatUnits(balance, decimals));
          
          if (formattedBalance >= this.MINIMUM_BALANCE) {
            const sellBalance = (balance * 9999n) / 10000n;
            const sellFormattedBalance = parseFloat(ethers.formatUnits(sellBalance, decimals));
            
            return {
              address: tokenBalance.contractAddress,
              symbol: symbol,
              name: 'Unknown Token',
              decimals: decimals,
              balance: sellBalance,
              formattedBalance: sellFormattedBalance,
              metadataFallback: true
            };
          } else {
            return {
              address: tokenBalance.contractAddress,
              symbol: symbol,
              formattedBalance: formattedBalance,
              belowMinimum: true,
              metadataFallback: true
            };
          }
        }
      });
      
      const batchResults = await Promise.allSettled(metadataPromises);
      batchResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          if (result.value.belowMinimum) {
            belowMinimumCount++;
            if (result.value.metadataFallback) fallbackCount++;
            const fallbackIndicator = result.value.metadataFallback ? ' (fallback metadata)' : '';
            log(`   🔍 ${result.value.symbol}: ${result.value.formattedBalance.toFixed(6)} tokens (below minimum ${this.MINIMUM_BALANCE})${fallbackIndicator}`);
          } else {
            significantTokens.push(result.value);
            if (result.value.metadataFallback) {
              fallbackCount++;
              log(`   ✅ ${result.value.symbol}: ${result.value.formattedBalance.toFixed(2)} tokens (using fallback metadata)`);
            }
          }
        } else if (result.status === 'rejected') {
          errorCount++;
          log(`   ❌ Token processing failed: ${result.reason?.message || 'Unknown error'}`);
        }
      });
      
      if (i + batch.length < nonZeroTokens.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    log(`📊 Balance analysis complete:`);
    log(`   → ${significantTokens.length} tokens meet minimum balance requirement (>=${this.MINIMUM_BALANCE})`);
    log(`   → ${belowMinimumCount} tokens below minimum balance (skipped)`);
    log(`   → ${fallbackCount} tokens used fallback metadata`);
    log(`   → ${errorCount} tokens failed processing`);
    
    return significantTokens;
  }
  
  /**
   * RPC fallback for getting token balances
   * @param {string} walletAddress - Wallet address
   * @returns {Array} Token balances
   */
  async getWalletTokenBalancesRpcFallback(walletAddress) {
    try {
      log(`🔄 Using RPC fallback for balance checking...`);
      const { getAllBaseTokens } = await import('../../baseDatabase.js');
      const knownTokens = getAllBaseTokens();
      
      if (knownTokens.length === 0) {
        log(`❌ No known tokens in database for RPC fallback`);
        return [];
      }
      
      log(`📊 Checking ${knownTokens.length} known tokens from database...`);
      const significantTokens = [];
      let belowMinimumCount = 0;
      let excludedCount = 0;
      let errorCount = 0;
      let fallbackCount = 0;
      
      // Check known tokens in batches
      for (let i = 0; i < knownTokens.length; i += this.POOL_BATCH_SIZE) {
        const batch = knownTokens.slice(i, i + this.POOL_BATCH_SIZE);
        const balancePromises = batch.map(async (tokenData) => {
          try {
            const tokenAddress = tokenData.tokenAddress;
            if (!tokenAddress) {
              return { excluded: true, reason: 'No token address' };
            }
            
            if (tokenAddress.toLowerCase() === this.VIRTUAL_CA.toLowerCase()) {
              return { excluded: true, reason: 'VIRTUAL token (excluded)', symbol: tokenData.symbol };
            }
            
            if (tokenAddress.toLowerCase() === this.EXCLUDED_TOKEN.toLowerCase()) {
              return { excluded: true, reason: 'TRUST token (excluded)', symbol: tokenData.symbol };
            }
            
            const result = await executeRpcWithFallback(async (provider) => {
              const tokenContract = new ethers.Contract(
                tokenAddress,
                ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'],
                provider
              );
              
              const [balance, decimals] = await Promise.all([
                tokenContract.balanceOf(walletAddress),
                tokenContract.decimals()
              ]);
              
              return { balance, decimals };
            });
            
            // Use fallback values if metadata is missing
            const decimals = result.decimals || 18;
            const symbol = tokenData.symbol || `TOKEN_${tokenAddress.slice(0,8)}`;
            const formattedBalance = parseFloat(ethers.formatUnits(result.balance, decimals));
            
            if (formattedBalance >= this.MINIMUM_BALANCE) {
              // Use 99.99% of balance to avoid transaction reverts
              const sellBalance = (result.balance * 9999n) / 10000n;
              const sellFormattedBalance = parseFloat(ethers.formatUnits(sellBalance, decimals));
              
              return {
                address: tokenAddress,
                symbol: symbol,
                name: symbol || 'Unknown Token',
                decimals: decimals,
                balance: sellBalance,
                formattedBalance: sellFormattedBalance,
                metadataFallback: !tokenData.symbol || !result.decimals
              };
            } else {
              return { 
                belowMinimum: true, 
                symbol: symbol, 
                formattedBalance: formattedBalance,
                address: tokenAddress,
                metadataFallback: !tokenData.symbol || !result.decimals
              };
            }
          } catch (error) {
            // Handle errors gracefully with fallbacks instead of excluding token
            log(`⚠️ RPC token check failed for ${tokenAddress.slice(0,8)}, using fallbacks`);
            
            // Try to get balance with minimal contract call
            try {
              const result = await executeRpcWithFallback(async (provider) => {
                const tokenContract = new ethers.Contract(
                  tokenAddress,
                  ['function balanceOf(address) view returns (uint256)'],
                  provider
                );
                return await tokenContract.balanceOf(walletAddress);
              });
              
              const decimals = 18; // Default decimals
              const symbol = tokenData.symbol || `TOKEN_${tokenAddress.slice(0,8)}`;
              const formattedBalance = parseFloat(ethers.formatUnits(result, decimals));
              
              if (formattedBalance >= this.MINIMUM_BALANCE) {
                const sellBalance = (result * 9999n) / 10000n;
                const sellFormattedBalance = parseFloat(ethers.formatUnits(sellBalance, decimals));
                
                return {
                  address: tokenAddress,
                  symbol: symbol,
                  name: 'Unknown Token',
                  decimals: decimals,
                  balance: sellBalance,
                  formattedBalance: sellFormattedBalance,
                  metadataFallback: true
                };
              } else {
                return {
                  belowMinimum: true,
                  symbol: symbol,
                  formattedBalance: formattedBalance,
                  address: tokenAddress,
                  metadataFallback: true
                };
              }
            } catch (balanceError) {
              // If even balance check fails, return null to exclude this token
              log(`❌ Complete failure for token ${tokenAddress.slice(0,8)}: ${balanceError.message}`);
              return null;
            }
          }
        });
        
        const batchResults = await Promise.allSettled(balancePromises);
        batchResults.forEach((result) => {
          if (result.status === 'fulfilled' && result.value) {
            if (result.value.excluded) {
              excludedCount++;
              log(`   🚫 ${result.value.symbol || 'Unknown'}: ${result.value.reason}`);
            } else if (result.value.belowMinimum) {
              belowMinimumCount++;
              if (result.value.metadataFallback) fallbackCount++;
              const fallbackIndicator = result.value.metadataFallback ? ' (fallback metadata)' : '';
              log(`   🔍 ${result.value.symbol}: ${result.value.formattedBalance.toFixed(6)} tokens (below minimum ${this.MINIMUM_BALANCE})${fallbackIndicator}`);
            } else {
              significantTokens.push(result.value);
              if (result.value.metadataFallback) {
                fallbackCount++;
                log(`   ✅ ${result.value.symbol}: ${result.value.formattedBalance.toFixed(2)} tokens (using fallback metadata)`);
              }
            }
          } else if (result.status === 'rejected') {
            errorCount++;
            log(`   ❌ RPC token check failed: ${result.reason?.message || 'Unknown error'}`);
          }
        });
        
        if (i + batch.length < knownTokens.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      log(`📊 RPC fallback analysis complete:`);
      log(`   → ${significantTokens.length} tokens meet minimum balance requirement (>=${this.MINIMUM_BALANCE})`);
      log(`   → ${belowMinimumCount} tokens below minimum balance (skipped)`);
      log(`   → ${excludedCount} tokens excluded by rules`);
      log(`   → ${fallbackCount} tokens used fallback metadata`);
      log(`   → ${errorCount} tokens failed to check`);
      
      return significantTokens;
    } catch (error) {
      return [];
    }
  }
  
  /**
   * Find best Uniswap V2 pair for token (VIRTUAL vs WETH)
   * @param {string} tokenAddress - Token address
   * @returns {Object|null} Best pair information
   */
  async findUniswapV2Pair(tokenAddress) {
    if (!tokenAddress || (!this.VIRTUAL_CA && !this.WETH_CA)) return null;
    
    if (tokenAddress.toLowerCase() === this.VIRTUAL_CA.toLowerCase() || 
        tokenAddress.toLowerCase() === this.WETH_CA.toLowerCase() ||
        tokenAddress.toLowerCase() === this.EXCLUDED_TOKEN.toLowerCase()) {
      return null;
    }
    
    try {
      const pairInfo = await executeRpcWithFallback(async (provider) => {
        const factoryContract = new ethers.Contract(
          this.UNISWAP_V2_FACTORY, 
          ['function getPair(address tokenA, address tokenB) external view returns (address pair)'],
          provider
        );
        
        // Check both VIRTUAL and WETH pairs
        const [virtualPairAddress, wethPairAddress] = await Promise.all([
          factoryContract.getPair(tokenAddress, this.VIRTUAL_CA),
          factoryContract.getPair(tokenAddress, this.WETH_CA)
        ]);
        
        const pairs = [];
        
        // Check VIRTUAL pair
        if (virtualPairAddress !== ethers.ZeroAddress) {
          try {
            const pairContract = new ethers.Contract(
              virtualPairAddress, 
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
            
            // Check if pool has liquidity
            if (reserves.reserve0 > 0n && reserves.reserve1 > 0n) {
              const isToken0Target = token0.toLowerCase() === tokenAddress.toLowerCase();
              const tokenReserve = isToken0Target ? reserves.reserve0 : reserves.reserve1;
              
              pairs.push({
                pairAddress: virtualPairAddress,
                tokenReserve: tokenReserve,
                pairedWith: 'VIRTUAL',
                pairedTokenAddress: this.VIRTUAL_CA,
                currency: 'VIRTUAL',
                token0: token0,
                token1: token1,
                reserves: reserves
              });
            }
          } catch (error) {
            // Skip this pair if error
          }
        }
        
        // Check WETH pair
        if (wethPairAddress !== ethers.ZeroAddress) {
          try {
            const pairContract = new ethers.Contract(
              wethPairAddress, 
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
            
            // Check if pool has liquidity
            if (reserves.reserve0 > 0n && reserves.reserve1 > 0n) {
              const isToken0Target = token0.toLowerCase() === tokenAddress.toLowerCase();
              const tokenReserve = isToken0Target ? reserves.reserve0 : reserves.reserve1;
              
              pairs.push({
                pairAddress: wethPairAddress,
                tokenReserve: tokenReserve,
                pairedWith: 'WETH',
                pairedTokenAddress: this.WETH_CA,
                currency: 'ETH',
                token0: token0,
                token1: token1,
                reserves: reserves
              });
            }
          } catch (error) {
            // Skip this pair if error
          }
        }
        
        // If no pairs found, use TRUSTSWAP fallback
        if (pairs.length === 0) {
          return {
            pairAddress: null,
            isTrustSwapFallback: true
          };
        }
        
        // If only one pair found, check WETH reserve filter
        if (pairs.length === 1) {
          const pair = pairs[0];
          
          // Apply WETH reserve filter: skip if WETH LP has <10 WETH
          if (pair.pairedWith === 'WETH') {
            const isToken0WETH = pair.token0.toLowerCase() === this.WETH_CA.toLowerCase();
            const wethReserve = isToken0WETH ? pair.reserves.reserve0 : pair.reserves.reserve1;
            const wethAmount = parseFloat(ethers.formatUnits(wethReserve, 18)); // WETH has 18 decimals
            
                if (wethAmount < 10) {
      // WETH pool has insufficient liquidity, skip token completely
      return null;
    }
          }
          
          return {
            pairAddress: pair.pairAddress,
            tokenReserve: pair.tokenReserve,
            pairedWith: pair.pairedWith,
            pairedTokenAddress: pair.pairedTokenAddress,
            currency: pair.currency,
            token0: pair.token0,
            token1: pair.token1,
            reserves: pair.reserves,
            isTrustSwapFallback: false
          };
        }
        
        // If both pairs found, choose the one with higher token reserves
        const bestPair = pairs.reduce((best, current) => {
          return current.tokenReserve > best.tokenReserve ? current : best;
        });
        
        return {
          pairAddress: bestPair.pairAddress,
          tokenReserve: bestPair.tokenReserve,
          pairedWith: bestPair.pairedWith,
          pairedTokenAddress: bestPair.pairedTokenAddress,
          currency: bestPair.currency,
          token0: bestPair.token0,
          token1: bestPair.token1,
          reserves: bestPair.reserves,
          isTrustSwapFallback: false,
          alternativePairs: pairs.length > 1 ? pairs.filter(p => p !== bestPair) : []
        };
      });
      
      return pairInfo;
      
    } catch (error) {
      // Error checking V2 pools - use TRUSTSWAP fallback
      return {
        pairAddress: null,
        isTrustSwapFallback: true
      };
    }
  }
  
  /**
   * Scan wallet for tokens with pools
   * @param {Object} wallet - Wallet instance
   * @param {number} walletIndex - Wallet index
   * @returns {Array} Tokens with pools
   */
  async scanWalletForTokensWithPools(wallet, walletIndex) {
    log(`\n📱 Scanning Wallet B${walletIndex + 1}: ${wallet.address.slice(0,8)}...`);
    const tokensWithPools = [];
    const tokens = await this.getWalletTokenBalances(wallet.address);
    
    if (tokens.length === 0) {
      log("❌ No sellable tokens found");
      return tokensWithPools;
    }
    
    log(`🔍 Found ${tokens.length} tokens with balance >=${this.MINIMUM_BALANCE}. Checking pools...`);
    
    // Check pools in batches
    for (let i = 0; i < tokens.length; i += this.POOL_BATCH_SIZE) {
      const batch = tokens.slice(i, i + this.POOL_BATCH_SIZE);
      const poolPromises = batch.map(async (token) => {
        try {
          const pairInfo = await this.findUniswapV2Pair(token.address);
          return { token, pairInfo };
        } catch (error) {
          return { token, pairInfo: null, error: error.message };
        }
      });
      
      const batchResults = await Promise.allSettled(poolPromises);
      batchResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          const { token, pairInfo, error } = result.value;
          
          log(`    🔍 ${token.symbol}: ${token.formattedBalance.toFixed(2)} tokens (${token.address.slice(0,8)}...)`);
          
          if (error) {
            log(`       ❌ Pool check failed: ${error}`);
            log(`       → Token will be skipped from FSH`);
          } else if (pairInfo === null) {
            // Completely skipped due to WETH filter or other reason
            log(`       ❌ No valid pools found`);
            log(`       → Checked VIRTUAL pool: No pool or no liquidity`);
            log(`       → Checked WETH pool: No pool, no liquidity, or <10 WETH reserves`);
            log(`       → Token will be skipped from FSH`);
          } else if (pairInfo.isTrustSwapFallback) {
            const skipReason = pairInfo.skipReason || 'no V2 pool';
            log(`       🔄 TRUSTSWAP fallback - ${skipReason}`);
            log(`       → Will use TRUSTSWAP contract for selling`);
            
            // Add TRUSTSWAP fallback tokens to selling list
            tokensWithPools.push({
              ...token,
              pairInfo: pairInfo,
              walletIndex: walletIndex,
              useTrustSwapFallback: true,
              preferredCurrency: 'ETH' // TRUSTSWAP sells to ETH
            });
          } else if (token.formattedBalance >= this.MINIMUM_BALANCE) {
            tokensWithPools.push({
              ...token,
              pairInfo: pairInfo,
              walletIndex: walletIndex,
              useTrustSwapFallback: false,
              preferredCurrency: pairInfo.currency // Add preferred currency based on best LP
            });
            
            const reserveInfo = this.formatReserveInfo(pairInfo);
            log(`       ✅ Valid ${pairInfo.pairedWith} pool found (${pairInfo.pairAddress.slice(0,8)}...)`);
            log(`       → ${reserveInfo}`);
            log(`       → Will sell for ${pairInfo.currency}`);
            
            // Log alternative pairs if they exist
            if (pairInfo.alternativePairs && pairInfo.alternativePairs.length > 0) {
              pairInfo.alternativePairs.forEach(altPair => {
                const altReserveInfo = this.formatReserveInfo(altPair);
                log(`       📊 Alternative ${altPair.pairedWith} pool (${altPair.pairAddress.slice(0,8)}...) - ${altReserveInfo}`);
              });
            }
          } else {
            log(`       ⚠️ Pool available but balance too low`);
            log(`       → Found ${pairInfo.pairedWith} pool (${pairInfo.pairAddress.slice(0,8)}...)`);
            log(`       → Balance: ${token.formattedBalance.toFixed(2)} < minimum ${this.MINIMUM_BALANCE}`);
            log(`       → Token will be skipped from FSH`);
          }
        } else {
          log(`    ❌ Failed to process token: ${result.reason}`);
        }
      });
      
      if (i + batch.length < tokens.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    return tokensWithPools;
  }
  
  /**
   * Format reserve information for logging
   * @param {Object} pairInfo - Pair information
   * @returns {string} Formatted reserve info
   */
  formatReserveInfo(pairInfo) {
    try {
      const isToken0Target = pairInfo.token0.toLowerCase() !== pairInfo.pairedTokenAddress.toLowerCase();
      const tokenReserve = isToken0Target ? pairInfo.reserves.reserve0 : pairInfo.reserves.reserve1;
      const pairedReserve = isToken0Target ? pairInfo.reserves.reserve1 : pairInfo.reserves.reserve0;
      
      const tokenAmount = parseFloat(ethers.formatUnits(tokenReserve, 18)); // Assume 18 decimals for display
      const pairedAmount = parseFloat(ethers.formatUnits(pairedReserve, 18));
      
      return `Token reserves: ${tokenAmount.toFixed(2)}, ${pairInfo.pairedWith} reserves: ${pairedAmount.toFixed(2)}`;
    } catch (error) {
      return `Reserve info unavailable`;
    }
  }
  
  /**
   * Execute FSH (Flash Sell All) mode
   * @param {Array} selectedWallets - Selected wallets
   * @param {string} customGasPrice - Custom gas price
   * @param {Object} tracker - Transaction tracker
   * @returns {Object} Execution results
   */
  async executeFlashSellAll(selectedWallets, customGasPrice = null, tracker = null) {
    log("💥 FSH - FLASH SELL ALL MODE");
    log("============================");
    log(`👛 Processing ${selectedWallets.length} wallets`);
    
    // Scan all wallets in parallel
    const walletPromises = selectedWallets.map(async (wallet, i) => {
      try {
        const tokensWithPools = await this.scanWalletForTokensWithPools(wallet, i);
        return { wallet, walletIndex: i, tokensWithPools };
      } catch (error) {
        return { wallet, walletIndex: i, tokensWithPools: [] };
      }
    });
    
    const walletResults = await Promise.allSettled(walletPromises);
    const walletsToSell = [];
    let totalTokensToSell = 0;
    
    walletResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        const { wallet, walletIndex, tokensWithPools } = result.value;
        if (tokensWithPools.length > 0) {
          walletsToSell.push({ wallet, walletIndex, tokens: tokensWithPools });
          totalTokensToSell += tokensWithPools.length;
        }
      }
    });
    
    if (totalTokensToSell === 0) {
      log("\n❌ No tokens found to sell across all wallets");
      return { 
        success: true, 
        walletsToSell: [], 
        totalTokensToSell: 0,
        results: [] 
      };
    }
    
    log(`\n📊 Found ${totalTokensToSell} tokens to sell across ${walletsToSell.length} wallets`);
    
    return {
      success: true,
      walletsToSell,
      totalTokensToSell
    };
  }
} 