// WebSocket Approval Service for all bots
// Replaces polling-based approval checking with real-time Approval events

import { ethers } from 'ethers';
import { ConfigLoader } from '../../config/loader.js';
import { ERC20_ABI, TRUSTSWAP_CONTRACT } from '../config/jeetConstants.js';
import { log } from '../../utils/logger.js';

/**
 * WebSocket Approval Service
 * Monitors ERC20 approval events in real-time instead of polling
 * Used by: BuyBot, SellBot, FarmBot, MMBot
 */
export class WebSocketApprovalService {
  constructor() {
    this.providers = [];
    this.activeApprovalListeners = new Map(); // Track active listeners
    this.isInitialized = false;
  }

  /**
   * Initialize WebSocket providers (Infura primary, Alchemy fallback)
   */
  async initialize() {
    if (this.isInitialized) return;

    const configLoader = new ConfigLoader();
    // SURGICAL FIX: Use getRpcConfigurations() which decodes base64 URLs instead of getConfig() which returns raw base64
    const rpcConfigs = configLoader.getRpcConfigurations();

    // Initialize providers from decoded RPC configurations
    for (const rpcConfig of rpcConfigs) {
      if (rpcConfig.wsUrl && rpcConfig.rpcUrl) {
        try {
          const wsProvider = new ethers.WebSocketProvider(rpcConfig.wsUrl);
          const rpcProvider = new ethers.JsonRpcProvider(rpcConfig.rpcUrl);
          
          this.providers.push({
            name: rpcConfig.name,
            wsProvider: wsProvider,
            rpcProvider: rpcProvider,
            priority: rpcConfig.name === 'Infura' ? 1 : 2
          });
          
          log(`✅ WebSocket Approval Service: ${rpcConfig.name} provider initialized`);
        } catch (error) {
          log(`❌ ${rpcConfig.name} WebSocket approval service initialization failed: ${error.message}`);
        }
      }
    }

    if (this.providers.length === 0) {
      throw new Error('No WebSocket providers available for approval service');
    }

    this.isInitialized = true;
    log(`🚀 WebSocket Approval Service initialized with ${this.providers.length} providers`);
  }

  /**
   * Monitor approval events for a specific token and wallet
   * @param {string} tokenAddress - Token contract address
   * @param {string} walletAddress - Wallet address (owner)
   * @param {string} spenderAddress - Spender address (default: TRUSTSWAP)
   * @param {number} timeout - Timeout in milliseconds (default: 2 minutes)
   * @returns {Promise<Object>} Approval event data
   */
  async waitForApprovalEvent(
    tokenAddress, 
    walletAddress, 
    spenderAddress = TRUSTSWAP_CONTRACT, 
    timeout = 120000
  ) {
    if (!this.isInitialized) await this.initialize();

    return new Promise((resolve, reject) => {
      const listenerId = `approval-${tokenAddress}-${walletAddress}-${Date.now()}`;
      let approvalDetected = false;

      log(`📡 WebSocket: Monitoring approval events for ${tokenAddress.slice(0, 8)}... (wallet: ${walletAddress.slice(0, 8)}...)`);

      // Set timeout
      const timeoutId = setTimeout(() => {
        if (!approvalDetected) {
          this.stopApprovalMonitoring(listenerId);
          reject(new Error(`Approval monitoring timeout after ${timeout}ms`));
        }
      }, timeout);

      // Setup listeners on all providers for redundancy
      this.providers.forEach((providerConfig, index) => {
        const { name, wsProvider } = providerConfig;

        try {
          // Create Approval event filter
          const approvalFilter = {
            address: tokenAddress,
            topics: [
              ethers.id("Approval(address,address,uint256)"),
              ethers.zeroPadValue(walletAddress, 32),
              ethers.zeroPadValue(spenderAddress, 32)
            ]
          };

          const approvalListener = async (event) => {
            if (approvalDetected) return;

            try {
              // Decode approval amount
              const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], event.data);
              const approvalAmount = decoded[0];

              log(`📡 WebSocket (${name}): Approval event detected - ${ethers.formatUnits(approvalAmount, 18)} tokens approved`);

              if (approvalAmount > 0n) {
                approvalDetected = true;
                clearTimeout(timeoutId);
                this.stopApprovalMonitoring(listenerId);

                resolve({
                  success: true,
                  approvalAmount: approvalAmount,
                  formattedAmount: ethers.formatUnits(approvalAmount, 18),
                  isUnlimited: approvalAmount >= ethers.MaxUint256 / 2n,
                  transactionHash: event.transactionHash,
                  blockNumber: event.blockNumber,
                  provider: name,
                  source: 'websocket-approval'
                });
              }
            } catch (error) {
              log(`⚠️ WebSocket (${name}): Error processing approval event: ${error.message}`);
            }
          };

          wsProvider.on(approvalFilter, approvalListener);

          // Store listener for cleanup
          this.activeApprovalListeners.set(`${listenerId}-${index}`, {
            provider: wsProvider,
            filter: approvalFilter,
            listener: approvalListener,
            providerName: name
          });

          log(`📡 WebSocket (${name}): Approval listener established`);

        } catch (error) {
          log(`❌ Failed to setup approval listener on ${name}: ${error.message}`);
        }
      });
    });
  }

  /**
   * Check and approve token if needed (with WebSocket monitoring)
   * @param {Object} wallet - Wallet instance
   * @param {string} tokenAddress - Token contract address
   * @param {BigInt} requiredAmount - Required approval amount
   * @param {string} spenderAddress - Spender address (default: TRUSTSWAP)
   * @param {Object} gasParams - Gas parameters
   * @returns {Promise<boolean>} True if approval was executed
   */
  async checkAndApproveTokenWebSocket(
    wallet,
    tokenAddress,
    requiredAmount,
    spenderAddress = TRUSTSWAP_CONTRACT,
    gasParams
  ) {
    try {
      if (!this.isInitialized) await this.initialize();

      // Get current allowance
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.providers[0].rpcProvider
      );

      const currentAllowance = await tokenContract.allowance(wallet.address, spenderAddress);

      if (currentAllowance >= requiredAmount) {
        log(`✅ WebSocket: Token already approved (allowance: ${currentAllowance >= ethers.MaxUint256 / 2n ? 'UNLIMITED' : ethers.formatUnits(currentAllowance, 18)})`);
        return false;
      }

      log(`🔓 WebSocket: Executing UNLIMITED approval (current: ${ethers.formatUnits(currentAllowance, 18)}, required: ${ethers.formatUnits(requiredAmount, 18)})`);

      // Start monitoring approval events BEFORE submitting transaction
      const approvalPromise = this.waitForApprovalEvent(
        tokenAddress,
        wallet.address,
        spenderAddress,
        60000 // 1 minute timeout
      );

      // Execute approval transaction
      const tokenContractWithWallet = tokenContract.connect(wallet);
      const approveTx = await tokenContractWithWallet.approve(
        spenderAddress,
        ethers.MaxUint256,
        {
          maxFeePerGas: gasParams.maxFeePerGas,
          maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
          gasLimit: 200000n
        }
      );

      log(`📝 WebSocket: Approval transaction submitted: ${approveTx.hash}`);

      // Wait for approval event via WebSocket
      const approvalEvent = await approvalPromise;

      log(`✅ WebSocket: UNLIMITED approval confirmed via event! (${approvalEvent.provider})`);
      log(`   📊 Amount: ${approvalEvent.isUnlimited ? 'UNLIMITED' : approvalEvent.formattedAmount}`);
      log(`   📝 TX: ${approvalEvent.transactionHash}`);

      return true;

    } catch (error) {
      log(`❌ WebSocket approval failed: ${error.message}`);
      
      // Fallback to traditional approval checking
      log(`🔄 Falling back to traditional approval checking...`);
      return await this._fallbackApprovalCheck(wallet, tokenAddress, requiredAmount, spenderAddress, gasParams);
    }
  }

  /**
   * Traditional approval fallback (if WebSocket fails)
   * @private
   */
  async _fallbackApprovalCheck(wallet, tokenAddress, requiredAmount, spenderAddress, gasParams) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
      const currentAllowance = await tokenContract.allowance(wallet.address, spenderAddress);

      if (currentAllowance >= requiredAmount) {
        return false;
      }

      const approveTx = await tokenContract.approve(spenderAddress, ethers.MaxUint256, {
        maxFeePerGas: gasParams.maxFeePerGas,
        maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
        gasLimit: 200000n
      });

      await approveTx.wait();
      log(`✅ Fallback: UNLIMITED approval confirmed via polling`);
      return true;

    } catch (error) {
      log(`❌ Fallback approval failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stop monitoring approval events
   * @param {string} listenerId - Listener ID to stop
   */
  stopApprovalMonitoring(listenerId) {
    for (const [key, listener] of this.activeApprovalListeners.entries()) {
      if (key.startsWith(listenerId)) {
        try {
          listener.provider.removeListener(listener.filter, listener.listener);
          this.activeApprovalListeners.delete(key);
          log(`🔇 WebSocket (${listener.providerName}): Stopped approval monitoring`);
        } catch (error) {
          // Silent cleanup
        }
      }
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      providers: this.providers.length,
      activeListeners: this.activeApprovalListeners.size,
      providerNames: this.providers.map(p => p.name)
    };
  }

  /**
   * Cleanup all approval listeners
   */
  async cleanup() {
    // Stop all approval monitoring
    for (const [key] of this.activeApprovalListeners) {
      this.stopApprovalMonitoring(key.split('-')[0]);
    }

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
    
    log(`🧹 WebSocket Approval Service cleaned up`);
  }
}

// Singleton instance for shared usage across all bots
export const wsApprovalService = new WebSocketApprovalService();

/**
 * Usage Examples:
 * 
 * // Replace traditional approval checking in any bot:
 * 
 * // OLD (polling-based):
 * const currentAllowance = await tokenContract.allowance(wallet.address, TRUSTSWAP_CONTRACT);
 * if (currentAllowance < requiredAmount) {
 *   const approveTx = await tokenContract.approve(TRUSTSWAP_CONTRACT, ethers.MaxUint256);
 *   await approveTx.wait(); // 2-second polling
 * }
 * 
 * // NEW (WebSocket-based):
 * await wsApprovalService.checkAndApproveTokenWebSocket(
 *   wallet, tokenAddress, requiredAmount, TRUSTSWAP_CONTRACT, gasParams
 * ); // Instant event-driven confirmation
 */ 