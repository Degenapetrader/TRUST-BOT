import fs from 'fs';
import { ethers } from 'ethers';
import { NETWORK_DEFAULTS, JEET_DEFAULTS } from './constants.js';

// Helper function to decode base64 encoded RPC URLs
function decodeRpcUrl(encodedUrl) {
  if (!encodedUrl) return '';
  try {
    // Check if it's already a valid URL (starts with http/https)
    if (encodedUrl.startsWith('http://') || encodedUrl.startsWith('https://') || encodedUrl.startsWith('wss://') || encodedUrl.startsWith('ws://')) {
      return encodedUrl;
    }
    // Decode base64 encoded URL
    return Buffer.from(encodedUrl, 'base64').toString('utf8');
  } catch (error) {
    console.warn(`⚠️ Failed to decode RPC URL: ${encodedUrl}`);
    return encodedUrl; // Return as-is if decoding fails
  }
}

/**
 * Configuration loader for wallets.json database
 */
export class ConfigLoader {
  constructor(configPath = null) {
    this.configPath = configPath || process.env.WALLETS_DB_PATH || 'wallets.json';
    this._db = null;
    this._config = null;
  }

  /**
   * Load and validate the wallets database
   * @returns {Object} The loaded database
   * @throws {Error} If loading or validation fails
   */
  load() {
    try {
      // Check if file exists
      if (!fs.existsSync(this.configPath)) {
        throw new Error(`Wallet database not found: ${this.configPath}`);
      }

      // Read and parse file
      const data = fs.readFileSync(this.configPath, 'utf8');
      this._db = JSON.parse(data);

      // Validate structure
      this._validateDatabase();

      // Cache config section
      this._config = this._db.config;

      console.log('✅ Main winbot configuration loaded from wallets.json');
      return this._db;
    } catch (error) {
      console.error(`❌ Error loading wallet database: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validate the database structure
   * @private
   * @throws {Error} If validation fails
   */
  _validateDatabase() {
    if (!this._db) {
      throw new Error('Database not loaded');
    }

    if (!this._db.config) {
      throw new Error('Invalid wallet database structure: missing config section');
    }

    // Validate required config fields
    const requiredFields = ['chainId'];
    for (const field of requiredFields) {
      if (this._db.config[field] === undefined) {
        console.warn(`⚠️ Missing required config field: ${field}, using default`);
      }
    }

    // Validate wallets structure if present
    if (this._db.wallets && !Array.isArray(this._db.wallets)) {
      throw new Error('Invalid wallet database structure: wallets must be an array');
    }
  }

  /**
   * Get the full database
   * @returns {Object} The database object
   */
  getDatabase() {
    if (!this._db) {
      this.load();
    }
    return this._db;
  }

  /**
   * Get the config section
   * @returns {Object} The config object
   */
  getConfig() {
    if (!this._config) {
      this.load();
    }
    return this._config;
  }

  /**
   * Get network configuration
   * @returns {Object} Network configuration
   */
  getNetworkConfig() {
    const config = this.getConfig();
    return {
      name: config.networkName || NETWORK_DEFAULTS.name,
      chainId: config.chainId || NETWORK_DEFAULTS.chainId,
      currency: config.currency || NETWORK_DEFAULTS.currency
    };
  }

  /**
   * Get JEET configuration
   * @returns {Object} JEET bot configuration
   */
  getJeetConfig() {
    const config = this.getConfig();
    return {
      genesisContract: config.genesisContract || '',
      trustswapContract: config.trustswapContract || JEET_DEFAULTS.trustswapContract,
      uniswapRouter: config.uniswapRouter || JEET_DEFAULTS.uniswapRouter,
      slippageBasisPoints: config.slippageBasisPoints || JEET_DEFAULTS.slippageBasisPoints,
      pollIntervalMs: config.pollIntervalMs || JEET_DEFAULTS.pollIntervalMs
    };
  }

  /**
   * Get virtual token address with checksumming
   * @returns {string|undefined} Checksummed virtual token address
   */
  getVirtualTokenAddress() {
    const config = this.getConfig();
    return config.virtualTokenAddress ? 
      ethers.getAddress(config.virtualTokenAddress) : 
      undefined;
  }

  /**
   * Get RPC configurations
   * @returns {Array<Object>} Array of RPC configurations
   */
  getRpcConfigurations() {
    const config = this.getConfig();
    const rpcConfigs = [];

    // Add primary providers with base64 decoding
    if (config.rpcUrl) {
      rpcConfigs.push({
        name: 'Alchemy',
        rpcUrl: decodeRpcUrl(config.rpcUrl),
        wsUrl: decodeRpcUrl(config.wsUrl)
      });
    }

    if (config.rpcUrlQuickNode) {
      rpcConfigs.push({
        name: 'QuickNode/BlastAPI',
        rpcUrl: decodeRpcUrl(config.rpcUrlQuickNode),
        wsUrl: decodeRpcUrl(config.wsUrlQuickNode)
      });
    }

    if (config.rpcUrlInfura) {
      rpcConfigs.push({
        name: 'Infura',
        rpcUrl: decodeRpcUrl(config.rpcUrlInfura),
        wsUrl: decodeRpcUrl(config.wsUrlInfura)
      });
    }

    // Add dynamic RPCs with base64 decoding
    if (config.dynamicRpcs && Array.isArray(config.dynamicRpcs)) {
      config.dynamicRpcs.forEach((rpc, index) => {
        if (rpc.enabled !== false && rpc.rpcUrl) {
          rpcConfigs.push({
            name: rpc.name || `R${index + 1}`,
            rpcUrl: decodeRpcUrl(rpc.rpcUrl),
            wsUrl: decodeRpcUrl(rpc.wsUrl)
          });
        }
      });
    }

    return rpcConfigs;
  }

  /**
   * Get enabled trading wallets
   * @returns {Array<Object>} Array of wallet objects with privateKey and metadata
   */
  getTradingWallets() {
    const db = this.getDatabase();
    const wallets = [];

    if (!db.wallets || !Array.isArray(db.wallets)) {
      console.warn('⚠️ No wallets array found in wallets.json');
      return wallets;
    }

    for (const wallet of db.wallets) {
      if (wallet.privateKey && wallet.enabled !== false) {
        wallets.push({
          ...wallet,
          privateKey: wallet.privateKey
        });
      }
    }

    return wallets;
  }

  /**
   * Get trading wallet private keys only
   * @returns {Array<string>} Array of private keys
   */
  getTradingWalletKeys() {
    return this.getTradingWallets().map(w => w.privateKey);
  }

  /**
   * Save the database back to file
   * @param {Object} db - Database object to save
   * @returns {boolean} Success status
   */
  save(db = null) {
    try {
      const dataToSave = db || this._db;
      if (!dataToSave) {
        throw new Error('No database to save');
      }

      fs.writeFileSync(this.configPath, JSON.stringify(dataToSave, null, 2));
      return true;
    } catch (error) {
      console.error(`❌ Failed to save database: ${error.message}`);
      return false;
    }
  }

  /**
   * Reload configuration from file
   */
  reload() {
    this._db = null;
    this._config = null;
    return this.load();
  }
}

// Create singleton instance
export const configLoader = new ConfigLoader(); 