/**
 * WalletParser - Handles parsing of wallet selectors from command line arguments
 */
export class WalletParser {
  /**
   * Parse wallet selectors (B1, B2, B3...) from arguments
   * @param {Array<string>} args - Command line arguments
   * @param {Array} availableWallets - Available wallet instances
   * @param {Object} options - Parsing options
   * @returns {Object} Parsed result with selectedWallets and remainingArgs
   */
  static parse(args, availableWallets, options = {}) {
    const { 
      debug = false,
      allowEmpty = true,
      defaultToAll = true 
    } = options;
    
    const selectedWallets = [];
    const remainingArgs = [];
    const walletSelectors = [];
    const errors = [];
    
    if (debug) {
      console.log(`🔍 DEBUG: Parsing wallet selectors from args: [${args.join(', ')}]`);
    }
    
    // Parse arguments
    for (const arg of args) {
      const walletMatch = arg.match(/^B(\d+)$/i);
      
      if (walletMatch) {
        const walletIndex = parseInt(walletMatch[1]);
        const selector = arg.toUpperCase();
        walletSelectors.push(selector);
        
        // Validate wallet index
        if (walletIndex < 1 || walletIndex > availableWallets.length) {
          errors.push(`Invalid wallet selector: ${arg}. Valid range: B1-B${availableWallets.length}`);
          continue;
        }
        
        // Get wallet (convert to 0-based index)
        const wallet = availableWallets[walletIndex - 1];
        
        // Avoid duplicates
        if (wallet && !selectedWallets.some(w => w.address === wallet.address)) {
          selectedWallets.push(wallet);
          
          if (debug) {
            console.log(`🔍 DEBUG: Added wallet ${selector}: ${wallet.address.slice(0, 8)}...`);
          }
        }
      } else {
        remainingArgs.push(arg);
      }
    }
    
    // Handle errors
    if (errors.length > 0 && !allowEmpty) {
      throw new Error(errors.join('\n'));
    }
    
    // Determine final wallet list
    let finalWallets = selectedWallets;
    let selectionType = 'EXPLICIT';
    
    if (selectedWallets.length === 0) {
      if (defaultToAll) {
        finalWallets = [...availableWallets];
        selectionType = 'ALL';
      } else if (!allowEmpty) {
        throw new Error('No wallets selected. Specify wallet selectors (B1, B2, etc.) or use defaultToAll option.');
      }
    }
    
    // Log selection summary
    if (selectionType === 'EXPLICIT') {
      console.log(`👛 Selected wallets: ${walletSelectors.join(' ')} (${finalWallets.length}/${availableWallets.length})`);
      if (debug) {
        console.log(`🔍 DEBUG: Explicit wallet selection - NOT using all wallets`);
      }
    } else if (selectionType === 'ALL') {
      console.log(`👛 Selected wallets: ALL (${finalWallets.length}/${availableWallets.length})`);
      if (debug) {
        console.log(`🔍 DEBUG: No wallet selectors found - using ALL wallets by default`);
      }
    }
    
    // Debug: Show final wallet list
    if (debug) {
      finalWallets.forEach((wallet, index) => {
        const originalIndex = availableWallets.findIndex(w => w.address === wallet.address) + 1;
        console.log(`🔍 DEBUG: Final wallet ${index + 1}: B${originalIndex} (${wallet.address.slice(0, 8)}...)`);
      });
    }
    
    return {
      selectedWallets: finalWallets,
      remainingArgs,
      walletSelectors,
      selectionType,
      errors
    };
  }
  
  /**
   * Validate wallet selector format
   * @param {string} selector - Wallet selector to validate
   * @returns {boolean} True if valid
   */
  static isValidSelector(selector) {
    return /^B\d+$/i.test(selector);
  }
  
  /**
   * Parse single wallet selector to index
   * @param {string} selector - Wallet selector
   * @returns {number|null} Wallet index (1-based) or null if invalid
   */
  static parseSelector(selector) {
    const match = selector.match(/^B(\d+)$/i);
    return match ? parseInt(match[1]) : null;
  }
  
  /**
   * Format wallet selectors from indices
   * @param {Array<number>} indices - Array of wallet indices (0-based)
   * @returns {Array<string>} Array of wallet selectors
   */
  static formatSelectors(indices) {
    return indices.map(index => `B${index + 1}`);
  }
} 