/**
 * Token Resolver Service
 * Handles token and currency information resolution
 */

import { ethers } from 'ethers';
import { provider } from '../../config.js';
import { runTickerSearchFallback } from '../../utils.js';
import { resolveToken } from '../../baseDatabase.js';
import { resolveBidToken } from '../../bidDatabase.js';
import { CONTRACTS, ABIS } from '../config/constants.js';

/**
 * TokenResolver - Resolves token and currency information
 */
export class TokenResolver {
  constructor(alchemy = null, bidMode = false) {
    this.alchemy = alchemy;
    this.bidMode = bidMode;
  }

  /**
   * Check if input is a valid contract address
   * @param {string} input - Input to check
   * @returns {boolean} True if valid contract address
   */
  isContractAddress(input) {
    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    return addressRegex.test(input);
  }

  /**
   * Get token metadata from contract address
   * @param {string} contractAddress - Token contract address
   * @returns {Object} Token metadata
   */
  async getTokenMetadataFromCA(contractAddress) {
    try {
      console.log(`🔍 Getting token metadata for CA: ${contractAddress}`);
      
      // Try Alchemy first if available
      if (this.alchemy) {
        try {
          const metadata = await this.alchemy.core.getTokenMetadata(contractAddress);
          if (metadata.symbol && metadata.decimals) {
            console.log(`✅ Alchemy metadata: ${metadata.symbol} (${metadata.decimals} decimals)`);
            return {
              symbol: metadata.symbol,
              name: metadata.name || metadata.symbol,
              decimals: metadata.decimals
            };
          }
        } catch (error) {
          console.log(`⚠️ Alchemy metadata failed: ${error.message}`);
        }
      }
      
      // Fallback to direct contract calls
      const tokenContract = new ethers.Contract(contractAddress, ABIS.ERC20_MINIMAL, provider);
      
      const [symbol, name, decimals] = await Promise.all([
        tokenContract.symbol().catch(() => 'UNKNOWN'),
        tokenContract.name().catch(() => 'Unknown Token'),
        tokenContract.decimals().catch(() => 18)
      ]);
      
      console.log(`✅ Contract metadata: ${symbol} (${decimals} decimals)`);
      return { symbol, name, decimals };
      
    } catch (error) {
      console.log(`❌ Failed to get token metadata: ${error.message}`);
      return {
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 18
      };
    }
  }

  /**
   * Get token information with database lookup + CA detection
   * @param {string} tokenInput - Token symbol or contract address
   * @returns {Object|null} Token information or null if not found
   */
  async getTokenInfo(tokenInput) {
    try {
      console.log(`\n🔍 Getting token info for: ${tokenInput} ${this.bidMode ? '(BID-MODE)' : ''}`);
      
      // Check if input is a contract address
      if (this.isContractAddress(tokenInput)) {
        console.log(`🎯 Contract Address detected - using TRUSTSWAP delegation immediately`);
        
        // Get token metadata directly from contract
        const metadata = await this.getTokenMetadataFromCA(tokenInput);
        
        return {
          symbol: metadata.symbol,
          name: metadata.name,
          address: tokenInput,
          decimals: metadata.decimals,
          poolAddress: null, // Force TRUSTSWAP fallback
          isDirectCA: true // Flag to indicate this was a direct CA input
        };
      }
      
      // BID-MODE: Use bid.json database
      if (this.bidMode) {
        console.log(`🎯 BID-MODE: Using bid.json database for token resolution`);
        const bidResult = await resolveBidToken(tokenInput);
        
        if (bidResult.success) {
          console.log(`✅ BID-MODE: Token resolved from bid.json: ${bidResult.symbol} (${bidResult.address})`);
          
          // Get token decimals from contract
          const tokenContract = new ethers.Contract(
            bidResult.address,
            ['function decimals() view returns (uint8)'],
            provider
          );
          const decimals = await tokenContract.decimals();
          
          return {
            symbol: bidResult.symbol,
            name: bidResult.name,
            address: bidResult.address,
            decimals: decimals,
            poolAddress: bidResult.lpAddress,
            mcapInETH: bidResult.mcapInETH,
            bidMode: true
          };
        } else {
          console.log(`❌ BID-MODE: Token not found in bid.json: ${tokenInput}`);
          return null;
        }
      }
      
      // Original ticker-based lookup for non-CA inputs
      const resolveResult = await resolveToken(tokenInput);
      
      if (resolveResult.success && resolveResult.lpAddress) {
        console.log(`✅ Token resolved: ${resolveResult.symbol} (${resolveResult.address})`);
        
        const tokenContract = new ethers.Contract(
          resolveResult.address,
          ['function decimals() view returns (uint8)'],
          provider
        );
        const decimals = await tokenContract.decimals();
        
        return {
          symbol: resolveResult.symbol,
          name: resolveResult.name,
          address: resolveResult.address,
          decimals: decimals,
          poolAddress: resolveResult.lpAddress
        };
      }
      
      // Fallback to ticker search
      if (resolveResult.success && !resolveResult.lpAddress) {
        console.log('🔍 Using ticker search fallback...');
        const searchSuccess = await runTickerSearchFallback(resolveResult.symbol);
        
        if (searchSuccess) {
          const retryResult = await resolveToken(tokenInput);
          if (retryResult.success && retryResult.lpAddress) {
            const tokenContract = new ethers.Contract(
              retryResult.address,
              ['function decimals() view returns (uint8)'],
              provider
            );
            const decimals = await tokenContract.decimals();
            
            return {
              symbol: retryResult.symbol,
              name: retryResult.name,
              address: retryResult.address,
              decimals: decimals,
              poolAddress: retryResult.lpAddress
            };
          }
        }
      }
      
      console.log(`❌ Token not found: ${tokenInput}`);
      return null;
      
    } catch (error) {
      console.log(`❌ Error getting token info: ${error.message}`);
      return null;
    }
  }

  /**
   * Get currency information (VIRTUAL is default, others use C- prefix)
   * @param {string} currencyInput - Currency identifier
   * @returns {Object|null} Currency information or null if not found
   */
  async getCurrencyInfo(currencyInput) {
    try {
      console.log(`\n💰 Getting currency info for: ${currencyInput}`);
      
      if (!currencyInput || currencyInput.toLowerCase() === 'virtual') {
        console.log(`✅ Using default currency: VIRTUAL`);
        return {
          symbol: 'VIRTUAL',
          name: 'Virtual Protocol',
          address: CONTRACTS.VIRTUAL,
          decimals: 18,
          poolAddress: null,
          isVirtual: true
        };
      }
      
      // ETH is a special exception - no C- prefix needed
      if (currencyInput.toLowerCase() === 'eth') {
        console.log(`✅ Using ETH with hard-coded ETH/VIRTUAL pool (no C- prefix needed)`);
        return {
          symbol: 'ETH',
          name: 'Ethereum',
          address: ethers.ZeroAddress,
          decimals: 18,
          poolAddress: CONTRACTS.ETH_VIRTUAL_POOL,
          isEth: true,
          isVirtual: false
        };
      }
      
      // Handle other tokens with C- prefix (required for all non-ETH tokens)
      let tokenSymbol = currencyInput;
      if (currencyInput.startsWith('C-') || currencyInput.startsWith('c-')) {
        tokenSymbol = currencyInput.substring(2);
        console.log(`🏷️ Detected C- prefix, looking up token: ${tokenSymbol}`);
      } else {
        // For non-ETH tokens, require C- prefix to prevent CA mismatch
        console.log(`❌ Non-ETH tokens require C- prefix to prevent contract address mismatch. Use C-${currencyInput}`);
        return null;
      }
      
      const resolveResult = await resolveToken(tokenSymbol);
      
      if (resolveResult.success && resolveResult.lpAddress) {
        console.log(`✅ Currency resolved: ${resolveResult.symbol} (${resolveResult.address})`);
        
        const tokenContract = new ethers.Contract(
          resolveResult.address,
          ['function decimals() view returns (uint8)'],
          provider
        );
        const decimals = await tokenContract.decimals();
        
        return {
          symbol: resolveResult.symbol,
          name: resolveResult.name,
          address: resolveResult.address,
          decimals: decimals,
          poolAddress: resolveResult.lpAddress,
          isVirtual: false
        };
      }
      
      if (resolveResult.success && !resolveResult.lpAddress) {
        console.log('🔍 Currency found but no pool, trying ticker search...');
        const searchSuccess = await runTickerSearchFallback(resolveResult.symbol);
        
        if (searchSuccess) {
          const retryResult = await resolveToken(tokenSymbol);
          if (retryResult.success && retryResult.lpAddress) {
            const tokenContract = new ethers.Contract(
              retryResult.address,
              ['function decimals() view returns (uint8)'],
              provider
            );
            const decimals = await tokenContract.decimals();
            
            return {
              symbol: retryResult.symbol,
              name: retryResult.name,
              address: retryResult.address,
              decimals: decimals,
              poolAddress: retryResult.lpAddress,
              isVirtual: false
            };
          }
        }
      }
      
      console.log(`❌ Currency not found or no pool vs VIRTUAL: ${currencyInput}`);
      return null;
      
    } catch (error) {
      console.log(`❌ Error getting currency info: ${error.message}`);
      return null;
    }
  }
} 