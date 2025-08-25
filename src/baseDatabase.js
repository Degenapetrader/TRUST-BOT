import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { log } from './utils.js';
import { runTickerSearchFallback } from './utils/externalCommands.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

// Base database file path
const BASE_DB_FILE = 'base.json';

// Load base database from file
function loadBaseDatabase() {
  try {
    // Build candidate paths in order of preference
    const candidates = [];
    
    // In packaged mode, prioritize writable locations over static resources
    if (process.resourcesPath) {
      // 1) userData directory (same dir as wallets.json) - WRITABLE
      try {
        if (process.env.WALLETS_DB_PATH) {
          const userDataDir = path.dirname(process.env.WALLETS_DB_PATH);
          candidates.push(path.join(userDataDir, BASE_DB_FILE));
        }
      } catch {}
      
      // 2) Current working directory - WRITABLE
      candidates.push(path.resolve(process.cwd(), BASE_DB_FILE));
      
      // 3) Electron resources paths (packaged) - READ-ONLY fallback
      const resourcesPath = process.resourcesPath;
      candidates.push(path.join(resourcesPath, 'app.asar.unpacked', BASE_DB_FILE));
      candidates.push(path.join(resourcesPath, BASE_DB_FILE));
      candidates.push(path.join(resourcesPath, 'app.asar', BASE_DB_FILE));
    } else {
      // Development mode - prioritize project directory
      // 1) Explicit current working directory
      candidates.push(path.resolve(process.cwd(), BASE_DB_FILE));
      // 2) userData directory (same dir as wallets.json if available)
      try {
        if (process.env.WALLETS_DB_PATH) {
          const userDataDir = path.dirname(process.env.WALLETS_DB_PATH);
          candidates.push(path.join(userDataDir, BASE_DB_FILE));
        }
      } catch {}
    }
    
    // 4) Relative to this module (dev/bundled fallbacks)
    candidates.push(path.join(__dirname, BASE_DB_FILE));
    candidates.push(path.join(__dirname, '..', BASE_DB_FILE));
    candidates.push(path.join(__dirname, '..', '..', BASE_DB_FILE));

    // Read first existing file
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          const data = fs.readFileSync(p, 'utf8');
          const parsed = JSON.parse(data);
          log(`📦 Loaded base database from: ${p} (${Array.isArray(parsed) ? parsed.length : 0} entries)`);
          return Array.isArray(parsed) ? parsed : [];
        }
      } catch (readErr) {
        log(`⚠️ Error reading candidate base.json at ${p}: ${readErr.message}`);
      }
    }
  } catch (error) {
    log(`⚠️ Error loading base database: ${error.message}`);
  }
  
  return [];
}

// Search token by symbol (ticker)
export function searchBySymbol(symbol) {
  const database = loadBaseDatabase();
  const normalize = (s) => String(s || '').trim().replace(/^\$/,'').toUpperCase();
  const want = normalize(symbol);
  
  // Find exact match first (normalized)
  let token = database.find(t => t.symbol && normalize(t.symbol) === want);
  
  // If no exact match, try partial match (normalized)
  if (!token) {
    token = database.find(t => t.symbol && normalize(t.symbol).includes(want));
  }
  
  return token || null;
}

// Search token by address
export function searchByAddress(address) {
  const database = loadBaseDatabase();
  const lowerAddress = address.toLowerCase();
  
  return database.find(token => 
    token.tokenAddress && token.tokenAddress.toLowerCase() === lowerAddress
  ) || null;
}

// Search token by LP address
export function searchByLPAddress(lpAddress) {
  const database = loadBaseDatabase();
  const lowerLPAddress = lpAddress.toLowerCase();
  
  return database.find(token => 
    token.lpAddress && token.lpAddress.toLowerCase() === lowerLPAddress
  ) || null;
}

// Enhanced token resolution with multiple fallbacks
export async function resolveToken(input) {
  log(`🔍 Resolving token: ${input}`);
  
  // Step 1: Check if input is a token address (starts with 0x and is 42 characters)
  const isAddress = input.startsWith('0x') && input.length === 42;
  
  let tokenInfo = null;
  
  if (isAddress) {
    // Search by address first
    tokenInfo = searchByAddress(input);
    if (tokenInfo) {
      log(`✅ Found token by address in base database: ${tokenInfo.symbol}`);
      return {
        success: true,
        source: 'base_db',
        address: tokenInfo.tokenAddress,
        symbol: tokenInfo.symbol,
        lpAddress: tokenInfo.lpAddress,
        name: tokenInfo.symbol // Use symbol as name for now
      };
    }
  } else {
    // Search by symbol first
    tokenInfo = searchBySymbol(input);
    if (tokenInfo) {
      log(`✅ Found token by symbol in base database: ${tokenInfo.symbol} (${tokenInfo.tokenAddress})`);
      return {
        success: true,
        source: 'base_db',
        address: tokenInfo.tokenAddress,
        symbol: tokenInfo.symbol,
        lpAddress: tokenInfo.lpAddress,
        name: tokenInfo.symbol
      };
    }
  }
  
  // Step 2: If not found in base database, try ticker search API
  log(`📡 Token not found in base database, trying ticker search API...`);
  try {
    const searchTerm = isAddress ? input : input.toUpperCase();
    const searchSuccess = await runTickerSearchFallback(searchTerm);
    if (!searchSuccess) {
      throw new Error('Ticker search failed');
    }
    // Re-read the database after ticker search to get updated data
    const updatedDb = loadBaseDatabase();
    // Try to find the token again in the updated database
    // Use the existing isAddress variable instead of redeclaring it
    let tokenInfo = null;
    
    if (isAddress) {
      tokenInfo = updatedDb.find(token => 
        token.tokenAddress && token.tokenAddress.toLowerCase() === input.toLowerCase()
      );
    } else {
      const normalize = (s) => String(s || '').trim().replace(/^\$/,'').toUpperCase();
      const want = normalize(input);
      tokenInfo = updatedDb.find(t => t.symbol && normalize(t.symbol) === want);
    }
    
    if (tokenInfo) {
      log(`✅ Found token in updated database: ${tokenInfo.symbol} (${tokenInfo.tokenAddress})`);
      return {
        success: true,
        source: 'base_db_updated',
        address: tokenInfo.tokenAddress,
        symbol: tokenInfo.symbol,
        lpAddress: tokenInfo.lpAddress,
        name: tokenInfo.symbol
      };
    }
    // If still not found, continue with fallback parsing (keeping original logic)
    const stdout = '';
    
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
      log(`✅ Found token via ticker search API: ${foundToken.symbol || 'Unknown'} (${foundToken.address})`);
      return {
        success: true,
        source: 'ticker_api',
        address: foundToken.address,
        symbol: foundToken.symbol || input.toUpperCase(),
        lpAddress: foundToken.lpAddress,
        name: foundToken.symbol || input.toUpperCase()
      };
    }
  } catch (error) {
    log(`⚠️ Ticker search API failed: ${error.message}`);
  }
  
  // Step 3: If still not found, return null to use Alchemy fallback
  log(`❌ Token not found in base database or ticker search API, will use Alchemy fallback`);
  return {
    success: false,
    source: 'not_found',
    input: input,
    isAddress: isAddress
  };
}

// Get all tokens from base database
export function getAllBaseTokens() {
  return loadBaseDatabase();
}

// Get database statistics
export function getBaseDatabaseStats() {
  const database = loadBaseDatabase();
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
    tokensWithLP: database.filter(token => token.lpAddress).length
  };
}

// Search tokens by partial symbol match
export function searchPartialSymbol(partialSymbol, limit = 10) {
  const database = loadBaseDatabase();
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

export { BASE_DB_FILE }; 