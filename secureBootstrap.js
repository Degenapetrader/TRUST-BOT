const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { SecureAdapter } = require('./src/utils/secureAdapter.cjs');
const { initAutoUpdater } = require('./src/auto-updater.cjs');

// Global references
let passwordWindow = null;
let secureAdapter = null;
let mainProcessLoaded = false;

// Constants
const WALLETS_DB_PATH = path.join(__dirname, 'wallets.json');
const CONFIG_PATH = path.join(__dirname, 'config.json');

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
    autoHideMenuBar: false,
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
    icon: path.join(__dirname, 'assets', 'icon.ico'), // Application icon
    webPreferences: { nodeIntegration: true }
  });
  console.log('Created hidden placeholder window to prevent app from exiting');
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
    
    // Initialize auto-updater with the main window
    // We do this after main.js is loaded to ensure the main window exists
    if (global.mainWindow) {
      console.log('Initializing auto-updater...');
      initAutoUpdater(global.mainWindow);
    }
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
  console.log('File > Exit triggered - running cleanup...');
  
  try {
    const { execSync } = require('child_process');
    const ourPid = process.pid;
    
    // Kill any lingering processes directly (simplified approach)
    if (process.platform === 'win32') {
      try {
        console.log('Killing lingering node.exe processes...');
        execSync(`taskkill /f /im node.exe /fi "PID ne ${ourPid}"`, { stdio: 'ignore' });
        console.log('✅ Cleaned up node processes');
      } catch (error) {
        console.log('ℹ️  No node processes found to clean up');
      }
      
      try {
        console.log('Killing lingering cmd.exe processes...');
        execSync(`taskkill /f /im cmd.exe`, { stdio: 'ignore' });
        console.log('✅ Cleaned up cmd processes');
      } catch (error) {
        console.log('ℹ️  No cmd processes found to clean up');
      }
    }
    
    console.log('🎉 File Exit cleanup completed');
  } catch (error) {
    console.error('❌ Error during File Exit cleanup:', error.message);
  }
  
  // Exit after cleanup
  app.exit(0);
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

// Handle reset account (forgot password)
ipcMain.handle('reset-account', async (event, { restart = false }) => {
  try {
    console.log('Resetting account...');
    
    // Reset secure config
    secureAdapter.resetSecureConfig();
    
    console.log('Account reset successful');
    
    if (restart) {
      // Show a brief dialog informing the user about auto-restart
      const { dialog } = require('electron');
      
      // Show confirmation dialog
      dialog.showMessageBox(passwordWindow, {
        type: 'info',
        title: 'Account Reset Complete',
        message: 'Your account has been reset successfully.',
        detail: 'The application will automatically restart to complete the reset process.',
        buttons: ['OK'],
        defaultId: 0
      }).then(() => {
        console.log('Initiating automatic app restart...');
        
        // Use Electron's built-in relaunch method for clean restart
        // This spawns a completely new app instance with fresh state
        app.relaunch();
        
        // Exit current instance to complete the restart
        app.exit(0);
      });
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error resetting account:', error);
    return {
      success: false,
      error: error.message || 'Failed to reset account'
    };
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
