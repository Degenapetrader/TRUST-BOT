// Common utility functions

/**
 * Get a random integer between min and max (inclusive)
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Random integer
 */
export function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleep for a specified number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a random amount between min and max with specified decimals
 * @param {number} min - Minimum amount
 * @param {number} max - Maximum amount
 * @param {number} decimals - Number of decimal places
 * @returns {number} Random amount
 */
export function getRandomAmount(min, max, decimals = 4) {
  const amount = min + Math.random() * (max - min);
  return parseFloat(amount.toFixed(decimals));
}

/**
 * Calculate percentage of a value
 * @param {number} value - Base value
 * @param {number} percentage - Percentage (0-100)
 * @returns {number} Calculated percentage
 */
export function calculatePercentage(value, percentage) {
  return (value * percentage) / 100;
}

/**
 * Format a wallet address for display
 * @param {string} address - Full wallet address
 * @param {number} chars - Number of characters to show at start/end
 * @returns {string} Formatted address (e.g., "0x1234...5678")
 */
export function formatAddress(address, chars = 4) {
  if (!address || address.length < chars * 2 + 3) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} initialDelay - Initial delay in ms
 * @param {Function} onError - Optional error handler
 * @returns {Promise<any>} Result of the function
 */
export async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000, onError = null) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        if (onError) {
          onError(error, i + 1, maxRetries, delay);
        }
        await sleep(delay);
      }
    }
  }
  
  throw lastError;
}

/**
 * Check if a value is within a range
 * @param {number} value - Value to check
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {boolean} True if within range
 */
export function isInRange(value, min, max) {
  return value >= min && value <= max;
}

/**
 * Clamp a value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
} 