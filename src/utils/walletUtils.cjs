/**
 * Wallet Utilities - Helper functions for wallet operations
 * Includes secure private key handling for blockchain transactions
 */
const fs = require('fs');
const path = require('path');
const { WalletEncryption } = require('./walletEncryption.cjs');

// Path to the wallets database
const WALLETS_DB_PATH = path.join(__dirname, '..', '..', 'wallets.json');

/**
 * Get a wallet from the wallets database by ID
 * @param {string} walletId - The ID of the wallet to retrieve
 * @returns {Object|null} The wallet object or null if not found
 */
function getWalletById(walletId) {
  try {
    if (!fs.existsSync(WALLETS_DB_PATH)) {
      console.error('Wallets database file not found');
      return null;
    }
    
    const dbData = JSON.parse(fs.readFileSync(WALLETS_DB_PATH, 'utf8'));
    if (!dbData || !dbData.wallets) {
      console.error('Invalid wallets database format');
      return null;
    }
    
    return dbData.wallets.find(w => w.id === walletId) || null;
  } catch (error) {
    console.error('Error reading wallet database:', error);
    return null;
  }
}

/**
 * Get a wallet by name from the wallets database
 * @param {string} walletName - The name of the wallet to retrieve
 * @returns {Object|null} The wallet object or null if not found
 */
function getWalletByName(walletName) {
  try {
    if (!fs.existsSync(WALLETS_DB_PATH)) {
      console.error('Wallets database file not found');
      return null;
    }
    
    const dbData = JSON.parse(fs.readFileSync(WALLETS_DB_PATH, 'utf8'));
    if (!dbData || !dbData.wallets) {
      console.error('Invalid wallets database format');
      return null;
    }
    
    return dbData.wallets.find(w => w.name === walletName) || null;
  } catch (error) {
    console.error('Error reading wallet database:', error);
    return null;
  }
}

/**
 * Get all wallets from the database
 * @returns {Array} Array of wallet objects
 */
function getAllWallets() {
  try {
    if (!fs.existsSync(WALLETS_DB_PATH)) {
      console.error('Wallets database file not found');
      return [];
    }
    
    const dbData = JSON.parse(fs.readFileSync(WALLETS_DB_PATH, 'utf8'));
    if (!dbData || !dbData.wallets) {
      console.error('Invalid wallets database format');
      return [];
    }
    
    return dbData.wallets;
  } catch (error) {
    console.error('Error reading wallet database:', error);
    return [];
  }
}

/**
 * Get the private key for a wallet, handling decryption if necessary
 * This is the key function to use before signing any blockchain transactions
 * 
 * @param {Object|string} walletIdOrObject - Either a wallet object, wallet ID, or wallet name
 * @param {boolean} preferEncrypted - If true, will try to decrypt the encrypted key even if plaintext exists
 * @returns {string|null} The private key or null if it couldn't be retrieved
 */
function getWalletPrivateKey(walletIdOrObject, preferEncrypted = true) {
  try {
    // Determine if we were given a wallet object or an ID/name string
    let wallet = null;
    
    if (typeof walletIdOrObject === 'string') {
      // Try to find by ID first, then by name if ID fails
      wallet = getWalletById(walletIdOrObject) || getWalletByName(walletIdOrObject);
    } else if (typeof walletIdOrObject === 'object' && walletIdOrObject !== null) {
      wallet = walletIdOrObject;
    }
    
    if (!wallet) {
      console.error('Wallet not found:', walletIdOrObject);
      return null;
    }
    
    // If we prefer encrypted keys and we have one, decrypt it
    if (preferEncrypted && wallet.encryptedPrivateKey) {
      console.log(`Decrypting private key for wallet: ${wallet.name || wallet.id}`);
      const decrypted = WalletEncryption.decryptPrivateKey(wallet.encryptedPrivateKey);
      
      if (decrypted) {
        return decrypted;
      } else {
        console.warn('Failed to decrypt private key, falling back to plaintext if available');
      }
    }
    
    // Fall back to plaintext key if available
    if (wallet.privateKey) {
      return wallet.privateKey;
    }
    
    console.error('No usable private key found for wallet:', wallet.name || wallet.id);
    return null;
  } catch (error) {
    console.error('Error getting wallet private key:', error);
    return null;
  }
}

module.exports = {
  getWalletById,
  getWalletByName,
  getAllWallets,
  getWalletPrivateKey
};
