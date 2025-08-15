const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { SecureAdapter } = require('./src/utils/secureAdapter.cjs');

// Global references
let passwordWindow = null;
let secureAdapter = null;
let mainProcessLoaded = false;

// Constants - Consistent path logic for both dev and packaged apps
// Use userData directory for persistent storage across updates
function getConfigPath() {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'config.json');
  } else {
    return path.join(__dirname, 'config.json');
  }
}

function getWalletsPath() {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'wallets.json');
  } else {
    return path.join(__dirname, 'wallets.json');
  }
}

const WALLETS_DB_PATH = getWalletsPath();
const CONFIG_PATH = getConfigPath();

/**
 * Ensure config and wallets files exist by copying from .example files if needed
 */
function ensureConfigFilesExist() {
  try {
    // Ensure userData directory exists
    if (app.isPackaged) {
      const userDataDir = app.getPath('userData');
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }
    }
    
    // Handle config.json - user file in userData, .example in app bundle
    const configPath = getConfigPath();  // Now points to userData
    const configExamplePath = app.isPackaged 
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'config.example.json')
      : path.join(__dirname, 'config.example.json');
    
    if (!fs.existsSync(configPath)) {
      if (fs.existsSync(configExamplePath)) {
        fs.copyFileSync(configExamplePath, configPath);
        console.log('✅ [SECURE-BOOTSTRAP] Created config.json in userData from config.example.json');
      } else {
        console.warn('⚠️ [SECURE-BOOTSTRAP] config.example.json not found, will create default config');
      }
    }
    
    // Handle wallets.json - user file in userData, .example in app bundle
    const walletsPath = getWalletsPath();  // Now points to userData
    const walletsExamplePath = app.isPackaged 
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'wallets.example.json')
      : path.join(__dirname, 'wallets.example.json');
    
    if (!fs.existsSync(walletsPath)) {
      if (fs.existsSync(walletsExamplePath)) {
        fs.copyFileSync(walletsExamplePath, walletsPath);
        console.log('✅ [SECURE-BOOTSTRAP] Created wallets.json in userData from wallets.example.json');
      } else {
        console.warn('⚠️ [SECURE-BOOTSTRAP] wallets.example.json not found, will create default wallets');
      }
    }
  } catch (error) {
    console.error('❌ [SECURE-BOOTSTRAP] Error ensuring config files exist:', error);
  }
}

/**
 * Initialize the security adapter
 */
function initializeSecurityAdapter() {
  secureAdapter = new SecureAdapter(WALLETS_DB_PATH, CONFIG_PATH);
  return secureAdapter.initialize();
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
    if (!mainProcessLoaded) {
      app.exit(0);
    }
  });
}

/**
 * Load the main process once authenticated
 */
// Create a hidden placeholder window to prevent app from exiting
let placeholderWindow = null;

function createPlaceholderWindow() {
  placeholderWindow = new BrowserWindow({
    width: 0, 
    height: 0,
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'), // Application icon
    webPreferences: { nodeIntegration: true }
  });
  
  // 🎯 CRITICAL: Make placeholder window globally accessible for cleanup (COMPLIANCE WITH TRACE)
  global.placeholderWindow = placeholderWindow;
  
  console.log('Created hidden placeholder window to prevent app from exiting');
  console.log('✅ [SECURE-BOOTSTRAP] Placeholder window exposed globally for cleanup access');
}

function loadMainProcess(showWalletDialog = false) {
  try {
    // Mark as loaded so password window can close
    mainProcessLoaded = true;
    global.showWalletDialog = showWalletDialog;
    global.deferAppStartup = true; // Flag to defer main window creation
    
    // Share the master password with main.js process
    if (secureAdapter && secureAdapter.masterPassword) {
      global.masterPassword = secureAdapter.masterPassword;
      console.log('Shared master password with main process');
    } else {
      console.warn('No master password available to share with main process');
    }
    
    console.log('Loading main process with wallet dialog:', showWalletDialog);
    
    // Create a hidden placeholder window first to prevent app from exiting
    createPlaceholderWindow();
    
    // Load main.js first, THEN close the password window
    console.log('Loading main.js first...');
    require('./main.js');
    console.log(`Main process loaded successfully${showWalletDialog ? ' (wallet dialog will open)' : ''}`);
    
    // Now close the password window after main.js is loaded
    if (passwordWindow && !passwordWindow.isDestroyed()) {
      console.log('Closing password window...');
      passwordWindow.close();
    }
    
    // Auto-updater is now initialized in main.js after window is ready
    console.log('✅ Main process loaded, auto-updater will be initialized by main.js');
  } catch (error) {
    console.error('❌ Error loading main process:', error);
    app.exit(1);
  }
}

// Register IPC handlers for password validation
const { ipcMain } = require('electron');

ipcMain.handle('check-password-setup', async (event) => {
  // Check if this is the first time setup
  const isFirstTimeSetup = !secureAdapter.isSecureConfigActive();
  return { isFirstTimeSetup };
});

ipcMain.handle('validate-master-password', async (event, { password, isFirstTimeSetup }) => {
  try {
    if (isFirstTimeSetup) {
      // Set up new password
      secureAdapter.setMasterPassword(password, true);
      
      // Migrate from legacy storage if it exists
      if (fs.existsSync(WALLETS_DB_PATH)) {
        await secureAdapter.migrateFromLegacy();
      }
      
      return { success: true };
    } else {
      // Validate existing password
      const isValid = secureAdapter.validatePassword(password);
      
      if (isValid) {
        // Store password for this session
        secureAdapter.setMasterPassword(password, false);
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
  // Password accepted, load main process
  loadMainProcess();
});

ipcMain.handle('exit-app', async (event) => {
  console.log('🔍 [SECURE-BOOTSTRAP] File > Exit triggered - comprehensive cleanup...');
  
  try {
    const { execSync } = require('child_process');
    const ourPid = process.pid;
    
    // 🎯 CRITICAL: Close placeholder window if it exists (COMPLIANCE WITH TRACE)
    try {
      if (global.placeholderWindow && !global.placeholderWindow.isDestroyed()) {
        console.log('🔧 [SECURE-BOOTSTRAP] Closing placeholder window...');
        global.placeholderWindow.close();
        global.placeholderWindow = null;
        console.log('✅ [SECURE-BOOTSTRAP] Placeholder window closed');
      } else {
        console.log('ℹ️  [SECURE-BOOTSTRAP] No placeholder window found or already destroyed');
      }
    } catch (error) {
      console.log('⚠️  [SECURE-BOOTSTRAP] Error closing placeholder window:', error.message);
    }
    
    // Close console window if accessible
    try {
      const { consoleWindow } = require('./main.js');
      if (consoleWindow && !consoleWindow.isDestroyed()) {
        console.log('🔧 [SECURE-BOOTSTRAP] Closing console window...');
        consoleWindow.close();
        console.log('✅ [SECURE-BOOTSTRAP] Console window closed');
      }
    } catch (error) {
      console.log('ℹ️  [SECURE-BOOTSTRAP] Console window cleanup skipped:', error.message);
    }
    
    // Kill tracked child processes
    try {
      const { childProcesses } = require('./main.js');
      if (childProcesses && childProcesses.length > 0) {
        console.log(`🔧 [SECURE-BOOTSTRAP] Cleaning up ${childProcesses.length} child processes...`);
        
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
        console.log('✅ [SECURE-BOOTSTRAP] Child processes cleanup completed');
      }
    } catch (error) {
      console.log('ℹ️  [SECURE-BOOTSTRAP] Child processes cleanup skipped:', error.message);
    }
    
    // Kill any lingering processes (comprehensive approach)
    if (process.platform === 'win32') {
      try {
        console.log('🔧 [SECURE-BOOTSTRAP] Killing lingering node.exe processes...');
        execSync(`taskkill /f /im node.exe /fi "PID ne ${ourPid}"`, { stdio: 'ignore' });
        console.log('✅ Cleaned up node processes');
      } catch (error) {
        console.log('ℹ️  No node processes found to clean up');
      }
      
      try {
        console.log('🔧 [SECURE-BOOTSTRAP] Killing lingering cmd.exe processes...');
        execSync(`taskkill /f /im cmd.exe`, { stdio: 'ignore' });
        console.log('✅ Cleaned up cmd processes');
      } catch (error) {
        console.log('ℹ️  No cmd processes found to clean up');
      }
      
      // Additional cleanup for npm processes
      try {
        console.log('🔧 [SECURE-BOOTSTRAP] Killing lingering npm processes...');
        execSync(`taskkill /f /im npm.exe`, { stdio: 'ignore' });
        console.log('✅ Cleaned up npm processes');
      } catch (error) {
        console.log('ℹ️  No npm processes found to clean up');
      }
    }
    
    console.log('🎉 [SECURE-BOOTSTRAP] File Exit comprehensive cleanup completed');
  } catch (error) {
    console.error('❌ [SECURE-BOOTSTRAP] Error during File Exit cleanup:', error.message);
  }
  
  // 🎯 FINAL STEP: Centralized TRUSTBOT cleanup
  try {
    const { performFinalTrustbotCleanup } = require('./main.js');
    performFinalTrustbotCleanup();
  } catch (error) {
    console.log('ℹ️  [SECURE-BOOTSTRAP] Final cleanup function not available:', error.message);
  }
  
  // Exit after cleanup
  console.log('🚪 [SECURE-BOOTSTRAP] Exiting application...');
  app.exit(0);
});

// Reset account handler with clean restart logic
ipcMain.handle('reset-account', async (event, { restart = false } = {}) => {
  console.log('🔄 [SECURE-BOOTSTRAP] Account reset requested with restart:', restart);
  
  try {
    if (restart) {
      // Show confirmation dialog
      const { dialog } = require('electron');
      
      const result = await dialog.showMessageBox(passwordWindow, {
        type: 'info',
        title: 'Account Reset Complete',
        message: 'Your account has been reset successfully.',
        detail: 'The application will automatically restart to complete the reset process.',
        buttons: ['OK'],
        defaultId: 0
      });
      
      console.log('🔄 [SECURE-BOOTSTRAP] User confirmed restart, clearing config and relaunching app...');
      
      // Clear the password/encryption data before restart
      secureAdapter.resetSecureConfig();
      console.log('✅ [SECURE-BOOTSTRAP] Config reset complete, relaunching app...');
      
      // Use Electron's built-in relaunch method for clean restart
      app.relaunch();
      
      // Exit current instance to complete the restart
      console.log('🚪 [SECURE-BOOTSTRAP] Exiting for restart...');
      app.exit(0);
    }
    
    return { success: true, message: 'Account reset completed' };
  } catch (error) {
    console.error('❌ [SECURE-BOOTSTRAP] Error during account reset:', error.message);
    return { success: false, error: error.message };
  }
});

// Handle successful password validation
ipcMain.handle('password-validated', async (event, { isFirstTimeSetup } = {}) => {
  try {
    console.log(`Password validated successfully, loading main process${isFirstTimeSetup ? ' with wallet dialog' : ''}...`);
    // Make sure this is executed asynchronously to allow the response to be sent
    setTimeout(() => {
      // Show wallet dialog on first time setup
      loadMainProcess(isFirstTimeSetup === true);
    }, 200);
    
    // Return success immediately so renderer gets a response
    return { success: true };
  } catch (error) {
    console.error('Error in password-validated handler:', error);
    return { success: false, error: error.message };
  }
});



// Handle skip password authentication
ipcMain.handle('skip-password-auth', async (event) => {
  try {
    console.log('Skipping password authentication...');
    
    // If we have a secureAdapter, disable it or set a bypass flag
    if (secureAdapter) {
      // Set a flag to indicate we're in insecure mode
      secureAdapter.setInsecureMode(true);
      console.log('⚠️ WARNING: Running in insecure mode - wallet keys will not be encrypted');
    }
    
    return { success: true };
  } catch (error) {
    console.error('❌ Error skipping password auth:', error);
    return { 
      success: false,
      error: error.message || 'Failed to skip password authentication'
    };
  }
});

// Make secureAdapter available to the main process
global.secureAdapter = secureAdapter;

// App startup
app.whenReady().then(async () => {
  // Ensure config files exist before any initialization
  ensureConfigFilesExist();
  
  // Initialize secure adapter
  initializeSecurityAdapter();
  
  // Always show password prompt - it handles both first-time setup and returning users
  createPasswordWindow();
  
  // The password-prompt.html UI will check if it's first time setup
  // and guide the user accordingly
});



// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

console.log('Single instance lock result:', gotTheLock);

if (!gotTheLock) {
  console.log('Failed to get single instance lock - another instance may be running');
  console.log('Process PID:', process.pid);
  // Temporarily comment out to allow app to start
  // app.quit();
} else {
  console.log('Successfully got single instance lock');
  

  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus existing window
    if (passwordWindow && !passwordWindow.isDestroyed()) {
      if (passwordWindow.isMinimized()) passwordWindow.restore();
      passwordWindow.focus();
    }
  });
}

// NUCLEAR CLEANUP SYSTEM - Emergency process termination for secureBootstrap
// Nuclear cleanup function removed to prevent interference with update installer process
// The aggressive process termination was killing the electron.exe update installer
// Relying on other cleanup handlers for graceful shutdown

// Nuclear cleanup removed - using graceful shutdown for update compatibility
app.on('before-quit', (event) => {
  console.log('🔍 [SECURE-BOOTSTRAP] before-quit event triggered - graceful shutdown...');
  // Allow normal quit process for update installer compatibility
});

app.on('window-all-closed', () => {
  console.log('🔍 [SECURE-BOOTSTRAP] window-all-closed event triggered - graceful shutdown...');
  // Nuclear cleanup removed for update installer compatibility
  
  if (process.platform !== 'darwin') {
    console.log('🔍 [SECURE-BOOTSTRAP] Platform is not darwin, quitting app...');
    app.quit();
  }
});

app.on('will-quit', (event) => {
  console.log('🔍 [SECURE-BOOTSTRAP] will-quit event triggered - graceful shutdown...');
  // Nuclear cleanup removed for update installer compatibility
});
