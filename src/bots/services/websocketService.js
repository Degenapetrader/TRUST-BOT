// Comprehensive WebSocket service for real-time blockchain monitoring
// Reduces RPC costs by using push notifications instead of polling

import { ethers } from 'ethers';
import { ConfigLoader } from '../../config/loader.js';
import { ERC20_ABI } from '../config/jeetConstants.js';
import { log } from '../../utils/logger.js';

/**
 * WebSocket Service for real-time blockchain monitoring
 * Supports: Transaction confirmation, approval checking, price monitoring, balance tracking
 */
export class WebSocketService {
  constructor() {
    this.providers = [];
    this.activeConnections = [];
    this.eventListeners = new Map(); // Track active listeners
    this.isInitialized = false;
  }

  /**
   * Initialize WebSocket providers from wallets.json
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      const configLoader = new ConfigLoader();
      // SURGICAL FIX: Use getRpcConfigurations() which decodes base64 URLs instead of getConfig() which returns raw base64
      const config = configLoader.getRpcConfigurations();
      
      this.providers = [];
      
      // PRIMARY: Infura WebSocket
      if (config.wsUrlInfura && config.rpcUrlInfura) {
        try {
          const infuraRpcProvider = new ethers.JsonRpcProvider(config.rpcUrlInfura);
          const infuraWsProvider = new ethers.WebSocketProvider(config.wsUrlInfura);
          
          infuraRpcProvider._providerName = 'Infura-RPC';
          infuraWsProvider._providerName = 'Infura-WebSocket';
          
          this.providers.push({
            name: 'Infura',
            rpcProvider: infuraRpcProvider,
            wsProvider: infuraWsProvider,
            priority: 1
          });
          
          log(`✅ WebSocket Service: Infura provider initialized`);
        } catch (error) {
          log(`⚠️ WebSocket Service: Failed to create Infura provider: ${error.message}`);
        }
      }
      
      // FALLBACK: Alchemy WebSocket
      if (config.wsUrl && config.rpcUrl) {
        try {
          const alchemyRpcProvider = new ethers.JsonRpcProvider(config.rpcUrl);
          const alchemyWsProvider = new ethers.WebSocketProvider(config.wsUrl);
          
          alchemyRpcProvider._providerName = 'Alchemy-RPC';
          alchemyWsProvider._providerName = 'Alchemy-WebSocket';
          
          this.providers.push({
            name: 'Alchemy',
            rpcProvider: alchemyRpcProvider,
            wsProvider: alchemyWsProvider,
            priority: 2
          });
          
          log(`✅ WebSocket Service: Alchemy provider initialized`);
        } catch (error) {
          log(`⚠️ WebSocket Service: Failed to create Alchemy provider: ${error.message}`);
        }
      }
      
      // Sort by priority
      this.providers.sort((a, b) => a.priority - b.priority);
      
      if (this.providers.length === 0) {
        throw new Error('No WebSocket providers available');
      }
      
      // Store connections for cleanup
      this.activeConnections = this.providers.map(p => p.wsProvider);
      
      this.isInitialized = true;
      log(`🔗 WebSocket Service initialized with ${this.providers.length} providers: ${this.providers.map(p => p.name).join(' → ')}`);
      
    } catch (error) {
      log(`❌ WebSocket Service initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Monitor transaction confirmation via WebSocket (replaces polling)
   * @param {string} txHash - Transaction hash to monitor
   * @param {number} confirmations - Required confirmations (default: 1)
   * @returns {Promise<Object>} Transaction receipt
   */
  async monitorTransactionConfirmation(txHash, confirmations = 1) {
    await this.initialize();
    
    return new Promise((resolve, reject) => {
      const listenerId = `tx-${txHash}`;
      let confirmed = false;
      
      log(`📡 WebSocket: Monitoring transaction ${txHash.slice(0, 10)}... (${confirmations} confirmations needed)`);
      
      // Setup listeners on all providers for redundancy
      this.providers.forEach((providerConfig, index) => {
        const { name, wsProvider } = providerConfig;
        
        const blockListener = async (blockNumber) => {
          if (confirmed) return;
          
          try {
            const receipt = await wsProvider.getTransactionReceipt(txHash);
            if (receipt && receipt.blockNumber) {
              const currentConfirmations = blockNumber - receipt.blockNumber + 1;
              
              if (currentConfirmations >= confirmations) {
                confirmed = true;
                this.removeEventListener(listenerId);
                
                log(`✅ WebSocket (${name}): Transaction confirmed in block ${receipt.blockNumber} (${currentConfirmations} confirmations)`);
                resolve(receipt);
              } else {
                log(`⏳ WebSocket (${name}): Transaction in block ${receipt.blockNumber}, waiting for confirmations (${currentConfirmations}/${confirmations})`);
              }
            }
          } catch (error) {
            log(`⚠️ WebSocket (${name}): Error checking transaction: ${error.message}`);
          }
        };
        
        wsProvider.on('block', blockListener);
        this.eventListeners.set(`${listenerId}-${index}`, { provider: wsProvider, event: 'block', listener: blockListener });
      });
      
      // Timeout after 5 minutes
      setTimeout(() => {
        if (!confirmed) {
          this.removeEventListener(listenerId);
          reject(new Error('Transaction confirmation timeout'));
        }
      }, 300000);
    });
  }

  /**
   * Monitor token approvals via WebSocket (replaces polling)
   * @param {string} tokenAddress - Token contract address
   * @param {string} ownerAddress - Owner wallet address
   * @param {string} spenderAddress - Spender contract address
   * @returns {Promise<boolean>} True when approval is detected
   */
  async monitorApprovalEvent(tokenAddress, ownerAddress, spenderAddress) {
    await this.initialize();
    
    return new Promise((resolve, reject) => {
      const listenerId = `approval-${tokenAddress}-${ownerAddress}`;
      let approved = false;
      
      log(`📡 WebSocket: Monitoring approval for ${tokenAddress.slice(0, 8)}... (owner: ${ownerAddress.slice(0, 8)}...)`);
      
      // Approval event filter
      const approvalFilter = {
        address: tokenAddress,
        topics: [
          ethers.id("Approval(address,address,uint256)"),
          ethers.zeroPadValue(ownerAddress, 32),
          ethers.zeroPadValue(spenderAddress, 32)
        ]
      };
      
      this.providers.forEach((providerConfig, index) => {
        const { name, wsProvider } = providerConfig;
        
        const approvalListener = async (event) => {
          if (approved) return;
          
          try {
            // Decode approval amount
            const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], event.data);
            const approvalAmount = decoded[0];
            
            if (approvalAmount > 0n) {
              approved = true;
              this.removeEventListener(listenerId);
              
              log(`✅ WebSocket (${name}): Approval detected - ${ethers.formatUnits(approvalAmount, 18)} tokens approved`);
              resolve(true);
            }
          } catch (error) {
            log(`⚠️ WebSocket (${name}): Error processing approval event: ${error.message}`);
          }
        };
        
        wsProvider.on(approvalFilter, approvalListener);
        this.eventListeners.set(`${listenerId}-${index}`, { provider: wsProvider, event: approvalFilter, listener: approvalListener });
      });
      
      // Timeout after 2 minutes
      setTimeout(() => {
        if (!approved) {
          this.removeEventListener(listenerId);
          reject(new Error('Approval monitoring timeout'));
        }
      }, 120000);
    });
  }

  /**
   * Monitor price changes via Swap events (for mmbot and REBUY mode)
   * @param {string} poolAddress - Uniswap V2 pool address
   * @param {Function} priceCallback - Callback function called with new price
   * @returns {string} Listener ID for cleanup
   */
  startPriceMonitoring(poolAddress, priceCallback) {
    if (!this.isInitialized) {
      throw new Error('WebSocket service not initialized');
    }
    
    const listenerId = `price-${poolAddress}`;
    
    log(`📡 WebSocket: Starting price monitoring for pool ${poolAddress.slice(0, 8)}...`);
    
    // Swap event filter
    const swapFilter = {
      address: poolAddress,
      topics: [ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)")]
    };
    
    this.providers.forEach((providerConfig, index) => {
      const { name, wsProvider } = providerConfig;
      
      const swapListener = async (event) => {
        try {
          // Decode swap event to get new reserves
          const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
            ['uint256', 'uint256', 'uint256', 'uint256'], 
            event.data
          );
          
          const [amount0In, amount1In, amount0Out, amount1Out] = decoded;
          
          log(`📊 WebSocket (${name}): Swap detected in pool ${poolAddress.slice(0, 8)}...`);
          
          // Get current reserves to calculate new price
          const pairContract = new ethers.Contract(poolAddress, [
            'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)'
          ], wsProvider);
          
          const reserves = await pairContract.getReserves();
          const newPrice = parseFloat(ethers.formatUnits(reserves.reserve0, 18)) / 
                          parseFloat(ethers.formatUnits(reserves.reserve1, 18));
          
          log(`💹 WebSocket (${name}): New price detected: ${newPrice.toFixed(8)}`);
          priceCallback(newPrice, name);
          
        } catch (error) {
          log(`⚠️ WebSocket (${name}): Error processing swap event: ${error.message}`);
        }
      };
      
      wsProvider.on(swapFilter, swapListener);
      this.eventListeners.set(`${listenerId}-${index}`, { provider: wsProvider, event: swapFilter, listener: swapListener });
    });
    
    return listenerId;
  }

  /**
   * Monitor balance changes via Transfer events
   * @param {string} tokenAddress - Token contract address
   * @param {Array<string>} walletAddresses - Wallet addresses to monitor
   * @param {Function} balanceCallback - Callback function called with balance changes
   * @returns {string} Listener ID for cleanup
   */
  startBalanceMonitoring(tokenAddress, walletAddresses, balanceCallback) {
    if (!this.isInitialized) {
      throw new Error('WebSocket service not initialized');
    }
    
    const listenerId = `balance-${tokenAddress}`;
    
    log(`📡 WebSocket: Starting balance monitoring for ${walletAddresses.length} wallets`);
    
    // Transfer event filter
    const transferFilter = {
      address: tokenAddress,
      topics: [ethers.id("Transfer(address,address,uint256)")]
    };
    
    this.providers.forEach((providerConfig, index) => {
      const { name, wsProvider } = providerConfig;
      
      const transferListener = async (event) => {
        try {
          const fromAddress = ethers.getAddress(ethers.stripZerosLeft(event.topics[1]));
          const toAddress = ethers.getAddress(ethers.stripZerosLeft(event.topics[2]));
          
          // Check if any monitored wallets are involved
          const involvedWallets = walletAddresses.filter(wallet => 
            wallet.toLowerCase() === fromAddress.toLowerCase() ||
            wallet.toLowerCase() === toAddress.toLowerCase()
          );
          
          if (involvedWallets.length > 0) {
            const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], event.data);
            const amount = decoded[0];
            
            log(`📡 WebSocket (${name}): Balance change detected for ${involvedWallets.length} wallets`);
            
            balanceCallback({
              from: fromAddress,
              to: toAddress,
              amount: amount,
              involvedWallets: involvedWallets,
              provider: name,
              source: 'websocket'
            });
          }
          
        } catch (error) {
          log(`⚠️ WebSocket (${name}): Error processing transfer event: ${error.message}`);
        }
      };
      
      wsProvider.on(transferFilter, transferListener);
      this.eventListeners.set(`${listenerId}-${index}`, { provider: wsProvider, event: transferFilter, listener: transferListener });
    });
    
    return listenerId;
  }

  /**
   * Monitor pending transactions (mempool monitoring)
   * @param {Function} pendingCallback - Callback function for pending transactions
   * @returns {string} Listener ID for cleanup
   */
  startPendingTransactionMonitoring(pendingCallback) {
    if (!this.isInitialized) {
      throw new Error('WebSocket service not initialized');
    }
    
    const listenerId = 'pending-txs';
    
    log(`📡 WebSocket: Starting pending transaction monitoring`);
    
    this.providers.forEach((providerConfig, index) => {
      const { name, wsProvider } = providerConfig;
      
      const pendingListener = async (txHash) => {
        try {
          log(`📡 WebSocket (${name}): Pending transaction detected: ${txHash.slice(0, 10)}...`);
          pendingCallback(txHash, name);
        } catch (error) {
          log(`⚠️ WebSocket (${name}): Error processing pending transaction: ${error.message}`);
        }
      };
      
      wsProvider.on('pending', pendingListener);
      this.eventListeners.set(`${listenerId}-${index}`, { provider: wsProvider, event: 'pending', listener: pendingListener });
    });
    
    return listenerId;
  }

  /**
   * Remove event listener by ID
   * @param {string} listenerId - Listener ID to remove
   */
  removeEventListener(listenerId) {
    for (const [key, listener] of this.eventListeners.entries()) {
      if (key.startsWith(listenerId)) {
        try {
          listener.provider.removeListener(listener.event, listener.listener);
          this.eventListeners.delete(key);
        } catch (error) {
          log(`⚠️ Error removing WebSocket listener: ${error.message}`);
        }
      }
    }
  }

  /**
   * Stop price monitoring
   * @param {string} listenerId - Listener ID from startPriceMonitoring
   */
  stopPriceMonitoring(listenerId) {
    this.removeEventListener(listenerId);
    log(`🔇 WebSocket: Stopped price monitoring (${listenerId})`);
  }

  /**
   * Stop balance monitoring
   * @param {string} listenerId - Listener ID from startBalanceMonitoring  
   */
  stopBalanceMonitoring(listenerId) {
    this.removeEventListener(listenerId);
    log(`🔇 WebSocket: Stopped balance monitoring (${listenerId})`);
  }

  /**
   * Get primary WebSocket provider
   */
  getPrimaryWebSocketProvider() {
    if (!this.isInitialized || this.providers.length === 0) {
      throw new Error('No WebSocket providers available');
    }
    return this.providers[0].wsProvider;
  }

  /**
   * Get all WebSocket providers
   */
  getAllWebSocketProviders() {
    if (!this.isInitialized) {
      throw new Error('WebSocket service not initialized');
    }
    return this.providers.map(p => p.wsProvider);
  }

  /**
   * Cleanup all WebSocket connections
   */
  cleanup() {
    log(`🧹 WebSocket Service: Cleaning up ${this.eventListeners.size} listeners and ${this.activeConnections.length} connections...`);
    
    // Remove all event listeners
    for (const [key, listener] of this.eventListeners.entries()) {
      try {
        listener.provider.removeListener(listener.event, listener.listener);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    this.eventListeners.clear();
    
    // Close WebSocket connections
    this.activeConnections.forEach(wsProvider => {
      try {
        if (wsProvider && wsProvider.removeAllListeners) {
          wsProvider.removeAllListeners();
        }
        if (wsProvider && wsProvider.destroy) {
          wsProvider.destroy();
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    });
    
    this.activeConnections = [];
    this.providers = [];
    this.isInitialized = false;
    
    log(`✅ WebSocket Service: Cleanup completed`);
  }
}

// Create singleton instance
export const webSocketService = new WebSocketService(); 