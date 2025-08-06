const { SecureConfigManager } = require('./secureConfig.cjs');
const path = require('path');
const fs = require('fs');

/**
 * SecureAdapter - Bridge between legacy wallet storage and secure encrypted storage
 */
class SecureAdapter {
  /**
   * Create a new SecureAdapter
   * @param {string} legacyPath - Path to legacy wallets.json file
   * @param {string} securePath - Path to new secure config file
   */
  constructor(legacyPath, securePath) {
    this.legacyPath = legacyPath;
    this.securePath = securePath;
    this.secureConfig = new SecureConfigManager(securePath);
    this.initialized = false;
    this.masterPassword = null;
    this.migrationComplete = false;
  }

  /**
   * Initialize the adapter
   * @returns {boolean} True if initialization was successful
   */
  initialize() {
    if (this.initialized) return true;
    
    try {
      this.secureConfig.initialize();
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('Error initializing secure adapter:', error);
      return false;
    }
  }

  /**
   * Check if secure config is initialized with a password
   * @returns {boolean} True if secure config is using encryption
   */
  isSecureConfigActive() {
    if (!this.initialized) this.initialize();
    return this.secureConfig.config.security && 
           this.secureConfig.config.security.isEncrypted;
  }

  /**
   * Set the master password
   * @param {string} password - Master password
   * @param {boolean} isNew - Whether this is a new password setup
   * @returns {boolean} True if password was set successfully
   */
  setMasterPassword(password, isNew = false) {
    if (!this.initialized) this.initialize();
    this.masterPassword = password;
    return this.secureConfig.setMasterPassword(password, isNew);
  }

  /**
   * Validate the master password
   * @param {string} password - Password to validate
   * @returns {boolean} True if password is valid
   */
  validatePassword(password) {
    if (!this.initialized) this.initialize();
    return this.secureConfig.validateMasterPassword(password);
  }

  /**
   * Read from legacy wallets.json file
   * @returns {Object|null} Legacy wallet data or null on failure
   */
  readLegacyDB() {
    try {
      if (!fs.existsSync(this.legacyPath)) {
        return null;
      }
      
      const data = fs.readFileSync(this.legacyPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading legacy database:', error);
      return null;
    }
  }

  /**
   * Write to legacy wallets.json file
   * @param {Object} data - Data to write
   * @returns {boolean} True if write was successful
   */
  writeLegacyDB(data) {
    try {
      fs.writeFileSync(this.legacyPath, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error('Error writing legacy database:', error);
      return false;
    }
  }

  /**
   * Migrate from legacy storage to secure storage
   * @returns {Object} Result with success status and migration details
   */
  migrateFromLegacy() {
    if (!this.masterPassword) {
      return {
        success: false,
        error: 'Master password not set'
      };
    }
    
    try {
      // Read legacy database
      const legacyData = this.readLegacyDB();
      if (!legacyData) {
        return {
          success: false,
          error: 'Legacy database not found or invalid'
        };
      }
      
      let migratedWallets = 0;
      
      // Migrate config settings
      if (legacyData.config) {
        Object.entries(legacyData.config).forEach(([key, value]) => {
          this.secureConfig.setSetting(key, value);
        });
      }
      
      // Migrate wallets
      if (legacyData.wallets && Array.isArray(legacyData.wallets)) {
        legacyData.wallets.forEach(wallet => {
          if (wallet.privateKey) {
            const result = this.secureConfig.addWallet(wallet);
            if (result.success) {
              migratedWallets++;
            }
          }
        });
      }
      
      // Remember that migration is complete
      this.migrationComplete = true;
      
      return {
        success: true,
        migratedWallets,
        message: `Successfully migrated ${migratedWallets} wallets`
      };
    } catch (error) {
      return {
        success: false,
        error: `Migration error: ${error.message}`
      };
    }
  }

  /**
   * Get wallet data compatible with the legacy format
   * @returns {Object} Legacy-compatible wallet data
   */
  getLegacyCompatibleData() {
    if (!this.initialized) this.initialize();
    
    // If we haven't migrated or set a password, just return the legacy data
    if (!this.masterPassword || !this.secureConfig.config.security.isEncrypted) {
      return this.readLegacyDB();
    }
    
    try {
      // Get wallets with decrypted private keys
      const wallets = this.secureConfig.getWallets(true);
      const settings = this.secureConfig.config.settings || {};
      
      // Format in legacy structure
      return {
        config: settings,
        wallets: wallets.map(w => ({
          id: w.id,
          name: w.name,
          privateKey: w.privateKey,
          enabled: w.enabled !== false
        }))
      };
    } catch (error) {
      console.error('Error getting legacy compatible data:', error);
      // Fallback to legacy data
      return this.readLegacyDB();
    }
  }

  /**
   * Save a wallet in the secure storage while maintaining legacy compatibility
   * @param {Object} wallet - Wallet data
   * @returns {Object} Result with success status
   */
  saveWallet(wallet) {
    if (!this.initialized) this.initialize();
    
    try {
      let result;
      
      // Save to secure storage if we have a password
      if (this.masterPassword && this.secureConfig.config.security.isEncrypted) {
        result = this.secureConfig.addWallet(wallet);
      }
      
      // Also save to legacy storage for backward compatibility
      const legacyData = this.readLegacyDB() || { config: {}, wallets: [] };
      legacyData.wallets.push(wallet);
      this.writeLegacyDB(legacyData);
      
      return result || { success: true, wallet };
    } catch (error) {
      return {
        success: false,
        error: `Failed to save wallet: ${error.message}`
      };
    }
  }

  /**
   * Update a wallet in secure storage and legacy storage
   * @param {string} id - Wallet ID
   * @param {Object} updates - Wallet updates
   * @returns {Object} Result with success status
   */
  updateWallet(id, updates) {
    if (!this.initialized) this.initialize();
    
    try {
      let result;
      
      // Update in secure storage if we have a password
      if (this.masterPassword && this.secureConfig.config.security.isEncrypted) {
        result = this.secureConfig.updateWallet(id, updates);
      }
      
      // Update in legacy storage for backward compatibility
      const legacyData = this.readLegacyDB();
      if (legacyData && legacyData.wallets) {
        const walletIndex = legacyData.wallets.findIndex(w => w.id === id);
        if (walletIndex >= 0) {
          legacyData.wallets[walletIndex] = {
            ...legacyData.wallets[walletIndex],
            ...updates
          };
          this.writeLegacyDB(legacyData);
        }
      }
      
      return result || { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to update wallet: ${error.message}`
      };
    }
  }

  /**
   * Delete a wallet from secure storage and legacy storage
   * @param {string} id - Wallet ID
   * @returns {Object} Result with success status
   */
  deleteWallet(id) {
    if (!this.initialized) this.initialize();
    
    try {
      let result;
      
      // Delete from secure storage if we have a password
      if (this.masterPassword && this.secureConfig.config.security.isEncrypted) {
        result = this.secureConfig.deleteWallet(id);
      }
      
      // Delete from legacy storage for backward compatibility
      const legacyData = this.readLegacyDB();
      if (legacyData && legacyData.wallets) {
        legacyData.wallets = legacyData.wallets.filter(w => w.id !== id);
        this.writeLegacyDB(legacyData);
      }
      
      return result || { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete wallet: ${error.message}`
      };
    }
  }

  /**
   * Save configuration settings
   * @param {Object} config - Configuration settings
   * @returns {Object} Result with success status
   */
  saveConfig(config) {
    if (!this.initialized) this.initialize();
    
    try {
      // Save to secure config if we have a password
      if (this.masterPassword && this.secureConfig.config.security.isEncrypted) {
        Object.entries(config).forEach(([key, value]) => {
          this.secureConfig.setSetting(key, value);
        });
      }
      
      // Save to legacy storage for backward compatibility
      const legacyData = this.readLegacyDB() || { config: {}, wallets: [] };
      legacyData.config = {
        ...legacyData.config,
        ...config
      };
      this.writeLegacyDB(legacyData);
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to save config: ${error.message}`
      };
    }
  }

  /**
   * Get wallet private key by ID
   * @param {string} id - Wallet ID
   * @returns {string|null} Private key or null if not found
   */
  getPrivateKeyById(id) {
    if (!this.initialized) this.initialize();
    
    try {
      // Try to get from secure storage first
      if (this.masterPassword && this.secureConfig.config.security.isEncrypted) {
        const wallet = this.secureConfig.getWalletById(id, true);
        if (wallet && wallet.privateKey) {
          return wallet.privateKey;
        }
      }
      
      // Fallback to legacy storage
      const legacyData = this.readLegacyDB();
      if (legacyData && legacyData.wallets) {
        const wallet = legacyData.wallets.find(w => w.id === id);
        if (wallet && wallet.privateKey) {
          return wallet.privateKey;
        }
      }
      
      return null;
    } catch (error) {
      console.error(`Error getting private key for wallet ${id}:`, error);
      return null;
    }
  }

  /**
   * Reset the secure config (for account reset/forgot password)
   * This clears all encrypted wallet data
   */
  resetSecureConfig() {
    try {
      // Create a backup of the secure config file if it exists
      if (fs.existsSync(this.securePath)) {
        const backupPath = `${this.securePath}.bak_${Date.now()}`;
        fs.copyFileSync(this.securePath, backupPath);
        console.log(`Created backup of secure config at ${backupPath}`);
      }
      
      // Reset the secure config
      this.secureConfig.resetConfig();
      this.masterPassword = null;
      this.migrationComplete = false;
      console.log('Secure config reset complete');
      
      // Also clear the wallets.json wallets section
      this._clearWalletsJsonWallets();
      
      return true;
    } catch (error) {
      console.error('Error resetting secure config:', error);
      throw error;
    }
  }
  
  /**
   * Clear the wallets array in wallets.json file during password reset
   * @private
   */
  _clearWalletsJsonWallets() {
    try {
      // Create a backup of wallets.json if it exists
      if (fs.existsSync(this.legacyPath)) {
        const backupPath = `${this.legacyPath}.bak_${Date.now()}`;
        fs.copyFileSync(this.legacyPath, backupPath);
        console.log(`Created backup of wallets.json at ${backupPath}`);
      }
      
      // Read current wallets.json data
      const legacyData = this.readLegacyDB() || { config: {}, wallets: [], bridging: {} };
      
      // Clear only the wallets array, preserve config and bridging sections
      const walletsCount = legacyData.wallets ? legacyData.wallets.length : 0;
      legacyData.wallets = [];
      
      // Write back the updated data
      const writeSuccess = this.writeLegacyDB(legacyData);
      
      if (writeSuccess) {
        console.log(`✅ Cleared ${walletsCount} wallet(s) from wallets.json during password reset`);
      } else {
        console.error('❌ Failed to write cleared wallets.json file');
      }
      
    } catch (error) {
      console.error('❌ Error clearing wallets.json wallets section:', error);
      // Don't throw the error - password reset should continue even if this fails
    }
  }

  /**
   * Set insecure mode (for skipping password authentication)
   * @param {boolean} insecureMode - Whether to enable insecure mode
   */
  setInsecureMode(insecureMode) {
    this.insecureMode = insecureMode;
    console.log(`Insecure mode ${insecureMode ? 'enabled' : 'disabled'}`);
    return true;
  }
}

module.exports = { SecureAdapter };
