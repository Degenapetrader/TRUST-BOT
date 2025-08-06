/**
 * Optimized JeetBot Class
 * Complete implementation with comprehensive Phase 1 initialization
 */

import { ethers } from 'ethers';
import { 
  walletsDB, 
  provider, 
  VIRTUAL_TOKEN_ADDRESS,
  getAllWsProviders,
  executeRpcWithFallback,
  walletManager,
  getAllProviders
} from '../config/index.js';
import { gasPriceService } from '../providers/gasPriceService.js';
// Hardcoded TRUSTSWAP contract address
const TRUSTSWAP_CONTRACT = '0x2FE16B70724Df66419E125dE84e58276057A56A0';
import { TokenDetector } from './services/tokenDetector.js';
import { TokenInfoResolver } from './services/tokenInfoResolver.js';
import { TokenMonitor } from './services/tokenMonitor.js';
import { BalanceChecker } from './services/balanceChecker.js';
import { TokenBlacklist } from './services/tokenBlacklist.js';
import { RebuyManager } from './services/rebuyManager.js';
import { ApprovalManager } from './services/approvalManager.js';
import { JeetSwapExecutor } from './services/jeetSwapExecutor.js';
import { sleep, logWithTimestamp } from '../utils/index.js';
import { 
  takeBalanceSnapshot, 
  calculateBalanceDifferences, 
  displayBalanceSummary 
} from '../balance-tracker.js';

// Minimum balance settings for all modes
const MINIMUM_TOKEN_BALANCE = 50; // Lowered from 100 for testing
const BALANCE_RECHECK_INTERVAL = 500; // 0.5 seconds

/**
 * Genesis Search functionality integrated from GenesisSearch.js
 */
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

export class JeetBot {
  constructor(config = {}) {
    // Initialize with default configuration
    this.config = {
      mode: 'JEET',
      inputType: null,
      input: null,
      delayMinutes: 0,
      rebuyMode: false,
      rebuyPercentage: null,
      rebuyIntervalMinutes: null,
      selectedWallets: [],
      ...config
    };
    
    // Load providers and create wallet instances from wallets.json
    const { provider } = getAllProviders();
    this.allWallets = walletManager.createWalletInstances(provider);
    
    // Add environment variable wallets (B1-B20)
    console.log('🔐 JeetBot: Checking for wallet private keys...');
    const envWallets = [];
    for (let i = 1; i <= 20; i++) {
      const envName = `B${i}`;
      const privateKey = process.env[envName];
      
      if (privateKey && privateKey.length > 30) {
        try {
          const wallet = new ethers.Wallet(privateKey, provider);
          wallet.name = envName;
          wallet.metadata = { name: envName, _keyFromEnv: true };
          envWallets.push(wallet);
          console.log(`✅ JeetBot: Loaded wallet ${envName} from environment: ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`);
        } catch (error) {
          console.error(`❌ Error loading wallet ${envName} from environment: ${error.message}`);
        }
      }
    }
    
    // Combine wallet lists, filtering duplicates by address
    if (envWallets.length > 0) {
      console.log(`🔐 JeetBot: Found ${envWallets.length} valid wallets from environment variables`);
      const uniqueWallets = [...this.allWallets];
      for (const envWallet of envWallets) {
        if (!this.allWallets.some(w => w.address === envWallet.address)) {
          uniqueWallets.push(envWallet);
        }
      }
      this.allWallets = uniqueWallets;
      
      // Filter out disabled wallets (those marked with enabled=false in wallets.json)
      const enabledWallets = this.allWallets.filter(wallet => wallet.metadata?.enabled !== false);
      if (enabledWallets.length < this.allWallets.length) {
        console.log(`🔒 JeetBot: Filtered out ${this.allWallets.length - enabledWallets.length} disabled wallets`); 
        this.allWallets = enabledWallets;
      }
      
      console.log(`👛 JeetBot: Total wallets available: ${this.allWallets.length} (${this.allWallets.length - envWallets.length} from wallets.json + ${envWallets.length} from environment)`);
    } else {
      console.log(`⚠️ JeetBot: No valid wallet private keys found in environment variables, using only wallets.json`);
    }
    
    this.wallets = [...this.allWallets]; // Copy for filtering
    this.providers = getAllProviders();
    
    // Initialize services (lazy loaded)
    this.tokenDetector = null;
    this.tokenResolver = null;
    this.balanceChecker = null;
    this.tokenMonitor = null;
    this.rebuyManager = null;
    
    // Snapshots
    this.beforeSnapshot = null;
    this.afterSnapshot = null;
  }
  
  /**
   * Phase 1: Complete Initialization & Validation
   * Based on reference implementation logic
   */
  async initializePhase1(args) {
    console.log('🚀 JEETBOT v4.0 - INITIALIZATION PHASE 1');
    console.log('==========================================');
    
    // Step 1: Parse Command Arguments (including D- delay and REBUY mode)
    const parsedArgs = this.parseCommandArguments(args);
    if (!parsedArgs.valid) {
      this.showUsage();
      return false;
    }
    
    // Update config with parsed arguments
    Object.assign(this.config, parsedArgs);
    
    // Step 1.5: Resolve Genesis Contract Address for GENESIS_TICKER input type
    if (this.config.INPUT_TYPE === 'GENESIS_TICKER') {
      console.log(`\n🔍 Resolving Genesis Contract Address for ticker: ${this.config.GENESIS_TICKER_SYMBOL}`);
      try {
        const genesisAddress = await searchGenesisAddress(this.config.GENESIS_TICKER_SYMBOL);
        if (!genesisAddress) {
          console.error(`❌ No Genesis contract found for ticker: ${this.config.GENESIS_TICKER_SYMBOL}`);
          return false;
        }
        this.config.GENESIS_CONTRACT_ADDRESS = genesisAddress;
        console.log(`✅ Genesis contract resolved: ${genesisAddress}`);
      } catch (error) {
        console.error(`❌ Failed to resolve Genesis contract for ticker ${this.config.GENESIS_TICKER_SYMBOL}: ${error.message}`);
        return false;
      }
    }
    
    // Step 2: Execute Delay if D- argument provided
    if (this.config.delayMinutes > 0) {
      await this.executeDelay(this.config.delayMinutes);
    }
    
    // Step 3: Validate Input Type and Determine Strategy
    const inputValidation = this.validateAndDetermineInputType();
    if (!inputValidation.valid) {
      console.error(`❌ ${inputValidation.error}`);
      this.showUsage();
      return false;
    }
    
    // Step 4: Load and Validate Trading Wallets
    const walletValidation = await this.validateTradingWallets();
    if (!walletValidation.valid) {
      console.error(`❌ ${walletValidation.error}`);
      return false;
    }
    
    // Step 5: Check WebSocket Providers Status
    const wsValidation = this.validateWebSocketProviders();
    if (!wsValidation.valid) {
      console.error(`❌ ${wsValidation.error}`);
      return false;
    }
    
    // Step 6: Display Comprehensive Configuration
    this.displayJeetConfiguration();
    
    // Step 7: Validate Mode-Specific Parameters
    const modeValidation = this.validateModeParameters();
    if (!modeValidation.valid) {
      console.error(`❌ ${modeValidation.error}`);
      return false;
    }
    
    console.log('✅ PHASE 1 INITIALIZATION COMPLETED SUCCESSFULLY');
    return true;
  }
  
  /**
   * Parse command arguments with comprehensive support
   * Includes D- delay, REBUY mode, input types
   */
  parseCommandArguments(args) {
    console.log(`🔍 DEBUG: Received command arguments:`, args);
    
    if (args.length === 0) {
      return { valid: false, error: 'No arguments provided' };
    }
    
    const result = {
      valid: true,
      delayMinutes: 0,
      REBUY_MODE: false,
      REBUY_PERCENTAGE: null,
      REBUY_INTERVAL_MINUTES: null,
      INPUT_TYPE: null,
      input: null,
      MODE: 'JEET',
      WALLET_SELECTOR: null,
      TOKEN_ADDRESS: null,
      selectedWallets: []
    };
    
    let filteredArgs = [];
    
    console.log(`🔍 DEBUG: Starting command parsing...`);
    
    // Parse D- delay argument
    for (const arg of args) {
      if (arg.startsWith('D-') || arg.startsWith('d-')) {
        const delayValue = parseFloat(arg.substring(2));
        if (!isNaN(delayValue) && delayValue > 0) {
          result.delayMinutes = delayValue;
          console.log(`⏰ D-${delayValue} delay detected: Will wait ${delayValue} minutes before starting`);
        } else {
          return { valid: false, error: 'Invalid delay format. Use D-X where X is minutes (e.g., D-55)' };
        }
      } else {
        filteredArgs.push(arg);
      }
    }
    
    // Validate minimum arguments
    if (filteredArgs.length === 0) {
      return { valid: false, error: 'Wallet selector and genesis contract address required' };
    }
    
    // Parse wallet selectors (first arguments)
    let inputIndex = 0;
    const walletPattern = /^B\d+(-B\d+)?$/i;
    
    while (inputIndex < filteredArgs.length && walletPattern.test(filteredArgs[inputIndex])) {
      result.selectedWallets.push(filteredArgs[inputIndex]);
      inputIndex++;
    }
    
    // If no wallet selectors found, show error
    if (result.selectedWallets.length === 0) {
      return { valid: false, error: 'Wallet selector required (e.g., B1, B2, B1-B5)' };
    }
    
    // Next argument should be the main input (genesis contract/token/ticker)
    if (inputIndex >= filteredArgs.length) {
      return { valid: false, error: 'Genesis contract address, TOKEN-CA, or ticker symbol is required after wallet selector' };
    }
    
    const mainInput = filteredArgs[inputIndex];
    result.input = mainInput;
    inputIndex++;
    
    // Determine input type - following jeet-ref.js logic
    if (mainInput.toUpperCase().startsWith('TOKEN-0X')) {
      // Direct token CA format (case insensitive)
      result.INPUT_TYPE = 'TOKEN_CA';
      const tokenCA = mainInput.substring(6);
      if (!ethers.isAddress(tokenCA)) {
        return { valid: false, error: `Invalid token contract address: ${tokenCA}` };
      }
      result.input = tokenCA;
      result.DIRECT_TOKEN_CA = tokenCA;
      console.log(`🎯 TOKEN- prefix detected, stripped to CA: ${tokenCA}`);
    } else if (mainInput.toUpperCase().startsWith('GENESIS-0X')) {
      // Explicit genesis contract format (case insensitive)
      result.INPUT_TYPE = 'GENESIS';
      const genesisCA = mainInput.substring(8);
      if (!ethers.isAddress(genesisCA)) {
        return { valid: false, error: `Invalid genesis contract address: ${genesisCA}` };
      }
      result.input = genesisCA;
      result.GENESIS_CONTRACT_ADDRESS = genesisCA;
    } else if (mainInput.toUpperCase().startsWith('G-')) {
      // Genesis ticker format (case insensitive)
      result.INPUT_TYPE = 'GENESIS_TICKER';
      const tickerSymbol = mainInput.substring(2).toUpperCase();
      result.input = mainInput.toUpperCase();
      result.GENESIS_TICKER_SYMBOL = tickerSymbol;
      console.log(`🏷️ G- prefix detected, genesis ticker: ${tickerSymbol}`);
    } else if (ethers.isAddress(mainInput)) {
      // Plain address - Default to GENESIS (matching jeet-ref.js logic)
      result.INPUT_TYPE = 'GENESIS';
      result.input = mainInput;
      result.GENESIS_CONTRACT_ADDRESS = mainInput;
    } else {
      // Ticker symbol
      result.INPUT_TYPE = 'TICKER';
      result.input = mainInput.toUpperCase();
      result.TICKER_SYMBOL = mainInput.toUpperCase();
    }
    
    // Parse mode (next argument)
    if (inputIndex < filteredArgs.length) {
      const mode = filteredArgs[inputIndex].toUpperCase();
      if (['JEET', 'DETECT', 'CHECK', 'ONLYREBUY'].includes(mode)) {
        result.MODE = mode;
        inputIndex++;
      } else {
        return { valid: false, error: `Invalid mode: ${filteredArgs[inputIndex]}. Valid modes: JEET, DETECT, CHECK, ONLYREBUY` };
      }
    }
    
    // Parse REBUY mode for JEET mode
    if (result.MODE === 'JEET' && inputIndex < filteredArgs.length && filteredArgs[inputIndex].toUpperCase() === 'REBUY') {
      if (inputIndex + 2 >= filteredArgs.length) {
        return { valid: false, error: 'REBUY mode requires percentage and interval arguments' };
      }
      
      const percentageArg = filteredArgs[inputIndex + 1];
      const intervalArg = filteredArgs[inputIndex + 2];
      
      // Parse percentage (n%)
      if (percentageArg && percentageArg.endsWith('%')) {
        const percentage = parseFloat(percentageArg.slice(0, -1));
        if (!isNaN(percentage) && percentage > 0) {
          result.REBUY_PERCENTAGE = percentage;
        } else {
          return { valid: false, error: 'REBUY percentage must be a positive number (e.g., 30%)' };
        }
      } else {
        return { valid: false, error: 'REBUY percentage must be in format n% (e.g., 30%)' };
      }
      
      // Parse interval (I-minutes)
      if (intervalArg && (intervalArg.startsWith('I-') || intervalArg.startsWith('i-'))) {
        const intervalValue = parseFloat(intervalArg.substring(2));
        if (!isNaN(intervalValue) && intervalValue > 0 && intervalValue <= 60) {
          result.REBUY_INTERVAL_MINUTES = intervalValue;
          result.REBUY_MODE = true;
          console.log(`🔄 REBUY Mode detected: ${result.REBUY_PERCENTAGE}% threshold, I-${result.REBUY_INTERVAL_MINUTES} minute interval`);
        } else {
          return { valid: false, error: 'REBUY interval must be between 0.1 and 60 minutes (use I-X format)' };
        }
      } else {
        return { valid: false, error: 'REBUY interval must be in format I-X (e.g., I-0.5 for 30 seconds)' };
      }
      
      inputIndex += 3; // Skip REBUY, percentage, and interval
    }
    
    // Parse ONLYREBUY mode parameters
    if (result.MODE === 'ONLYREBUY') {
      if (inputIndex + 1 >= filteredArgs.length) {
        return { valid: false, error: 'ONLYREBUY mode requires target price and VIRTUAL amount arguments' };
      }
      
      const targetPriceArg = filteredArgs[inputIndex];
      const amountArg = filteredArgs[inputIndex + 1];
      
      // Parse target price (decimal number)
      const targetPrice = parseFloat(targetPriceArg);
      if (isNaN(targetPrice) || targetPrice <= 0) {
        return { valid: false, error: 'ONLYREBUY target price must be a positive number (e.g., 0.0022)' };
      }
      result.ONLYREBUY_TARGET_PRICE = targetPrice;
      
      // Parse VIRTUAL amount (decimal number)
      const virtualAmount = parseFloat(amountArg);
      if (isNaN(virtualAmount) || virtualAmount <= 0) {
        return { valid: false, error: 'ONLYREBUY VIRTUAL amount must be a positive number (e.g., 98)' };
      }
      result.ONLYREBUY_AMOUNT = virtualAmount;
      
      inputIndex += 2; // Skip target price and amount
      
      // Parse optional I- interval argument
      if (inputIndex < filteredArgs.length && (filteredArgs[inputIndex].startsWith('I-') || filteredArgs[inputIndex].startsWith('i-'))) {
        const intervalValue = parseFloat(filteredArgs[inputIndex].substring(2));
        if (!isNaN(intervalValue) && intervalValue > 0 && intervalValue <= 60) {
          result.ONLYREBUY_INTERVAL_MINUTES = intervalValue;
          console.log(`🎯 ONLYREBUY Mode detected: Target ${result.ONLYREBUY_TARGET_PRICE} VIRTUAL, Amount ${result.ONLYREBUY_AMOUNT} VIRTUAL, I-${result.ONLYREBUY_INTERVAL_MINUTES} minute interval`);
          inputIndex++; // Skip interval
        } else {
          return { valid: false, error: 'ONLYREBUY interval must be between 0.1 and 60 minutes (use I-X format)' };
        }
      } else {
        // Default interval is 0.5 minutes (30 seconds)
        result.ONLYREBUY_INTERVAL_MINUTES = 0.5;
        console.log(`🎯 ONLYREBUY Mode detected: Target ${result.ONLYREBUY_TARGET_PRICE} VIRTUAL, Amount ${result.ONLYREBUY_AMOUNT} VIRTUAL, default I-0.5 interval`);
      }
    }
    
    // For CHECK mode, remaining arguments are handled differently
    if (result.MODE === 'CHECK' && inputIndex < filteredArgs.length) {
      if (ethers.isAddress(filteredArgs[inputIndex])) {
        result.TOKEN_ADDRESS = filteredArgs[inputIndex];
      } else {
        return { valid: false, error: 'Invalid token address for CHECK mode' };
      }
    }
    
    console.log(`👛 Selected wallets: ${result.selectedWallets.join(', ')}`);
    return result;
  }

  /**
   * Validate and determine input type strategy
   */
  validateAndDetermineInputType() {
    const { INPUT_TYPE, input } = this.config;
    
    console.log('\n🔍 INPUT TYPE VALIDATION');
    console.log('========================');
    console.log(`📋 Input Type: ${INPUT_TYPE}`);
    console.log(`🎯 Input Value: ${input}`);
    
    switch (INPUT_TYPE) {
      case 'GENESIS':
        console.log(`🔍 Genesis Contract Mode: ${input}`);
        console.log(`🔄 Workflow: Smart CA Detection → Parallel Approvals → Token Monitoring`);
        break;
        
      case 'TOKEN_CA':
        console.log(`🎯 Direct Token CA Mode: ${input}`);
        console.log(`⚡ DETECTION SKIPPED - Using provided token CA`);
        console.log(`🔄 Workflow: Token CA Resolution → Parallel Approvals → Token Monitoring`);
        break;
        
      case 'TICKER':
        console.log(`🏷️ Ticker Symbol Mode: ${input}`);
        console.log(`🔄 Workflow: Token CA Resolution → Parallel Approvals → Token Monitoring`);
        break;
        
      case 'GENESIS_TICKER':
        console.log(`🏷️ Genesis Ticker Mode: ${input}`);
        console.log(`🔄 Workflow: Genesis CA Resolution → Smart CA Detection → Parallel Approvals → Token Monitoring`);
        break;
        
      default:
        return { valid: false, error: `Unsupported input type: ${INPUT_TYPE}` };
    }
    
    return { valid: true };
  }
  
  /**
   * Validate trading wallets
   */
  async validateTradingWallets() {
    console.log('\n👛 WALLET VALIDATION');
    console.log('====================');
    
    if (!this.wallets || this.wallets.length === 0) {
      return { valid: false, error: 'No trading wallets loaded' };
    }
    
    // Filter wallets based on selected wallet selectors
    if (this.config.selectedWallets && this.config.selectedWallets.length > 0) {
      try {
        // Import WalletParser dynamically
        const WalletParser = (await import('../parsing/walletParser.js')).WalletParser;
        const { selectedWallets } = WalletParser.parse(this.config.selectedWallets, this.wallets);
        this.wallets = selectedWallets;
        
        console.log(`✅ Filtered to ${this.wallets.length} selected wallets:`);
        this.wallets.forEach((wallet, index) => {
          // Find original wallet index
          const originalIndex = this.allWallets.findIndex(w => w.address === wallet.address);
          console.log(`   ${index + 1}. B${originalIndex + 1}: ${wallet.address.slice(0, 8)}...`);
        });
      } catch (error) {
        return { valid: false, error: `Wallet selection failed: ${error.message}` };
      }
    } else {
      console.log(`✅ Using all ${this.wallets.length} trading wallets:`);
      this.wallets.forEach((wallet, index) => {
        console.log(`   ${index + 1}. B${index + 1}: ${wallet.address.slice(0, 8)}...`);
      });
    }
    
    return { valid: true };
  }
  
  /**
   * Validate WebSocket providers
   */
  validateWebSocketProviders() {
    console.log('\n📡 WEBSOCKET PROVIDER VALIDATION');
    console.log('=================================');
    
    try {
      const wsProviders = getAllWsProviders();
      
      if (!wsProviders || wsProviders.length === 0) {
        return { valid: false, error: 'No WebSocket providers available' };
      }
      
      console.log(`✅ WebSocket Providers: ${wsProviders.length} active`);
      console.log(`⚡ Token Detection: 10ms polling (most reliable for speed)`);
      
      return { valid: true };
    } catch (error) {
      return { valid: false, error: `WebSocket provider validation failed: ${error.message}` };
    }
  }
  
  /**
   * Display comprehensive JEET configuration
   */
  displayJeetConfiguration() {
    console.log('\n📋 JEET CONFIGURATION');
    console.log('=====================');
    
    console.log(`🎯 Input Type: ${this.config.INPUT_TYPE}`);
    if (this.config.INPUT_TYPE === 'GENESIS') {
      console.log(`🔍 Genesis Contract: ${this.config.GENESIS_CONTRACT_ADDRESS}`);
    } else if (this.config.INPUT_TYPE === 'TOKEN_CA') {
      console.log(`🎯 Direct Token CA: ${this.config.DIRECT_TOKEN_CA}`);
    } else if (this.config.INPUT_TYPE === 'TICKER') {
      console.log(`🏷️ Ticker Symbol: ${this.config.TICKER_SYMBOL}`);
    } else if (this.config.INPUT_TYPE === 'GENESIS_TICKER') {
      console.log(`🏷️ Genesis Ticker: G-${this.config.GENESIS_TICKER_SYMBOL}`);
      console.log(`🔍 Resolved Genesis Contract: ${this.config.GENESIS_CONTRACT_ADDRESS}`);
    }
    
    console.log(`🔄 Mode: ${this.config.MODE}${this.config.REBUY_MODE ? ' + REBUY' : ''}`);
    
    if (this.config.REBUY_MODE) {
      console.log(`🔄 REBUY Configuration:`);
      console.log(`   📉 Price Drop Threshold: ${this.config.REBUY_PERCENTAGE}% from swap price`);
      console.log(`   ⏰ Monitoring Interval: I-${this.config.REBUY_INTERVAL_MINUTES} (${this.config.REBUY_INTERVAL_MINUTES} minute${this.config.REBUY_INTERVAL_MINUTES !== 1 ? 's' : ''})`);
      console.log(`   💰 Rebuy Amount: (100% VIRTUAL received - ${this.config.REBUY_PERCENTAGE}%) + 5%`);
      console.log(`   🔄 Workflow: JEET → Log Swap Price → Watch Price → Rebuy on Drop`);
    }
    
    if (this.config.delayMinutes > 0) {
      console.log(`⏰ Delay: ${this.config.delayMinutes} minutes before starting`);
    }
    
    console.log(`👛 Wallets: ${this.wallets.length}`);
    console.log(`🔗 WebSocket Providers: ${getAllWsProviders().length} active`);
    console.log(`💱 Trading: TRUSTSWAP contract (${TRUSTSWAP_CONTRACT})`);
    console.log(`🔥 Slippage: Handled by TRUSTSWAP contract internally`);
    console.log(`📊 Balance Strategy: Selling 99.9% to avoid precision errors`);
    
    if (this.config.MODE === 'CHECK') {
      console.log(`\n📋 CHECK MODE PARAMETERS:`);
      console.log(`👛 Target Wallet: ${this.config.WALLET_SELECTOR || 'ALL WALLETS'}`);
      console.log(`🎯 Token Address: ${this.config.TOKEN_ADDRESS || 'AUTO-DETECT FROM INPUT'}`);
    }
  }
  
  /**
   * Validate mode-specific parameters
   */
  validateModeParameters() {
    const { MODE: mode, INPUT_TYPE: inputType } = this.config;
    
    console.log('\n⚙️ MODE VALIDATION');
    console.log('==================');
    
    // Update completion strategy based on input type
    console.log(`🤖 Completion Strategy: ALL MODES now use minimum balance requirement`);
    console.log(`💯 Minimum Balance: 50 tokens required before swapping`);
    console.log(`⏰ Re-check Interval: 0.5 seconds if minimum not met`);
    
    if (inputType === 'TOKEN_CA' || inputType === 'TICKER') {
      console.log(`🔄 Continuous Mode: NEVER STOPS until all wallets processed`);
    } else {
      console.log(`🔄 Genesis Mode: Auto-stop when all wallets processed`);
    }
    
    console.log(`✅ Mode validation completed: ${mode}`);
    return { valid: true };
  }
  
  /**
   * Execute delay if D- argument provided
   */
  async executeDelay(delayMinutes) {
    if (delayMinutes <= 0) return;
    
    const totalDelayMs = delayMinutes * 60 * 1000;
    const startTime = Date.now();
    const endTime = startTime + totalDelayMs;
    
    console.log(`\n⏰ ==================== DELAY MODE ====================`);
    console.log(`🕐 Delaying execution for ${delayMinutes} minutes`);
    console.log(`🚀 Bot will start at: ${new Date(endTime).toLocaleTimeString()}`);
    console.log(`⚠️  Press Ctrl+C to cancel delay and exit`);
    console.log(`⏳ Countdown will update every minute...`);
    
    // Show countdown every minute
    while (Date.now() < endTime) {
      const remainingMs = endTime - Date.now();
      const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
      
      if (remainingMinutes > 0) {
        console.log(`⏳ ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''} remaining until bot starts...`);
        
        // Wait 1 minute or until end time, whichever is sooner
        const waitTime = Math.min(60 * 1000, remainingMs);
        await sleep(waitTime);
      }
    }
    
    console.log(`✅ Delay completed! Starting JEET Bot now...`);
    console.log(`🚀 Bot execution starting at: ${new Date().toLocaleTimeString()}`);
  }

  /**
   * Show comprehensive usage instructions
   */
  showUsage() {
    console.log('\n🤖 JEETBOT - COMPREHENSIVE USAGE GUIDE');
    console.log('=======================================');
    console.log('');
    console.log('📋 FORMAT:');
    console.log('  jeetbot <wallets> <input> [mode] [D-delay]');
    console.log('  jeetbot <wallets> <input> JEET REBUY <n%> <I-minutes> [D-delay]');
    console.log('');
    console.log('👛 WALLET SELECTORS:');
    console.log('  • Single wallet: B1, B2, B3, etc.');
    console.log('  • Multiple wallets: B1 B2 B3');
    console.log('  • Wallet range: B1-B5 (selects B1, B2, B3, B4, B5)');
    console.log('');
    console.log('🎯 INPUT TYPES:');
    console.log('  • Genesis contract: 0x1234...abcd (default for plain addresses)');
    console.log('  • Explicit genesis: GENESIS-0x1234...abcd (same as plain address)');
    console.log('  • Direct token CA: TOKEN-0x1234...abcd (explicit token format)');
    console.log('  • Ticker symbol: VADER (resolve from database)');
    console.log('  • Genesis ticker: G-BUIDL (auto-resolve Genesis CA from ticker)');
    console.log('');
    console.log('🔄 MODES:');
    console.log('  • JEET (default) - Full automated trading workflow');
    console.log('  • DETECT - Test token detection only');
    console.log('  • CHECK - Balance verification');
    console.log('  • ONLYREBUY - Price monitoring and buy at target (no selling)');
    console.log('');
    console.log('🔄 REBUY MODE:');
    console.log('  • Format: JEET REBUY n% I-minutes');
    console.log('  • Example: JEET REBUY 30% I-0.5 (30% drop, 0.5min interval)');
    console.log('  • Percentage: 1-50% price drop threshold');
    console.log('  • Interval: 0.1-60 minutes monitoring frequency');
    console.log('');
    console.log('🎯 ONLYREBUY MODE:');
    console.log('  • Format: ONLYREBUY <target_price> <virtual_amount> [I-minutes]');
    console.log('  • Example: ONLYREBUY 0.0022 98 I-0.5');
    console.log('  • Target price: Price to buy at (VIRTUAL per token)');
    console.log('  • Virtual amount: VIRTUAL to spend per wallet');
    console.log('  • Interval: Optional monitoring frequency (default: I-0.5)');
    console.log('');
    console.log('⏰ DELAY:');
    console.log('  • Format: D-X (X = minutes to delay before starting)');
    console.log('  • Example: D-30 (wait 30 minutes before starting)');
    console.log('');
    console.log('📝 EXAMPLES:');
    console.log('  jeetbot B1 0x1234...abcd JEET                    (Genesis contract)');
    console.log('  jeetbot B1 GENESIS-0x1234...abcd JEET           (Explicit genesis)');
    console.log('  jeetbot B2 B3 TOKEN-0x1234...abcd JEET          (Direct token CA)');
    console.log('  jeetbot B1-B5 VADER JEET                        (Ticker symbol)');
    console.log('  jeetbot B1 G-BUIDL JEET                         (Genesis ticker - auto-resolve)');
    console.log('  jeetbot B1 0x1234...abcd JEET REBUY 30% I-0.5   (Genesis + REBUY)');
    console.log('  jeetbot B2 0x1234...abcd JEET D-30              (Genesis + delay)');
    console.log('  jeetbot B1 0x1234...abcd DETECT                 (Genesis detection test)');
    console.log('  jeetbot B1 0x1234...abcd CHECK                  (Genesis balance check)');
    console.log('  jeetbot B1 0x1234...abcd ONLYREBUY 0.0022 98    (ONLYREBUY mode)');
    console.log('  jeetbot B1-B3 VADER ONLYREBUY 0.001 50 I-1      (ONLYREBUY + custom interval)');
  }
  
  /**
   * Run DETECT mode
   */
  async runDetectMode() {
    console.log('\n🔍 ==================== DETECT MODE ====================');
    
    if (this.config.INPUT_TYPE === 'GENESIS' || this.config.INPUT_TYPE === 'GENESIS_TICKER') {
      console.log('🔗 Testing WebSocket-only CA detection...');
      
      try {
        this.tokenDetector = new TokenDetector();
        const detectedCA = await this.tokenDetector.detectTokenCAWebSocket(this.config.GENESIS_CONTRACT_ADDRESS);
        
        console.log(`\n✅ DETECTION SUCCESSFUL!`);
        console.log(`🎯 Token CA: ${detectedCA}`);
        console.log(`🔗 Method: WebSocket-only detection`);
        console.log(`📡 Providers: ${getAllWsProviders().length} WebSocket providers used`);
        
        // Blacklist warning
        if (TokenBlacklist.isTokenBlacklisted(detectedCA)) {
          TokenBlacklist.logBlacklistWarning(detectedCA, null, console.log);
        }
        
        return { success: true, tokenCA: detectedCA };
        
      } catch (error) {
        console.log(`\n❌ DETECTION FAILED: ${error.message}`);
        return { success: false, error: error.message };
      }
    } else {
      console.log('🔗 Testing token CA resolution...');
      
      try {
        this.tokenResolver = new TokenInfoResolver();
        const inputValue = this.config.INPUT_TYPE === 'TOKEN_CA' ? this.config.DIRECT_TOKEN_CA : this.config.TICKER_SYMBOL;
        const resolvedCA = await TokenInfoResolver.resolveTokenCA(this.config.INPUT_TYPE, inputValue);
        
        console.log(`\n✅ RESOLUTION SUCCESSFUL!`);
        console.log(`🎯 Token CA: ${resolvedCA}`);
        console.log(`🔗 Method: ${this.config.INPUT_TYPE === 'TOKEN_CA' ? 'Direct token CA' : 'Ticker symbol resolution'}`);
        
        // Blacklist warning
        const inputTicker = this.config.INPUT_TYPE === 'TICKER' ? this.config.TICKER_SYMBOL : null;
        if (TokenBlacklist.isTokenBlacklisted(resolvedCA, inputTicker)) {
          TokenBlacklist.logBlacklistWarning(resolvedCA, inputTicker, console.log);
        }
        
        return { success: true, tokenCA: resolvedCA };
        
      } catch (error) {
        console.log(`\n❌ RESOLUTION FAILED: ${error.message}`);
        return { success: false, error: error.message };
      }
    }
  }

  /**
   * Run CHECK mode
   */
  async runCheckMode() {
    console.log('\n🔍 ==================== CHECK MODE ====================');
    console.log('💰 Checking token balance in wallet(s)...');
    
    try {
      // Step 1: Get token address
      let tokenAddressToCheck = this.config.TOKEN_ADDRESS;
      
      if (!tokenAddressToCheck) {
        console.log(`\n🤖 Token address not provided - resolving from input...`);
        tokenAddressToCheck = await this.getTokenCAFromInput();
        console.log(`✅ Resolved token: ${tokenAddressToCheck}`);
      } else {
        console.log(`\n🎯 Using provided token address: ${tokenAddressToCheck}`);
      }
      
      // Blacklist warning
      const inputTicker = this.config.INPUT_TYPE === 'TICKER' ? this.config.TICKER_SYMBOL : 
                          this.config.INPUT_TYPE === 'GENESIS_TICKER' ? this.config.GENESIS_TICKER_SYMBOL : null;
      if (TokenBlacklist.isTokenBlacklisted(tokenAddressToCheck, inputTicker)) {
        TokenBlacklist.logBlacklistWarning(tokenAddressToCheck, inputTicker, console.log);
        console.log(`💡 Balance check will proceed, but swapping is disabled\n`);
      }
      
      // Step 2: Check balances
      if (!this.config.WALLET_SELECTOR) {
        // Check all wallets
        console.log(`\n👛 No wallet selector provided - checking ALL ${this.wallets.length} wallets...`);
        
        const result = await BalanceChecker.checkAllWalletsForToken(this.wallets, tokenAddressToCheck);
        
        if (result.success) {
          console.log(`\n✅ ALL WALLETS CHECK SUCCESSFUL!`);
          console.log(`🎯 Token: ${result.results[0]?.token?.symbol || 'UNKNOWN'} (${tokenAddressToCheck})`);
          console.log(`💰 Wallets with tokens: ${result.summary.walletsWithTokens}/${result.summary.totalWallets}`);
          console.log(`📈 Total tokens: ${result.summary.totalTokens.toFixed(6)}`);
          console.log(`📊 Success rate: ${result.summary.successRate.toFixed(1)}%`);
        }
      } else {
        // Check specific wallet
        console.log(`\n👛 Wallet selector provided: ${this.config.WALLET_SELECTOR}`);
        
        const { wallet, index } = this.selectWallet(this.config.WALLET_SELECTOR);
        const result = await BalanceChecker.checkTokenInWallet(wallet, index, tokenAddressToCheck);
        
        if (result.success) {
          console.log(`\n✅ SINGLE WALLET CHECK SUCCESSFUL!`);
          console.log(`👛 Wallet: B${result.walletIndex} (${result.wallet})`);
          console.log(`🎯 Token: ${result.token.symbol} (${result.token.address})`);
          console.log(`💰 Balance: ${result.balance.formatted} ${result.token.symbol}`);
          console.log(`📊 Has tokens: ${result.balance.hasTokens ? 'YES' : 'NO'}`);
        }
      }
      
    } catch (error) {
      console.log(`\n❌ CHECK MODE FAILED: ${error.message}`);
      console.error('Stack:', error.stack);
    }
  }

  /**
   * Run JEET mode (full workflow)
   */
  async runJeetMode() {
    console.log('\n⚡ ==================== JEET MODE ====================');
    
    if (this.config.INPUT_TYPE === 'GENESIS' || this.config.INPUT_TYPE === 'GENESIS_TICKER') {
      console.log('🔄 Workflow: Smart CA Detection → Parallel Approvals → Token Monitoring');
    } else {
      console.log('🔄 Workflow: Token CA Resolution → Parallel Approvals → Token Monitoring');
      console.log('⚡ DETECTION SKIPPED - Using provided token CA or ticker symbol');
    }
    
    console.log('⚡ NEVER STOPS - Continuous operation until user interrupts');
    
    try {
      // Take initial balance snapshot
      this.beforeSnapshot = await takeBalanceSnapshot(this.wallets, [VIRTUAL_TOKEN_ADDRESS]);
      
      let detectedCA = null;
      
      // Phase 1: Token Detection/Resolution
      if (this.config.INPUT_TYPE === 'GENESIS' || this.config.INPUT_TYPE === 'GENESIS_TICKER') {
        console.log('\n🔍 PHASE 1: Smart CA Detection');
        this.tokenDetector = new TokenDetector();
        detectedCA = await this.tokenDetector.detectTokenCAWebSocket(this.config.GENESIS_CONTRACT_ADDRESS);
      } else {
        console.log('\n🔍 PHASE 1: Token CA Resolution');
        this.tokenResolver = new TokenInfoResolver();
        const inputValue = this.config.INPUT_TYPE === 'TOKEN_CA' ? this.config.DIRECT_TOKEN_CA : this.config.TICKER_SYMBOL;
        detectedCA = await TokenInfoResolver.resolveTokenCA(this.config.INPUT_TYPE, inputValue);
      }
      
      if (!detectedCA) {
        const inputDesc = this.config.INPUT_TYPE === 'TOKEN_CA' ? this.config.DIRECT_TOKEN_CA :
                         this.config.INPUT_TYPE === 'TICKER' ? this.config.TICKER_SYMBOL :
                         this.config.INPUT_TYPE === 'GENESIS_TICKER' ? `G-${this.config.GENESIS_TICKER_SYMBOL}` :
                         this.config.GENESIS_CONTRACT_ADDRESS;
        // Output user-friendly error messages for renderer filtering
        if (this.config.INPUT_TYPE === 'TICKER') {
          console.log(`🔍 Ticker "${this.config.TICKER_SYMBOL}" not found`);
        } else if (this.config.INPUT_TYPE === 'TOKEN_CA') {
          console.log(`🔍 Token contract address "${this.config.DIRECT_TOKEN_CA}" is invalid`);
        }
        
        throw new Error(`Failed to resolve token CA from ${this.config.INPUT_TYPE}: ${inputDesc}`);
      }
      
      console.log(`\n✅ PHASE 1 COMPLETED - Token CA: ${detectedCA}`);
      
      // Blacklist check
      const inputTicker = this.config.INPUT_TYPE === 'TICKER' ? this.config.TICKER_SYMBOL : 
                          this.config.INPUT_TYPE === 'GENESIS_TICKER' ? this.config.GENESIS_TICKER_SYMBOL : null;
      if (TokenBlacklist.isTokenBlacklisted(detectedCA, inputTicker)) {
        console.log('\n🚫 ==================== BLACKLISTED TOKEN DETECTED ====================');
        console.log('❌ OPERATION BLOCKED: This token is on the HARDCODED BLACKLIST');
        console.log('🛑 JEETBOT WILL NOT SELL BLACKLISTED TOKENS FOR SAFETY');
        throw new Error('Token is blacklisted and cannot be sold via JEETBOT');
      }
      
      // Phase 2: Parallel Approvals
      console.log('\n🔓 PHASE 2: Parallel Approvals');
      const approvalResults = await ApprovalManager.approveTokenForAllWallets(detectedCA, this.wallets);
      const successfulApprovals = approvalResults.filter(r => r.success).length;
      console.log(`\n✅ PHASE 2 COMPLETED - Approvals: ${successfulApprovals}/${this.wallets.length} successful`);
      
      // Phase 3: Advanced Token Monitoring
      console.log('\n🔍 PHASE 3: Advanced Token Monitoring + Immediate TRUSTSWAP Swapping');
      this.tokenMonitor = new TokenMonitor(this.wallets, detectedCA, 50, this.config.INPUT_TYPE);
      
      // Store data for potential REBUY mode
      this.swapResults = await this.tokenMonitor.startMonitoring();
      
      // Store token info for REBUY mode
      this.tokenInfo = this.tokenMonitor.tokenInfo;
      
      // Phase 4: REBUY Mode (if enabled)
      if (this.config.REBUY_MODE && this.swapResults && this.swapResults.length > 0) {
        console.log('\n🔄 ==================== REBUY MODE ACTIVATION ====================');
        console.log(`📊 REBUY MODE DEBUG: Received ${this.swapResults.length} swap results`);
        
        // Calculate sell price from swap results
        let totalTokensSwapped = 0;
        let totalVirtualReceived = 0;
        
        this.swapResults.forEach((result, index) => {
          console.log(`   🔍 Swap ${index + 1}: Success=${result.success}, WalletIndex=${result.walletIndex}, VirtualReceived=${result.virtualReceived}`);
          
          if (result.success && result.virtualReceived > 0) {
            totalTokensSwapped += result.tokenAmount || 0;
            totalVirtualReceived += result.virtualReceived || 0;
          }
        });
        
        // Calculate average sell price (VIRTUAL per token)
        const sellPrice = totalTokensSwapped > 0 ? totalVirtualReceived / totalTokensSwapped : 0;
        
        console.log(`📊 SELL PRICE CALCULATION:`);
        console.log(`   🪙 Total tokens swapped: ${totalTokensSwapped.toFixed(6)} ${this.tokenInfo?.symbol || 'TOKEN'}`);
        console.log(`   💰 Total VIRTUAL received: ${totalVirtualReceived.toFixed(6)} VIRTUAL`);
        console.log(`   💱 Average sell price: ${sellPrice.toFixed(8)} VIRTUAL per token`);
        
        if (sellPrice > 0) {
          this.rebuyManager = new RebuyManager(
            this.wallets, 
            { 
              address: detectedCA, 
              symbol: this.tokenInfo?.symbol || 'UNKNOWN',
              decimals: this.tokenInfo?.decimals || 18,
              poolAddress: this.tokenInfo?.poolAddress || null
            },
            this.config.REBUY_PERCENTAGE,
            this.config.REBUY_INTERVAL_MINUTES
          );
          
          await this.rebuyManager.executeRebuyMode(this.swapResults);
        } else {
          console.log(`❌ Cannot calculate sell price - no successful swaps or zero amounts`);
        }
      } else if (this.config.REBUY_MODE) {
        console.log('\n⚠️  REBUY MODE ENABLED BUT NO SWAP RESULTS AVAILABLE');
        console.log(`📊 swapResults length: ${this.swapResults?.length || 0}`);
        console.log(`📊 swapResults content: ${JSON.stringify(this.swapResults, null, 2)}`);
      }
      
    } catch (error) {
      if (error.message === 'Detection interrupted by user') {
        console.log('\n👋 JEET MODE stopped by user during detection phase');
        process.exit(0);
      } else {
        console.log(`\n❌ JEET MODE FAILED: ${error.message}`);
        console.error('Stack:', error.stack);
        process.exit(1);
      }
    }
  }

  /**
   * Get token CA from input (helper for CHECK mode)
   */
  async getTokenCAFromInput() {
    if (this.config.INPUT_TYPE === 'GENESIS' || this.config.INPUT_TYPE === 'GENESIS_TICKER') {
      if (!this.tokenDetector) this.tokenDetector = new TokenDetector();
      return await this.tokenDetector.detectTokenCAWebSocket(this.config.GENESIS_CONTRACT_ADDRESS);
    } else {
      if (!this.tokenResolver) this.tokenResolver = new TokenInfoResolver();
      const inputValue = this.config.INPUT_TYPE === 'TOKEN_CA' ? this.config.DIRECT_TOKEN_CA : this.config.TICKER_SYMBOL;
      return await TokenInfoResolver.resolveTokenCA(this.config.INPUT_TYPE, inputValue);
    }
  }

  /**
   * Select wallet based on selector (for CHECK mode)
   */
  selectWallet(walletSelector) {
    // Check if it's a wallet selector pattern (B1, B2, B3, etc.)
    const walletMatch = walletSelector.match(/^B(\d+)$/i);
    if (walletMatch) {
      const walletIndex = parseInt(walletMatch[1]);
      if (walletIndex >= 1 && walletIndex <= this.wallets.length) {
        const selectedWallet = this.wallets[walletIndex - 1];
        console.log(`👛 Selected wallet B${walletIndex}: ${selectedWallet.address}`);
        return { wallet: selectedWallet, index: walletIndex };
      } else {
        throw new Error(`Invalid wallet selector: ${walletSelector}. Valid range: B1-B${this.wallets.length}`);
      }
    }
    
    // Check if it's a direct wallet address
    if (ethers.isAddress(walletSelector)) {
      const foundWallet = this.wallets.find(w => w.address.toLowerCase() === walletSelector.toLowerCase());
      if (foundWallet) {
        const walletIndex = this.wallets.findIndex(w => w.address.toLowerCase() === walletSelector.toLowerCase()) + 1;
        console.log(`👛 Selected wallet by address: ${foundWallet.address} (B${walletIndex})`);
        return { wallet: foundWallet, index: walletIndex };
      } else {
        throw new Error(`Wallet address ${walletSelector} not found in loaded wallets`);
      }
    }
    
    throw new Error(`Invalid wallet selector: ${walletSelector}. Use B1, B2, B3... or wallet address`);
  }

  /**
   * Show final balance summary
   */
  async showFinalSummary() {
    if (this.beforeSnapshot) {
      try {
        const afterSnapshot = await takeBalanceSnapshot(this.wallets, [VIRTUAL_TOKEN_ADDRESS]);
        const differences = calculateBalanceDifferences(this.beforeSnapshot, afterSnapshot);
        displayBalanceSummary(differences, 'JEET BOT FINAL RESULTS');
      } catch (error) {
        console.log(`⚠️ Could not generate final balance summary: ${error.message}`);
      }
    }
  }

  /**
   * Main execution method
   */
  async execute() {
      const startTime = Date.now();
      
    console.log('\n🚀 ==================== STARTING EXECUTE METHOD ====================');
    console.log(`🔍 Config mode: ${this.config.MODE}`);
    console.log(`🔍 Config inputType: ${this.config.INPUT_TYPE}`);
    console.log(`🔍 Config input: ${this.config.input}`);
    
    try {
      // Execute based on mode
      if (this.config.MODE === 'DETECT') {
        console.log('🔍 Executing DETECT mode...');
        await this.runDetectMode();
      } else if (this.config.MODE === 'CHECK') {
        console.log('🔍 Executing CHECK mode...');
        await this.runCheckMode();
      } else if (this.config.MODE === 'ONLYREBUY') {
        console.log('🎯 Executing ONLYREBUY mode...');
        await this.runOnlyRebuyMode();
      } else {
        console.log('🔍 Executing JEET mode...');
        await this.runJeetMode();
      }
      
      const totalTime = Date.now() - startTime;
      console.log(`\n✅ JEET BOT COMPLETED! Total time: ${(totalTime/1000).toFixed(2)}s`);
      
      // Show final summary for JEET mode
      if (this.config.MODE === 'JEET') {
        await this.showFinalSummary();
      }
      
    } catch (error) {
      console.error('❌ JEET Bot error:', error);
      console.error('❌ Error message:', error.message);
      console.error('❌ Error stack:', error.stack);
      process.exit(1);
    }
  }

  /**
   * Run ONLYREBUY mode (price monitoring and buy at target)
   */
  async runOnlyRebuyMode() {
    console.log('\n🎯 ==================== ONLYREBUY MODE ====================');
    console.log('🔄 Workflow: Token Detection/Resolution → Skip Selling → Watch Price → Buy at Target');
    console.log('⚡ NEVER STOPS - Continuous operation until user interrupts');
    
    try {
      // Take initial balance snapshot
      this.beforeSnapshot = await takeBalanceSnapshot(this.wallets, [VIRTUAL_TOKEN_ADDRESS]);
      
      let detectedCA = null;
      
      // Phase 1: Token Detection/Resolution (same as JEET mode)
      if (this.config.INPUT_TYPE === 'GENESIS' || this.config.INPUT_TYPE === 'GENESIS_TICKER') {
        console.log('\n🔍 PHASE 1: Smart CA Detection');
        this.tokenDetector = new TokenDetector();
        detectedCA = await this.tokenDetector.detectTokenCAWebSocket(this.config.GENESIS_CONTRACT_ADDRESS);
      } else {
        console.log('\n🔍 PHASE 1: Token CA Resolution');
        this.tokenResolver = new TokenInfoResolver();
        const inputValue = this.config.INPUT_TYPE === 'TOKEN_CA' ? this.config.DIRECT_TOKEN_CA : this.config.TICKER_SYMBOL;
        detectedCA = await TokenInfoResolver.resolveTokenCA(this.config.INPUT_TYPE, inputValue);
      }
      
      if (!detectedCA) {
        const inputDesc = this.config.INPUT_TYPE === 'TOKEN_CA' ? this.config.DIRECT_TOKEN_CA :
                         this.config.INPUT_TYPE === 'TICKER' ? this.config.TICKER_SYMBOL :
                         this.config.INPUT_TYPE === 'GENESIS_TICKER' ? `G-${this.config.GENESIS_TICKER_SYMBOL}` :
                         this.config.GENESIS_CONTRACT_ADDRESS;
        // Output user-friendly error messages for renderer filtering
        if (this.config.INPUT_TYPE === 'TICKER') {
          console.log(`🔍 Ticker "${this.config.TICKER_SYMBOL}" not found`);
        } else if (this.config.INPUT_TYPE === 'TOKEN_CA') {
          console.log(`🔍 Token contract address "${this.config.DIRECT_TOKEN_CA}" is invalid`);
        }
        
        throw new Error(`Failed to resolve token CA from ${this.config.INPUT_TYPE}: ${inputDesc}`);
      }
      
      console.log(`\n✅ PHASE 1 COMPLETED - Token CA: ${detectedCA}`);
      
      // Blacklist check
      const inputTicker = this.config.INPUT_TYPE === 'TICKER' ? this.config.TICKER_SYMBOL : 
                          this.config.INPUT_TYPE === 'GENESIS_TICKER' ? this.config.GENESIS_TICKER_SYMBOL : null;
      if (TokenBlacklist.isTokenBlacklisted(detectedCA, inputTicker)) {
        console.log('\n🚫 ==================== BLACKLISTED TOKEN DETECTED ====================');
        console.log('❌ OPERATION BLOCKED: This token is on the HARDCODED BLACKLIST');
        console.log('🛑 ONLYREBUY WILL NOT BUY BLACKLISTED TOKENS FOR SAFETY');
        throw new Error('Token is blacklisted and cannot be bought via ONLYREBUY');
      }
      
      // Phase 2: Get token metadata using TokenInfoResolver
      console.log('\n📊 PHASE 2: Token Metadata Resolution');
      const tokenInfo = await TokenInfoResolver.getTokenInfoWithPool(detectedCA);
      
      console.log(`✅ PHASE 2 COMPLETED - Token: ${tokenInfo.symbol} (${tokenInfo.decimals} decimals)`);
      
      // Phase 3: ONLYREBUY Mode using RebuyManager
      console.log('\n🎯 PHASE 3: ONLYREBUY Mode Execution');
      this.rebuyManager = new RebuyManager(
        this.wallets,
        {
          address: detectedCA,
          symbol: tokenInfo.symbol,
          decimals: tokenInfo.decimals,
          poolAddress: tokenInfo.poolAddress || null
        },
        null, // No percentage threshold needed for ONLYREBUY
        this.config.ONLYREBUY_INTERVAL_MINUTES
      );
      
      // Execute ONLYREBUY mode with target price and amount
      await this.rebuyManager.executeOnlyRebuyMode(
        this.config.ONLYREBUY_TARGET_PRICE,
        this.config.ONLYREBUY_AMOUNT
      );
      
    } catch (error) {
      if (error.message === 'Detection interrupted by user') {
        console.log('\n👋 ONLYREBUY MODE stopped by user during detection phase');
        process.exit(0);
      } else {
        console.log(`\n❌ ONLYREBUY MODE FAILED: ${error.message}`);
        console.error('Stack:', error.stack);
        process.exit(1);
      }
    }
  }

  /**
   * Get gas price with 1x multiplier + 50% priority (INSTANT speed)
   */
  async getGasPrice() {
    try {
      // Use JeetBot-specific gas pricing (1x multiplier + 50% priority)
      const gasPrice = await gasPriceService.getJeetBotGasPrice();
      const gasPriceData = await gasPriceService.getCurrentGasPriceWithMultiplier(1);
      
      console.log(`⛽ JeetBot Dynamic Gas: ${gasPriceData.baseGasPrice} gwei × 1 = ${gasPriceData.gasPrice} gwei + ${gasPriceData.priorityFee} gwei (50% priority) = ${gasPriceData.totalGasFee} gwei`);
      
      return gasPrice;
    } catch (error) {
      console.log(`❌ JeetBot gas price failed, using fallback: ${error.message}`);
      // Fallback to 0.03 gwei (1x multiplier of 0.02 + 50% priority)
      return ethers.parseUnits('0.03', 'gwei');
    }
  }
} 