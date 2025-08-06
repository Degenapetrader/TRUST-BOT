import { ethers } from 'ethers';
import { ERC20_ABI } from './constants.js';
import { configLoader } from './loader.js';

/**
 * Token utilities for contract interactions
 */
export class TokenUtils {
  /**
   * Get token contract instance
   * @param {string} tokenAddress - Token contract address
   * @param {Object} signerOrProvider - Ethers signer or provider
   * @returns {ethers.Contract} Token contract instance
   */
  static getTokenContract(tokenAddress, signerOrProvider) {
    if (!tokenAddress) {
      throw new Error('Token address is required');
    }
    
    if (!ethers.isAddress(tokenAddress)) {
      throw new Error(`Invalid token address: ${tokenAddress}`);
    }
    
    return new ethers.Contract(tokenAddress, ERC20_ABI, signerOrProvider);
  }

  /**
   * Get virtual token contract instance
   * @param {Object} signerOrProvider - Ethers signer or provider
   * @returns {ethers.Contract} Virtual token contract instance
   */
  static getVirtualTokenContract(signerOrProvider) {
    const virtualAddress = configLoader.getVirtualTokenAddress();
    
    if (!virtualAddress) {
      throw new Error('Virtual token address not configured');
    }
    
    return this.getTokenContract(virtualAddress, signerOrProvider);
  }

  /**
   * Get trust token contract instance (legacy support)
   * @param {Object} signerOrProvider - Ethers signer or provider
   * @returns {ethers.Contract} Trust token contract instance
   */
  static getTrustTokenContract(signerOrProvider) {
    // For GUI mode, we'll use VIRTUAL token as default
    const virtualAddress = configLoader.getVirtualTokenAddress();
    
    if (!virtualAddress) {
      throw new Error('Virtual token address not configured');
    }
    
    return this.getTokenContract(virtualAddress, signerOrProvider);
  }

  /**
   * Get token info (symbol, name, decimals)
   * @param {string} tokenAddress - Token contract address
   * @param {Object} provider - Ethers provider
   * @returns {Promise<Object>} Token info object
   */
  static async getTokenInfo(tokenAddress, provider) {
    try {
      const contract = this.getTokenContract(tokenAddress, provider);
      
      const [symbol, name, decimals] = await Promise.all([
        contract.symbol().catch(() => 'UNKNOWN'),
        contract.name().catch(() => 'Unknown Token'),
        contract.decimals().catch(() => 18)
      ]);
      
      return {
        address: tokenAddress,
        symbol,
        name,
        decimals: Number(decimals)
      };
    } catch (error) {
      throw new Error(`Failed to get token info for ${tokenAddress}: ${error.message}`);
    }
  }

  /**
   * Get token balance
   * @param {string} tokenAddress - Token contract address
   * @param {string} walletAddress - Wallet address to check
   * @param {Object} provider - Ethers provider
   * @returns {Promise<Object>} Balance object with raw and formatted values
   */
  static async getTokenBalance(tokenAddress, walletAddress, provider) {
    try {
      const contract = this.getTokenContract(tokenAddress, provider);
      const [balance, decimals] = await Promise.all([
        contract.balanceOf(walletAddress),
        contract.decimals()
      ]);
      
      return {
        raw: balance,
        formatted: ethers.formatUnits(balance, decimals),
        decimals: Number(decimals)
      };
    } catch (error) {
      throw new Error(`Failed to get balance for ${walletAddress}: ${error.message}`);
    }
  }

  /**
   * Check token allowance
   * @param {string} tokenAddress - Token contract address
   * @param {string} ownerAddress - Token owner address
   * @param {string} spenderAddress - Spender address
   * @param {Object} provider - Ethers provider
   * @returns {Promise<Object>} Allowance object
   */
  static async checkAllowance(tokenAddress, ownerAddress, spenderAddress, provider) {
    try {
      const contract = this.getTokenContract(tokenAddress, provider);
      const [allowance, decimals] = await Promise.all([
        contract.allowance(ownerAddress, spenderAddress),
        contract.decimals()
      ]);
      
      return {
        raw: allowance,
        formatted: ethers.formatUnits(allowance, decimals),
        decimals: Number(decimals),
        isUnlimited: allowance.gte(ethers.MaxUint256 / 2n)
      };
    } catch (error) {
      throw new Error(`Failed to check allowance: ${error.message}`);
    }
  }

  /**
   * Format token amount
   * @param {string|BigInt} amount - Amount to format
   * @param {number} decimals - Token decimals
   * @returns {string} Formatted amount
   */
  static formatAmount(amount, decimals = 18) {
    return ethers.formatUnits(amount, decimals);
  }

  /**
   * Parse token amount
   * @param {string} amount - Amount to parse
   * @param {number} decimals - Token decimals
   * @returns {BigInt} Parsed amount in wei
   */
  static parseAmount(amount, decimals = 18) {
    return ethers.parseUnits(amount.toString(), decimals);
  }

  /**
   * Validate token address
   * @param {string} address - Address to validate
   * @returns {boolean} True if valid
   */
  static isValidTokenAddress(address) {
    return ethers.isAddress(address);
  }

  /**
   * Get checksum address
   * @param {string} address - Address to checksum
   * @returns {string} Checksummed address
   */
  static getChecksumAddress(address) {
    return ethers.getAddress(address);
  }
}

// Export static methods for convenience
export const getTokenContract = TokenUtils.getTokenContract;
export const getVirtualTokenContract = TokenUtils.getVirtualTokenContract;
export const getTrustTokenContract = TokenUtils.getTrustTokenContract; 