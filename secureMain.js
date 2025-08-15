const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

// Track all spawned child processes so we can clean them up on exit
const childProcesses = [];

// Override spawn to track processes
const originalSpawn = spawn;
function trackedSpawn(...args) {
  const childProcess = originalSpawn(...args);
  childProcesses.push(childProcess);
  
  // Remove from tracking when process exits
  childProcess.on('exit', () => {
    const index = childProcesses.indexOf(childProcess);
    if (index !== -1) {
      childProcesses.splice(index, 1);
    }
  });
  
  return childProcess;
}

// Import our secure config utility (need to use require since this is CommonJS)
const { SecureConfigManager } = require('./src/utils/secureConfig.cjs');

// Constants
const CONFIG_PATH = path.join(__dirname, 'config.json');
const WALLETS_DB_PATH = path.join(__dirname, 'wallets.json');

// Global references
let mainWindow = null;
let passwordWindow = null;
let secureConfig = null;
let masterPassword = null;

/**
 * Initialize the secure configuration manager
 */
function initializeSecureConfig() {
  secureConfig = new SecureConfigManager(CONFIG_PATH);
  return secureConfig.initialize();
}

/**
 * Create the password prompt window
 */
function createPasswordWindow() {
  passwordWindow = new BrowserWindow({
    width: 450,
    height: 600,
    resizable: false,
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'assets', 'icon.ico'), // Application icon
    title: 'TRUSTBOT Security',
    show: false
  });

  // Load password prompt HTML
  passwordWindow.loadFile('password-prompt.html');

  // Show window when ready
  passwordWindow.once('ready-to-show', () => {
    passwordWindow.show();
    passwordWindow.focus();
  });

  // Prevent closing the password window (forces user to enter password or exit app)
  passwordWindow.on('close', (event) => {
    // If main window doesn't exist yet, exit the app
    if (!mainWindow) {
      app.exit(0);
    }
  });
}

/**
 * Create the main application window
 */
function createMainWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    autoHideMenuBar: true, // Menu bar hidden for production
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      devTools: false // Dev tools disabled for production
    },
    icon: path.join(__dirname, 'assets', 'icon.ico'), // Application icon
    title: 'VIRTUAL Trading Bot Desktop',
    show: false,
    frame: true,
    titleBarStyle: 'default'
  });

  // Load the index.html
  mainWindow.loadFile('index.html');

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Focus the window
    if (process.platform === 'darwin') {
      app.dock.show();
    }
    mainWindow.focus();
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle window closed - COMPREHENSIVE CLEANUP SEQUENCE
  mainWindow.on('closed', () => {
    console.log('🔍 [SECURE-MAIN.JS] Main window closed event triggered - starting comprehensive cleanup...');
    
    try {
      const { execSync } = require('child_process');
      const ourPid = process.pid;
      
      // 🎯 CRITICAL FIX: Close placeholder window from secureBootstrap.js
      // This is the root cause of lingering processes in EXE build
      try {
        // Access the placeholder window from global scope or require secureBootstrap
        if (global.placeholderWindow && !global.placeholderWindow.isDestroyed()) {
          console.log('🔧 [SECURE-MAIN.JS] Closing placeholder window from secureBootstrap.js...');
          global.placeholderWindow.close();
          global.placeholderWindow = null;
          console.log('✅ [SECURE-MAIN.JS] Placeholder window closed successfully');
        } else {
          console.log('ℹ️  [SECURE-MAIN.JS] No placeholder window found or already destroyed');
        }
      } catch (error) {
        console.log('⚠️  [SECURE-MAIN.JS] Error closing placeholder window:', error.message);
      }
      
      // Close console window if open
      try {
        const { consoleWindow } = require('./main.js');
        if (consoleWindow && !consoleWindow.isDestroyed()) {
          console.log('🔧 [SECURE-MAIN.JS] Closing console window...');
          consoleWindow.close();
          console.log('✅ [SECURE-MAIN.JS] Console window closed successfully');
        } else {
          console.log('ℹ️  [SECURE-MAIN.JS] No console window to close');
        }
      } catch (error) {
        console.log('ℹ️  [SECURE-MAIN.JS] Console window cleanup skipped:', error.message);
      }
      
      // Kill tracked child processes
      try {
        const { childProcesses } = require('./main.js');
        if (childProcesses && childProcesses.length > 0) {
          console.log(`🔧 [SECURE-MAIN.JS] Cleaning up ${childProcesses.length} child processes...`);
          
          childProcesses.forEach(process => {
            try {
              if (!process.killed) {
                if (process.platform === 'win32') {
                  try {
                    execSync(`taskkill /pid ${process.pid} /t /f`, { stdio: 'ignore' });
                    console.log(`✅ Killed child process tree: ${process.pid}`);
                  } catch (error) {
                    console.log(`ℹ️  Process ${process.pid} already terminated`);
                  }
                } else {
                  process.kill('SIGTERM');
                  setTimeout(() => {
                    if (!process.killed) {
                      process.kill('SIGKILL');
                    }
                  }, 1000);
                }
              }
            } catch (error) {
              console.log(`ℹ️  Error killing process ${process.pid}:`, error.message);
            }
          });
          
          // Clear the array
          childProcesses.length = 0;
          console.log('✅ [SECURE-MAIN.JS] Child processes cleanup completed');
        }
      } catch (error) {
        console.log('ℹ️  [SECURE-MAIN.JS] Child processes cleanup skipped:', error.message);
      }
      
      // Kill any lingering processes
      if (process.platform === 'win32') {
        try {
          console.log('🔧 [SECURE-MAIN.JS] Killing lingering node.exe processes...');
          execSync(`taskkill /f /im node.exe /fi "PID ne ${ourPid}"`, { stdio: 'ignore' });
          console.log('✅ Cleaned up node processes');
        } catch (error) {
          console.log('ℹ️  No node processes found to clean up');
        }
        
        try {
          console.log('🔧 [SECURE-MAIN.JS] Killing lingering cmd.exe processes...');
          execSync(`taskkill /f /im cmd.exe`, { stdio: 'ignore' });
          console.log('✅ Cleaned up cmd processes');
        } catch (error) {
          console.log('ℹ️  No cmd processes found to clean up');
        }
      }
      
      console.log('🎉 [SECURE-MAIN.JS] Window close cleanup completed');
    } catch (error) {
      console.error('❌ [SECURE-MAIN.JS] Error during window close cleanup:', error.message);
    }
    
    mainWindow = null;
  });

  // Handle window minimize/maximize
  mainWindow.on('minimize', (event) => {
    if (process.platform === 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

/**
 * Get wallet data with decrypted private keys when needed
 */
function getWalletData() {
  try {
    if (!secureConfig) {
      throw new Error('Secure configuration not initialized');
    }

    // Get wallets with decrypted private keys
    const wallets = secureConfig.getWallets(true);

    // Format them for display
    const formattedWallets = wallets.map((wallet, index) => {
      let address = '';
      
      // Try to get the address from the private key if available
      if (wallet.privateKey) {
        try {
          const { ethers } = require('ethers');
          const ethWallet = new ethers.Wallet(wallet.privateKey);
          address = ethWallet.address;
        } catch (error) {
          console.error('Error getting address from private key:', error);
        }
      }

      // Format for display
      return {
        id: wallet.id,
        name: wallet.name || `Wallet ${index + 1}`,
        address: address,
        shortAddress: address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '',
        index: index,
        enabled: wallet.enabled !== false,
        hasPrivateKey: !!wallet.privateKey
      };
    });

    return {
      success: true,
      wallets: formattedWallets
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get private key for a specific wallet ID
 */
function getPrivateKeyForWallet(walletId) {
  try {
    if (!secureConfig || !masterPassword) {
      throw new Error('Secure configuration not initialized or master password not set');
    }

    const wallet = secureConfig.getWalletById(walletId, true);
    if (!wallet || !wallet.privateKey) {
      throw new Error('Wallet not found or private key not available');
    }

    return wallet.privateKey;
  } catch (error) {
    console.error('Error getting private key:', error);
    return null;
  }
}

/**
 * Migrate from old wallets.json format to the new secure format
 */
async function migrateOldWalletsFile() {
  if (!fs.existsSync(WALLETS_DB_PATH)) {
    return { success: true, migratedCount: 0 };
  }

  try {
    // Read old wallets file
    const data = fs.readFileSync(WALLETS_DB_PATH, 'utf8');
    const oldData = JSON.parse(data);
    
    if (!oldData.wallets || !Array.isArray(oldData.wallets)) {
      return { success: true, migratedCount: 0 };
    }

    // Import config settings
    if (oldData.config) {
      for (const [key, value] of Object.entries(oldData.config)) {
        secureConfig.setSetting(key, value);
      }
    }

    // Import wallets
    let migratedCount = 0;
    
    for (const wallet of oldData.wallets) {
      if (wallet.privateKey) {
        const result = secureConfig.addWallet(wallet);
        if (result.success) {
          migratedCount++;
        }
      }
    }

    return { success: true, migratedCount };
  } catch (error) {
    console.error('Error migrating old wallets file:', error);
    return { success: false, error: error.message };
  }
}

// App startup
app.whenReady().then(async () => {
  // Initialize secure config
  initializeSecureConfig();
  
  // Create and show password window
  createPasswordWindow();
});

// IPC handlers for password window
ipcMain.handle('check-password-setup', async (event) => {
  // Check if this is the first time setup
  const isFirstTimeSetup = !secureConfig.config.security.isEncrypted;
  return { isFirstTimeSetup };
});

ipcMain.handle('validate-master-password', async (event, { password, isFirstTimeSetup }) => {
  try {
    if (isFirstTimeSetup) {
      // Set up new password
      secureConfig.setMasterPassword(password, true);
      masterPassword = password;
      // Also store in global for other processes to use
      global.masterPassword = password;
      
      // Migrate old wallets if they exist
      await migrateOldWalletsFile();
      
      return { success: true };
    } else {
      // Validate existing password
      const isValid = secureConfig.validateMasterPassword(password);
      
      if (isValid) {
        // Store password for this session
        masterPassword = password;
        // Also store in global for other processes to use
        global.masterPassword = password;
        secureConfig.setMasterPassword(password, false);
        return { success: true };
      } else {
        return { 
          success: false, 
          error: 'Invalid password. Please try again.' 
        };
      }
    }
  } catch (error) {
    return { 
      success: false, 
      error: `Error: ${error.message}` 
    };
  }
});

ipcMain.handle('password-accepted', async (event) => {
  // Close password window and create main window
  if (passwordWindow) {
    passwordWindow.close();
    passwordWindow = null;
  }
  
  createMainWindow();
});



// App event handlers
// Note: window-all-closed handler is in main.js with comprehensive cleanup logic

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (masterPassword) {
      createMainWindow();
    } else {
      createPasswordWindow();
    }
  }
});

// IPC handlers for wallet operations
ipcMain.handle('get-wallets', async (event) => {
  return getWalletData();
});

// Get all wallets for management
ipcMain.handle('get-all-wallets', async (event) => {
  try {
    const wallets = secureConfig.getWallets();
    
    return {
      success: true,
      wallets: wallets,
      config: secureConfig.config.settings || {}
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// Add new wallet
ipcMain.handle('add-wallet', async (event, walletData) => {
  try {
    // Validate private key
    if (walletData.privateKey) {
      try {
        const { ethers } = require('ethers');
        new ethers.Wallet(walletData.privateKey);
      } catch (error) {
        throw new Error('Invalid private key format');
      }
    }
    
    // Add wallet to secure config
    const result = secureConfig.addWallet(walletData);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to add wallet');
    }
    
    return { 
      success: true, 
      wallet: result.wallet 
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// Update wallet
ipcMain.handle('update-wallet', async (event, walletId, updates) => {
  try {
    // Validate private key if being updated
    if (updates.privateKey) {
      try {
        const { ethers } = require('ethers');
        new ethers.Wallet(updates.privateKey);
      } catch (error) {
        throw new Error('Invalid private key format');
      }
    }
    
    // Update wallet
    const result = secureConfig.updateWallet(walletId, updates);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to update wallet');
    }
    
    return { 
      success: true, 
      wallet: result.wallet 
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// Delete wallet
ipcMain.handle('delete-wallet', async (event, walletId) => {
  try {
    const result = secureConfig.deleteWallet(walletId);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete wallet');
    }
    
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// Validate private key
ipcMain.handle('validate-private-key', async (event, privateKey) => {
  try {
    // Check private key format
    const { ethers } = require('ethers');
    const wallet = new ethers.Wallet(privateKey);
    const address = wallet.address;
    
    if (address) {
      return { success: true, address: address };
    } else {
      return { success: false, error: 'Invalid private key' };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// Get wallet private key (for advanced operations that need it)
ipcMain.handle('get-wallet-private-key', async (event, walletId) => {
  try {
    const privateKey = getPrivateKeyForWallet(walletId);
    
    if (privateKey) {
      return { success: true, privateKey };
    } else {
      throw new Error('Private key not found');
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// IPC handlers for bot operations
ipcMain.handle('run-bot', async (event, botType, args) => {
  try {
    // Use npm run commands for winbot bot structure
    const npmScript = botType;
    
    // Load configuration from secure config and inject as environment variables
    const env = { ...process.env };
    
    // Add settings from secure config
    const settings = secureConfig.config.settings || {};
    
    // Standard configuration mappings
    env.RPC_URL = settings.rpcUrl;
    env.RPC_URL_Q = settings.rpcUrlQuickNode;
    env.RPC_URL_I = settings.rpcUrlInfura;
    env.CHAIN_ID = settings.chainId?.toString();
    env.VIRTUAL_TOKEN_ADDRESS = settings.virtualTokenAddress;
    env.BLAST_API_KEY = settings.blastApiKey;
    env.MAINNET_RPC = settings.mainnetRpc;
    env.BLAST_MAINNET_RPC = settings.blastMainnetRpc;
    env.BLAST_TESTNET_RPC = settings.blastTestnetRpc;
    env.ETH_MAINNET_RPC = settings.ethMainnetRpc;
    env.BSC_MAINNET_RPC = settings.bscMainnetRpc;
    env.ARBITRUM_MAINNET_RPC = settings.arbitrumMainnetRpc;
    env.OPTIMISM_MAINNET_RPC = settings.optimismMainnetRpc;
    env.AVALANCHE_MAINNET_RPC = settings.avalancheMainnetRpc;
    env.FANTOM_MAINNET_RPC = settings.fantomMainnetRpc;
    env.MOONBEAM_MAINNET_RPC = settings.moonbeamMainnetRpc;
    env.POLYGON_MAINNET_RPC = settings.polygonMainnetRpc;
    env.LAYERZERO_BASE_ENDPOINT = settings.layerzeroBaseEndpoint;
    env.LAYERZERO_BLAST_ENDPOINT = settings.layerzeroBlastEndpoint;
    env.LAYERZERO_ARBITRUM_ENDPOINT = settings.layerzeroArbitrumEndpoint;
    env.LAYERZERO_BSC_ENDPOINT = settings.layerzeroBscEndpoint;
    env.LAYERZERO_SOLANA_ENDPOINT = settings.layerzeroSolanaEndpoint;
    env.MIN_VIRTUAL_TRANSFER = settings.minVirtualTransfer?.toString();
    env.MAX_VIRTUAL_TRANSFER = settings.maxVirtualTransfer?.toString();
    env.TRANSFER_INTERVAL_SECONDS = settings.transferIntervalSeconds?.toString();
    
    // Add wallet private keys from secure config
    const wallets = secureConfig.getWallets(true);
    
    wallets.forEach((wallet, index) => {
      if (wallet.enabled !== false && wallet.privateKey) {
        env[`B${index + 1}`] = wallet.privateKey;
      }
    });
    
    // Add bridging configurations if available
    if (settings.bridging) {
      env.SOLANA_SOURCE_PRIVATE_KEY = settings.bridging.solanaSourcePrivateKey;
      env.BASE_SOURCE_PRIVATE_KEY = settings.bridging.baseSourcePrivateKey;
      env.SOL_WALLET_1_ADDRESS = settings.bridging.solWallet1Address;
    }

    return new Promise((resolve, reject) => {
      // Prepare arguments list for npm command
      let npmArgs = ['run', npmScript];
      
      // Add any additional arguments
      if (args && args.length > 0) {
        npmArgs = npmArgs.concat('--', args);
      }

      console.log(`Running: npm ${npmArgs.join(' ')}`);
      
      const process = trackedSpawn('npm', npmArgs, {
        cwd: __dirname,
        stdio: 'pipe',
        env: env,
        shell: true
      });

      let output = '';
      let errorOutput = '';

      process.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        
        // Send output to renderer for real-time display
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('bot-output', chunk);
        }
      });

      process.stderr.on('data', (data) => {
        const chunk = data.toString();
        errorOutput += chunk;
        
        // Send error output to renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('bot-error', chunk);
        }
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            output: output
          });
        } else {
          reject(new Error(`Process exited with code ${code}: ${errorOutput}`));
        }
      });

      // Allow the renderer to kill this process
      ipcMain.once(`kill-process-${botType}`, () => {
        try {
          process.kill();
        } catch (error) {
          console.error('Error killing process:', error);
        }
      });
    });
  } catch (error) {
    throw error;
  }
});

// Environment configuration handlers
ipcMain.handle('get-env-config', async (event) => {
  try {
    return { 
      success: true, 
      config: secureConfig.config.settings || {}
    };
  } catch (error) {
    throw error;
  }
});

ipcMain.handle('save-env-config', async (event, config) => {
  try {
    // Update each setting individually
    for (const [key, value] of Object.entries(config)) {
      secureConfig.setSetting(key, value);
    }
    
    return { success: true, message: 'Configuration saved successfully' };
  } catch (error) {
    throw error;
  }
});

// Change master password
ipcMain.handle('change-master-password', async (event, { currentPassword, newPassword }) => {
  try {
    const result = secureConfig.changeMasterPassword(currentPassword, newPassword);
    
    if (result.success) {
      masterPassword = newPassword;
    }
    
    return result;
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// Nuclear cleanup function removed to prevent interference with update installer process
// The aggressive process termination was killing the electron.exe update installer
// Relying on standard cleanup handlers for graceful shutdown

// Enhanced process cleanup handler for application exit
app.on('will-quit', (event) => {
  console.log('🔍 [SECURE-MAIN.JS] will-quit event triggered - comprehensive cleanup...');
  
  try {
    // Standard child process cleanup
    console.log(`🔧 [SECURE-MAIN.JS] Cleaning up ${childProcesses.length} tracked child processes...`);
    
    childProcesses.forEach(process => {
      try {
        if (!process.killed) {
          if (process.platform === 'win32') {
            try {
              execSync(`taskkill /pid ${process.pid} /t /f`, { stdio: 'ignore' });
              console.log(`✅ Terminated process tree with PID ${process.pid}`);
            } catch (err) {
              process.kill();
              console.log(`✅ Fallback terminated child process with PID ${process.pid}`);
            }
          } else {
            process.kill();
            console.log(`✅ Terminated child process with PID ${process.pid}`);
          }
        }
      } catch (error) {
        console.error(`❌ Failed to kill process: ${error.message}`);
      }
    });
    
    // Clear the array
    childProcesses.length = 0;
    
    // Nuclear cleanup removed for update installer compatibility
    // Standard cleanup above should be sufficient
    
    console.log('🎉 [SECURE-MAIN.JS] will-quit cleanup completed');
  } catch (error) {
    console.error('❌ [SECURE-MAIN.JS] Error during will-quit cleanup:', error.message);
    // Nuclear cleanup removed for update installer compatibility
    // Allow graceful shutdown even if standard cleanup fails
  }
});

// Add before-quit handler for additional safety
app.on('before-quit', (event) => {
  console.log('🔍 [SECURE-MAIN.JS] before-quit event triggered - graceful shutdown...');
  // Nuclear cleanup removed for update installer compatibility
});

// Add window-all-closed handler for comprehensive cleanup
app.on('window-all-closed', () => {
  console.log('🔍 [SECURE-MAIN.JS] window-all-closed event triggered');
  if (process.platform !== 'darwin') {
    console.log('🔍 [SECURE-MAIN.JS] Platform is not darwin, proceeding with cleanup and quit...');
    
    // Force trigger our cleanup handlers before quitting
    try {
      const { execSync } = require('child_process');
      const ourPid = process.pid;
      
      // Kill tracked child processes
      childProcesses.forEach(process => {
        try {
          if (!process.killed) {
            if (process.platform === 'win32') {
              try {
                execSync(`taskkill /pid ${process.pid} /t /f`, { stdio: 'ignore' });
                console.log(`✅ Terminated process tree with root PID ${process.pid}`);
              } catch (err) {
                process.kill();
                console.log(`✅ Fallback terminated child process with PID ${process.pid}`);
              }
            } else {
              process.kill();
              console.log(`✅ Terminated child process with PID ${process.pid}`);
            }
          }
        } catch (error) {
          console.error(`❌ Failed to kill process: ${error.message}`);
        }
      });
      
      // Clear the array
      childProcesses = [];
      
      // Additional cleanup for any remaining processes
      if (process.platform === 'win32') {
        try {
          console.log('🔧 [SECURE-MAIN.JS] Final cleanup of any remaining processes...');
          execSync(`taskkill /f /im node.exe /fi "PID ne ${ourPid}"`, { stdio: 'ignore' });
        } catch (error) {
          console.log('ℹ️  No additional processes found to terminate');
        }
      }
      
      // Nuclear cleanup removed for update installer compatibility
      // Standard cleanup above should handle process termination
      
      console.log('🎉 [SECURE-MAIN.JS] Window close cleanup completed - quitting app');
    } catch (error) {
      console.error('❌ [SECURE-MAIN.JS] Error during window-all-closed cleanup:', error.message);
      // Nuclear cleanup removed for update installer compatibility
    }
    
    app.quit();
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
