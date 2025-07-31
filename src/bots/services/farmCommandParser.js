/**
 * FarmBot Command Parser Service
 * Handles parsing and validation of farmbot command arguments
 */

import { WalletParser, ArgumentParser } from '../../parsing/index.js';

// Default settings for farmbot
const DEFAULT_SETTINGS = {
  NUM_LOOPS: 1,
  VIRTUAL_AMOUNT_MIN_PERCENT: 0.1,
  VIRTUAL_AMOUNT_MAX_PERCENT: 1.0,
  MAX_SLIPPAGE_PERCENT: 10,
  LOOP_DELAY_MIN: 1,
  LOOP_DELAY_MAX: 2,
  DELAY_BETWEEN_TXS_MIN: 5,
  DELAY_BETWEEN_TXS_MAX: 10,
  GAS_PRICE: '0.02',
  GAS_LIMIT: '500000'
};

export class FarmCommandParser {
  /**
   * Parse farmbot command arguments
   * Format: [wallets] <token> <amount> [C-currency] [L-loops] [gas] [BID-MODE]
   * @param {string[]} args - Command line arguments
   * @param {Object[]} availableWallets - Available wallets from config
   * @returns {Object} Parsed command object
   */
  static parseCommand(args, availableWallets) {
    console.log('🔍 Parsing farmbot command format...');
    
    // Step 1: Parse command modifiers
    let { bidMode, remainingArgs: afterBidMode } = ArgumentParser.parseBidMode(args);
    let { selectedWallets, remainingArgs: afterWallets } = WalletParser.parse(afterBidMode, availableWallets);
    let { customGasPrice, remainingArgs: afterGas } = ArgumentParser.parseGasPrice(afterWallets);
    let { loops: parsedLoops, remainingArgs: afterLoops } = ArgumentParser.parseLoops(afterGas, 'farmbot');
    
    // Step 2: Parse single token and amount
    if (afterLoops.length < 2) {
      throw new Error('Token and amount must be specified');
    }
    
    // Check for multiple tokens (not allowed)
    if (afterLoops.length > 2) {
      throw new Error('FarmBot supports only ONE token at a time. For multiple tokens, run separate commands.');
    }
    
    const loops = (parsedLoops === null || parsedLoops === undefined) ? DEFAULT_SETTINGS.NUM_LOOPS : parsedLoops;
    
    const tokenInput = afterLoops[0];
    const amount = afterLoops[1];
    
    if (!tokenInput || tokenInput.trim().length === 0) {
      throw new Error('Invalid token input');
    }
    
    if (!amount || (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)) {
      throw new Error(`Invalid amount "${amount}" for token ${tokenInput}. Must be a positive number`);
    }
    
    // BID-MODE validation and logging
    if (bidMode) {
      console.log('🎯 BID-MODE detected: Using bid.json database and ETH currency');
    }
    
    const parsedCommand = {
      selectedWallets,
      tokenInput,
      amount: parseFloat(amount),
      loops,
      customGasPrice,
      bidMode,
      // Currency support - C-TOKEN parsing (not currently implemented in farmbot)
      currency: null
    };
    
    return this.validateCommand(parsedCommand);
  }
  
  /**
   * Validate parsed command
   * @param {Object} parsedCommand - Parsed command object
   * @returns {Object} Validated command
   */
  static validateCommand(parsedCommand) {
    const { selectedWallets, tokenInput, amount, loops } = parsedCommand;
    
    if (!selectedWallets || selectedWallets.length === 0) {
      throw new Error('No wallets selected');
    }
    
    if (!tokenInput) {
      throw new Error('Token must be specified');
    }
    
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }
    
    if (loops <= 0) {
      throw new Error('Loops must be positive');
    }
    
    return parsedCommand;
  }
  
  /**
   * Show usage information
   */
  static showUsage() {
    console.log('🔄 FARMBOT - Single Token Command Format');
    console.log('========================================');
    console.log('');
    console.log('📋 FORMAT:');
    console.log('  farmbot [wallets] <token> <amount> [L-loops] [gas]');
    console.log('');
    console.log('👛 WALLET SELECTION (optional, defaults to all wallets):');
    console.log('  • B1 B3 B5 - Use specific wallets');
    console.log('  • (empty) - Use all wallets');
    console.log('');
    console.log('🪙 TOKEN INPUT FORMATS:');
    console.log('  • Ticker Symbol: TRUST, VADER, MIKASA (uses database lookup)');
    console.log('  • Contract Address: 0x1234...abcd (auto-detects ticker + pool via find-pool)');
    console.log('');
    console.log('💰 AMOUNT:');
    console.log('  • Fixed: 100 (exact VIRTUAL amount)');
    console.log('');
    console.log('🔄 LOOPS (L-X FORMAT):');
    console.log('  • L-5 - Execute 5 loops');
    console.log('  • L-1 - Single execution (default)');
    console.log('');
    console.log('⛽ GAS PRICE:');
    console.log('  • gas0.075 - Custom gas price (0.075 gwei)');
    console.log('  • (empty) - Default 0.02 gwei');
    console.log('');
    console.log('📝 EXAMPLES:');
    console.log('  farmbot TRUST 100                           - Farm TRUST with 100 VIRTUAL (all wallets)');
    console.log('  farmbot 0x1234...abcd 100                   - Farm token via CA (auto-detects ticker + pool)');
    console.log('  farmbot B1 B3 TRUST 100                     - Farm TRUST (wallets B1, B3)');
    console.log('  farmbot 0x1234...abcd 100 L-5               - Farm CA token, 5 loops');
    console.log('  farmbot TRUST 100 L-2                       - Farm TRUST, 2 loops');
    console.log('  farmbot B1 B2 0x1234...abcd 100 gas0.075    - Full example with CA');
    console.log('');
    console.log('📝 BID-MODE EXAMPLES:');
    console.log('  farmbot TRUST 1 BID-MODE                    - Farm TRUST with 1 ETH (BID-MODE)');
    console.log('  farmbot B1 B3 TRUST 1 BID-MODE              - Farm TRUST with 1 ETH (specific wallets)');
    console.log('  farmbot TRUST 1 L-5 BID-MODE                - Farm TRUST with 1 ETH, 5 loops');
    console.log('  farmbot B1 TRUST 1 L-2 gas0.075 BID-MODE    - Full BID-MODE example');
    console.log('');
    console.log('⚠️  IMPORTANT: FarmBot supports only ONE token per command.');
    console.log('⚠️  BID-MODE: Uses ETH currency and bid.json database, 3% tax on sells.');
  }
  
  /**
   * Get default settings
   */
  static getDefaultSettings() {
    return { ...DEFAULT_SETTINGS };
  }
} 