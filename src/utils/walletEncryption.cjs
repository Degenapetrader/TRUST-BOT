/**
 * WalletEncryption - Simple encryption module for wallet private keys
 * Uses the same encryption format as config.json
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Path to the config file with encryption parameters - use userData location
function getConfigPath() {
  try {
    const { app } = require('electron');
    if (app && app.getPath) {
      return path.join(app.getPath('userData'), 'config.json');
    } else {
      // Fallback to relative path if electron not available
      return path.join(__dirname, '..', '..', 'config.json');
    }
  } catch (error) {
    // Final fallback
    return path.join(__dirname, '..', '..', 'config.json');
  }
}

const CONFIG_PATH = getConfigPath();

/**
 * WalletEncryption utility for encrypting and decrypting wallet private keys
 * Uses the security parameters from config.json
 */
class WalletEncryption {
  /**
   * Get the encryption parameters from config.json
   * @returns {Object|null} Encryption parameters or null if not found
   */
  static getEncryptionParams() {
    try {
      if (!fs.existsSync(CONFIG_PATH)) {
        console.error('Config file not found');
        return null;
      }
      
      const configData = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (!configData.security || !configData.security.isEncrypted || !configData.security.encryptedTest) {
        console.error('Encryption not set up in config.json');
        return null;
      }
      
      return {
        method: configData.security.encryptedTest.method || 'aes-256-gcm',
        version: configData.security.encryptedTest.version || 1
      };
    } catch (error) {
      console.error('Error reading config.json:', error);
      return null;
    }
  }

  /**
   * Generate a secure password from the config file's encryption parameters
   * @deprecated This method is deprecated and should not be used directly.
   * Instead, use the master password provided by the user.
   * @returns {string} A password to use for encryption
   */
  static generateSecureKey() {
    console.warn('WARNING: Using deprecated generateSecureKey method. Please use master password instead.');
    
    // Check for global master password first
    if (global.masterPassword) {
      console.log('Using global master password');
      return global.masterPassword;
    }
    
    try {
      const configData = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (!configData.security || !configData.security.encryptedTest) {
        console.error('Security configuration missing, using emergency fallback');
        return 'TRUSTBOT_EMERGENCY_KEY'; // Fallback if config doesn't have security
      }

      // Use the existing salt as part of our key
      const salt = configData.security.encryptedTest.salt || '';
      const key = 'TRUSTBOT_' + salt;
      return key;
    } catch (error) {
      console.error('Error generating secure key:', error);
      return 'TRUSTBOT_EMERGENCY_KEY';
    }
  }

  /**
   * Encrypt a private key
   * @param {string} privateKey - Private key to encrypt
   * @param {string} password - Password to use for encryption (defaults to generated key if not provided)
   * @returns {Object} Encrypted private key object
   */
  static encryptPrivateKey(privateKey, password) {
    try {
      const params = this.getEncryptionParams();
      if (!params) {
        throw new Error('Could not get encryption parameters');
      }

      // Always require a password to be provided - this is more secure
      if (!password && !global.masterPassword) {
        console.error('No password provided for encryption and no global master password available');
        throw new Error('Password required for encryption');
      }
      
      // Use provided password or fall back to global master password
      const encryptionPassword = password || global.masterPassword;
      
      // Generate random salt and iv
      const salt = crypto.randomBytes(16).toString('hex');
      const iv = crypto.randomBytes(16).toString('hex');
      
      // Derive encryption key from password and salt
      const key = crypto.pbkdf2Sync(encryptionPassword, salt, 100000, 32, 'sha512');
      
      // Create cipher
      const cipher = crypto.createCipheriv(
        params.method, 
        key, 
        Buffer.from(iv, 'hex')
      );
      
      // Encrypt the private key
      let encrypted = cipher.update(privateKey, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Get auth tag for GCM mode
      const authTag = cipher.getAuthTag().toString('hex');
      
      // Return the encrypted key in the same format as config.json uses
      return {
        version: params.version,
        method: params.method,
        salt: salt,
        iv: iv,
        data: encrypted,
        authTag: authTag
      };
    } catch (error) {
      console.error('Error encrypting private key:', error);
      return null;
    }
  }

  /**
   * Decrypt an encrypted private key
   * @param {Object} encryptedKey - Encrypted private key object
   * @param {string} password - Password to use for decryption (defaults to generated key if not provided)
   * @returns {string|null} Decrypted private key or null if failed
   */
  static decryptPrivateKey(encryptedKey, password) {
    try {
      // Check encrypted key format
      if (!encryptedKey || !encryptedKey.salt || !encryptedKey.iv || 
          !encryptedKey.data || !encryptedKey.authTag || !encryptedKey.method) {
        console.error('Invalid encrypted key format');
        return null;
      }
      
      // Always require a password to be provided - this is more secure
      if (!password && !global.masterPassword) {
        console.error('No password provided for decryption and no global master password available');
        throw new Error('Password required for decryption');
      }
      
      // Use provided password or fall back to global master password
      const decryptionPassword = password || global.masterPassword;
      
      // Derive the same key using the stored salt
      const key = crypto.pbkdf2Sync(
        decryptionPassword, 
        encryptedKey.salt, 
        100000, 
        32, 
        'sha512'
      );
      
      // Create decipher
      const decipher = crypto.createDecipheriv(
        encryptedKey.method, 
        key, 
        Buffer.from(encryptedKey.iv, 'hex')
      );
      
      // Set auth tag for GCM mode
      decipher.setAuthTag(Buffer.from(encryptedKey.authTag, 'hex'));
      
      // Decrypt
      let decrypted = decipher.update(encryptedKey.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Error decrypting private key:', error);
      return null;
    }
  }
}

module.exports = { WalletEncryption };
