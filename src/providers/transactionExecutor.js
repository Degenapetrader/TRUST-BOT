import { ethers } from 'ethers';
import { providerManager } from './manager.js';
import { PROVIDER_CONFIG, TRANSACTION_CONFIG } from '../config/constants.js';
import { wsTransactionService } from '../bots/services/websocketTransactionService.js';
import { gasPriceService } from './gasPriceService.js';

/**
 * Transaction executor with retry logic and provider fallback
 */
export class TransactionExecutor {
  /**
   * Execute RPC call with provider fallback
   * @param {Function} rpcCall - Function that takes provider and returns promise
   * @param {number} maxRetries - Maximum retries per provider
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<any>} RPC call result
   */
  static async executeRpcWithFallback(
    rpcCall, 
    maxRetries = PROVIDER_CONFIG.maxRpcRetries, 
    timeout = PROVIDER_CONFIG.rpcTimeout
  ) {
    const availableProviders = providerManager.getAllProviders();
    let lastError = null;
    
    for (const provider of availableProviders) {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          console.log(`📡 RPC call via ${provider._providerName} (attempt ${attempt + 1}/${maxRetries})`);
          
          // Add timeout wrapper
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`${provider._providerName} RPC timeout after ${timeout}ms`)), timeout)
          );
          
          const result = await Promise.race([rpcCall(provider), timeoutPromise]);
          
          console.log(`✅ RPC call successful via ${provider._providerName}`);
          return result;
          
        } catch (error) {
          lastError = error;
          console.log(`❌ RPC call failed via ${provider._providerName} (attempt ${attempt + 1}): ${error.message}`);
          
          // Check if error is retryable
          if (this._isRetryableError(error)) {
            if (attempt < maxRetries - 1) {
              console.log(`🔄 Retrying RPC call with ${provider._providerName} in 1 second...`);
              await this._sleep(TRANSACTION_CONFIG.networkRetryDelay);
              continue;
            }
          } else {
            // For non-network errors, don't retry with same provider
            break;
          }
        }
      }
      
      // Mark provider as temporarily failed if all retries failed
      providerManager.markProviderFailed(provider._providerName);
      console.log(`⚠️ ${provider._providerName} marked as failed, trying next provider...`);
    }
    
    throw new Error(`❌ RPC call failed across all providers. Last error: ${lastError?.message}`);
  }

  /**
   * Execute transaction with replacement fee escalation and WebSocket confirmation
   * @param {Function} transactionFunction - Function that takes (provider, gasParams) and returns transaction
   * @param {number} maxRetries - Maximum total retry attempts
   * @param {number} maxProviderRetries - Maximum retries per provider
   * @returns {Promise<Object>} Transaction result with hash, receipt, and provider info
   */
  static async executeTransactionWithReplacementFee(
    transactionFunction, 
    maxRetries = TRANSACTION_CONFIG.maxRetries, 
    maxProviderRetries = TRANSACTION_CONFIG.maxProviderRetries
  ) {
    const allProviders = providerManager.getAllProviders();
    let lastError = null;
    
    // Get dynamic gas prices from Alchemy
    const dynamicGasParams = await gasPriceService.getGasParams();
    console.log(`🔥 Dynamic Gas Prices: ${ethers.formatUnits(dynamicGasParams.maxFeePerGas, 'gwei')} gwei (maxFee) + ${ethers.formatUnits(dynamicGasParams.maxPriorityFeePerGas, 'gwei')} gwei (priority)`);
    
    // Use dynamic gas prices as base
    const baseMaxFee = dynamicGasParams.maxFeePerGas;
    const basePriorityFee = dynamicGasParams.maxPriorityFeePerGas;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Calculate gas prices with escalation
      const gasParams = this._calculateGasParams(baseMaxFee, basePriorityFee, attempt);
      
      if (attempt > 0) {
        console.log(`🔄 Escalating gas prices for attempt ${attempt + 1}: ${ethers.formatUnits(gasParams.maxFeePerGas, 'gwei')} gwei (maxFee) + ${ethers.formatUnits(gasParams.maxPriorityFeePerGas, 'gwei')} gwei (priority)`);
      }
      
      // Random provider selection
      const orderedProviders = this._getRandomProviderOrder(allProviders);
      console.log(`🎲 Random provider selection: Starting with ${orderedProviders[0]._providerName}, fallback to [${orderedProviders.slice(1).map(p => p._providerName).join(', ')}]`);
      
      // Try each provider
      for (const currentProvider of orderedProviders) {
        const result = await this._tryProviderWithRetries(
          currentProvider, 
          transactionFunction, 
          gasParams, 
          maxProviderRetries, 
          attempt
        );
        
        if (result.success) {
          return result;
        }
        
        lastError = result.error;
        
        // Check if we need to escalate gas
        if (this._isGasRelatedError(result.error)) {
          console.log(`🔄 Gas-related error detected, will escalate for next attempt`);
          break; // Break provider loop to escalate gas
        }
      }
      
      // Wait before next attempt
      console.log(`⚠️ All providers failed for broadcast cycle ${attempt + 1}, waiting before retry...`);
      await this._sleep(TRANSACTION_CONFIG.retryDelay);
    }
    
    throw new Error(`❌ Transaction failed after ${maxRetries} broadcast cycles across all providers. Last error: ${lastError?.message}`);
  }

  /**
   * Try transaction with a specific provider using WebSocket confirmation
   * @private
   */
  static async _tryProviderWithRetries(provider, transactionFunction, gasParams, maxRetries, attemptNumber) {
    for (let providerAttempt = 0; providerAttempt < maxRetries; providerAttempt++) {
      try {
        const retryInfo = providerAttempt > 0 ? ` (retry ${providerAttempt + 1}/${maxRetries})` : '';
        console.log(`📡 Attempting transaction via ${provider._providerName}${retryInfo} (broadcast attempt ${attemptNumber + 1})`);
        
        // Execute transaction
        const tx = await transactionFunction(provider, gasParams);
        
        console.log(`✅ Transaction submitted via ${provider._providerName}: ${tx.hash}`);
        console.log(`⛽ Gas settings: ${ethers.formatUnits(gasParams.maxFeePerGas, 'gwei')} gwei (maxFee) + ${ethers.formatUnits(gasParams.maxPriorityFeePerGas, 'gwei')} gwei (priority)`);
        
        // 🚀 WEBSOCKET REPLACEMENT: Use WebSocket confirmation instead of polling
        let receipt;
        try {
          console.log(`📡 WebSocket: Monitoring transaction confirmation (replacing polling)...`);
          receipt = await wsTransactionService.waitForTransactionConfirmation(tx.hash, 1, 60000);
          console.log(`🎯 WebSocket: Transaction confirmed in block ${receipt.blockNumber} (instant vs 2s polling)`);
        } catch (wsError) {
          console.log(`⚠️ WebSocket confirmation failed, falling back to polling: ${wsError.message}`);
          // Fallback to original polling method
          receipt = await tx.wait(1);
          console.log(`🎯 Polling fallback: Transaction confirmed in block ${receipt.blockNumber}`);
        }
        
        return { 
          success: true,
          hash: tx.hash, 
          receipt: receipt, 
          provider: provider._providerName 
        };
        
      } catch (error) {
        const retryInfo = providerAttempt > 0 ? ` (retry ${providerAttempt + 1}/${maxRetries})` : '';
        console.log(`❌ Transaction failed via ${provider._providerName}${retryInfo}: ${error.message}`);
        
        // Handle specific error cases
        const handled = await this._handleTransactionError(error, provider);
        if (handled.shouldReturn) {
          return handled.result;
        }
        
        if (handled.shouldBreak) {
          return { success: false, error };
        }
        
        // Retry with same provider for network issues
        if (providerAttempt < maxRetries - 1 && this._isRetryableError(error)) {
          console.log(`🔄 Network issue detected, retrying with same provider in 1 second...`);
          await this._sleep(TRANSACTION_CONFIG.networkRetryDelay);
          continue;
        }
        
        // Try once more for other errors
        if (providerAttempt < maxRetries - 1) {
          console.log(`🔄 Retrying with ${provider._providerName} in 500ms...`);
          await this._sleep(TRANSACTION_CONFIG.providerRetryDelay);
        }
      }
    }
    
    // Provider exhausted all retries
    console.log(`⚠️ Provider ${provider._providerName} exhausted all ${maxRetries} retries`);
    providerManager.markProviderFailed(provider._providerName);
    return { success: false, error: new Error(`Provider ${provider._providerName} failed all retries`) };
  }

  /**
   * Handle specific transaction errors
   * @private
   */
  static async _handleTransactionError(error, provider) {
    // Already known transaction
    if (error.message?.includes('already known')) {
      console.log(`🔄 Transaction already known - likely already in mempool. Waiting for confirmation...`);
      await this._sleep(TRANSACTION_CONFIG.confirmationTimeout);
      
      console.log(`✅ Transaction assumed successful (already in mempool) via ${provider._providerName}`);
      return {
        shouldReturn: true,
        result: { 
          success: true,
          hash: 'unknown_already_known', 
          receipt: { status: 1, blockNumber: 'unknown' }, 
          provider: provider._providerName 
        }
      };
    }
    
    // Gas-related errors
    if (this._isGasRelatedError(error)) {
      return { shouldBreak: true };
    }
    
    // Permanent errors
    if (this._isPermanentError(error)) {
      throw error;
    }
    
    return { shouldBreak: false };
  }

  /**
   * Calculate gas parameters with escalation
   * @private
   */
  static _calculateGasParams(baseMaxFee, basePriorityFee, attempt) {
    if (attempt === 0) {
      return {
        maxFeePerGas: baseMaxFee,
        maxPriorityFeePerGas: basePriorityFee
      };
    }
    
    const escalationFactor = Math.pow(TRANSACTION_CONFIG.gasEscalationFactor, attempt);
    return {
      maxFeePerGas: baseMaxFee * BigInt(Math.floor(escalationFactor * 100)) / 100n,
      maxPriorityFeePerGas: basePriorityFee * BigInt(Math.floor(escalationFactor * 100)) / 100n
    };
  }

  /**
   * Get random provider order
   * @private
   */
  static _getRandomProviderOrder(providers) {
    const providerPool = [...providers];
    const randomIndex = Math.floor(Math.random() * providerPool.length);
    const randomProvider = providerPool.splice(randomIndex, 1)[0];
    return [randomProvider, ...providerPool];
  }

  /**
   * Check if error is retryable
   * @private
   */
  static _isRetryableError(error) {
    const retryablePatterns = [
      'timeout', 'network', 'connection', 'transaction not found',
      '502', '503', '504', 'ETIMEDOUT', 'ECONNREFUSED'
    ];
    
    return retryablePatterns.some(pattern => 
      error.message?.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * Check if error is gas-related
   * @private
   */
  static _isGasRelatedError(error) {
    const gasPatterns = [
      'replacement transaction underpriced',
      'replacement fee too low',
      'REPLACEMENT_UNDERPRICED',
      'maxFeePerGas',
      'maxPriorityFeePerGas'
    ];
    
    return gasPatterns.some(pattern => 
      error.message?.includes(pattern) || error.code === pattern
    );
  }

  /**
   * Check if error is permanent
   * @private
   */
  static _isPermanentError(error) {
    const permanentPatterns = [
      'insufficient funds',
      'gas required exceeds',
      'execution reverted',
      'nonce too low',
      'invalid argument'
    ];
    
    return permanentPatterns.some(pattern => 
      error.message?.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * Sleep utility
   * @private
   */
  static _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export convenience functions
export const executeRpcWithFallback = TransactionExecutor.executeRpcWithFallback.bind(TransactionExecutor);
export const executeTransactionWithReplacementFee = TransactionExecutor.executeTransactionWithReplacementFee.bind(TransactionExecutor); 