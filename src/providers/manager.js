import { ethers } from 'ethers';
import { configLoader } from '../config/loader.js';
import { PROVIDER_CONFIG } from '../config/constants.js';

/**
 * Provider manager for handling multiple RPC providers with failover
 */
export class ProviderManager {
  constructor() {
    this.httpProviders = [];
    this.wsProviders = [];
    this.failedProviders = new Set();
    this.lastResetTime = Date.now();
    this._initialized = false;
  }

  /**
   * Initialize providers from configuration
   */
  initialize() {
    if (this._initialized) {
      return;
    }

    const rpcConfigs = configLoader.getRpcConfigurations();
    
    // Initialize HTTP providers
    for (const config of rpcConfigs) {
      if (config.rpcUrl) {
        try {
          const provider = new ethers.JsonRpcProvider(config.rpcUrl);
          provider._providerName = config.name;
          this.httpProviders.push(provider);
          console.log(`✅ ${config.name} HTTP provider initialized`);
        } catch (error) {
          console.log(`❌ Failed to initialize ${config.name} HTTP provider: ${error.message}`);
        }
      } else {
        console.log(`⚠️ ${config.name} HTTP URL not configured`);
      }
    }

    // Initialize WebSocket providers
    for (const config of rpcConfigs) {
      if (config.wsUrl) {
        try {
          const wsProvider = new ethers.WebSocketProvider(config.wsUrl);
          wsProvider._providerName = config.name;
          this.wsProviders.push(wsProvider);
          console.log(`✅ ${config.name} WebSocket provider initialized`);
        } catch (error) {
          console.log(`❌ Failed to initialize ${config.name} WebSocket provider: ${error.message}`);
        }
      } else {
        console.log(`⚠️ ${config.name} WebSocket URL not configured`);
      }
    }

    // Validate at least one provider is available
    if (this.httpProviders.length === 0) {
      throw new Error('❌ No HTTP providers available! Please check your wallets.json configuration.');
    }

    console.log(`🚀 Multi-Provider Pool initialized with ${this.httpProviders.length} HTTP + ${this.wsProviders.length} WebSocket providers`);
    this._initialized = true;
  }

  /**
   * Get primary HTTP provider
   * @returns {ethers.JsonRpcProvider} Primary provider
   */
  getPrimaryProvider() {
    this._ensureInitialized();
    return this.httpProviders[0];
  }

  /**
   * Get primary WebSocket provider
   * @returns {ethers.WebSocketProvider|null} Primary WebSocket provider or null
   */
  getPrimaryWsProvider() {
    this._ensureInitialized();
    return this.wsProviders[0] || null;
  }

  /**
   * Get all available HTTP providers
   * @returns {Array<ethers.JsonRpcProvider>} Available providers
   */
  getAllProviders() {
    this._ensureInitialized();
    this._resetFailedProvidersIfNeeded();
    return this.httpProviders.filter(p => !this.failedProviders.has(p._providerName));
  }

  /**
   * Get all available WebSocket providers
   * @returns {Array<ethers.WebSocketProvider>} Available WebSocket providers
   */
  getAllWsProviders() {
    this._ensureInitialized();
    this._resetFailedProvidersIfNeeded();
    return this.wsProviders.filter(p => !this.failedProviders.has(p._providerName));
  }

  /**
   * Get random available provider
   * @returns {ethers.JsonRpcProvider} Random available provider
   */
  getRandomProvider() {
    const availableProviders = this.getAllProviders();
    
    if (availableProviders.length === 0) {
      // Reset failed providers if all are marked as failed
      this.failedProviders.clear();
      return this.httpProviders[0];
    }
    
    const randomIndex = Math.floor(Math.random() * availableProviders.length);
    return availableProviders[randomIndex];
  }

  /**
   * Get provider by preference order
   * @param {Array<string>} preferredProviders - Array of preferred provider names
   * @returns {ethers.JsonRpcProvider} Selected provider
   */
  getProviderByPreference(preferredProviders = PROVIDER_CONFIG.preferredProviders) {
    const availableProviders = this.getAllProviders();
    
    // Try to get preferred provider in order
    for (const preferredName of preferredProviders) {
      const provider = availableProviders.find(p => p._providerName === preferredName);
      if (provider) {
        return provider;
      }
    }
    
    // Fallback to random available provider
    return this.getRandomProvider();
  }

  /**
   * Mark provider as failed
   * @param {string} providerName - Provider name to mark as failed
   */
  markProviderFailed(providerName) {
    this.failedProviders.add(providerName);
    console.log(`⚠️ Provider ${providerName} marked as failed`);
  }

  /**
   * Reset failed providers after timeout
   * @private
   */
  _resetFailedProvidersIfNeeded() {
    const now = Date.now();
    if (now - this.lastResetTime > PROVIDER_CONFIG.failedProviderResetTime) {
      this.failedProviders.clear();
      this.lastResetTime = now;
      console.log(`🔄 Failed providers reset`);
    }
  }

  /**
   * Ensure providers are initialized
   * @private
   */
  _ensureInitialized() {
    if (!this._initialized) {
      this.initialize();
    }
  }

  /**
   * Get Alchemy configuration if available
   * @returns {Object} Alchemy configuration object
   */
  getAlchemyConfig() {
    const config = configLoader.getConfig();
    let alchemyApiKey = null;
    
    if (config.rpcUrl?.includes('alchemy.com')) {
      alchemyApiKey = config.rpcUrl.split('/').pop();
    }
    
    if (alchemyApiKey) {
      return {
        provider: 'Alchemy',
        apiKey: alchemyApiKey,
        baseUrl: 'https://base-mainnet.g.alchemy.com/v2/',
        available: true
      };
    }
    
    return {
      provider: null,
      apiKey: null,
      baseUrl: null,
      available: false
    };
  }

  /**
   * Test provider connectivity
   * @param {ethers.JsonRpcProvider} provider - Provider to test
   * @returns {Promise<boolean>} True if provider is working
   */
  async testProvider(provider) {
    try {
      const blockNumber = await provider.getBlockNumber();
      return blockNumber > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get provider health status
   * @returns {Promise<Object>} Health status of all providers
   */
  async getHealthStatus() {
    const status = {
      http: [],
      websocket: [],
      summary: {
        totalHttp: this.httpProviders.length,
        totalWs: this.wsProviders.length,
        healthyHttp: 0,
        healthyWs: 0
      }
    };

    // Test HTTP providers
    for (const provider of this.httpProviders) {
      const isHealthy = await this.testProvider(provider);
      status.http.push({
        name: provider._providerName,
        healthy: isHealthy,
        isFailed: this.failedProviders.has(provider._providerName)
      });
      if (isHealthy) {
        status.summary.healthyHttp++;
      }
    }

    // Test WebSocket providers
    for (const provider of this.wsProviders) {
      const isHealthy = await this.testProvider(provider);
      status.websocket.push({
        name: provider._providerName,
        healthy: isHealthy,
        isFailed: this.failedProviders.has(provider._providerName)
      });
      if (isHealthy) {
        status.summary.healthyWs++;
      }
    }

    return status;
  }

  /**
   * Clean up WebSocket connections
   */
  async cleanup() {
    for (const wsProvider of this.wsProviders) {
      try {
        if (wsProvider.removeAllListeners) {
          wsProvider.removeAllListeners();
        }
        if (wsProvider.destroy) {
          await wsProvider.destroy();
        }
      } catch (error) {
        console.error(`Error cleaning up ${wsProvider._providerName}: ${error.message}`);
      }
    }
  }
}

// Create singleton instance
export const providerManager = new ProviderManager(); 