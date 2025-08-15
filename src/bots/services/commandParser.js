/**
 * Command Parser Service
 * Handles parsing of bot command arguments
 */

import { ArgumentParser } from '../../parsing/index.js';
import { EXECUTION_MODES } from '../config/constants.js';

/**
 * CommandParser - Parses bot command arguments
 */
export class CommandParser {
  /**
   * Parse TWAP command format
   * @param {Array} args - Command arguments
   * @returns {Object|null} Parsed TWAP command or null
   */
  static parseTWAPCommand(args) {
    const twapIndex = args.findIndex(arg => arg.toUpperCase() === 'TWAP');
    if (twapIndex === -1) return null;
    
    // Step 1: Parse BID-MODE and other command modifiers for TWAP
    let { bidMode, remainingArgs: afterBidMode } = ArgumentParser.parseBidMode(args);
    let { selectedWallets, remainingArgs: afterWallets } = ArgumentParser.parseAndSelectWallets(afterBidMode);
    let { customGasPrice, remainingArgs: afterGas } = ArgumentParser.parseGasPrice(afterWallets);
    
    // Remove TWAP from args and get remaining
    const twapArgs = afterGas.filter(arg => arg.toUpperCase() !== 'TWAP');
    
    // Parse TWAP format: [token] [amount] [duration] [intervals] [C-currency]
    if (twapArgs.length < 3) {
      throw new Error('TWAP format: buybot [wallets] <token> twap <amount> <duration> [intervals] [C-currency] [gas]');
    }
    
    const token = twapArgs[0];
    const amount = twapArgs[1];
    const durationArg = twapArgs[2];
    const intervals = twapArgs[3]; // Extract user-specified order count
    
    // Debug logging for TWAP parameter extraction
    console.log(`🔍 BuyBot TWAP Debug: token=${token}, amount=${amount}, duration=${durationArg}, intervals=${intervals}`);
    console.log(`🔍 BuyBot TWAP Args: [${twapArgs.join(', ')}]`);
    
    // Provide helpful guidance if intervals is missing
    if (!intervals) {
      console.log(`⚠️ BuyBot TWAP: No intervals specified. Add order count for precise control.`);
      console.log(`📝 Example: buybot B1 TRUST twap .1 5 5 (for 5 orders over 5 minutes)`);
    }
    
    // Parse duration format - support both plain numbers and I-X format for backward compatibility
    let durationMinutes;
    
    if (durationArg.startsWith('I-') || durationArg.startsWith('i-')) {
      // Legacy I-X format (I-60)
      durationMinutes = parseInt(durationArg.substring(2));
    } else {
      // Simple number format (60) - matches sellbot behavior
      durationMinutes = parseInt(durationArg);
    }
    
    if (isNaN(durationMinutes) || durationMinutes <= 0 || durationMinutes > 1440) {
      throw new Error('TWAP duration must be between 1 and 1440 minutes (24 hours)');
    }
    
    // Check for currency - BID-MODE defaults to ETH
    let currency = bidMode ? 'ETH' : 'VIRTUAL';
    if (twapArgs.length >= 5) {
      const currencyArg = twapArgs[4];
      if (currencyArg.toLowerCase() === 'eth' || currencyArg.startsWith('C-') || currencyArg.startsWith('c-')) {
        currency = currencyArg;
      }
    }
    
    // Create validated amount using the ArgumentParser
    const validatedAmount = ArgumentParser.validateAmount(amount, 'TWAP amount');
    
    // Create tokenAmountPairs array for TWAP mode to prevent 'undefined' errors
    // This matches the structure expected by the execution code
    const tokenAmountPairs = [{
      tokenInput: token,
      amount: validatedAmount,
      currency: currency
    }];
    
    // Log the creation of tokenAmountPairs to help with debugging
    console.log(`📊 Created tokenAmountPairs for TWAP mode: ${JSON.stringify(tokenAmountPairs)}`);
    
    return {
      mode: EXECUTION_MODES.TWAP,
      selectedWallets,
      tokenInput: token,
      amount: validatedAmount,
      originalAmountStr: amount, // Preserve original amount string for percentage resolution
      duration: durationMinutes,
      intervals, // Add user-specified order count
      currency,
      customGasPrice,
      bidMode,
      // Add tokenAmountPairs array to prevent errors in executeTWAP
      tokenAmountPairs,
      // Add tokens and amounts arrays as fallback for error recovery code
      tokens: [token],
      amounts: [validatedAmount]
    };
  }

  /**
   * Parse new command format: [wallets] [tokens...] [amounts...] [C-currency] L-X slow gas0.X BID-MODE
   * @param {Array} args - Command arguments
   * @returns {Object} Parsed command
   */
  static parseNewCommandFormat(args) {
    console.log('🔍 Parsing new command format...');
    
    // Check for TWAP command first
    const twapCommand = this.parseTWAPCommand(args);
    if (twapCommand) return twapCommand;
    
    // Step 1: Parse all command modifiers
    let { bidMode, remainingArgs: afterBidMode } = ArgumentParser.parseBidMode(args);
    let { selectedWallets, remainingArgs: afterWallets } = ArgumentParser.parseAndSelectWallets(afterBidMode);
    let { customGasPrice, remainingArgs: afterGas } = ArgumentParser.parseGasPrice(afterWallets);
    let { loops, remainingArgs: afterLoops } = ArgumentParser.parseLoops(afterGas);
    let { slowMode, remainingArgs: afterModes } = ArgumentParser.parseExecutionMode(afterLoops);
    
    // Step 2: Check for currency (C-TOKEN format or ETH exception)
    let currency = bidMode ? 'ETH' : 'VIRTUAL'; // BID-MODE defaults to ETH, normal mode defaults to VIRTUAL
    let finalArgs = [...afterModes];
    
    // Look for ETH (special exception - no C- prefix needed)
    const ethIndex = finalArgs.findIndex(arg => arg.toLowerCase() === 'eth');
    if (ethIndex !== -1) {
      currency = 'ETH';
      finalArgs = finalArgs.filter((_, index) => index !== ethIndex);
      console.log(`💱 Detected currency: ETH (no C- prefix needed)`);
    } else {
      // Look for C- prefix currency (for all other tokens)
      const currencyIndex = finalArgs.findIndex(arg => arg.startsWith('C-') || arg.startsWith('c-'));
      if (currencyIndex !== -1) {
        currency = finalArgs[currencyIndex];
        finalArgs = finalArgs.filter((_, index) => index !== currencyIndex);
        console.log(`💱 Detected currency: ${currency}`);
      }
    }
    
    // Log BID-MODE status
    if (bidMode) {
      console.log(`🎯 BID-MODE active: using bid.json database and ${currency} currency`);
    }
    
    // Step 3: Parse tokens and amounts
    // Expecting: [token1] [token2] [token3] [amount1] [amount2] [amount3]
    if (finalArgs.length % 2 !== 0) {
      throw new Error('Invalid format: Number of tokens must match number of amounts');
    }
    
    const tokenCount = finalArgs.length / 2;
    const tokens = finalArgs.slice(0, tokenCount);
    const amounts = finalArgs.slice(tokenCount);
    
    if (tokens.length === 0) {
      throw new Error('At least one token must be specified');
    }
    
    // Create token-amount pairs
    const tokenAmountPairs = tokens.map((token, index) => ({
      tokenInput: token,
      amount: amounts[index],
      currency: currency
    }));
    
    console.log(`📋 Parsed command:`);
    console.log(`   👛 Wallets: ${selectedWallets.length}`);
    console.log(`   🪙 Tokens: ${tokens.join(', ')}`);
    console.log(`   💰 Amounts: ${amounts.join(', ')}`);
    console.log(`   💱 Currency: ${currency}`);
    console.log(`   🔄 Loops: ${loops}`);
    console.log(`   ⚡ Mode: ${slowMode ? 'SEQUENTIAL (tokens & wallets)' : 'PARALLEL WALLETS (tokens sequential)'}`);
    console.log(`   ⛽ Gas: ${customGasPrice || '0.02'} gwei`);
    if (bidMode) {
      console.log(`   🎯 BID-MODE: Using bid.json database`);
    }
    
    return {
      mode: slowMode ? EXECUTION_MODES.SEQUENTIAL : EXECUTION_MODES.PARALLEL,
      selectedWallets,
      tokenAmountPairs,
      loops,
      slowMode,
      customGasPrice,
      currency,
      bidMode
    };
  }

  /**
   * Validate parsed command
   * @param {Object} parsedCommand - Parsed command object
   * @throws {Error} If validation fails
   */
  static validateCommand(parsedCommand) {
    if (!parsedCommand.selectedWallets || parsedCommand.selectedWallets.length === 0) {
      throw new Error('No wallets selected for operation');
    }
    
    if (parsedCommand.mode === EXECUTION_MODES.TWAP) {
      if (!parsedCommand.tokenInput) {
        throw new Error('Token must be specified for TWAP');
      }
      if (!parsedCommand.amount || parsedCommand.amount <= 0) {
        throw new Error('Valid amount must be specified for TWAP');
      }
      if (!parsedCommand.duration || parsedCommand.duration <= 0) {
        throw new Error('Valid duration must be specified for TWAP');
      }
    } else {
      if (!parsedCommand.tokenAmountPairs || parsedCommand.tokenAmountPairs.length === 0) {
        throw new Error('At least one token-amount pair must be specified');
      }
      
      // Validate each token-amount pair
      parsedCommand.tokenAmountPairs.forEach((pair, index) => {
        if (!pair.tokenInput) {
          throw new Error(`Token input missing for pair ${index + 1}`);
        }
        if (!pair.amount) {
          throw new Error(`Amount missing for token ${pair.tokenInput}`);
        }
      });
    }
  }
} 