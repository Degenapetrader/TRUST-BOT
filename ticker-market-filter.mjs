/*
=================================================================
TICKER MARKET CAP FILTER - SHARED UTILITY
=================================================================

FEATURES:
✅ Market Cap Filtering: Exclude tokens with mcapInVirtual < 50,000
✅ Shared Logic: Used by all ticker commands for consistency
✅ Statistics Tracking: Shows how many tokens were filtered out
✅ Flexible Threshold: Can be easily adjusted if needed

INTEGRATION:
• Used by ticker:search, ticker:fetchAll, ticker:updateNew, ticker:runAll
• Ensures only tokens with significant market cap are saved
• Improves database quality by filtering micro-cap tokens
=================================================================
*/

// Market cap threshold in VIRTUAL tokens
const MIN_MARKET_CAP = 50000; // 50,000 VIRTUAL tokens

/**
 * Filters tokens based on market cap threshold
 * @param {Array} tokens - Array of token objects with mcapInVirtual property
 * @param {string} chain - Chain name for logging (BASE, ETH, SOLANA)
 * @returns {Object} - { filteredTokens: Array, stats: Object }
 */
export function filterByMarketCap(tokens, chain = '') {
    if (!Array.isArray(tokens)) {
        console.log(`⚠️  ${chain}: Invalid tokens array for market cap filtering`);
        return { filteredTokens: [], stats: { total: 0, filtered: 0, excluded: 0 } };
    }

    const total = tokens.length;
    let excluded = 0;
    let noMarketCapData = 0;

    const filteredTokens = tokens.filter(token => {
        // Check if token has market cap data
        if (!token.mcapInVirtual && token.mcapInVirtual !== 0) {
            // Token doesn't have market cap data - include it but track it
            noMarketCapData++;
            return true;
        }

        // Check if market cap meets minimum threshold
        if (token.mcapInVirtual < MIN_MARKET_CAP) {
            excluded++;
            return false;
        }

        return true;
    });

    const filtered = filteredTokens.length;

    // Create statistics object
    const stats = {
        total,
        filtered,
        excluded,
        noMarketCapData,
        threshold: MIN_MARKET_CAP
    };

    // Log filtering results if there were exclusions
    if (excluded > 0 || noMarketCapData > 0) {
        console.log(`💰 ${chain}: Market cap filtering results:`);
        console.log(`   📊 Total tokens processed: ${total}`);
        console.log(`   ✅ Tokens kept: ${filtered}`);
        if (excluded > 0) {
            console.log(`   🚫 Tokens excluded (< ${MIN_MARKET_CAP.toLocaleString()} VIRTUAL): ${excluded}`);
        }
        if (noMarketCapData > 0) {
            console.log(`   ❓ Tokens with no market cap data (kept): ${noMarketCapData}`);
        }
    } else if (total > 0) {
        console.log(`✅ ${chain}: All ${total} tokens passed market cap filter (>= ${MIN_MARKET_CAP.toLocaleString()} VIRTUAL)`);
    }

    return { filteredTokens, stats };
}

/**
 * Enhanced token data processor with market cap filtering
 * @param {Array} apiTokens - Raw tokens from API
 * @param {string} chain - Chain name for logging
 * @returns {Array} - Processed and filtered tokens
 */
export function processTokensWithMarketCapFilter(apiTokens, chain = '') {
    if (!Array.isArray(apiTokens)) {
        return [];
    }

    // Process tokens to include market cap data and basic info
    const processedTokens = apiTokens.map(item => ({
        symbol: item.symbol,
        tokenAddress: item.tokenAddress,
        lpAddress: item.lpAddress,
        name: item.name || item.symbol,
        mcapInVirtual: item.mcapInVirtual || null // Include market cap data
    }));

    // Apply market cap filter
    const { filteredTokens, stats } = filterByMarketCap(processedTokens, chain);

    return filteredTokens;
}

/**
 * Get current market cap threshold
 * @returns {number} - Current minimum market cap threshold
 */
export function getMarketCapThreshold() {
    return MIN_MARKET_CAP;
}

/**
 * Check if a single token meets market cap requirements
 * @param {Object} token - Token object with mcapInVirtual property
 * @returns {boolean} - True if token meets requirements
 */
export function tokenMeetsMarketCapRequirement(token) {
    // If no market cap data, allow it (might be missing data)
    if (!token.mcapInVirtual && token.mcapInVirtual !== 0) {
        return true;
    }
    
    return token.mcapInVirtual >= MIN_MARKET_CAP;
} 