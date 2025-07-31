import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { log } from './utils.js';

const execAsync = promisify(exec);

// Bid database file path
const BID_DB_FILE = 'bid.json';

// Load bid database from file
function loadBidDatabase() {
  try {
    if (fs.existsSync(BID_DB_FILE)) {
      const data = fs.readFileSync(BID_DB_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    log(`⚠️ Error loading bid database: ${error.message}`);
  }
  
  return [];
}

// Search token by symbol (ticker) in bid database
export function searchBidBySymbol(symbol) {
  const database = loadBidDatabase();
  const upperSymbol = symbol.toUpperCase();
  
  // Find exact match first
  let token = database.find(token => token.symbol && token.symbol.toUpperCase() === upperSymbol);
  
  // If no exact match, try partial match
  if (!token) {
    token = database.find(token => token.symbol && token.symbol.toUpperCase().includes(upperSymbol));
  }
  
  return token || null;
}

// Search token by address in bid database
export function searchBidByAddress(address) {
  const database = loadBidDatabase();
  const lowerAddress = address.toLowerCase();
  
  return database.find(token => 
    token.tokenAddress && token.tokenAddress.toLowerCase() === lowerAddress
  ) || null;
}

// Search token by LP address in bid database
export function searchBidByLPAddress(lpAddress) {
  const database = loadBidDatabase();
  const lowerLPAddress = lpAddress.toLowerCase();
  
  return database.find(token => 
    token.lpAddress && token.lpAddress.toLowerCase() === lowerLPAddress
  ) || null;
}

// Enhanced token resolution for BID-MODE using bid.json
export async function resolveBidToken(input) {
  log(`🎯 BID-MODE: Resolving token: ${input}`);
  
  // Step 1: Check if input is a token address (starts with 0x and is 42 characters)
  const isAddress = input.startsWith('0x') && input.length === 42;
  
  let tokenInfo = null;
  
  if (isAddress) {
    // Search by address first in bid database
    tokenInfo = searchBidByAddress(input);
    if (tokenInfo) {
      log(`✅ BID-MODE: Found token by address in bid database: ${tokenInfo.symbol}`);
      return {
        success: true,
        source: 'bid_db',
        address: tokenInfo.tokenAddress,
        symbol: tokenInfo.symbol,
        lpAddress: tokenInfo.lpAddress,
        name: tokenInfo.symbol, // Use symbol as name for now
        mcapInETH: tokenInfo.mcapInETH
      };
    }
  } else {
    // Search by symbol first in bid database
    tokenInfo = searchBidBySymbol(input);
    if (tokenInfo) {
      log(`✅ BID-MODE: Found token by symbol in bid database: ${tokenInfo.symbol} (${tokenInfo.tokenAddress})`);
      return {
        success: true,
        source: 'bid_db',
        address: tokenInfo.tokenAddress,
        symbol: tokenInfo.symbol,
        lpAddress: tokenInfo.lpAddress,
        name: tokenInfo.symbol,
        mcapInETH: tokenInfo.mcapInETH
      };
    }
  }
  
  // Step 2: If not found in bid database, try ticker search API (fallback)
  log(`📡 BID-MODE: Token not found in bid database, trying ticker search API...`);
  try {
    const searchTerm = isAddress ? input : input.toUpperCase();
    const { stdout } = await execAsync(`npm run ticker:search ${searchTerm}`, { 
      timeout: 30000,
      maxBuffer: 1024 * 1024 
    });
    
    // Parse the output to extract token information
    const lines = stdout.split('\n');
    let foundToken = null;
    
    for (const line of lines) {
      if (line.includes('Token Address:') || line.includes('Contract:')) {
        const addressMatch = line.match(/0x[a-fA-F0-9]{40}/);
        if (addressMatch) {
          foundToken = { address: addressMatch[0] };
        }
      }
      if (line.includes('Symbol:') && foundToken) {
        const symbolMatch = line.match(/Symbol:\s*([A-Z0-9]+)/i);
        if (symbolMatch) {
          foundToken.symbol = symbolMatch[1];
        }
      }
      if (line.includes('LP Address:') && foundToken) {
        const lpMatch = line.match(/0x[a-fA-F0-9]{40}/);
        if (lpMatch) {
          foundToken.lpAddress = lpMatch[0];
        }
      }
    }
    
    if (foundToken && foundToken.address) {
      log(`✅ BID-MODE: Found token via ticker search API: ${foundToken.symbol || 'Unknown'} (${foundToken.address})`);
      return {
        success: true,
        source: 'ticker_api',
        address: foundToken.address,
        symbol: foundToken.symbol || input.toUpperCase(),
        lpAddress: foundToken.lpAddress,
        name: foundToken.symbol || input.toUpperCase(),
        mcapInETH: null // No mcap info from ticker search
      };
    }
  } catch (error) {
    log(`⚠️ BID-MODE: Ticker search API failed: ${error.message}`);
  }
  
  // Step 3: If still not found, return failure
  log(`❌ BID-MODE: Token not found in bid database or ticker search API`);
  return {
    success: false,
    source: 'not_found',
    input: input,
    isAddress: isAddress
  };
}

// Get all tokens from bid database
export function getAllBidTokens() {
  return loadBidDatabase();
}

// Get bid database statistics
export function getBidDatabaseStats() {
  const database = loadBidDatabase();
  const uniqueSymbols = new Set();
  const uniqueAddresses = new Set();
  
  database.forEach(token => {
    if (token.symbol) uniqueSymbols.add(token.symbol.toUpperCase());
    if (token.tokenAddress) uniqueAddresses.add(token.tokenAddress.toLowerCase());
  });
  
  return {
    totalEntries: database.length,
    uniqueSymbols: uniqueSymbols.size,
    uniqueAddresses: uniqueAddresses.size,
    tokensWithLP: database.filter(token => token.lpAddress).length,
    tokensWithMcap: database.filter(token => token.mcapInETH).length
  };
}

// Search tokens by partial symbol match in bid database
export function searchBidPartialSymbol(partialSymbol, limit = 10) {
  const database = loadBidDatabase();
  const upperPartial = partialSymbol.toUpperCase();
  
  const matches = database.filter(token => 
    token.symbol && token.symbol.toUpperCase().includes(upperPartial)
  );
  
  // Sort by exact matches first, then by symbol length
  matches.sort((a, b) => {
    const aExact = a.symbol.toUpperCase() === upperPartial;
    const bExact = b.symbol.toUpperCase() === upperPartial;
    
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    
    return a.symbol.length - b.symbol.length;
  });
  
  return matches.slice(0, limit);
}

// Validate token address format
export function isValidTokenAddress(address) {
  return typeof address === 'string' && 
         address.startsWith('0x') && 
         address.length === 42 && 
         /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Check if input looks like a symbol/ticker
export function isLikelySymbol(input) {
  return typeof input === 'string' && 
         input.length >= 1 && 
         input.length <= 20 && 
         /^[A-Za-z0-9.]+$/.test(input) &&
         !isValidTokenAddress(input);
}

export { BID_DB_FILE }; 