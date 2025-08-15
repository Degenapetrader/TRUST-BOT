import { ethers } from 'ethers';
import { Alchemy, Network } from 'alchemy-sdk';
import { provider, ERC20_ABI, VIRTUAL_TOKEN_ADDRESS, NETWORK } from './config.js';
import { tradingWallets } from './wallets.js';
import { log, formatError } from './utils.js';
import { addToken, getAllTokens, getDatabaseStats } from './database.js';
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

// Function to save wallets database
function saveWalletsDB(data) {
  try {
    fs.writeFileSync(WALLETS_DB_PATH, JSON.stringify(data, null, 2));
    console.log('✅ Wallets database updated');
  } catch (error) {
    console.error(`❌ Error saving wallet database: ${error.message}`);
    throw error;
  }
}

// Function to add detected token to wallets.json configuration
function addDetectedTokenToConfig(tokenAddress, symbol, poolAddress) {
  try {
    const currentDB = loadWalletsDB();
    
    if (!currentDB.config.detectedTokens) {
      currentDB.config.detectedTokens = { enabled: [], watchList: [] };
    }
    
    // Add to watchList if not already present
    if (!currentDB.config.detectedTokens.watchList.includes(tokenAddress)) {
      currentDB.config.detectedTokens.watchList.push(tokenAddress);
      log(`📝 Added ${symbol} (${tokenAddress}) to watchList in wallets.json`);
    }
    
    saveWalletsDB(currentDB);
    return true;
  } catch (error) {
    log(`❌ Error updating wallets.json: ${error.message}`);
    return false;
  }
}

// Initialize Alchemy SDK using RPC URL from wallets.json
const alchemy = new Alchemy({
  apiKey: config.rpcUrl?.split('/').pop(), // Extract API key from RPC URL
  network: Network.BASE_MAINNET, // Base network
});

// Uniswap V2 Factory ABI for getting pair addresses
const UNISWAP_V2_FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];

// Uniswap V2 Pair ABI for getting reserves
const UNISWAP_V2_PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)"
];

// Uniswap V2 Factory address on Base
const UNISWAP_V2_FACTORY_ADDRESS = "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6";

// Create factory contract instance
const factoryContract = new ethers.Contract(UNISWAP_V2_FACTORY_ADDRESS, UNISWAP_V2_FACTORY_ABI, provider);

// Price feed for USD conversion (VIRTUAL/USDC pool or similar)
let virtualUsdPrice = 0;

// Function to get current USD price of VIRTUAL token
async function getVirtualUsdPrice() {
  try {
    // Try to get VIRTUAL/USDC pool for USD price
    const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
    const virtualUsdcPair = await factoryContract.getPair(VIRTUAL_TOKEN_ADDRESS, usdcAddress);
    
    if (virtualUsdcPair !== ethers.constants.AddressZero) {
      const pairContract = new ethers.Contract(virtualUsdcPair, UNISWAP_V2_PAIR_ABI, provider);
      const [reserves, token0] = await Promise.all([
        pairContract.getReserves(),
        pairContract.token0()
      ]);
      
      const isToken0Virtual = token0.toLowerCase() === VIRTUAL_TOKEN_ADDRESS.toLowerCase();
      const virtualReserve = isToken0Virtual ? reserves.reserve0 : reserves.reserve1;
      const usdcReserve = isToken0Virtual ? reserves.reserve1 : reserves.reserve0;
      
      if (!virtualReserve.eq(0)) {
        // 1 VIRTUAL = ? USDC (USDC has 6 decimals)
        const priceInUsdc = usdcReserve.mul(ethers.BigNumber.from(10).pow(18)).div(virtualReserve);
        virtualUsdPrice = parseFloat(ethers.formatUnits(priceInUsdc, 6));
        log(`💵 VIRTUAL/USD price: $${virtualUsdPrice.toFixed(4)}`);
        return virtualUsdPrice;
      }
    }
    
    // Fallback: assume VIRTUAL is roughly $1 if no USDC pool
    virtualUsdPrice = 1.0;
    log(`💵 VIRTUAL/USD price: $${virtualUsdPrice.toFixed(4)} (estimated)`);
    return virtualUsdPrice;
    
  } catch (error) {
    log(`⚠️ Could not get VIRTUAL/USD price: ${formatError(error)}`);
    virtualUsdPrice = 1.0; // Fallback to $1
    return virtualUsdPrice;
  }
}

// Function to get all token balances using Alchemy with parallel metadata fetching
async function getWalletTokenBalances(walletAddress) {
  try {
    log(`🔍 Fetching token balances for ${walletAddress}...`);
    
    // Get all token balances using Alchemy's efficient API
    const balances = await alchemy.core.getTokenBalances(walletAddress);
    
    log(`📋 Found ${balances.tokenBalances.length} tokens, processing in parallel...`);
    
    // Filter out zero balance tokens first
    const nonZeroTokens = balances.tokenBalances.filter(token => 
      token.contractAddress && token.tokenBalance !== '0x' && token.tokenBalance !== '0'
    );
    
    if (nonZeroTokens.length === 0) {
      log(`❌ No tokens with balance found`);
      return [];
    }
    
    // Process tokens in parallel batches of 30 (Alchemy best practice: batches under 50)
    const batchSize = 30;
    const significantTokens = [];
    
    for (let i = 0; i < nonZeroTokens.length; i += batchSize) {
      const batch = nonZeroTokens.slice(i, i + batchSize);
      log(`  📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(nonZeroTokens.length/batchSize)} (${batch.length} tokens)...`);
      
      // Fetch metadata for all tokens in batch concurrently
      const metadataPromises = batch.map(async (tokenBalance) => {
        try {
          const metadata = await alchemy.core.getTokenMetadata(tokenBalance.contractAddress);
          
          if (!metadata.decimals || !metadata.symbol) return null;
          
          const balance = ethers.BigNumber.from(tokenBalance.tokenBalance);
          const decimals = metadata.decimals;
          const formattedBalance = parseFloat(ethers.formatUnits(balance, decimals));
          
          // Only include tokens with >100 balance
          if (formattedBalance > 100) {
            return {
              address: tokenBalance.contractAddress,
              symbol: metadata.symbol,
              name: metadata.name || metadata.symbol,
              decimals: decimals,
              balance: balance,
              formattedBalance: formattedBalance
            };
          }
          return null;
        } catch (error) {
          // Skip tokens that fail metadata lookup
          return null;
        }
      });
      
      // Wait for all metadata requests in this batch to complete
      const batchResults = await Promise.allSettled(metadataPromises);
      
      // Process results
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          significantTokens.push(result.value);
          log(`    ✅ ${result.value.symbol}: ${result.value.formattedBalance.toFixed(2)} (>${100} threshold met)`);
        }
      });
      
      // Small delay between batches to be respectful to Alchemy
      if (i + batchSize < nonZeroTokens.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    log(`🎯 Found ${significantTokens.length} tokens with >100 balance`);
    return significantTokens;
    
  } catch (error) {
    log(`❌ Error fetching token balances: ${formatError(error)}`);
    return [];
  }
}

// Function to find Uniswap V2 pair for token vs VIRTUAL
async function findUniswapV2Pair(tokenAddress) {
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

    // Get pair details
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
      isToken0Virtual: isToken0Virtual
    };

  } catch (error) {
    // Skip tokens that fail pool lookup
    return null;
  }
}

// Function to calculate token values
function calculateTokenValues(tokenBalance, tokenDecimals, pairInfo) {
  if (!pairInfo || pairInfo.virtualReserve.eq(0) || pairInfo.tokenReserve.eq(0)) {
    return {
      valueInVirtual: 0,
      valueInUsd: 0,
      pricePerToken: 0
    };
  }

  // Price of 1 token in VIRTUAL
  const pricePerToken = pairInfo.virtualReserve.mul(ethers.BigNumber.from(10).pow(tokenDecimals)).div(pairInfo.tokenReserve);
  const pricePerTokenFormatted = parseFloat(ethers.formatUnits(pricePerToken, 18));
  
  // Total value of user's balance in VIRTUAL
  const valueInVirtual = tokenBalance.mul(pricePerToken).div(ethers.BigNumber.from(10).pow(tokenDecimals));
  const valueInVirtualFormatted = parseFloat(ethers.formatEther(valueInVirtual));
  
  // Total value in USD
  const valueInUsd = valueInVirtualFormatted * virtualUsdPrice;

  return {
    valueInVirtual: valueInVirtualFormatted,
    valueInUsd: valueInUsd,
    pricePerToken: pricePerTokenFormatted
  };
}

// Function to scan a single wallet for tokens with pools (optimized with parallel pool checking)
async function scanWalletForTokensWithPools(wallet, walletIndex) {
  log(`\n📱 Scanning Wallet B${walletIndex + 1}: ${wallet.address}`);
  log("==========================================");

  const tokensWithPools = [];
  
  // Get all significant token balances using Alchemy
  const tokens = await getWalletTokenBalances(wallet.address);
  
  if (tokens.length === 0) {
    log("❌ No tokens with >100 balance found");
    return tokensWithPools;
  }

  log(`\n🏊 Checking for Uniswap V2 pools vs VIRTUAL in parallel...`);
  
  // Check all tokens for pools in parallel batches
  const poolBatchSize = 20; // Smaller batch for pool checks as they involve contract calls
  
  for (let i = 0; i < tokens.length; i += poolBatchSize) {
    const batch = tokens.slice(i, i + poolBatchSize);
    log(`  🔍 Pool check batch ${Math.floor(i/poolBatchSize) + 1}/${Math.ceil(tokens.length/poolBatchSize)} (${batch.length} tokens)...`);
    
    // Check pools for all tokens in batch concurrently
    const poolPromises = batch.map(async (token) => {
      try {
        const pairInfo = await findUniswapV2Pair(token.address);
        return { token, pairInfo };
      } catch (error) {
        log(`    ⚠️ Error checking pool for ${token.symbol}: ${error.message}`);
        return { token, pairInfo: null };
      }
    });
    
    // Wait for all pool checks in this batch to complete
    const batchResults = await Promise.allSettled(poolPromises);
    
    // Process results
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const { token, pairInfo } = result.value;
        
        if (pairInfo) {
          // Calculate values
          const values = calculateTokenValues(token.balance, token.decimals, pairInfo);
          
          tokensWithPools.push({
            ...token,
            pairInfo: pairInfo,
            values: values,
            walletIndex: walletIndex
          });
          
          log(`    ✅ ${token.symbol} has pool: ${pairInfo.pairAddress.slice(0,8)}...`);
        } else {
          log(`    ❌ ${token.symbol} has no pool vs VIRTUAL`);
        }
      } else {
        log(`    ❌ Failed to check pool for token: ${result.reason}`);
      }
    });
    
    // Small delay between batches
    if (i + poolBatchSize < tokens.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return tokensWithPools;
}

// Main function to detect and display all tokens and their pools
export async function detectAndDisplayTokens() {
  log("🔍 COMPREHENSIVE TOKEN DETECTION WITH ALCHEMY");
  log("🎯 Scanning for tokens with >100 balance and Uniswap V2 pools vs VIRTUAL");
  log("=====================================================================");

  if (!VIRTUAL_TOKEN_ADDRESS) {
    log("❌ VIRTUAL_TOKEN_ADDRESS not configured in .env file");
    return new Map();
  }

  // Get VIRTUAL/USD price first
  await getVirtualUsdPrice();

  const allDetectedTokens = new Map();

  // Scan all wallets in parallel for maximum speed
  log(`🚀 Scanning ${tradingWallets.length} wallets in parallel...`);
  
  const walletPromises = tradingWallets.map(async (wallet, i) => {
    try {
      const tokensWithPools = await scanWalletForTokensWithPools(wallet, i);
      return { walletIndex: i, tokensWithPools };
    } catch (error) {
      log(`❌ Error scanning wallet B${i + 1}: ${error.message}`);
      return { walletIndex: i, tokensWithPools: [] };
    }
  });
  
  // Wait for all wallet scans to complete
  const walletResults = await Promise.allSettled(walletPromises);
  
  // Process all results and build token map
  walletResults.forEach((result, walletIndex) => {
    if (result.status === 'fulfilled') {
      const { walletIndex: i, tokensWithPools } = result.value;
      
      // Add to global map and save to database
      for (const token of tokensWithPools) {
        const key = token.address.toLowerCase();
        
        if (!allDetectedTokens.has(key)) {
          const tokenData = {
            ...token,
            walletsFound: [`B${i + 1}`]
          };
          allDetectedTokens.set(key, tokenData);
          
          // Save to database
          addToken(token.address, {
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            poolAddress: token.pairInfo.pairAddress,
            balance: token.balance,
            formattedBalance: token.formattedBalance,
            walletsFound: [`B${i + 1}`],
            priceInVirtual: token.values.pricePerToken,
            valueInVirtual: token.values.valueInVirtual,
            valueInUsd: token.values.valueInUsd
          });
          
          // Also add to wallets.json watchList for easy configuration
          addDetectedTokenToConfig(token.address, token.symbol, token.pairInfo.pairAddress);
        } else {
          const existing = allDetectedTokens.get(key);
          existing.walletsFound.push(`B${i + 1}`);
          
          // Update database with new wallet
          const currentToken = getAllTokens()[key];
          if (currentToken) {
            addToken(token.address, {
              ...currentToken,
              walletsFound: existing.walletsFound,
              formattedBalance: existing.formattedBalance + token.formattedBalance, // Aggregate balances
              valueInVirtual: existing.values.valueInVirtual + token.values.valueInVirtual,
              valueInUsd: existing.values.valueInUsd + token.values.valueInUsd
            });
          }
        }
      }
    } else {
      log(`❌ Failed to scan wallet B${walletIndex + 1}: ${result.reason}`);
    }
  });

  // Display comprehensive results
  log("\n🏆 TRADEABLE TOKENS FOUND");
  log("========================");

  if (allDetectedTokens.size === 0) {
    log("❌ No tradeable tokens found");
    log("\n💡 Requirements:");
    log("   - Token balance >100");
    log("   - Uniswap V2 pool exists vs VIRTUAL");
    log("   - Pool has liquidity");
    return allDetectedTokens;
  }

  let tokenIndex = 1;
  
  for (const [address, tokenData] of allDetectedTokens) {
    log(`\n🪙 TOKEN ${tokenIndex}: ${tokenData.name} (${tokenData.symbol})`);
    log(`   📍 Contract Address: ${address}`);
    log(`   👛 Found in wallets: ${tokenData.walletsFound.join(', ')}`);
    log(`   💰 Your Balance: ${tokenData.formattedBalance.toLocaleString()} ${tokenData.symbol}`);
    log(`   🏊 Pool Address: ${tokenData.pairInfo.pairAddress}`);
    log(`   💹 Current Price: ${tokenData.values.pricePerToken.toFixed(8)} VIRTUAL per ${tokenData.symbol}`);
    log(`   💎 Portfolio Value:`);
    log(`      ${tokenData.values.valueInVirtual.toFixed(2)} VIRTUAL`);
    log(`      $${tokenData.values.valueInUsd.toFixed(2)} USD`);
    log(`   💧 Pool Liquidity:`);
    log(`      ${parseFloat(ethers.formatEther(tokenData.pairInfo.virtualReserve)).toLocaleString()} VIRTUAL`);
    log(`      ${parseFloat(ethers.formatUnits(tokenData.pairInfo.tokenReserve, tokenData.decimals)).toLocaleString()} ${tokenData.symbol}`);
    
    log(`\n   📋 Token ready for wallets.json configuration:`);
    log(`      Address: ${address}`);
    log(`      Pool: ${tokenData.pairInfo.pairAddress}`);
    
    tokenIndex++;
  }

  log(`\n✅ Detection completed! Found ${allDetectedTokens.size} tradeable tokens`);
  log(`💰 Total portfolio value: $${Array.from(allDetectedTokens.values()).reduce((sum, token) => sum + token.values.valueInUsd, 0).toFixed(2)} USD`);
  
  // Display database statistics
  const dbStats = getDatabaseStats();
  log(`\n📊 DATABASE STATISTICS`);
  log(`======================`);
  log(`💾 Database file: detected-tokens.json`);
  log(`🪙 Total tokens stored: ${dbStats.totalTokens}`);
  log(`🏊 Tokens with pools: ${dbStats.tokensWithPools}`);
  log(`💰 Total value: ${dbStats.totalValueVirtual.toFixed(2)} VIRTUAL ($${dbStats.totalValueUsd.toFixed(2)} USD)`);
  log(`🕒 Last updated: ${new Date(dbStats.lastUpdated).toLocaleString()}`);
  log(`\n💡 Detected tokens have been added to wallets.json watchList`);
  log(`💡 Move tokens from watchList to enabled array in wallets.json to trade them`);
  log(`💡 Use "SELL ALL" strategy to sell all detected tokens to VIRTUAL`);
  
  return allDetectedTokens;
}

// Function to display just the summary of configured tokens
export async function displayTokenPoolSummary() {
  log("🏊 CONFIGURED TOKENS ANALYSIS");
  log("=============================");

  if (!VIRTUAL_TOKEN_ADDRESS) {
    log("❌ VIRTUAL_TOKEN_ADDRESS not configured in wallets.json");
    return;
  }

  // Get VIRTUAL/USD price
  await getVirtualUsdPrice();

  // Check configured tokens from wallets.json
  const detectedTokensConfig = config.detectedTokens || { enabled: [], watchList: [] };
  const configuredTokens = detectedTokensConfig.enabled.map((address, index) => ({
    key: `TOKEN${index + 1}`,
    address: address
  }));

  if (configuredTokens.length === 0) {
    log("❌ No tokens configured in wallets.json detectedTokens.enabled array");
    log("💡 Run full detection first: npm run detect");
    return;
  }

  for (const token of configuredTokens) {
    try {
      const metadata = await alchemy.core.getTokenMetadata(token.address);
      
      log(`\n🪙 ${metadata.symbol} (${token.key})`);
      log(`   📍 Address: ${token.address}`);
      
      const pairInfo = await findUniswapV2Pair(token.address);
      
      if (pairInfo) {
        // Get balance for first trading wallet
        const balance = await alchemy.core.getTokenBalances(tradingWallets[0].address, [token.address]);
        const tokenBalance = balance.tokenBalances[0] ? ethers.BigNumber.from(balance.tokenBalances[0].tokenBalance) : ethers.BigNumber.from(0);
        
        const values = calculateTokenValues(tokenBalance, metadata.decimals, pairInfo);
        
        log(`   ✅ Pool found: ${pairInfo.pairAddress}`);
        log(`   💰 Price: ${values.pricePerToken.toFixed(8)} VIRTUAL per ${metadata.symbol}`);
        log(`   💧 Liquidity:`);
        log(`      ${parseFloat(ethers.formatEther(pairInfo.virtualReserve)).toLocaleString()} VIRTUAL`);
        log(`      ${parseFloat(ethers.formatUnits(pairInfo.tokenReserve, metadata.decimals)).toLocaleString()} ${metadata.symbol}`);
      } else {
        log(`   ❌ No Uniswap V2 pool found vs VIRTUAL`);
      }
    } catch (error) {
      log(`   ❌ Error analyzing ${token.key}: ${formatError(error)}`);
    }
  }

  log("\n✅ Analysis completed!");
} 