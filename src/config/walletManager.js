import { ethers } from 'ethers';
import { configLoader } from './loader.js';

/**
 * Wallet manager for handling wallet operations
 */
export class WalletManager {
  constructor() {
    this._wallets = null;
    this._addressMap = new Map();
  }

  /**
   * Initialize wallet manager
   */
  initialize() {
    this._wallets = configLoader.getTradingWallets();
    this._buildAddressMap();
    this.autoResolveAddresses();
    
    console.log(`🔑 Loaded ${this._wallets.length} trading wallet keys from wallets.json`);
  }

  /**
   * Build address map for quick lookups
   * @private
   */
  _buildAddressMap() {
    this._addressMap.clear();
    
    for (const wallet of this._wallets) {
      if (wallet.address && ethers.isAddress(wallet.address)) {
        this._addressMap.set(wallet.address.toLowerCase(), wallet);
      }
    }
  }

  /**
   * Get trading wallet private keys
   * @returns {Array<string>} Array of private keys
   */
  getTradingWalletKeys() {
    if (!this._wallets) {
      this.initialize();
    }
    return this._wallets.map(w => w.privateKey);
  }

  /**
   * Get all trading wallets
   * @returns {Array<Object>} Array of wallet objects
   */
  getTradingWallets() {
    if (!this._wallets) {
      this.initialize();
    }
    return this._wallets;
  }

  /**
   * Get wallet by address
   * @param {string} address - Wallet address
   * @returns {Object|null} Wallet object or null
   */
  getWalletByAddress(address) {
    if (!address || !ethers.isAddress(address)) {
      return null;
    }
    
    return this._addressMap.get(address.toLowerCase()) || null;
  }

  /**
   * Create ethers Wallet instances with provider
   * @param {Object} provider - Ethers provider
   * @returns {Array<ethers.Wallet>} Array of wallet instances
   */
  createWalletInstances(provider) {
    const wallets = [];
    
    for (const walletData of this.getTradingWallets()) {
      try {
        const cleanPrivateKey = walletData.privateKey.startsWith('0x') ? 
          walletData.privateKey : 
          `0x${walletData.privateKey}`;
        
        const wallet = new ethers.Wallet(cleanPrivateKey, provider);
        wallet.metadata = {
          name: walletData.name || `Wallet ${walletData.id}`,
          id: walletData.id,
          enabled: walletData.enabled !== false
        };
        
        wallets.push(wallet);
      } catch (error) {
        console.error(`❌ Failed to create wallet instance for ${walletData.name}: ${error.message}`);
      }
    }
    
    return wallets;
  }

  /**
   * Auto-resolve wallet addresses from private keys
   * Updates addresses in the database if needed
   */
  autoResolveAddresses() {
    let addressesResolved = 0;
    let updated = false;
    
    for (const wallet of this._wallets) {
      if (wallet.privateKey && (!wallet.address || !ethers.isAddress(wallet.address))) {
        try {
          // Clean private key format
          const cleanPrivateKey = wallet.privateKey.startsWith('0x') ? 
            wallet.privateKey : 
            `0x${wallet.privateKey}`;
          
          // Create wallet instance to derive address
          const walletInstance = new ethers.Wallet(cleanPrivateKey);
          const derivedAddress = walletInstance.address;
          
          console.log(`🔧 Auto-resolved address for ${wallet.name}: ${derivedAddress}`);
          wallet.address = derivedAddress;
          addressesResolved++;
          updated = true;
        } catch (error) {
          console.log(`❌ Failed to resolve address for ${wallet.name}: ${error.message}`);
        }
      }
    }
    
    // Update address map after resolution
    if (updated) {
      this._buildAddressMap();
    }
    
    // Save updated addresses
    if (addressesResolved > 0) {
      const db = configLoader.getDatabase();
      if (configLoader.save(db)) {
        console.log(`✅ Auto-resolved ${addressesResolved} wallet addresses and saved to wallets.json`);
      }
    }
  }

  /**
   * Validate wallet configuration
   * @param {string} mode - Bot mode (JEET, BUY, SELL, etc.)
   * @throws {Error} If validation fails
   */
  validateForMode(mode) {
    const walletCount = this.getTradingWalletKeys().length;
    
    if (walletCount === 0) {
      throw new Error(`At least one trading wallet is required for ${mode} mode`);
    }
    
    if (mode === 'JEET') {
      const virtualAddress = configLoader.getVirtualTokenAddress();
      const jeetConfig = configLoader.getJeetConfig();
      
      if (!jeetConfig.genesisContract) {
        throw new Error('GENESIS_CONTRACT is required for JEET mode');
      }
      
      if (!virtualAddress) {
        throw new Error('VIRTUAL_TOKEN_ADDRESS is required for JEET mode');
      }
    }
  }

  /**
   * Get wallet summary information
   * @returns {Object} Summary object
   */
  getSummary() {
    const wallets = this.getTradingWallets();
    return {
      total: wallets.length,
      enabled: wallets.filter(w => w.enabled !== false).length,
      disabled: wallets.filter(w => w.enabled === false).length,
      withAddresses: wallets.filter(w => w.address && ethers.isAddress(w.address)).length
    };
  }
}

// Create singleton instance
export const walletManager = new WalletManager(); 