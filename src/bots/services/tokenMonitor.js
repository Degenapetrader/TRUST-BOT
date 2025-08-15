// Token monitor service for continuous wallet monitoring and swap execution

import { ethers } from 'ethers';
import { executeRpcWithFallback } from '../../config/index.js';
import { 
  ERC20_ABI, 
  TOKEN_DUST_THRESHOLD,
  BALANCE_RECHECK_INTERVAL,
  WALLET_PROCESSING_DELAY
} from '../config/jeetConstants.js';
import { log, formatTimestampUTC } from '../../utils/logger.js';
import { sleep } from '../../utils/common.js';
import { JeetSwapExecutor } from './jeetSwapExecutor.js';
import { TokenInfoResolver } from './tokenInfoResolver.js';
import { TokenBlacklist } from './tokenBlacklist.js';
import { ConfigLoader } from '../../config/loader.js';

// Dynamic WebSocket provider configuration from wallets.json
function getWebSocketProviders() {
  const configLoader = new ConfigLoader();
  const rpcConfigs = configLoader.getRpcConfigurations(); // Use decoded configurations
  
  const providers = [];
  
  // Create providers from decoded RPC configurations
  rpcConfigs.forEach((rpcConfig, index) => {
    if (rpcConfig.wsUrl && rpcConfig.rpcUrl) {
      try {
        const rpcProvider = new ethers.JsonRpcProvider(rpcConfig.rpcUrl);
        const wsProvider = new ethers.WebSocketProvider(rpcConfig.wsUrl);
        
        rpcProvider._providerName = `${rpcConfig.name}-RPC`;
        wsProvider._providerName = `${rpcConfig.name}-WebSocket`;
        
        providers.push({
          name: rpcConfig.name,
          rpcProvider: rpcProvider,
          wsProvider: wsProvider,
          priority: index + 1 // Priority based on order
        });
        
        log(`✅ ${rpcConfig.name} WebSocket provider loaded for balance monitoring`);
      } catch (error) {
        log(`⚠️ Failed to create ${rpcConfig.name} WebSocket provider: ${error.message}`);
      }
    } else {
      log(`⚠️ ${rpcConfig.name} WebSocket URL not configured for balance monitoring`);
    }
  });
  
  // Sort by priority (Infura first, then Alchemy)
  providers.sort((a, b) => a.priority - b.priority);
  
  if (providers.length === 0) {
    throw new Error('No WebSocket providers available for balance monitoring');
  }
  
  log(`🔗 Balance monitoring providers: ${providers.map(p => p.name).join(' → ')} (priority order)`);
  return providers;
}

export class TokenMonitor {
  constructor(wallets, tokenCA, minimumBalance = 0, inputType = 'GENESIS') {
    this.wallets = wallets;
    this.tokenCA = tokenCA;
    this.minimumBalance = minimumBalance;
    this.inputType = inputType;
    this.isMonitoring = true;
    this.swappedWallets = new Set(); // Wallets that completed swaps
    this.processingWallets = new Set(); // Wallets currently being processed (prevents double-swapping)
    this.dustWallets = new Map();
    this.tokenInfo = null;
    this.wsProviders = [];
    this.activeConnections = [];
    this.balanceCache = new Map(); // Cache for balance tracking
    this.transferEventFilter = null;
    this.currentProvider = null;
    this.allSwapResults = []; // Store ALL swap results for REBUY mode
  }

  /**
   * Stop monitoring
   */
  stop() {
    this.isMonitoring = false;
    this.cleanup();
  }

  /**
   * Setup WebSocket Transfer event listeners for real-time balance monitoring
   * Uses SEQUENTIAL fallback: Infura primary → Alchemy fallback (NOT parallel)
   */
  async setupWebSocketBalanceMonitoring() {
    try {
      // Load WebSocket providers
      this.wsProviders = getWebSocketProviders();
      log(`📡 Setting up SEQUENTIAL WebSocket balance monitoring with ${this.wsProviders.length} providers`);
      log(`🎯 Strategy: Infura PRIMARY → Alchemy FALLBACK (sequential, not parallel)`);
      
      // Create Transfer event filter for this token
      const transferTopic = ethers.id("Transfer(address,address,uint256)");
      this.transferEventFilter = {
        address: this.tokenCA,
        topics: [transferTopic]
      };
      
      // Start with primary provider (Infura)
      await this.setupPrimaryWebSocketProvider();
      
      log(`✅ Sequential WebSocket Transfer event listener established`);
      log(`🚫 Polling method DISABLED - Using WebSocket-only for optimal performance`);
      log(`🔒 Double swap prevention: SEQUENTIAL providers prevent duplicate events`);
      
    } catch (error) {
      log(`❌ Failed to setup WebSocket balance monitoring: ${error.message}`);
      throw error; // Don't fallback to polling - WebSocket is required
    }
  }

  /**
   * Setup primary WebSocket provider (Infura) with automatic fallback to Alchemy
   */
  async setupPrimaryWebSocketProvider() {
    const primaryProvider = this.wsProviders[0]; // Infura first
    const { name, wsProvider } = primaryProvider;
    
    log(`🔗 Setting up PRIMARY ${name} Transfer event listener...`);
    
    // Store active connection for cleanup
    this.activeConnections.push(wsProvider);
    this.currentProvider = primaryProvider;
    
    // Listen for Transfer events on PRIMARY provider only
    wsProvider.on(this.transferEventFilter, (event) => {
      this.handleTransferEvent(event, name);
    });
    
    // Connection monitoring with automatic fallback (ethers.js v6 compatible)
    wsProvider.on('error', (error) => {
      log(`❌ ${name} WebSocket error in balance monitoring: ${error.message}`);
      this.handleProviderFailure(primaryProvider);
    });
    
    // Note: 'close' event is not supported in ethers.js v6
    // Connection failures will be handled via 'error' events
    
    log(`✅ ${name} WebSocket provider active as PRIMARY`);
  }

  /**
   * Handle provider failure and fallback to next available provider
   */
  async handleProviderFailure(failedProvider) {
    try {
      log(`🔄 Provider ${failedProvider.name} failed - initiating fallback sequence...`);
      
      // Find next available provider
      const currentIndex = this.wsProviders.findIndex(p => p.name === failedProvider.name);
      const nextProvider = this.wsProviders[currentIndex + 1];
      
      if (!nextProvider) {
        log(`❌ No fallback providers available - WebSocket monitoring disabled`);
        return;
      }
      
      // Cleanup failed provider
      try {
        if (failedProvider.wsProvider && failedProvider.wsProvider.removeAllListeners) {
          failedProvider.wsProvider.removeAllListeners();
        }
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      
      // Setup fallback provider
      const { name, wsProvider } = nextProvider;
      log(`🔄 Switching to FALLBACK ${name} WebSocket provider...`);
      
      // Store new active connection
      this.activeConnections.push(wsProvider);
      this.currentProvider = nextProvider;
      
      // Listen for Transfer events on FALLBACK provider
      wsProvider.on(this.transferEventFilter, (event) => {
        this.handleTransferEvent(event, name);
      });
      
      // Connection monitoring for fallback
      wsProvider.on('error', (error) => {
        log(`❌ FALLBACK ${name} WebSocket error: ${error.message}`);
        // Could add additional fallback logic here if needed
      });
      
      log(`✅ Successfully switched to ${name} WebSocket provider (FALLBACK)`);
      
    } catch (error) {
      log(`❌ Failed to setup fallback provider: ${error.message}`);
    }
  }

  /**
   * Handle Transfer event from WebSocket
   */
  async handleTransferEvent(event, providerName) {
    try {
      // Decode the Transfer event
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ['uint256'], // value
        event.data
      );
      
      const fromAddress = ethers.stripZerosLeft(event.topics[1]);
      const toAddress = ethers.stripZerosLeft(event.topics[2]);
      const value = decoded[0];
      
      // Check if any of our wallets are involved in this transfer
      const involvedWallets = this.wallets.filter(wallet => {
        const walletLower = wallet.address.toLowerCase();
        const fromLower = fromAddress.toLowerCase();
        const toLower = toAddress.toLowerCase();
        
        return walletLower === fromLower || walletLower === toLower;
      });
      
      if (involvedWallets.length > 0) {
        // Filter out wallets that are already completed or currently being processed
        const availableWallets = involvedWallets.filter(wallet => 
          !this.swappedWallets.has(wallet.address) && 
          !this.processingWallets.has(wallet.address)
        );
        
        if (availableWallets.length > 0) {
          log(`📡 WebSocket (${providerName}): Transfer event detected for ${availableWallets.length} monitored wallets`);
          
          // Clear balance cache for involved wallets (force fresh balance check)
          for (const wallet of availableWallets) {
            this.invalidateBalanceCache(wallet.address);
            log(`   🔄 WebSocket: Balance cache cleared for wallet ${wallet.address.slice(0, 8)}... (fresh balance required)`);
          }
          
          // Trigger immediate balance check for these wallets
          setTimeout(() => {
            this.checkSpecificWalletBalances(availableWallets);
          }, 1000); // Small delay to ensure transaction is processed
        } else {
          log(`📡 WebSocket (${providerName}): Transfer event detected but all involved wallets already completed/processing`);
        }
      }
      
    } catch (error) {
      log(`⚠️ Error handling Transfer event from ${providerName}: ${error.message}`);
    }
  }

  /**
   * Invalidate balance cache for a wallet
   * This forces the next balance check to fetch fresh data from blockchain
   */
  invalidateBalanceCache(walletAddress) {
    this.balanceCache.delete(walletAddress.toLowerCase());
  }

  /**
   * Check specific wallets' balances (triggered by WebSocket events)
   */
  async checkSpecificWalletBalances(specificWallets) {
    const balancePromises = specificWallets.map(async (wallet, originalIndex) => {
      const walletIndex = this.wallets.findIndex(w => w.address === wallet.address) + 1;
      
      // Skip if wallet is already completed or being processed
      if (this.swappedWallets.has(wallet.address) || this.processingWallets.has(wallet.address)) {
        return null;
      }
      
      try {
        // Use cached balance if available and recent (for efficiency)
        const cacheKey = wallet.address.toLowerCase();
        const cachedBalance = this.balanceCache.get(cacheKey);
        
        if (cachedBalance && (Date.now() - cachedBalance.timestamp) < 3000) { // 3 second cache for WebSocket
          return {
            wallet,
            walletIndex,
            address: wallet.address,
            balance: cachedBalance.balance,
            hasTokens: cachedBalance.balance > 0n,
            formattedBalance: ethers.formatUnits(cachedBalance.balance, 18),
            source: 'websocket-cache'
          };
        }
        
        // Get fresh balance using WebSocket provider first, fallback to RPC
        let balance = 0n;
        let source = 'websocket';
        let providerName = '';
        
        try {
          if (this.currentProvider && this.currentProvider.wsProvider) {
            const tokenContract = new ethers.Contract(this.tokenCA, ERC20_ABI, this.currentProvider.wsProvider);
            balance = await tokenContract.balanceOf(wallet.address);
            source = `websocket-${this.currentProvider.name.toLowerCase()}`;
            providerName = this.currentProvider.name;
          } else {
            throw new Error('No WebSocket providers available');
          }
        } catch (wsError) {
          // Fallback to traditional RPC
          balance = await executeRpcWithFallback(async (provider) => {
            const tokenContract = new ethers.Contract(this.tokenCA, ERC20_ABI, provider);
            return await tokenContract.balanceOf(wallet.address);
          }, 3, 1000);
          source = 'rpc-fallback';
        }
        
        // Update cache
        this.balanceCache.set(cacheKey, {
          balance,
          timestamp: Date.now()
        });
        
        return {
          wallet,
          walletIndex,
          address: wallet.address,
          balance: balance,
          hasTokens: balance > 0n,
          formattedBalance: ethers.formatUnits(balance, 18),
          source
        };
      } catch (error) {
        return {
          wallet,
          walletIndex,
          address: wallet.address,
          error: error.message,
          hasTokens: false,
          source: 'error'
        };
      }
    });
    
    const results = await Promise.all(balancePromises);
    const validResults = results.filter(r => r !== null);
    
    // Process results and trigger swaps if needed
    const walletsReadyForSwap = validResults.filter(r => {
      if (!r.hasTokens || this.swappedWallets.has(r.address) || this.processingWallets.has(r.address)) return false;
      const balance = parseFloat(r.formattedBalance);
      return balance >= this.minimumBalance;
    });
    
    if (walletsReadyForSwap.length > 0) {
      log(`⚡ WebSocket Real-time Detection: ${walletsReadyForSwap.length} wallets ready for immediate swapping!`);
      walletsReadyForSwap.forEach(result => {
        log(`   📡 B${result.walletIndex}: ${parseFloat(result.formattedBalance).toFixed(4)} tokens detected via ${result.source}`);
      });
      const websocketSwapResults = await this.executeSwapsForWallets(walletsReadyForSwap);
      // Store results for REBUY mode
      this.allSwapResults.push(...websocketSwapResults);
    }
  }

  /**
   * Start WebSocket-only monitoring (no polling)
   * @returns {Promise<Array>} Array of swap results
   */
  async startMonitoring() {
    log(`\n🎯 Starting WEBSOCKET-ONLY MONITORING (No Polling)`);
    log(`📡 Token: ${this.tokenCA}`);
    log(`💫 Auto-swap: ON (tokens → VIRTUAL via TRUSTSWAP DEFAULT + Pool fallback)`);
    log(`💱 Trading: TRUSTSWAP DEFAULT first, Pool-based fallback if needed (0.25% fee)`);
    log(`🔗 Real-time: WebSocket Transfer event listeners for instant balance updates`);
    log(`🚫 Polling: DISABLED - Pure WebSocket event-driven monitoring for optimal performance`);
    
    if (this.inputType === 'TOKEN_CA' || this.inputType === 'TICKER') {
      log(`🎯 Minimum Balance Mode: ${this.minimumBalance} tokens required for swapping`);
      log(`🔄 NEVER STOPS: Bot will continuously monitor until all wallets meet minimum and swap`);
    }
    
    log(`⚠️  Press Ctrl+C to stop`);

    const swapResults = [];

    // Setup WebSocket balance monitoring (required)
    await this.setupWebSocketBalanceMonitoring();

    // Pure WebSocket event-driven monitoring (no polling loop)
    log(`\n🎯 WebSocket monitoring active - waiting for Transfer events...`);
    log(`📊 Monitoring ${this.wallets.length} wallets for token: ${this.tokenCA}`);
    
    // Initial balance check to see if any wallets already have tokens
    const initialResults = await this.checkAllWalletsInitial();
    const walletsWithTokens = initialResults.filter(r => r.hasTokens && !this.swappedWallets.has(r.address));
    
    if (walletsWithTokens.length > 0) {
      log(`🔍 Initial check found ${walletsWithTokens.length} wallets with existing tokens`);
      const initialSwaps = await this.executeSwapsForWallets(walletsWithTokens);
      swapResults.push(...initialSwaps);
      // Store results for REBUY mode
      this.allSwapResults.push(...initialSwaps);
    } else {
      log(`🔍 Initial check: No wallets have tokens yet - waiting for WebSocket events...`);
    }

    // Wait for WebSocket events to trigger swaps (event-driven only)
    return new Promise((resolve) => {
      // Check completion status every 10 seconds
      const completionChecker = setInterval(() => {
        if (!this.isMonitoring) {
          clearInterval(completionChecker);
          // Return all swap results for REBUY mode
          resolve(this.allSwapResults);
          return;
        }
        
        // Check if all wallets are completed
        if (this.shouldStopMonitoring([])) {
          log(`\n🎯 All wallets processed - stopping WebSocket monitoring`);
          clearInterval(completionChecker);
          this.isMonitoring = false;
          // Return all swap results for REBUY mode
          resolve(this.allSwapResults);
        }
      }, 10000); // Check every 10 seconds
      
      // Handle Ctrl+C gracefully
      const handleInterrupt = () => {
        log(`\n🛑 WebSocket monitoring interrupted by user`);
        clearInterval(completionChecker);
        this.isMonitoring = false;
        // Return all swap results for REBUY mode
        resolve(this.allSwapResults);
      };
      
      process.on('SIGINT', handleInterrupt);
    });
  }

  /**
   * Initial balance check for all wallets (one-time)
   */
  async checkAllWalletsInitial() {
    log(`🔍 Performing initial balance check for all ${this.wallets.length} wallets...`);
    
    const balancePromises = this.wallets.map(async (wallet, index) => {
      const walletIndex = index + 1;
      
      try {
        // Get balance using primary WebSocket provider
        let balance = 0n;
        let source = 'websocket-initial';
        
        try {
          if (this.currentProvider && this.currentProvider.wsProvider) {
            const tokenContract = new ethers.Contract(this.tokenCA, ERC20_ABI, this.currentProvider.wsProvider);
            balance = await tokenContract.balanceOf(wallet.address);
          } else {
            throw new Error('No WebSocket providers available');
          }
        } catch (wsError) {
          // Fallback to traditional RPC for initial check
          balance = await executeRpcWithFallback(async (provider) => {
          const tokenContract = new ethers.Contract(this.tokenCA, ERC20_ABI, provider);
          return await tokenContract.balanceOf(wallet.address);
        }, 3, 1000);
          source = 'rpc-initial';
        }
        
        // Update cache
        const cacheKey = wallet.address.toLowerCase();
        this.balanceCache.set(cacheKey, {
          balance,
          timestamp: Date.now()
        });
        
        return {
          wallet,
          walletIndex,
          address: wallet.address,
          balance: balance,
          hasTokens: balance > 0n,
          formattedBalance: ethers.formatUnits(balance, 18),
          source
        };
      } catch (error) {
        return {
          wallet,
          walletIndex,
          address: wallet.address,
          error: error.message,
          hasTokens: false,
          source: 'error'
        };
      }
    });
    
    return await Promise.all(balancePromises);
  }

  /**
   * Execute swaps for wallets that are ready
   * @param {Array} walletsReadyForSwap - Wallets with sufficient balance
   * @returns {Promise<Array>} Array of swap results
   */
  async executeSwapsForWallets(walletsReadyForSwap) {
    // Filter out wallets already being processed or completed
    const availableWallets = walletsReadyForSwap.filter(result => 
      !this.swappedWallets.has(result.address) && 
      !this.processingWallets.has(result.address)
    );
    
    if (availableWallets.length === 0) {
      log(`⚠️ All wallets are already completed or being processed - skipping swap execution`);
      return [];
    }
    
    log(`\n🔥 WALLETS READY FOR SWAPPING! ${availableWallets.length} wallets meet requirements:`);
    availableWallets.forEach(result => {
      const fullBalance = parseFloat(result.formattedBalance);
      const sellAmount = fullBalance * 0.999;
      log(`   🎯 B${result.walletIndex} (${result.address.slice(0, 8)}): ${fullBalance.toFixed(4)} tokens (selling 99.9% = ${sellAmount.toFixed(4)}) [${result.source}]`);
    });
    
    // Mark wallets as being processed BEFORE starting swaps
    availableWallets.forEach(result => {
      this.processingWallets.add(result.address);
      log(`🔒 B${result.walletIndex}: Marked as PROCESSING - preventing duplicate swap attempts`);
    });
    
    // Get token info with pool resolution (only once)
    if (!this.tokenInfo) {
      log(`\n🔍 Getting token info and pool for swapping...`);
      this.tokenInfo = await TokenInfoResolver.getTokenInfoWithPool(this.tokenCA);
      
      if (!this.tokenInfo) {
        log(`❌ Failed to get token info - skipping swaps this round`);
        // Remove from processing since we're not actually processing
        availableWallets.forEach(result => {
          this.processingWallets.delete(result.address);
        });
        return [];
      }
      
      // FINAL BLACKLIST CHECK
      if (TokenBlacklist.isTokenBlacklisted(this.tokenInfo.address, this.tokenInfo.symbol)) {
        TokenBlacklist.logBlacklistWarning(this.tokenInfo.address, this.tokenInfo.symbol, log);
        
        log(`\n🚫 JEETBOT STOPPED TO PROTECT BLACKLISTED TOKEN`);
        process.exit(0);
      }
      
      log(`✅ Token ready for swapping: ${this.tokenInfo.symbol} (${this.tokenInfo.name})`);
      if (this.tokenInfo.isTrustSwapDefault) {
        log(`🎯 Method: TRUSTSWAP DEFAULT (no pool needed)`);
      } else {
        log(`🏊 Pool Address: ${this.tokenInfo.poolAddress.slice(0, 8)}... (V2 Pool available)`);
        log(`🎯 Method: Pool-based trading (fallback mode)`);
      }
    }
    
    // Execute swaps for all available wallets (in parallel for speed)
    log(`\n💫 EXECUTING IMMEDIATE SWAPS for ${availableWallets.length} wallets...`);
    log(`🎯 Strategy: TRUSTSWAP DEFAULT → Pool-based fallback if needed`);
    
    const swapPromises = availableWallets.map(async (result) => {
      const fullBalance = parseFloat(result.formattedBalance);
      const tokenAmount = fullBalance * 0.999; // Use 99.9% to avoid rounding errors
      
      try {
      // Only swap if amount is significant
      if (tokenAmount > TOKEN_DUST_THRESHOLD) {
        // Reset dust counter if wallet now has significant amount
        if (this.dustWallets.has(result.address)) {
          this.dustWallets.delete(result.address);
          log(`🔄 B${result.walletIndex}: Dust counter reset - wallet now has significant balance`);
        }
        
        const swapResult = await JeetSwapExecutor.executeTokenSwap(
          result.wallet, 
          this.tokenInfo, 
          tokenAmount, 
          this.wallets
        );
        
        // Track swapped wallets separately - only add if successful
        if (swapResult.success) {
          this.swappedWallets.add(result.address);
            // Invalidate cache for swapped wallet
            this.invalidateBalanceCache(result.address);
            log(`✅ B${result.walletIndex}: TASK COMPLETED - Wallet permanently removed from monitoring`);
            log(`📊 Progress: ${this.swappedWallets.size} wallets completed, ${this.wallets.length - this.swappedWallets.size} remaining`);
          } else {
            log(`❌ B${result.walletIndex}: Swap failed - wallet will remain available for retry`);
            log(`📋 Error: ${swapResult.error || 'Unknown swap failure'}`);
        }
        
        return swapResult;
      } else {
          const dustResult = this.handleDustAmount(result, tokenAmount);
          return dustResult;
        }
      } finally {
        // Always remove from processing set when done (success or failure)
        this.processingWallets.delete(result.address);
        log(`🔓 B${result.walletIndex}: Removed from PROCESSING - available for future events`);
      }
    });
    
    const swapResults = await Promise.all(swapPromises);
    
    // Report swap results
    this.reportSwapResults(swapResults);
    
    return swapResults;
  }

  /**
   * Handle dust amount detection
   * @param {Object} walletResult - Wallet balance result
   * @param {number} tokenAmount - Token amount
   * @returns {Object} Result object
   */
  handleDustAmount(walletResult, tokenAmount) {
    if (this.inputType === 'GENESIS') {
      log(`⚠️ B${walletResult.walletIndex}: Token amount too small (${tokenAmount.toFixed(6)}) - GENESIS MODE: Will re-check in 30s for balance increase`);
      return { success: false, walletIndex: walletResult.walletIndex, reason: 'dust_amount_genesis_continue' };
    } else {
      // Track dust amounts but don't mark as processed
      const dustEntry = this.dustWallets.get(walletResult.address) || { count: 0, lastAmount: 0 };
      
      // If amount increased significantly, reset counter
      if (tokenAmount > dustEntry.lastAmount * 1.5) {
        dustEntry.count = 1;
        log(`🔄 B${walletResult.walletIndex}: Token amount increased (${dustEntry.lastAmount.toFixed(6)} → ${tokenAmount.toFixed(6)}) - dust counter reset`);
      } else {
        dustEntry.count++;
      }
      
      dustEntry.lastAmount = tokenAmount;
      this.dustWallets.set(walletResult.address, dustEntry);
      
      if (dustEntry.count >= 3) {
        log(`⚠️ B${walletResult.walletIndex}: Consistently small amounts (${tokenAmount.toFixed(6)}) - treating as dust (${dustEntry.count} consecutive)`);
        return { success: false, walletIndex: walletResult.walletIndex, reason: 'consistent_dust', isDust: true };
      } else {
        log(`⚠️ B${walletResult.walletIndex}: Token amount too small (${tokenAmount.toFixed(6)}), will re-check (attempt ${dustEntry.count}/3)`);
        return { success: false, walletIndex: walletResult.walletIndex, reason: 'amount_too_small' };
      }
    }
  }

  /**
   * Report swap results
   * @param {Array} swapResults - Array of swap results
   */
  reportSwapResults(swapResults) {
    const successful = swapResults.filter(r => r.success).length;
    const failed = swapResults.filter(r => !r.success).length;
    const trustswapDefault = swapResults.filter(r => r.method === 'TRUSTSWAP-DEFAULT').length;
    const poolBasedFallback = swapResults.filter(r => r.method === 'POOL-BASED-FALLBACK').length;
    
    log(`\n📊 SWAP RESULTS:`);
    log(`✅ Successful swaps: ${successful}/${swapResults.length}`);
    log(`❌ Failed swaps: ${failed}/${swapResults.length}`);
    if (trustswapDefault > 0) {
      log(`🎯 TRUSTSWAP DEFAULT: ${trustswapDefault} successful`);
    }
    if (poolBasedFallback > 0) {
      log(`🏊 Pool-based fallback: ${poolBasedFallback} successful`);
    }
    
    if (successful > 0) {
      const totalReceivedVirtual = swapResults
        .filter(r => r.success)
        .reduce((sum, r) => sum + (r.virtualReceived || 0), 0);
      log(`💎 Total VIRTUAL received: ${totalReceivedVirtual.toFixed(6)}`);
    }
    
    log(`\n🔄 Continuing to monitor for new tokens (WebSocket + polling hybrid)...`);
  }

  /**
   * Check if monitoring should stop
   * @param {Array} results - Balance check results
   * @returns {boolean} True if should stop
   */
  shouldStopMonitoring(results) {
    const totalWalletsWithTokens = results.filter(r => r.hasTokens).length;
    const successfullySwappedCount = this.swappedWallets.size;
    
    // Filter out dust wallets from pending count
    const walletsStillNeedingSwap = results.filter(r => {
      if (!r.hasTokens || this.swappedWallets.has(r.address)) return false;
      const dustEntry = this.dustWallets.get(r.address);
      return !dustEntry || dustEntry.count < 3;
    }).length;
    
    // Enhanced logging for completion tracking
    if (successfullySwappedCount > 0) {
      log(`\n📊 COMPLETION STATUS:`);
      log(`✅ Successfully swapped wallets: ${successfullySwappedCount}`);
      log(`⏳ Wallets still needing swap: ${walletsStillNeedingSwap}`);
      log(`📋 Completed wallet addresses:`);
      for (const address of this.swappedWallets) {
        const walletIndex = this.wallets.findIndex(w => w.address === address) + 1;
        log(`   ✅ B${walletIndex} (${address.slice(0, 8)}...) - TASK COMPLETED & REMOVED FROM MONITORING`);
      }
    }
    
    // Stop when all wallets with tokens have been successfully swapped
    const shouldStop = walletsStillNeedingSwap === 0 && successfullySwappedCount > 0;
    
    if (shouldStop) {
      log(`\n🎉 ALL WALLET TASKS COMPLETED!`);
      log(`✅ Total wallets that successfully swapped: ${successfullySwappedCount}`);
      log(`🏁 Bot objective achieved - all imported wallets reached swap completion stage`);
      log(`🛑 Stopping JeetBot as per requirements...`);
    }
    
    return shouldStop;
  }

  /**
   * Cleanup WebSocket connections and resources
   */
  cleanup() {
    if (this.activeConnections.length > 0) {
      log(`🧹 Cleaning up ${this.activeConnections.length} WebSocket balance monitoring connections...`);
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
    }
    
    // Clear balance cache
    this.balanceCache.clear();
    log(`🗑️ Balance cache cleared`);
  }
} 