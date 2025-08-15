import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import walletLogger from '../utils/walletLogger.js';

// Import wallet encryption utilities
// We need to use dynamic import for ESM compatibility
let WalletEncryption;

// Function to initialize the WalletEncryption module
async function initWalletEncryption() {
  try {
    // Try to import from relative path
    const module = await import('../utils/walletEncryption.js');
    WalletEncryption = module.WalletEncryption;
    return true;
  } catch (e) {
    try {
      // Try absolute path as fallback - must use file:// protocol for Windows paths in ESM
      const absPath = path.join(process.cwd(), 'src/utils/walletEncryption.js');
      // Convert Windows path to proper file:// URL format
      const fileUrl = new URL(`file://${absPath.replace(/\\/g, '/')}`);
      const module = await import(fileUrl.href);
      WalletEncryption = module.WalletEncryption;
      return true;
    } catch (e2) {
      console.error('Failed to load WalletEncryption module:', e2);
      return false;
    }
  }
}

// Initialize wallet encryption
initWalletEncryption().catch(err => console.error('WalletEncryption initialization failed:', err));

/**
 * WalletLoader - Responsible for loading wallet configurations from storage
 * Enhanced to handle encrypted wallet keys and decrypt them
 */
export class WalletLoader {
  constructor(dbPath = 'wallets.json') {
    // Fix: Use correct path for wallets.json - prioritize WALLETS_DB_PATH env var set by botLauncher
    if (process.env.WALLETS_DB_PATH) {
      // Use the path set by botLauncher (points to userData directory)
      this.dbPath = process.env.WALLETS_DB_PATH;
      console.log(`WalletLoader using WALLETS_DB_PATH: ${this.dbPath}`);
    } else if (dbPath === 'wallets.json') {
      // Fallback: try to construct userData path if we can detect Electron environment
      try {
        // Check if we have access to __dirname or similar indicators
        if (typeof __dirname !== 'undefined') {
          // We're likely in a Node.js context, use relative path as fallback
          this.dbPath = dbPath;
        } else {
          // Use relative path as final fallback
          this.dbPath = dbPath;
        }
      } catch (error) {
        // Final fallback to relative path
        this.dbPath = dbPath;
      }
      console.log(`WalletLoader using fallback path: ${this.dbPath}`);
    } else {
      // Custom path provided, use as-is
      this.dbPath = dbPath;
      console.log(`WalletLoader using custom path: ${this.dbPath}`);
    }
  }

  /**
   * Load the wallet database
   * @returns {Object} Database object or empty structure
   */
  loadDatabase() {
    try {
      if (!fs.existsSync(this.dbPath)) {
        return { wallets: [] };
      }

      const data = fs.readFileSync(this.dbPath, 'utf8');
      const parsed = JSON.parse(data);
      
      // Ensure wallets property exists
      if (!parsed.wallets) {
        parsed.wallets = [];
      }
      
      return parsed;
    } catch (error) {
      throw new Error(`Failed to load wallet database: ${error.message}`);
    }
  }

  /**
   * Load wallet configurations from database
   * @returns {Array} Array of wallet configurations with private keys
   */
  async loadWalletConfigs() {
    walletLogger.info('===== STARTING WALLET LOADING PROCESS =====');
    
    // Check for master password in environment
    const masterPassword = process.env.MASTER_PASSWORD;
    if (masterPassword) {
      walletLogger.debug(`Master password: Available`);
      // Removed sensitive logging of password content
    } else {
      walletLogger.error('No master password found in environment variables');
      return [];
    }
    
    // Check for command line arguments
    const rawArgs = process.argv;
    walletLogger.info('Checking BuyBot command line arguments:');
    walletLogger.info(`Raw arguments: ${rawArgs.join(' ')}`);
    
    // Store this for later use
    this.hasWalletTokenArg = rawArgs.includes('WALLETTOKEN');
    if (this.hasWalletTokenArg) {
      walletLogger.info('WALLETTOKEN argument detected in command line');
    }
    
    // Make sure WalletEncryption is initialized
    if (!WalletEncryption) {
      try {
        const initialized = await initWalletEncryption();
        if (!initialized) {
          console.warn('⚠️ WalletEncryption module could not be initialized - some wallet features may be unavailable');
        }
      } catch (error) {
        console.error('Failed to initialize WalletEncryption:', error);
      }
    }

    const db = this.loadDatabase();
    
    walletLogger.info('===== WALLET DATABASE DIAGNOSTICS =====');
    walletLogger.info(`Total wallets in DB: ${db.wallets ? db.wallets.length : 0}`);
    if (db.wallets && Array.isArray(db.wallets)) {
      walletLogger.info('Available wallet names:');
      db.wallets.forEach((w, idx) => {
        walletLogger.info(`[${idx}] ${w.name || 'unnamed'} (${w.address ? w.address.substring(0, 8) + '...' : 'no address'})`);
        walletLogger.debug(`    - Has privateKey: ${w.privateKey ? 'YES' : 'NO'}`);
        walletLogger.debug(`    - Has encryptedPrivateKey: ${w.encryptedPrivateKey ? 'YES' : 'NO'}`);
        walletLogger.debug(`    - Enabled: ${w.enabled !== false ? 'YES' : 'NO'}`);
        if (w.encryptedPrivateKey) {
          try {
            walletLogger.trace(`    - Encryption method: ${w.encryptedPrivateKey.method || 'unknown'}`);
            walletLogger.trace(`    - Salt: ${w.encryptedPrivateKey.salt ? w.encryptedPrivateKey.salt.substring(0, 8) + '...' : 'missing'}`);
            walletLogger.trace(`    - IV: ${w.encryptedPrivateKey.iv ? w.encryptedPrivateKey.iv.substring(0, 8) + '...' : 'missing'}`);
          } catch (e) {
            walletLogger.error(`    - Error inspecting encrypted key: ${e.message}`);
          }
        }
      });
      
      // Log a compact summary of wallets for easy reference
      const walletSummary = db.wallets.map((w, idx) => `${idx}: ${w.name} [${w.enabled !== false ? 'enabled' : 'disabled'}]`).join(', ');
      walletLogger.info(`Wallet summary: ${walletSummary}`);
    }
    
    if (!db.wallets || !Array.isArray(db.wallets)) {
      console.log('📜 No valid wallets found in database!');
      return [];
    }
    
    // First check environment variables for wallet keys (format: B1, B2, B3...)
    // Detect which wallets have environment variables set (B1, B2, etc.)
    walletLogger.info('===== DETECTING SELECTED WALLETS FROM ENVIRONMENT =====');
    const selectedWalletIndices = [];
    const envWalletKeys = {};
    
    // Check for WALLETTOKEN_SELECTED environment variable for explicit selection
    const walletTokenSelected = process.env.WALLETTOKEN_SELECTED;
    if (walletTokenSelected) {
      walletLogger.info(`Found WALLETTOKEN_SELECTED environment variable: ${walletTokenSelected}`);
      walletTokenSelected.split(',').forEach(indexStr => {
        try {
          const index = parseInt(indexStr.trim());
          if (!isNaN(index) && index >= 0) {
            selectedWalletIndices.push(index);
          }
        } catch (e) {
          walletLogger.error(`Error parsing wallet index: ${indexStr}`);
        }
      });
      walletLogger.info(`Parsed selected wallet indices: ${selectedWalletIndices.join(', ')}`);
    }
    
    // Log all environment variables for wallet detection
    walletLogger.debug('Checking for wallet private keys in environment variables:');
    let walletKeysFound = 0;
    for (let i = 0; i < 20; i++) { // Check up to 20 possible wallets
      const envKey = `B${i + 1}`;
      const privateKey = process.env[envKey];
      if (privateKey && privateKey.length > 0) {
        walletKeysFound++;
        walletLogger.info(`  ${envKey}: Private key found`);
        envWalletKeys[i] = privateKey;
        walletKeysFound++;
        
        // For diagnostic purposes, log minimal information (no key content)
        walletLogger.debug(`Found environment key ${envKey} for wallet index ${i}`);
        
        // Add to selected wallets if not already included
        if (!selectedWalletIndices.includes(i)) {
          selectedWalletIndices.push(i);
        }
      }
    }
    
    // Check for WALLETTOKEN in command line arguments as a special case
    if (this.hasWalletTokenArg && selectedWalletIndices.length === 0) {
      walletLogger.info('WALLETTOKEN argument found in command line but no wallet keys in environment');
      walletLogger.info('Will try to use all enabled wallets');
      
      // Read wallet configs and add all enabled wallets to the selected indices
      const dbData = await this.loadWalletDB();
      if (dbData && dbData.wallets) {
        dbData.wallets.forEach((wallet, idx) => {
          if (wallet.enabled !== false) {
            selectedWalletIndices.push(idx);
          }
        });
        walletLogger.info(`Added all enabled wallets to selection: ${selectedWalletIndices.join(', ') || 'NONE'}`);
      }
    }
    walletLogger.info(`Total wallet private keys found in environment: ${walletKeysFound}`);
    
    walletLogger.info(`Selected wallet indices from environment: ${selectedWalletIndices.join(', ') || 'NONE'}`);
    walletLogger.trace(`Environment keys found: ${Object.keys(envWalletKeys).length}`);
    
    // Check if any wallets were selected
    const anyWalletsSelected = selectedWalletIndices.length > 0;
    if (!anyWalletsSelected) {
      walletLogger.warn('No wallets were selected via environment variables (B1, B2, etc.).');
      walletLogger.warn('This likely means no wallets were selected in the UI or environment variables were not set correctly.');
      walletLogger.debug('Possible causes:');
      walletLogger.debug('1. No wallets were selected in the UI (missing B1, B2, etc. arguments)');
      walletLogger.debug('2. main.js failed to decrypt the selected wallets');
      walletLogger.debug('3. Environment variables were not passed correctly to the wallet loader');
      
      // Check for WALLETTOKEN argument - if present, we should try to use all wallets as fallback
      if (this.hasWalletTokenArg) {
        walletLogger.info('WALLETTOKEN argument found in command line - will try to use all enabled wallets as fallback');
        return await this.loadAllEnabledWallets(masterPassword);
      }
      return [];   
    }
    
    // Process wallets and decrypt private keys if needed
    walletLogger.info('===== PROCESSING WALLETS =====');
    const processedWallets = [];
    let enabledCount = 0;
    let selectedCount = 0;
    let envKeyCount = 0;
    let decryptedCount = 0;
    let skipCount = 0;
    let failCount = 0;
    
    for (let index = 0; index < db.wallets.length; index++) {
      const wallet = db.wallets[index];
      const walletName = wallet.name || `Wallet ${index+1}`;
      const walletAddr = wallet.address ? `${wallet.address.substring(0, 6)}...${wallet.address.substring(wallet.address.length-4)}` : 'no-address';
      
      walletLogger.debug(`Processing wallet [${index}] ${walletName} (${walletAddr})`);
      
      // Skip disabled wallets
      if (wallet.enabled === false) {
        walletLogger.info(`Skipping disabled wallet ${walletName} at index ${index}`);
        skipCount++;
        continue;
      }
      enabledCount++;
      
      // Check if this wallet is selected (has an environment variable)
      const isWalletSelected = selectedWalletIndices.includes(index);
      if (!isWalletSelected) {
        walletLogger.info(`Skipping unselected wallet ${walletName} at index ${index}`);
        processedWallets.push({
          ...wallet,
          _skippedDecryption: true
        });
        skipCount++;
        continue;
      }
      selectedCount++;
      
      walletLogger.debug(`Processing selected wallet ${walletName} at index ${index}`);
      
      // Check for environment variable override based on wallet position (B1, B2, etc.)
      const envPrivateKey = envWalletKeys[index];
      
      if (envPrivateKey) {
        walletLogger.success(`Using private key from environment for wallet ${walletName} [B${index+1}]`);
        
        // Create a new wallet object with the private key from environment variable
        processedWallets.push({
          ...wallet,
          privateKey: envPrivateKey,
          _keyFromEnv: true,
          _keyDecrypted: true // Mark as valid for use
        });
        envKeyCount++;
        continue;
      } else {
        walletLogger.warn(`No valid private key found in environment for wallet ${walletName} (index ${index})`);
      }
      
      // If wallet has a plain privateKey, use it
      if (wallet.privateKey) {
        walletLogger.success(`Using plaintext private key for wallet ${walletName}`);
        processedWallets.push(wallet);
        continue;
      }
      
      // If wallet has encryptedPrivateKey, try to decrypt it using masterPassword
      if (wallet.encryptedPrivateKey && WalletEncryption) {
        try {
          // Get master password from environment variable
          const masterPassword = process.env.MASTER_PASSWORD;
          
          // Show detailed wallet name comparison to help diagnose the issue
          walletLogger.trace(`Processing wallet named "${walletName}", wallet address: ${wallet.address}`);
          // Removed special test wallet check
          
          walletLogger.info(`Attempting to decrypt wallet ${walletName} with master password`);
          walletLogger.trace(`Password length: ${masterPassword ? masterPassword.length : 'MISSING'}`);
          walletLogger.trace(`Password hash: ${masterPassword ? crypto.createHash('sha256').update(masterPassword).digest('hex').substring(0, 8) + '...' : 'MISSING'}`);
          
          // Try to decrypt the private key - explicitly pass the master password
          walletLogger.trace(`Using master password for decryption`);
          // Use master password for decryption
          const decryptionPassword = masterPassword;
          const decryptedKey = WalletEncryption.decryptPrivateKey(wallet.encryptedPrivateKey, decryptionPassword);
          
          if (decryptedKey) {
            walletLogger.success(`Successfully decrypted private key for wallet ${walletName}`);
            processedWallets.push({
              ...wallet,
              privateKey: decryptedKey,
              _keyDecrypted: true
            });
            decryptedCount++;
            continue;
          } else {
            walletLogger.warn(`Failed to decrypt private key for wallet ${walletName}`);
            failCount++;
          }
        } catch (error) {
          walletLogger.error(`Error decrypting private key for wallet ${walletName}: ${error.message}`);
          walletLogger.trace(`Full error: ${error.stack || error}`);
          failCount++;
        }
      } else if (!wallet.encryptedPrivateKey) {
        walletLogger.warn(`Wallet ${walletName} has no encrypted private key`);
      } else if (!WalletEncryption) {
        walletLogger.error(`WalletEncryption module not available, cannot decrypt ${walletName}`);
      }
      
      walletLogger.warn(`Wallet ${walletName} has no usable private key`);
    }
    
    // Log wallet processing summary
    walletLogger.info('===== WALLET PROCESSING SUMMARY =====');
    walletLogger.info(`Total wallets: ${db.wallets.length}`);
    walletLogger.info(`Enabled wallets: ${enabledCount}`);
    walletLogger.info(`Selected wallets: ${selectedCount}`);
    walletLogger.info(`Environment keys used: ${envKeyCount}`);
    walletLogger.info(`Successfully decrypted: ${decryptedCount}`);
    walletLogger.info(`Skipped wallets: ${skipCount}`);
    walletLogger.info(`Failed decryption: ${failCount}`);
    walletLogger.info(`Final processed count: ${processedWallets.length}`);
    
    return processedWallets;
  }

  /**
   * Load all enabled wallets as fallback when no specific wallets are selected
   * @param {string} masterPassword - Master password for decryption
   * @returns {Array} Array of wallet configurations with private keys
   */
  async loadAllEnabledWallets(masterPassword) {
    // Read wallet database
    const dbData = await this.loadWalletDB();
    const walletConfigs = dbData.wallets || [];
    
    // Process only enabled wallets
    const processedWallets = [];
    walletLogger.info(`Found ${walletConfigs.length} total wallets in database`);
    let enabledCount = 0;
    
    for (let i = 0; i < walletConfigs.length; i++) {
      const config = walletConfigs[i];
      
      walletLogger.info(`Processing wallet ${config.name || i} (index ${i}):`);
      walletLogger.debug(`  Has key in environment: NO`);
      
      // Skip disabled wallets
      if (config.enabled === false) {
        walletLogger.debug(`  Should attempt decryption: NO - wallet is disabled`);
        continue;
      }
      
      enabledCount++;
      walletLogger.debug(`  Should attempt decryption: YES`);
      walletLogger.info(`No environment key found for ${config.name || i} - will attempt direct decryption`);
      
      // Try to decrypt
      const result = await this.decryptWalletConfig(config, masterPassword, i);
      if (result) {
        processedWallets.push(result);
      }
    }
    
    walletLogger.info(`Total enabled wallets found: ${enabledCount}`);
    
    return processedWallets;
  }

  /**
   * Decrypt wallet configuration using master password
   * @param {Object} walletConfig - Wallet configuration
   * @param {string} masterPassword - Master password for decryption
   * @param {number} index - Wallet index
   * @returns {Object|null} Decrypted wallet configuration or null on failure
   */
  async decryptWalletConfig(walletConfig, masterPassword, index) {
    try {
      if (!walletConfig || !walletConfig.encryptedPrivateKey) {
        walletLogger.error(`Invalid wallet config for index ${index} - missing encryptedPrivateKey`);
        return null;
      }
      
      // Use the provided master password for all wallets - removed special test wallet case
      const decryptionPassword = masterPassword;
      
      // Try to decrypt the private key
      walletLogger.debug(`Attempting to decrypt wallet ${walletConfig.name || index}`);
      const decryptedKey = WalletEncryption.decryptPrivateKey(walletConfig.encryptedPrivateKey, decryptionPassword);
      
      if (decryptedKey) {
        walletLogger.success(`Successfully decrypted wallet ${walletConfig.name || index}`);
        return {
          ...walletConfig,
          privateKey: decryptedKey,
          _keyDecrypted: true
        };
      } else {
        walletLogger.warn(`Failed to decrypt private key for wallet ${walletConfig.name || index}`);
        return null;
      }
    } catch (error) {
      walletLogger.error(`Error decrypting private key for wallet ${walletConfig.name || index}: ${error.message}`);
      walletLogger.trace(`Full error: ${error.stack || error}`);
      return null;
    }
  }

  /**
   * Check if wallet database exists
   * @returns {boolean}
   */
  databaseExists() {
    return fs.existsSync(this.dbPath);
  }

  /**
   * Get database stats
   * @returns {Promise<Object>} Promise that resolves to statistics about the wallet database
   */
  async getDatabaseStats() {
    if (!this.databaseExists()) {
      return { exists: false, walletCount: 0 };
    }

    try {
      const configs = await this.loadWalletConfigs();
      const envWallets = configs.filter(w => w._keyFromEnv).length;
      const decryptedWallets = configs.filter(w => w._keyDecrypted).length;

      return {
        exists: true,
        walletCount: configs.length,
        envWallets: envWallets,        // Count of wallets using env vars
        decryptedWallets: decryptedWallets, // Count of wallets decrypted directly
        dbPath: this.dbPath
      };
    } catch (error) {
      return {
        exists: true,
        walletCount: 0,
        error: error.message
      };
    }
  }
} 