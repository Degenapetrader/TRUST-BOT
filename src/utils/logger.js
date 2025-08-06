// Logging utilities for the winbot application

/**
 * Log a message without timestamp for cleaner output
 * @param {string} message - Message to log
 */
export function log(message) {
  console.log(message);
}

/**
 * Format timestamp in UTC format: Jun-18-2025 08:51:1955
 * @returns {string} Formatted timestamp
 */
export function formatTimestampUTC() {
  const now = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const month = months[now.getUTCMonth()];
  const day = now.getUTCDate().toString().padStart(2, '0');
  const year = now.getUTCFullYear();
  const hours = now.getUTCHours().toString().padStart(2, '0');
  const minutes = now.getUTCMinutes().toString().padStart(2, '0');
  const seconds = now.getUTCSeconds().toString().padStart(2, '0');
  const milliseconds = now.getUTCMilliseconds().toString().padStart(2, '0');
  
  return `${month}-${day}-${year} ${hours}:${minutes}:${seconds}${milliseconds}`;
}

/**
 * Log a message with timestamp
 * @param {string} message - Message to log
 */
export function logWithTimestamp(message) {
  const timestamp = formatTimestampUTC();
  console.log(`[${timestamp}] ${message}`);
}

/**
 * Log a message with timing information for JEET mode
 * @param {string} message - Message to log
 * @param {number|null} startTime - Start time for elapsed calculation
 */
export function logWithTiming(message, startTime = null) {
  if (startTime) {
    const elapsed = Date.now() - startTime;
    console.log(`${message} [${(elapsed/1000).toFixed(2)}s]`);
  } else {
    console.log(message);
  }
}

/**
 * Format an error for consistent display
 * @param {Error|Object|string} error - Error to format
 * @returns {string} Formatted error message
 */
export function formatError(error) {
  if (error.code && error.reason) {
    return `${error.code}: ${error.reason}`;
  } else if (error.message) {
    return error.message;
  } else {
    return String(error);
  }
}

// Create default logger instance
export const logger = {
  log,
  logWithTimestamp,
  logWithTiming,
  formatError,
  info: log,
  error: (msg) => log(`❌ ${msg}`),
  success: (msg) => log(`✅ ${msg}`),
  warning: (msg) => log(`⚠️ ${msg}`)
}; 