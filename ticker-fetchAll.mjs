import fs from 'fs/promises';
import fetch from 'node-fetch';
import { deduplicateByReserves, findDuplicateTickers } from './ticker-deduplicator.mjs';
import { processTokensWithMarketCapFilter } from './ticker-market-filter.mjs';

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

// Function to merge and deduplicate data
function mergeAndDeduplicate(existingData, newData) {
    const merged = [...existingData];
    const existingAddresses = new Set(existingData.map(item => item.tokenAddress));
    
    newData.forEach(newItem => {
        if (!existingAddresses.has(newItem.tokenAddress)) {
            merged.push(newItem);
            existingAddresses.add(newItem.tokenAddress);
        }
    });
    
    return merged;
}

async function fetchAllVirtuals() {
    const baseUrl = 'https://api.virtuals.io/api/virtuals';
    const chains = ['BASE', 'ETH', 'SOLANA'];
    const outputFiles = {
        'BASE': 'base.json',
        'ETH': 'eth.json',
        'SOLANA': 'sol.json'
    };
    
    for (const chain of chains) {
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
        
        // Load existing data
        const existingData = await loadExistingData(outputFiles[chain]);
        console.log(`📊 ${chain}: Loaded ${existingData.length} existing records`);
        
        const newResults = [];
        let hasMore = true;
        console.log(`🔍 ${chain}: Fetching new data...`);
        
        while (hasMore) {
            try {
                const url = new URL(baseUrl);
                Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
                console.log(`   📄 ${chain}: Fetching page ${params['pagination[page]']}...`);
                
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const data = await response.json();
                
                // Process tokens with market cap filtering (50k VIRTUAL minimum)
                const filteredVirtuals = processTokensWithMarketCapFilter(data.data, chain);
                
                newResults.push(...filteredVirtuals);
                const { page, pageCount } = data.meta.pagination;
                console.log(`   ✅ ${chain}: Page ${page}/${pageCount} - ${filteredVirtuals.length} tokens fetched (after market cap filter)`);
                hasMore = page < pageCount;
                params['pagination[page]'] = page + 1;
                
                if (!hasMore) {
                    console.log(`🏁 ${chain}: All pages fetched`);
                }
            } catch (error) {
                console.error(`Error fetching data for ${chain}:`, error);
                break;
            }
        }
        
        if (newResults.length > 0) {
            try {
                // Merge new data with existing data and remove duplicates
                const mergedData = mergeAndDeduplicate(existingData, newResults);
                const newEntriesAdded = mergedData.length - existingData.length;
                
                console.log(`📊 ${chain}: Merged ${mergedData.length} total records (${newEntriesAdded} new entries added)`);
                
                // Check if duplicates exist before running deduplication
                const duplicates = findDuplicateTickers(mergedData);
                const duplicateCount = Object.keys(duplicates).length;
                
                let finalData = mergedData;
                let duplicatesRemoved = 0;
                
                if (duplicateCount > 0) {
                    console.log(`🔍 ${chain}: Found ${duplicateCount} ticker(s) with duplicates - running deduplication...`);
                    Object.keys(duplicates).forEach(symbol => {
                        console.log(`   • ${symbol}: ${duplicates[symbol].length} instances`);
                    });
                    
                    // Apply VIRTUAL reserves-based deduplication
                    console.log(`🔄 ${chain}: Starting deduplication by VIRTUAL reserves...`);
                    const deduplicatedData = await deduplicateByReserves(mergedData, chain);
                    duplicatesRemoved = mergedData.length - deduplicatedData.length;
                    finalData = deduplicatedData;
                    
                    if (duplicatesRemoved > 0) {
                        console.log(`🗑️  ${chain}: Removed ${duplicatesRemoved} duplicate ticker(s) with lower reserves`);
                    }
                } else {
                    console.log(`✅ ${chain}: No duplicate tickers found - skipping deduplication process`);
                }
                
                await fs.writeFile(outputFiles[chain], JSON.stringify(finalData, null, 2));
                console.log(`💾 ${chain}: Updated ${outputFiles[chain]}`);
                console.log(`   📊 Final records: ${finalData.length}${duplicatesRemoved > 0 ? ' (after deduplication)' : ''}`);
            } catch (error) {
                console.error(`❌ ${chain}: Error writing to ${outputFiles[chain]}:`, error);
            }
        } else {
            console.log(`⚠️  ${chain}: No new data fetched`);
        }
    }
    console.log('🎯 Finished processing all chains (BASE, ETH, SOLANA)');
}

// Main function
async function main() {
    console.log('🚀 TICKER DATA FETCH ALL - COMPLETE DATABASE REFRESH');
    console.log('====================================================');
    console.log('📊 This will fetch all Virtual tokens data from API');
    console.log('🔗 Chains: BASE, ETH, SOLANA');
    console.log('💰 Market Cap Filter: Excludes tokens < 50,000 VIRTUAL');
    console.log('🔄 Includes automatic deduplication by VIRTUAL reserves');
    console.log('📁 Output: base.json, eth.json, sol.json');
    console.log('');
    
    await fetchAllVirtuals();
}

// Only run main if this file is executed directly
if (process.argv[1] && process.argv[1].endsWith('ticker-fetchAll.mjs')) {
    main().catch(console.error);
}

export { fetchAllVirtuals }; 