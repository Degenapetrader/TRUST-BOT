import { ethers } from 'ethers';
import { log, formatError } from './logger.js';
import { sleep } from './common.js';

/**
 * Execute a function with retry logic
 * @param {Function} fn - Function to execute
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} initialDelay - Initial delay between retries in ms
 * @returns {Promise<any>} Result of the function
 */
export async function executeWithRetry(fn, maxRetries = 3, initialDelay = 1000) {
  let attempt = 0;
  let delay = initialDelay;
  
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      
      if (attempt >= maxRetries) {
        throw error;
      }
      
      log(`Transaction failed. Retrying in ${delay/1000} seconds... (Attempt ${attempt}/${maxRetries})`);
      log(`Error: ${formatError(error)}`);
      
      await sleep(delay);
      delay *= 2; // Exponential backoff
    }
  }
}

/**
 * Calculate optimized gas settings
 * @param {Object} provider - Ethers provider
 * @param {number} multiplier - Gas price multiplier
 * @returns {Promise<Object>} Gas settings
 */
export async function getOptimizedGasSettings(provider, multiplier = 1.1) {
  try {
    const gasPrice = await provider.getGasPrice();
    const optimizedGasPrice = gasPrice * BigInt(Math.floor(multiplier * 100)) / 100n;
    
    return {
      gasPrice: optimizedGasPrice,
      gasLimit: 300000 // Reasonable default for token swaps
    };
  } catch (error) {
    log(`Error getting optimized gas settings: ${formatError(error)}`);
    return {
      gasPrice: undefined,
      gasLimit: 300000
    };
  }
}

/**
 * Monitor transaction status
 * @param {Object} provider - Ethers provider
 * @param {string} txHash - Transaction hash
 * @param {number} confirmations - Number of confirmations to wait for
 * @returns {Promise<Object>} Transaction receipt
 */
export async function monitorTransaction(provider, txHash, confirmations = 1) {
  log(`Monitoring transaction ${txHash}...`);
  
  try {
    const receipt = await provider.waitForTransaction(txHash, confirmations);
    
    if (receipt.status === 1) {
      log(`Transaction ${txHash} confirmed! Gas used: ${receipt.gasUsed.toString()}`);
      return receipt;
    } else {
      log(`Transaction ${txHash} failed!`);
      throw new Error(`Transaction failed with status ${receipt.status}`);
    }
  } catch (error) {
    log(`Error monitoring transaction: ${formatError(error)}`);
    throw error;
  }
}

/**
 * Execute transaction with replacement fee escalation
 * @param {Function} transactionFunction - Function that creates and sends transaction
 * @param {BigInt} baseGasPrice - Base gas price in wei
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} replacementMultiplier - Multiplier for replacement fee
 * @returns {Promise<any>} Transaction result
 */
export async function executeTransactionWithReplacementFee(
  transactionFunction, 
  baseGasPrice, 
  maxRetries = 3, 
  replacementMultiplier = 1.15
) {
  let attempt = 0;
  let currentGasPrice = baseGasPrice;
  
  while (attempt < maxRetries) {
    try {
      log(`Transaction attempt ${attempt + 1}/${maxRetries} with gas price: ${ethers.formatUnits(currentGasPrice, 'gwei')} gwei`);
      
      // Execute transaction with current gas price
      const result = await transactionFunction(currentGasPrice);
      return result;
      
    } catch (error) {
      attempt++;
      
      // Check if this is a replacement fee error
      const isReplacementError = error.code === 'REPLACEMENT_UNDERPRICED' || 
                                error.message?.includes('replacement transaction underpriced') ||
                                error.message?.includes('replacement fee too low');
      
      if (isReplacementError && attempt < maxRetries) {
        // Increase gas price for replacement transaction
        currentGasPrice = currentGasPrice * BigInt(Math.floor(replacementMultiplier * 100)) / 100n;
        log(`🔄 Replacement fee too low. Increasing gas price to ${ethers.formatUnits(currentGasPrice, 'gwei')} gwei`);
        
        // Small delay before retry
        await sleep(1000);
        continue;
      }
      
      // If not a replacement error or we've exhausted retries, throw the error
      if (attempt >= maxRetries) {
        log(`❌ Transaction failed after ${maxRetries} attempts`);
        throw error;
      }
      
      // For other errors, use exponential backoff
      log(`⚠️ Transaction failed: ${formatError(error)}. Retrying in 2 seconds...`);
      await sleep(2000);
    }
  }
}

/**
 * Estimate gas for a transaction
 * @param {Object} contract - Contract instance
 * @param {string} method - Method name
 * @param {Array} args - Method arguments
 * @param {Object} overrides - Transaction overrides
 * @returns {Promise<BigInt>} Estimated gas
 */
export async function estimateGas(contract, method, args = [], overrides = {}) {
  try {
    const estimatedGas = await contract[method].estimateGas(...args, overrides);
    // Add 20% buffer for safety
    return estimatedGas * 120n / 100n;
  } catch (error) {
    log(`Error estimating gas for ${method}: ${formatError(error)}`);
    // Return default gas limit if estimation fails
    return 500000n;
  }
}

/**
 * Check if transaction error is retryable
 * @param {Error} error - Transaction error
 * @returns {boolean} True if retryable
 */
export function isRetryableError(error) {
  const retryableErrors = [
    'REPLACEMENT_UNDERPRICED',
    'INSUFFICIENT_FUNDS',
    'NETWORK_ERROR',
    'TIMEOUT',
    'SERVER_ERROR'
  ];
  
  return retryableErrors.some(code => 
    error.code === code || error.message?.includes(code.toLowerCase())
  );
}

/**
 * Format gas price for display
 * @param {BigInt} gasPrice - Gas price in wei
 * @returns {string} Formatted gas price
 */
export function formatGasPrice(gasPrice) {
  return `${ethers.formatUnits(gasPrice, 'gwei')} gwei`;
} 