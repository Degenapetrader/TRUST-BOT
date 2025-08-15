/**
 * Parsing module - Main entry point
 * Provides organized parsing utilities and maintains backward compatibility
 */

// Import specialized parsers
import { WalletParser } from './walletParser.js';
import { ArgumentParser as NewArgumentParser } from './argumentParser.js';
import { AmountCalculator } from './amountCalculator.js';
import { ResultProcessor as NewResultProcessor } from './resultProcessor.js';

// For backward compatibility with the original argParser.js
import { tradingWallets } from '../wallets/index.js';

/**
 * Legacy ArgumentParser class for backward compatibility
 * Maps to the new modular structure
 */
class LegacyArgumentParser {
  static parseAndSelectWallets(args) {
    return WalletParser.parse(args, tradingWallets, { debug: true });
  }
  
  static parseBidMode(args) {
    return NewArgumentParser.parseBidMode(args);
  }
  
  static parseGasPrice(args) {
    return NewArgumentParser.parseGasPrice(args);
  }
  
  static parseLoops(args, botType) {
    return NewArgumentParser.parseLoops(args, botType);
  }
  
  static parseExecutionMode(args) {
    const result = NewArgumentParser.parseExecutionMode(args);
    return {
      slowMode: result.slowMode,
      remainingArgs: result.remainingArgs
    };
  }
  
  static validateAmount(amount, context = 'amount') {
    return NewArgumentParser.validateAmount(amount, { context });
  }
}

/**
 * Legacy AutoAmountCalculator class for backward compatibility
 */
class LegacyAutoAmountCalculator {
  static async calculateAmount(wallet, currencyInfo, settings, provider) {
    const result = await AmountCalculator.calculateAmount({
      wallet,
      currencyInfo,
      settings,
      provider
    });
    
    return {
      amount: result.amount,
      randomPercent: result.randomPercent,
      balanceFormatted: result.balance
    };
  }
}

/**
 * Legacy ResultProcessor class for backward compatibility
 */
class LegacyResultProcessor {
  static async processResults(walletPromises) {
    const processed = await NewResultProcessor.processResults(walletPromises, {
      includeDetails: false,
      calculateStats: false
    });
    
    return {
      processedResults: processed.results || [],
      successful: processed.summary.successful,
      failed: processed.summary.failed
    };
  }
}

// Export legacy classes for backward compatibility
export const ArgumentParser = LegacyArgumentParser;
export const AutoAmountCalculator = LegacyAutoAmountCalculator;
export const ResultProcessor = LegacyResultProcessor;

// Export new modular classes with prefixed names
export {
  WalletParser,
  NewArgumentParser as ArgumentParserNew,
  AmountCalculator,
  NewResultProcessor as ResultProcessorNew
};

// Export utility functions
export function parseCompleteArguments(args, options = {}) {
  const {
    parseWallets = true,
    parseGas = true,
    parseLoops = true,
    parseDelay = true,
    parseMode = true,
    wallets = tradingWallets
  } = options;
  
  let remainingArgs = [...args];
  const parsed = {};
  
  // Parse wallets
  if (parseWallets) {
    const walletResult = WalletParser.parse(remainingArgs, wallets);
    parsed.selectedWallets = walletResult.selectedWallets;
    parsed.walletSelectors = walletResult.walletSelectors;
    remainingArgs = walletResult.remainingArgs;
  }
  
  // Parse gas
  if (parseGas) {
    const gasResult = NewArgumentParser.parseGasPrice(remainingArgs);
    parsed.customGasPrice = gasResult.customGasPrice;
    remainingArgs = gasResult.remainingArgs;
  }
  
  // Parse loops
  if (parseLoops) {
    const loopResult = NewArgumentParser.parseLoops(remainingArgs);
    parsed.loops = loopResult.loops;
    remainingArgs = loopResult.remainingArgs;
  }
  
  // Parse delay
  if (parseDelay) {
    const delayResult = NewArgumentParser.parseDelay(remainingArgs);
    parsed.delayMinutes = delayResult.delayMinutes;
    remainingArgs = delayResult.remainingArgs;
  }
  
  // Parse execution mode
  if (parseMode) {
    const modeResult = NewArgumentParser.parseExecutionMode(remainingArgs);
    parsed.slowMode = modeResult.slowMode;
    parsed.debugMode = modeResult.debugMode;
    parsed.quietMode = modeResult.quietMode;
    parsed.verboseMode = modeResult.verboseMode;
    remainingArgs = modeResult.remainingArgs;
  }
  
  parsed.remainingArgs = remainingArgs;
  
  return parsed;
}

// Re-export all functions from the new modules
export * from './walletParser.js';
export * from './argumentParser.js';
export * from './amountCalculator.js';
export * from './resultProcessor.js'; 