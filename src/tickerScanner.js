import { ethers } from 'ethers';
import { Alchemy, Network } from 'alchemy-sdk';
import { provider, ERC20_ABI, VIRTUAL_TOKEN_ADDRESS } from './scannerConfig.js';
import { log, formatError } from './utils.js';
import { 
  tokenExists, 
  getTokenInfo, 
  addToken, 
  getTokensByTicker, 
  getTokenListStats,
  displayTokenList 
} from './tokenListDB.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Load wallets.json for configuration
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WALLETS_DB_PATH = 'wallets.json';

function loadWalletsDB() {
  try {
    const data = fs.readFileSync(WALLETS_DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`❌ Error loading wallet database: ${error.message}`);
    throw error;
  }
}

const walletsDB = loadWalletsDB();
const config = walletsDB.config;

// Initialize Alchemy SDK using RPC URL from wallets.json
const alchemy = new Alchemy({
  apiKey: config.rpcUrl?.split('/').pop(), // Extract API key from RPC URL
  network: Network.BASE_MAINNET,
});

// Uniswap V2 Factory and Pair ABIs
const UNISWAP_V2_FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];

const UNISWAP_V2_PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)"
];

// Uniswap V2 Factory address on Base
const UNISWAP_V2_FACTORY_ADDRESS = "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6";
const factoryContract = new ethers.Contract(UNISWAP_V2_FACTORY_ADDRESS, UNISWAP_V2_FACTORY_ABI, provider);

/**
 * Search for tokens by ticker symbol using multiple methods
 * @param {string} ticker - The ticker symbol to search for
 * @returns {Array} Array of token objects with address, symbol, name, decimals
 */
async function searchTokensByTicker(ticker) {
  const foundTokens = [];
  const tickerUpper = ticker.toUpperCase();
  const tickerLower = ticker.toLowerCase();
  
  log(`Searching for tokens with ticker: ${ticker}`);
  
  try {
    // Method 1: Search using known token lists APIs
    // We'll use a comprehensive search approach by checking multiple sources
    
    // Method 2: Get top tokens from Alchemy and filter by symbol
    log(`Fetching token metadata for symbol matching...`);
    
    // We'll need to use a different approach since Alchemy doesn't have a direct symbol search
    // Let's use Base blockchain explorer API or token list APIs
    
    // Method 3: Search through known token registries
    const tokenSearchResults = await searchFromTokenRegistries(ticker);
    foundTokens.push(...tokenSearchResults);
    
    // Method 4: Search through common token addresses if we have them
    const commonTokens = await searchCommonTokenAddresses(ticker);
    foundTokens.push(...commonTokens);
    
    // Remove duplicates based on address
    const uniqueTokens = [];
    const seenAddresses = new Set();
    
    for (const token of foundTokens) {
      const addressLower = token.address.toLowerCase();
      if (!seenAddresses.has(addressLower)) {
        seenAddresses.add(addressLower);
        uniqueTokens.push(token);
      }
    }
    
    log(`Found ${uniqueTokens.length} unique tokens matching ticker: ${ticker}`);
    return uniqueTokens;
    
  } catch (error) {
    log(`Error searching for tokens: ${formatError(error)}`);
    return [];
  }
}

/**
 * Search token registries for the ticker
 */
async function searchFromTokenRegistries(ticker) {
  const tokens = [];
  
  try {
    // Base token list - common tokens on Base network
    const baseTokenList = await fetchBaseTokenList();
    const matchingTokens = baseTokenList.filter(token => 
      token.symbol && token.symbol.toUpperCase() === ticker.toUpperCase()
    );
    tokens.push(...matchingTokens);
    
  } catch (error) {
    log(`Could not fetch from token registries: ${formatError(error)}`);
  }
  
  return tokens;
}

/**
 * Fetch Base network token list
 */
async function fetchBaseTokenList() {
  try {
    // Use Base's official token list or popular DeFi token lists
    const response = await fetch('https://tokens.coingecko.com/base/all.json');
    if (response.ok) {
      const data = await response.json();
      return data.tokens || [];
    }
  } catch (error) {
    log(`Error fetching Base token list: ${formatError(error)}`);
  }
  
  // Fallback: return empty array
  return [];
}

/**
 * Search through manually curated common token addresses
 */
async function searchCommonTokenAddresses(ticker) {
  const tokens = [];
  
  // Common Base tokens - you can expand this list
  const commonTokenAddresses = {
    'USDC': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    'WETH': '0x4200000000000000000000000000000000000006',
    'VIRTUAL': VIRTUAL_TOKEN_ADDRESS,
    // Add more common tokens here
  };
  
  const tickerUpper = ticker.toUpperCase();
  
  if (commonTokenAddresses[tickerUpper]) {
    try {
      const metadata = await alchemy.core.getTokenMetadata(commonTokenAddresses[tickerUpper]);
      if (metadata && metadata.symbol) {
        tokens.push({
          address: commonTokenAddresses[tickerUpper],
          symbol: metadata.symbol,
          name: metadata.name || metadata.symbol,
          decimals: metadata.decimals
        });
      }
    } catch (error) {
      log(`Error getting metadata for ${tickerUpper}: ${formatError(error)}`);
    }
  }
  
  return tokens;
}

/**
 * Check if a token has a Uniswap V2 pool against VIRTUAL
 * @param {string} tokenAddress - The token contract address
 * @returns {Object|null} Pool information or null if no pool exists
 */
async function checkUniswapV2Pool(tokenAddress) {
  if (!tokenAddress || !VIRTUAL_TOKEN_ADDRESS) {
    return null;
  }

  // Skip if token is VIRTUAL itself
  if (tokenAddress.toLowerCase() === VIRTUAL_TOKEN_ADDRESS.toLowerCase()) {
    return null;
  }

  try {
    // Get pair address from factory
    const pairAddress = await factoryContract.getPair(tokenAddress, VIRTUAL_TOKEN_ADDRESS);
    
    if (pairAddress === ethers.constants.AddressZero) {
      return null; // No pair exists
    }

    // Get pair details to verify liquidity
    const pairContract = new ethers.Contract(pairAddress, UNISWAP_V2_PAIR_ABI, provider);
    
    const [reserves, token0, token1] = await Promise.all([
      pairContract.getReserves(),
      pairContract.token0(),
      pairContract.token1()
    ]);

    // Check if pair has liquidity
    if (reserves.reserve0.eq(0) || reserves.reserve1.eq(0)) {
      return null; // No liquidity
    }

    // Determine which token is which
    const isToken0Virtual = token0.toLowerCase() === VIRTUAL_TOKEN_ADDRESS.toLowerCase();
    const virtualReserve = isToken0Virtual ? reserves.reserve0 : reserves.reserve1;
    const tokenReserve = isToken0Virtual ? reserves.reserve1 : reserves.reserve0;

    return {
      pairAddress: pairAddress,
      virtualReserve: virtualReserve,
      tokenReserve: tokenReserve,
      token0: token0,
      token1: token1,
      isToken0Virtual: isToken0Virtual,
      hasLiquidity: true
    };

  } catch (error) {
    log(`Error checking pool for ${tokenAddress}: ${formatError(error)}`);
    return null;
  }
}

/**
 * Main function to scan ticker and find pools
 * @param {string} ticker - The ticker symbol to search for
 * @returns {Array} Array of results with ticker, address, and pool info
 */
export async function scanTickerForPools(ticker) {
  if (!ticker || typeof ticker !== 'string') {
    log(`Invalid ticker provided: ${ticker}`);
    return [];
  }

  if (!VIRTUAL_TOKEN_ADDRESS) {
    log(`VIRTUAL_TOKEN_ADDRESS not configured`);
    return [];
  }

  log(`\nTICKER SCANNER: ${ticker.toUpperCase()}`);
  log(`==========================================`);
  
  // Step 1: Check database first
  log(`Checking TokenList database for existing ${ticker} tokens...`);
  const existingTokens = getTokensByTicker(ticker);
  
  if (existingTokens.length > 0) {
    log(`Found ${existingTokens.length} ${ticker} token(s) in database`);
    
    // Filter for tokens with pools and format results
    const tokensWithPools = existingTokens.filter(token => token.hasPool && token.poolAddress);
    
    if (tokensWithPools.length > 0) {
      log(`${tokensWithPools.length} token(s) have pools:`);
      
      // Display results in requested format
      log(`\nRESULTS FOR TICKER: ${ticker.toUpperCase()} (FROM DATABASE)`);
      log(`========================================================`);
      
      const results = [];
      tokensWithPools.forEach((token, index) => {
        const result = {
          ticker: token.ticker,
          address: token.contractAddress,
          name: token.name || token.ticker,
          decimals: token.decimals,
          poolInfo: {
            pairAddress: token.poolAddress,
            hasLiquidity: true
          },
          hasPool: true,
          fromDatabase: true
        };
        
        results.push(result);
        
        log(`\nMATCH ${index + 1}:`);
        log(`Ticker: ${result.ticker}`);
        log(`Ticker_CA: ${result.address}`);
        log(`Ticker_Pool: ${result.poolInfo.pairAddress}`);
        
        if (token.name) log(`Name: ${token.name}`);
        if (token.decimals) log(`Decimals: ${token.decimals}`);
        log(`Added: ${new Date(token.dateAdded).toLocaleString()}`);
      });
      
      log(`\nRetrieved ${results.length} token(s) with pools from database`);
      return results;
    } else {
      log(`Found ${existingTokens.length} ${ticker} token(s) in database but none have pools`);
    }
  }
  
  // Step 2: Search for new tokens if not found in database
  log(`\nSearching for new ${ticker} tokens...`);
  const tokens = await searchTokensByTicker(ticker);
  
  if (tokens.length === 0) {
    log(`No tokens found for ticker: ${ticker}`);
    return [];
  }

  log(`\nChecking Uniswap V2 pools vs VIRTUAL...`);
  
  // Step 3: Check each token for Uniswap V2 pools in parallel
  const results = [];
  const poolPromises = tokens.map(async (token, index) => {
    try {
      // Check if token already exists in database
      if (tokenExists(token.symbol, token.address)) {
        log(`  ${token.symbol} (${token.address.slice(0,8)}...) already in database, skipping`);
        return null;
      }
      
      log(`  Checking ${token.symbol} (${token.address.slice(0,8)}...)`);
      
      const poolInfo = await checkUniswapV2Pool(token.address);
      
      const tokenResult = {
        ticker: token.symbol,
        address: token.address,
        name: token.name,
        decimals: token.decimals,
        poolInfo: poolInfo,
        hasPool: poolInfo !== null
      };
      
      // Save to database regardless of pool status
      addToken(
        token.symbol,
        token.address,
        poolInfo ? poolInfo.pairAddress : '',
        {
          name: token.name,
          decimals: token.decimals
        }
      );
      
      return tokenResult;
    } catch (error) {
      log(`    Error checking ${token.symbol}: ${formatError(error)}`);
      return {
        ticker: token.symbol,
        address: token.address,
        name: token.name,
        decimals: token.decimals,
        poolInfo: null,
        hasPool: false
      };
    }
  });

  // Wait for all pool checks to complete
  const poolResults = await Promise.allSettled(poolPromises);
  
  // Process results
  poolResults.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      const tokenResult = result.value;
      
      if (tokenResult.hasPool) {
        results.push(tokenResult);
        log(`    ${tokenResult.ticker}: Pool found at ${tokenResult.poolInfo.pairAddress}`);
      } else {
        log(`    ${tokenResult.ticker}: No pool vs VIRTUAL`);
      }
    } else if (result.status === 'rejected') {
      log(`    Failed to check token: ${result.reason}`);
    }
  });

  // Display results in requested format
  log(`\nRESULTS FOR TICKER: ${ticker.toUpperCase()}`);
  log(`=======================================`);
  
  if (results.length === 0) {
    log(`No tokens with pools found for ticker: ${ticker}`);
    log(`\nRequirements:`);
    log(`   - Token must exist with symbol: ${ticker}`);
    log(`   - Uniswap V2 pool must exist vs VIRTUAL`);
    log(`   - Pool must have liquidity`);
    return [];
  }

  // Format results as requested
  results.forEach((result, index) => {
    log(`\nMATCH ${index + 1}:`);
    log(`Ticker: ${result.ticker}`);
    log(`Ticker_CA: ${result.address}`);
    log(`Ticker_Pool: ${result.poolInfo.pairAddress}`);
    
    // Additional useful info
    log(`\nPool Details:`);
    log(`      Virtual Reserve: ${ethers.formatEther(result.poolInfo.virtualReserve)} VIRTUAL`);
    log(`      Token Reserve: ${ethers.formatUnits(result.poolInfo.tokenReserve, result.decimals)} ${result.ticker}`);
    log(`      Token Name: ${result.name}`);
    log(`      Token Decimals: ${result.decimals}`);
  });

  log(`\nFound ${results.length} valid token(s) with pools for ticker: ${ticker}`);
  
  // Display database stats
  const stats = getTokenListStats();
  log(`\nTokenList Database Updated:`);
  log(`   Total tokens: ${stats.totalTokens}`);
  log(`   Tokens with pools: ${stats.tokensWithPools}`);
  log(`   Database: ${stats.databaseFile}`);
  
  return results;
}

/**
 * Scan a specific contract address for a ticker and check for pools
 * @param {string} ticker - The expected ticker symbol
 * @param {string} contractAddress - The specific contract address to check
 * @returns {Array} Results for the token if valid
 */
export async function scanTickerWithAddress(ticker, contractAddress) {
  if (!ticker || typeof ticker !== 'string') {
    log(`Invalid ticker provided: ${ticker}`);
    return [];
  }

  if (!contractAddress || !contractAddress.startsWith('0x') || contractAddress.length !== 42) {
    log(`Invalid contract address provided: ${contractAddress}`);
    return [];
  }

  if (!VIRTUAL_TOKEN_ADDRESS) {
    log(`VIRTUAL_TOKEN_ADDRESS not configured`);
    return [];
  }

  log(`\nTICKER SCANNER (Direct Address): ${ticker.toUpperCase()}`);
  log(`Contract Address: ${contractAddress}`);
  log(`=======================================================`);

  const results = [];

  try {
    // Step 1: Check if token already exists in database
    if (tokenExists(ticker, contractAddress)) {
      log(`Found ${ticker} at ${contractAddress} in database`);
      const existingToken = getTokenInfo(ticker, contractAddress);
      
      if (existingToken && existingToken.hasPool) {
        const result = {
          ticker: existingToken.ticker,
          address: existingToken.contractAddress,
          name: existingToken.name || existingToken.ticker,
          decimals: existingToken.decimals,
          poolInfo: {
            pairAddress: existingToken.poolAddress,
            hasLiquidity: true
          },
          hasPool: true,
          fromDatabase: true
        };
        
        results.push(result);
        
        log(`\nRESULTS FOR TICKER: ${ticker.toUpperCase()} (FROM DATABASE)`);
        log(`========================================================`);
        log(`\nMATCH 1:`);
        log(`Ticker: ${result.ticker}`);
        log(`Ticker_CA: ${result.address}`);
        log(`Ticker_Pool: ${result.poolInfo.pairAddress}`);
        
        if (existingToken.name) log(`Name: ${existingToken.name}`);
        if (existingToken.decimals) log(`Decimals: ${existingToken.decimals}`);
        log(`Added: ${new Date(existingToken.dateAdded).toLocaleString()}`);
        log(`Source: Database`);
        
        log(`\nRetrieved token with pool from database`);
        return results;
      } else {
        log(`    ⚠️ Token in database but no pool found`);
        log(`    🔄 Re-checking pool status...`);
      }
    }

    // Step 2: Get token metadata from Alchemy
    log(`Getting token metadata from Alchemy...`);
    const metadata = await alchemy.core.getTokenMetadata(contractAddress);
    
    if (!metadata || !metadata.symbol) {
      log(`Could not get metadata for contract address: ${contractAddress}`);
      log(`Possible reasons:`);
      log(`   - Invalid contract address`);
      log(`   - Not a token contract`);
      log(`   - Contract not deployed on Base network`);
      return [];
    }

    // Step 3: Verify ticker matches
    if (metadata.symbol.toUpperCase() !== ticker.toUpperCase()) {
      log(`Ticker mismatch!`);
      log(`   Expected: ${ticker.toUpperCase()}`);
      log(`   Found: ${metadata.symbol.toUpperCase()}`);
      log(`   Contract: ${contractAddress}`);
      log(`The contract address does not match the expected ticker symbol`);
      return [];
    }

    log(`Token metadata verified:`);
    log(`   Symbol: ${metadata.symbol}`);
    log(`   Name: ${metadata.name || 'N/A'}`);
    log(`   Decimals: ${metadata.decimals}`);

    // Step 4: Check for Uniswap V2 pool
    log(`\nChecking for Uniswap V2 pool vs VIRTUAL...`);
    const poolInfo = await checkUniswapV2Pool(contractAddress);

    // Step 5: Save to database regardless of pool status
    addToken(
      metadata.symbol,
      contractAddress,
      poolInfo ? poolInfo.pairAddress : '',
      {
        name: metadata.name,
        decimals: metadata.decimals
      }
    );

    if (!poolInfo) {
      log(`No Uniswap V2 pool found for ${ticker} vs VIRTUAL`);
      log(`Requirements:`);
      log(`   - Uniswap V2 pool must exist (not V3 or V4)`);
      log(`   - Pool must be paired with VIRTUAL token`);
      log(`   - Pool must have liquidity`);
      return [];
    }

    // Step 6: Create result object
    const result = {
      ticker: metadata.symbol,
      address: contractAddress,
      name: metadata.name || metadata.symbol,
      decimals: metadata.decimals,
      poolInfo: poolInfo,
      hasPool: true,
      fromDirectAddress: true
    };

    results.push(result);

    // Step 7: Display results
    log(`Pool found: ${poolInfo.pairAddress}`);
    
    log(`\nRESULTS FOR TICKER: ${ticker.toUpperCase()}`);
    log(`=======================================`);
    
    log(`\nMATCH 1:`);
    log(`Ticker: ${result.ticker}`);
    log(`Ticker_CA: ${result.address}`);
    log(`Ticker_Pool: ${result.poolInfo.pairAddress}`);
    
    // Additional useful info
    log(`\nPool Details:`);
    log(`      Virtual Reserve: ${ethers.formatEther(result.poolInfo.virtualReserve)} VIRTUAL`);
    log(`      Token Reserve: ${ethers.formatUnits(result.poolInfo.tokenReserve, result.decimals)} ${result.ticker}`);
    log(`      Token Name: ${result.name}`);
    log(`      Token Decimals: ${result.decimals}`);
    log(`Source: Direct Address`);

    log(`\nFound valid token with pool for ticker: ${ticker}`);
    
    // Display database stats
    const stats = getTokenListStats();
    log(`\nTokenList Database Updated:`);
    log(`   Total tokens: ${stats.totalTokens}`);
    log(`   Tokens with pools: ${stats.tokensWithPools}`);
    log(`   Database: ${stats.databaseFile}`);

    return results;

  } catch (error) {
    log(`Error scanning token: ${formatError(error)}`);
    return [];
  }
}

/**
 * Alternative method using direct address lookup if you know potential addresses
 * @param {string} ticker - The ticker symbol
 * @param {Array} addressesToCheck - Array of addresses to check
 * @returns {Array} Results for matching tokens
 */
export async function scanTickerFromAddresses(ticker, addressesToCheck) {
  if (!Array.isArray(addressesToCheck) || addressesToCheck.length === 0) {
    log(`No addresses provided to check`);
    return [];
  }

  log(`\nTICKER SCANNER (Address List): ${ticker.toUpperCase()}`);
  log(`Checking ${addressesToCheck.length} provided addresses...`);
  log(`================================================`);

  const results = [];
  
  // Check each address
  for (const address of addressesToCheck) {
    try {
      // First check if token already exists in database
      if (tokenExists(ticker, address)) {
        log(`Found ${ticker} at ${address} in database`);
        const existingToken = getTokenInfo(ticker, address);
        
        if (existingToken && existingToken.hasPool) {
          results.push({
            ticker: existingToken.ticker,
            address: existingToken.contractAddress,
            name: existingToken.name || existingToken.ticker,
            decimals: existingToken.decimals,
            poolInfo: {
              pairAddress: existingToken.poolAddress,
              hasLiquidity: true
            },
            hasPool: true,
            fromDatabase: true
          });
          log(`    ✅ Pool from database: ${existingToken.poolAddress}`);
          continue;
        } else {
          log(`    ⚠️ Token in database but no pool`);
          continue;
        }
      }
      
      // Get token metadata if not in database
      const metadata = await alchemy.core.getTokenMetadata(address);
      
      if (!metadata || !metadata.symbol) {
        log(`⚠️ Could not get metadata for ${address}`);
        continue;
      }

      // Check if symbol matches ticker
      if (metadata.symbol.toUpperCase() !== ticker.toUpperCase()) {
        log(`⚠️ Symbol mismatch: ${metadata.symbol} != ${ticker} for ${address}`);
        continue;
      }

      log(`✅ Found matching token: ${metadata.symbol} at ${address}`);

      // Check for pool
      const poolInfo = await checkUniswapV2Pool(address);
      
      const result = {
        ticker: metadata.symbol,
        address: address,
        name: metadata.name || metadata.symbol,
        decimals: metadata.decimals,
        poolInfo: poolInfo,
        hasPool: poolInfo !== null
      };

      // Save to database
      addToken(
        metadata.symbol,
        address,
        poolInfo ? poolInfo.pairAddress : '',
        {
          name: metadata.name,
          decimals: metadata.decimals
        }
      );

      if (result.hasPool) {
        results.push(result);
        log(`    ✅ Pool found: ${poolInfo.pairAddress}`);
      } else {
        log(`    ❌ No pool vs VIRTUAL`);
      }

    } catch (error) {
      log(`Error checking address ${address}: ${formatError(error)}`);
    }
  }

  // Display results
  log(`\nRESULTS FOR TICKER: ${ticker.toUpperCase()}`);
  log(`=======================================`);
  
  results.forEach((result, index) => {
    log(`\nMATCH ${index + 1}:`);
    log(`Ticker: ${result.ticker}`);
    log(`Ticker_CA: ${result.address}`);
    log(`Ticker_Pool: ${result.poolInfo.pairAddress}`);
    if (result.fromDatabase) {
      log(`    Source: Database`);
    }
  });

  // Display database stats
  const stats = getTokenListStats();
  log(`\nTokenList Database Stats:`);
  log(`   Total tokens: ${stats.totalTokens}`);
  log(`   Tokens with pools: ${stats.tokensWithPools}`);

  return results;
} 