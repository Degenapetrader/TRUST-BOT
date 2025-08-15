// secureAdapterIntegration.js
// This file integrates the secure adapter with the main process

/**
 * Updates the environment with decrypted wallet private keys when available through the secureAdapter
 * @param {Object} env - Environment variables object
 * @param {Object} wallet - Wallet object containing id, privateKey, etc.
 * @param {number} index - Wallet index
 * @returns {void} - Updates env object in place with decrypted keys
 */
function integrateSecureWalletKey(env, wallet, index) {
  // Default to plaintext key if available
  let privateKey = wallet.privateKey;
  
  // If secureAdapter is available, try to get decrypted key
  if (global.secureAdapter && wallet.id) {
    try {
      const secureKey = global.secureAdapter.getPrivateKeyById(wallet.id);
      if (secureKey) {
        privateKey = secureKey;
        console.log(`Using securely decrypted key for wallet ${wallet.name || wallet.id}`);
      }
    } catch (err) {
      console.error(`Error getting secure key for wallet ${wallet.id}:`, err.message);
    }
  }
  
  // Add key to environment if wallet is enabled
  if (wallet.enabled && privateKey) {
    env[`B${index + 1}`] = privateKey;
  }
}

/**
 * Updates the environment with decrypted bridging private keys when available through the secureAdapter
 * @param {Object} env - Environment variables object
 * @param {Object} bridgingConfig - Bridging configuration object
 * @returns {void} - Updates env object in place with decrypted keys
 */
function integrateSecureBridgingKeys(env, bridgingConfig) {
  // Default to plaintext keys
  let solanaSourceKey = bridgingConfig.solanaSourcePrivateKey;
  let baseSourceKey = bridgingConfig.baseSourcePrivateKey;
  
  // If secureAdapter is available, try to get decrypted bridging keys
  if (global.secureAdapter) {
    try {
      const secureKeys = global.secureAdapter.getBridgingKeys();
      if (secureKeys) {
        if (secureKeys.solanaSourceKey) solanaSourceKey = secureKeys.solanaSourceKey;
        if (secureKeys.baseSourceKey) baseSourceKey = secureKeys.baseSourceKey;
        console.log('Using securely decrypted bridging keys');
      }
    } catch (err) {
      console.error('Error getting secure bridging keys:', err.message);
    }
  }
  
  // Set environment variables
  env.SOLANA_SOURCE_PRIVATE_KEY = solanaSourceKey;
  env.BASE_SOURCE_PRIVATE_KEY = baseSourceKey;
  env.SOL_WALLET_1_ADDRESS = bridgingConfig.solWallet1Address;
}

module.exports = {
  integrateSecureWalletKey,
  integrateSecureBridgingKeys
};
