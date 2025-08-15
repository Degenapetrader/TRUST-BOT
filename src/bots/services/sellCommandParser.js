/**
 * Sell Command Parser Service
 * Handles parsing of sellbot commands including FSH, TWAP, and regular modes
 */

import { ArgumentParser, WalletParser } from '../../parsing/index.js';
import { tradingWallets } from '../../wallets.js';

/**
 * SellCommandParser - Parses sellbot command arguments
 */
export class SellCommandParser {
  /**
   * Parse FSH (Flash Sell All) command
   * @param {Array} args - Command arguments
   * @returns {Object} Parsed FSH configuration
   */
  static parseFSHCommand(args) {
    const fshIndex = args.findIndex(arg => arg.toLowerCase() === 'fsh');
    if (fshIndex === -1) return null;
    
    // Check for BID-MODE
    let { bidMode, remainingArgs: afterBidMode } = ArgumentParser.parseBidMode(args);
    
    // Parse wallets up to FSH
    const walletArgs = afterBidMode.slice(0, fshIndex);
    const { selectedWallets } = WalletParser.parse(walletArgs, tradingWallets);
    
    // Parse gas price
    const gasArg = afterBidMode.find(arg => arg.toLowerCase().startsWith('gas'));
    const customGasPrice = gasArg ? gasArg.substring(3) : null;
    
    if (bidMode) {
      console.log('🎯 BID-MODE FSH: Using bid.json database and ETH currency');
    }
    
    return {
      mode: 'fsh',
      selectedWallets,
      customGasPrice,
      bidMode
    };
  }
  
  /**
   * Parse TWAP command for sellbot
   * @param {Array} args - Command arguments
   * @returns {Object|null} Parsed TWAP configuration
   */
  static parseTWAPCommand(args) {
    console.log(`🔍 SellBot TWAP Debug: Received args: [${args.join(', ')}]`);
    const twapIndex = args.findIndex(arg => arg.toLowerCase() === 'twap');
    console.log(`🔍 SellBot TWAP Debug: twapIndex=${twapIndex}, args.length=${args.length}`);
    if (twapIndex === -1 || args.length < twapIndex + 3) return null;
    
    // Command format: [token] [wallets] twap [amount] [duration] [currency] [gas] [BID-MODE]
    // Example: TRUST B1 twap 1000 5 BID-MODE
    
    // Step 1: Parse BID-MODE, wallets and gas from the full args first
    let { bidMode, remainingArgs: afterBidMode } = ArgumentParser.parseBidMode(args);
    const { selectedWallets } = WalletParser.parse(afterBidMode, tradingWallets);
    const { customGasPrice } = ArgumentParser.parseGasPrice(afterBidMode);
    
    // Step 2: Find the token (first argument that's not a wallet identifier)
    let token = null;
    const twapIndexAfterBidMode = afterBidMode.findIndex(arg => arg.toLowerCase() === 'twap');
    for (let i = 0; i < twapIndexAfterBidMode; i++) {
      const arg = afterBidMode[i];
      // Skip wallet identifiers (B1, B2, etc.) and gas arguments
      if (!arg.match(/^[Bb]\d+$/) && !arg.toLowerCase().startsWith('gas')) {
        token = arg;
        break;
      }
    }
    
    if (!token) {
      throw new Error('No token specified for TWAP mode');
    }
    
    // Step 3: Extract TWAP parameters
    const amount = afterBidMode[twapIndexAfterBidMode + 1];
    const duration = parseFloat(afterBidMode[twapIndexAfterBidMode + 2]) || afterBidMode[twapIndexAfterBidMode + 2];
    const intervals = afterBidMode[twapIndexAfterBidMode + 3]; // Extract user-specified order count
    
    console.log(`🔍 SellBot TWAP Debug: token=${token}, amount=${amount}, duration=${duration}, intervals=${intervals}`);
    console.log(`🔍 SellBot TWAP Debug: afterBidMode after TWAP: [${afterBidMode.slice(twapIndexAfterBidMode).join(', ')}]`);
    
    // Step 4: Find currency - BID-MODE defaults to ETH
    let currency = bidMode ? 'ETH' : null;
    
    // Check if the arg after intervals is a currency (not a gas argument)
    const potentialCurrency = afterBidMode[twapIndexAfterBidMode + 4];
    console.log(`🔍 SellBot TWAP Debug: potentialCurrency=${potentialCurrency}, bidMode=${bidMode}`);
    if (potentialCurrency && !potentialCurrency.toLowerCase().startsWith('gas')) {
      if (potentialCurrency.toLowerCase() === 'eth' || potentialCurrency.startsWith('C-') || potentialCurrency.startsWith('c-')) {
        currency = potentialCurrency;
        console.log(`🔍 SellBot TWAP Debug: Currency set from potentialCurrency: ${currency}`);
      }
    }
    
    // Also check other positions for currency
    if (!currency) {
      const ethIndex = afterBidMode.findIndex(arg => arg.toLowerCase() === 'eth');
      if (ethIndex !== -1) {
        currency = 'ETH';
      } else {
        const currencyIndex = afterBidMode.findIndex(arg => arg.startsWith('C-') || arg.startsWith('c-'));
        if (currencyIndex !== -1) {
          currency = afterBidMode[currencyIndex];
        }
      }
    }
    
    if (bidMode) {
      console.log(`🎯 BID-MODE TWAP: Using bid.json database and ${currency} currency`);
    }
    
    // Create tokenAmountPairs array for TWAP mode to prevent 'undefined' errors
    // This matches the structure expected by the error recovery code
    const tokenAmountPairs = [{
      tokenInput: token,
      amount: amount,
      currency: currency
    }];
    
    // Log the creation of tokenAmountPairs to help with debugging
    console.log(`📊 Created tokenAmountPairs for SellBot TWAP mode: ${JSON.stringify(tokenAmountPairs)}`);
    
    return {
      mode: 'TWAP', // Changed to uppercase for consistency with SellBot switch statement
      selectedWallets,
      tokenInput: token,
      amount,
      duration,
      intervals, // Add user-specified order count
      currency,
      customGasPrice,
      bidMode,
      // Add tokenAmountPairs array to prevent errors in validation
      tokenAmountPairs,
      // Add tokens and amounts arrays as fallback for error recovery code
      tokens: [token],
      amounts: [amount]
    };
  }
  
  /**
   * Parse the new sellbot command format with multiple token support
   * @param {Array} args - Command arguments
   * @returns {Object} Parsed command configuration
   */
  static parseNewSellbotFormat(args) {
    console.log('🔍 Parsing sellbot command format...');
    
    // Check for FSH mode first
    if (args.some(arg => arg.toLowerCase() === 'fsh')) {
      return this.parseFSHCommand(args);
    }
    
    // Check for TWAP mode
    const twapIndex = args.findIndex(arg => arg.toLowerCase() === 'twap');
    if (twapIndex !== -1) {
      const twapConfig = this.parseTWAPCommand(args);
      console.log(`📋 Parsed TWAP command:`);
      console.log(`   👛 Wallets: ${twapConfig.selectedWallets.length}`);
      console.log(`   🪙 Token: ${twapConfig.tokenInput}`);
      console.log(`   💰 Amount: ${twapConfig.amount}`);
      console.log(`   ⏱️ Duration: ${twapConfig.duration} minutes`);
      console.log(`   💱 Currency: ${twapConfig.currency || 'VIRTUAL'}`);
      console.log(`   ⛽ Gas: ${twapConfig.customGasPrice || '0.02'} gwei`);
      return twapConfig;
    }
    
    // Regular sell mode parsing
    
    // Step 1: Parse BID-MODE and command modifiers (wallets, gas, loops, execution mode)
    let { bidMode, remainingArgs: afterBidMode } = ArgumentParser.parseBidMode(args);
    const { selectedWallets, remainingArgs: afterWallets } = WalletParser.parse(afterBidMode, tradingWallets);
    const { customGasPrice, remainingArgs: afterGas } = ArgumentParser.parseGasPrice(afterWallets);
    const { loops: parsedLoops, remainingArgs: afterLoops } = ArgumentParser.parseLoops(afterGas);
    
    // Step 2: Parse slow mode
    let slowMode = false;
    const slowIndex = afterLoops.findIndex(arg => arg.toLowerCase() === 'slow');
    if (slowIndex !== -1) {
      slowMode = true;
      afterLoops.splice(slowIndex, 1);
    }
    
    // Step 3: Check for currency - BID-MODE defaults to ETH
    let currency = bidMode ? 'ETH' : null;
    const ethIndex = afterLoops.findIndex(arg => arg.toLowerCase() === 'eth');
    if (ethIndex !== -1) {
      currency = 'ETH';
      afterLoops.splice(ethIndex, 1);
    } else {
      const currencyIndex = afterLoops.findIndex(arg => arg.startsWith('C-') || arg.startsWith('c-'));
      if (currencyIndex !== -1) {
        currency = afterLoops[currencyIndex];
        afterLoops.splice(currencyIndex, 1);
      }
    }
    
    // Log BID-MODE status
    if (bidMode) {
      console.log(`🎯 BID-MODE active: using bid.json database and ${currency} currency`);
    }
    
    // Step 4: Parse tokens and amounts (same pattern as buybot)
    if (afterLoops.length % 2 !== 0) {
      throw new Error('Invalid format: Number of tokens must match number of amounts');
    }
    
    const tokenCount = afterLoops.length / 2;
    const tokens = afterLoops.slice(0, tokenCount);
    const amounts = afterLoops.slice(tokenCount);
    
    if (tokens.length === 0) {
      throw new Error('At least one token must be specified');
    }
    
    // Create token-amount pairs
    const tokenAmountPairs = tokens.map((token, index) => ({
      tokenInput: token,
      amount: amounts[index],
      currency: currency
    }));
    
    // Log parsed command details
    console.log(`📋 Parsed sellbot command:`);
    console.log(`   👛 Wallets: ${selectedWallets.length}`);
    console.log(`   🪙 Tokens: ${tokens.join(', ')}`);
    console.log(`   💰 Amounts: ${amounts.join(', ')}`);
    console.log(`   💱 Currency: ${currency || 'VIRTUAL'}`);
    console.log(`   🔄 Loops: ${parsedLoops}`);
    console.log(`   ⚡ Mode: ${slowMode ? 'SEQUENTIAL' : 'PARALLEL'}`);
    console.log(`   ⛽ Gas: ${customGasPrice || '0.02'} gwei`);
    if (bidMode) {
      console.log(`   🎯 BID-MODE: Using bid.json database`);
    }
    
    return {
      mode: 'regular',
      selectedWallets,
      tokenAmountPairs,
      loops: parsedLoops,
      currency,
      slowMode,
      customGasPrice,
      bidMode
    };
  }
  
  /**
   * Validate parsed sellbot command
   * @param {Object} parsedCommand - Parsed command object
   * @throws {Error} If validation fails
   */
  static validateCommand(parsedCommand) {
    if (!parsedCommand.selectedWallets || parsedCommand.selectedWallets.length === 0) {
      throw new Error('No wallets selected');
    }
    
    // Skip token validation for FSH mode as it scans tokens internally
    if (parsedCommand.mode === 'FSH' || parsedCommand.mode === 'fsh') {
      // FSH mode only requires wallets, which we already validated above
      return;
    }
    
    if (parsedCommand.mode === 'regular' && (!parsedCommand.tokenAmountPairs || parsedCommand.tokenAmountPairs.length === 0)) {
      throw new Error('No tokens specified for selling');
    }
    
    if (parsedCommand.mode === 'twap') {
      if (!parsedCommand.tokenInput) {
        throw new Error('Token must be specified for TWAP mode');
      }
      if (!parsedCommand.amount || !parsedCommand.duration) {
        throw new Error('Amount and duration must be specified for TWAP mode');
      }
    }
  }
  
  /**
   * Display usage help for sellbot
   */
  static showUsage() {
    console.log('🔴 SELLBOT');
    console.log('=====================================================');
    console.log('');
    console.log('📋 FORMATS:');
    console.log('  sellbot [wallets] [tokens...] [amounts...] [L-loops] [currency] [slow] [gas]');
    console.log('  sellbot [wallets] [token] twap [amount] [duration] [currency] [gas]');
    console.log('  sellbot [wallets] fsh [gas]');
    console.log('');
    console.log('👛 WALLET SELECTION:');
    console.log('  • B1 B3 B5 - Use specific wallets');
    console.log('  • (empty) - Use all wallets');
    console.log('');
    console.log('🎯 TOKEN FORMATS:');
    console.log('  • Ticker: TRUST, VADER');
    console.log('  • Contract: 0x1234...abcd');
    console.log('');
    console.log('💰 AMOUNT FORMATS:');
    console.log('  • Fixed: 100');
    console.log('  • Percentage: 50%');
    console.log('');
    console.log('💱 CURRENCY:');
    console.log('  • VIRTUAL (default)');
    console.log('  • ETH');
    console.log('  • C-TOKEN (e.g., C-VADER)');
    console.log('');
    console.log('💥 FSH MODE:');
    console.log('  • Flash sell ALL tokens from ALL wallets');
    console.log('');
    console.log('📝 BID-MODE EXAMPLES:');
    console.log('  sellbot B1 DKING 100 BID-MODE                    (BID-MODE: sell to ETH)');
    console.log('  sellbot B1 DKING twap 100 60 BID-MODE           (BID-MODE: TWAP sell to ETH)');
    console.log('  sellbot B1 fsh BID-MODE                          (BID-MODE: FSH sell to ETH)');
  }
} 