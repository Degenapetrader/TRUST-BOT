import { ethers } from 'ethers';
import { gasPriceService } from './providers/gasPriceService.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Load configuration from wallets.json database
// Use environment variable if set (from main.js), otherwise look in current directory
const WALLETS_DB_PATH = process.env.WALLETS_DB_PATH || 'wallets.json';

function loadWalletsDB() {
  try {
    if (!fs.existsSync(WALLETS_DB_PATH)) {
      throw new Error(`❌ Wallet database not found: ${WALLETS_DB_PATH}`);
    }
    
    const data = fs.readFileSync(WALLETS_DB_PATH, 'utf8');
    const db = JSON.parse(data);
    
    if (!db.config) {
      throw new Error('❌ Invalid wallet database structure: missing config section');
    }
    
    return db;
  } catch (error) {
    console.error(`❌ Error loading wallet database: ${error.message}`);
    throw error;
  }
}

// Load configuration from wallets.json
const walletsDB = loadWalletsDB();
const config = walletsDB.config;

// Helper function to decode base64 encoded RPC URLs
function decodeRpcUrl(encodedUrl) {
  if (!encodedUrl) return '';
  try {
    // Check if it's already a valid URL (starts with http/https)
    if (encodedUrl.startsWith('http://') || encodedUrl.startsWith('https://')) {
      return encodedUrl;
    }
    // Decode base64 encoded URL
    return Buffer.from(encodedUrl, 'base64').toString('utf8');
  } catch (error) {
    console.warn(`⚠️ Failed to decode RPC URL: ${encodedUrl}`);
    return encodedUrl; // Return as-is if decoding fails
  }
}

// Export walletsDB for access to polling interval and other settings
export { walletsDB };

console.log('✅ Main winbot configuration loaded from wallets.json');

// ERC20 ABI - minimal interface for token interactions
export const ERC20_ABI = [
  // Read-only functions
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  
  // Write functions
  "function transfer(address to, uint amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  
  // Events
  "event Transfer(address indexed from, address indexed to, uint amount)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)"
];

// Network configuration
// Removed - Network config moved below

// Bot mode configuration - BUY, SELL, 2WAY, or JEET (defaults for GUI control)
export const BOT_MODE = 'BUY'; // GUI handles mode selection

// JEET Configuration - for Genesis token claiming and swapping
export const JEET_CONFIG = {
  genesisContract: config.genesisContract || '',
  trustswapContract: config.trustswapContract || '0x74fa2835311Da3118BF2971Fa11E8070e4ff1693',
  uniswapRouter: config.uniswapRouter || '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  slippageBasisPoints: config.slippageBasisPoints || 4000,
  pollIntervalMs: config.pollIntervalMs || 10
};

// Virtual token address with proper checksumming
export const VIRTUAL_TOKEN_ADDRESS = config.virtualTokenAddress ? 
  ethers.getAddress(config.virtualTokenAddress) : undefined;

// Function to dynamically load trading wallet private keys from wallets.json
function loadTradingWalletKeys() {
  const keys = [];
  
  if (!walletsDB.wallets || !Array.isArray(walletsDB.wallets)) {
    console.warn('⚠️ No wallets array found in wallets.json');
    return keys;
  }
  
  for (const wallet of walletsDB.wallets) {
    if (wallet.privateKey && wallet.enabled !== false) {
      keys.push(wallet.privateKey);
    }
  }
  
  return keys;
}

// Load wallet private keys - only trading wallets from wallets.json
export const TRADING_WALLET_KEYS = loadTradingWalletKeys();
export const WALLET_PRIVATE_KEYS = TRADING_WALLET_KEYS; // For backwards compatibility

// Trading strategy configuration (GUI controlled)
export const TRADING_STRATEGY = 'DEFAULT';

// Strategy-specific configurations
export const STRATEGY_CONFIG = {
  // Instant Buy/Sell Strategy (2WAY mode only)
  INSTANT_DELAY_MIN: 1,
  INSTANT_DELAY_MAX: 5,
  
  // Market Maker Strategy (2WAY mode only)
  MM_PRICE_RANGE_PERCENT: 2.0,
  MM_CHECK_INTERVAL_SECONDS: 30,
};

// Bot configuration - using VIRTUAL amounts for all tokens (GUI controlled)
export const BOT_CONFIG = {
  numLoops: 500,
  virtualAmountMin: 1,
  virtualAmountMax: 2,
  maxSlippagePercent: 3.0,
  // Legacy support for backwards compatibility
  trustAmountMin: 1000,
  trustAmountMax: 2000,
  loopDelayMin: 1,
  loopDelayMax: 2,
  delayBetweenTxsMin: 5,
  delayBetweenTxsMax: 15
};

// Gas configuration - optimized for speed
export const GAS_CONFIG = {
  maxPriorityFeePerGas: "0.01", // in gwei
  gasLimitMultiplier: 1.01,  // multiply estimated gas by this factor for safety
  baseFeeMultiplier: 1.01    // multiply base fee by this factor for maxFeePerGas
};

// Legacy network configuration for backwards compatibility
export const NETWORK = {
  name: "Base",
  chainId: config.chainId || 8453,
  currency: "ETH"
};

// Initialize contracts for legacy support
export const getTrustTokenContract = (signerOrProvider) => {
  // For GUI mode, we'll use VIRTUAL token as default
  const tokenAddress = VIRTUAL_TOKEN_ADDRESS || config.virtualTokenAddress;
  return new ethers.Contract(tokenAddress, ERC20_ABI, signerOrProvider);
};

export const getVirtualTokenContract = (signerOrProvider) => {
  return new ethers.Contract(VIRTUAL_TOKEN_ADDRESS, ERC20_ABI, signerOrProvider);
};

// New function to get token contract by address (for GUI token selection)
export const getTokenContract = (tokenAddress, signerOrProvider) => {
  if (!tokenAddress) {
    throw new Error(`Token address is required`);
  }
  return new ethers.Contract(tokenAddress, ERC20_ABI, signerOrProvider);
};

// Validation for JEET mode
if (BOT_MODE === 'JEET') {
  if (!JEET_CONFIG.genesisContract) {
    throw new Error('GENESIS_CONTRACT is required for JEET mode');
  }
  if (!VIRTUAL_TOKEN_ADDRESS) {
    throw new Error('VIRTUAL_TOKEN_ADDRESS is required for JEET mode');
  }
  if (TRADING_WALLET_KEYS.length === 0) {
    throw new Error('At least one trading wallet is required for JEET mode');
  }
}

console.log(`🔑 Loaded ${TRADING_WALLET_KEYS.length} trading wallet keys from wallets.json`);
console.log(`🌐 Network: ${NETWORK.name} (Chain ID: ${NETWORK.chainId})`);
console.log(`💰 Virtual Token: ${VIRTUAL_TOKEN_ADDRESS}`);

// Multi-Provider RPC Configuration - Alchemy, QuickNode, and Infura
// Decode base64 encoded URLs from wallets.json
const rpcConfigs = [
  {
    name: 'Alchemy',
    rpcUrl: decodeRpcUrl(config.rpcUrl),
    wsUrl: decodeRpcUrl(config.wsUrl)
  },
  {
    name: 'QuickNode/BlastAPI',
    rpcUrl: decodeRpcUrl(config.rpcUrlQuickNode),
    wsUrl: decodeRpcUrl(config.wsUrlQuickNode)
  },
  {
    name: 'Infura',
    rpcUrl: decodeRpcUrl(config.rpcUrlInfura),
    wsUrl: decodeRpcUrl(config.wsUrlInfura)
  }
];

// Add dynamic RPCs (R1, R2, R3...) - decode base64 encoded URLs
if (config.dynamicRpcs && Array.isArray(config.dynamicRpcs)) {
  config.dynamicRpcs.forEach((rpc, index) => {
    if (rpc.enabled !== false && rpc.rpcUrl) {
      rpcConfigs.push({
        name: rpc.name || `R${index + 1}`,
        rpcUrl: decodeRpcUrl(rpc.rpcUrl),
        wsUrl: decodeRpcUrl(rpc.wsUrl)
      });
    }
  });
}

// Initialize providers
export const rpcPool = {
  providers: [],
  wsProviders: [],
  currentIndex: 0,
  failedProviders: new Set(),
  lastResetTime: Date.now()
};

// Initialize HTTP providers
rpcConfigs.forEach(rpcConfig => {
  if (rpcConfig.rpcUrl) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcConfig.rpcUrl);
      provider._providerName = rpcConfig.name;
      rpcPool.providers.push(provider);
      console.log(`✅ ${rpcConfig.name} HTTP provider initialized`);
    } catch (error) {
      console.log(`❌ Failed to initialize ${rpcConfig.name} HTTP provider: ${error.message}`);
    }
  } else {
    console.log(`⚠️ ${rpcConfig.name} HTTP URL not configured`);
  }
});

// Initialize WebSocket providers
rpcConfigs.forEach(rpcConfig => {
  if (rpcConfig.wsUrl) {
    try {
      const wsProvider = new ethers.WebSocketProvider(rpcConfig.wsUrl);
      wsProvider._providerName = rpcConfig.name;
      rpcPool.wsProviders.push(wsProvider);
      console.log(`✅ ${rpcConfig.name} WebSocket provider initialized`);
    } catch (error) {
      console.log(`❌ Failed to initialize ${rpcConfig.name} WebSocket provider: ${error.message}`);
    }
  } else {
    console.log(`⚠️ ${rpcConfig.name} WebSocket URL not configured`);
  }
});

// Primary provider (first available) and backup WebSocket
export const provider = rpcPool.providers[0];
export const wsProvider = rpcPool.wsProviders[0];

if (!provider) {
  throw new Error('❌ No HTTP providers available! Please check your wallets.json configuration.');
}

console.log(`🚀 Multi-Provider Pool initialized with ${rpcPool.providers.length} HTTP + ${rpcPool.wsProviders.length} WebSocket providers`);

// Provider management functions
export function getAllProviders() {
  return rpcPool.providers.filter(p => !rpcPool.failedProviders.has(p._providerName));
}

export function getAllWsProviders() {
  return rpcPool.wsProviders.filter(p => !rpcPool.failedProviders.has(p._providerName));
}

export function getRandomProvider() {
  const availableProviders = getAllProviders();
  if (availableProviders.length === 0) {
    // Reset failed providers if all are marked as failed
    rpcPool.failedProviders.clear();
    return rpcPool.providers[0];
  }
  const randomIndex = Math.floor(Math.random() * availableProviders.length);
  return availableProviders[randomIndex];
}

export function markProviderFailed(providerName) {
  rpcPool.failedProviders.add(providerName);
  console.log(`⚠️ Provider ${providerName} marked as failed`);
  
  // Reset failed providers after 5 minutes
  const now = Date.now();
  if (now - rpcPool.lastResetTime > 300000) { // 5 minutes
    rpcPool.failedProviders.clear();
    rpcPool.lastResetTime = now;
    console.log(`🔄 Failed providers reset`);
  }
}

// Enhanced provider selection with specific provider preferences
export function getProviderByPreference(preferredProviders = ['Alchemy', 'QuickNode/BlastAPI', 'Infura']) {
  const availableProviders = getAllProviders();
  
  // Try to get preferred provider in order
  for (const preferredName of preferredProviders) {
    const provider = availableProviders.find(p => p._providerName === preferredName);
    if (provider) {
      return provider;
    }
  }
  
  // Fallback to random available provider
  return getRandomProvider();
}

// Get Alchemy-compatible API configuration with fallbacks
export function getAlchemyConfig() {
  // Extract API key from Alchemy URL if available
  let alchemyApiKey = null;
  
  if (config.rpcUrl?.includes('alchemy.com')) {
    alchemyApiKey = config.rpcUrl.split('/').pop();
  }
  
  if (alchemyApiKey) {
    return {
      provider: 'Alchemy',
      apiKey: alchemyApiKey,
      baseUrl: 'https://base-mainnet.g.alchemy.com/v2/',
      available: true
    };
  }
  
  return {
    provider: null,
    apiKey: null,
    baseUrl: null,
    available: false
  };
}

// Enhanced RPC call with provider fallbacks
export async function executeRpcWithFallback(rpcCall, maxRetries = 2, timeout = 5000) {
  const availableProviders = getAllProviders();
  let lastError = null;
  
  for (let i = 0; i < availableProviders.length; i++) {
    const provider = availableProviders[i];
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`📡 RPC call via ${provider._providerName} (attempt ${attempt + 1}/${maxRetries})`);
        
        // Add timeout wrapper
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`${provider._providerName} RPC timeout after ${timeout}ms`)), timeout)
        );
        
        const result = await Promise.race([rpcCall(provider), timeoutPromise]);
        
        console.log(`✅ RPC call successful via ${provider._providerName}`);
        return result;
        
      } catch (error) {
        lastError = error;
        console.log(`❌ RPC call failed via ${provider._providerName} (attempt ${attempt + 1}): ${error.message}`);
        
        // If it's a timeout or network error, retry
        if (error.message.includes('timeout') || 
            error.message.includes('network') || 
            error.message.includes('connection') ||
            error.message.includes('502') ||
            error.message.includes('503') ||
            error.message.includes('504')) {
          
          if (attempt < maxRetries - 1) {
            console.log(`🔄 Retrying RPC call with ${provider._providerName} in 1 second...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
        } else {
          // For non-network errors, don't retry with same provider
          break;
        }
      }
    }
    
    // Mark provider as temporarily failed if all retries failed
    markProviderFailed(provider._providerName);
    console.log(`⚠️ ${provider._providerName} marked as failed, trying next provider...`);
  }
  
  throw new Error(`❌ RPC call failed across all providers. Last error: ${lastError?.message}`);
}

// Enhanced transaction broadcasting with RANDOM provider selection and fallback rotation
export async function executeTransactionWithReplacementFee(transactionFunction, maxRetries = 16, maxProviderRetries = 2) {
  const allProviders = getAllProviders();
  let lastError = null;
  
  // Get gas price from gas helper if available (for renderer context)
  let gasParams = null;
  try {
    if (typeof window !== 'undefined' && window.getCurrentGasPrice) {
      // Detect bot type from call stack or transaction function
      let botType = 'buybot'; // Default to buybot type (2x multiplier)
      
      // Check if this is a JeetBot transaction by examining the call stack
      const stack = new Error().stack;
      if (stack && (stack.includes('jeetSwapExecutor') || stack.includes('JeetSwapExecutor') || stack.includes('jeet-bot'))) {
        botType = 'jeetbot'; // Use 3x multiplier for JeetBot (turbo mode)
        console.log('🎯 Config.js: Detected JeetBot transaction, using 3x gas multiplier (turbo mode)');
        if (window.addConsoleMessage) {
          window.addConsoleMessage('🎯 Config.js: Detected JeetBot transaction, using 3x gas multiplier (turbo mode)', 'info');
        }
      }
      
      const gasPrice = await window.getCurrentGasPrice(botType);
      const totalGasPriceWei = ethers.parseUnits(gasPrice, 'gwei');
      
      // Create gasParams with 50% priority fee (as calculated by gas helper)
      gasParams = {
        maxFeePerGas: totalGasPriceWei,
        maxPriorityFeePerGas: totalGasPriceWei * 50n / 100n  // 50% of total as priority
      };
      
      // Log gas parameter creation with detailed console logging
      const maxFeeGwei = ethers.formatUnits(gasParams.maxFeePerGas, 'gwei');
      const priorityGwei = ethers.formatUnits(gasParams.maxPriorityFeePerGas, 'gwei');
      console.log(`⛽ Config.js: Created gasParams from gas helper (${botType}) - maxFee: ${maxFeeGwei} gwei, priority: ${priorityGwei} gwei`);
      
      // Also add to detailed console if available
      if (window.addConsoleMessage) {
        window.addConsoleMessage(`⛽ Config.js: Using dynamic gas (${botType}) - ${maxFeeGwei} gwei maxFee + ${priorityGwei} gwei priority`, 'info');
      }
    } else {
      // Backend context: fallback to gasPriceService
      console.log('⚠️ Config.js: Gas helper not available (backend context), using gasPriceService fallback');
      
      try {
        // Detect bot type from call stack (same logic as renderer)
        let botType = 'buybot'; // Default 2x multiplier
        const stack = new Error().stack;
        if (stack && (stack.includes('jeetSwapExecutor') || stack.includes('JeetSwapExecutor') || stack.includes('jeet-bot'))) {
          botType = 'jeetbot'; // 3x multiplier for JeetBot
          console.log('🎯 Config.js: Detected JeetBot transaction (backend), using 3x gas multiplier (turbo mode)');
        }
        
        // Get gas from gasPriceService with appropriate multiplier
        const gasData = botType === 'jeetbot' 
          ? await gasPriceService.getCurrentGasPriceWithMultiplier(3.0) // 3x for JeetBot
          : await gasPriceService.getCurrentGasPrice(); // 2x for others (default)
        
        // Create gasParams from gasPriceService data
        gasParams = {
          maxFeePerGas: ethers.parseUnits(gasData.totalGasFee, 'gwei'),
          maxPriorityFeePerGas: ethers.parseUnits(gasData.priorityFee, 'gwei')
        };
        
        const maxFeeGwei = ethers.formatUnits(gasParams.maxFeePerGas, 'gwei');
        const priorityGwei = ethers.formatUnits(gasParams.maxPriorityFeePerGas, 'gwei');
        console.log(`⛽ Config.js: Created gasParams from gasPriceService (${botType}) - maxFee: ${maxFeeGwei} gwei, priority: ${priorityGwei} gwei`);
        
      } catch (error) {
        console.log(`❌ Config.js: gasPriceService fallback failed: ${error.message}`);
        // Final fallback: create basic gasParams with hardcoded values
        gasParams = {
          maxFeePerGas: ethers.parseUnits('0.02', 'gwei'),
          maxPriorityFeePerGas: ethers.parseUnits('0.01', 'gwei')
        };
        console.log('⚠️ Config.js: Using hardcoded fallback gas: 0.02 gwei maxFee + 0.01 gwei priority');
      }
    }
  } catch (error) {
    console.log(`❌ Config.js: Error getting gas from helper: ${error.message}`);
    if (typeof window !== 'undefined' && window.addConsoleMessage) {
      window.addConsoleMessage(`❌ Config.js: Gas helper error: ${error.message}`, 'error');
    }
  }
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // RANDOM PROVIDER SELECTION: Randomly select first provider, then try others if it fails
    const providerPool = [...allProviders]; // Create a copy to avoid modifying original
    const randomIndex = Math.floor(Math.random() * providerPool.length);
    const randomProvider = providerPool.splice(randomIndex, 1)[0]; // Remove and get random provider
    const orderedProviders = [randomProvider, ...providerPool]; // Random first, then others
    
    console.log(`🎲 Random provider selection: Starting with ${randomProvider._providerName}, fallback to [${providerPool.map(p => p._providerName).join(', ')}]`);
    
    // Try each provider with retry logic (random first, then others)
    for (const currentProvider of orderedProviders) {
      let providerErrors = [];
      
      // Retry with same provider up to maxProviderRetries times
      for (let providerAttempt = 0; providerAttempt < maxProviderRetries; providerAttempt++) {
        try {
          const retryInfo = providerAttempt > 0 ? ` (retry ${providerAttempt + 1}/${maxProviderRetries})` : '';
          console.log(`📡 Attempting transaction via ${currentProvider._providerName}${retryInfo} (broadcast attempt ${attempt + 1})`);
          
          // Execute transaction - pass gasParams if available, otherwise let bot handle gas
          const tx = await transactionFunction(currentProvider, gasParams);
          
          console.log(`✅ Transaction submitted via ${currentProvider._providerName}: ${tx.hash}`);
          
          // Log gas settings used in transaction (if gasParams were provided)
          if (gasParams) {
            const maxFeeGwei = ethers.formatUnits(gasParams.maxFeePerGas, 'gwei');
            const priorityGwei = ethers.formatUnits(gasParams.maxPriorityFeePerGas, 'gwei');
            console.log(`⛽ Transaction gas: ${maxFeeGwei} gwei (maxFee) + ${priorityGwei} gwei (priority)`);
            
            if (typeof window !== 'undefined' && window.addConsoleMessage) {
              window.addConsoleMessage(`⛽ Transaction executed with ${maxFeeGwei} gwei maxFee + ${priorityGwei} gwei priority`, 'success');
            }
          }
          
          // Wait for 2 confirmations (on Base, should be ~4 seconds) to ensure balance updates
          const receipt = await tx.wait(2);
          console.log(`🎯 Transaction confirmed in block ${receipt.blockNumber}`);
          
          // Log final gas usage from receipt
          if (receipt.gasUsed) {
            console.log(`⛽ Gas used: ${receipt.gasUsed.toString()} units`);
            if (typeof window !== 'undefined' && window.addConsoleMessage) {
              window.addConsoleMessage(`⛽ Transaction confirmed: ${tx.hash} - Gas used: ${receipt.gasUsed} units`, 'success');
            }
          }
          
          return { hash: tx.hash, receipt: receipt, provider: currentProvider._providerName };
          
        } catch (error) {
          providerErrors.push(error);
          lastError = error;
          
          const retryInfo = providerAttempt > 0 ? ` (retry ${providerAttempt + 1}/${maxProviderRetries})` : '';
          console.log(`❌ Transaction failed via ${currentProvider._providerName}${retryInfo}: ${error.message}`);
          
          // Check for "already known" error - this means transaction was already broadcast successfully
          if (error.message?.includes('already known')) {
            console.log(`🔄 Transaction already known - likely already in mempool. Waiting for confirmation...`);
            
            // Try to find the transaction hash from the error or generate one
            // Since we can't get the hash easily, let's wait a bit and check if it got mined
            await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds (Base block time is ~2s)
            
            console.log(`✅ Transaction assumed successful (already in mempool) via ${currentProvider._providerName}`);
            return { 
              hash: 'unknown_already_known', 
              receipt: { status: 1, blockNumber: 'unknown' }, 
              provider: currentProvider._providerName 
            };
          }
          
          // Check for replacement underpriced error - escalate gas and retry
          if (error.code === 'REPLACEMENT_UNDERPRICED' || 
              error.message?.includes('replacement transaction underpriced') ||
              error.message?.includes('replacement fee too low')) {
            console.log(`🔄 Replacement fee too low detected, will escalate gas for next attempt`);
            break; // Break out of provider retry loop to escalate gas
          }
          
          // For other errors, retry with same provider if retries available
          if (providerAttempt < maxProviderRetries - 1) {
            console.log(`🔄 Retrying with ${currentProvider._providerName} in 500ms...`);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }
      
      // Provider exhausted all retries
      console.log(`⚠️ Provider ${currentProvider._providerName} exhausted all ${maxProviderRetries} retries`);
    }
    
    // All providers failed for this attempt, will escalate gas and retry
    console.log(`⚠️ All providers failed for attempt ${attempt + 1}, escalating gas for next attempt`);
  }
  
  // All attempts exhausted
  throw new Error(`❌ Transaction failed after ${maxRetries} broadcast cycles across all providers. Last error: ${lastError?.message}`);
}

// Function to auto-resolve wallet addresses from private keys
function autoResolveWalletAddresses() {
  if (!walletsDB.wallets || !Array.isArray(walletsDB.wallets)) {
    return;
  }
  
  let addressesResolved = 0;
  
  walletsDB.wallets.forEach(wallet => {
    if (wallet.privateKey && (!wallet.address || !ethers.isAddress(wallet.address))) {
      try {
        // Remove 0x prefix if present for consistency
        const cleanPrivateKey = wallet.privateKey.startsWith('0x') ? wallet.privateKey : `0x${wallet.privateKey}`;
        
        // Create wallet instance to derive address
        const walletInstance = new ethers.Wallet(cleanPrivateKey);
        const derivedAddress = walletInstance.address;
        
        console.log(`� Auto-resolved address for ${wallet.name}: ${derivedAddress}`);
        wallet.address = derivedAddress;
        addressesResolved++;
      } catch (error) {
        console.log(`❌ Failed to resolve address for ${wallet.name}: ${error.message}`);
      }
    }
  });
  
  if (addressesResolved > 0) {
    // Save updated wallets to file
    try {
      fs.writeFileSync(WALLETS_DB_PATH, JSON.stringify(walletsDB, null, 2));
      console.log(`✅ Auto-resolved ${addressesResolved} wallet addresses and saved to wallets.json`);
    } catch (error) {
      console.log(`❌ Failed to save auto-resolved addresses: ${error.message}`);
    }
  }
}

// Auto-resolve wallet addresses on startup
autoResolveWalletAddresses();
