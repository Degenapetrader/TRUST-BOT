// WebSocket Price Monitoring Service for MMBot and REBUY mode
// Replaces polling-based price monitoring with real-time Swap events

import { ethers } from 'ethers';
import { ConfigLoader } from '../../config/loader.js';
import { log } from '../../utils/logger.js';

/**
 * WebSocket Price Service
 * Monitors price changes via Swap events instead of periodic polling
 * Used by: MMBot (range trading), REBUY mode (price drop detection)
 */
export class WebSocketPriceService {
  constructor() {
    this.providers = [];
    this.activePriceListeners = new Map(); // Track active price monitors
    this.priceCache = new Map(); // Cache latest prices
    this.isInitialized = false;
  }

  /**
   * Initialize WebSocket providers (Infura primary, Alchemy fallback)
   */
  async initialize() {
    if (this.isInitialized) return;

    const configLoader = new ConfigLoader();
    const config = configLoader.getConfig();

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
          
        log(`✅ WebSocket Price Service: Infura provider initialized`);
        } catch (error) {
        log(`❌ Infura WebSocket price service initialization failed: ${error.message}`);
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
        
        log(`✅ WebSocket Price Service: Alchemy provider initialized`);
      } catch (error) {
        log(`❌ Alchemy WebSocket price service initialization failed: ${error.message}`);
      }
    }

    if (this.providers.length === 0) {
      throw new Error('No WebSocket providers available for price service');
    }

    this.isInitialized = true;
    log(`🚀 WebSocket Price Service initialized with ${this.providers.length} providers`);
  }

  /**
   * Monitor price range for MMBot (buy/sell triggers)
   * @param {string} poolAddress - Uniswap V2 pool address
   * @param {Object} priceRange - {buyThreshold: number, sellThreshold: number, basePrice: number}
   * @param {Function} priceCallback - Callback when price moves outside range
   * @returns {string} Listener ID for cleanup
   */
  async startPriceRangeMonitoring(poolAddress, priceRange, priceCallback) {
    if (!this.isInitialized) await this.initialize();

    const listenerId = `price-range-${poolAddress}-${Date.now()}`;
    
    log(`📡 WebSocket: Starting price range monitoring for pool ${poolAddress.slice(0, 8)}...`);
    log(`   📈 Buy threshold: ${priceRange.buyThreshold.toFixed(6)} (${priceRange.buyThreshold < priceRange.basePrice ? 'price drop' : 'price rise'})`);
    log(`   📉 Sell threshold: ${priceRange.sellThreshold.toFixed(6)} (${priceRange.sellThreshold > priceRange.basePrice ? 'price rise' : 'price drop'})`);
    log(`   📊 Base price: ${priceRange.basePrice.toFixed(6)}`);

    // Setup listeners on all providers
    this.providers.forEach((providerConfig, index) => {
      const { name, wsProvider } = providerConfig;

      try {
        // Swap event filter for this pool
        const swapFilter = {
          address: poolAddress,
          topics: [ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)")]
        };

        const swapListener = async (event) => {
          try {
            // Get current reserves to calculate new price
            const newPrice = await this.calculatePoolPrice(poolAddress, wsProvider);
            
            if (newPrice === null) return;

            // Update price cache
            this.priceCache.set(poolAddress, {
              price: newPrice,
              timestamp: Date.now(),
              provider: name
            });

            log(`💹 WebSocket (${name}): Price update detected: ${newPrice.toFixed(8)} (pool: ${poolAddress.slice(0, 8)}...)`);

            // Check if price crossed thresholds
            let action = null;
            if (newPrice <= priceRange.buyThreshold) {
              action = 'BUY';
              log(`🟢 WebSocket (${name}): BUY signal! Price ${newPrice.toFixed(8)} <= ${priceRange.buyThreshold.toFixed(8)}`);
            } else if (newPrice >= priceRange.sellThreshold) {
              action = 'SELL';
              log(`🔴 WebSocket (${name}): SELL signal! Price ${newPrice.toFixed(8)} >= ${priceRange.sellThreshold.toFixed(8)}`);
            }

            if (action) {
              priceCallback({
                action,
                currentPrice: newPrice,
                priceRange,
                poolAddress,
                provider: name,
                timestamp: Date.now(),
                transactionHash: event.transactionHash,
                source: 'websocket-swap-event'
              });
            }

          } catch (error) {
            log(`⚠️ WebSocket (${name}): Error processing swap event: ${error.message}`);
          }
        };

        wsProvider.on(swapFilter, swapListener);

        // Store listener for cleanup
        this.activePriceListeners.set(`${listenerId}-${index}`, {
          provider: wsProvider,
          filter: swapFilter,
          listener: swapListener,
          providerName: name,
          poolAddress
        });

        log(`📡 WebSocket (${name}): Price range listener established for pool ${poolAddress.slice(0, 8)}...`);

      } catch (error) {
        log(`❌ Failed to setup price range listener on ${name}: ${error.message}`);
      }
    });

    return listenerId;
  }

  /**
   * Monitor price drops for REBUY mode
   * @param {string} poolAddress - Uniswap V2 pool address  
   * @param {Object} rebuyConfig - {basePrice: number, dropPercentage: number}
   * @param {Function} rebuyCallback - Callback when price drops enough for rebuy
   * @returns {string} Listener ID for cleanup
   */
  async startRebuyPriceMonitoring(poolAddress, rebuyConfig, rebuyCallback) {
    if (!this.isInitialized) await this.initialize();

    const listenerId = `rebuy-price-${poolAddress}-${Date.now()}`;
    const targetPrice = rebuyConfig.basePrice * (1 - rebuyConfig.dropPercentage / 100);
    
    log(`📡 WebSocket: Starting REBUY price monitoring for pool ${poolAddress.slice(0, 8)}...`);
    log(`   📊 Base price: ${rebuyConfig.basePrice.toFixed(8)}`);
    log(`   📉 Drop needed: ${rebuyConfig.dropPercentage}%`);
    log(`   🎯 Target price: ${targetPrice.toFixed(8)}`);

    // Setup listeners on all providers
    this.providers.forEach((providerConfig, index) => {
      const { name, wsProvider } = providerConfig;

      try {
        // Swap event filter for this pool
        const swapFilter = {
          address: poolAddress,
          topics: [ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)")]
        };

        const swapListener = async (event) => {
          try {
            // Get current price
            const currentPrice = await this.calculatePoolPrice(poolAddress, wsProvider);
            
            if (currentPrice === null) return;

            // Update price cache
            this.priceCache.set(poolAddress, {
              price: currentPrice,
              timestamp: Date.now(),
              provider: name
            });

            const dropPercentage = ((rebuyConfig.basePrice - currentPrice) / rebuyConfig.basePrice) * 100;

            log(`📊 WebSocket (${name}): REBUY price check: ${currentPrice.toFixed(8)} (${dropPercentage >= 0 ? '-' : '+'}${Math.abs(dropPercentage).toFixed(2)}%)`);

            // Check if price dropped enough for rebuy
            if (currentPrice <= targetPrice) {
              log(`🎯 WebSocket (${name}): REBUY TRIGGER! Price ${currentPrice.toFixed(8)} <= ${targetPrice.toFixed(8)} (${dropPercentage.toFixed(2)}% drop)`);
              
              rebuyCallback({
                triggered: true,
                currentPrice,
                basePrice: rebuyConfig.basePrice,
                targetPrice,
                actualDrop: dropPercentage,
                requiredDrop: rebuyConfig.dropPercentage,
                poolAddress,
                provider: name,
                timestamp: Date.now(),
                transactionHash: event.transactionHash,
                source: 'websocket-rebuy-trigger'
              });
            }

          } catch (error) {
            log(`⚠️ WebSocket (${name}): Error processing REBUY price event: ${error.message}`);
          }
        };

        wsProvider.on(swapFilter, swapListener);

        // Store listener for cleanup
        this.activePriceListeners.set(`${listenerId}-${index}`, {
          provider: wsProvider,
          filter: swapFilter,
          listener: swapListener,
          providerName: name,
          poolAddress
        });

        log(`📡 WebSocket (${name}): REBUY price listener established`);

      } catch (error) {
        log(`❌ Failed to setup REBUY price listener on ${name}: ${error.message}`);
      }
    });

    return listenerId;
  }

  /**
   * Calculate current pool price from reserves
   * @param {string} poolAddress - Pool address
   * @param {Object} provider - WebSocket provider
   * @returns {Promise<number|null>} Current price or null if failed
   */
  async calculatePoolPrice(poolAddress, provider) {
    try {
      const pairContract = new ethers.Contract(poolAddress, [
        'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
        'function token0() external view returns (address)',
        'function token1() external view returns (address)'
      ], provider);

      const [reserves, token0, token1] = await Promise.all([
        pairContract.getReserves(),
        pairContract.token0(),
        pairContract.token1()
      ]);

      // Determine which reserve is VIRTUAL (assuming token1 is VIRTUAL for now)
      // This would need to be configured per pool in real implementation
      const reserve0Formatted = parseFloat(ethers.formatUnits(reserves.reserve0, 18));
      const reserve1Formatted = parseFloat(ethers.formatUnits(reserves.reserve1, 18));

      // Price = VIRTUAL reserve / Token reserve
      // Assuming reserve1 is VIRTUAL and reserve0 is the token
      const price = reserve1Formatted / reserve0Formatted;

      return price;

    } catch (error) {
      log(`⚠️ Error calculating pool price: ${error.message}`);
      return null;
    }
  }

  /**
   * Get latest cached price for a pool
   * @param {string} poolAddress - Pool address
   * @returns {Object|null} Price data or null
   */
  getLatestPrice(poolAddress) {
    return this.priceCache.get(poolAddress) || null;
  }

  /**
   * Stop price monitoring
   * @param {string} listenerId - Listener ID from start*Monitoring methods
   */
  stopPriceMonitoring(listenerId) {
    for (const [key, listener] of this.activePriceListeners.entries()) {
      if (key.startsWith(listenerId)) {
        try {
          listener.provider.removeListener(listener.filter, listener.listener);
          this.activePriceListeners.delete(key);
          log(`🔇 WebSocket (${listener.providerName}): Stopped price monitoring (${listenerId})`);
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
      activeListeners: this.activePriceListeners.size,
      cachedPrices: this.priceCache.size,
      providerNames: this.providers.map(p => p.name)
    };
  }

  /**
   * Cleanup all price listeners and connections
   */
  async cleanup() {
    // Stop all price monitoring
    for (const [key] of this.activePriceListeners) {
      this.stopPriceMonitoring(key.split('-')[0]);
    }

    // Clear price cache
    this.priceCache.clear();

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
    
    log(`🧹 WebSocket Price Service cleaned up`);
  }
}

// Singleton instance for shared usage
export const wsPriceService = new WebSocketPriceService();

/**
 * Usage Examples:
 * 
 * // MMBot - Range trading with instant price alerts:
 * const priceRange = {
 *   buyThreshold: 0.00085,  // Buy when price drops to this level
 *   sellThreshold: 0.00095, // Sell when price rises to this level  
 *   basePrice: 0.0009      // Reference price
 * };
 * 
 * const listenerId = await wsPriceService.startPriceRangeMonitoring(
 *   poolAddress, 
 *   priceRange,
 *   (priceAlert) => {
 *     if (priceAlert.action === 'BUY') {
 *       // Execute buy order instantly
 *     } else if (priceAlert.action === 'SELL') {
 *       // Execute sell order instantly
 *     }
 *   }
 * );
 * 
 * // REBUY mode - Price drop detection:
 * const rebuyConfig = {
 *   basePrice: 0.0012,    // Price when tokens were sold
 *   dropPercentage: 30    // Wait for 30% drop before rebuying
 * };
 * 
 * const rebuyListenerId = await wsPriceService.startRebuyPriceMonitoring(
 *   poolAddress,
 *   rebuyConfig, 
 *   (rebuyAlert) => {
 *     if (rebuyAlert.triggered) {
 *       // Execute rebuy order instantly
 *     }
 *   }
 * );
 * 
 * // Cleanup when done:
 * wsPriceService.stopPriceMonitoring(listenerId);
 * wsPriceService.stopPriceMonitoring(rebuyListenerId);
 */ 