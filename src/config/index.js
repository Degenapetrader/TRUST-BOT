import { ethers } from 'ethers';

// Import all modules
import { 
  ERC20_ABI, 
  STRATEGY_CONFIG, 
  DEFAULT_BOT_CONFIG,
  DEFAULT_GAS_CONFIG,
  NETWORK_DEFAULTS,
  JEET_DEFAULTS
} from './constants.js';

import { configLoader } from './loader.js';
import { walletManager } from './walletManager.js';
import { providerManager } from '../providers/manager.js';
import { 
  executeRpcWithFallback, 
  executeTransactionWithReplacementFee 
} from '../providers/transactionExecutor.js';
import { 
  TokenUtils,
  getTokenContract,
  getVirtualTokenContract,
  getTrustTokenContract
} from './tokenUtils.js';

// Initialize all managers
configLoader.load();
walletManager.initialize();
providerManager.initialize();

// Export constants
export { ERC20_ABI, STRATEGY_CONFIG };

// Export configuration values (backward compatibility)
export const walletsDB = configLoader.getDatabase();
export const VIRTUAL_TOKEN_ADDRESS = configLoader.getVirtualTokenAddress();
export const NETWORK = configLoader.getNetworkConfig();
export const JEET_CONFIG = configLoader.getJeetConfig();
export const BOT_CONFIG = DEFAULT_BOT_CONFIG;
export const GAS_CONFIG = DEFAULT_GAS_CONFIG;

// Export wallet keys (backward compatibility)
export const TRADING_WALLET_KEYS = walletManager.getTradingWalletKeys();
export const WALLET_PRIVATE_KEYS = TRADING_WALLET_KEYS; // Legacy alias

// Export provider instances (backward compatibility)
export const provider = providerManager.getPrimaryProvider();
export const wsProvider = providerManager.getPrimaryWsProvider();

// Export RPC pool for backward compatibility
export const rpcPool = {
  providers: providerManager.httpProviders,
  wsProviders: providerManager.wsProviders,
  currentIndex: 0,
  failedProviders: providerManager.failedProviders,
  lastResetTime: providerManager.lastResetTime
};

// Export provider functions
export const getAllProviders = () => providerManager.getAllProviders();
export const getAllWsProviders = () => providerManager.getAllWsProviders();
export const getRandomProvider = () => providerManager.getRandomProvider();
export const markProviderFailed = (name) => providerManager.markProviderFailed(name);
export const getProviderByPreference = (prefs) => providerManager.getProviderByPreference(prefs);
export const getAlchemyConfig = () => providerManager.getAlchemyConfig();

// Export transaction functions
export { executeRpcWithFallback, executeTransactionWithReplacementFee };

// Export token utilities
export { 
  TokenUtils,
  getTokenContract, 
  getVirtualTokenContract, 
  getTrustTokenContract 
};

// Bot mode configuration (backward compatibility)
export const BOT_MODE = 'BUY'; // GUI handles mode selection
export const TRADING_STRATEGY = 'DEFAULT';

// Validate configuration for JEET mode if needed
if (process.env.BOT_MODE === 'JEET' || BOT_MODE === 'JEET') {
  try {
    walletManager.validateForMode('JEET');
  } catch (error) {
    console.error(`❌ Configuration validation failed: ${error.message}`);
    throw error;
  }
}

// Log configuration summary
const networkConfig = configLoader.getNetworkConfig();
const walletSummary = walletManager.getSummary();

console.log(`🔑 Loaded ${walletSummary.total} trading wallet keys from wallets.json`);
console.log(`🌐 Network: ${networkConfig.name} (Chain ID: ${networkConfig.chainId})`);
console.log(`💰 Virtual Token: ${VIRTUAL_TOKEN_ADDRESS || 'Not configured'}`);

// Export all managers for advanced usage
export { configLoader, walletManager, providerManager };

// Auto-save function for wallet address updates
export function autoResolveWalletAddresses() {
  walletManager.autoResolveAddresses();
}

// Clean shutdown function
export async function cleanup() {
  await providerManager.cleanup();
} 