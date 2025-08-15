import fs from 'fs/promises';
import fetch from 'node-fetch';
import { deduplicateByReserves, findDuplicateTickers } from './ticker-deduplicator.mjs';
import { tokenMeetsMarketCapRequirement } from './ticker-market-filter.mjs';

/*
=================================================================
TICKER SEARCH - ENHANCED WITH CONTRACT ADDRESS SUPPORT
=================================================================

FEATURES:
✅ Ticker Symbol Search: npm run ticker:search VIRTUAL
✅ Contract Address Search: npm run ticker:search 0x1234...abcd
✅ Auto-detection: Automatically detects input type
✅ Multi-chain: Searches BASE, ETH, SOLANA chains
✅ Pool Discovery: Finds lpAddress for tokens
✅ Smart Updates: Updates existing entries with missing pool data
✅ Enhanced Logging: Clear success/failure indicators

USAGE EXAMPLES:
• npm run ticker:search VADER          (Find all VADER tokens)
• npm run ticker:search 0x0b3e...E1b   (Find pool for VIRTUAL token)
• npm run ticker:search TRUST          (Search by symbol)

INTEGRATION:
• Works with jeetbot REBUY mode for pool discovery
• Updates base.json, eth.json, sol.json databases
• Provides fallback for tokens not in database
=================================================================
*/

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

// Function to detect if input is a contract address
function isContractAddress(input) {
    // Check if input is a valid Ethereum address (42 chars, starts with 0x, valid hex)
    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    return addressRegex.test(input);
}

// Function to search for a specific ticker or contract address
async function searchTicker(searchInput) {
    const baseUrl = 'https://api.virtuals.io/api/virtuals';
    const chains = ['BASE', 'ETH', 'SOLANA'];
    const outputFiles = {
        'BASE': 'base.json',
        'ETH': 'eth.json',
        'SOLANA': 'sol.json'
    };
    
    let foundAny = false;
    const isContractAddr = isContractAddress(searchInput);
    const searchType = isContractAddr ? 'contract address' : 'ticker symbol';
    
    console.log(`🔍 Searching for ${searchType}: ${searchInput}`);
    
    for (const chain of chains) {
        console.log(`\n--- Searching in ${chain} chain ---`);
        
        // Build search parameters based on input type
        const params = {
            'filters[status]': 2,
            'filters[chain]': chain,
            'sort[0]': 'lpCreatedAt:desc',
            'sort[1]': 'createdAt:desc',
            'populate[0]': 'image',
            'populate[1]': 'genesis',
            'populate[2]': 'creator',
            'pagination[page]': 1,
            'pagination[pageSize]': 100,
            'noCache': 0
        };
        
        // Add appropriate search filter
        if (isContractAddr) {
            params['filters[tokenAddress][$eqi]'] = searchInput;
        } else {
            params['filters[symbol][$eqi]'] = searchInput;
        }
        
        try {
            const url = new URL(baseUrl);
            Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Filter results based on search type
            let matchingTokens;
            if (isContractAddr) {
                // For contract address search, look for exact tokenAddress match
                matchingTokens = data.data.filter(item => 
                    item.tokenAddress && item.tokenAddress.toLowerCase() === searchInput.toLowerCase()
                );
            } else {
                // For symbol search, look for exact symbol match
                matchingTokens = data.data.filter(item => 
                    item.symbol && item.symbol.toLowerCase() === searchInput.toLowerCase()
                );
            }
            
            if (matchingTokens.length > 0) {
                console.log(`✅ Found ${matchingTokens.length} matching token(s) in ${chain}`);
                
                // Load existing data
                const existingData = await loadExistingData(outputFiles[chain]);
                const existingAddresses = new Set(existingData.map(item => item.tokenAddress));
                
                let newAdded = 0;
                let excludedByMarketCap = 0;
                
                for (const token of matchingTokens) {
                    const tokenData = {
                        symbol: token.symbol,
                        tokenAddress: token.tokenAddress,
                        lpAddress: token.lpAddress,
                        name: token.name || token.symbol,
                        mcapInVirtual: token.mcapInVirtual || null
                    };
                    
                    // Check market cap filter
                    if (!tokenMeetsMarketCapRequirement(tokenData)) {
                        excludedByMarketCap++;
                        console.log(`  🚫 Excluded: ${token.symbol} (Market cap: ${token.mcapInVirtual?.toFixed(2) || 'N/A'} VIRTUAL < 50,000)`);
                        continue;
                    }
                    
                    if (!existingAddresses.has(token.tokenAddress)) {
                        existingData.push(tokenData);
                        existingAddresses.add(token.tokenAddress);
                        newAdded++;
                        console.log(`  ➕ Added: ${token.symbol} (${token.tokenAddress})`);
                        if (token.mcapInVirtual) {
                            console.log(`     💰 Market Cap: ${token.mcapInVirtual.toFixed(2)} VIRTUAL`);
                        }
                        if (token.lpAddress) {
                            console.log(`     🏊 Pool: ${token.lpAddress}`);
                        } else {
                            console.log(`     ⚠️  No pool address found`);
                        }
                    } else {
                        console.log(`  ⚠️  Already exists: ${token.symbol} (${token.tokenAddress})`);
                        // Update existing entry with any missing pool data
                        const existingIndex = existingData.findIndex(item => item.tokenAddress === token.tokenAddress);
                        if (existingIndex !== -1 && token.lpAddress && !existingData[existingIndex].lpAddress) {
                            existingData[existingIndex].lpAddress = token.lpAddress;
                            console.log(`     🔄 Updated pool address: ${token.lpAddress}`);
                            newAdded++; // Count as an update
                        }
                    }
                }
                
                // Show market cap filtering summary
                if (excludedByMarketCap > 0) {
                    console.log(`💰 Market cap filter excluded ${excludedByMarketCap} token(s) with < 50,000 VIRTUAL market cap`);
                }
                
                if (newAdded > 0) {
                    // Check if duplicates exist before running deduplication
                    const duplicates = findDuplicateTickers(existingData);
                    const duplicateCount = Object.keys(duplicates).length;
                    
                    let finalData = existingData;
                    let duplicatesRemoved = 0;
                    
                    if (duplicateCount > 0) {
                        console.log(`🔍 Found ${duplicateCount} ticker(s) with duplicates - running deduplication...`);
                        Object.keys(duplicates).forEach(symbol => {
                            console.log(`   • ${symbol}: ${duplicates[symbol].length} instances`);
                        });
                        
                        // Apply VIRTUAL reserves-based deduplication
                        const deduplicatedData = await deduplicateByReserves(existingData, chain);
                        duplicatesRemoved = existingData.length - deduplicatedData.length;
                        finalData = deduplicatedData;
                        
                        if (duplicatesRemoved > 0) {
                            console.log(`🗑️  Removed ${duplicatesRemoved} duplicate ticker(s) with lower reserves`);
                        }
                    } else {
                        console.log(`✅ No duplicate tickers found - skipping deduplication process`);
                    }
                    
                    await saveData(outputFiles[chain], finalData);
                    console.log(`💾 Updated ${outputFiles[chain]} with ${newAdded} new/updated token(s)`);
                    if (duplicatesRemoved > 0) {
                        console.log(`   🗑️  Also removed ${duplicatesRemoved} duplicates during deduplication`);
                    }
                }
                
                foundAny = true;
            } else {
                console.log(`❌ No tokens found for "${searchInput}" in ${chain}`);
            }
        } catch (error) {
            console.error(`❌ Error searching ${chain}:`, error.message);
        }
    }
    
    if (!foundAny) {
        console.log(`\n❌ No tokens found for "${searchInput}" in any chain`);
        if (isContractAddr) {
            console.log(`💡 Try searching by ticker symbol instead, or check if the contract address is correct`);
        } else {
            console.log(`💡 Try searching by contract address instead: npm run ticker:search 0x...`);
        }
    } else {
        console.log(`\n✅ Search completed for ${searchType}: "${searchInput}"`);
    }
}

// Main function to handle command line arguments
async function main() {
    const searchInput = process.argv[2];
    
    if (!searchInput) {
        console.log('❌ Please provide a ticker symbol or contract address to search for.');
        console.log('Usage: npm run ticker:search <TICKER_OR_CONTRACT_ADDRESS>');
        console.log('Examples:');
        console.log('  npm run ticker:search VIRTUAL                                    (Search by ticker)');
        console.log('  npm run ticker:search 0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b  (Search by contract address)');
        console.log('');
        console.log('Benefits:');
        console.log('  • Ticker search: Find all tokens with a specific symbol across chains');
        console.log('  • Contract address search: Find pool address for a specific token');
        console.log('  • Auto-detection: Automatically detects input type (ticker vs contract address)');
        process.exit(1);
    }
    
    await searchTicker(searchInput);
}

// Only run main if this file is executed directly
if (process.argv[1] && process.argv[1].endsWith('ticker-search.mjs')) {
    main().catch(console.error);
}

export { searchTicker }; 