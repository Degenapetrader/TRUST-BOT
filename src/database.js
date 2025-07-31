import fs from 'fs';
import path from 'path';
import { log } from './utils.js';

// Database file path
const DB_FILE = 'detected-tokens.json';

// Load database from file
function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    log(`⚠️ Error loading database: ${error.message}`);
  }
  
  // Return empty database structure
  return {
    lastUpdated: null,
    tokens: {}
  };
}

// Save database to file
function saveDatabase(database) {
  try {
    database.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DB_FILE, JSON.stringify(database, null, 2));
    log(`💾 Database saved with ${Object.keys(database.tokens).length} tokens`);
    return true;
  } catch (error) {
    log(`❌ Error saving database: ${error.message}`);
    return false;
  }
}

// Add or update a token in the database
export function addToken(tokenAddress, tokenData) {
  const database = loadDatabase();
  
  const key = tokenAddress.toLowerCase();
  database.tokens[key] = {
    address: tokenAddress,
    symbol: tokenData.symbol,
    name: tokenData.name,
    decimals: tokenData.decimals,
    poolAddress: tokenData.poolAddress,
    balance: tokenData.balance,
    formattedBalance: tokenData.formattedBalance,
    walletsFound: tokenData.walletsFound || [],
    priceInVirtual: tokenData.priceInVirtual || 0,
    valueInVirtual: tokenData.valueInVirtual || 0,
    valueInUsd: tokenData.valueInUsd || 0,
    addedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  };
  
  saveDatabase(database);
  return true;
}

// Update token data
export function updateToken(tokenAddress, updateData) {
  const database = loadDatabase();
  const key = tokenAddress.toLowerCase();
  
  if (database.tokens[key]) {
    database.tokens[key] = {
      ...database.tokens[key],
      ...updateData,
      lastUpdated: new Date().toISOString()
    };
    saveDatabase(database);
    return true;
  }
  
  return false;
}

// Get all tokens from database
export function getAllTokens() {
  const database = loadDatabase();
  return database.tokens;
}

// Get a specific token from database
export function getToken(tokenAddress) {
  const database = loadDatabase();
  const key = tokenAddress.toLowerCase();
  return database.tokens[key] || null;
}

// Get tokens that have pools
export function getTokensWithPools() {
  const database = loadDatabase();
  return Object.values(database.tokens).filter(token => token.poolAddress && token.poolAddress !== '');
}

// Remove a token from database
export function removeToken(tokenAddress) {
  const database = loadDatabase();
  const key = tokenAddress.toLowerCase();
  
  if (database.tokens[key]) {
    delete database.tokens[key];
    saveDatabase(database);
    return true;
  }
  
  return false;
}

// Get database statistics
export function getDatabaseStats() {
  const database = loadDatabase();
  const tokens = Object.values(database.tokens);
  const tokensWithPools = tokens.filter(token => token.poolAddress && token.poolAddress !== '');
  const totalValueUsd = tokens.reduce((sum, token) => sum + (token.valueInUsd || 0), 0);
  const totalValueVirtual = tokens.reduce((sum, token) => sum + (token.valueInVirtual || 0), 0);
  
  return {
    totalTokens: tokens.length,
    tokensWithPools: tokensWithPools.length,
    totalValueUsd: totalValueUsd,
    totalValueVirtual: totalValueVirtual,
    lastUpdated: database.lastUpdated
  };
}

// Clear all tokens from database
export function clearDatabase() {
  const database = {
    lastUpdated: new Date().toISOString(),
    tokens: {}
  };
  
  saveDatabase(database);
  return true;
}

// Export database path for external access
export { DB_FILE }; 