#!/usr/bin/env node

import { ethers } from 'ethers';
import { TokenResolver } from './services/tokenResolver.js';
import { performance } from 'node:perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Constants
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Local timestamp helper (YYYY-MM-DD HH:mm:ss.mmm)
function localTs() {
  const d = new Date();
  const pad = (n, z = 2) => String(n).padStart(z, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

const VIRTUAL_TOKEN_ADDRESS = '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b';
const TRUSTSWAP_CONTRACT = '0x74fa2835311Da3118BF2971Fa11E8070e4ff1693'; // Using the one from jeetSwapExecutor
const BLACKLISTED_TOKENS = {
  addresses: [
    '0x4200000000000000000000000000000000000042',
    '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca',
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    '0x4ed4e862860bed51a9570b96d89af5e1b0efefed',
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
  ].map(addr => addr.toLowerCase()),
  tickers: ['OP', 'USDbC', 'USDC', 'DEGEN', 'DAI'].map(ticker => ticker.toUpperCase())
};

// ABIs
const TRUSTSWAP_ABI = [
  "function swapVirtualWithFee(uint256 amountIn, uint256 amountOutMin, address tokenOut, uint256 deadline) external returns (uint256[] memory)",
  "function swapForVirtualWithFee(address tokenIn, uint256 amountIn, uint256 amountOutMin, uint256 deadline) external returns (uint256[] memory)",
  "function getAmountsOutWithFee(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts, uint256 feeAmount)"
];
// Pre-create interface to avoid per-call construction
const TRUSTSWAP_IFACE = new ethers.Interface(TRUSTSWAP_ABI);

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)'
];

const GENESIS_ABI = [
  'function agentTokenAddress() public view returns (address)'
];

// Load configuration
function loadConfig() {
  // Use WALLETS_DB_PATH environment variable if set by launcher, otherwise fallback to local path
  const configPath = process.env.WALLETS_DB_PATH || path.join(__dirname, 'wallets.json');
  console.log(`📁 Loading config from: ${configPath}`);
  
  if (!fs.existsSync(configPath)) {
    console.error(`❌ Config file not found at: ${configPath}`);
    console.error(`   WALLETS_DB_PATH env var: ${process.env.WALLETS_DB_PATH || 'not set'}`);
    process.exit(1);
  }
  
  const configData = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(configData);
}

// Create wallet instances
function createWallets(config) {
  const wallets = [];
  const providers = [];
  
  // Helper function to decode base64 URLs
  const decodeUrl = (url) => {
    try {
      // Check if it's base64 encoded (no protocol prefix)
      if (!url.startsWith('http') && !url.startsWith('ws')) {
        return Buffer.from(url, 'base64').toString('utf-8');
      }
      return url;
    } catch (error) {
      console.warn(`Failed to decode URL: ${url}`);
      return url;
    }
  };

  // Create providers (Alchemy + Infura + QuickNode when available)
  if (config.config.rpcUrl) {
    const decodedUrl = decodeUrl(config.config.rpcUrl);
    const p = new ethers.JsonRpcProvider(decodedUrl, 8453, { name: 'Alchemy' });
    p._label = 'Alchemy';
    providers.push(p);
  }
  if (config.config.rpcUrlInfura) {
    const decodedUrl = decodeUrl(config.config.rpcUrlInfura);
    const p = new ethers.JsonRpcProvider(decodedUrl, 8453, { name: 'Infura' });
    p._label = 'Infura';
    providers.push(p);
  }
  if (config.config.rpcUrlQuickNode) {
    const decodedUrl = decodeUrl(config.config.rpcUrlQuickNode);
    const p = new ethers.JsonRpcProvider(decodedUrl, 8453, { name: 'QuickNode' });
    p._label = 'QuickNode';
    providers.push(p);
  }
  
  // Create wallets with first provider
  const provider = providers[0];
  
  // First, try to load wallets from environment variables (injected by main process)
  let walletsLoaded = 0;
  for (let i = 1; i <= 50; i++) { // Check up to 50 wallets (B1-B50)
    const envKey = `B${i}`;
    const privateKey = process.env[envKey];
    if (privateKey) {
      try {
        const wallet = new ethers.Wallet(privateKey, provider);
        wallet._index = i;
        wallet._name = `B${i}`;
        wallets.push(wallet);
        walletsLoaded++;
      } catch (error) {
        console.error(`❌ Invalid private key for ${envKey}: ${error.message}`);
      }
    }
  }
  
  console.log(`🔑 Loaded ${walletsLoaded} trading wallet keys from environment variables`);
  
  // Fallback: if no environment wallets found, try loading from config (for direct execution)
  if (walletsLoaded === 0) {
    config.wallets.forEach((walletConfig, index) => {
      if (walletConfig.enabled && walletConfig.privateKey) {
        const wallet = new ethers.Wallet(walletConfig.privateKey, provider);
        wallet._index = index + 1;
        wallet._name = walletConfig.name;
        wallets.push(wallet);
        walletsLoaded++;
      }
    });
    console.log(`🔑 Loaded ${walletsLoaded} trading wallet keys from wallets.json (fallback)`);
  }
  
  return { wallets, providers };
}

// Parse wallet selectors
function parseWalletSelectors(args, allWallets) {
  const selectedWallets = [];
  const walletPattern = /^B\d+(-B\d+)?$/i;
  
  for (const arg of args) {
    if (walletPattern.test(arg)) {
      if (arg.includes('-')) {
        const [start, end] = arg.split('-');
        const startIdx = parseInt(start.substring(1)) - 1;
        const endIdx = parseInt(end.substring(1)) - 1;
        for (let i = startIdx; i <= endIdx && i < allWallets.length; i++) {
          selectedWallets.push(allWallets[i]);
        }
      } else {
        const idx = parseInt(arg.substring(1)) - 1;
        if (idx < allWallets.length) {
          selectedWallets.push(allWallets[idx]);
        }
      }
    } else {
      break;
    }
  }
  
  return selectedWallets;
}

// Genesis ticker search
async function searchGenesisAddress(symbol) {
  try {
    console.log(`🔍 Searching Genesis address for ticker: ${symbol}`);
    
    const url = new URL('https://api2.virtuals.io/api/geneses');
    url.searchParams.append('pagination[page]', '1');
    url.searchParams.append('pagination[pageSize]', '10000');
    url.searchParams.append('filters[virtual][priority][$ne]', '-1');

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const genesisData = data.data;
    const match = genesisData.find(item => item.virtual.symbol === symbol.toUpperCase());

    if (match) {
      console.log(`✅ Genesis Address for ${symbol}: ${match.genesisAddress}`);
      return match.genesisAddress;
    } else {
      console.log(`❌ No genesis found for symbol: ${symbol}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error fetching genesis data: ${error.message}`);
    throw error;
  }
}

// Check and approve VIRTUAL token
async function checkAndApproveVirtual(wallet, provider) {
  try {
    const virtualContract = new ethers.Contract(VIRTUAL_TOKEN_ADDRESS, ERC20_ABI, wallet.connect(provider));
    const currentAllowance = await virtualContract.allowance(wallet.address, TRUSTSWAP_CONTRACT);
    
    if (currentAllowance < ethers.MaxUint256 / 2n) {
      console.log(`💳 B${wallet._index}: Approving VIRTUAL unlimited for TRUSTSWAP...`);
      // Dynamic fee data with 10x multiplier
      const fee = await wallet.provider.getFeeData();
      const base = fee.maxFeePerGas ?? ethers.parseUnits('0.02', 'gwei');
      const prio = fee.maxPriorityFeePerGas ?? ethers.parseUnits('0.01', 'gwei');
      const approveTx = await virtualContract.approve(TRUSTSWAP_CONTRACT, ethers.MaxUint256, {
        maxFeePerGas: base * 10n,
        maxPriorityFeePerGas: prio * 10n,
        gasLimit: 200000n
      });
      console.log(`✅ B${wallet._index}: Approval TX: ${approveTx.hash}`);
      await approveTx.wait();
      console.log(`✅ B${wallet._index}: VIRTUAL approved!`);
    } else {
      console.log(`✅ B${wallet._index}: VIRTUAL already approved`);
    }
    return true;
  } catch (error) {
    console.error(`❌ B${wallet._index}: Approval failed: ${error.message}`);
    return false;
  }
}

// Prefetch per-wallet context (nonce, fees, chainId) before detection
async function prefetchWalletContext(wallet) {
  const [nonce, net] = await Promise.all([
    wallet.provider.getTransactionCount(wallet.address, 'latest'),
    wallet.provider.getNetwork()
  ]);
  const oneGwei = ethers.parseUnits('0.025', 'gwei');
  return {
    nonce,
    chainId: Number(net.chainId),
    base: oneGwei,
    prio: oneGwei
  };
}

// Build and sign swap tx (no broadcast)
async function buildAndSignSwapTx(wallet, tokenCA, virtualAmount, provider, preCtx) {
  const amountIn = ethers.parseUnits(virtualAmount.toString(), 18);
  // Zero pre-call overhead: skip quote, use minAmountOut = 0 for max speed
  const minAmountOut = 0n;
  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 min

  // Populate data via interface for consistency
  const data = TRUSTSWAP_IFACE.encodeFunctionData('swapVirtualWithFee', [amountIn, minAmountOut, tokenCA, deadline]);

  const txReq = {
    to: TRUSTSWAP_CONTRACT,
    data,
    value: 0n,
    type: 2,
    chainId: preCtx.chainId,
    nonce: preCtx.nonce,
    maxFeePerGas: preCtx.base * 10n,
    maxPriorityFeePerGas: preCtx.prio * 10n,
    gasLimit: 500000n
  };

  const t_signStart = performance.now();
  const signedTx = await wallet.signTransaction(txReq);
  const t_signEnd = performance.now();

  return { signedTx, request: txReq, timings: { signMs: Number((t_signEnd - t_signStart).toFixed(3)) } };
}

// Detect token and prebuild + sign all swap txs
async function detectAndPrepareSignedSwaps(genesisAddress, wsUrl, wallets, buyAmount, providers, preCtxList) {
  return new Promise((resolve, reject) => {
    console.log(`\n🔍 DETECTING TOKEN CA FOR GENESIS: ${genesisAddress}`);
    console.log(`📡 Using WebSocket for MAXIMUM SPEED detection`);
    console.log(`🔗 WSS: ${wsUrl}`);
    console.log(`⏳ Will update status every 60 seconds...`);
    console.log(`[${localTs()}] Detection start`);
    
    const wsProvider = new ethers.WebSocketProvider(wsUrl, 8453);
    const genesisContract = new ethers.Contract(genesisAddress, GENESIS_ABI, wsProvider);
    
    let detected = false;
    const startTime = Date.now();
    let checkCount = 0;

    const quickStatus = setTimeout(() => {
      if (!detected) console.log(`⏳ Detection active... 10s elapsed, ${checkCount} checks performed`);
    }, 10000);
    const statusInterval = setInterval(() => {
      if (!detected) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        console.log(`⏳ Still listening... ${elapsed}s elapsed, ${checkCount} checks performed`);
      }
    }, 60000);

    const checkToken = async () => {
      if (detected) return;
      checkCount++;
      try {
        const tokenCA = await genesisContract.agentTokenAddress();
        if (tokenCA && tokenCA !== ethers.ZeroAddress) {
          detected = true;
          clearTimeout(quickStatus);
          clearInterval(statusInterval);
          try { wsProvider.off('block', blockHandler); } catch {}
          const detectionPerf = performance.now();
          const detectionWall = Date.now() - startTime;
          console.log(`\n✅ TOKEN DETECTED IN ${detectionWall}ms!`);
          console.log(`🎯 Token CA: ${tokenCA}`);
          console.log(`📊 Total checks performed: ${checkCount}`);
          console.log(`⏱️  Detection timestamp (perf): ${detectionPerf.toFixed(3)} ms`);
          console.log(`[${localTs()}] Token detected`);
          globalThis.__ADVANCE_ORDER_DETECTION_TS__ = detectionPerf;

          // Prebuild + sign all swap txs in parallel immediately
          (async () => {
            try {
              const buildStart = performance.now();
              // Use the single Alchemy provider only
              const alchemyProvider = providers[0];
              const signedPackages = await Promise.all(wallets.map(async (wallet, i) => {
                const preCtx = preCtxList[i];
                return await buildAndSignSwapTx(wallet, tokenCA, buyAmount, alchemyProvider, preCtx);
              }));
              const buildEnd = performance.now();
              console.log(`⚙️  Pre-sign completed in ${(buildEnd - buildStart).toFixed(3)} ms for ${wallets.length} wallets`);
              // Avoid calling destroy() which may attempt eth_unsubscribe on closed sockets; use removeAllListeners
              try {
                wsProvider.removeAllListeners?.();
              } catch {}
              resolve({ tokenCA, detectionPerf, signedPackages });
            } catch (err) {
              try { wsProvider.removeAllListeners?.(); } catch {}
              reject(err);
            }
          })();
        }
      } catch {}
    };

    const blockHandler = async () => { await checkToken(); };
    wsProvider.on('block', blockHandler);
    try {
      const rawWs = wsProvider._websocket || wsProvider.websocket;
      rawWs?.on?.('close', () => console.log(`[${localTs()}] ⚠️ WSS connection closed`));
      rawWs?.on?.('error', (e) => console.log(`[${localTs()}] ⚠️ WSS error:`, e?.message || e));
      rawWs?.on?.('open', () => console.log(`[${localTs()}] ✅ WSS connection established`));
    } catch {}
    checkToken();
  });
}

// Main Advance Order function (prebuilt variant)
async function snipePrebuilt(args) {
  console.log('🎯 ADVANCE ORDER v1.1 - PREBUILT SIGNED TX EDITION');
  console.log('===============================================');
  
  const config = loadConfig();
  const { wallets, providers } = createWallets(config);
  
  const selectedWallets = parseWalletSelectors(args, wallets);
  if (selectedWallets.length === 0) {
    console.error('❌ No wallets selected! Use B1, B2, B1-B5, etc.');
    process.exit(1);
  }
  
  let genesisAddress = null;
  let tokenInputArg = null; // Normal ticker/CA input (non-Genesis)
  let normalTokenCA = null; // Resolved token address when using normal ticker/CA
  let buyAmount = 100;
  let mcapThresholdMillion = null; // MCAP- immediate max (M USD)
  let limitThresholdMillion = null; // LIMIT- watch trigger at or below (M USD)
  let tpThresholdMillion = null; // TP- sell trigger at or above (M USD)
  // SELL- argument; required for TP-
  let sellArgProvided = false;
  let sellMode = null; // 'percent' | 'fixed'
  let sellBasisPoints = 0; // 0-10000 bps
  let sellFixedTokens = 0; // tokens to sell when mode=fixed
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (/^B\d+(-B\d+)?$/i.test(arg)) continue;
    if (arg.toUpperCase().startsWith('G-')) {
      const ticker = arg.substring(2);
      genesisAddress = await searchGenesisAddress(ticker);
      if (!genesisAddress) {
        console.error(`❌ Genesis ticker ${ticker} not found!`);
        process.exit(1);
      }
    } else if (ethers.isAddress(arg)) {
      genesisAddress = arg;
    } else if (!isNaN(parseFloat(arg))) {
      buyAmount = parseFloat(arg);
    } else if (arg.toUpperCase().startsWith('MCAP-')) {
      const val = parseFloat(arg.substring(5));
      if (isNaN(val) || val <= 0) {
        console.error(`❌ Invalid MCAP threshold: ${arg}. Use MCAP-<number> e.g. MCAP-1 for $1M`);
        process.exit(1);
      }
      mcapThresholdMillion = val;
    } else if (arg.toUpperCase().startsWith('LIMIT-')) {
      const val = parseFloat(arg.substring(6));
      if (isNaN(val) || val <= 0) {
        console.error(`❌ Invalid LIMIT threshold: ${arg}. Use LIMIT-<number> e.g. LIMIT-3 for $3M`);
        process.exit(1);
      }
      limitThresholdMillion = val;
    } else if (arg.toUpperCase().startsWith('TP-')) {
      const val = parseFloat(arg.substring(3));
      if (isNaN(val) || val <= 0) {
        console.error(`❌ Invalid TP threshold: ${arg}. Use TP-<number> e.g. TP-3 for $3M`);
        process.exit(1);
      }
      tpThresholdMillion = val;
    } else if (arg.toUpperCase().startsWith('SELL-')) {
      const raw = arg.substring(5);
      if (raw.endsWith('%')) {
        const pct = parseFloat(raw.slice(0, -1));
        if (isNaN(pct) || pct < 0) {
          console.error(`❌ Invalid SELL percentage: ${arg}. Use SELL-<pct>% e.g. SELL-50% or SELL-0%`);
          process.exit(1);
        }
        sellArgProvided = true;
        sellMode = 'percent';
        if (pct >= 100) {
          sellBasisPoints = 9999; // cap at 99.99%
        } else {
          sellBasisPoints = Math.min(9999, Math.max(0, Math.floor(pct * 100)));
        }
      } else {
        const qty = parseFloat(raw);
        if (isNaN(qty) || qty < 0) {
          console.error(`❌ Invalid SELL amount: ${arg}. Use SELL-<tokens> (can be 0) or SELL-<pct>%`);
          process.exit(1);
        }
        sellArgProvided = true;
        sellMode = 'fixed';
        sellFixedTokens = qty;
      }
    } else {
      // Treat as normal ticker input (non-Genesis)
      if (!tokenInputArg) tokenInputArg = arg;
    }
  }

  // If not using Genesis, attempt to resolve normal ticker → token CA
  if (!genesisAddress && tokenInputArg) {
    try {
      const resolver = new TokenResolver();
      const tokenInfo = await resolver.getTokenInfo(tokenInputArg);
      if (!tokenInfo || !tokenInfo.address) {
        console.error(`❌ Could not resolve token from ticker: ${tokenInputArg}`);
        process.exit(1);
      }
      normalTokenCA = tokenInfo.address;
      console.log(`✅ Resolved ticker '${tokenInputArg}' → token CA: ${normalTokenCA}`);
    } catch (e) {
      console.error(`❌ Error resolving ticker '${tokenInputArg}': ${e?.message || e}`);
      process.exit(1);
    }
  }
  if (!genesisAddress && !normalTokenCA) {
    console.error('❌ No genesis address or token ticker/CA provided! Use address, G-TICKER, or TICKER');
    process.exit(1);
  }

  console.log(`\n📋 ADVANCE ORDER CONFIGURATION:`);
  console.log(`🎯 Genesis: ${genesisAddress}`);
  console.log(`👛 Wallets: ${selectedWallets.length} selected`);
  console.log(`💰 Amount: ${buyAmount} VIRTUAL per wallet`);
  console.log(`⚡ Gas: 10x multiplier for MAXIMUM SPEED`);
  console.log(`🔄 Strategy: Pre-sign → Detect (WSS) → Broadcast signed`);
  if (mcapThresholdMillion != null) {
    console.log(`🎯 MCAP Threshold: ${mcapThresholdMillion}M USD (max)`);
  }
  if (limitThresholdMillion != null) {
    console.log(`⏳ LIMIT Watch: ${limitThresholdMillion}M USD (broadcast at or below)`);
  }
  if (tpThresholdMillion != null) {
    if (!sellArgProvided || (sellMode === 'percent' && sellBasisPoints === 0) || (sellMode === 'fixed' && sellFixedTokens === 0)) {
      console.log(`⚠️ TP specified but SELL not provided or zero → Ignoring TP condition.`);
      tpThresholdMillion = null;
    } else {
      console.log(`🎯 TP Watch: ${tpThresholdMillion}M USD (sell at or above)`);
      if (sellMode === 'percent') {
        console.log(`🪙 SELL: ${sellBasisPoints / 100}% of balance on TP`);
      } else {
        console.log(`🪙 SELL: ${sellFixedTokens} tokens on TP`);
      }
    }
  }

  // Phase 1: Approvals
  console.log(`\n🔓 PHASE 1: Checking VIRTUAL approvals...`);
  await Promise.all(selectedWallets.map(w => checkAndApproveVirtual(w, providers[0])));
  console.log(`✅ All approvals complete!`);

  // Phase 2: Prefetch per-wallet context (nonce, fees, chainId)
  console.log(`\n⚙️  PHASE 2: Prefetching per-wallet context...`);
  const preCtxList = await Promise.all(selectedWallets.map(w => prefetchWalletContext(w)));
  console.log(`✅ Prefetch complete for ${selectedWallets.length} wallets`);

  // Phase 3: Detection (Genesis) or direct token mode + prebuild signed swaps
  let tokenCA, detectionPerf, signedPackages;
  if (genesisAddress) {
  console.log(`\n🔍 PHASE 3: Starting ultra-fast token detection (WSS block-driven)...`);
  
  // Helper function to decode base64 URLs (same as in createWallets)
  const decodeUrl = (url) => {
    try {
      // Check if it's base64 encoded (no protocol prefix)
      if (!url.startsWith('http') && !url.startsWith('ws')) {
        return Buffer.from(url, 'base64').toString('utf-8');
      }
      return url;
    } catch (error) {
      console.warn(`Failed to decode URL: ${url}`);
      return url;
    }
  };
  
  const rawWsUrl = config.config.wsUrl || config.config.rpcUrl.replace('https', 'wss');
  const wsUrl = decodeUrl(rawWsUrl);
    ({ tokenCA, detectionPerf, signedPackages } = await detectAndPrepareSignedSwaps(
    genesisAddress,
    wsUrl,
    selectedWallets,
    buyAmount,
    providers,
    preCtxList
    ));
  } else {
    console.log(`\n🔍 PHASE 3: Normal ticker mode - resolving token without Genesis detection`);
    const buildStart = performance.now();
    tokenCA = normalTokenCA;
    const alchemyProvider = providers[0];
    const localSigned = await Promise.all(selectedWallets.map(async (wallet, i) => {
      const preCtx = preCtxList[i];
      return await buildAndSignSwapTx(wallet, tokenCA, buyAmount, alchemyProvider, preCtx);
    }));
    signedPackages = localSigned;
    const buildEnd = performance.now();
    detectionPerf = buildEnd; // approximate baseline for subsequent logs
    console.log(`⚙️  Pre-sign completed in ${(buildEnd - buildStart).toFixed(3)} ms for ${selectedWallets.length} wallets`);
  }

  // Helper to compute MCAP (in millions USD)
  const computeMcapMillion = async () => {
    const pairAbi = [
      'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
      'function token0() external view returns (address)',
      'function token1() external view returns (address)'
    ];
    const ERC20_DECIMALS = ['function decimals() view returns (uint8)'];
    const randProvider = providers[Math.floor(Math.random() * providers.length)] || providers[0];
    const trustswapView = new ethers.Contract(TRUSTSWAP_CONTRACT, TRUSTSWAP_ABI, randProvider);

    const tokenMeta = new ethers.Contract(tokenCA, ERC20_DECIMALS, randProvider);
    const tDec = await tokenMeta.decimals();
    const oneToken = ethers.parseUnits('1', tDec);
    const [amounts] = await trustswapView.getAmountsOutWithFee(oneToken, [tokenCA, VIRTUAL_TOKEN_ADDRESS]);
    const vOut = amounts[amounts.length - 1];
    const tokenVirtual = parseFloat(ethers.formatUnits(vOut, 18));

    const pairAddr = '0xE31c372a7Af875b3B5E0F3713B17ef51556da667';
    const pair = new ethers.Contract(pairAddr, pairAbi, randProvider);
    const [token0, token1] = await Promise.all([pair.token0(), pair.token1()]);
    const { reserve0, reserve1 } = await pair.getReserves();
    const erc0 = new ethers.Contract(token0, ERC20_DECIMALS, randProvider);
    const erc1 = new ethers.Contract(token1, ERC20_DECIMALS, randProvider);
    const [d0, d1] = await Promise.all([erc0.decimals(), erc1.decimals()]);
    let virtualPerEth;
    if (token0.toLowerCase() === VIRTUAL_TOKEN_ADDRESS.toLowerCase()) {
      const v = Number(ethers.formatUnits(reserve0, d0));
      const e = Number(ethers.formatUnits(reserve1, d1));
      virtualPerEth = e / v;
    } else if (token1.toLowerCase() === VIRTUAL_TOKEN_ADDRESS.toLowerCase()) {
      const v = Number(ethers.formatUnits(reserve1, d1));
      const e = Number(ethers.formatUnits(reserve0, d0));
      virtualPerEth = e / v;
    } else {
      throw new Error('VIRTUAL not found in specified pair');
    }

    const fetchEthUsd = async () => {
      try {
        const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
        const data = await resp.json();
        const val = data?.ethereum?.usd; if (!val || isNaN(val)) throw new Error('bad price');
        return Number(val);
      } catch {
        const resp2 = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot');
        const data2 = await resp2.json();
        const val2 = Number(data2?.data?.amount); if (!val2 || isNaN(val2)) throw new Error('no price');
        return val2;
      }
    };
    const ethUsd = await fetchEthUsd();
    const virtualUsd = virtualPerEth * ethUsd;
    const tokenUsd = tokenVirtual * virtualUsd;
    return { mcapMillion: tokenUsd * 1000, tokenUsd, virtualUsd, ethUsd };
  };

  // LIMIT watch (if provided): poll MCAP every 6s until <= threshold
  if (limitThresholdMillion != null) {
    console.log(`\n⏳ LIMIT MODE: watching MCAP every 6s until ≤ ${limitThresholdMillion}M`);
    while (true) {
      try {
        const { mcapMillion, tokenUsd, virtualUsd, ethUsd } = await computeMcapMillion();
        console.log(`🧮 MCAP WATCH: tokenUSD=${tokenUsd.toFixed(8)} | VIRTUALUSD=${virtualUsd.toFixed(8)} | ETHUSD=${ethUsd.toFixed(2)} | MCAP=${mcapMillion.toFixed(3)}M`);
        if (mcapMillion <= limitThresholdMillion) {
          console.log(`✅ LIMIT reached: ${mcapMillion.toFixed(3)}M ≤ ${limitThresholdMillion}M. Proceeding to broadcast.`);
          break;
        }
      } catch (err) {
        console.log(`⚠️ MCAP watch error: ${err?.message || err}`);
      }
      await new Promise(r => setTimeout(r, 6000));
    }
  } else if (mcapThresholdMillion != null) {
    // Optional MCAP check before broadcasting (immediate gate)
    console.log(`\n🧮 MCAP CHECK: computing token and VIRTUAL prices in parallel...`);
    try {
      const { mcapMillion, tokenUsd, virtualUsd, ethUsd } = await computeMcapMillion();
      console.log(`🧮 MCAP DEBUG: tokenUSD=${tokenUsd.toFixed(8)} | VIRTUALUSD=${virtualUsd.toFixed(8)} | ETHUSD=${ethUsd.toFixed(2)} | MCAP=${mcapMillion.toFixed(3)}M`);
      if (mcapMillion > mcapThresholdMillion) {
        console.log(`🚫 MCAP threshold exceeded: ${mcapMillion.toFixed(3)}M > ${mcapThresholdMillion}M. Aborting broadcast.`);
        process.exit(0);
      } else {
        console.log(`✅ MCAP within threshold: ${mcapMillion.toFixed(3)}M ≤ ${mcapThresholdMillion}M. Proceeding to broadcast.`);
      }
    } catch (err) {
      console.error(`❌ MCAP check failed: ${err?.message || err}`);
      process.exit(1);
    }
  }

  // Blacklist check before broadcasting
  if (BLACKLISTED_TOKENS.addresses.includes(tokenCA.toLowerCase())) {
    console.error(`\n🚫 BLACKLISTED TOKEN DETECTED!`);
    console.error(`❌ Token ${tokenCA} is blacklisted - aborting!`);
    process.exit(1);
  }

  // Phase 4: Broadcast pre-signed transactions and keep retrying until success (random HTTP provider per attempt)
  console.log(`\n⚡ PHASE 4: BROADCASTING PRE-SIGNED SWAPS! (will retry until success)`);
  const broadcastUntilSuccess = selectedWallets.map(async (wallet, i) => {
    const baseReq = signedPackages[i].request;
    let attempt = 0;
    while (true) {
      // Use a random HTTP provider each attempt
      const provider = providers[Math.floor(Math.random() * providers.length)] || providers[0];
      try {
        // Refresh fee and nonce each attempt; escalate gas slightly per attempt
        const base = ethers.parseUnits('0.025', 'gwei');
        const prio = ethers.parseUnits('0.025', 'gwei');
        const multiplier = 10n + BigInt(Math.min(attempt, 10)); // 10x then +1 per attempt capped
        const nextNonce = await provider.getTransactionCount(wallet.address, 'latest');
        const txReq = {
          to: baseReq.to,
          data: baseReq.data,
          value: 0n,
          type: 2,
          chainId: baseReq.chainId,
          nonce: nextNonce,
          maxFeePerGas: base * multiplier,
          maxPriorityFeePerGas: prio * multiplier,
          gasLimit: baseReq.gasLimit
        };
        const t_sendStart = performance.now();
        console.log(`[${localTs()}] Send start (attempt ${attempt+1})`);
        const detectToSendStart = (t_sendStart - detectionPerf);
        const signed = await wallet.signTransaction(txReq);
        const sentTx = await provider.broadcastTransaction(signed);
        const t_sent = performance.now();
        console.log(`[${localTs()}] Sent`);
        console.log(`⏱️  B${wallet._index}: detect→sendStart=${detectToSendStart.toFixed(3)} ms, sendStart→sent=${(t_sent - t_sendStart).toFixed(3)} ms (attempt ${attempt+1})`);
        console.log(`🚀 B${wallet._index}: SWAP TX SENT: ${sentTx.hash}`);
        const receipt = await sentTx.wait();
        const t_receipt = performance.now();
        console.log(`[${localTs()}] Receipt`);
        console.log(`⏱️  B${wallet._index}: sent→receipt=${(t_receipt - t_sent).toFixed(3)} ms`);
        if (receipt.status === 1) {
          console.log(`✅ B${wallet._index}: SWAP SUCCESS! Gas used: ${receipt.gasUsed}`);
          return { success: true, txHash: sentTx.hash, walletIndex: i + 1 };
        }
        console.log(`❌ B${wallet._index}: Transaction reverted (attempt ${attempt+1}). Retrying...`);
      } catch (e) {
        console.log(`❌ B${wallet._index}: Send error (attempt ${attempt+1}): ${e?.message || e}`);
      }
      attempt += 1;
      // Tiny delay to avoid hot-looping
      await new Promise(r => setTimeout(r, 100));
    }
  });

  const finalResults = await Promise.all(broadcastUntilSuccess);
  console.log(`\n📊 RESULTS:`);
  console.log(`✅ Successful: ${finalResults.filter(r => r.success).length}/${selectedWallets.length}`);

  // Post-buy: Approvals for selling and TP-based MCAP watch (only if TP- provided)
  const successfulResults = finalResults.filter(r => r && r.success);
  if (successfulResults.length > 0 && tpThresholdMillion != null) {
    try {
      const tokenAddress = tokenCA;
      const tokenRead = new ethers.Contract(tokenAddress, [
        'function balanceOf(address) view returns (uint256)',
        'function decimals() view returns (uint8)'
      ], providers[0]);
      const tokenDecimals = await tokenRead.decimals();

      // Pre-approve all successful wallets for selling
      console.log(`\n🔓 Pre-approving token ${tokenAddress} for TRUSTSWAP on successful wallets...`);
      await Promise.all(successfulResults.map(async (res) => {
        const wallet = selectedWallets[(res.walletIndex || 1) - 1];
        const tokenErc20 = new ethers.Contract(tokenAddress, [
          'function approve(address spender, uint256 amount) external returns (bool)'
        ], wallet.connect(providers[0]));
        try {
          const tx = await tokenErc20.approve(TRUSTSWAP_CONTRACT, ethers.MaxUint256);
          await tx.wait();
        } catch (e) {
          console.log(`⚠️ Approve failed for B${wallet._index}: ${e?.message || e}`);
        }
      }));
      console.log(`✅ Pre-approvals done.`);

      console.log(`\n👀 TP MODE: watching MCAP every 6s; sell when ≥ ${tpThresholdMillion}M`);
      while (true) {
        try {
          const { mcapMillion, tokenUsd, virtualUsd, ethUsd } = await computeMcapMillion();
          console.log(`🧮 TP WATCH: tokenUSD=${tokenUsd.toFixed(8)} | VIRTUALUSD=${virtualUsd.toFixed(8)} | ETHUSD=${ethUsd.toFixed(2)} | MCAP=${mcapMillion.toFixed(3)}M`);
          if (mcapMillion >= tpThresholdMillion) {
            console.log(`🎯 TP reached: ${mcapMillion.toFixed(3)}M ≥ ${tpThresholdMillion}M. Selling...`);
            // Execute sells for all successful wallets
            await Promise.all(successfulResults.map(async (res) => {
              const wallet = selectedWallets[(res.walletIndex || 1) - 1];
            const walletConn = wallet.connect(providers[0]);
            const trustswap = new ethers.Contract(TRUSTSWAP_CONTRACT, TRUSTSWAP_ABI, walletConn);
            const tokenBal = await tokenRead.balanceOf(wallet.address);
              let amountToSell = 0n;
              if (sellMode === 'percent') {
                amountToSell = (tokenBal * BigInt(sellBasisPoints)) / 10000n;
              } else {
                const qtyWei = ethers.parseUnits(String(sellFixedTokens), tokenDecimals);
                amountToSell = qtyWei > tokenBal ? tokenBal : qtyWei;
              }
              if (amountToSell <= 0n) return;
            const deadline = Math.floor(Date.now() / 1000) + 300;
            const tx = await trustswap.swapForVirtualWithFee(tokenAddress, amountToSell, 0, deadline, {
              maxFeePerGas: ethers.parseUnits('0.025', 'gwei') * 10n,
              maxPriorityFeePerGas: ethers.parseUnits('0.025', 'gwei') * 10n
            });
              console.log(`🚀 Sell TX (B${wallet._index}) sent: ${tx.hash}`);
            const rc = await tx.wait();
              console.log(`✅ Sell success (B${wallet._index})! Block ${rc.blockNumber}`);
            }));
            break;
          }
        } catch (err) {
          console.log(`⚠️ TP watch error: ${err?.message || err}`);
        }
        await new Promise(r => setTimeout(r, 6000));
      }
    } catch (err) {
      console.log(`⚠️ Post-buy monitoring error: ${err?.message || err}`);
    }
  }

  console.log(`🏁 Advance Order Complete!`);
  
  // Auto-shutdown the bot after completion
  setTimeout(() => {
    console.log('🔄 Auto-shutting down bot...');
    process.exit(0);
  }, 2000); // 2 second delay to show completion message
}

function showUsage() {
  console.log('\n🎯 Advance Order USAGE:');
  console.log('==============================');
  console.log('');
  console.log('snipe-prebuilt <wallets> <genesis> [amount]');
  console.log('');
  console.log('EXAMPLES:');
  console.log('  node snipe-prebuilt.mjs B1 0x1234...abcd');
  console.log('  node snipe-prebuilt.mjs B1-B5 G-TICKER 50');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showUsage();
    process.exit(0);
  }
  try {
    await snipePrebuilt(args);
  } catch (error) {
    console.error(`\n❌ FATAL ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log('\n\n👋 Advance Order stopped by user');
  process.exit(0);
});

main();
