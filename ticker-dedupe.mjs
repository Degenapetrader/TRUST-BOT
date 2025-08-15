import fs from 'fs/promises';
import { deduplicateByReserves, batchDeduplicate } from './ticker-deduplicator.mjs';

/*
=================================================================
TICKER DEDUPE - STANDALONE DEDUPLICATION COMMAND
=================================================================

FEATURES:
✅ Standalone Deduplication: Deduplicate existing databases without fetching new data
✅ Single Chain Mode: Deduplicate specific chain (BASE, ETH, SOLANA)
✅ Multi Chain Mode: Deduplicate all chains at once
✅ Backup Creation: Creates .backup files before deduplication
✅ Detailed Reporting: Shows before/after statistics

USAGE:
• npm run ticker:dedupe            - Deduplicate all chains
• npm run ticker:dedupe BASE       - Deduplicate BASE chain only
• npm run ticker:dedupe ETH        - Deduplicate ETH chain only
• npm run ticker:dedupe SOLANA     - Deduplicate SOLANA chain only

INTEGRATION:
• Uses ticker-deduplicator.mjs for VIRTUAL reserves-based deduplication
• Creates backups before processing for safety
• Updates base.json, eth.json, sol.json with deduplicated data
=================================================================
*/

// Chain configuration
const CHAIN_CONFIG = {
    'BASE': 'base.json',
    'ETH': 'eth.json',
    'SOLANA': 'sol.json'
};

/**
 * Load existing data from file
 * @param {string} filename - JSON file to load
 * @returns {Promise<Array>} - Array of token objects
 */
async function loadExistingData(filename) {
    try {
        const data = await fs.readFile(filename, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.log(`⚠️  No existing data found in ${filename}`);
        return [];
    }
}

/**
 * Save data to file
 * @param {string} filename - JSON file to save to
 * @param {Array} data - Array of token objects
 */
async function saveData(filename, data) {
    await fs.writeFile(filename, JSON.stringify(data, null, 2));
}

/**
 * Create backup of existing file
 * @param {string} filename - Original file to backup
 */
async function createBackup(filename) {
    try {
        const backupFilename = `${filename}.backup`;
        const data = await fs.readFile(filename, 'utf8');
        await fs.writeFile(backupFilename, data);
        console.log(`📄 Created backup: ${backupFilename}`);
    } catch (error) {
        console.log(`⚠️  Could not create backup for ${filename}: ${error.message}`);
    }
}

/**
 * Deduplicate a single chain
 * @param {string} chainName - Chain name (BASE, ETH, SOLANA)
 */
async function deduplicateChain(chainName) {
    const filename = CHAIN_CONFIG[chainName];
    
    if (!filename) {
        console.log(`❌ Unknown chain: ${chainName}`);
        console.log(`   Available chains: ${Object.keys(CHAIN_CONFIG).join(', ')}`);
        return;
    }
    
    console.log(`\n🎯 DEDUPLICATING CHAIN: ${chainName}`);
    console.log(`==========================================`);
    
    // Load existing data
    const tokens = await loadExistingData(filename);
    
    if (tokens.length === 0) {
        console.log(`⚠️  No tokens found in ${filename}, skipping...`);
        return;
    }
    
    console.log(`📊 Loaded ${tokens.length} tokens from ${filename}`);
    
    // Create backup
    await createBackup(filename);
    
    // Deduplicate
    const deduplicatedTokens = await deduplicateByReserves(tokens, chainName);
    const duplicatesRemoved = tokens.length - deduplicatedTokens.length;
    
    // Save deduplicated data
    await saveData(filename, deduplicatedTokens);
    
    console.log(`\n✅ CHAIN DEDUPLICATION COMPLETED: ${chainName}`);
    console.log(`   📊 Original tokens: ${tokens.length}`);
    console.log(`   🗑️  Duplicates removed: ${duplicatesRemoved}`);
    console.log(`   📊 Final tokens: ${deduplicatedTokens.length}`);
    console.log(`   💾 Updated: ${filename}`);
}

/**
 * Deduplicate all chains
 */
async function deduplicateAllChains() {
    console.log(`\n🚀 DEDUPLICATING ALL CHAINS`);
    console.log(`============================`);
    
    const databases = {};
    const originalCounts = {};
    
    // Load all databases
    for (const [chainName, filename] of Object.entries(CHAIN_CONFIG)) {
        const tokens = await loadExistingData(filename);
        databases[chainName] = tokens;
        originalCounts[chainName] = tokens.length;
        
        console.log(`📊 ${chainName}: ${tokens.length} tokens loaded`);
        
        // Create backup
        if (tokens.length > 0) {
            await createBackup(filename);
        }
    }
    
    // Batch deduplicate
    const deduplicatedDatabases = await batchDeduplicate(databases);
    
    // Save all databases
    let totalOriginal = 0;
    let totalFinal = 0;
    let totalRemoved = 0;
    
    for (const [chainName, deduplicatedTokens] of Object.entries(deduplicatedDatabases)) {
        const filename = CHAIN_CONFIG[chainName];
        const originalCount = originalCounts[chainName];
        const finalCount = deduplicatedTokens.length;
        const removedCount = originalCount - finalCount;
        
        if (originalCount > 0) {
            await saveData(filename, deduplicatedTokens);
            console.log(`💾 Updated ${filename}: ${originalCount} → ${finalCount} tokens (${removedCount} removed)`);
        }
        
        totalOriginal += originalCount;
        totalFinal += finalCount;
        totalRemoved += removedCount;
    }
    
    console.log(`\n🎉 ALL CHAINS DEDUPLICATION COMPLETED`);
    console.log(`=====================================`);
    console.log(`📊 Total original tokens: ${totalOriginal}`);
    console.log(`🗑️  Total duplicates removed: ${totalRemoved}`);
    console.log(`📊 Total final tokens: ${totalFinal}`);
    console.log(`📁 Files updated: ${Object.values(CHAIN_CONFIG).join(', ')}`);
}

/**
 * Main function
 */
async function main() {
    const targetChain = process.argv[2]?.toUpperCase();
    
    if (!targetChain) {
        console.log(`🔧 TICKER DEDUPLICATION TOOL`);
        console.log(`============================`);
        console.log(``);
        console.log(`This tool deduplicates ticker databases by keeping only the token`);
        console.log(`with the highest VIRTUAL reserves for each duplicate ticker symbol.`);
        console.log(``);
        console.log(`Usage:`);
        console.log(`  npm run ticker:dedupe              # Deduplicate all chains`);
        console.log(`  npm run ticker:dedupe BASE         # Deduplicate BASE chain only`);
        console.log(`  npm run ticker:dedupe ETH          # Deduplicate ETH chain only`);
        console.log(`  npm run ticker:dedupe SOLANA       # Deduplicate SOLANA chain only`);
        console.log(``);
        console.log(`Features:`);
        console.log(`  • 🔍 Finds duplicate ticker symbols`);
        console.log(`  • 🏊 Checks Uniswap V2 pool reserves via find-pool.mjs`);
        console.log(`  • 🏆 Keeps token with highest VIRTUAL reserves`);
        console.log(`  • 📄 Creates backup files before processing`);
        console.log(`  • 📊 Provides detailed before/after statistics`);
        console.log(``);
        console.log(`Example Output:`);
        console.log(`  📊 Found 3 ticker(s) with duplicates:`);
        console.log(`     • TRUST: 2 instances`);
        console.log(`     • VADER: 3 instances`);
        console.log(`  🏆 Keeping tokens with highest VIRTUAL reserves`);
        console.log(`  🗑️  Removed 3 duplicate ticker(s) with lower reserves`);
        
        // Default to all chains
        await deduplicateAllChains();
    } else if (Object.keys(CHAIN_CONFIG).includes(targetChain)) {
        // Deduplicate specific chain
        await deduplicateChain(targetChain);
    } else {
        console.log(`❌ Unknown chain: ${targetChain}`);
        console.log(`Available chains: ${Object.keys(CHAIN_CONFIG).join(', ')}`);
        process.exit(1);
    }
}

// Only run main if this file is executed directly
if (process.argv[1] && process.argv[1].endsWith('ticker-dedupe.mjs')) {
    main().catch(console.error);
}

export { deduplicateChain, deduplicateAllChains }; 