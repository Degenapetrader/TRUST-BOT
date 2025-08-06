import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Load configuration from wallets.json database
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WALLETS_DB_PATH = 'wallets.json';

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

// ERC20 ABI - minimal interface for token interactions
export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint amount)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)"
];

// Network configuration
export const NETWORK = {
  name: "base",
  chainId: config.chainId || 8453,
  rpcUrl: config.rpcUrl
};

// Virtual token address with proper checksumming
export const VIRTUAL_TOKEN_ADDRESS = config.virtualTokenAddress ? 
  ethers.getAddress(config.virtualTokenAddress) : undefined;

// Environment variables from wallets.json
const CHAIN_ID = config.chainId || 8453; 
const RPC_URL = config.rpcUrl;

// Define Base network explicitly for ethers.js v5 compatibility
const BASE_NETWORK = {
  name: 'base',
  chainId: 8453,
  _defaultProvider: null
};

// Create provider for scanner (no WebSocket needed, no validation)
let provider;

try {
  // HTTP Provider with explicit Base network configuration
  provider = new ethers.providers.JsonRpcProvider(RPC_URL, BASE_NETWORK);
  console.log('Scanner provider initialized from wallets.json');
} catch (error) {
  console.error('Failed to create scanner provider:', error.message);
  throw error;
}

// Export provider
export { provider };

// Minimal validation - only check what's needed for scanning
if (!VIRTUAL_TOKEN_ADDRESS) {
  console.warn('VIRTUAL_TOKEN_ADDRESS not configured in wallets.json - some features may not work');
}

if (!RPC_URL) {
  throw new Error('RPC_URL is required for token scanning');
} 