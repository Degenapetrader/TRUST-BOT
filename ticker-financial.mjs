import fs from 'fs/promises';
import fetch from 'node-fetch';
import { deduplicateByReserves, findDuplicateTickers } from './ticker-deduplicator.mjs';

/*
=================================================================
TICKER FINANCIAL DATA - ENHANCED WITH FDV & MARKET METRICS
=================================================================

FEATURES:
✅ Complete Financial Data: Market cap, volume, price changes, FDV
✅ FDV Calculation: Total supply from tokenomics × current price
✅ Multi-chain Support: BASE, ETH, SOLANA chains
✅ Enhanced Database: Includes financial metrics in JSON output
✅ Real-time Metrics: 24h volume, price changes, holder count
✅ Tokenomics Analysis: Token allocation breakdown and supply calculation

USAGE EXAMPLES:
• npm run ticker:financial                     (Fetch with financial data)
• npm run ticker:financial BASE               (BASE chain only)
• npm run ticker:financial SYMBOL             (Search specific token)

OUTPUT STRUCTURE:
{
  "symbol": "DARE",
  "tokenAddress": "0x123...",
  "lpAddress": "0x456...",
  "name": "Daredevil",
  "mcapInVirtual": 356541.21,
  "priceChangePercent24h": -16.35,
  "volume24h": 20006,
  "holderCount": 18806,
  "totalValueLocked": "43744",
  "totalSupply": "500000000",
  "fdvInVirtual": 425000.50,
  "priceInVirtual": 0.00085,
  "tokenomics": [...],
  "lastUpdated": "2025-01-08T..."
}

INTEGRATION:
• Enhances existing ticker database with financial metrics
• Maintains compatibility with existing bot systems
• Provides FDV data for trading decisions and analysis
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

// Function to calculate total supply from tokenomics
function calculateTotalSupply(tokenomics) {
    if (!tokenomics || !Array.isArray(tokenomics)) {
        return null;
    }
    
    let totalSupply = 0;
    tokenomics.forEach(allocation => {
        if (allocation.amount) {
            totalSupply += parseInt(allocation.amount);
        }
    });
    
    return totalSupply > 0 ? totalSupply.toString() : null;
}

// Function to calculate current price from market cap and total supply
function calculatePriceInVirtual(mcapInVirtual, totalSupply) {
    if (!mcapInVirtual || !totalSupply) {
        return null;
    }
    
    const supply = parseInt(totalSupply);
    if (supply <= 0) return null;
    
    return mcapInVirtual / supply;
}

// Function to calculate FDV
function calculateFDV(totalSupply, priceInVirtual) {
    if (!totalSupply || !priceInVirtual) {
        return null;
    }
    
    const supply = parseInt(totalSupply);
    if (supply <= 0) return null;
    
    return supply * priceInVirtual;
}

// Function to process token data with financial metrics
function processTokenWithFinancials(token) {
    const totalSupply = calculateTotalSupply(token.tokenomics);
    const priceInVirtual = calculatePriceInVirtual(token.mcapInVirtual, totalSupply);
    const fdvInVirtual = calculateFDV(totalSupply, priceInVirtual);
    
    return {
        // Basic token data
        symbol: token.symbol,
        tokenAddress: token.tokenAddress,
        lpAddress: token.lpAddress,
        name: token.name || token.symbol,
        
        // Financial metrics
        mcapInVirtual: token.mcapInVirtual || null,
        priceChangePercent24h: token.priceChangePercent24h || null,
        volume24h: token.volume24h || null,
        holderCount: token.holderCount || null,
        totalValueLocked: token.totalValueLocked || null,
        
        // Calculated metrics
        totalSupply: totalSupply,
        priceInVirtual: priceInVirtual,
        fdvInVirtual: fdvInVirtual,
        
        // Additional data
        tokenomics: token.tokenomics || null,
        lastUpdated: new Date().toISOString(),
        
        // Metadata
        category: token.category || null,
        role: token.role || null,
        isVerified: token.isVerified || false,
        level: token.level || null
    };
}

// Function to fetch financial data for all tokens or specific search
async function fetchFinancialData(chainFilter = null, searchSymbol = null) {
    const baseUrl = 'https://api.virtuals.io/api/virtuals';
    const chains = chainFilter ? [chainFilter.toUpperCase()] : ['BASE', 'ETH', 'SOLANA'];
    const outputFiles = {
        'BASE': 'base-financial.json',
        'ETH': 'eth-financial.json',
        'SOLANA': 'sol-financial.json'
    };
    
    console.log('💰 TICKER FINANCIAL DATA - ENHANCED WITH FDV & MARKET METRICS');
    console.log('=============================================================');
    console.log('📊 Fetching complete financial data from Virtuals.io API');
    console.log('🔗 Chains:', chains.join(', '));
    if (searchSymbol) {
        console.log('🔍 Searching for symbol:', searchSymbol);
    }
    console.log('💎 Includes: Market cap, FDV, volume, price changes, tokenomics');
    console.log('📁 Output: Enhanced JSON files with financial metrics\n');
    
    for (const chain of chains) {
        console.log(`📊 ${chain}: Processing financial data...`);
        
        // Load existing data
        const existingData = await loadExistingData(outputFiles[chain]);
        console.log(`📊 ${chain}: Loaded ${existingData.length} existing records`);
        
        let allTokens = [];
        let page = 1;
        let hasMorePages = true;
        
        while (hasMorePages) {
            console.log(`   📄 ${chain}: Fetching page ${page}...`);
            
            const params = {
                'filters[status]': 2,
                'filters[chain]': chain,
                'sort[0]': 'lpCreatedAt:desc',
                'sort[1]': 'createdAt:desc',
                'populate[0]': 'image',
                'populate[1]': 'genesis',
                'populate[2]': 'creator',
                'pagination[page]': page,
                'pagination[pageSize]': 25,
                'noCache': 0
            };
            
            // Add symbol filter if searching
            if (searchSymbol) {
                params['filters[symbol][$eqi]'] = searchSymbol;
            }
            
            try {
                const url = new URL(baseUrl);
                Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
                
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const data = await response.json();
                
                if (data.data && data.data.length > 0) {
                    allTokens.push(...data.data);
                    console.log(`   ✅ ${chain}: Page ${page}/${data.meta?.pagination?.pageCount || '?'} - ${data.data.length} tokens fetched`);
                    
                    // Check if there are more pages
                    hasMorePages = page < (data.meta?.pagination?.pageCount || 0);
                    page++;
                    
                    // For search, stop after finding results
                    if (searchSymbol && data.data.length > 0) {
                        hasMorePages = false;
                    }
                } else {
                    hasMorePages = false;
                }
            } catch (error) {
                console.error(`❌ ${chain}: Error fetching page ${page}:`, error.message);
                hasMorePages = false;
            }
        }
        
        console.log(`🏁 ${chain}: All pages fetched`);
        
        if (allTokens.length > 0) {
            // Process tokens with financial data
            console.log(`💰 ${chain}: Processing ${allTokens.length} tokens with financial metrics...`);
            
            const processedTokens = allTokens.map(token => processTokenWithFinancials(token));
            
            // Merge with existing data (replace duplicates)
            const existingAddresses = new Set(existingData.map(item => item.tokenAddress));
            const updatedTokens = [...existingData];
            let newAdded = 0;
            let updated = 0;
            
            processedTokens.forEach(token => {
                if (!existingAddresses.has(token.tokenAddress)) {
                    updatedTokens.push(token);
                    newAdded++;
                } else {
                    // Update existing token with new financial data
                    const existingIndex = updatedTokens.findIndex(item => item.tokenAddress === token.tokenAddress);
                    if (existingIndex !== -1) {
                        updatedTokens[existingIndex] = token;
                        updated++;
                    }
                }
            });
            
            // Check for duplicates and deduplicate if needed
            const duplicates = findDuplicateTickers(updatedTokens);
            const duplicateCount = Object.keys(duplicates).length;
            
            let finalData = updatedTokens;
            let duplicatesRemoved = 0;
            
            if (duplicateCount > 0) {
                console.log(`🔍 ${chain}: Found ${duplicateCount} ticker(s) with duplicates - running deduplication...`);
                Object.keys(duplicates).forEach(symbol => {
                    console.log(`   • ${symbol}: ${duplicates[symbol].length} instances`);
                });
                
                const deduplicatedData = await deduplicateByReserves(updatedTokens, chain);
                duplicatesRemoved = updatedTokens.length - deduplicatedData.length;
                finalData = deduplicatedData;
                
                if (duplicatesRemoved > 0) {
                    console.log(`🗑️  ${chain}: Removed ${duplicatesRemoved} duplicate ticker(s) with lower reserves`);
                }
            } else {
                console.log(`✅ ${chain}: No duplicate tickers found - skipping deduplication`);
            }
            
            // Save enhanced data
            await saveData(outputFiles[chain], finalData);
            
            console.log(`📊 ${chain}: Enhanced database statistics:`);
            console.log(`   📈 New tokens added: ${newAdded}`);
            console.log(`   🔄 Existing tokens updated: ${updated}`);
            if (duplicatesRemoved > 0) {
                console.log(`   🗑️  Duplicates removed: ${duplicatesRemoved}`);
            }
            console.log(`   💾 Total tokens: ${finalData.length}`);
            console.log(`   📁 Saved to: ${outputFiles[chain]}`);
            
            // Show sample financial data
            const samplesWithFDV = finalData.filter(t => t.fdvInVirtual).slice(0, 3);
            if (samplesWithFDV.length > 0) {
                console.log(`\n💎 Sample financial data (${chain}):`);
                samplesWithFDV.forEach(token => {
                    console.log(`   🪙 ${token.symbol} (${token.name})`);
                    console.log(`      💰 Market Cap: ${token.mcapInVirtual?.toFixed(2) || 'N/A'} VIRTUAL`);
                    console.log(`      💎 FDV: ${token.fdvInVirtual?.toFixed(2) || 'N/A'} VIRTUAL`);
                    console.log(`      📊 24h Change: ${token.priceChangePercent24h?.toFixed(2) || 'N/A'}%`);
                    console.log(`      📈 24h Volume: ${token.volume24h?.toLocaleString() || 'N/A'}`);
                    console.log(`      👥 Holders: ${token.holderCount?.toLocaleString() || 'N/A'}`);
                });
            }
            
        } else {
            console.log(`❌ ${chain}: No tokens found`);
        }
        
        console.log(''); // Add spacing between chains
    }
    
    console.log('✅ Financial data fetch completed!');
    console.log('\n💡 Enhanced files created:');
    chains.forEach(chain => {
        console.log(`   📁 ${outputFiles[chain]} - ${chain} tokens with financial metrics`);
    });
}

// Main function to handle command line arguments
async function main() {
    const arg1 = process.argv[2];
    const arg2 = process.argv[3];
    
    if (arg1 === 'help' || arg1 === '--help' || arg1 === '-h') {
        console.log('💰 TICKER FINANCIAL DATA - Enhanced with FDV & Market Metrics');
        console.log('=============================================================');
        console.log('');
        console.log('📊 USAGE:');
        console.log('  npm run ticker:financial                    # Fetch all chains with financial data');
        console.log('  npm run ticker:financial BASE               # Fetch BASE chain only');
        console.log('  npm run ticker:financial SYMBOL             # Search specific token');
        console.log('  npm run ticker:financial BASE SYMBOL        # Search symbol in specific chain');
        console.log('');
        console.log('💎 FINANCIAL DATA INCLUDED:');
        console.log('  • Market Cap in VIRTUAL tokens');
        console.log('  • FDV (Fully Diluted Valuation) calculation');
        console.log('  • 24-hour price change percentage');
        console.log('  • 24-hour trading volume');
        console.log('  • Total value locked in pools');
        console.log('  • Token holder count');
        console.log('  • Complete tokenomics breakdown');
        console.log('  • Current price in VIRTUAL');
        console.log('');
        console.log('📁 OUTPUT FILES:');
        console.log('  • base-financial.json - Enhanced BASE chain data');
        console.log('  • eth-financial.json - Enhanced ETH chain data');
        console.log('  • sol-financial.json - Enhanced SOLANA chain data');
        process.exit(0);
    }
    
    let chainFilter = null;
    let searchSymbol = null;
    
    // Parse arguments
    if (arg1) {
        const validChains = ['BASE', 'ETH', 'SOLANA'];
        if (validChains.includes(arg1.toUpperCase())) {
            chainFilter = arg1.toUpperCase();
            searchSymbol = arg2; // Optional symbol search
        } else {
            searchSymbol = arg1; // First arg is symbol
            if (arg2 && validChains.includes(arg2.toUpperCase())) {
                chainFilter = arg2.toUpperCase(); // Second arg is chain
            }
        }
    }
    
    await fetchFinancialData(chainFilter, searchSymbol);
}

// Only run main if this file is executed directly
if (process.argv[1] && process.argv[1].endsWith('ticker-financial.mjs')) {
    main().catch(console.error);
}

export { fetchFinancialData, processTokenWithFinancials, calculateTotalSupply, calculateFDV }; 