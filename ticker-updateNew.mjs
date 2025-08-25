import fs from 'fs/promises';
import fetch from 'node-fetch';
import path from 'path';

// Determine app data directory - will be userData when called from main.js
const appDataDir = process.cwd();
console.log(`Using app data directory for token database: ${appDataDir}`);

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
    const chains = ['BASE'];
    const outputFiles = {
        'BASE': path.join(appDataDir, 'base.json')
    };
    console.log(`Token database path: ${outputFiles['BASE']}`);

    for (const chain of chains) {
        let existingTokens = new Set();
        try {
            const existingData = await fs.readFile(outputFiles[chain], 'utf8');
            const existingRecords = JSON.parse(existingData);
            existingTokens = new Set(existingRecords.map(item => item.tokenAddress));
            console.log(`Loaded ${existingTokens.size} existing tokens from ${outputFiles[chain]}`);
        } catch (error) {
            console.error(`Error reading ${outputFiles[chain]}:`, error);
            existingTokens = new Set(); // Start fresh if file doesn't exist or is invalid
        }

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
        const results = [];
        let hasMore = true;
        let consecutiveExistingTokens = 0;

        while (hasMore && consecutiveExistingTokens < 20) {
            try {
                const url = new URL(baseUrl);
                Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
                console.log(`Fetching page ${params['pagination[page]']}...`);
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                const virtuals = data.data
                    .filter(item => item.mcapInVirtual >= 50000)
                    .map(item => ({
                        symbol: item.symbol,
                        tokenAddress: item.tokenAddress,
                        lpAddress: item.lpAddress,
                        mcapInVirtual: item.mcapInVirtual,
                        label: item.genesis ? 'Genesis' : 'Sentient'
                    }));

                let newTokensOnPage = 0;
                for (const virtual of virtuals) {
                    if (existingTokens.has(virtual.tokenAddress)) {
                        consecutiveExistingTokens++;
                    } else {
                        consecutiveExistingTokens = 0;
                        results.push(virtual);
                        newTokensOnPage++;
                    }
                    if (consecutiveExistingTokens >= 20) {
                        console.log(`Stopped: 20 consecutive existing tokens found`);
                        break;
                    }
                }

                if (newTokensOnPage === 0) {
                    console.log(`No new tokens found on page ${params['pagination[page]']}`);
                } else {
                    console.log(`Found ${newTokensOnPage} new tokens on page ${params['pagination[page]']}`);
                }

                const { page, pageCount } = data.meta.pagination;
                hasMore = page < pageCount && consecutiveExistingTokens < 20;
                params['pagination[page]'] = page + 1;
            } catch (error) {
                console.error(`Error fetching data for ${chain}:`, error);
                break;
            }
        }

        if (results.length > 0) {
            try {
                const existingRecords = existingTokens.size > 0
                    ? JSON.parse(await fs.readFile(outputFiles[chain], 'utf8'))
                    : [];
                const updatedRecords = [...existingRecords, ...results];
                await fs.writeFile(outputFiles[chain], JSON.stringify(updatedRecords, null, 2));
                console.log(`Finished fetching, added ${results.length} to ${outputFiles[chain]}`);
            } catch (error) {
                console.error(`Error writing to ${outputFiles[chain]}:`, error);
            }
        } else {
            console.log(`No new tokens to add to ${outputFiles[chain]}`);
        }
    }
}

// Main function
async function main() {
    console.log('🚀 Starting NEW tokens only update for BASE chain...');
    console.log('💰 Market Cap Filter: Excludes tokens < 50,000 VIRTUAL');
    await fetchNewTokensOnly();
}

// Only run main if this file is executed directly
if (process.argv[1] && process.argv[1].endsWith('ticker-updateNew.mjs')) {
    main()
        .then(() => {
            // Ensure the process exits promptly so the parent resolves
            process.exit(0);
        })
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}

export { fetchNewTokensOnly }; 