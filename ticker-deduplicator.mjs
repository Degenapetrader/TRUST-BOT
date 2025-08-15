import { findPoolWithMetadata } from './find-pool.mjs';
import { ethers } from 'ethers';

/*
=================================================================
TICKER DEDUPLICATOR - VIRTUAL RESERVES BASED DEDUPLICATION
=================================================================

FEATURES:
✅ Duplicate Ticker Detection: Finds tokens with same symbol
✅ Pool Reserve Analysis: Uses find-pool.mjs to check VIRTUAL reserves
✅ Highest Liquidity Priority: Keeps token with most VIRTUAL in pool
✅ Multi-chain Support: Works with BASE, ETH, SOLANA databases
✅ Comprehensive Logging: Shows deduplication process step by step

USAGE:
• deduplicateByReserves(tokenArray, chainName) - Main function
• findDuplicateTickers(tokens) - Find duplicate symbols
• checkPoolReserves(tokenAddress) - Get VIRTUAL reserves for token

INTEGRATION:
• Called by all ticker commands after data processing
• Updates base.json, eth.json, sol.json with deduplicated data
• Ensures only highest liquidity tokens remain in database
=================================================================
*/

// VIRTUAL token address on Base (for pool checking)
const VIRTUAL_TOKEN_ADDRESS = "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b";

/**
 * Find duplicate tickers in token array
 * @param {Array} tokens - Array of token objects with symbol property
 * @returns {Object} - Object with ticker symbols as keys and arrays of duplicate tokens as values
 */
function findDuplicateTickers(tokens) {
    const tickerGroups = {};
    
    // Group tokens by ticker symbol
    tokens.forEach(token => {
        const symbol = token.symbol?.toUpperCase();
        if (symbol) {
            if (!tickerGroups[symbol]) {
                tickerGroups[symbol] = [];
            }
            tickerGroups[symbol].push(token);
        }
    });
    
    // Filter to only include groups with duplicates
    const duplicates = {};
    Object.keys(tickerGroups).forEach(symbol => {
        if (tickerGroups[symbol].length > 1) {
            duplicates[symbol] = tickerGroups[symbol];
        }
    });
    
    return duplicates;
}

/**
 * Check pool reserves for a token and get VIRTUAL amount
 * @param {string} tokenAddress - Token contract address
 * @returns {Promise<Object>} - Object with success, virtualReserves, and error info
 */
async function checkPoolReserves(tokenAddress) {
    return new Promise(async (resolve) => {
        // Set a timeout to prevent hanging
        const timeout = setTimeout(() => {
            console.log(`      ⏰ Timeout checking pool for: ${tokenAddress}`);
            resolve({
                success: false,
                virtualReserves: '0',
                error: 'Timeout after 10 seconds'
            });
        }, 10000); // 10 second timeout
        
        try {
            console.log(`      🔍 Checking pool reserves for: ${tokenAddress}`);
            
            // Use find-pool.mjs to get pool information
            const poolResult = await findPoolWithMetadata(tokenAddress, VIRTUAL_TOKEN_ADDRESS);
            
            clearTimeout(timeout); // Clear timeout on success
            
            if (!poolResult.success || !poolResult.poolAddress) {
                console.log(`      ❌ No pool found for: ${tokenAddress}`);
                resolve({
                    success: false,
                    virtualReserves: '0',
                    error: poolResult.message || poolResult.error || 'No pool found'
                });
                return;
            }
            
            // Get reserves from pool details
            const { poolDetails } = poolResult;
            const { token0, token1, reserves } = poolDetails;
            
            // Determine which reserve is VIRTUAL
            let virtualReserves = '0';
            if (token0.toLowerCase() === VIRTUAL_TOKEN_ADDRESS.toLowerCase()) {
                virtualReserves = reserves.reserve0;
            } else if (token1.toLowerCase() === VIRTUAL_TOKEN_ADDRESS.toLowerCase()) {
                virtualReserves = reserves.reserve1;
            } else {
                console.log(`      ⚠️  Pool found but no VIRTUAL pairing: ${poolResult.poolAddress}`);
                resolve({
                    success: false,
                    virtualReserves: '0',
                    error: 'Pool exists but not paired with VIRTUAL'
                });
                return;
            }
            
            // Convert to readable format
            const virtualAmount = ethers.formatEther(virtualReserves);
            console.log(`      ✅ VIRTUAL reserves: ${virtualAmount} VIRTUAL`);
            
            resolve({
                success: true,
                virtualReserves,
                virtualAmount,
                poolAddress: poolResult.poolAddress,
                tokenMetadata: poolResult.tokenMetadata
            });
            
        } catch (error) {
            clearTimeout(timeout); // Clear timeout on error
            console.log(`      ❌ Error checking pool reserves: ${error.message}`);
            resolve({
                success: false,
                virtualReserves: '0',
                error: error.message
            });
        }
    });
}

/**
 * Deduplicate tokens by keeping the one with highest VIRTUAL reserves
 * @param {Array} tokens - Array of token objects
 * @param {string} chainName - Chain name for logging (BASE, ETH, SOLANA)
 * @returns {Promise<Array>} - Deduplicated array of tokens
 */
async function deduplicateByReserves(tokens, chainName = 'UNKNOWN') {
    console.log(`\n🔄 Starting deduplication process for ${chainName} chain...`);
    console.log(`📊 Input: ${tokens.length} tokens`);
    
    // Step 1: Find duplicate tickers
    const duplicates = findDuplicateTickers(tokens);
    const duplicateCount = Object.keys(duplicates).length;
    
    if (duplicateCount === 0) {
        console.log(`✅ No duplicate tickers found in ${chainName} chain`);
        return tokens;
    }
    
    console.log(`🔍 Found ${duplicateCount} ticker(s) with duplicates:`);
    Object.keys(duplicates).forEach(symbol => {
        console.log(`   • ${symbol}: ${duplicates[symbol].length} instances`);
    });
    
    // Step 2: Process each duplicate group
    const deduplicatedTokens = [...tokens];
    let totalRemoved = 0;
    
    for (const [symbol, duplicateTokens] of Object.entries(duplicates)) {
        console.log(`\n🎯 Processing duplicates for ticker: ${symbol}`);
        console.log(`   📊 Found ${duplicateTokens.length} tokens with symbol ${symbol}`);
        
        // Step 3: Check pool reserves for each duplicate
        const reserveResults = [];
        
        for (let i = 0; i < duplicateTokens.length; i++) {
            const token = duplicateTokens[i];
            console.log(`   🔍 Checking token ${i + 1}/${duplicateTokens.length}: ${token.tokenAddress}`);
            
            const reserveResult = await checkPoolReserves(token.tokenAddress);
            reserveResults.push({
                token,
                ...reserveResult
            });
            
            // Add small delay to avoid overwhelming RPC
            if (i < duplicateTokens.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // Step 4: Find token with highest VIRTUAL reserves
        let bestToken = null;
        let highestReserves = 0n;
        
        console.log(`   📊 Reserve comparison for ${symbol}:`);
        reserveResults.forEach((result, index) => {
            const reserves = BigInt(result.virtualReserves || '0');
            const virtualAmount = result.virtualAmount || '0';
            
            console.log(`      ${index + 1}. ${result.token.tokenAddress}`);
            console.log(`         VIRTUAL reserves: ${virtualAmount} VIRTUAL`);
            
            if (result.success && reserves > highestReserves) {
                highestReserves = reserves;
                bestToken = result.token;
                console.log(`         🏆 NEW HIGHEST - This token selected`);
            } else if (!result.success) {
                console.log(`         ❌ ${result.error}`);
            } else {
                console.log(`         ⚠️  Lower reserves`);
            }
        });
        
        // Step 5: Remove all duplicates except the best one
        if (bestToken) {
            console.log(`   ✅ Keeping token with highest reserves: ${bestToken.tokenAddress}`);
            console.log(`      VIRTUAL reserves: ${ethers.formatEther(highestReserves)} VIRTUAL`);
            
            // Remove all duplicates except the best one
            const tokensToRemove = duplicateTokens.filter(token => 
                token.tokenAddress !== bestToken.tokenAddress
            );
            
            tokensToRemove.forEach(tokenToRemove => {
                const index = deduplicatedTokens.findIndex(t => 
                    t.tokenAddress === tokenToRemove.tokenAddress
                );
                if (index !== -1) {
                    deduplicatedTokens.splice(index, 1);
                    totalRemoved++;
                    console.log(`   🗑️  Removed: ${tokenToRemove.tokenAddress}`);
                }
            });
        } else {
            console.log(`   ⚠️  No token with valid pool found for ${symbol}`);
            console.log(`   📋  Keeping all instances (unable to determine best)`);
            
            // If no valid pools found, keep the first one and remove others
            // This prevents leaving duplicates when pool checking fails
            const firstToken = duplicateTokens[0];
            const tokensToRemove = duplicateTokens.slice(1);
            
            console.log(`   🎲 Defaulting to first token: ${firstToken.tokenAddress}`);
            
            tokensToRemove.forEach(tokenToRemove => {
                const index = deduplicatedTokens.findIndex(t => 
                    t.tokenAddress === tokenToRemove.tokenAddress
                );
                if (index !== -1) {
                    deduplicatedTokens.splice(index, 1);
                    totalRemoved++;
                    console.log(`   🗑️  Removed (default): ${tokenToRemove.tokenAddress}`);
                }
            });
        }
    }
    
    console.log(`\n🎉 Deduplication completed for ${chainName} chain:`);
    console.log(`   📊 Original tokens: ${tokens.length}`);
    console.log(`   🔍 Duplicate groups processed: ${duplicateCount}`);
    console.log(`   🗑️  Tokens removed: ${totalRemoved}`);
    console.log(`   ✅ Final tokens: ${deduplicatedTokens.length}`);
    
    return deduplicatedTokens;
}

/**
 * Batch deduplicate all chain databases
 * @param {Object} databases - Object with chain names as keys and token arrays as values
 * @returns {Promise<Object>} - Deduplicated databases object
 */
async function batchDeduplicate(databases) {
    console.log(`\n🚀 BATCH DEDUPLICATION ACROSS ALL CHAINS`);
    console.log(`============================================`);
    
    const deduplicatedDatabases = {};
    
    for (const [chainName, tokens] of Object.entries(databases)) {
        if (Array.isArray(tokens) && tokens.length > 0) {
            deduplicatedDatabases[chainName] = await deduplicateByReserves(tokens, chainName);
        } else {
            console.log(`⚠️  Skipping ${chainName}: No tokens to process`);
            deduplicatedDatabases[chainName] = tokens;
        }
    }
    
    console.log(`\n✅ BATCH DEDUPLICATION COMPLETED`);
    console.log(`=================================`);
    
    return deduplicatedDatabases;
}

export { 
    deduplicateByReserves, 
    findDuplicateTickers, 
    checkPoolReserves, 
    batchDeduplicate 
}; 