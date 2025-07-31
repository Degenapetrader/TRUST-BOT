import { ethers } from 'ethers';
import { executeRpcWithFallback, getRandomProvider } from './src/config.js';
import fs from 'fs';

// Use the multi-provider setup from config instead of single RPC
// const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
// const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

// Uniswap V2 Factory on Base
const UNISWAP_V2_FACTORY_ADDRESS = "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6";
const UNISWAP_V2_FACTORY_ABI = [
    "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];

// VIRTUAL token address on Base
const VIRTUAL_TOKEN_ADDRESS = "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b";
// WETH token address on Base
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";

// Standard ERC-20 ABI for token metadata
const ERC20_ABI = [
    "function symbol() external view returns (string)",
    "function name() external view returns (string)",
    "function decimals() external view returns (uint8)"
];

// Factory contract will be created with provider when needed
// const factoryContract = new ethers.Contract(UNISWAP_V2_FACTORY_ADDRESS, UNISWAP_V2_FACTORY_ABI, provider);

// Helper function to detect if input is a contract address
function isContractAddress(input) {
    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    return addressRegex.test(input);
}

// Get token metadata from contract address
async function getTokenMetadata(tokenAddress) {
    try {
        console.log(`🔍 Getting token metadata for: ${tokenAddress}`);
        
        const [symbol, name, decimals] = await Promise.all([
            executeRpcWithFallback(async (provider) => {
                const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
                return await tokenContract.symbol();
            }, 3, 1000).catch(() => 'UNKNOWN'),
            executeRpcWithFallback(async (provider) => {
                const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
                return await tokenContract.name();
            }, 3, 1000).catch(() => 'Unknown Token'),
            executeRpcWithFallback(async (provider) => {
                const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
                return await tokenContract.decimals();
            }, 3, 1000).catch(() => 18)
        ]);
        
        console.log(`✅ Token metadata: ${symbol} (${name}) - ${decimals} decimals`);
        
        return {
            symbol,
            name,
            decimals: decimals,
            address: tokenAddress
        };
        
    } catch (error) {
        console.log(`❌ Failed to get token metadata: ${error.message}`);
        return {
            symbol: 'UNKNOWN',
            name: 'Unknown Token',
            decimals: 18,
            address: tokenAddress
        };
    }
}

// Enhanced pool finder with token metadata detection
async function findPoolWithMetadata(tokenAddress, pairedTokenAddress = VIRTUAL_TOKEN_ADDRESS) {
    try {
        console.log(`🔍 Enhanced pool search for token: ${tokenAddress}`);
        console.log(`💫 Paired with: ${pairedTokenAddress}`);
        console.log(`🏭 Using factory: ${UNISWAP_V2_FACTORY_ADDRESS}\n`);
        
        // Step 1: Get token metadata
        const tokenMetadata = await getTokenMetadata(tokenAddress);
        
        // Step 2: Find pool address with RPC fallback
        const pairAddress = await executeRpcWithFallback(async (provider) => {
            const factoryContract = new ethers.Contract(UNISWAP_V2_FACTORY_ADDRESS, UNISWAP_V2_FACTORY_ABI, provider);
            return await factoryContract.getPair(tokenAddress, pairedTokenAddress);
        }, 3, 1000);
        
        if (pairAddress === ethers.ZeroAddress) {
            console.log('❌ No pool found for this token pair');
            return {
                success: false,
                tokenMetadata,
                poolAddress: null,
                message: 'No Uniswap V2 pool found'
            };
        }
        
        console.log(`✅ Pool found: ${pairAddress}`);
        
        // Step 3: Get pool details with RPC fallback
        const poolABI = [
            "function token0() external view returns (address)",
            "function token1() external view returns (address)",
            "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
        ];
        
        const [token0, token1, reserves] = await Promise.all([
            executeRpcWithFallback(async (provider) => {
                const poolContract = new ethers.Contract(pairAddress, poolABI, provider);
                return await poolContract.token0();
            }, 3, 1000),
            executeRpcWithFallback(async (provider) => {
                const poolContract = new ethers.Contract(pairAddress, poolABI, provider);
                return await poolContract.token1();
            }, 3, 1000),
            executeRpcWithFallback(async (provider) => {
                const poolContract = new ethers.Contract(pairAddress, poolABI, provider);
                return await poolContract.getReserves();
            }, 3, 1000)
        ]);
        
        console.log(`\n📊 Pool Details:`);
        console.log(`   Token0: ${token0}`);
        console.log(`   Token1: ${token1}`);
        console.log(`   Reserve0: ${ethers.formatEther(reserves.reserve0)} tokens`);
        console.log(`   Reserve1: ${ethers.formatEther(reserves.reserve1)} tokens`);
        
        return {
            success: true,
            tokenMetadata,
            poolAddress: pairAddress,
            poolDetails: {
                token0,
                token1,
                reserves: {
                    reserve0: reserves.reserve0.toString(),
                    reserve1: reserves.reserve1.toString()
                }
            }
        };
        
    } catch (error) {
        console.error('❌ Error in enhanced pool search:', error.message);
        const tokenMetadata = await getTokenMetadata(tokenAddress).catch(() => ({
            symbol: 'UNKNOWN',
            name: 'Unknown Token',
            decimals: 18,
            address: tokenAddress
        }));
        
        return {
            success: false,
            tokenMetadata,
            poolAddress: null,
            error: error.message
        };
    }
}

// Legacy function for backward compatibility
async function findPoolAddress(tokenAddress, pairedTokenAddress = VIRTUAL_TOKEN_ADDRESS) {
    try {
        console.log(`🔍 Finding pool for token: ${tokenAddress}`);
        console.log(`💫 Paired with: ${pairedTokenAddress}`);
        console.log(`🏭 Using factory: ${UNISWAP_V2_FACTORY_ADDRESS}\n`);
        
        // Try both directions (token0/token1 order doesn't matter for getPair) with RPC fallback
        const pairAddress = await executeRpcWithFallback(async (provider) => {
            const factoryContract = new ethers.Contract(UNISWAP_V2_FACTORY_ADDRESS, UNISWAP_V2_FACTORY_ABI, provider);
            return await factoryContract.getPair(tokenAddress, pairedTokenAddress);
        }, 3, 1000);
        
        if (pairAddress === ethers.ZeroAddress) {
            console.log('❌ No pool found for this token pair');
            return null;
        }
        
        console.log(`✅ Pool found: ${pairAddress}`);
        
        // Optional: Get more info about the pool with RPC fallback
        const poolABI = [
            "function token0() external view returns (address)",
            "function token1() external view returns (address)",
            "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
        ];
        
        const [token0, token1, reserves] = await Promise.all([
            executeRpcWithFallback(async (provider) => {
                const poolContract = new ethers.Contract(pairAddress, poolABI, provider);
                return await poolContract.token0();
            }, 3, 1000),
            executeRpcWithFallback(async (provider) => {
                const poolContract = new ethers.Contract(pairAddress, poolABI, provider);
                return await poolContract.token1();
            }, 3, 1000),
            executeRpcWithFallback(async (provider) => {
                const poolContract = new ethers.Contract(pairAddress, poolABI, provider);
                return await poolContract.getReserves();
            }, 3, 1000)
        ]);
        
        console.log(`\n📊 Pool Details:`);
        console.log(`   Token0: ${token0}`);
        console.log(`   Token1: ${token1}`);
        console.log(`   Reserve0: ${ethers.formatEther(reserves.reserve0)} tokens`);
        console.log(`   Reserve1: ${ethers.formatEther(reserves.reserve1)} tokens`);
        
        return {
            poolAddress: pairAddress,
            token0,
            token1,
            reserves: {
                reserve0: reserves.reserve0.toString(),
                reserve1: reserves.reserve1.toString()
            }
        };
        
    } catch (error) {
        console.error('❌ Error finding pool:', error.message);
        return null;
    }
}

async function processBidJsonForWethPools() {
    const BID_FILE = 'bid.json';
    let updated = 0;
    if (!fs.existsSync(BID_FILE)) {
        console.error('bid.json not found');
        return;
    }
    let bidData = [];
    try {
        bidData = JSON.parse(fs.readFileSync(BID_FILE, 'utf-8'));
    } catch (e) {
        console.error('Failed to parse bid.json:', e.message);
        return;
    }
    for (const entry of bidData) {
        if (!entry.lpAddress && entry.tokenAddress) {
            console.log(`Scanning for WETH pool: ${entry.symbol} (${entry.tokenAddress})`);
            const result = await findPoolWithMetadata(entry.tokenAddress, WETH_ADDRESS);
            // Only accept if pool passes 5 WETH filter
            if (result.success && result.poolDetails) {
                const { token0, token1, reserves } = result.poolDetails;
                let wethReserve = null;
                if (token0.toLowerCase() === WETH_ADDRESS.toLowerCase()) {
                    wethReserve = reserves.reserve0;
                } else if (token1.toLowerCase() === WETH_ADDRESS.toLowerCase()) {
                    wethReserve = reserves.reserve1;
                }
                if (wethReserve) {
                    const wethAmount = Number(ethers.formatUnits(wethReserve, 18));
                    if (wethAmount >= 5) {
                        entry.lpAddress = result.poolAddress;
                        updated++;
                        console.log(`  ✅ Found WETH pool: ${result.poolAddress} (WETH reserve: ${wethAmount})`);
                    } else {
                        console.log(`  ❌ WETH pool found but reserve too low: ${wethAmount}`);
                    }
                } else {
                    console.log('  ❌ No WETH in pool');
                }
            } else {
                console.log('  ❌ No WETH pool found');
            }
        }
    }
    fs.writeFileSync(BID_FILE, JSON.stringify(bidData, null, 2));
    console.log(`Updated ${updated} entries in ${BID_FILE}`);
}

// Main function with enhanced capabilities
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('🔍 ENHANCED FIND-POOL - Ticker Detection + Pool Discovery');
        console.log('========================================================');
        console.log('');
        console.log('Usage: node find-pool.mjs <TOKEN_ADDRESS>');
        console.log('');
        console.log('Features:');
        console.log('  • 🎯 Detects ticker symbol from contract address');
        console.log('  • 🏊 Finds Uniswap V2 pool address vs VIRTUAL and WETH');
        console.log('  • 📊 Shows pool reserves and details (filters: ≥10k VIRTUAL or ≥5 WETH)');
        console.log('  • 💫 Defaults to VIRTUAL and WETH token pairing');
        console.log('');
        console.log('Examples:');
        console.log('  node find-pool.mjs 0xEe8099a19C27dcb05ead0b3D1c23bBF32D340f67');
        console.log('');
        console.log('Output: Complete token metadata + pool information for bot integration');
        return;
    }
    
    const tokenAddress = args[0];
    // Validate input is a contract address
    if (!isContractAddress(tokenAddress)) {
        console.log('❌ Invalid contract address format. Must be 0x followed by 40 hex characters.');
        return;
    }

    // Search for both VIRTUAL and WETH pools
    const [virtualResult, wethResult] = await Promise.all([
        findPoolWithMetadata(tokenAddress, VIRTUAL_TOKEN_ADDRESS),
        findPoolWithMetadata(tokenAddress, WETH_ADDRESS)
    ]);

    // Helper to check if a pool passes the filter
    function poolPassesFilter(result, pairedAddress, minAmount, decimals) {
        if (!result.success || !result.poolDetails) return false;
        const { token0, token1, reserves } = result.poolDetails;
        // Find which reserve matches the paired token
        let reserve = null;
        if (token0.toLowerCase() === pairedAddress.toLowerCase()) {
            reserve = reserves.reserve0;
        } else if (token1.toLowerCase() === pairedAddress.toLowerCase()) {
            reserve = reserves.reserve1;
        }
        if (!reserve) return false;
        // Use ethers from top-level import
        const reserveNum = Number(ethers.formatUnits(reserve, decimals));
        return reserveNum >= minAmount;
    }

    // Helper to get symbol for a token address
    function getSymbolForAddress(address, tokenMetadata) {
        if (address.toLowerCase() === VIRTUAL_TOKEN_ADDRESS.toLowerCase()) return 'VIRTUAL';
        if (address.toLowerCase() === WETH_ADDRESS.toLowerCase()) return 'WETH';
        if (address.toLowerCase() === (tokenMetadata?.address || '').toLowerCase()) return tokenMetadata?.symbol || 'TOKEN';
        return address;
    }

    // Get decimals for VIRTUAL and WETH
    const virtualDecimals = virtualResult.tokenMetadata && virtualResult.tokenMetadata.decimals ? virtualResult.tokenMetadata.decimals : 18;
    const wethDecimals = 18; // WETH is always 18

    // Filter pools
    const pools = [];
    if (poolPassesFilter(virtualResult, VIRTUAL_TOKEN_ADDRESS, 10000, virtualDecimals)) {
        pools.push({
            pair: 'VIRTUAL',
            ...virtualResult
        });
    }
    if (poolPassesFilter(wethResult, WETH_ADDRESS, 5, wethDecimals)) {
        pools.push({
            pair: 'WETH',
            ...wethResult
        });
    }

    // Display results
    console.log('\n🎯 ENHANCED RESULTS:');
    console.log('=====================');
    if (pools.length === 0) {
        // Show token metadata anyway
        const meta = virtualResult.tokenMetadata || wethResult.tokenMetadata;
        console.log(`Symbol: ${meta.symbol}`);
        console.log(`Name: ${meta.name}`);
        console.log(`Decimals: ${meta.decimals}`);
        console.log(`Address: ${meta.address}`);
        console.log('No valid pool found (must have ≥10,000 VIRTUAL or ≥5 WETH in pool)');
    } else {
        // Show token metadata once
        const meta = pools[0].tokenMetadata;
        console.log(`Symbol: ${meta.symbol}`);
        console.log(`Name: ${meta.name}`);
        console.log(`Decimals: ${meta.decimals}`);
        console.log(`Address: ${meta.address}`);
        for (const pool of pools) {
            console.log(`\nPool vs ${pool.pair}:`);
            console.log(`  Pool Address: ${pool.poolAddress}`);
            const { token0, token1, reserves } = pool.poolDetails;
            // Get symbols for token0 and token1
            const symbol0 = getSymbolForAddress(token0, pool.tokenMetadata);
            const symbol1 = getSymbolForAddress(token1, pool.tokenMetadata);
            // Always use 18 decimals for display (Base tokens)
            console.log(`  Token0: ${token0} (${symbol0})`);
            console.log(`  Token1: ${token1} (${symbol1})`);
            console.log(`  Reserve0: ${ethers.formatUnits(reserves.reserve0, 18)} ${symbol0}`);
            console.log(`  Reserve1: ${ethers.formatUnits(reserves.reserve1, 18)} ${symbol1}`);
        }
    }
    return pools;
}

// Only run main if this file is executed directly
if (process.argv[1] && process.argv[1].endsWith('find-pool.mjs')) {
    if (process.argv[2] && process.argv[2].toUpperCase() === 'BID') {
        processBidJsonForWethPools().catch(console.error);
    } else {
        main().catch(console.error);
    }
}

export { findPoolAddress, findPoolWithMetadata, getTokenMetadata, isContractAddress }; 