import crypto from 'crypto';

/**
 * Encryption utilities for securely storing sensitive data
 */
export class Encryption {
  /**
   * Generate a key from password using PBKDF2
   * 
   * @param {string} password - User password
   * @param {string} salt - Salt for key derivation (will be generated if not provided)
   * @returns {Object} Object containing derived key and salt
   */
  static deriveKeyFromPassword(password, salt = null) {
    // Generate salt if not provided
    if (!salt) {
      salt = crypto.randomBytes(16).toString('hex');
    }
    
    // Derive key using PBKDF2
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    
    return {
      key: key,
      salt: salt
    };
  }
  
  /**
   * Encrypt data using AES-256-GCM
   * 
   * @param {string} data - Data to encrypt
   * @param {Buffer} key - Encryption key
   * @returns {Object} Encrypted data with iv and auth tag
   */
  static encrypt(data, key) {
    // Generate initialization vector
    const iv = crypto.randomBytes(16);
    
    // Create cipher
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    // Encrypt data
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get auth tag
    const authTag = cipher.getAuthTag().toString('hex');
    
    return {
      iv: iv.toString('hex'),
      encrypted: encrypted,
      authTag: authTag
    };
  }
  
  /**
   * Decrypt data using AES-256-GCM
   * 
   * @param {Object} encryptedData - Encrypted data object with iv, encrypted content, and authTag
   * @param {Buffer} key - Decryption key
   * @returns {string} Decrypted data
   */
  static decrypt(encryptedData, key) {
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const authTag = Buffer.from(encryptedData.authTag, 'hex');
    
    // Create decipher
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    // Decrypt data
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
  
  /**
   * Encrypt a private key
   * 
   * @param {string} privateKey - Private key to encrypt
   * @param {string} password - User password
   * @returns {Object} Encrypted private key with salt and necessary metadata
   */
  static encryptPrivateKey(privateKey, password) {
    // Derive key from password
    const { key, salt } = this.deriveKeyFromPassword(password);
    
    // Encrypt private key
    const encrypted = this.encrypt(privateKey, key);
    
    // Return encrypted data with salt
    return {
      version: 1, // For future migrations
      method: 'aes-256-gcm',
      salt: salt,
      iv: encrypted.iv,
      data: encrypted.encrypted,
      authTag: encrypted.authTag
    };
  }
  
  /**
   * Decrypt a private key
   * 
   * @param {Object} encryptedKey - Encrypted private key object
   * @param {string} password - User password
   * @returns {string} Decrypted private key
   */
  static decryptPrivateKey(encryptedKey, password) {
    // Check version
    if (encryptedKey.version !== 1) {
      throw new Error(`Unsupported encryption version: ${encryptedKey.version}`);
    }
    
    // Derive key from password using stored salt
    const { key } = this.deriveKeyFromPassword(password, encryptedKey.salt);
    
    // Decrypt private key
    return this.decrypt({
      iv: encryptedKey.iv,
      encrypted: encryptedKey.data,
      authTag: encryptedKey.authTag
    }, key);
  }
  
  /**
   * Test if password can successfully decrypt the encrypted data
   * 
   * @param {Object} encryptedData - Encrypted data to test
   * @param {string} password - Password to test
   * @returns {boolean} True if password successfully decrypts data
   */
  static validatePassword(encryptedData, password) {
    try {
      this.decryptPrivateKey(encryptedData, password);
      return true;
    } catch (error) {
      return false;
    }
  }
}
