// Secure Wallet Management
const fs = require('fs');
const path = require('path');
const { Encryption } = require('./encryption.cjs');
const { SecureConfigManager } = require('./secureConfig.cjs');

/**
 * SecureWalletManager - Manages encrypted wallets
 */
class SecureWalletManager {
  /**
   * Create a new SecureWalletManager
   * @param {string} configPath - Path to the configuration file
   */
  constructor(configPath = 'config.json') {
    this.configPath = configPath;
    this.secureConfig = new SecureConfigManager(configPath);
    this.masterPassword = null;
  }

  /**
   * Initialize the wallet manager
   * @returns {boolean} Success or failure
   */
  initialize() {
    try {
      this.secureConfig.initialize();
      return true;
    } catch (error) {
      console.error('Failed to initialize wallet manager:', error);
      return false;
    }
  }

  /**
   * Set the master password
   * @param {string} password - Master password
   * @returns {boolean} Success or failure
   */
  setMasterPassword(password) {
    try {
      this.masterPassword = password;
      const result = this.secureConfig.validateMasterPassword(password);
      return result;
    } catch (error) {
      console.error('Error setting master password:', error);
      return false;
    }
  }

  /**
   * Add a new wallet with encrypted private key
   * @param {string} name - Wallet name
   * @param {string} privateKey - Private key (unencrypted)
   * @param {string} address - Ethereum address
   * @returns {object} Result object with success status
   */
  addWallet(name, privateKey, address) {
    if (!this.masterPassword) {
      return {
        success: false,
        message: 'Master password not set'
      };
    }

    try {
      // Load the current config
      this.secureConfig.loadConfig();

      // Encrypt the private key
      const encryptedKey = Encryption.encryptPrivateKey(privateKey, this.masterPassword);

      // Generate a unique ID
      const id = Date.now();

      // Create wallet object
      const wallet = {
        id,
        name,
        address,
        encryptedKey,
        enabled: true,
        dateAdded: new Date().toISOString()
      };

      // Add to wallets array
      if (!this.secureConfig.config.wallets) {
        this.secureConfig.config.wallets = [];
      }
      this.secureConfig.config.wallets.push(wallet);

      // Save the config
      this.secureConfig.saveConfig();

      return {
        success: true,
        walletId: id,
        message: 'Wallet added successfully'
      };
    } catch (error) {
      console.error('Error adding wallet:', error);
      return {
        success: false,
        message: `Failed to add wallet: ${error.message}`
      };
    }
  }

  /**
   * Get all wallets (without decrypted private keys)
   * @returns {Array} List of wallets
   */
  getWallets() {
    try {
      this.secureConfig.loadConfig();
      
      if (!this.secureConfig.config.wallets) {
        return [];
      }

      // Return wallets without exposing encrypted keys
      return this.secureConfig.config.wallets.map(wallet => ({
        id: wallet.id,
        name: wallet.name,
        address: wallet.address,
        enabled: wallet.enabled,
        hasKey: !!wallet.encryptedKey,
        dateAdded: wallet.dateAdded
      }));
    } catch (error) {
      console.error('Error getting wallets:', error);
      return [];
    }
  }

  /**
   * Get wallet private key (decrypted)
   * @param {number} walletId - ID of the wallet
   * @returns {string|null} Decrypted private key or null on failure
   */
  getWalletPrivateKey(walletId) {
    if (!this.masterPassword) {
      return null;
    }

    try {
      this.secureConfig.loadConfig();
      
      if (!this.secureConfig.config.wallets) {
        return null;
      }

      const wallet = this.secureConfig.config.wallets.find(w => w.id === walletId);
      if (!wallet || !wallet.encryptedKey) {
        return null;
      }

      // Decrypt the private key
      return Encryption.decryptPrivateKey(wallet.encryptedKey, this.masterPassword);
    } catch (error) {
      console.error('Error getting wallet private key:', error);
      return null;
    }
  }

  /**
   * Delete a wallet
   * @param {number} walletId - ID of the wallet to delete
   * @returns {boolean} Success or failure
   */
  deleteWallet(walletId) {
    try {
      this.secureConfig.loadConfig();
      
      if (!this.secureConfig.config.wallets) {
        return false;
      }

      const initialLength = this.secureConfig.config.wallets.length;
      this.secureConfig.config.wallets = this.secureConfig.config.wallets.filter(
        wallet => wallet.id !== walletId
      );

      if (this.secureConfig.config.wallets.length === initialLength) {
        return false; // No wallet was removed
      }

      this.secureConfig.saveConfig();
      return true;
    } catch (error) {
      console.error('Error deleting wallet:', error);
      return false;
    }
  }
}

module.exports = { SecureWalletManager };
