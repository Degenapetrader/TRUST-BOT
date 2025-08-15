import fs from 'fs/promises';

/*
=================================================================
TICKER DEDUPE FAST - SIMPLE DEDUPLICATION WITHOUT POOL CHECKING
=================================================================

FEATURES:
✅ Fast Deduplication: Removes duplicates without pool reserve checking
✅ First Instance Priority: Keeps the first occurrence of each ticker
✅ Backup Creation: Creates .backup files before deduplication
✅ Reliable Completion: No network calls, guaranteed to finish quickly
✅ Detailed Reporting: Shows before/after statistics

USAGE:
• npm run ticker:dedupe:fast            - Deduplicate all chains (fast)
• npm run ticker:dedupe:fast BASE       - Deduplicate BASE chain only (fast)
• npm run ticker:dedupe:fast ETH        - Deduplicate ETH chain only (fast)
• npm run ticker:dedupe:fast SOLANA     - Deduplicate SOLANA chain only (fast)

PURPOSE:
When pool checking is slow or failing, this provides a reliable way to remove
duplicates by keeping the first instance of each ticker symbol found.
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
 * Fast deduplicate tokens by keeping first instance of each ticker
 * @param {Array} tokens - Array of token objects
 * @param {string} chainName - Chain name for logging (BASE, ETH, SOLANA)
 * @returns {Array} - Deduplicated array of tokens
 */
function fastDeduplicate(tokens, chainName = 'UNKNOWN') {
    console.log(`\n🔄 Starting FAST deduplication process for ${chainName} chain...`);
    console.log(`📊 Input: ${tokens.length} tokens`);
    
    const seen = new Set();
    const deduplicatedTokens = [];
    const duplicatesRemoved = [];
    
    tokens.forEach(token => {
        const symbol = token.symbol?.toUpperCase();
        if (!symbol) {
            deduplicatedTokens.push(token);
            return;
        }
        
        if (!seen.has(symbol)) {
            // First occurrence of this ticker - keep it
            seen.add(symbol);
            deduplicatedTokens.push(token);
        } else {
            // Duplicate - mark for removal
            duplicatesRemoved.push(token);
        }
    });
    
    console.log(`🔍 Found ${duplicatesRemoved.length} duplicate token(s) to remove`);
    
    // Group duplicates by symbol for display
    const duplicateGroups = {};
    duplicatesRemoved.forEach(token => {
        const symbol = token.symbol?.toUpperCase();
        if (!duplicateGroups[symbol]) {
            duplicateGroups[symbol] = [];
        }
        duplicateGroups[symbol].push(token);
    });
    
    if (Object.keys(duplicateGroups).length > 0) {
        console.log(`📋 Duplicate tickers removed:`);
        Object.keys(duplicateGroups).forEach(symbol => {
            console.log(`   • ${symbol}: ${duplicateGroups[symbol].length} duplicate(s) removed`);
            duplicateGroups[symbol].forEach(token => {
                console.log(`     🗑️  Removed: ${token.tokenAddress}`);
            });
        });
    }
    
    console.log(`\n🎉 Fast deduplication completed for ${chainName} chain:`);
    console.log(`   📊 Original tokens: ${tokens.length}`);
    console.log(`   🗑️  Duplicates removed: ${duplicatesRemoved.length}`);
    console.log(`   ✅ Final tokens: ${deduplicatedTokens.length}`);
    
    return deduplicatedTokens;
}

/**
 * Deduplicate a single chain (fast mode)
 * @param {string} chainName - Chain name (BASE, ETH, SOLANA)
 */
async function deduplicateChainFast(chainName) {
    const filename = CHAIN_CONFIG[chainName];
    
    if (!filename) {
        console.log(`❌ Unknown chain: ${chainName}`);
        console.log(`   Available chains: ${Object.keys(CHAIN_CONFIG).join(', ')}`);
        return;
    }
    
    console.log(`\n🎯 FAST DEDUPLICATING CHAIN: ${chainName}`);
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
    
    // Fast deduplicate
    const deduplicatedTokens = fastDeduplicate(tokens, chainName);
    const duplicatesRemoved = tokens.length - deduplicatedTokens.length;
    
    // Save deduplicated data
    await saveData(filename, deduplicatedTokens);
    
    console.log(`\n✅ CHAIN FAST DEDUPLICATION COMPLETED: ${chainName}`);
    console.log(`   📊 Original tokens: ${tokens.length}`);
    console.log(`   🗑️  Duplicates removed: ${duplicatesRemoved}`);
    console.log(`   📊 Final tokens: ${deduplicatedTokens.length}`);
    console.log(`   💾 Updated: ${filename}`);
}

/**
 * Deduplicate all chains (fast mode)
 */
async function deduplicateAllChainsFast() {
    console.log(`\n🚀 FAST DEDUPLICATING ALL CHAINS`);
    console.log(`=================================`);
    
    let totalOriginal = 0;
    let totalFinal = 0;
    let totalRemoved = 0;
    
    for (const [chainName, filename] of Object.entries(CHAIN_CONFIG)) {
        const tokens = await loadExistingData(filename);
        
        if (tokens.length === 0) {
            console.log(`⚠️  Skipping ${chainName}: No tokens found`);
            continue;
        }
        
        console.log(`📊 ${chainName}: ${tokens.length} tokens loaded`);
        
        // Create backup
        await createBackup(filename);
        
        // Fast deduplicate
        const deduplicatedTokens = fastDeduplicate(tokens, chainName);
        const duplicatesRemoved = tokens.length - deduplicatedTokens.length;
        
        // Save deduplicated data
        await saveData(filename, deduplicatedTokens);
        
        console.log(`💾 Updated ${filename}: ${tokens.length} → ${deduplicatedTokens.length} tokens (${duplicatesRemoved} removed)`);
        
        totalOriginal += tokens.length;
        totalFinal += deduplicatedTokens.length;
        totalRemoved += duplicatesRemoved;
    }
    
    console.log(`\n🎉 ALL CHAINS FAST DEDUPLICATION COMPLETED`);
    console.log(`==========================================`);
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
        console.log(`⚡ TICKER FAST DEDUPLICATION TOOL`);
        console.log(`=================================`);
        console.log(``);
        console.log(`This tool quickly removes duplicate tickers by keeping the first`);
        console.log(`occurrence of each ticker symbol. No pool checking required.`);
        console.log(``);
        console.log(`Usage:`);
        console.log(`  npm run ticker:dedupe:fast              # Fast deduplicate all chains`);
        console.log(`  npm run ticker:dedupe:fast BASE         # Fast deduplicate BASE chain only`);
        console.log(`  npm run ticker:dedupe:fast ETH          # Fast deduplicate ETH chain only`);
        console.log(`  npm run ticker:dedupe:fast SOLANA       # Fast deduplicate SOLANA chain only`);
        console.log(``);
        console.log(`Features:`);
        console.log(`  • 🔍 Finds duplicate ticker symbols`);
        console.log(`  • ⚡ No network calls - instant completion`);
        console.log(`  • 🥇 Keeps first occurrence of each ticker`);
        console.log(`  • 📄 Creates backup files before processing`);
        console.log(`  • 📊 Provides detailed before/after statistics`);
        console.log(``);
        console.log(`Note: This does not check pool reserves. For reserve-based`);
        console.log(`deduplication, use 'npm run ticker:dedupe' instead.`);
        
        // Default to all chains
        await deduplicateAllChainsFast();
    } else if (Object.keys(CHAIN_CONFIG).includes(targetChain)) {
        // Deduplicate specific chain
        await deduplicateChainFast(targetChain);
    } else {
        console.log(`❌ Unknown chain: ${targetChain}`);
        console.log(`Available chains: ${Object.keys(CHAIN_CONFIG).join(', ')}`);
        process.exit(1);
    }
}

// Only run main if this file is executed directly
if (process.argv[1] && process.argv[1].endsWith('ticker-dedupe-fast.mjs')) {
    main().catch(console.error);
}

export { deduplicateChainFast, deduplicateAllChainsFast, fastDeduplicate }; 