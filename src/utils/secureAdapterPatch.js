// Patch file for securing wallet private keys in bot operations
// This should be applied to main.js

// Function to patch an existing main.js file to add secureAdapter integration
function patchMainJs() {
  const fs = require('fs');
  const path = require('path');
  
  // Main.js path
  const mainJsPath = path.join(__dirname, '..', '..', 'main.js');
  
  if (!fs.existsSync(mainJsPath)) {
    console.error('Error: main.js file not found');
    return false;
  }
  
  try {
    // Read main.js content
    let mainJsContent = fs.readFileSync(mainJsPath, 'utf8');
    
    // Find the wallet private key section
    const oldCode = `// Add wallet private keys from database
    if (dbData && dbData.wallets) {
      dbData.wallets.forEach((wallet, index) => {
        if (wallet.enabled && wallet.privateKey) {
          env[\`B\${index + 1}\`] = wallet.privateKey;
        }
      });
    }`;
    
    // New code with secureAdapter integration
    const newCode = `// Add wallet private keys from database
    if (dbData && dbData.wallets) {
      dbData.wallets.forEach((wallet, index) => {
        // Use secureAdapter to get decrypted private keys when available
        let privateKey = wallet.privateKey;
        
        // If global.secureAdapter exists, try to get the decrypted key
        if (global.secureAdapter && wallet.id) {
          const secureKey = global.secureAdapter.getPrivateKeyById(wallet.id);
          if (secureKey) {
            privateKey = secureKey;
          }
        }
        
        if (wallet.enabled && privateKey) {
          env[\`B\${index + 1}\`] = privateKey;
        }
      });
    }`;
    
    // Replace the old code with new code
    if (mainJsContent.includes(oldCode)) {
      mainJsContent = mainJsContent.replace(oldCode, newCode);
      
      // Write back to main.js
      fs.writeFileSync(mainJsPath, mainJsContent);
      console.log('✅ Successfully patched main.js to use secureAdapter for wallet private keys');
      return true;
    } else {
      console.error('❌ Could not find the wallet private key section in main.js');
      return false;
    }
  } catch (error) {
    console.error('Error patching main.js:', error);
    return false;
  }
}

// Export the patch function
module.exports = { patchMainJs };
