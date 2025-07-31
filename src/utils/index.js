/**
 * Utils module - Main entry point
 * Maintains backward compatibility while providing modular organization
 */

// Import from specialized modules
import {
  log,
  formatTimestampUTC,
  logWithTimestamp,
  logWithTiming,
  formatError,
  logger
} from './logger.js';

import {
  getRandomInt,
  sleep,
  getRandomAmount,
  calculatePercentage,
  formatAddress,
  retryWithBackoff,
  isInRange,
  clamp
} from './common.js';

import {
  executeWithRetry,
  getOptimizedGasSettings,
  monitorTransaction,
  executeTransactionWithReplacementFee,
  estimateGas,
  isRetryableError,
  formatGasPrice
} from './transactions.js';

import {
  runTickerSearchFallback,
  executeCommand,
  runNpmScript,
  commandExists,
  getEnvVar
} from './externalCommands.js';

// Re-export everything for backward compatibility
export {
  // Logger utilities
  log,
  formatTimestampUTC,
  logWithTimestamp,
  logWithTiming,
  formatError,
  logger,
  
  // Common utilities
  getRandomInt,
  sleep,
  getRandomAmount,
  calculatePercentage,
  formatAddress,
  retryWithBackoff,
  isInRange,
  clamp,
  
  // Transaction utilities
  executeWithRetry,
  getOptimizedGasSettings,
  monitorTransaction,
  executeTransactionWithReplacementFee,
  estimateGas,
  isRetryableError,
  formatGasPrice,
  
  // External command utilities
  runTickerSearchFallback,
  executeCommand,
  runNpmScript,
  commandExists,
  getEnvVar
};

// Export grouped utilities for better organization
export const LogUtils = {
  log,
  formatTimestampUTC,
  logWithTimestamp,
  logWithTiming,
  formatError,
  logger
};

export const CommonUtils = {
  getRandomInt,
  sleep,
  getRandomAmount,
  calculatePercentage,
  formatAddress,
  retryWithBackoff,
  isInRange,
  clamp
};

export const TransactionUtils = {
  executeWithRetry,
  getOptimizedGasSettings,
  monitorTransaction,
  executeTransactionWithReplacementFee,
  estimateGas,
  isRetryableError,
  formatGasPrice
};

export const ExternalCommandUtils = {
  runTickerSearchFallback,
  executeCommand,
  runNpmScript,
  commandExists,
  getEnvVar
};

// Default export with all utilities
export default {
  ...LogUtils,
  ...CommonUtils,
  ...TransactionUtils,
  ...ExternalCommandUtils
}; 