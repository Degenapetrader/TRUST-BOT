// Replacement for lines 730-736 in main.js
    // Add wallet private keys from database
    if (dbData && dbData.wallets) {
      // Get master password for decryption
      const masterPassword = global.masterPassword;
      if (!masterPassword) {
        console.error('No master password available for wallet decryption');
        throw new Error('Master password not available. Please enter your password first.');
      }
      
      // Track if we found any valid wallets
      let validWalletsFound = false;
      
      dbData.wallets.forEach((wallet, index) => {
        if (wallet.enabled) {
          try {
            // Check if we have encrypted private key
            if (wallet.encryptedPrivateKey) {
              // Decrypt the wallet's private key
              const decryptedKey = WalletEncryption.decryptPrivateKey(wallet.encryptedPrivateKey, masterPassword);
              if (decryptedKey) {
                console.log(`Successfully decrypted a wallet for bot execution`);
                env[`B${index + 1}`] = decryptedKey;
                validWalletsFound = true;
              } else {
                console.error(`Failed to decrypt wallet ${wallet.name || index+1}`);
              }
            } else if (wallet.privateKey) {
              // Fallback to plaintext key if available (legacy support)
              env[`B${index + 1}`] = wallet.privateKey;
              validWalletsFound = true;
            } else {
              console.warn(`Wallet ${wallet.name || index+1} missing private key skipping...`);
            }
          } catch (error) {
            console.error(`Error decrypting wallet ${wallet.name || index+1}:`, error.message);
          }
        }
      });
      
      if (!validWalletsFound) {
        throw new Error('No valid wallets found with decryptable private keys. Please check your wallet settings.');
      }
    }
