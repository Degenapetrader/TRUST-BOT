import fs from 'fs';
import path from 'path';
import { Encryption } from './encryption.js';

/**
 * SecureConfigManager - Manages secure configuration storage and retrieval
 */
export class SecureConfigManager {
  /**
   * Create a new SecureConfigManager instance
   * @param {string} configPath - Path to the configuration file
   */
  constructor(configPath = 'config.json') {
    this.configPath = configPath;
    this.config = null;
    this.masterPassword = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the configuration manager
   * Creates a default configuration if none exists
   * @returns {boolean} True if initialization successful
   */
  initialize() {
    try {
      if (!fs.existsSync(this.configPath)) {
        // Try to copy from config.example.json first
        // .example files are always in app bundle, user files are in userData
        const { app } = require('electron');
        const configExamplePath = app.isPackaged 
          ? path.join(process.resourcesPath, 'app.asar.unpacked', 'config.example.json')
          : path.join(path.dirname(this.configPath), 'config.example.json');
        
        if (fs.existsSync(configExamplePath)) {
          try {
            fs.copyFileSync(configExamplePath, this.configPath);
            console.log('✅ [SECURE-CONFIG] Created config.json from config.example.json');
            this.loadConfig();
            this.isInitialized = true;
            return true;
          } catch (error) {
            console.warn('⚠️ [SECURE-CONFIG] Failed to copy config.example.json, creating default:', error.message);
          }
        }
        
        // Fallback to creating default configuration programmatically
        const defaultConfig = {
          settings: {
            theme: 'dark',
            showNotifications: true,
            autoUpdateTokens: true,
            logLevel: 'info'
          },
          security: {
            isEncrypted: false,
            encryptedTest: null,
            lastAccess: new Date().toISOString()
          },
          wallets: []
        };
        
        this.config = defaultConfig;
        this.saveConfig();
        console.log('✅ [SECURE-CONFIG] Created config.json with default data');
      } else {
        // Load existing configuration
        this.loadConfig();
      }
      
      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('Failed to initialize config:', error);
      return false;
    }
  }

  /**
   * Load the configuration from disk
   * @returns {Object|null} The loaded configuration or null on failure
   */
  loadConfig() {
    try {
      const data = fs.readFileSync(this.configPath, 'utf8');
      this.config = JSON.parse(data);
      return this.config;
    } catch (error) {
      console.error('Error loading configuration:', error);
      return null;
    }
  }

  /**
   * Save the configuration to disk
   * @returns {boolean} True if save was successful
   */
  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      return true;
    } catch (error) {
      console.error('Error saving configuration:', error);
      return false;
    }
  }

  /**
   * Set master password and initialize encryption
   * @param {string} password - Master password
   * @param {boolean} isNewPassword - Whether this is a new password setup
   * @returns {boolean} True if password was set successfully
   */
  setMasterPassword(password, isNewPassword = false) {
    try {
      this.masterPassword = password;
      
      // If this is a new password setup, create an encrypted test value
      if (isNewPassword || !this.config.security.encryptedTest) {
        const testData = {
          message: 'If you can read this, encryption is working properly',
          timestamp: new Date().toISOString()
        };
        
        const encryptedTest = Encryption.encryptPrivateKey(
          JSON.stringify(testData),
          password
        );
        
        this.config.security.encryptedTest = encryptedTest;
        this.config.security.isEncrypted = true;
        this.saveConfig();
      }
      
      return true;
    } catch (error) {
      console.error('Error setting master password:', error);
      return false;
    }
  }

  /**
   * Validate the master password against the stored encrypted test
   * @param {string} password - Password to validate
   * @returns {boolean} True if password is valid
   */
  validateMasterPassword(password) {
    if (!this.config.security.isEncrypted || !this.config.security.encryptedTest) {
      // No encryption set up yet
      return true;
    }
    
    try {
      return Encryption.validatePassword(
        this.config.security.encryptedTest,
        password
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Get a setting value
   * @param {string} key - Setting key
   * @param {any} defaultValue - Default value if setting doesn't exist
   * @returns {any} The setting value
   */
  getSetting(key, defaultValue = null) {
    if (!this.config || !this.config.settings) {
      return defaultValue;
    }
    
    return this.config.settings[key] !== undefined 
      ? this.config.settings[key] 
      : defaultValue;
  }

  /**
   * Set a setting value
   * @param {string} key - Setting key
   * @param {any} value - Setting value
   * @returns {boolean} True if setting was saved successfully
   */
  setSetting(key, value) {
    if (!this.config) {
      this.initialize();
    }
    
    if (!this.config.settings) {
      this.config.settings = {};
    }
    
    this.config.settings[key] = value;
    return this.saveConfig();
  }

  /**
   * Add a new wallet with encrypted private key
   * @param {Object} wallet - Wallet configuration
   * @returns {Object} Result with success status and wallet data
   */
  addWallet(wallet) {
    if (!this.masterPassword) {
      throw new Error('Master password not set');
    }
    
    try {
      // Clone the wallet object
      const newWallet = { ...wallet };
      
      // Encrypt the private key
      if (newWallet.privateKey) {
        newWallet.encryptedPrivateKey = Encryption.encryptPrivateKey(
          newWallet.privateKey,
          this.masterPassword
        );
        
        // Remove plaintext private key
        delete newWallet.privateKey;
      }
      
      // Add wallet to configuration
      if (!this.config.wallets) {
        this.config.wallets = [];
      }
      
      // Generate ID if not provided
      if (!newWallet.id) {
        newWallet.id = Date.now().toString();
      }
      
      this.config.wallets.push(newWallet);
      this.saveConfig();
      
      return { success: true, wallet: newWallet };
    } catch (error) {
      return { 
        success: false, 
        error: `Failed to add wallet: ${error.message}`
      };
    }
  }

  /**
   * Get all wallets
   * @param {boolean} includePrivateKeys - Whether to decrypt and include private keys
   * @returns {Array} Array of wallet configurations
   */
  getWallets(includePrivateKeys = false) {
    if (!this.config || !this.config.wallets) {
      return [];
    }
    
    if (!includePrivateKeys) {
      return this.config.wallets;
    }
    
    // Return wallets with decrypted private keys
    if (!this.masterPassword) {
      throw new Error('Master password required to decrypt private keys');
    }
    
    return this.config.wallets.map(wallet => {
      const walletWithKey = { ...wallet };
      
      if (wallet.encryptedPrivateKey) {
        try {
          walletWithKey.privateKey = Encryption.decryptPrivateKey(
            wallet.encryptedPrivateKey,
            this.masterPassword
          );
        } catch (error) {
          console.error(`Failed to decrypt wallet ${wallet.name || wallet.id}:`, error);
        }
      }
      
      return walletWithKey;
    });
  }

  /**
   * Get a specific wallet by ID
   * @param {string} id - Wallet ID
   * @param {boolean} includePrivateKey - Whether to decrypt and include private key
   * @returns {Object|null} Wallet configuration or null if not found
   */
  getWalletById(id, includePrivateKey = false) {
    if (!this.config || !this.config.wallets) {
      return null;
    }
    
    const wallet = this.config.wallets.find(w => w.id === id);
    if (!wallet) {
      return null;
    }
    
    if (!includePrivateKey) {
      return { ...wallet };
    }
    
    // Return wallet with decrypted private key
    if (!this.masterPassword) {
      throw new Error('Master password required to decrypt private key');
    }
    
    const walletWithKey = { ...wallet };
    
    if (wallet.encryptedPrivateKey) {
      try {
        walletWithKey.privateKey = Encryption.decryptPrivateKey(
          wallet.encryptedPrivateKey,
          this.masterPassword
        );
      } catch (error) {
        console.error(`Failed to decrypt wallet ${wallet.name || wallet.id}:`, error);
      }
    }
    
    return walletWithKey;
  }

  /**
   * Update an existing wallet
   * @param {string} id - Wallet ID
   * @param {Object} updates - Properties to update
   * @returns {Object} Result with success status and updated wallet
   */
  updateWallet(id, updates) {
    if (!this.config || !this.config.wallets) {
      return { success: false, error: 'No wallets found' };
    }
    
    const walletIndex = this.config.wallets.findIndex(w => w.id === id);
    if (walletIndex === -1) {
      return { success: false, error: 'Wallet not found' };
    }
    
    try {
      // Clone the wallet and apply updates
      const updatedWallet = { 
        ...this.config.wallets[walletIndex],
        ...updates
      };
      
      // Handle private key encryption
      if (updates.privateKey && this.masterPassword) {
        updatedWallet.encryptedPrivateKey = Encryption.encryptPrivateKey(
          updates.privateKey,
          this.masterPassword
        );
        
        // Remove plaintext private key
        delete updatedWallet.privateKey;
      }
      
      // Update wallet in configuration
      this.config.wallets[walletIndex] = updatedWallet;
      this.saveConfig();
      
      return { success: true, wallet: updatedWallet };
    } catch (error) {
      return {
        success: false,
        error: `Failed to update wallet: ${error.message}`
      };
    }
  }

  /**
   * Delete a wallet by ID
   * @param {string} id - Wallet ID
   * @returns {Object} Result with success status
   */
  deleteWallet(id) {
    if (!this.config || !this.config.wallets) {
      return { success: false, error: 'No wallets found' };
    }
    
    const walletIndex = this.config.wallets.findIndex(w => w.id === id);
    if (walletIndex === -1) {
      return { success: false, error: 'Wallet not found' };
    }
    
    try {
      // Remove wallet from configuration
      this.config.wallets.splice(walletIndex, 1);
      this.saveConfig();
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete wallet: ${error.message}`
      };
    }
  }

  /**
   * Change the master password
   * @param {string} currentPassword - Current master password
   * @param {string} newPassword - New master password
   * @returns {Object} Result with success status
   */
  changeMasterPassword(currentPassword, newPassword) {
    // Validate current password
    if (!this.validateMasterPassword(currentPassword)) {
      return { success: false, error: 'Current password is incorrect' };
    }
    
    try {
      // Re-encrypt all wallet private keys with new password
      if (this.config.wallets && this.config.wallets.length > 0) {
        for (let i = 0; i < this.config.wallets.length; i++) {
          const wallet = this.config.wallets[i];
          
          if (wallet.encryptedPrivateKey) {
            // Decrypt with old password
            const privateKey = Encryption.decryptPrivateKey(
              wallet.encryptedPrivateKey,
              currentPassword
            );
            
            // Re-encrypt with new password
            wallet.encryptedPrivateKey = Encryption.encryptPrivateKey(
              privateKey,
              newPassword
            );
          }
        }
      }
      
      // Update the encryption test value
      const testData = {
        message: 'If you can read this, encryption is working properly',
        timestamp: new Date().toISOString()
      };
      
      this.config.security.encryptedTest = Encryption.encryptPrivateKey(
        JSON.stringify(testData),
        newPassword
      );
      
      // Update last modified timestamp
      this.config.security.lastAccess = new Date().toISOString();
      
      // Save configuration
      this.saveConfig();
      
      // Update the current master password
      this.masterPassword = newPassword;
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to change master password: ${error.message}`
      };
    }
  }

  /**
   * Migrate plain text private keys to encrypted format
   * @returns {Object} Result with success status and count of migrated wallets
   */
  migrateToEncrypted() {
    if (!this.masterPassword) {
      return { 
        success: false, 
        error: 'Master password must be set before migration'
      };
    }
    
    try {
      let migratedCount = 0;
      
      // Process each wallet
      if (this.config.wallets && this.config.wallets.length > 0) {
        for (let i = 0; i < this.config.wallets.length; i++) {
          const wallet = this.config.wallets[i];
          
          // Only migrate wallets with plaintext private keys
          if (wallet.privateKey && !wallet.encryptedPrivateKey) {
            // Encrypt the private key
            wallet.encryptedPrivateKey = Encryption.encryptPrivateKey(
              wallet.privateKey,
              this.masterPassword
            );
            
            // Remove plaintext private key
            delete wallet.privateKey;
            migratedCount++;
          }
        }
      }
      
      // Mark as encrypted
      this.config.security.isEncrypted = true;
      
      // Save configuration
      this.saveConfig();
      
      return { 
        success: true, 
        migratedCount: migratedCount 
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to migrate wallets: ${error.message}`
      };
    }
  }
}
