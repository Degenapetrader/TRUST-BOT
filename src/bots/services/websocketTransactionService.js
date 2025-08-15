// WebSocket Transaction Service for real-time monitoring across all bots
// Replaces polling for transaction confirmation, approval checking, and price monitoring

import { ethers } from 'ethers';
import { ConfigLoader } from '../../config/loader.js';
import { ERC20_ABI, TRUSTSWAP_ABI } from '../config/jeetConstants.js';
import { log } from '../../utils/logger.js';

/**
 * WebSocket Transaction Service
 * Provides real-time monitoring for:
 * - Transaction confirmations (instead of polling)
 * - Approval events (for all bots)
 * - Price monitoring (for MMBot and REBUY mode)
 * - Balance changes
 */
export class WebSocketTransactionService {
  constructor() {
    this.providers = [];
    this.isInitialized = false;
    this.pendingTransactions = new Map(); // Track pending transactions
    this.priceSubscriptions = new Map(); // Track price monitoring
    this.approvalSubscriptions = new Map(); // Track approval monitoring
  }

  /**
   * Initialize WebSocket providers (Infura first, Alchemy fallback)
   */
  async initialize() {
    if (this.isInitialized) return;

    const configLoader = new ConfigLoader();
    // SURGICAL FIX: Use getRpcConfigurations() which decodes base64 URLs instead of getConfig() which returns raw base64
    const config = configLoader.getRpcConfigurations();

    // PRIMARY: Infura WebSocket
    if (config.wsUrlInfura && config.rpcUrlInfura) {
      try {
        const infuraWsProvider = new ethers.WebSocketProvider(config.wsUrlInfura);
        const infuraRpcProvider = new ethers.JsonRpcProvider(config.rpcUrlInfura);
        
        this.providers.push({
          name: 'Infura',
          wsProvider: infuraWsProvider,
          rpcProvider: infuraRpcProvider,
          priority: 1
        });
        
        log(`✅ WebSocket Transaction Service: Infura WebSocket initialized`);
      } catch (error) {
        log(`❌ Infura WebSocket initialization failed: ${error.message}`);
      }
    }

    // FALLBACK: Alchemy WebSocket
    if (config.wsUrl && config.rpcUrl) {
      try {
        const alchemyWsProvider = new ethers.WebSocketProvider(config.wsUrl);
        const alchemyRpcProvider = new ethers.JsonRpcProvider(config.rpcUrl);
        
        this.providers.push({
          name: 'Alchemy',
          wsProvider: alchemyWsProvider,
          rpcProvider: alchemyRpcProvider,
          priority: 2
        });
        
        log(`✅ WebSocket Transaction Service: Alchemy WebSocket initialized`);
      } catch (error) {
        log(`❌ Alchemy WebSocket initialization failed: ${error.message}`);
      }
    }

    if (this.providers.length === 0) {
      throw new Error('No WebSocket providers available for transaction service');
    }

    this.isInitialized = true;
    log(`🚀 WebSocket Transaction Service initialized with ${this.providers.length} providers`);
  }

  /**
   * Monitor transaction confirmation (replaces polling)
   * @param {string} txHash - Transaction hash to monitor
   * @param {number} confirmations - Required confirmations (default 1)
   * @param {number} timeout - Timeout in milliseconds (default 30s)
   * @returns {Promise<Object>} Transaction receipt
   */
  async waitForTransactionConfirmation(txHash, confirmations = 1, timeout = 30000) {
    if (!this.isInitialized) await this.initialize();

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let isResolved = false;

      // Set timeout
      const timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          this.pendingTransactions.delete(txHash);
          reject(new Error(`Transaction confirmation timeout after ${timeout}ms`));
        }
      }, timeout);

      // Try each provider
      for (const provider of this.providers) {
        const { wsProvider, name } = provider;

        // Listen for new blocks and check transaction
        const blockListener = async (blockNumber) => {
          if (isResolved) return;

          try {
            const receipt = await wsProvider.getTransactionReceipt(txHash);
            
            if (receipt && receipt.blockNumber) {
              const currentConfirmations = blockNumber - receipt.blockNumber + 1;
              
              log(`📡 WebSocket (${name}): Transaction ${txHash.slice(0, 10)}... has ${currentConfirmations}/${confirmations} confirmations`);
              
              if (currentConfirmations >= confirmations) {
                isResolved = true;
                clearTimeout(timeoutId);
                wsProvider.removeListener('block', blockListener);
                this.pendingTransactions.delete(txHash);
                
                log(`✅ WebSocket: Transaction confirmed! ${txHash.slice(0, 10)}... (${currentConfirmations} confirmations)`);
                resolve(receipt);
              }
            }
          } catch (error) {
            // Silent error - continue monitoring
          }
        };

        wsProvider.on('block', blockListener);
      }

      // Track pending transaction
      this.pendingTransactions.set(txHash, {
        hash: txHash,
        confirmations,
        startTime,
        timeout: timeoutId
      });

      log(`📡 WebSocket: Monitoring transaction ${txHash.slice(0, 10)}... for ${confirmations} confirmations`);
    });
  }

  /**
   * Monitor approval events (for all bots)
   * @param {string} tokenAddress - Token contract address
   * @param {string} ownerAddress - Wallet address
   * @param {string} spenderAddress - Spender address (TRUSTSWAP)
   * @param {Function} callback - Callback when approval detected
   * @returns {string} Subscription ID for cleanup
   */
  async monitorApprovalEvents(tokenAddress, ownerAddress, spenderAddress, callback) {
    if (!this.isInitialized) await this.initialize();

    const subscriptionId = `approval-${tokenAddress}-${ownerAddress}-${Date.now()}`;
    
    for (const provider of this.providers) {
      const { wsProvider, name } = provider;

      try {
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wsProvider);
        
        // Listen for Approval events
        const approvalFilter = tokenContract.filters.Approval(ownerAddress, spenderAddress);
        
        const approvalListener = (owner, spender, value, event) => {
          log(`📡 WebSocket (${name}): Approval detected - ${ethers.formatUnits(value, 18)} tokens approved`);
          
          callback({
            owner,
            spender,
            value,
            formattedValue: ethers.formatUnits(value, 18),
            transactionHash: event.transactionHash,
            blockNumber: event.blockNumber,
            source: `websocket-${name.toLowerCase()}`
          });
        };

        tokenContract.on(approvalFilter, approvalListener);
        
        // Store subscription for cleanup
        this.approvalSubscriptions.set(subscriptionId, {
          contract: tokenContract,
          filter: approvalFilter,
          listener: approvalListener,
          provider: name
        });

        log(`📡 WebSocket (${name}): Monitoring approvals for ${tokenAddress.slice(0, 8)}...`);
        break; // Use first working provider
        
      } catch (error) {
        log(`❌ Failed to setup approval monitoring on ${name}: ${error.message}`);
      }
    }

    return subscriptionId;
  }

  /**
   * Monitor price changes for MMBot and REBUY mode
   * @param {string} tokenAddress - Token to monitor
   * @param {Object} priceRange - {min: number, max: number}
   * @param {Function} callback - Callback when price moves outside range
   * @returns {string} Subscription ID
   */
  async monitorPriceRange(tokenAddress, priceRange, callback) {
    if (!this.isInitialized) await this.initialize();

    const subscriptionId = `price-${tokenAddress}-${Date.now()}`;
    
    for (const provider of this.providers) {
      const { wsProvider, name } = provider;

      try {
        // Monitor Swap events on TRUSTSWAP contract to detect price changes
        const trustswapContract = new ethers.Contract(
          '0x74fa2835311Da3118BF2971Fa11E8070e4ff1693', // TRUSTSWAP
          TRUSTSWAP_ABI,
          wsProvider
        );

        // Listen for swaps involving our token
        const swapFilter = trustswapContract.filters.Swap();
        
        const swapListener = async (sender, amount0In, amount1In, amount0Out, amount1Out, to, event) => {
          // Check if this swap involves our monitored token
          // This is a simplified version - would need more logic to determine actual price
          
          const currentPrice = await this.estimateTokenPrice(tokenAddress, wsProvider);
          
          if (currentPrice < priceRange.min || currentPrice > priceRange.max) {
            log(`📡 WebSocket (${name}): Price alert! ${tokenAddress.slice(0, 8)}... price: ${currentPrice.toFixed(6)}`);
            
            callback({
              tokenAddress,
              currentPrice,
              priceRange,
              direction: currentPrice < priceRange.min ? 'below_min' : 'above_max',
              transactionHash: event.transactionHash,
              source: `websocket-${name.toLowerCase()}`
            });
          }
        };

        trustswapContract.on(swapFilter, swapListener);
        
        this.priceSubscriptions.set(subscriptionId, {
          contract: trustswapContract,
          filter: swapFilter,
          listener: swapListener,
          provider: name,
          tokenAddress,
          priceRange
        });

        log(`📡 WebSocket (${name}): Monitoring price range for ${tokenAddress.slice(0, 8)}... (${priceRange.min} - ${priceRange.max})`);
        break;
        
      } catch (error) {
        log(`❌ Failed to setup price monitoring on ${name}: ${error.message}`);
      }
    }

    return subscriptionId;
  }

  /**
   * Estimate token price (simplified version)
   * @param {string} tokenAddress - Token address
   * @param {Object} provider - WebSocket provider
   * @returns {Promise<number>} Estimated price
   */
  async estimateTokenPrice(tokenAddress, provider) {
    try {
      // This is a simplified price estimation
      // In reality, you'd query the AMM pool or use a price oracle
      
      // For now, return a mock price between 0.01 and 1.00
      return Math.random() * 0.99 + 0.01;
      
    } catch (error) {
      log(`❌ Price estimation failed: ${error.message}`);
      return 0;
    }
  }

  /**
   * Stop monitoring approval events
   * @param {string} subscriptionId - Subscription ID to cancel
   */
  stopApprovalMonitoring(subscriptionId) {
    const subscription = this.approvalSubscriptions.get(subscriptionId);
    if (subscription) {
      const { contract, filter, listener } = subscription;
      contract.removeListener(filter, listener);
      this.approvalSubscriptions.delete(subscriptionId);
      log(`🛑 WebSocket: Stopped approval monitoring (${subscriptionId})`);
    }
  }

  /**
   * Stop monitoring price range
   * @param {string} subscriptionId - Subscription ID to cancel
   */
  stopPriceMonitoring(subscriptionId) {
    const subscription = this.priceSubscriptions.get(subscriptionId);
    if (subscription) {
      const { contract, filter, listener } = subscription;
      contract.removeListener(filter, listener);
      this.priceSubscriptions.delete(subscriptionId);
      log(`🛑 WebSocket: Stopped price monitoring (${subscriptionId})`);
    }
  }

  /**
   * Get service status
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      providers: this.providers.length,
      pendingTransactions: this.pendingTransactions.size,
      approvalSubscriptions: this.approvalSubscriptions.size,
      priceSubscriptions: this.priceSubscriptions.size,
      providerNames: this.providers.map(p => p.name)
    };
  }

  /**
   * Cleanup all subscriptions and connections
   */
  async cleanup() {
    // Stop all approval monitoring
    for (const [id] of this.approvalSubscriptions) {
      this.stopApprovalMonitoring(id);
    }

    // Stop all price monitoring
    for (const [id] of this.priceSubscriptions) {
      this.stopPriceMonitoring(id);
    }

    // Clear pending transactions
    for (const [hash, txData] of this.pendingTransactions) {
      clearTimeout(txData.timeout);
    }
    this.pendingTransactions.clear();

    // Close WebSocket connections
    for (const provider of this.providers) {
      try {
        if (provider.wsProvider && provider.wsProvider.destroy) {
          await provider.wsProvider.destroy();
        }
      } catch (error) {
        // Silent cleanup
      }
    }

    this.providers = [];
    this.isInitialized = false;
    
    log(`🧹 WebSocket Transaction Service cleaned up`);
  }
}

// Singleton instance for shared usage across all bots
export const wsTransactionService = new WebSocketTransactionService();

/**
 * Usage Examples for different bots:
 * 
 * // BuyBot/SellBot/FarmBot - Transaction confirmation
 * const receipt = await wsTransactionService.waitForTransactionConfirmation(txHash, 1, 30000);
 * 
 * // All Bots - Approval monitoring
 * const approvalId = await wsTransactionService.monitorApprovalEvents(
 *   tokenAddress, walletAddress, trustswapAddress,
 *   (approval) => console.log('Approval detected:', approval)
 * );
 * 
 * // MMBot/REBUY mode - Price monitoring
 * const priceId = await wsTransactionService.monitorPriceRange(
 *   tokenAddress, { min: 0.05, max: 0.15 },
 *   (priceAlert) => console.log('Price moved outside range:', priceAlert)
 * );
 * 
 * // Cleanup when done
 * wsTransactionService.stopApprovalMonitoring(approvalId);
 * wsTransactionService.stopPriceMonitoring(priceId);
 */ 