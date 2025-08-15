// Token info resolver service for getting token metadata and pool information

import { ethers } from 'ethers';
import { executeRpcWithFallback } from '../../config/index.js';
import { ERC20_ABI } from '../config/jeetConstants.js';
import { log } from '../../utils/logger.js';

export class TokenInfoResolver {
  /**
   * Get token info with TRUSTSWAP DEFAULT + Database/Pool fallback methods
   * @param {string} tokenCA - Token contract address
   * @returns {Promise<Object|null>} Token information or null
   */
  static async getTokenInfoWithPool(tokenCA) {
    try {
      log(`🔍 Getting token info for: ${tokenCA}`);
      log(`🎯 STRATEGY: TRUSTSWAP DEFAULT → Database fallback → Pool detection fallback`);
      
      // DEFAULT METHOD: Get basic token metadata for TRUSTSWAP (no pool needed) with RPC fallback
      try {
        const [symbol, name, decimals] = await Promise.all([
          executeRpcWithFallback(async (provider) => {
            const tokenContract = new ethers.Contract(tokenCA, ERC20_ABI, provider);
            return await tokenContract.symbol();
          }, 3, 1000),
          executeRpcWithFallback(async (provider) => {
            const tokenContract = new ethers.Contract(tokenCA, ERC20_ABI, provider);
            return await tokenContract.name();
          }, 3, 1000),
          executeRpcWithFallback(async (provider) => {
            const tokenContract = new ethers.Contract(tokenCA, ERC20_ABI, provider);
            return await tokenContract.decimals();
          }, 3, 1000)
        ]);
        
        log(`✅ Token metadata: ${symbol} (${name}) - ${decimals} decimals`);
        log(`🎯 DEFAULT: Using TRUSTSWAP fallback mode (poolAddress: null)`);
        
        return {
          symbol,
          name,
          address: tokenCA,
          decimals: decimals,
          poolAddress: null, // DEFAULT: TRUSTSWAP fallback mode
          isTrustSwapDefault: true
        };
        
      } catch (metadataError) {
        log(`⚠️ Could not get token metadata: ${metadataError.message}`);
        log(`🔄 Trying database lookup fallback...`);
      }
      
      // FALLBACK METHOD 1: Check base.json database
      try {
        const { resolveToken } = await import('../../baseDatabase.js');
        const resolveResult = await resolveToken(tokenCA);
        
        if (resolveResult.success && resolveResult.lpAddress) {
          log(`✅ Database fallback: Found ${resolveResult.symbol} with pool ${resolveResult.lpAddress.slice(0, 8)}...`);
          
          // Get token metadata from contract with RPC fallback
          const [symbol, name, decimals] = await Promise.all([
            executeRpcWithFallback(async (provider) => {
              const tokenContract = new ethers.Contract(tokenCA, ERC20_ABI, provider);
              return await tokenContract.symbol();
            }, 3, 1000),
            executeRpcWithFallback(async (provider) => {
              const tokenContract = new ethers.Contract(tokenCA, ERC20_ABI, provider);
              return await tokenContract.name();
            }, 3, 1000),
            executeRpcWithFallback(async (provider) => {
              const tokenContract = new ethers.Contract(tokenCA, ERC20_ABI, provider);
              return await tokenContract.decimals();
            }, 3, 1000)
          ]);
          
          return {
            symbol,
            name,
            address: tokenCA,
            decimals: decimals,
            poolAddress: resolveResult.lpAddress,
            isTrustSwapDefault: false
          };
        }
      } catch (error) {
        log(`⚠️ Database fallback failed: ${error.message}`);
      }
      
      // FALLBACK METHOD 2: RPC detection via ticker scanner
      log(`🔄 Trying ticker search fallback...`);
      
      try {
        // Get token metadata with RPC fallback
        const [symbol, name, decimals] = await Promise.all([
          executeRpcWithFallback(async (provider) => {
            const tokenContract = new ethers.Contract(tokenCA, ERC20_ABI, provider);
            return await tokenContract.symbol();
          }, 3, 1000),
          executeRpcWithFallback(async (provider) => {
            const tokenContract = new ethers.Contract(tokenCA, ERC20_ABI, provider);
            return await tokenContract.name();
          }, 3, 1000),
          executeRpcWithFallback(async (provider) => {
            const tokenContract = new ethers.Contract(tokenCA, ERC20_ABI, provider);
            return await tokenContract.decimals();
          }, 3, 1000)
        ]);
        
        // Use npm ticker search command as fallback
        const { runTickerSearchFallback } = await import('../../utils/externalCommands.js');
        const searchSuccess = await runTickerSearchFallback(symbol);
        
        if (searchSuccess) {
          // Try to re-resolve token after ticker search updated the database
          log(`🔄 Re-attempting token resolution after ticker search...`);
          const { resolveToken } = await import('../../baseDatabase.js');
          const retryResolveResult = await resolveToken(tokenCA);
          
          if (retryResolveResult.success && retryResolveResult.lpAddress) {
            log(`✅ Ticker search fallback: Pool found ${retryResolveResult.lpAddress.slice(0, 8)}...`);
            
            return {
              symbol: retryResolveResult.symbol,
              name: retryResolveResult.name,
              address: retryResolveResult.address,
              decimals: decimals,
              poolAddress: retryResolveResult.lpAddress,
              isTrustSwapDefault: false
            };
          }
        }
        
        log(`⚠️ Ticker search couldn't find pool for ${symbol}, trying Alchemy fallback...`);
            
      } catch (error) {
        log(`⚠️ Ticker search fallback failed: ${error.message}`);
      }
      
      // FALLBACK METHOD 3: find-pool function - Enhanced pool discovery with ticker detection
      log(`🔧 Trying find-pool function for comprehensive pool discovery...`);
      
      try {
        // Import and use the enhanced find-pool function
        const { findPoolWithMetadata } = await import('../../../find-pool.mjs');
        const poolResult = await findPoolWithMetadata(tokenCA);
        
        if (poolResult.success && poolResult.poolAddress) {
          log(`✅ find-pool success: Pool found ${poolResult.poolAddress.slice(0, 8)}...`);
          log(`   📊 Token: ${poolResult.symbol} (${poolResult.name})`);
          log(`   🔢 Decimals: ${poolResult.decimals}`);
          
          return {
            symbol: poolResult.symbol,
            name: poolResult.name,
            address: tokenCA,
            decimals: poolResult.decimals,
            poolAddress: poolResult.poolAddress,
            isTrustSwapDefault: false
          };
        } else {
          log(`⚠️ No Uniswap V2 pool found via find-pool - defaulting to TRUSTSWAP`);
          
          // Try to get basic metadata for TRUSTSWAP fallback with RPC fallback
          try {
            const [symbol, name, decimals] = await Promise.all([
              executeRpcWithFallback(async (provider) => {
                const tokenContract = new ethers.Contract(tokenCA, ERC20_ABI, provider);
                return await tokenContract.symbol();
              }, 3, 1000),
              executeRpcWithFallback(async (provider) => {
                const tokenContract = new ethers.Contract(tokenCA, ERC20_ABI, provider);
                return await tokenContract.name();
              }, 3, 1000),
              executeRpcWithFallback(async (provider) => {
                const tokenContract = new ethers.Contract(tokenCA, ERC20_ABI, provider);
                return await tokenContract.decimals();
              }, 3, 1000)
            ]);
            
            // Return with null pool to force TRUSTSWAP
            return {
              symbol,
              name,
              address: tokenCA,
              decimals: decimals,
              poolAddress: null, // Force TRUSTSWAP fallback
              isTrustSwapDefault: true
            };
          } catch (metaError) {
            log(`⚠️ Could not get token metadata for TRUSTSWAP fallback: ${metaError.message}`);
            // Return minimal data for TRUSTSWAP
            return {
              symbol: 'UNKNOWN',
              name: 'Unknown Token',
              address: tokenCA,
              decimals: 18,
              poolAddress: null, // Force TRUSTSWAP fallback
              isTrustSwapDefault: true
            };
          }
        }
        
      } catch (error) {
        log(`❌ find-pool function failed: ${error.message}`);
      }
      
      // FINAL FALLBACK: Return minimal data for TRUSTSWAP
      log(`⚠️ All fallback methods failed - using TRUSTSWAP with minimal token data`);
      return {
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        address: tokenCA,
        decimals: 18, // Default to 18 decimals
        poolAddress: null, // Force TRUSTSWAP fallback
        isTrustSwapDefault: true
      };
      
    } catch (error) {
      log(`❌ Failed to get token info: ${error.message}`);
      return null;
    }
  }

  /**
   * Resolve token CA from input (ticker or direct address)
   * @param {string} inputType - Type of input ('TOKEN_CA' or 'TICKER')
   * @param {string} input - The input value
   * @returns {Promise<string|null>} Resolved token CA or null
   */
  static async resolveTokenCA(inputType, input) {
    try {
      log(`🔍 Resolving token CA from ${inputType}: ${input}`);
      
      if (inputType === 'TOKEN_CA') {
        // Direct token CA - just validate and return
        if (!ethers.isAddress(input)) {
          throw new Error('Invalid token contract address format');
        }
        return input;
      } else if (inputType === 'TICKER') {
        // Ticker symbol - resolve from database
        log(`🔤 Resolving ticker symbol: ${input}`);
        
        const { resolveToken } = await import('../../baseDatabase.js');
        const result = await resolveToken(input);
        
        if (result.success) {
          log(`✅ Ticker resolved: ${input} → ${result.address}`);
          return result.address;
        } else {
          throw new Error(`Failed to resolve ticker ${input}: ${result.error}`);
        }
      }
      
      throw new Error(`Unknown input type: ${inputType}`);
      
    } catch (error) {
      log(`❌ Failed to resolve token CA: ${error.message}`);
      return null;
    }
  }
}
