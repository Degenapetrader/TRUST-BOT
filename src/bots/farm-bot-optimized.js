/**
 * Optimized FarmBot Class
 * Orchestrates farming operations using modular services
 */

import { ethers } from 'ethers';
import { 
  walletsDB, 
  provider, 
  VIRTUAL_TOKEN_ADDRESS,
  ERC20_ABI
} from '../config/index.js';
import { tradingWallets } from '../wallets/index.js';
import { TRUSTSWAP_ABI } from '../config/constants.js';
import { TRUSTSWAP_CONTRACT } from './config/jeetConstants.js';
import { sleep, logWithTimestamp } from '../utils/index.js';
import { ProviderManager } from '../providers/manager.js';
import { FarmCommandParser } from './services/farmCommandParser.js';
import { FarmExecutor } from './services/farmExecutor.js';
import { FarmTracker } from './services/farmTracker.js';
import { FarmValidator } from './services/farmValidator.js';
import { FarmCalculator } from './services/farmCalculator.js';
import { TokenResolver } from './services/tokenResolver.js';
import { gasPriceService } from '../providers/gasPriceService.js';

// Global termination flag for graceful shutdown
let isTerminating = false;

// Export termination flag globally so other modules can check it
global.isTerminating = false;

// Signal handlers for graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM. Shutting down gracefully...');
  isTerminating = true;
  global.isTerminating = true;
});

process.on('SIGINT', () => {
  console.log('\n👋 Received SIGINT. Shutting down gracefully...');
  isTerminating = true;
  global.isTerminating = true;
});

// Timeout mechanism - DISABLED for farmbot to allow unlimited farming
// const OPERATION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export class FarmBot {
  constructor(bidMode = false) {
    this.providers = new ProviderManager();
    this.tracker = new FarmTracker();
    this.settings = FarmCommandParser.getDefaultSettings();
    this.calculator = new FarmCalculator(this.settings);
    this.validator = new FarmValidator(this.providers);
    this.tokenResolver = new TokenResolver(null, bidMode);
    this.bidMode = bidMode;
    this.isRunning = false;
    this.operationPromise = null;
  }
  
  /**
   * Main entry point for FarmBot
   * @param {string[]} args - Command line arguments
   * @returns {Promise<boolean>} Success status
   */
  async run(args) {
    try {
      // Show usage if requested
      if (args.includes('--help') || args.includes('-h')) {
        FarmCommandParser.showUsage();
        return true;
      }
      
      // Parse command
      const command = await this.parseAndValidateCommand(args);
      if (!command) return false;
      
      // Set running flag
      this.isRunning = true;
      
      // Run without timeout - farmbot can now run indefinitely
      this.operationPromise = command.bidMode ? 
        this.executeBidModeFarming(command) : 
        this.executeFarming(command);
      
      // Timeout removed - farmbot runs without time limits
      try {
        await this.operationPromise;
        return true;
      } catch (error) {
        // No timeout handling needed
        throw error;
      }
      
    } catch (error) {
      console.error('\n❌ FarmBot Error:', error.message);
      return false;
    } finally {
      this.isRunning = false;
      this.operationPromise = null;
    }
  }
  
  /**
   * Static method to create and run FarmBot with BID-MODE detection
   * @param {string[]} args - Command line arguments
   * @returns {Promise<boolean>} Success status
   */
  static async execute(args) {
    console.log(`🔄 FarmBot: Starting execution with ${args ? args.length : 0} arguments`);
    
    // Create a collection of wallets from environment variables (B1-B20)
    console.log(`🔐 FarmBot: Checking for wallet private keys...`);
    
    // Collect all wallets - from env vars and wallets.json
    const allWallets = [];
    
    // First, add wallets from environment variables (B1-B20)
    const envWallets = [];
    for (let i = 1; i <= 20; i++) {
      const envName = `B${i}`;
      const privateKey = process.env[envName];
      
      if (privateKey && privateKey.length > 30) { // Simple validation
        try {
          // Create wallet with ethers
          const wallet = new ethers.Wallet(privateKey, provider);
          
          // Add metadata
          wallet.name = envName;
          wallet.metadata = { _keyFromEnv: true };
          
          envWallets.push(wallet);
          console.log(`✅ Loaded wallet ${envName} from environment variable: ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`);
        } catch (error) {
          console.error(`❌ Error loading wallet ${envName} from environment: ${error.message}`);
        }
      }
    }
    
    // Report on environment wallets
    if (envWallets.length > 0) {
      console.log(`🔐 FarmBot: Found ${envWallets.length} valid wallets from environment variables`);
      
      // Add to combined wallet list
      allWallets.push(...envWallets);
    } else {
      console.log(`⚠️ FarmBot: No valid wallet private keys found in environment variables`);
    }
    
    // Next, add wallets from tradingWallets array (wallets.json)
    const jsonWallets = tradingWallets.filter(wallet => 
      // Filter out any wallets that would duplicate env wallets
      !envWallets.some(envWallet => envWallet.address === wallet.address)
    );
    
    // Report on JSON wallets
    if (jsonWallets.length > 0) {
      console.log(`📄 FarmBot: Adding ${jsonWallets.length} wallet(s) from wallets.json`);
      
      // Add to combined wallet list
      allWallets.push(...jsonWallets);
    }
    
    // Report on final combined wallet list
    console.log(`👛 FarmBot: Using a combined total of ${allWallets.length} wallet(s) for execution`);
    console.log(`   🔐 ${envWallets.length} wallet(s) from environment variables`);
    console.log(`   📄 ${jsonWallets.length} wallet(s) from wallets.json`);
    
    // Store original method
    const originalParseCommand = FarmCommandParser.parseCommand;
    
    // Monkey patch the FarmCommandParser.parseCommand method to use our combined wallet list
    FarmCommandParser.parseCommand = function(args, _unusedWallets) {
      // Call the original method but with our combined wallet list
      return originalParseCommand.call(this, args, allWallets);
    };
    
    // Detect BID-MODE early and create the bot
    const isBidMode = args.some(arg => arg.toLowerCase() === 'bid-mode');
    console.log(`${isBidMode ? '🎯 BID-MODE detected' : '🪙 Regular mode detected'}`);
    
    // Parse command with our monkey-patched method
    const parsedCommand = FarmCommandParser.parseCommand(args, allWallets);
    const bot = new FarmBot(parsedCommand.bidMode);
    
    // Restore original method
    FarmCommandParser.parseCommand = originalParseCommand;
    
    return await bot.runWithParsedCommand(parsedCommand);
  }
  
  /**
   * Run with pre-parsed command to avoid double parsing
   * @param {Object} parsedCommand - Pre-parsed command object
   * @returns {Promise<boolean>} Success status
   */
  async runWithParsedCommand(parsedCommand) {
    try {
      // Update settings if custom gas price provided
      if (parsedCommand.customGasPrice) {
        this.settings.GAS_PRICE = parsedCommand.customGasPrice;
      }
      
      // Resolve token information
      console.log(`\n🔍 Resolving token: ${parsedCommand.tokenInput}...`);
      const tokenInfo = await this.tokenResolver.getTokenInfo(parsedCommand.tokenInput);
      
      if (!tokenInfo || !tokenInfo.address) {
        throw new Error(`Failed to resolve token: ${parsedCommand.tokenInput}`);
      }
      
      parsedCommand.tokenInfo = tokenInfo;
      console.log(`✅ Token resolved: ${tokenInfo.symbol || 'Unknown'} (${tokenInfo.address})`);
      
      // BID-MODE specific validation
      if (parsedCommand.bidMode) {
        console.log(`🎯 BID-MODE: Using bid.json database and ETH currency`);
      }
      
      // Set running flag
      this.isRunning = true;
      
      // Run without timeout - farmbot can now run indefinitely
      this.operationPromise = parsedCommand.bidMode ? 
        this.executeBidModeFarming(parsedCommand) : 
        this.executeFarming(parsedCommand);
      
      // Timeout removed - farmbot runs without time limits
      try {
        await this.operationPromise;
        return true;
      } catch (error) {
        // No timeout handling needed
        throw error;
      }
      
    } catch (error) {
      console.error('\n❌ FarmBot Error:', error.message);
      return false;
    } finally {
      this.isRunning = false;
      this.operationPromise = null;
    }
  }
  
  /**
   * Stop the farming operation
   */
  stop() {
    console.log('\n🛑 Stopping FarmBot...');
    this.isRunning = false;
    // The actual stopping happens through the isRunning flag check in loops
  }
  
  /**
   * Parse and validate command arguments
   * @param {string[]} args - Command arguments
   * @returns {Object} Parsed command
   */
  async parseAndValidateCommand(args) {
    // Parse command
    const parsedCommand = FarmCommandParser.parseCommand(args, tradingWallets);
    
    // Update settings if custom gas price provided
    if (parsedCommand.customGasPrice) {
      this.settings.GAS_PRICE = parsedCommand.customGasPrice;
    }
    
    // Resolve token information
    console.log(`\n🔍 Resolving token: ${parsedCommand.tokenInput}...`);
    const tokenInfo = await this.tokenResolver.getTokenInfo(parsedCommand.tokenInput);
    
    if (!tokenInfo || !tokenInfo.address) {
      throw new Error(`Failed to resolve token: ${parsedCommand.tokenInput}`);
    }
    
    // For CA inputs without pool, show delegation message
    if (tokenInfo.isDirectCA && !tokenInfo.poolAddress) {
      console.log(`⚠️ No pool found for CA, using TRUSTSWAP delegation mode`);
    }
    
    parsedCommand.tokenInfo = tokenInfo;
    console.log(`✅ Token resolved: ${tokenInfo.symbol || 'Unknown'} (${tokenInfo.address})`);
    
    // BID-MODE specific validation
    if (parsedCommand.bidMode) {
      console.log(`🎯 BID-MODE: Using bid.json database and ETH currency`);
    }
    
    return parsedCommand;
  }
  
  /**
   * Execute farming operation
   * @param {Object} command - Parsed command
   */
  async executeFarming(command) {
    const { selectedWallets, tokenInfo, amount, loops } = command;
    const swapContract = new ethers.Contract(TRUSTSWAP_CONTRACT, TRUSTSWAP_ABI, provider);
    
    // Calculate amounts
    const amountPerWallet = this.calculator.calculateAmountPerWallet(amount, selectedWallets.length);
    
    // Show farming plan
    const plan = this.calculator.getFarmingPlan({
      wallets: selectedWallets,
      amount,
      loops,
      tokenInfo
    });
    this.displayFarmingPlan(plan);
    
    // Validate requirements
    const validation = await this.validator.validateFarmingRequirements(
      selectedWallets,
      tokenInfo.address,
      amountPerWallet,
      loops
    );
    
    if (!validation.valid) {
      throw new Error('Validation failed. Please check wallet balances.');
    }
    
    // Create executor
    const executor = new FarmExecutor(swapContract, this.settings);
    
    // Execute farming for each loop, processing all wallets in each loop
    console.log('\n🚀 Starting farming operations...\n');
    console.log(`📋 EXECUTION ORDER: Loop-by-Loop (${loops} loops × ${selectedWallets.length} wallets)`);
    console.log(`🔄 Each loop will process all wallets sequentially\n`);
    
    // Loop-by-loop execution
    for (let loop = 1; loops === Infinity || loop <= loops; loop++) {
      if (!this.isRunning) {
        console.log('🛑 Farming stopped by user');
        break;
      }
      
      console.log(`LOOP ${loop}/${loops === Infinity ? '∞' : loops}`);
      process.stdout.write(''); // Force flush for consistent output
      
      // Process all wallets in this loop
      for (let walletIndex = 0; walletIndex < selectedWallets.length; walletIndex++) {
        const wallet = selectedWallets[walletIndex];
        
              if (!this.isRunning) {
                console.log('🛑 Farming stopped by user');
                break;
              }
              
        console.log(`\n💼 WALLET: ${wallet.name} (${wallet.address.slice(0, 8)}...)`);
        // console.log(`📍 Progress: Loop ${loop}/${loops}, Wallet ${walletIndex + 1}/${selectedWallets.length}`);
              
        try {
              // Add randomness to amount (±10%)
              const randomMultiplier = 90n + BigInt(Math.floor(Math.random() * 20)); // 90-110
          const currentAmount = amountPerWallet * randomMultiplier / 100n;
          
          console.log(`💰 Amount: ${ethers.formatUnits(currentAmount, 18)} VIRTUAL (${(Number(randomMultiplier)/10).toFixed(1)}% of base)`);
              
              const cycleResult = await executor.executeFarmCycle(
                wallet,
            tokenInfo,
                currentAmount,
            {
              gasPrice: this.settings.GAS_PRICE,
              gasLimit: this.settings.GAS_LIMIT
            },
            VIRTUAL_TOKEN_ADDRESS
              );
              
          // Track results for this wallet and loop
          this.tracker.addWalletResults(wallet.name, [{
                loop,
                ...cycleResult
          }]);
          
          if (cycleResult.success) {
            console.log(`✅ ${wallet.name}: Farm cycle completed successfully`);
          } else if (cycleResult.timeout) {
            console.log(`⏱️ ${wallet.name}: Operation timed out`);
          } else {
            console.log(`❌ ${wallet.name}: Farm cycle failed`);
          }
          
        } catch (error) {
          console.error(`\n❌ ${wallet.name} farming failed:`, error.message);
          
          // Track the failure
          this.tracker.addWalletResults(wallet.name, [{
            loop,
            success: false,
            error: error.message,
            cycleSuccess: false
          }]);
        }
        
        // Delay between wallets within the same loop (except after last wallet)
        if (walletIndex < selectedWallets.length - 1 && this.isRunning) {
          const walletDelay = Math.random() * 
            (this.settings.DELAY_BETWEEN_TXS_MAX - this.settings.DELAY_BETWEEN_TXS_MIN) + 
            this.settings.DELAY_BETWEEN_TXS_MIN;
          console.log(`⏱️  Waiting ${walletDelay.toFixed(1)}s before next wallet...`);
          await sleep(walletDelay * 1000);
              }
            }
            
      // Delay between loops (except after last loop)
      if (loop < loops && this.isRunning) {
        const loopDelay = Math.random() * 
          (this.settings.LOOP_DELAY_MAX - this.settings.LOOP_DELAY_MIN) + 
          this.settings.LOOP_DELAY_MIN;
        console.log(`\n⏳ Waiting ${loopDelay.toFixed(1)}s before next loop...\n`);
        await sleep(loopDelay * 1000);
      }
    }
    
    // Display final results
    this.tracker.displayResults();
  }
  
  /**
   * Execute BID-MODE farming operation using ETH
   * @param {Object} command - Parsed command
   */
  async executeBidModeFarming(command) {
    const { selectedWallets, tokenInfo, amount, loops } = command;
    const swapContract = new ethers.Contract(TRUSTSWAP_CONTRACT, TRUSTSWAP_ABI, provider);
    
    // In BID-MODE, amount is in ETH, not VIRTUAL
    const ethAmountPerWallet = ethers.parseEther(amount.toString());
    
    // Show BID-MODE farming plan
    const plan = this.getBidModeFarmingPlan({
      wallets: selectedWallets,
      ethAmount: amount,
      loops,
      tokenInfo
    });
    this.displayBidModeFarmingPlan(plan);
    
    // Validate ETH requirements
    const validation = await this.validateBidModeRequirements(
      selectedWallets,
      ethAmountPerWallet,
      loops
    );
    
    if (!validation.valid) {
      throw new Error('BID-MODE validation failed. Please check wallet ETH balances.');
    }
    
    // Create executor
    const executor = new FarmExecutor(swapContract, this.settings);
    
    // Execute BID-MODE farming for each loop
    console.log('\n🚀 Starting BID-MODE farming operations...\n');
    console.log(`📋 EXECUTION ORDER: Loop-by-Loop (${loops} loops × ${selectedWallets.length} wallets)`);
    console.log(`🎯 BID-MODE: Using ETH currency and 3% tax on sells\n`);
    
    // Loop-by-loop execution
    for (let loop = 1; loops === Infinity || loop <= loops; loop++) {
      if (!this.isRunning) {
        console.log('🛑 Farming stopped by user');
        break;
      }
      
      console.log(`LOOP ${loop}/${loops === Infinity ? '∞' : loops}`);
      process.stdout.write(''); // Force flush for consistent output
      
      // Process all wallets in this loop
      for (let walletIndex = 0; walletIndex < selectedWallets.length; walletIndex++) {
        const wallet = selectedWallets[walletIndex];
        
        if (!this.isRunning) {
          console.log('🛑 Farming stopped by user');
          break;
        }
        
        console.log(`\n💼 WALLET: ${wallet.name} (${wallet.address.slice(0, 8)}...)`);
        // console.log(`📍 Progress: Loop ${loop}/${loops}, Wallet ${walletIndex + 1}/${selectedWallets.length}`);
        
        try {
          // Add randomness to ETH amount (±10%)
          const randomMultiplier = 90n + BigInt(Math.floor(Math.random() * 20)); // 90-110
          const currentEthAmount = ethAmountPerWallet * randomMultiplier / 100n;
          
          console.log(`💰 Amount: ${ethers.formatEther(currentEthAmount)} ETH (${(Number(randomMultiplier)/10).toFixed(1)}% of base)`);
          
          const cycleResult = await executor.executeETHFarmCycle(
            wallet,
            tokenInfo,
            currentEthAmount,
            {
              gasPrice: this.settings.GAS_PRICE,
              gasLimit: this.settings.GAS_LIMIT
            }
          );
          
          // Track results for this wallet and loop
          this.tracker.addWalletResults(wallet.name, [{
            loop,
            ...cycleResult
          }]);
          
          if (cycleResult.success) {
            console.log(`✅ ${wallet.name}: BID-MODE ETH farm cycle completed successfully`);
          } else if (cycleResult.timeout) {
            console.log(`⏱️ ${wallet.name}: Operation timed out`);
          } else {
            console.log(`❌ ${wallet.name}: BID-MODE ETH farm cycle failed`);
          }
          
        } catch (error) {
          console.error(`\n❌ ${wallet.name} BID-MODE farming failed:`, error.message);
          
          // Track the failure
          this.tracker.addWalletResults(wallet.name, [{
            loop,
            success: false,
            error: error.message,
            cycleSuccess: false,
            bidMode: true
          }]);
        }
        
        // Delay between wallets within the same loop (except after last wallet)
        if (walletIndex < selectedWallets.length - 1 && this.isRunning) {
          const walletDelay = Math.random() * 
            (this.settings.DELAY_BETWEEN_TXS_MAX - this.settings.DELAY_BETWEEN_TXS_MIN) + 
            this.settings.DELAY_BETWEEN_TXS_MIN;
          console.log(`⏱️  Waiting ${walletDelay.toFixed(1)}s before next wallet...`);
          await sleep(walletDelay * 1000);
        }
      }
      
      // Delay between loops (except after last loop)
      if (loop < loops && this.isRunning) {
        const loopDelay = Math.random() * 
          (this.settings.LOOP_DELAY_MAX - this.settings.LOOP_DELAY_MIN) + 
          this.settings.LOOP_DELAY_MIN;
        console.log(`\n⏳ Waiting ${loopDelay.toFixed(1)}s before next loop...\n`);
        await sleep(loopDelay * 1000);
      }
    }
    
    // Display final results
    this.tracker.displayResults();
  }
  
  /**
   * Get BID-MODE farming plan
   * @param {Object} params - Farming parameters
   * @returns {Object} BID-MODE farming plan
   */
  getBidModeFarmingPlan(params) {
    const { wallets, ethAmount, loops, tokenInfo } = params;
    
    const ethAmountPerWallet = ethers.parseEther(ethAmount.toString());
    const totalPerWallet = ethAmountPerWallet * BigInt(loops);
    const grandTotal = totalPerWallet * BigInt(wallets.length);
    
    const timings = this.calculator.calculateTimings();
    const estimatedTotalTime = timings.estimatedTimePerLoop * loops * wallets.length;
    
    return {
      token: {
        symbol: tokenInfo.symbol || 'Unknown',
        address: tokenInfo.address,
        decimals: tokenInfo.decimals || 18
      },
      wallets: wallets.map(w => ({
        name: w.name,
        address: w.address
      })),
      amounts: {
        amountPerLoop: ethAmount.toString(),
        totalPerWallet: ethers.formatEther(totalPerWallet),
        grandTotal: ethers.formatEther(grandTotal),
        summary: `${wallets.length} wallets × ${loops} loops × ${ethAmount} ETH = ${ethers.formatEther(grandTotal)} ETH total`
      },
      timing: {
        ...timings,
        estimatedTotalTime: `${Math.ceil(estimatedTotalTime / 60)} minutes`
      },
      settings: {
        slippage: `${this.settings.MAX_SLIPPAGE_PERCENT}%`,
        gasPrice: this.settings.GAS_PRICE,
        gasLimit: this.settings.GAS_LIMIT,
        bidMode: true,
        currency: 'ETH',
        tax: '3% on sells'
      }
    };
  }
  
  /**
   * Validate BID-MODE requirements
   * @param {Array} wallets - Selected wallets
   * @param {BigInt} ethAmountPerWallet - ETH amount per wallet
   * @param {number} loops - Number of loops
   * @returns {Object} Validation result
   */
  async validateBidModeRequirements(wallets, ethAmountPerWallet, loops) {
    const totalEthNeeded = ethAmountPerWallet * BigInt(loops);
    
    console.log(`\n🔍 Validating BID-MODE ETH requirements...`);
    
    for (const wallet of wallets) {
      const ethBalance = await provider.getBalance(wallet.address);
      
      if (ethBalance < totalEthNeeded) {
        console.log(`❌ ${wallet.name}: Insufficient ETH balance`);
        console.log(`   Required: ${ethers.formatEther(totalEthNeeded)} ETH`);
        console.log(`   Available: ${ethers.formatEther(ethBalance)} ETH`);
        return { valid: false, error: `Insufficient ETH balance for ${wallet.name}` };
      } else {
        console.log(`✅ ${wallet.name}: ${ethers.formatEther(ethBalance)} ETH (Required: ${ethers.formatEther(totalEthNeeded)} ETH)`);
      }
    }
    
    return { valid: true };
  }
  
  /**
   * Display BID-MODE farming plan
   * @param {Object} plan - BID-MODE farming plan details
   */
  displayBidModeFarmingPlan(plan) {
    console.log('\n' + '='.repeat(60));
    console.log('🎯 BID-MODE FARMING PLAN');
    console.log('='.repeat(60));
    
    console.log(`\n🪙 TOKEN:`);
    console.log(`  • Symbol: ${plan.token.symbol}`);
    console.log(`  • Address: ${plan.token.address}`);
    
    console.log(`\n💼 WALLETS (${plan.wallets.length}):`);
    for (const wallet of plan.wallets) {
      console.log(`  • ${wallet.name}: ${wallet.address}`);
    }
    
    console.log(`\n💰 AMOUNTS (ETH):`);
    console.log(`  • Per Loop: ${plan.amounts.amountPerLoop} ETH`);
    console.log(`  • Per Wallet Total: ${plan.amounts.totalPerWallet} ETH`);
    console.log(`  • Grand Total: ${plan.amounts.grandTotal} ETH`);
    console.log(`  • Summary: ${plan.amounts.summary}`);
    
    console.log(`\n⏱️  TIMING:`);
    console.log(`  • Loop Delay: ${plan.timing.loopDelayMin}-${plan.timing.loopDelayMax}s`);
    console.log(`  • TX Delay: ${plan.timing.txDelayMin}-${plan.timing.txDelayMax}s`);
    console.log(`  • Estimated Total Time: ${plan.timing.estimatedTotalTime}`);
    
    console.log(`\n⚙️  SETTINGS:`);
    console.log(`  • Currency: ${plan.settings.currency} (BID-MODE)`);
    console.log(`  • Tax: ${plan.settings.tax}`);
    console.log(`  • Max Slippage: ${plan.settings.slippage}`);
    console.log(`  • Gas Price: ${plan.settings.gasPrice} gwei`);
    console.log(`  • Gas Limit: ${plan.settings.gasLimit}`);
    
    console.log('\n' + '='.repeat(60));
  }
  
  /**
   * Display farming plan
   * @param {Object} plan - Farming plan details
   */
  displayFarmingPlan(plan) {
    console.log('\n' + '='.repeat(60));
    console.log('🌾 FARMING PLAN');
    console.log('='.repeat(60));
    
    console.log(`\n🪙 TOKEN:`);
    console.log(`  • Symbol: ${plan.token.symbol}`);
    console.log(`  • Address: ${plan.token.address}`);
    
    console.log(`\n💼 WALLETS (${plan.wallets.length}):`);
    for (const wallet of plan.wallets) {
      console.log(`  • ${wallet.name}: ${wallet.address}`);
    }
    
    console.log(`\n💰 AMOUNTS:`);
    console.log(`  • Per Loop: ${plan.amounts.amountPerLoop} VIRTUAL`);
    console.log(`  • Per Wallet Total: ${plan.amounts.totalPerWallet} VIRTUAL`);
    console.log(`  • Grand Total: ${plan.amounts.grandTotal} VIRTUAL`);
    console.log(`  • Summary: ${plan.amounts.summary}`);
    
    console.log(`\n⏱️  TIMING:`);
    console.log(`  • Loop Delay: ${plan.timing.loopDelayMin}-${plan.timing.loopDelayMax}s`);
    console.log(`  • TX Delay: ${plan.timing.txDelayMin}-${plan.timing.txDelayMax}s`);
    console.log(`  • Estimated Total Time: ${plan.timing.estimatedTotalTime}`);
    
    console.log(`\n⚙️  SETTINGS:`);
    console.log(`  • Max Slippage: ${plan.settings.slippage}`);
    console.log(`  • Gas Price: ${plan.settings.gasPrice} gwei`);
    console.log(`  • Gas Limit: ${plan.settings.gasLimit}`);
    
    console.log('\n' + '='.repeat(60));
  }
}

// Export for use in farmbot.mjs wrapper
export default FarmBot; 