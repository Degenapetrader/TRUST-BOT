/**
 * ArgumentParser - General command line argument parsing utilities
 */
export class ArgumentParser {
  /**
   * Parse BID-MODE flag from arguments
   * @param {Array<string>} args - Command line arguments
   * @returns {Object} Result with bidMode flag and remainingArgs
   */
  static parseBidMode(args) {
    let bidMode = false;
    const remainingArgs = [];
    
    for (const arg of args) {
      if (arg === 'BID-MODE') {
        bidMode = true;
      } else {
        remainingArgs.push(arg);
      }
    }
    
    return { bidMode, remainingArgs };
  }

  /**
   * Parse gas price from arguments (gas0.075 format)
   * @param {Array<string>} args - Command line arguments
   * @returns {Object} Result with customGasPrice and remainingArgs
   */
  static parseGasPrice(args) {
    let customGasPrice = null;
    const remainingArgs = [];
    const errors = [];
    
    for (const arg of args) {
      if (arg.toLowerCase().startsWith('gas') && arg.length > 3) {
        const gasValueStr = arg.substring(3);
        
        // Validate gas price format
        if (!isNaN(parseFloat(gasValueStr)) && isFinite(gasValueStr)) {
          const gasValue = parseFloat(gasValueStr);
          
          // Validate gas price range
          if (gasValue >= 0.001 && gasValue <= 100) {
            customGasPrice = gasValue.toString();
          } else {
            errors.push('Gas price must be between 0.001 and 100 gwei');
          }
        } else {
          errors.push('Invalid gas format. Use gas0.05 for 0.05 gwei');
        }
      } else {
        remainingArgs.push(arg);
      }
    }
    
    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }
    
    return { customGasPrice, remainingArgs };
  }
  
  /**
   * Parse loop count (L-5 format)
   * @param {Array<string>} args - Command line arguments
   * @param {string} botType - Type of bot ('farmbot', 'buybot', 'sellbot', etc.)
   * @returns {Object} Result with loops and remainingArgs
   */
  static parseLoops(args, botType = 'other') {
    // Set default based on bot type
    // Farmbot and mmbot default to infinite loops for continuous operation
    // Other bots default to 0 execution unless explicitly specified
    let loops = (botType === 'farmbot' || botType === 'mmbot') ? Infinity : 0;
    const remainingArgs = [];
    const errors = [];
    
    for (const arg of args) {
      const loopMatch = arg.match(/^L-(\d+)$/i);
      
      if (loopMatch) {
        loops = parseInt(loopMatch[1]);
        
        if (loops < 0) {
          errors.push('Loop count cannot be negative. Use L-0 for infinite or L-5 for 5 loops');
        } else if (loops === 0) {
          // L-0 behavior depends on bot type
          // Farmbot and mmbot: L-0 means infinite loops
          // Other bots: L-0 means 1 loop (same as default)
          loops = (botType === 'farmbot' || botType === 'mmbot') ? Infinity : 1;
        }
      } else {
        remainingArgs.push(arg);
      }
    }
    
    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }
    
    return { loops, remainingArgs };
  }
  
  /**
   * Parse execution mode flags
   * @param {Array<string>} args - Command line arguments
   * @returns {Object} Result with parsed flags and remainingArgs
   */
  static parseExecutionMode(args) {
    const modes = {
      slowMode: true,
      debugMode: false,
      quietMode: false,
      verboseMode: false
    };
    
    const remainingArgs = [];
    
    for (const arg of args) {
      const lowerArg = arg.toLowerCase();
      
      switch (lowerArg) {
        case 'slow':
          modes.slowMode = true;
          break;
        case 'para':
        case 'parallel':
          modes.slowMode = false;
          break;
        case 'debug':
          modes.debugMode = true;
          break;
        case 'quiet':
          modes.quietMode = true;
          break;
        case 'verbose':
          modes.verboseMode = true;
          break;
        default:
          remainingArgs.push(arg);
      }
    }
    
    // Validate conflicting modes
    if (modes.quietMode && modes.verboseMode) {
      throw new Error('Cannot use both quiet and verbose modes');
    }
    
    return { ...modes, remainingArgs };
  }
  
  /**
   * Parse delay argument (D-30 format)
   * @param {Array<string>} args - Command line arguments
   * @returns {Object} Result with delayMinutes and remainingArgs
   */
  static parseDelay(args) {
    let delayMinutes = 0;
    const remainingArgs = [];
    const errors = [];
    
    for (const arg of args) {
      const delayMatch = arg.match(/^D-(\d+(?:\.\d+)?)$/i);
      
      if (delayMatch) {
        delayMinutes = parseFloat(delayMatch[1]);
        
        if (delayMinutes <= 0) {
          errors.push('Delay must be positive. Use D-30 for 30 minutes');
        }
      } else {
        remainingArgs.push(arg);
      }
    }
    
    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }
    
    return { delayMinutes, remainingArgs };
  }
  
  /**
   * Parse percentage argument (25% format)
   * @param {string} arg - Argument to parse
   * @returns {number|null} Parsed percentage or null
   */
  static parsePercentage(arg) {
    if (arg.endsWith('%')) {
      const value = parseFloat(arg.slice(0, -1));
      
      if (!isNaN(value) && value >= 0 && value <= 100) {
        return value;
      }
    }
    
    return null;
  }
  
  /**
   * Parse interval argument (I-5 format)
   * @param {string} arg - Argument to parse
   * @returns {number|null} Parsed interval in minutes or null
   */
  static parseInterval(arg) {
    const match = arg.match(/^I-(\d+(?:\.\d+)?)$/i);
    
    if (match) {
      const value = parseFloat(match[1]);
      
      if (value > 0) {
        return value;
      }
    }
    
    return null;
  }
  
  /**
   * Validate and parse positive amount
   * @param {string} amount - Amount to parse
   * @param {Object} options - Validation options
   * @returns {number} Parsed amount
   */
  static validateAmount(amount, options = {}) {
    const {
      context = 'amount',
      min = 0,
      max = Infinity,
      allowZero = false
    } = options;
    
    const parsed = parseFloat(amount);
    
    if (isNaN(parsed)) {
      throw new Error(`Invalid ${context}: ${amount}. Must be a number`);
    }
    
    if (!allowZero && parsed <= 0) {
      throw new Error(`Invalid ${context}: ${amount}. Must be positive`);
    }
    
    if (parsed < min || parsed > max) {
      throw new Error(`Invalid ${context}: ${amount}. Must be between ${min} and ${max}`);
    }
    
    return parsed;
  }
  
  /**
   * Parse key-value pairs (key=value format)
   * @param {Array<string>} args - Command line arguments
   * @returns {Object} Result with parsed pairs and remainingArgs
   */
  static parseKeyValuePairs(args) {
    const pairs = {};
    const remainingArgs = [];
    
    for (const arg of args) {
      const kvMatch = arg.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=(.+)$/);
      
      if (kvMatch) {
        const [, key, value] = kvMatch;
        pairs[key] = value;
      } else {
        remainingArgs.push(arg);
      }
    }
    
    return { pairs, remainingArgs };
  }
  
  /**
   * Parse boolean flags (--flag format)
   * @param {Array<string>} args - Command line arguments
   * @returns {Object} Result with flags and remainingArgs
   */
  static parseFlags(args) {
    const flags = {};
    const remainingArgs = [];
    
    for (const arg of args) {
      if (arg.startsWith('--')) {
        const flagName = arg.substring(2);
        flags[flagName] = true;
      } else {
        remainingArgs.push(arg);
      }
    }
    
    return { flags, remainingArgs };
  }
} 