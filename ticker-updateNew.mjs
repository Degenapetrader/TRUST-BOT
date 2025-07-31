import fs from 'fs/promises';
import fetch from 'node-fetch';
import { deduplicateByReserves, findDuplicateTickers } from './ticker-deduplicator.mjs';
import { tokenMeetsMarketCapRequirement } from './ticker-market-filter.mjs';

// Function to load existing data from file
async function loadExistingData(filename) {
    try {
        const data = await fs.readFile(filename, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.log(`No existing data found in ${filename}, starting fresh.`);
        return [];
    }
}

// Function to save data to file
async function saveData(filename, data) {
    await fs.writeFile(filename, JSON.stringify(data, null, 2));
}

// Function to fetch only new tokens (stops when encountering existing ones)
async function fetchNewTokensOnly() {
    const baseUrl = 'https://api.virtuals.io/api/virtuals';
    const chain = 'BASE'; // Only process BASE chain
    const outputFile = 'base.json';
    
    console.log(`\n--- Checking for NEW tokens in ${chain} chain ---`);
    
    // Load existing data
    const existingData = await loadExistingData(outputFile);
    const existingAddresses = new Set(existingData.map(item => item.tokenAddress));
    console.log(`📊 Current database has ${existingData.length} tokens for ${chain}`);
    
    const params = {
        'filters[status]': 2,
        'filters[chain]': chain,
        'sort[0]': 'lpCreatedAt:desc',
        'sort[1]': 'createdAt:desc',
        'populate[0]': 'image',
        'populate[1]': 'genesis',
        'populate[2]': 'creator',
        'pagination[page]': 1,
        'pagination[pageSize]': 25,
        'noCache': 0
    };
    
    const newTokens = [];
    let hasMore = true;
    let consecutiveExisting = 0;
    let excludedByMarketCap = 0;
    const maxConsecutiveExisting = 50; // Stop if we find 50 consecutive existing tokens
    
    console.log(`🔍 Searching for new tokens in ${chain}...`);
    console.log(`💰 Market Cap Filter: Excluding tokens < 50,000 VIRTUAL`);
    
    while (hasMore && consecutiveExisting < maxConsecutiveExisting) {
        try {
            const url = new URL(baseUrl);
            Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
            console.log(`   Checking page ${params['pagination[page]']}...`);
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            let foundNewInThisPage = false;
            
            for (const item of data.data) {
                const tokenData = {
                    symbol: item.symbol,
                    tokenAddress: item.tokenAddress,
                    lpAddress: item.lpAddress,
                    mcapInVirtual: item.mcapInVirtual || null
                };
                
                if (!existingAddresses.has(item.tokenAddress)) {
                    // Check market cap filter for new tokens
                    if (!tokenMeetsMarketCapRequirement(tokenData)) {
                        excludedByMarketCap++;
                        console.log(`   🚫 NEW but excluded: ${item.symbol} (Market cap: ${item.mcapInVirtual?.toFixed(2) || 'N/A'} VIRTUAL < 50,000)`);
                        consecutiveExisting++; // Count as processed but not added
                        continue;
                    }
                    
                    // New token found and passes market cap filter!
                    newTokens.push(tokenData);
                    existingAddresses.add(item.tokenAddress);
                    foundNewInThisPage = true;
                    consecutiveExisting = 0; // Reset counter
                    let logMessage = `   ✅ NEW: ${item.symbol} (${item.tokenAddress})`;
                    if (item.mcapInVirtual) {
                        logMessage += ` - ${item.mcapInVirtual.toFixed(2)} VIRTUAL`;
                    }
                    console.log(logMessage);
                } else {
                    consecutiveExisting++;
                    console.log(`   ⚠️  Exists: ${item.symbol}`);
                }
            }
            
            const { page, pageCount } = data.meta.pagination;
            hasMore = page < pageCount;
            params['pagination[page]'] = page + 1;
            
            if (!foundNewInThisPage) {
                console.log(`   ℹ️  No new tokens in page ${page}`);
            }
            
            if (!hasMore) {
                console.log(`   📄 Reached last page for ${chain}`);
            }
            
        } catch (error) {
            console.error(`❌ Error fetching data for ${chain}:`, error.message);
            break;
        }
    }
    
    if (consecutiveExisting >= maxConsecutiveExisting) {
        console.log(`   🛑 Stopped early: Found ${maxConsecutiveExisting} consecutive existing tokens`);
    }
    
    if (newTokens.length > 0) {
        // Add new tokens to existing data
        const updatedData = [...existingData, ...newTokens];
        
        console.log(`📊 Merged ${updatedData.length} total tokens (${newTokens.length} new tokens added)`);
        
        // Check if duplicates exist before running deduplication
        const duplicates = findDuplicateTickers(updatedData);
        const duplicateCount = Object.keys(duplicates).length;
        
        let finalData = updatedData;
        let duplicatesRemoved = 0;
        
        if (duplicateCount > 0) {
            console.log(`🔍 Found ${duplicateCount} ticker(s) with duplicates - running deduplication...`);
            Object.keys(duplicates).forEach(symbol => {
                console.log(`   • ${symbol}: ${duplicates[symbol].length} instances`);
            });
            
            // Apply VIRTUAL reserves-based deduplication
            console.log(`🔄 Starting deduplication by VIRTUAL reserves...`);
            const deduplicatedData = await deduplicateByReserves(updatedData, chain);
            duplicatesRemoved = updatedData.length - deduplicatedData.length;
            finalData = deduplicatedData;
            
            if (duplicatesRemoved > 0) {
                console.log(`🗑️  Removed ${duplicatesRemoved} duplicate ticker(s) with lower reserves`);
            }
        } else {
            console.log(`✅ No duplicate tickers found - skipping deduplication process`);
        }
        
        await saveData(outputFile, finalData);
        
        console.log(`💾 Updated ${outputFile}`);
        console.log(`   📈 Added ${newTokens.length} new tokens`);
        if (duplicatesRemoved > 0) {
            console.log(`   🗑️  Removed ${duplicatesRemoved} duplicates`);
        }
        console.log(`   📊 Final tokens: ${finalData.length}`);
    } else {
        console.log(`✅ No new tokens found for ${chain}`);
    }
    
    console.log(`\n🎉 Update completed!`);
    console.log(`📊 Total new tokens added: ${newTokens.length}`);
    if (excludedByMarketCap > 0) {
        console.log(`💰 Tokens excluded by market cap filter: ${excludedByMarketCap}`);
    }
    
    if (newTokens.length > 0) {
        console.log(`💡 Run other ticker commands to search or export data`);
    }
    
    return newTokens.length;
}

// Main function
async function main() {
    console.log('🚀 Starting NEW tokens only update for BASE chain...');
    console.log('💰 Market Cap Filter: Excludes tokens < 50,000 VIRTUAL');
    await fetchNewTokensOnly();
}

// Only run main if this file is executed directly
if (process.argv[1] && process.argv[1].endsWith('ticker-updateNew.mjs')) {
    main().catch(console.error);
}

export { fetchNewTokensOnly }; 