/**
 * WalletLogger - Specialized logger for wallet operations
 * Creates a dedicated log file to trace wallet selection and decryption
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class WalletLogger {
  constructor() {
    this.logFilePath = path.join(__dirname, '..', '..', 'wallet-trace.log');
    this.enabled = false; // Disabled by default for security
    this.secureModeEnabled = true; // Enable secure mode to prevent private key logging
    
    // Initialize log file
    if (this.enabled) {
      this.initLogFile();
    }
  }
  
  /**
   * Initialize the log file with a header
   */
  initLogFile() {
    try {
      // Create a new log file with a header
      const timestamp = new Date().toISOString();
      const header = `
========================================================
WALLET SELECTION AND DECRYPTION TRACE LOG
Started: ${timestamp}
========================================================
`;
      fs.writeFileSync(this.logFilePath, header, 'utf8');
      this.log('Log file initialized');
    } catch (error) {
      console.error(`Failed to initialize log file: ${error.message}`);
    }
  }
  
  /**
   * Log a message to both the console and log file
   * @param {string} message - Message to log
   * @param {string} level - Log level (info, warn, error, debug, trace)
   */
  log(message, level = 'info') {
    if (!this.enabled) return;
    
    try {
      // Security check: Don't log sensitive information
      if (this.secureModeEnabled) {
        // Skip any message containing potentially sensitive data
        const sensitivePatterns = [
          /private\s*key/i,
          /encryption/i,
          /decrypt/i,
          /password/i,
          /passw/i,
          /secret/i,
          /0x[0-9a-f]{10,}/i, // Ethereum private keys starting with 0x
          /[0-9a-f]{32,}/i, // Longer hex strings that might be keys
          /key\s*:/i, // Key value pairs
          /mnemonic/i, // Seed phrases
          /seed/i, // Seed phrases
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i // UUIDs and similar formats
        ];
        
        // Skip logging if contains sensitive information
        if (sensitivePatterns.some(pattern => pattern.test(message))) {
          return; // Don't log sensitive data
        }
      }
      
      // Format with timestamp and level
      const timestamp = new Date().toISOString();
      const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
      
      // Append to log file
      fs.appendFileSync(this.logFilePath, formattedMessage, 'utf8');
      
      // Also output to console with appropriate emoji
      let emoji = '📝';
      switch (level.toLowerCase()) {
        case 'warn': emoji = '⚠️'; break;
        case 'error': emoji = '❌'; break;
        case 'debug': emoji = '🔍'; break;
        case 'trace': emoji = '💬'; break;
        case 'success': emoji = '✅'; break;
      }
      
      console.log(`${emoji} ${message}`);
    } catch (error) {
      console.error(`Failed to write to log file: ${error.message}`);
    }
  }
  
  /**
   * Log an info message
   * @param {string} message - Message to log
   */
  info(message) {
    this.log(message, 'info');
  }
  
  /**
   * Log a warning message
   * @param {string} message - Message to log
   */
  warn(message) {
    this.log(message, 'warn');
  }
  
  /**
   * Log an error message
   * @param {string} message - Message to log
   */
  error(message) {
    this.log(message, 'error');
  }
  
  /**
   * Log a debug message
   * @param {string} message - Message to log
   */
  debug(message) {
    this.log(message, 'debug');
  }
  
  /**
   * Log a trace message (very detailed)
   * @param {string} message - Message to log
   */
  trace(message) {
    this.log(message, 'trace');
  }
  
  /**
   * Log a success message
   * @param {string} message - Message to log
   */
  success(message) {
    this.log(message, 'success');
  }
  
  /**
   * Log object details
   * @param {string} label - Label for the object
   * @param {object} object - Object to log
   */
  logObject(label, object) {
    if (!this.enabled) return;
    try {
      // Safety check - create a sanitized copy of the object
      let sanitizedObj;
      
      if (this.secureModeEnabled) {
        // Create a copy and remove sensitive data
        sanitizedObj = JSON.parse(JSON.stringify(object));
        
        // Remove common sensitive fields
        const sensitiveFields = [
          'privateKey', 'encryptedPrivateKey', 'password', 'secret', 'key',
          'mnemonic', 'seed', 'seedPhrase', 'passphrase', 'pass', 'auth',
          'token', 'apiKey', 'api_key', 'accessToken', 'access_token',
          'refreshToken', 'refresh_token', 'authTag', 'iv', 'salt'
        ];
        this._sanitizeObject(sanitizedObj, sensitiveFields);
      } else {
        sanitizedObj = object;
      }
      
      const objString = JSON.stringify(sanitizedObj, null, 2);
      this.debug(`${label}: ${objString}`);
    } catch (error) {
      this.error(`Failed to log object ${label}: ${error.message}`);
      this.debug(`${label}: [Object that cannot be stringified]`);
    }
  }
  
  /**
   * Recursively sanitize an object to remove sensitive fields
   * @private
   * @param {object} obj - Object to sanitize
   * @param {string[]} sensitiveFields - Field names to redact
   */
  _sanitizeObject(obj, sensitiveFields) {
    if (!obj || typeof obj !== 'object') return;
    
    Object.keys(obj).forEach(key => {
      if (sensitiveFields.includes(key)) {
        // Redact sensitive data
        if (typeof obj[key] === 'string') {
          obj[key] = '[REDACTED]';
        } else {
          delete obj[key];
        }
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        // Recursively sanitize nested objects
        this._sanitizeObject(obj[key], sensitiveFields);
      }
    });
  }
}

// Create a singleton instance
const walletLogger = new WalletLogger();
export default walletLogger;
