/**
 * WalletEncryption - Simple encryption module for wallet private keys
 * Uses the same encryption format as config.json
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import walletLogger from './walletLogger.js';

// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the config file with encryption parameters - consistent with other modules
// Use userData directory for persistent storage across updates
function getConfigPath() {
  try {
    // Simple fallback approach - avoid electron dependency in bot processes
    // Bot processes should use environment variables or relative paths
    if (typeof process !== 'undefined' && process.env.WALLETS_DB_PATH) {
      // Use the directory of WALLETS_DB_PATH for config.json
      return path.join(path.dirname(process.env.WALLETS_DB_PATH), 'config.json');
    } else {
      // Fallback to relative path
      return path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'config.json');
    }
  } catch (error) {
    // Final fallback
    return 'config.json';
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
   * Generate a secure password from the master password
   * @param {string} directPassword - Optional direct password to use
   * @returns {string} A password to use for encryption
   */
  static generateSecureKey(directPassword) {
    try {
      walletLogger.debug(`Generating secure key from password sources`);
      walletLogger.trace(`generateSecureKey called with direct password: ${directPassword ? 'Yes (length: ' + directPassword.length + ')' : 'No'}`);
      
      // Check each password source and log availability
      walletLogger.trace(`Environment variable password: ${process.env.MASTER_PASSWORD ? 'Available' : 'Missing'}`);
      walletLogger.trace(`Global context password: ${(typeof global !== 'undefined' && global.masterPassword) ? 'Available' : 'Missing'}`);
      
      // If direct password is provided, use it first
      if (directPassword) {
        walletLogger.debug('Using directly provided password parameter');
        walletLogger.trace(`Direct password first character: ${directPassword.charAt(0)}...`);
        walletLogger.trace(`Direct password hash: ${crypto.createHash('sha256').update(directPassword).digest('hex').substring(0, 8)}...`);
        return directPassword;
      }

      // If we have a master password in the environment, use that next
      if (process.env.MASTER_PASSWORD) {
        walletLogger.debug('Using master password from environment variables');
        walletLogger.trace(`Environment password first character: ${process.env.MASTER_PASSWORD.charAt(0)}...`);
        walletLogger.trace(`Environment password length: ${process.env.MASTER_PASSWORD.length}`);
        walletLogger.trace(`Environment password hash: ${crypto.createHash('sha256').update(process.env.MASTER_PASSWORD).digest('hex').substring(0, 8)}...`);
        return process.env.MASTER_PASSWORD;
      }

      // If running in Electron main process, check for global master password
      if (typeof global !== 'undefined' && global.masterPassword) {
        walletLogger.debug('Using master password from global context');
        walletLogger.trace(`Global password first character: ${global.masterPassword.charAt(0)}...`);
        walletLogger.trace(`Global password hash: ${crypto.createHash('sha256').update(global.masterPassword).digest('hex').substring(0, 8)}...`);
        return global.masterPassword;
      }
      
      // No fallbacks - if we can't find a master password, we shouldn't proceed
      walletLogger.error('NO MASTER PASSWORD FOUND ANYWHERE!');
      throw new Error('No master password available for wallet decryption');
    } catch (error) {
      walletLogger.error(`Error generating secure key: ${error.message}`);
      walletLogger.trace(`Full error stack: ${error.stack || error}`);
      throw error; // Re-throw to prevent silently using an incorrect key
    }
  }

  /**
   * Encrypt a private key
   * @param {string} privateKey - Private key to encrypt
   * @param {string} password - Optional password to use for encryption
   * @returns {Object} Encrypted private key object
   */
  static encryptPrivateKey(privateKey, password) {
    try {
      const params = this.getEncryptionParams();
      if (!params) {
        throw new Error('Could not get encryption parameters');
      }

      const encryptionPassword = this.generateSecureKey(password);
      
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
   * @param {string} password - Optional password to use for decryption
   * @returns {string|null} Decrypted private key or null if failed
   */
  static decryptPrivateKey(encryptedKey, password) {
    try {
      walletLogger.info('===== STARTING PRIVATE KEY DECRYPTION =====');
      walletLogger.debug(`Attempting to decrypt private key`);
      walletLogger.trace(`Direct password provided: ${password ? 'Yes (length: ' + password.length + ')' : 'No'}`);
      
      if (password) {
        walletLogger.trace(`Password first character: ${password.charAt(0)}...`);
        walletLogger.trace(`Password hash: ${crypto.createHash('sha256').update(password).digest('hex').substring(0, 8)}...`);
      }
      
      if (!encryptedKey || !encryptedKey.salt || !encryptedKey.iv || 
          !encryptedKey.data || !encryptedKey.authTag || !encryptedKey.method) {
        walletLogger.error(`Invalid encrypted key format: ${JSON.stringify(encryptedKey || 'null')}`);
        throw new Error('Invalid encrypted key format');
      }
      
      walletLogger.debug(`Encryption method: ${encryptedKey.method}`);
      walletLogger.trace(`Salt available (first 4 chars): ${encryptedKey.salt.substring(0, 4)}...`);
      walletLogger.trace(`IV available (first 4 chars): ${encryptedKey.iv.substring(0, 4)}...`);
      walletLogger.trace(`Auth tag available (first 4 chars): ${encryptedKey.authTag.substring(0, 4)}...`);
      
      const decryptionPassword = this.generateSecureKey(password);
      
      // Derive the same key using the stored salt
      walletLogger.debug(`Deriving key with salt: ${encryptedKey.salt.substring(0, 6)}...`);
      walletLogger.trace(`Using iterations: 100000, keylen: 32, digest: sha512`);
      
      let key;
      try {
        key = crypto.pbkdf2Sync(
          decryptionPassword, 
          encryptedKey.salt, 
          100000, 
          32, 
          'sha512'
        );
        walletLogger.debug(`Key derived successfully, length: ${key.length}`);
        // Log a key fingerprint (not the actual key) for debugging
        walletLogger.trace(`Key fingerprint: ${key[0].toString(16)}${key[1].toString(16)}${key[2].toString(16)}...`);
      } catch (deriveError) {
        walletLogger.error(`Key derivation error: ${deriveError.message}`);
        walletLogger.trace(`Full derivation error: ${deriveError.stack || deriveError}`);
        throw deriveError;
      }
      
      // Create decipher
      walletLogger.debug(`Creating decipher with method: ${encryptedKey.method}`);
      walletLogger.trace(`Using IV: ${encryptedKey.iv.substring(0, 6)}...`);
      
      let decipher;
      try {
        decipher = crypto.createDecipheriv(
          encryptedKey.method, 
          key, 
          Buffer.from(encryptedKey.iv, 'hex')
        );
        walletLogger.debug('Decipher created successfully');
      } catch (decipherError) {
        walletLogger.error(`Error creating decipher: ${decipherError.message}`);
        walletLogger.trace(`Full decipher error: ${decipherError.stack || decipherError}`);
        throw decipherError;
      }
      
      // Set auth tag for GCM mode
      try {
        walletLogger.debug(`Setting auth tag: ${encryptedKey.authTag.substring(0, 6)}...`);
        decipher.setAuthTag(Buffer.from(encryptedKey.authTag, 'hex'));
        walletLogger.debug('Auth tag set successfully');
      } catch (authError) {
        walletLogger.error(`Error setting auth tag: ${authError.message}`);
        walletLogger.trace(`Full auth tag error: ${authError.stack || authError}`);
        throw authError;
      }
      
      // Decrypt
      let decrypted;
      try {
        walletLogger.debug(`Decrypting data: ${encryptedKey.data.substring(0, 10)}...`);
        decrypted = decipher.update(encryptedKey.data, 'hex', 'utf8');
        walletLogger.debug('Update phase complete, calling final');
        decrypted += decipher.final('utf8');
        walletLogger.success(`Decryption succeeded! Key length: ${decrypted.length}`);
      } catch (decryptError) {
        walletLogger.error(`Decryption failed in final stage: ${decryptError.message}`);
        walletLogger.trace(`Full decryption error: ${decryptError.stack || decryptError}`);
        throw decryptError;
      }
      
      return decrypted;
    } catch (error) {
      walletLogger.error(`Error decrypting private key: ${error.message}`);
      walletLogger.trace(`Full error stack: ${error.stack || error}`);
      return null;
    }
  }
}

export { WalletEncryption };
