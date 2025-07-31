import fs from 'fs';
import path from 'path';
import { log, formatError } from './utils.js';

// Database file path
const TOKEN_LIST_FILE = 'TokenList.json';

/**
 * Initialize the token list database
 */
function initializeTokenListDB() {
  if (!fs.existsSync(TOKEN_LIST_FILE)) {
    const initialData = {
      version: "1.0.0",
      lastUpdated: new Date().toISOString(),
      tokens: {},
      stats: {
        totalTokens: 0,
        tokensWithPools: 0
      }
    };
    
    try {
      fs.writeFileSync(TOKEN_LIST_FILE, JSON.stringify(initialData, null, 2));
      log(`📄 Created new TokenList database: ${TOKEN_LIST_FILE}`);
    } catch (error) {
      log(`❌ Error creating TokenList database: ${formatError(error)}`);
    }
  }
}

/**
 * Load the token list from database
 * @returns {Object} Token list data
 */
function loadTokenList() {
  try {
    if (!fs.existsSync(TOKEN_LIST_FILE)) {
      initializeTokenListDB();
    }
    
    const data = fs.readFileSync(TOKEN_LIST_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    log(`❌ Error loading TokenList database: ${formatError(error)}`);
    // Return empty structure if file is corrupted
    return {
      version: "1.0.0",
      lastUpdated: new Date().toISOString(),
      tokens: {},
      stats: {
        totalTokens: 0,
        tokensWithPools: 0
      }
    };
  }
}

/**
 * Save the token list to database
 * @param {Object} tokenListData - The token list data to save
 */
function saveTokenList(tokenListData) {
  try {
    // Update metadata
    tokenListData.lastUpdated = new Date().toISOString();
    tokenListData.stats.totalTokens = Object.keys(tokenListData.tokens).length;
    tokenListData.stats.tokensWithPools = Object.values(tokenListData.tokens)
      .filter(token => token.poolAddress && token.poolAddress !== '').length;
    
    fs.writeFileSync(TOKEN_LIST_FILE, JSON.stringify(tokenListData, null, 2));
  } catch (error) {
    log(`❌ Error saving TokenList database: ${formatError(error)}`);
  }
}

/**
 * Check if a token already exists in the database
 * @param {string} ticker - Token ticker/symbol
 * @param {string} contractAddress - Token contract address
 * @returns {boolean} True if token exists
 */
export function tokenExists(ticker, contractAddress) {
  const tokenList = loadTokenList();
  const tickerUpper = ticker.toUpperCase();
  const addressLower = contractAddress.toLowerCase();
  
  // Check if token exists by ticker and address combination
  const key = `${tickerUpper}_${addressLower}`;
  return tokenList.tokens.hasOwnProperty(key);
}

/**
 * Get token information from database
 * @param {string} ticker - Token ticker/symbol
 * @param {string} contractAddress - Token contract address
 * @returns {Object|null} Token data or null if not found
 */
export function getTokenInfo(ticker, contractAddress) {
  const tokenList = loadTokenList();
  const tickerUpper = ticker.toUpperCase();
  const addressLower = contractAddress.toLowerCase();
  
  const key = `${tickerUpper}_${addressLower}`;
  return tokenList.tokens[key] || null;
}

/**
 * Add or update token in the database
 * @param {string} ticker - Token ticker/symbol
 * @param {string} contractAddress - Token contract address
 * @param {string} poolAddress - Uniswap V2 pool address
 * @param {Object} additionalData - Additional token metadata
 */
export function addToken(ticker, contractAddress, poolAddress, additionalData = {}) {
  const tokenList = loadTokenList();
  const tickerUpper = ticker.toUpperCase();
  const addressLower = contractAddress.toLowerCase();
  
  const key = `${tickerUpper}_${addressLower}`;
  
  // Check if token already exists
  const exists = tokenList.tokens[key];
  if (exists) {
    log(`⚠️ Token ${ticker} (${contractAddress}) already exists in database`);
    // Update pool address if it wasn't set before
    if (!exists.poolAddress && poolAddress) {
      exists.poolAddress = poolAddress;
      exists.lastUpdated = new Date().toISOString();
      saveTokenList(tokenList);
      log(`✅ Updated pool address for ${ticker}`);
    }
    return exists;
  }
  
  // Add new token
  const tokenData = {
    ticker: tickerUpper,
    contractAddress: addressLower,
    poolAddress: poolAddress || '',
    dateAdded: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    hasPool: !!poolAddress,
    ...additionalData
  };
  
  tokenList.tokens[key] = tokenData;
  saveTokenList(tokenList);
  
  log(`✅ Added new token to database: ${ticker} (${contractAddress})`);
  return tokenData;
}

/**
 * Get all tokens from database
 * @returns {Object} All tokens
 */
export function getAllTokens() {
  const tokenList = loadTokenList();
  return tokenList.tokens;
}

/**
 * Get tokens by ticker
 * @param {string} ticker - Token ticker/symbol
 * @returns {Array} Array of tokens matching the ticker
 */
export function getTokensByTicker(ticker) {
  const tokenList = loadTokenList();
  const tickerUpper = ticker.toUpperCase();
  
  return Object.values(tokenList.tokens)
    .filter(token => token.ticker === tickerUpper);
}

/**
 * Get tokens with pools
 * @returns {Array} Array of tokens that have pool addresses
 */
export function getTokensWithPools() {
  const tokenList = loadTokenList();
  
  return Object.values(tokenList.tokens)
    .filter(token => token.hasPool && token.poolAddress);
}

/**
 * Get database statistics
 * @returns {Object} Database statistics
 */
export function getTokenListStats() {
  const tokenList = loadTokenList();
  
  const tokens = Object.values(tokenList.tokens);
  const tokensWithPools = tokens.filter(token => token.hasPool && token.poolAddress);
  const uniqueTickers = [...new Set(tokens.map(token => token.ticker))];
  
  return {
    totalTokens: tokens.length,
    tokensWithPools: tokensWithPools.length,
    uniqueTickers: uniqueTickers.length,
    tickers: uniqueTickers,
    lastUpdated: tokenList.lastUpdated,
    databaseFile: TOKEN_LIST_FILE
  };
}

/**
 * Remove token from database
 * @param {string} ticker - Token ticker/symbol
 * @param {string} contractAddress - Token contract address
 * @returns {boolean} True if token was removed
 */
export function removeToken(ticker, contractAddress) {
  const tokenList = loadTokenList();
  const tickerUpper = ticker.toUpperCase();
  const addressLower = contractAddress.toLowerCase();
  
  const key = `${tickerUpper}_${addressLower}`;
  
  if (tokenList.tokens[key]) {
    delete tokenList.tokens[key];
    saveTokenList(tokenList);
    log(`✅ Removed token from database: ${ticker} (${contractAddress})`);
    return true;
  } else {
    log(`⚠️ Token not found in database: ${ticker} (${contractAddress})`);
    return false;
  }
}

/**
 * Display database contents
 */
export function displayTokenList() {
  const tokenList = loadTokenList();
  const stats = getTokenListStats();
  
  log(`\n📊 TOKEN LIST DATABASE`);
  log(`======================`);
  log(`📄 Database: ${stats.databaseFile}`);
  log(`🪙 Total tokens: ${stats.totalTokens}`);
  log(`🏊 Tokens with pools: ${stats.tokensWithPools}`);
  log(`🎯 Unique tickers: ${stats.uniqueTickers}`);
  log(`🕒 Last updated: ${new Date(stats.lastUpdated).toLocaleString()}`);
  
  if (stats.totalTokens === 0) {
    log(`\n❌ No tokens in database yet`);
    return;
  }
  
  log(`\n📋 ALL TOKENS:`);
  log(`--------------`);
  
  const tokens = Object.values(tokenList.tokens);
  tokens.forEach((token, index) => {
    log(`\n${index + 1}. ${token.ticker}`);
    log(`   📍 Contract: ${token.contractAddress}`);
    log(`   🏊 Pool: ${token.poolAddress || 'No pool'}`);
    log(`   📅 Added: ${new Date(token.dateAdded).toLocaleString()}`);
    
    if (token.name) log(`   📛 Name: ${token.name}`);
    if (token.decimals) log(`   🔢 Decimals: ${token.decimals}`);
  });
}

/**
 * Search tokens in database
 * @param {string} searchTerm - Search term (ticker, address, or name)
 * @returns {Array} Array of matching tokens
 */
export function searchTokens(searchTerm) {
  const tokenList = loadTokenList();
  const searchLower = searchTerm.toLowerCase();
  
  return Object.values(tokenList.tokens).filter(token => 
    token.ticker.toLowerCase().includes(searchLower) ||
    token.contractAddress.toLowerCase().includes(searchLower) ||
    (token.name && token.name.toLowerCase().includes(searchLower))
  );
}

// Initialize database on import
initializeTokenListDB(); 