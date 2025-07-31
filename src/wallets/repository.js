import { ethers } from 'ethers';

/**
 * WalletRepository - Manages wallet instances and provides access methods
 */
export class WalletRepository {
  constructor() {
    this.wallets = [];
    this.walletMap = new Map(); // For quick address lookup
  }

  /**
   * Create wallet instances from configurations
   * @param {Array} configs - Array of wallet configurations
   * @param {ethers.Provider} provider - Ethereum provider
   * @returns {Array} Created wallet instances
   */
  createWallets(configs, provider) {
    this.clear(); // Reset existing wallets
    
    configs.forEach((config, index) => {
      try {
        // Skip wallets that were marked to skip decryption
        if (config._skippedDecryption) {
          console.log(`⏩ Skipping wallet creation for ${config.name || `Wallet ${index + 1}`} as it was not selected`);
          return; // Skip this wallet
        }
        
        // Skip if no private key is available
        if (!config.privateKey) {
          console.log(`⚠️ Cannot create wallet for ${config.name || `Wallet ${index + 1}`} - no private key available`);
          return; // Skip this wallet
        }
        
        // Create wallet from private key
        const wallet = new ethers.Wallet(config.privateKey, provider);
        
        // Enhance wallet with metadata
        wallet.name = config.name || `Wallet ${index + 1}`;
        wallet.index = index;
        wallet.id = config.id || index;
        wallet.metadata = {
          name: wallet.name,
          index: index,
          id: wallet.id,
          enabled: config.enabled !== false,
          _keyFromEnv: config._keyFromEnv || false,
          _keyDecrypted: config._keyDecrypted || false
        };
        
        this.wallets.push(wallet);
        this.walletMap.set(wallet.address.toLowerCase(), wallet);
        
      } catch (error) {
        console.error(`❌ Error creating wallet ${config.name || index + 1}: ${error.message}`);
      }
    });
    
    return this.wallets;
  }

  /**
   * Get all wallets
   * @returns {Array} All wallet instances
   */
  getAll() {
    return [...this.wallets];
  }

  /**
   * Get wallet by index (0-based)
   * @param {number} index - Wallet index
   * @returns {ethers.Wallet|null} Wallet instance or null
   */
  getByIndex(index) {
    return this.wallets[index] || null;
  }

  /**
   * Get wallet by address
   * @param {string} address - Wallet address
   * @returns {ethers.Wallet|null} Wallet instance or null
   */
  getByAddress(address) {
    return this.walletMap.get(address.toLowerCase()) || null;
  }

  /**
   * Get wallet by selector (B1, B2, etc.)
   * @param {string} selector - Wallet selector
   * @returns {ethers.Wallet|null} Wallet instance or null
   */
  getBySelector(selector) {
    const match = selector.match(/^B(\d+)$/i);
    if (match) {
      const index = parseInt(match[1]) - 1; // Convert to 0-based
      return this.getByIndex(index);
    }
    return null;
  }

  /**
   * Get multiple wallets by selectors
   * @param {Array<string>} selectors - Array of wallet selectors
   * @returns {Array} Array of wallet instances
   */
  getBySelectors(selectors) {
    return selectors
      .map(selector => this.getBySelector(selector))
      .filter(wallet => wallet !== null);
  }

  /**
   * Get wallet count
   * @returns {number} Number of wallets
   */
  count() {
    return this.wallets.length;
  }

  /**
   * Get all wallet addresses
   * @returns {Array<string>} Array of addresses
   */
  getAddresses() {
    return this.wallets.map(wallet => wallet.address);
  }

  /**
   * Get wallet summaries for display
   * @returns {Array} Array of wallet summaries
   */
  getSummaries() {
    return this.wallets.map((wallet, index) => ({
      index: index,
      selector: `B${index + 1}`,
      name: wallet.name,
      address: wallet.address,
      shortAddress: `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`,
      id: wallet.id,
      enabled: wallet.metadata?.enabled ?? true
    }));
  }

  /**
   * Find wallets matching a predicate
   * @param {Function} predicate - Filter function
   * @returns {Array} Matching wallets
   */
  find(predicate) {
    return this.wallets.filter(predicate);
  }

  /**
   * Check if repository has any wallets
   * @returns {boolean}
   */
  isEmpty() {
    return this.wallets.length === 0;
  }

  /**
   * Clear all wallets
   */
  clear() {
    this.wallets = [];
    this.walletMap.clear();
  }

  /**
   * Update wallet provider
   * @param {ethers.Provider} provider - New provider
   */
  updateProvider(provider) {
    this.wallets.forEach(wallet => {
      // Create new wallet instance with same private key but new provider
      const newWallet = wallet.connect(provider);
      
      // Preserve metadata
      newWallet.name = wallet.name;
      newWallet.index = wallet.index;
      newWallet.id = wallet.id;
      newWallet.metadata = wallet.metadata;
      
      // Update in place
      this.wallets[wallet.index] = newWallet;
      this.walletMap.set(wallet.address.toLowerCase(), newWallet);
    });
  }
} 