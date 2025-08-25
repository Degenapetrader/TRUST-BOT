const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { spawn, execSync, fork } = require('child_process');
const fs = require('fs');
const { WalletEncryption } = require('./src/utils/walletEncryption.cjs');
const { registerTokenHandlers } = require('./token-handlers');

// Import the botLauncher module with fallback
let botLauncher;
try {
  botLauncher = require('./src/botLauncher.cjs');
  console.log('✅ botLauncher module loaded successfully');
} catch (error) {
  console.error('❌ Failed to load botLauncher module:', error.message);
  // Fallback to null - we'll use npm scripts instead
  botLauncher = null;
}

// 🎯 CENTRALIZED TRUSTBOT CLEANUP FUNCTION
// Final step to kill lingering TRUSTBOT.exe processes across all exit paths
function performFinalTrustbotCleanup() {
  if (process.platform === 'win32') {
    try {
      const ourPid = process.pid;
      console.log('🎯 [FINAL-CLEANUP] Performing final TRUSTBOT.exe cleanup...');
      execSync(`taskkill /f /im TRUSTBOT.exe /fi "PID ne ${ourPid}"`, { stdio: 'ignore' });
      console.log('✅ [FINAL-CLEANUP] All other TRUSTBOT processes terminated');
    } catch (error) {
      console.log('ℹ️  [FINAL-CLEANUP] No other TRUSTBOT processes found to clean up');
    }
  }
}

// JSON Database for wallets and config
// Consistent path logic for both dev and packaged apps
// Use userData directory for persistent storage across updates
function getWalletsPath() {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'wallets.json');
  } else {
    return path.join(__dirname, 'wallets.json');
  }
}

function getConfigPath() {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'config.json');
  } else {
    return path.join(__dirname, 'config.json');
  }
}

const WALLETS_DB_PATH = getWalletsPath();
const CONFIG_PATH = getConfigPath();

// Set environment variable so UI gas price service can find wallets.json
process.env.WALLETS_DB_PATH = WALLETS_DB_PATH;

// Global process tracking for cleanup
let childProcesses = [];

// Export childProcesses for access from other modules
module.exports = { childProcesses };

// Initialize wallets database
function initializeWalletsDB() {
  if (!fs.existsSync(WALLETS_DB_PATH)) {
    // Try to copy from wallets.example.json first
    const walletsExamplePath = app.isPackaged 
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'wallets.example.json')
      : path.join(__dirname, 'wallets.example.json');
    
    if (fs.existsSync(walletsExamplePath)) {
      try {
        fs.copyFileSync(walletsExamplePath, WALLETS_DB_PATH);
        console.log('✅ Created wallets.json from wallets.example.json');
        return;
      } catch (error) {
        console.warn('⚠️ Failed to copy wallets.example.json, creating default:', error.message);
      }
    }
    
    // Fallback to creating default data programmatically
    const defaultData = {
      config: {
        rpcUrl: "https://base-rpc.publicnode.com",
        chainId: 8453,
        virtualTokenAddress: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b"
      },
      wallets: []
    };
    fs.writeFileSync(WALLETS_DB_PATH, JSON.stringify(defaultData, null, 2));
    console.log('✅ Created wallets.json with default data');
  }
}

// Read wallets database
function readWalletsDB() {
  try {
    const data = fs.readFileSync(WALLETS_DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading wallets database:', error);
    return null;
  }
}

// Write wallets database
function writeWalletsDB(data) {
  try {
    // Before writing, ensure we preserve the existing config section
    let existingData = {};
    try {
      if (fs.existsSync(WALLETS_DB_PATH)) {
        const existingContent = fs.readFileSync(WALLETS_DB_PATH, 'utf8');
        existingData = JSON.parse(existingContent);
      }
    } catch (readError) {
      console.warn('Could not read existing wallets.json, proceeding with new data');
    }
    
    // Merge configs properly - preserve dynamicRpcs if not provided in new data
    const mergedConfig = { ...existingData.config, ...data.config };
    if (!data.config?.dynamicRpcs && existingData.config?.dynamicRpcs) {
      mergedConfig.dynamicRpcs = existingData.config.dynamicRpcs;
    }
    
    const finalData = {
      ...data,
      config: mergedConfig
    };
    
    fs.writeFileSync(WALLETS_DB_PATH, JSON.stringify(finalData, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing wallets database:', error);
    return false;
  }
}

// Validate private key and get address using ethers.js
function getAddressFromPrivateKey(privateKey, encryptedKey = null) {
  try {
    // If encrypted key is provided and plaintext key is empty, try to decrypt
    if (encryptedKey && (!privateKey || privateKey === '')) {
      try {
        console.log('Attempting to decrypt private key from encrypted data');
        // Use the master password for decryption if available
        const masterPassword = global.masterPassword;
        if (!masterPassword) {
          console.error('No master password available for decryption');
          return null;
        }
        privateKey = WalletEncryption.decryptPrivateKey(encryptedKey, masterPassword);
        if (!privateKey) {
          console.error('Failed to decrypt private key');
          return null;
        }
      } catch (decryptError) {
        console.error('Error decrypting private key:', decryptError);
        return null;
      }
    }
    
    // Ensure private key is properly formatted
    if (!privateKey) {
      console.error('No private key provided');
      return null;
    }
    
    // Add 0x prefix if not present for ethers.js
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }
    
    // Validate private key length (64 hex chars + 0x prefix = 66 total)
    if (privateKey.length !== 66) {
      console.error('Invalid private key length:', privateKey.length);
      return null;
    }
    
    // Use ethers.js to validate and get address
    const ethers = require('ethers');
    const wallet = new ethers.Wallet(privateKey);
    
    console.log('✅ Private key validated successfully');
    return wallet.address;
  } catch (error) {
    console.error('Error validating private key:', error.message);
    return null;
  }
}

// IPC handler for validating private keys securely in the main process
ipcMain.handle('validate-private-key', async (event, privateKey, encryptedKey) => {
  try {
    console.log('Validating private key in main process');
    const address = getAddressFromPrivateKey(privateKey, encryptedKey);
    if (!address) {
      throw new Error('Invalid private key format');
    }
    return address;
  } catch (error) {
    console.error('Error validating private key:', error);
    throw new Error('Invalid private key: ' + error.message);
  }
});

// Provide userData path to renderer for reading updated token files
ipcMain.handle('get-user-data-path', async () => {
  try {
    return app.getPath('userData');
  } catch (e) {
    return null;
  }
});

// Allow renderer to trigger token ticker update on demand
ipcMain.handle('run-ticker-update', async () => {
  try {
    // If an update is already in progress, return immediately
    if (runAutomaticTickerUpdate.inProgress) {
      return { success: true, inProgress: true, message: 'Update already in progress' };
    }

    // Start update in background and return immediately
    Promise.resolve()
      .then(() => runAutomaticTickerUpdate())
      .catch(err => {
        console.error('Background ticker update failed:', err);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ticker-update-completed', {
            success: false,
            message: 'Failed to update token database',
            error: err?.message || String(err)
          });
        }
      });

    return { success: true, inProgress: true };
  } catch (e) {
    console.error('run-ticker-update failed:', e);
    return { success: false, error: e?.message || String(e) };
  }
});

// Global variable to track console window
let consoleWindow = null;

// IPC handler for creating console window
ipcMain.handle('create-console-window', async (event) => {
  try {
    // If window already exists, focus it
    if (consoleWindow && !consoleWindow.isDestroyed()) {
      consoleWindow.focus();
      return { success: true, windowId: consoleWindow.id };
    }
    
    // Create new console window
    consoleWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true
      },
      icon: path.join(__dirname, 'assets', 'icon.ico'), // Application icon
      title: 'TRUSTBOT - Detailed Console',
      show: false,
      frame: true,
      titleBarStyle: 'default',
      parent: mainWindow, // Make it a child of main window
      modal: false // Allow interaction with main window
    });
    
    // Load console HTML content
    const consoleHtml = `
      <!DOCTYPE html>
      <html>
      <head>
          <title>TRUSTBOT - Detailed Console</title>
          <style>
              body {
                  margin: 0;
                  padding: 20px;
                  background: #0d1117;
                  color: #f0f6fc;
                  font-family: 'Courier New', monospace;
                  font-size: 13px;
                  line-height: 1.4;
                  overflow-x: hidden;
              }
              .console-header {
                  position: sticky;
                  top: 0;
                  background: #0d1117;
                  padding: 0 0 20px 0;
                  border-bottom: 2px solid #30363d;
                  margin-bottom: 20px;
                  z-index: 1000;
              }
              .console-content {
                  min-height: calc(100vh - 100px);
              }
              .console-line {
                  margin: 2px 0;
                  padding: 2px 0;
                  word-wrap: break-word;
                  white-space: pre-wrap;
              }
              .console-line.stderr {
                  color: #ff6b6b;
              }
              .console-line.stdout {
                  color: #f0f6fc;
              }
              .console-timestamp {
                  color: #7d8590;
                  font-size: 11px;
              }
              button {
                  background: #21262d;
                  border: 1px solid #30363d;
                  color: #f0f6fc;
                  padding: 4px 8px;
                  border-radius: 4px;
                  cursor: pointer;
                  margin-right: 6px;
                  font-size: 11px;
                  font-weight: 500;
                  transition: all 0.2s ease;
                  white-space: nowrap;
              }
              button:hover {
                  background: #30363d;
                  border-color: #484f58;
                  transform: translateY(-1px);
              }
              .clear-btn {
                  background: #da3633 !important;
                  border-color: #f85149 !important;
              }
              .clear-btn:hover {
                  background: #f85149 !important;
                  border-color: #ff7b72 !important;
              }
              /* Transaction enhancement styles */
              .tx-hash {
                  color: #58a6ff !important;
                  font-weight: bold;
                  background: rgba(88, 166, 255, 0.1);
                  padding: 1px 3px;
                  border-radius: 3px;
              }
              .tx-amount {
                  color: #a5a5ff !important;
                  font-weight: bold;
                  background: rgba(165, 165, 255, 0.1);
                  padding: 1px 3px;
                  border-radius: 3px;
              }
              .tx-status-success {
                  color: #3fb950 !important;
                  font-weight: bold;
              }
              .tx-status-pending {
                  color: #d29922 !important;
                  font-weight: bold;
              }
              .tx-status-failed {
                  color: #f85149 !important;
                  font-weight: bold;
              }
          </style>
      </head>
      <body>
          <div class="console-header">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                  <h2 style="margin: 0; color: #58a6ff; font-size: 18px; font-weight: bold;">📊 TRUSTBOT - Detailed Console</h2>
                  <div>
                      <button onclick="clearConsole()">🗑️ Clear</button>
                      <button onclick="scrollToBottom()">⬇️ Scroll to Bottom</button>
                      <button class="clear-btn" onclick="window.close()">❌ Close Window</button>
                  </div>
              </div>
          </div>
          <div class="console-content" id="console-window">
              <div class="console-line" style="color: #7d8590; font-style: italic;">
                  [${new Date().toLocaleTimeString()}] Console window opened - waiting for messages...
              </div>
          </div>
          
          <script>
              const { ipcRenderer } = require('electron');
              
              function clearConsole() {
                  const console = document.getElementById('console-window');
                  console.innerHTML = '<div class="console-line" style="color: #7d8590; font-style: italic;">[' + new Date().toLocaleTimeString() + '] Console cleared</div>';
                  
                  // Send IPC message to main process to clear the normal console
                  ipcRenderer.invoke('clear-console-from-detailed').catch(error => {
                      console.error('Error clearing main console:', error);
                  });
              }
              
              function scrollToBottom() {
                  window.scrollTo(0, document.body.scrollHeight);
              }
              
              // Listen for console messages from main process
              ipcRenderer.on('console-message', (event, data) => {
                  const { message, type } = data;
                  addMessage(message, type);
              });
              
              function addMessage(message, type = 'stdout') {
                  const consoleEl = document.getElementById('console-window');
                  const timestamp = new Date().toLocaleTimeString();
                  const line = document.createElement('div');
                  line.className = \`console-line \${type}\`;
                  
                  // Clean message
                  const cleanMessage = message
                      .replace(/[^\\w\\s\\.\\-\\:\\(\\)\\[\\]\\/\\\\%]/g, '')
                      .replace(/\\b(amazing|awesome|great|excellent|fantastic|perfect|wow|cool|exciting|incredible)\\b/gi, '')
                      .replace(/\\s+/g, ' ')
                      .trim();
                  
                  line.innerHTML = \`<span class="console-timestamp">[\${timestamp}]</span> \${cleanMessage}\`;
                  
                  // Apply transaction enhancement
                  enhanceMessage(line);
                  
                  consoleEl.appendChild(line);
                  
                  // Auto-scroll
                  window.scrollTo(0, document.body.scrollHeight);
              }
              
              function enhanceMessage(lineElement) {
                  let content = lineElement.innerHTML;
                  
                  // Enhance transaction hashes
                  content = content.replace(/(0x[a-fA-F0-9]{40,})/g, '<span class="tx-hash">$1</span>');
                  
                  // Enhance amounts
                  content = content.replace(/(\\d+\\.\\d+)\\s*(ETH|VIRTUAL|TRUST|BRO|USDC|USDT)/g, '<span class="tx-amount">$1 $2</span>');
                  
                  // Enhance status indicators
                  content = content.replace(/\\b(Success|SUCCESSFUL|Confirmed|CONFIRMED)\\b/g, '<span class="tx-status-success">$1</span>');
                  content = content.replace(/\\b(Pending|PENDING|Processing)\\b/g, '<span class="tx-status-pending">$1</span>');
                  content = content.replace(/\\b(Failed|FAILED|Error|ERROR)\\b/g, '<span class="tx-status-failed">$1</span>');
                  
                  lineElement.innerHTML = content;
              }
              
              // Auto-scroll observer
              const observer = new MutationObserver(() => {
                  window.scrollTo(0, document.body.scrollHeight);
              });
              observer.observe(document.getElementById('console-window'), { childList: true });
          </script>
      </body>
      </html>
    `;
    
    consoleWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(consoleHtml));
    
    // Show window when ready
    consoleWindow.once('ready-to-show', () => {
      consoleWindow.show();
      consoleWindow.focus();
      // Notify renderer process that console window is ready to receive messages
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('console-window-ready');
      }
    });
    
    // Clean up reference when window is closed
    consoleWindow.on('closed', () => {
      consoleWindow = null;
      // Notify renderer process that console window was closed
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('console-window-closed');
      }
    });
    
    return { success: true, windowId: consoleWindow.id };
    
  } catch (error) {
    console.error('Error creating console window:', error);
    throw error;
  }
})

// IPC handler for sending messages to console window
ipcMain.handle('send-console-message', async (event, message, type = 'stdout') => {
  try {
    if (consoleWindow && !consoleWindow.isDestroyed()) {
      consoleWindow.webContents.send('console-message', { message, type });
      return { success: true };
    }
    return { success: false, error: 'Console window not open' };
  } catch (error) {
    console.error('Error sending console message:', error);
    throw error;
  }
})
// IPC handler for clearing console from detailed window
ipcMain.handle('clear-console-from-detailed', async (event) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clear-console-request');
      return { success: true };
    }
    return { success: false, error: 'Main window not available' };
  } catch (error) {
    console.error('Error clearing console from detailed window:', error);
    throw error;
  }
})

// Map bot types to npm scripts for the new autotrade structure
function getNpmScriptForBot(botType) {
  const scriptMap = {
    'buybot': 'buybot',
    'sellbot': 'sellbot',
    'sellbot-fsh': 'sellbot',  // FSH will be handled via arguments
    'farmbot': 'farmbot',
    'jeetbot': 'jeetbot',
    'snipebot': 'snipebot',
    'mmbot': 'mmbot',
    'transferbot': 'transferbot',
    'stargate': 'stargate',
    'contactbot': 'contactbot',
    'detect': 'detect',
    'detect-quick': 'detect:quick',
    'ticker-search': 'ticker:search',
    'ticker-fetch': 'ticker:fetch',
    'ticker-export': 'ticker:export',
    'ticker-new': 'ticker:new',
    'ticker-update': 'ticker:update',
    'ticker-runall': 'ticker',
    'sell-all': 'sellbot' // sell-all will use sellbot with fsh argument
  };
  
  return scriptMap[botType] || botType;
}

// Keep a global reference of the window object
let mainWindow;

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    autoHideMenuBar: true, // Hide menu bar for clean UI
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Keep false for compatibility with existing code
      enableRemoteModule: true
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
    
    // Make main window globally accessible for the auto-updater
    global.mainWindow = mainWindow;
    
    // Check for and clear any update flags from previous update attempts
    try {
      const updateFlagPath = path.join(app.getPath('userData'), 'update-in-progress');
      if (fs.existsSync(updateFlagPath)) {
        console.log('💾 Found update flag file, this appears to be a restart after update');
        // Delete the flag file
        fs.unlinkSync(updateFlagPath);
        console.log('💾 Cleared update flag file');
        
        // Set a flag to indicate this is a fresh restart after update
        // This will prevent showing update notifications immediately after update
        const recentUpdateFlagPath = path.join(app.getPath('userData'), 'recent-update');
        fs.writeFileSync(recentUpdateFlagPath, new Date().toISOString());
        console.log('💾 Created recent update flag to prevent immediate update checks');
      }
    } catch (err) {
      console.error('❌ Error checking update flag:', err);
    }
    
    // Initialize auto-updater now that window is ready
    try {
      const { initAutoUpdater } = require('./src/auto-updater.cjs');
      console.log('🔄 Initializing auto-updater from main.js...');
      initAutoUpdater(mainWindow);
      
      // Add keyboard shortcut for manual update check (Cmd+U on Mac, Ctrl+U on others)
      const { globalShortcut } = require('electron');
      const shortcut = process.platform === 'darwin' ? 'CommandOrControl+U' : 'Ctrl+U';
      
      globalShortcut.register(shortcut, () => {
        console.log('🔄 Manual update check triggered via keyboard shortcut');
        mainWindow.webContents.send('trigger-manual-update-check');
      });
      
      console.log(`🔄 Registered ${shortcut} for manual update check`);
    } catch (error) {
      console.error('❌ Failed to initialize auto-updater:', error);
    }
    
    // Focus the window
    if (process.platform === 'darwin') {
      app.dock.show();
    }
    mainWindow.focus();

    // Kick off automatic token ticker update on app startup (always enabled)
    try {
      console.log('🚀 Triggering automatic token update on startup...');
      runAutomaticTickerUpdate().catch(err => {
        console.error('❌ Automatic token update failed:', err);
      });
    } catch (e) {
      console.error('❌ Failed to start automatic token update:', e);
    }
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle window closed - COMPREHENSIVE CLEANUP from trace documentation
  mainWindow.on('closed', () => {
    console.log('🔍 [MAIN.JS] Main window closed - comprehensive cleanup sequence...');
    
    try {
      const { execSync } = require('child_process');
      const ourPid = process.pid;
      
      // 🎯 CRITICAL FIX: Close placeholder window from secureBootstrap.js
      // This is the root cause of lingering processes in EXE build
      try {
        // Access the placeholder window from global scope or require secureBootstrap
        if (global.placeholderWindow && !global.placeholderWindow.isDestroyed()) {
          console.log('🔧 [MAIN.JS] Closing placeholder window from secureBootstrap.js...');
          global.placeholderWindow.close();
          global.placeholderWindow = null;
          console.log('✅ [MAIN.JS] Placeholder window closed successfully');
        } else {
          console.log('ℹ️  [MAIN.JS] No placeholder window found or already destroyed');
        }
      } catch (error) {
        console.log('⚠️  [MAIN.JS] Error closing placeholder window:', error.message);
      }
      
      // Close console window if open
      if (consoleWindow && !consoleWindow.isDestroyed()) {
        console.log('🔧 [MAIN.JS] Closing console window...');
        consoleWindow.close();
        consoleWindow = null;
        console.log('✅ [MAIN.JS] Console window closed successfully');
      } else {
        console.log('ℹ️  [MAIN.JS] No console window to close');
      }
      
      // Kill tracked child processes
      console.log(`🔧 [MAIN.JS] Cleaning up ${childProcesses.length} tracked child processes...`);
      childProcesses.forEach(process => {
        try {
          if (!process.killed) {
            if (process.platform === 'win32') {
              try {
                execSync(`taskkill /pid ${process.pid} /t /f`, { stdio: 'ignore' });
                console.log(`✅ [MAIN.JS] Killed child process tree: ${process.pid}`);
              } catch (error) {
                console.log(`ℹ️  [MAIN.JS] Process ${process.pid} already terminated`);
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
          console.log(`ℹ️  [MAIN.JS] Error killing process ${process.pid}:`, error.message);
        }
      });
      
      // Clear the array
      childProcesses.length = 0;
      console.log('✅ [MAIN.JS] Child processes array cleared');
      
      // Kill any lingering processes
      if (process.platform === 'win32') {
        // 🎯 CRITICAL: Kill other TRUSTBOT.exe processes to prevent background lingering
        // This prevents the 3 background TRUSTBOT processes shown in Task Manager
        // Excludes current PID to avoid self-termination, safe for update installer
        try {
          console.log('🔧 [MAIN.JS] Killing other TRUSTBOT.exe processes...');
          execSync(`taskkill /f /im TRUSTBOT.exe /fi "PID ne ${ourPid}"`, { stdio: 'ignore' });
          console.log('✅ [MAIN.JS] Cleaned up other TRUSTBOT processes');
        } catch (error) {
          console.log('ℹ️  [MAIN.JS] No other TRUSTBOT processes found to clean up');
        }
        
        try {
          console.log('🔧 [MAIN.JS] Killing lingering node.exe processes...');
          execSync(`taskkill /f /im node.exe /fi "PID ne ${ourPid}"`, { stdio: 'ignore' });
          console.log('✅ [MAIN.JS] Cleaned up node processes');
        } catch (error) {
          console.log('ℹ️  [MAIN.JS] No node processes found to clean up');
        }
        
        try {
          console.log('🔧 [MAIN.JS] Killing lingering cmd.exe processes...');
          execSync(`taskkill /f /im cmd.exe`, { stdio: 'ignore' });
          console.log('✅ [MAIN.JS] Cleaned up cmd processes');
        } catch (error) {
          console.log('ℹ️  [MAIN.JS] No cmd processes found to clean up');
        }
      }
      
      console.log('🎉 [MAIN.JS] Window close cleanup completed');
    } catch (error) {
      console.error('❌ [MAIN.JS] Error during window close cleanup:', error.message);
    }
    
    // 🎯 FINAL STEP: Centralized TRUSTBOT cleanup
    performFinalTrustbotCleanup();
    
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

// Function to run automatic ticker update in background
async function runAutomaticTickerUpdate() {
  console.log('🚀 Starting automatic ticker update...');
  // Single-flight guard: prevent concurrent runs
  if (runAutomaticTickerUpdate.inProgress && runAutomaticTickerUpdate.currentPromise) {
    console.log('⏳ Ticker update already in progress, joining existing promise');
    return runAutomaticTickerUpdate.currentPromise;
  }
  
  // Different approach for packaged vs development
  if (app.isPackaged) {
    // In packaged app, spawn Electron as Node to run the ESM script reliably
    let scriptPath;
    
    // Check if we're in the app.asar context
    if (__dirname.includes('app.asar')) {
      // Use app.asar.unpacked path for ESM modules
      scriptPath = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'ticker-updateNew.mjs');
    } else {
      scriptPath = path.join(__dirname, 'ticker-updateNew.mjs');
    }
    
    console.log(`🔍 Running ticker update script at: ${scriptPath}`);
    console.log(`🔍 Current directory: ${__dirname}`);
    
    // Check if the file exists before trying to fork it
    if (!fs.existsSync(scriptPath)) {
      console.error(`❌ Error: ticker update script not found at ${scriptPath}`);
      // Try to find the script in alternative locations
      const possibleLocations = [
        path.join(process.resourcesPath, 'app.asar.unpacked', 'ticker-updateNew.mjs'),
        path.join(process.resourcesPath, 'ticker-updateNew.mjs'),
        path.join(app.getAppPath(), 'ticker-updateNew.mjs')
      ];
      
      for (const location of possibleLocations) {
        console.log(`🔍 Checking alternative location: ${location}`);
        if (fs.existsSync(location)) {
          scriptPath = location;
          console.log(`✅ Found ticker update script at: ${scriptPath}`);
          break;
        }
      }
      
      if (!fs.existsSync(scriptPath)) {
        console.error(`❌ Could not find ticker update script in any location`);
        return;
      }
    }
    
    // Use Electron binary as Node to execute ESM .mjs
    const updateProcess = spawn(process.execPath, [scriptPath], {
      cwd: app.getPath('userData'), // Write outputs (e.g., base.json) to userData
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });
    
    // Track the process for cleanup
    childProcesses.push(updateProcess);
    
    let output = '';
    let errorOutput = '';
    let newTokensCount = 0;
    
    // No IPC messages in spawn mode; rely on stdout parsing for progress if needed
    
    // Handle errors in the fork process
    updateProcess.on('error', (err) => {
      console.error(`❌ [Ticker Update] Failed to start process: ${err.message}`);
      errorOutput += `Failed to start process: ${err.message}\n`;
    });
    
    updateProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      console.log(`[Ticker Update] ${chunk.trim()}`);
    });
    
    updateProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      errorOutput += chunk;
      console.warn(`[Ticker Update Error] ${chunk.trim()}`);
    });
    
    // Wait for process to complete with timeout
    runAutomaticTickerUpdate.inProgress = true;
    runAutomaticTickerUpdate.currentPromise = new Promise((resolve, reject) => {
      const timeoutMs = 60 * 1000; // 60 seconds safety timeout
      const timer = setTimeout(() => {
        try {
          console.warn('⏰ [Ticker Update] Timeout reached, killing process');
          updateProcess.kill('SIGKILL');
        } catch {}
      }, timeoutMs);
      updateProcess.on('close', (code) => {
        // Remove from tracking array
        const index = childProcesses.indexOf(updateProcess);
        if (index > -1) {
          childProcesses.splice(index, 1);
        }
        
        console.log(`✅ Ticker update completed with exit code: ${code}`);
        
        if (code === 0) {
          console.log(`📊 Token database updated successfully - ${newTokensCount} new tokens`);
          
          // Send success notification to renderer if window exists
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ticker-update-completed', {
              success: true,
              message: `Token database updated - ${newTokensCount} new tokens added`
            });
          }
          clearTimeout(timer);
          runAutomaticTickerUpdate.inProgress = false;
          runAutomaticTickerUpdate.currentPromise = null;
          resolve();
        } else {
          console.error('❌ Ticker update failed with code:', code);
          
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ticker-update-completed', {
              success: false,
              message: 'Failed to update token database',
              error: errorOutput || 'Unknown error'
            });
          }
          clearTimeout(timer);
          runAutomaticTickerUpdate.inProgress = false;
          runAutomaticTickerUpdate.currentPromise = null;
          reject(new Error(`Ticker update failed with code ${code}`));
        }
      });
    });
    return runAutomaticTickerUpdate.currentPromise;
  } else {
    // In development, use npm script
    const updateProcess = spawn('npm', ['run', 'ticker:updateNew'], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });

    // Track the process for cleanup
    childProcesses.push(updateProcess);

    let output = '';
    let errorOutput = '';

    updateProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      // Log ticker update progress (can be seen in dev console)
      console.log(`[Ticker Update] ${chunk.trim()}`);
    });

    updateProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      errorOutput += chunk;
      console.warn(`[Ticker Update Error] ${chunk.trim()}`);
    });
    
    // Return a promise that resolves/rejects on process completion with timeout
    runAutomaticTickerUpdate.inProgress = true;
    runAutomaticTickerUpdate.currentPromise = new Promise((resolve, reject) => {
      const timeoutMs = 60 * 1000; // 60 seconds safety timeout
      const timer = setTimeout(() => {
        try {
          console.warn('⏰ [Ticker Update] Timeout reached, killing process');
          updateProcess.kill('SIGKILL');
        } catch {}
      }, timeoutMs);
      updateProcess.on('close', (code) => {
        // Remove from tracking array
        const index = childProcesses.indexOf(updateProcess);
        if (index > -1) {
          childProcesses.splice(index, 1);
        }

        console.log(`✅ Ticker update completed with exit code: ${code}`);
        
        if (code === 0) {
          console.log('📊 Token database updated successfully');
          
          // Send success notification to renderer if window exists
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ticker-update-completed', {
              success: true,
              message: 'Token database updated successfully',
              output: output
            });
          }
          clearTimeout(timer);
          runAutomaticTickerUpdate.inProgress = false;
          runAutomaticTickerUpdate.currentPromise = null;
          resolve();
        } else {
          console.error('❌ Ticker update failed with error output:', errorOutput);
          
          // Send error notification to renderer if window exists
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ticker-update-completed', {
              success: false,
              message: 'Failed to update token database',
              error: errorOutput
            });
          }
          clearTimeout(timer);
          runAutomaticTickerUpdate.inProgress = false;
          runAutomaticTickerUpdate.currentPromise = null;
          reject(new Error(`Ticker update failed with code ${code}`));
        }
      });

      // Handle process spawn errors in development mode
      updateProcess.on('error', (error) => {
        // Remove from tracking array
        const index = childProcesses.indexOf(updateProcess);
        if (index > -1) {
          childProcesses.splice(index, 1);
        }

        console.error('❌ Failed to start ticker update:', error.message);
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ticker-update-completed', {
            success: false,
            message: 'Failed to start token database update',
            error: error.message
          });
        }
        clearTimeout(timer);
        runAutomaticTickerUpdate.inProgress = false;
        runAutomaticTickerUpdate.currentPromise = null;
        reject(error);
      });
    });
    return runAutomaticTickerUpdate.currentPromise;
  }
}

// Function to run GenesisBid.js and find-pool.mjs BID sequentially after ticker update
function runGenesisBidAndFindPool() {
  // Skip GenesisBid and FindPool processes in packaged apps to avoid spawn ENOTDIR errors
  if (app.isPackaged) {
    console.log('⚠️ Skipping GenesisBid and FindPool processes in packaged app (node scripts not available)');
    return;
  }
  
  // Helper to run a node script with timeout and error handling
  function runNodeScript(script, args = [], label = '', timeoutMs = 3000) {
    return new Promise((resolve) => {
      const proc = spawn('node', [script, ...args], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });
      let output = '';
      let errorOutput = '';
      let finished = false;
      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          proc.kill('SIGKILL');
          console.warn(`[${label}] ❌ Timeout after ${timeoutMs / 1000}s, process killed.`);
          resolve({ success: false, output, error: errorOutput + `\nTimeout after ${timeoutMs / 1000}s` });
        }
      }, timeoutMs);
      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        console.log(`[${label}] ${chunk.trim()}`);
      });
      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        errorOutput += chunk;
        console.warn(`[${label} ERROR] ${chunk.trim()}`);
      });
      proc.on('close', (code) => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          if (code === 0) {
            console.log(`[${label}] ✅ Completed successfully.`);
            resolve({ success: true, output, error: errorOutput });
          } else {
            console.error(`[${label}] ❌ Exited with code ${code}`);
            resolve({ success: false, output, error: errorOutput + `\nExited with code ${code}` });
          }
        }
      });
      proc.on('error', (err) => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          console.error(`[${label}] ❌ Failed to start: ${err.message}`);
          resolve({ success: false, output, error: err.message });
        }
      });
    });
  }

  // Run GenesisBid.js, then find-pool.mjs BID
  runNodeScript('GenesisBid.js', [], 'GenesisBid')
    .then((result1) => {
      if (!result1.success) {
        console.warn('[GenesisBid] Skipped due to error or timeout.');
      }
      return runNodeScript('find-pool.mjs', ['BID'], 'FindPoolBID');
    })
    .then((result2) => {
      if (!result2.success) {
        console.warn('[FindPoolBID] Skipped due to error or timeout.');
      }
      // All done, continue GUI as normal
      console.log('GenesisBid and FindPoolBID sequence finished. GUI continues as normal.');
    });
}

// Initialize app when ready
app.whenReady().then(() => {
  // Initialize wallets database first
  initializeWalletsDB();
  
  createWindow();
  
  // Add IPC handlers for resource paths
  ipcMain.handle('is-packaged', () => {
    return app.isPackaged;
  });
  
  ipcMain.handle('get-resource-path', (event, filename) => {
    if (app.isPackaged) {
      // In packaged app, check extraResources first
      const extraResourcePath = path.join(process.resourcesPath, filename);
      if (fs.existsSync(extraResourcePath)) {
        return extraResourcePath;
      }
      
      // Then check app.asar.unpacked
      const unpackedPath = path.join(__dirname, filename);
      if (fs.existsSync(unpackedPath)) {
        return unpackedPath;
      }
      
      // Return the path even if it doesn't exist for logging purposes
      return extraResourcePath;
    } else {
      // In development, use the file from the project root
      return path.join(__dirname, filename);
    }
  });
  
  // Register token handlers
  registerTokenHandlers();
  console.log('✅ Token handlers registered');
  
  // Run automatic ticker update after app is ready (gated by env var)
  // Add a longer delay to ensure the app is fully initialized
  setTimeout(() => {
    console.log('🚀 Initiating automatic ticker update...');
    runAutomaticTickerUpdate().catch(err => {
      console.error('❌ Error running automatic ticker update:', err);
    });
    
    // Register protocol handler
    app.setAsDefaultProtocolClient('trustbot');
  }, 3000); // 3 second delay to ensure app is fully initialized

  // After ticker update, run GenesisBid.js and find-pool.mjs BID in sequence
  setTimeout(() => {
    runGenesisBidAndFindPool();
  }, 1000); // 1s delay to ensure ticker update process starts first
});

app.on('window-all-closed', () => {
  console.log('🔍 [MAIN.JS] window-all-closed event triggered');
  if (process.platform !== 'darwin') {
    console.log('🔍 [MAIN.JS] Platform is not darwin, proceeding with cleanup and quit...');
    
    // Force trigger our cleanup handlers before quitting
    const { execSync } = require('child_process');
    const ourPid = process.pid;
    
    // Close console window if open
    if (consoleWindow && !consoleWindow.isDestroyed()) {
      console.log('Closing console window...');
      consoleWindow.close();
      consoleWindow = null;
    }
    
    // Kill tracked child processes
    childProcesses.forEach(process => {
      try {
        if (!process.killed) {
          if (process.platform === 'win32') {
            try {
              execSync(`taskkill /pid ${process.pid} /t /f`, { stdio: 'ignore' });
              console.log(`Terminated process tree with root PID ${process.pid}`);
            } catch (err) {
              process.kill();
              console.log(`Fallback terminated child process with PID ${process.pid}`);
            }
          } else {
            process.kill();
            console.log(`Terminated child process with PID ${process.pid}`);
          }
        }
      } catch (error) {
        console.error(`Failed to kill process: ${error.message}`);
      }
    });
    
    // Clear the array
    childProcesses = [];
    
    // Additional cleanup for any remaining processes
    if (process.platform === 'win32') {
      try {
        console.log('Final cleanup of any remaining processes...');
        execSync(`taskkill /f /im node.exe /fi "PID ne ${ourPid}"`, { stdio: 'ignore' });
      } catch (error) {
        console.log('No additional processes found to terminate');
      }
    }
    
    console.log('Window close cleanup completed - quitting app');
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Load wallets from JSON database
const getWalletData = () => {
  try {
    const dbData = readWalletsDB();
    
    if (!dbData || !dbData.wallets) {
      return {
        success: true,
        wallets: [],
        message: 'No wallets configured. Please add wallets in settings.'
      };
    }
    
    // Filter enabled wallets with private keys
    const validWallets = dbData.wallets.filter(wallet => 
      wallet.enabled && wallet.privateKey && wallet.privateKey.trim() !== ''
    );
    
    if (validWallets.length === 0) {
      return {
        success: true,
        wallets: [],
        message: 'No valid wallets found. Please configure wallets in settings.'
      };
    }
    
    // Convert to format expected by the UI
    const wallets = validWallets.map((wallet, index) => ({
      index: index,
      id: wallet.id,
      name: wallet.name,
      address: wallet.address || getAddressFromPrivateKey(wallet.privateKey),
      enabled: wallet.enabled
    }));
    
    return {
      success: true,
      wallets: wallets,
      message: `Successfully loaded ${wallets.length} wallet${wallets.length !== 1 ? 's' : ''}`
    };
  } catch (error) {
    console.error('Error loading wallets:', error.message);
    return {
      success: false,
      error: error.message,
      wallets: [],
      message: 'Failed to load wallet configuration.'
    };
  }
};

// IPC handlers for wallet operations
ipcMain.handle('get-wallets', async (event) => {
  return getWalletData();
});

// Get all wallets for management
ipcMain.handle('get-all-wallets', async (event) => {
  try {
    const dbData = readWalletsDB();
    return {
      success: true,
      wallets: dbData ? dbData.wallets : [],
      config: dbData ? dbData.config : {}
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
    const dbData = readWalletsDB();
    if (!dbData) throw new Error('Failed to read database');
    
    // Validate private key
    const address = getAddressFromPrivateKey(walletData.privateKey);
    if (!address) {
      throw new Error('Invalid private key');
    }
    
    // Create a unique ID if not provided
    if (!walletData.id) {
      walletData.id = Date.now().toString();
    }
    
    // Get the master password from global state
    // This assumes the user has already logged in with their master password
    const masterPassword = global.masterPassword;
    // Ensure we have a master password
    if (!masterPassword) {
      throw new Error('Please enter your password first to encrypt wallet keys');
    }
    
    // Encrypt the private key using the master password
    console.log('Encrypting private key for wallet:', walletData.name);
    const encryptedKey = WalletEncryption.encryptPrivateKey(walletData.privateKey, masterPassword);
    
    // Update or add wallet data - WITHOUT storing plaintext private key
    const newWallet = {
      ...walletData,
      privateKey: undefined, // Don't store plaintext private key
      address: address,
      dateAdded: new Date().toISOString(),
      // Default to enabled if not specified
      enabled: walletData.enabled === false ? false : true,
      // Add the encrypted private key
      encryptedPrivateKey: encryptedKey
    };
    
    // Remove the private key completely from the object to avoid accidental storage
    delete newWallet.privateKey;
    
    // Add to the wallets array
    dbData.wallets.push(newWallet);
    
    // Save to storage (without plaintext keys)
    console.log('Saving wallet with encrypted private key only');
    const saveResult = writeWalletsDB(dbData);
    
    // PARALLEL ENCRYPTED STORAGE: Also save to secure encrypted storage if available
    // This is the legacy method that doesn't work, but keeping for compatibility
    let encryptedSaveResult = { success: false };
    try {
      if (global.secureAdapter && global.secureAdapter.masterPassword) {
        // The secureAdapter will encrypt the private key with the master password
        encryptedSaveResult = global.secureAdapter.saveWallet(newWallet);
        console.log(`Legacy encrypted wallet storage ${encryptedSaveResult.success ? 'successful' : 'failed'}`);
      }
    } catch (encryptError) {
      console.error('Error saving to encrypted storage:', encryptError);
      // Don't fail the operation if encrypted storage fails
    }
    
    if (saveResult) {
      // Emit wallet update event to all renderer processes
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('wallet-update', { 
          type: 'wallet-added', 
          wallet: newWallet 
        });
        console.log('📡 Emitted wallet-update event for new wallet:', newWallet.name);
      }
      
      return { 
        success: true, 
        wallet: newWallet,
        encryptedStorage: encryptedSaveResult.success 
      };
    } else {
      throw new Error('Failed to save wallet');
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// Update existing wallet
ipcMain.handle('update-wallet', async (event, walletData) => {
  try {
    const dbData = readWalletsDB();
    if (!dbData) throw new Error('Failed to read database');
    
    // Find the wallet by ID
    const walletIndex = dbData.wallets.findIndex(w => w.id === walletData.id);
    if (walletIndex === -1) {
      throw new Error(`Wallet with id ${walletData.id} not found`);
    }
    
    // If private key changed, validate it and re-encrypt
    let address = dbData.wallets[walletIndex].address;
    let encryptedPrivateKey = dbData.wallets[walletIndex].encryptedPrivateKey;
    
    if (walletData.privateKey && walletData.privateKey !== dbData.wallets[walletIndex].privateKey) {
      console.log('Private key changed, validating and re-encrypting...');
      address = getAddressFromPrivateKey(walletData.privateKey);
      if (!address) {
        throw new Error('Invalid private key');
      }
      
      // Get the master password from global state
      const masterPassword = global.masterPassword;
      // Ensure we have a master password
      if (!masterPassword) {
        throw new Error('Please enter your password first to encrypt wallet keys');
      }
      
      // Re-encrypt the new private key using the master password
      encryptedPrivateKey = WalletEncryption.encryptPrivateKey(walletData.privateKey, masterPassword);
      console.log('Private key re-encrypted successfully with master password');
    }
    
    // Update wallet data
    dbData.wallets[walletIndex] = {
      ...dbData.wallets[walletIndex],
      ...walletData,
      address: address,
      encryptedPrivateKey: encryptedPrivateKey,
      dateModified: new Date().toISOString()
    };
    
    // Save changes
    console.log('Saving updated wallet with both plaintext and encrypted private keys');
    const saveResult = writeWalletsDB(dbData);
    
    // Also update in secure storage if available (legacy method)
    let encryptedSaveResult = { success: false };
    try {
      if (global.secureAdapter && global.secureAdapter.masterPassword) {
        encryptedSaveResult = global.secureAdapter.updateWallet(
          walletData.id, 
          dbData.wallets[walletIndex]
        );
        console.log(`Legacy encrypted wallet update ${encryptedSaveResult.success ? 'successful' : 'failed'}`);
      }
    } catch (encryptError) {
      console.error('Error updating in encrypted storage:', encryptError);
      // Don't fail the operation if encrypted storage update fails
    }
    
    if (saveResult) {
      // Emit wallet update event to all renderer processes
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('wallet-update', { 
          type: 'wallet-updated', 
          wallet: dbData.wallets[walletIndex] 
        });
        console.log('📡 Emitted wallet-update event for updated wallet:', dbData.wallets[walletIndex].name);
      }
      
      return { 
        success: true, 
        wallet: dbData.wallets[walletIndex],
        encryptedStorage: encryptedSaveResult.success 
      };
    } else {
      throw new Error('Failed to save wallet');
    }
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
    const dbData = readWalletsDB();
    if (!dbData) throw new Error('Failed to read database');
    
    const walletIndex = dbData.wallets.findIndex(w => w.id === walletId);
    if (walletIndex === -1) {
      throw new Error('Wallet not found');
    }
    
    // Remove the wallet from plaintext storage
    dbData.wallets.splice(walletIndex, 1);
    
    // Save to plaintext storage (primary system)
    const saveResult = writeWalletsDB(dbData);
    
    // PARALLEL ENCRYPTED STORAGE: Also delete from secure encrypted storage if available
    let encryptedDeleteResult = { success: false };
    try {
      if (global.secureAdapter && global.secureAdapter.masterPassword) {
        // Delete the wallet from encrypted storage
        encryptedDeleteResult = global.secureAdapter.deleteWallet(walletId);
        console.log(`Encrypted wallet deletion ${encryptedDeleteResult.success ? 'successful' : 'failed'}`);
      }
    } catch (encryptError) {
      console.error('Error deleting from encrypted storage:', encryptError);
      // Don't fail the operation if encrypted storage deletion fails
    }
    
    if (saveResult) {
      // Emit wallet update event to all renderer processes
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('wallet-update', { 
          type: 'wallet-deleted', 
          walletId: walletId 
        });
        console.log('📡 Emitted wallet-update event for deleted wallet:', walletId);
      }
      
      return { 
        success: true,
        encryptedStorage: encryptedDeleteResult.success 
      };
    } else {
      throw new Error('Failed to save database');
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// Update config
ipcMain.handle('update-config', async (event, config) => {
  try {
    const dbData = readWalletsDB() || { wallets: [] };
    dbData.config = { ...dbData.config, ...config };
    
    if (writeWalletsDB(dbData)) {
      return { success: true };
    } else {
      throw new Error('Failed to save configuration');
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// Detect wallet address from private key
ipcMain.handle('detect-wallet-address', async (event, privateKey) => {
  try {
    const address = getAddressFromPrivateKey(privateKey);
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

// IPC handlers for bot operations
ipcMain.handle('run-bot', async (event, botType, args) => {
  try {
    // Use npm run commands for winbot bot structure
    const npmScript = getNpmScriptForBot(botType);
    
    // Load configuration from JSON database and inject as environment variables
    const dbData = readWalletsDB();
    const env = { ...process.env };
    
    if (dbData && dbData.config) {
      // Multi-provider RPC configuration
      env.RPC_URL = dbData.config.rpcUrl;
      env.RPC_URL_Q = dbData.config.rpcUrlQuickNode;
      env.RPC_URL_I = dbData.config.rpcUrlInfura;
      env.WS_URL = dbData.config.wsUrl;
      env.WS_URL_Q = dbData.config.wsUrlQuickNode;
      env.WS_URL_I = dbData.config.wsUrlInfura;
      env.CHAIN_ID = dbData.config.chainId?.toString();
      env.VIRTUAL_TOKEN_ADDRESS = dbData.config.virtualTokenAddress;
      env.GENESIS_CONTRACT = dbData.config.genesisContract;
      env.UNISWAP_ROUTER = dbData.config.uniswapRouter;
      env.POLL_INTERVAL_MS = dbData.config.pollIntervalMs?.toString();
      env.USE_WEBSOCKET_DETECTION = dbData.config.useWebSocketDetection?.toString();
      env.PARALLEL_DETECTION = dbData.config.parallelDetection?.toString();
      env.SLIPPAGE_BASIS_POINTS = dbData.config.slippageBasisPoints?.toString();
      
      // Stargate bridge configuration
      env.SOLANA_RPC_URL = dbData.config.solanaRpcUrl;
      env.SOLANA_VIRTUAL_TOKEN_MINT = dbData.config.solanaVirtualTokenMint;
      env.STARGATE_BASE_ROUTER = dbData.config.stargateBaseRouter;
      env.STARGATE_SOLANA_ROUTER = dbData.config.stargateSolanaRouter;
      env.LAYERZERO_SOLANA_ENDPOINT = dbData.config.layerzeroSolanaEndpoint;
      env.MIN_VIRTUAL_TRANSFER = dbData.config.minVirtualTransfer?.toString();
      env.MAX_VIRTUAL_TRANSFER = dbData.config.maxVirtualTransfer?.toString();
      env.TRANSFER_INTERVAL_SECONDS = dbData.config.transferIntervalSeconds?.toString();
    }
    

    
    // Add bridging configuration
    if (dbData && dbData.bridging) {
      env.SOLANA_SOURCE_PRIVATE_KEY = dbData.bridging.solanaSourcePrivateKey;
      env.BASE_SOURCE_PRIVATE_KEY = dbData.bridging.baseSourcePrivateKey;
      env.SOL_WALLET_1_ADDRESS = dbData.bridging.solWallet1Address;
    }

    // Add wallet private keys from database - ONLY the selected ones from args
    if (dbData && dbData.wallets) {
      // Get master password for decryption
      const masterPassword = global.masterPassword;
      if (!masterPassword) {
        console.error('No master password available for wallet decryption');
        throw new Error('Master password not available. Please enter your password first.');
      }
      
      // Validate wallets array structure to prevent errors when stopped early
      if (!Array.isArray(dbData.wallets)) {
        console.error('Wallet data is not an array');
        throw new Error('Error initializing wallets: Invalid wallet data structure');
      }
      
      // Extract wallet identifiers from args
      // UI may send wallet names, indices, or IDs directly as arguments
      console.log('Raw BuyBot arguments:', args);
      
      const selectedWalletIndices = [];
      const selectedWalletNames = [];
      
      args.forEach(arg => {
        // Check for direct wallet name/ID arguments
        // This handles when UI sends wallet names directly
        const walletByName = dbData.wallets.findIndex(w => w.name === arg || w.id === arg);
        if (walletByName !== -1) {
          console.log(`Found wallet by name/id: ${arg} at index ${walletByName}`);
          selectedWalletIndices.push(walletByName);
          selectedWalletNames.push(arg);
          return;
        }
        
        // Also check legacy B1, B2 format
        const match = arg.match(/^B(\d+)$/);
        if (match) {
          const walletIndex = parseInt(match[1]) - 1; // Convert B1 to index 0
          selectedWalletIndices.push(walletIndex);
          const walletName = dbData.wallets[walletIndex]?.name || `Wallet ${walletIndex+1}`;
          selectedWalletNames.push(walletName);
        }
      });
      
      console.log(`Selected wallet indices: ${selectedWalletIndices.join(', ')}`);
      console.log(`Selected wallet names: ${selectedWalletNames.join(', ')}`);
      
      // Special case: Check for WALLETTOKEN argument which should use all enabled wallets
      if (args.includes('WALLETTOKEN')) {
        console.log('WALLETTOKEN argument found - will use all enabled wallets');
        // Use all enabled wallets
        dbData.wallets.forEach((wallet, idx) => {
          if (wallet.enabled) {
            selectedWalletIndices.push(idx);
          }
        });
      }
      
      // If no wallets specified in args, throw error
      if (selectedWalletIndices.length === 0) {
        throw new Error('No wallets selected in the UI. Please select at least one wallet.');
      }
      
      // Track if we found any valid wallets
      let validWalletsFound = false;
      
      // Add debug information about environment variables before modification
      console.log('Environment variables for wallet keys BEFORE processing:');
      for (let i = 0; i < 10; i++) {
        if (env[`B${i+1}`]) {
          console.log(`  B${i+1}: [Present but value hidden]`);
        } else {
          console.log(`  B${i+1}: [Not set]`);
        }
      }
      
      // Only process the selected wallets
      selectedWalletIndices.forEach(walletIndex => {
        const wallet = dbData.wallets[walletIndex];
        if (!wallet) {
          console.error(`Wallet at index ${walletIndex} not found in database`);
          return;
        }
        
        if (wallet.enabled) {
          try {
            // Check if we have encrypted private key
            if (wallet.encryptedPrivateKey) {
              // Decrypt the wallet's private key
              const decryptedKey = WalletEncryption.decryptPrivateKey(wallet.encryptedPrivateKey, masterPassword);
              if (decryptedKey) {
                console.log(`Successfully decrypted wallet ${wallet.name || walletIndex+1} for bot execution`);
                env[`B${walletIndex + 1}`] = decryptedKey;
                validWalletsFound = true;
              } else {
                console.error(`Failed to decrypt wallet ${wallet.name || walletIndex+1}`);
              }
            } else if (wallet.privateKey) {
              // Fallback to plaintext key if available (legacy support)
              env[`B${walletIndex + 1}`] = wallet.privateKey;
              validWalletsFound = true;
            } else {
              console.warn(`Wallet ${wallet.name || walletIndex+1} missing private key skipping...`);
            }
          } catch (error) {
            console.error(`Error decrypting wallet ${wallet.name || walletIndex+1}:`, error.message);
          }
        } else {
          console.warn(`Wallet ${wallet.name || walletIndex+1} is disabled, skipping...`);
        }
      });
      
      if (!validWalletsFound) {
        throw new Error('No valid wallets found with decryptable private keys. Please check your wallet settings.');
      }
      
      // Add debug information about environment variables AFTER processing
      console.log('===== ENVIRONMENT VARIABLES FOR WALLET KEYS AFTER PROCESSING =====');
      let walletKeysFound = 0;
      for (let i = 0; i < 10; i++) {
        const envKey = `B${i+1}`;
        if (env[envKey] && env[envKey].length > 0) {
          const keyLength = env[envKey].length;
          const keyFirstChar = env[envKey].charAt(0);
          console.log(`  ${envKey}: [VALID PRIVATE KEY SET] - Length: ${keyLength}, First char: ${keyFirstChar}`);
          console.log(`      Key preview: ${env[envKey].substring(0, 6)}...${env[envKey].substring(keyLength-4)}`);
          walletKeysFound++;
        } else if (env[envKey] === '') {
          console.log(`  ${envKey}: [ERROR - EMPTY STRING]`);
        } else {
          console.log(`  ${envKey}: [Not set]`);
        }
      }
      console.log(`Total wallet private keys set in environment: ${walletKeysFound}`);
      
      // Add wallet key verification
      if (walletKeysFound === 0) {
        console.error('❌ CRITICAL ERROR: No wallet private keys were set in environment variables!');
        console.error('This will cause BuyBot to fail with "Cannot read properties of undefined"');
        console.error('Please check wallet decryption logic and try again.');
      } else {
        console.log(`✅ Successfully set ${walletKeysFound} wallet private keys in environment variables`);
      }
      
      // Make sure WALLETTOKEN_SELECTED is set to help wallet loader identify selected wallets
      if (selectedWalletIndices.length > 0) {
        env.WALLETTOKEN_SELECTED = selectedWalletIndices.join(',');
        console.log(`Set WALLETTOKEN_SELECTED environment variable to: ${env.WALLETTOKEN_SELECTED}`);
      } else if (args.includes('WALLETTOKEN')) {
        // Handle the special case where WALLETTOKEN is specified but no specific wallet indices
        // This tells the wallet loader to attempt to load all enabled wallets
        console.log('WALLETTOKEN argument found but no specific wallet indices selected');
        console.log('Setting WALLETTOKEN_ALL=true to signal loader to use all enabled wallets');
        env.WALLETTOKEN_ALL = 'true';
      }
    }

    return new Promise((resolve, reject) => {
      // Set the wallet database path for the bot process
      env.WALLETS_DB_PATH = WALLETS_DB_PATH;

      // Pass master password to BuyBot process for wallet decryption
      if (global.masterPassword) {
        console.log('🔑 Adding master password to environment for wallet decryption');
        env.MASTER_PASSWORD = global.masterPassword;
      } else {
        console.warn('⚠️ No master password available for wallet decryption');
      }
      
      // Use different execution methods based on environment
      // Use different execution methods based on environment
      if (app.isPackaged && botLauncher) {
        // Packaged build: Use botLauncher for direct .mjs execution
        console.log(`[MAIN] Using botLauncher for packaged execution: ${botType}`);
        botLauncher.launchBot(botType, args, env, { sender: event.sender })
          .then(() => {
            resolve({ success: true, output: `${botType} started successfully` });
          })
          .catch((error) => {
            reject(error);
          });
      } else {
        // Development mode: Use npm scripts
        console.log(`[MAIN] Using npm scripts for dev execution: ${botType}`);
        const botProcess = spawn('npm', ['run', npmScript, '--', ...args], {
          cwd: __dirname,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: env,
          shell: true
        });

        // Track the process for cleanup
        childProcesses.push(botProcess);

        let output = '';
        let errorOutput = '';

        botProcess.stdout.on('data', (data) => {
          const chunk = data.toString();
          output += chunk;
          // Send real-time output to renderer
          event.sender.send('bot-output', {
            type: 'stdout',
            data: chunk,
            botType: botType
          });
        });

        botProcess.stderr.on('data', (data) => {
          const chunk = data.toString();
          errorOutput += chunk;
          // Send real-time error output to renderer
          event.sender.send('bot-output', {
            type: 'stderr',
            data: chunk,
            botType: botType
          });
        });

        botProcess.on('close', (code) => {
          // Remove from tracking array
          const index = childProcesses.indexOf(botProcess);
          if (index > -1) {
            childProcesses.splice(index, 1);
          }

          event.sender.send('bot-finished', {
            botType: botType,
            code: code,
            output: output,
            error: errorOutput
          });
          
          if (code === 0) {
            resolve({ success: true, output: output });
          } else {
            reject(new Error(`Bot exited with code ${code}: ${errorOutput}`));
          }
        });

        botProcess.on('error', (error) => {
          // Remove from tracking array
          const index = childProcesses.indexOf(botProcess);
          if (index > -1) {
            childProcesses.splice(index, 1);
          }

          reject(error);
        });

        // Store process reference for potential termination
        event.sender.botProcess = botProcess;
      }
    });
  } catch (error) {
    throw error;
  }
});

// Multi-token bot handler for parallel execution
ipcMain.handle('run-bot-multi', async (event, botType, args, ticker) => {
  try {
    // Use npm run commands for winbot bot structure
    const npmScript = getNpmScriptForBot(botType);

    // Load configuration from JSON database and inject as environment variables
    const dbData = readWalletsDB();
    const env = { ...process.env };
    
    if (dbData && dbData.config) {
      // Multi-provider RPC configuration
      env.RPC_URL = dbData.config.rpcUrl;
      env.RPC_URL_Q = dbData.config.rpcUrlQuickNode;
      env.RPC_URL_I = dbData.config.rpcUrlInfura;
      env.WS_URL = dbData.config.wsUrl;
      env.WS_URL_Q = dbData.config.wsUrlQuickNode;
      env.WS_URL_I = dbData.config.wsUrlInfura;
      env.CHAIN_ID = dbData.config.chainId?.toString();
      env.VIRTUAL_TOKEN_ADDRESS = dbData.config.virtualTokenAddress;
      env.GENESIS_CONTRACT = dbData.config.genesisContract;
      env.UNISWAP_ROUTER = dbData.config.uniswapRouter;
      env.POLL_INTERVAL_MS = dbData.config.pollIntervalMs?.toString();
      env.USE_WEBSOCKET_DETECTION = dbData.config.useWebSocketDetection?.toString();
      env.PARALLEL_DETECTION = dbData.config.parallelDetection?.toString();
      env.SLIPPAGE_BASIS_POINTS = dbData.config.slippageBasisPoints?.toString();
      
      // Stargate bridge configuration
      env.SOLANA_RPC_URL = dbData.config.solanaRpcUrl;
      env.SOLANA_VIRTUAL_TOKEN_MINT = dbData.config.solanaVirtualTokenMint;
      env.STARGATE_BASE_ROUTER = dbData.config.stargateBaseRouter;
      env.STARGATE_SOLANA_ROUTER = dbData.config.stargateSolanaRouter;
      env.LAYERZERO_SOLANA_ENDPOINT = dbData.config.layerzeroSolanaEndpoint;
      env.MIN_VIRTUAL_TRANSFER = dbData.config.minVirtualTransfer?.toString();
      env.MAX_VIRTUAL_TRANSFER = dbData.config.maxVirtualTransfer?.toString();
      env.TRANSFER_INTERVAL_SECONDS = dbData.config.transferIntervalSeconds?.toString();
    }
    

    
    // Add bridging configuration
    if (dbData && dbData.bridging) {
      env.SOLANA_SOURCE_PRIVATE_KEY = dbData.bridging.solanaSourcePrivateKey;
      env.BASE_SOURCE_PRIVATE_KEY = dbData.bridging.baseSourcePrivateKey;
      env.SOL_WALLET_1_ADDRESS = dbData.bridging.solWallet1Address;
    }

    return new Promise((resolve, reject) => {
      // Set the wallet database path for the bot process
      env.WALLETS_DB_PATH = WALLETS_DB_PATH;
      
      // Use different execution methods based on environment
      if (app.isPackaged && botLauncher) {
        // Packaged build: Use botLauncher for direct .mjs execution
        console.log(`[MAIN] Using botLauncher for packaged multi-execution: ${botType}`);
        botLauncher.launchBot(botType, args, env, { sender: event.sender }, ticker)
          .then(() => {
            resolve({ success: true, output: `${botType} started successfully`, ticker: ticker });
          })
          .catch((error) => {
            reject(error);
          });
      } else {
        // Development mode: Use npm scripts
        console.log(`[MAIN] Using npm scripts for dev multi-execution: ${botType}`);
        const botProcess = spawn('npm', ['run', npmScript, '--', ...args], {
          cwd: __dirname,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: env,
          shell: true
        });

        // Track the process for cleanup
        childProcesses.push(botProcess);

        let output = '';
        let errorOutput = '';

        botProcess.stdout.on('data', (data) => {
          const chunk = data.toString();
          output += chunk;
          // Send real-time output to renderer with ticker info
          // Safely format ticker information to avoid errors when undefined
          const tickerPrefix = ticker && ticker.symbol ? `[${ticker.symbol}] ` : '';
          event.sender.send('bot-output', {
            type: 'stdout',
            data: `${tickerPrefix}${chunk}`,
            botType: botType,
            ticker: ticker
          });
        });

        botProcess.stderr.on('data', (data) => {
          const chunk = data.toString();
          errorOutput += chunk;
          // Send real-time error output to renderer with ticker info
          // Safely format ticker information to avoid errors when undefined
          const tickerPrefix = ticker && ticker.symbol ? `[${ticker.symbol}] ` : '';
          event.sender.send('bot-output', {
            type: 'stderr',
            data: `${tickerPrefix}${chunk}`,
            botType: botType,
            ticker: ticker
          });
        });

        botProcess.on('close', (code) => {
          // Remove from tracking array
          const index = childProcesses.indexOf(botProcess);
          if (index > -1) {
            childProcesses.splice(index, 1);
          }

          event.sender.send('bot-finished', {
            botType: botType,
            code: code,
            output: output,
            error: errorOutput,
            ticker: ticker
          });
          
          if (code === 0) {
            resolve({ success: true, output: output, ticker: ticker });
          } else {
            const symbol = ticker && ticker.symbol ? ticker.symbol : botType;
            reject(new Error(`Bot exited with code ${code}: ${errorOutput}`));
          }
        });

        botProcess.on('error', (error) => {
          // Remove from tracking array
          const index = childProcesses.indexOf(botProcess);
          if (index > -1) {
            childProcesses.splice(index, 1);
          }

          reject(error);
        });

        // Store process reference for potential termination (we'll need to track multiple processes)
        if (!event.sender.botProcesses) {
          event.sender.botProcesses = [];
        }
        event.sender.botProcesses.push({ process: botProcess, ticker: ticker });
      }
    });
  } catch (error) {
    throw error;
  }
});

// Handle bot termination
ipcMain.handle('stop-bot', async (event) => {
  try {
    let stoppedProcesses = 0;
    
    // Function to kill process tree on Windows
    const killProcessTree = (pid) => {
      if (process.platform === 'win32') {
        try {
          // Use taskkill to kill the entire process tree on Windows
          const { execSync } = require('child_process');
          execSync(`taskkill /pid ${pid} /t /f`, { stdio: 'ignore' });
          return true;
        } catch (error) {
          console.error(`Failed to kill process tree ${pid}:`, error.message);
          return false;
        }
      } else {
        // On Unix-like systems, use SIGTERM then SIGKILL
        try {
          process.kill(pid, 'SIGTERM');
          setTimeout(() => {
            try {
              process.kill(pid, 'SIGKILL');
            } catch (e) {
              // Process already dead
            }
          }, 2000);
          return true;
        } catch (error) {
          console.error(`Failed to kill process ${pid}:`, error.message);
          return false;
        }
      }
    };
    
    // Stop single bot process
    if (event.sender.botProcess) {
      console.log(`Stopping bot process ${event.sender.botProcess.pid}`);
      // Always use killProcessTree to ensure all child processes are terminated
      // This handles both npm wrapper processes and direct bot processes
      if (killProcessTree(event.sender.botProcess.pid)) {
        stoppedProcesses++;
        console.log(`✅ Bot process tree ${event.sender.botProcess.pid} killed successfully`);
      } else {
        console.error(`❌ Failed to kill process tree ${event.sender.botProcess.pid}`);
        // Fallback to direct kill
        try {
          event.sender.botProcess.kill('SIGKILL');
          console.log(`✅ Bot process ${event.sender.botProcess.pid} killed with direct SIGKILL`);
          stoppedProcesses++;
        } catch (error) {
          console.error(`❌ Failed to kill bot process ${event.sender.botProcess.pid}:`, error.message);
        }
      }
      event.sender.botProcess = null;
    }
    
    // Stop multiple bot processes
    if (event.sender.botProcesses && event.sender.botProcesses.length > 0) {
      for (const botInfo of event.sender.botProcesses) {
        try {
          // Check if ticker exists and has symbol property to avoid null reference errors
          const tickerInfo = botInfo.ticker && botInfo.ticker.symbol ? ` for ${botInfo.ticker.symbol}` : '';
          console.log(`Stopping bot process ${botInfo.process.pid}${tickerInfo}`);
          
          if (killProcessTree(botInfo.process.pid)) {
            stoppedProcesses++;
          }
        } catch (killError) {
          // Safe access to ticker info in error log
          const tickerInfo = botInfo.ticker && botInfo.ticker.symbol ? botInfo.ticker.symbol : 'unknown ticker';
          console.error(`Failed to kill process for ${tickerInfo}:`, killError);
        }
      }
      event.sender.botProcesses = [];
    }
    
    if (stoppedProcesses > 0) {
      console.log(`Successfully stopped ${stoppedProcesses} bot process(es)`);
      return { success: true, message: `${stoppedProcesses} bot process(es) stopped` };
    }
    
    return { success: false, message: 'No running bot to stop' };
  } catch (error) {
    console.error('Error stopping bot:', error);
    throw error;
  }
});

// Handle file operations
ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const fullPath = path.join(__dirname, filePath);
    const content = fs.readFileSync(fullPath, 'utf8');
    return { success: true, content: content };
  } catch (error) {
    throw error;
  }
});

ipcMain.handle('write-file', async (event, filePath, content) => {
  try {
    const fullPath = path.join(__dirname, filePath);
    fs.writeFileSync(fullPath, content, 'utf8');
    return { success: true, message: 'File saved successfully' };
  } catch (error) {
    throw error;
  }
});

// Handle wallet balance checking
ipcMain.handle('check-balances', async (event) => {
  try {
    const balanceCheckPath = path.join(__dirname, 'balance-checker.mjs');
    
    // Load configuration from JSON database and inject as environment variables
    const dbData = readWalletsDB();
    const env = { ...process.env };
    
    if (dbData && dbData.config) {
      env.RPC_URL = dbData.config.rpcUrl;
      env.CHAIN_ID = dbData.config.chainId?.toString();
      env.VIRTUAL_TOKEN_ADDRESS = dbData.config.virtualTokenAddress;
    }
    
    // Add wallet private keys from database
    if (dbData && dbData.wallets) {
      dbData.wallets.forEach((wallet, index) => {
        if (wallet.enabled && wallet.privateKey) {
          env[`B${index + 1}`] = wallet.privateKey;
        }
      });
    }
    
    return new Promise((resolve, reject) => {
      // Use Electron's embedded Node.js for packaged app compatibility
      const nodeCommand = app.isPackaged ? process.execPath : 'node';
      const process = spawn(nodeCommand, [balanceCheckPath], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: env
      });

      // Track the process for cleanup
      childProcesses.push(process);

      let output = '';
      let errorOutput = '';

      process.stdout.on('data', (data) => {
        output += data.toString();
      });

      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        // Remove from tracking array
        const index = childProcesses.indexOf(process);
        if (index > -1) {
          childProcesses.splice(index, 1);
        }

        if (code === 0) {
          try {
            const balances = JSON.parse(output);
            resolve({ success: true, balances: balances });
          } catch (parseError) {
            resolve({ success: true, output: output });
          }
        } else {
          reject(new Error(`Balance check failed: ${errorOutput}`));
        }
      });

      process.on('error', (error) => {
        // Remove from tracking array
        const index = childProcesses.indexOf(process);
        if (index > -1) {
          childProcesses.splice(index, 1);
        }

        reject(error);
      });
    });
  } catch (error) {
    throw error;
  }
});

// Handle opening external URLs
ipcMain.handle('open-external', async (event, url) => {
  await shell.openExternal(url);
  return { success: true };
});

// Handle showing message boxes
ipcMain.handle('show-message', async (event, options) => {
  const result = await dialog.showMessageBox(mainWindow, options);
  return result;
});

// Handle opening file dialogs
ipcMain.handle('show-open-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

// Handle environment configuration (now using JSON database)
ipcMain.handle('get-env-config', async (event) => {
  try {
    const dbData = readWalletsDB();
    if (dbData && dbData.config) {
      return { success: true, config: dbData.config };
    }
    
    // Return default config if none exists
    const defaultConfig = {
      rpcUrl: "https://base-mainnet.g.alchemy.com/v2/your-api-key-here",
      chainId: 8453,
      virtualTokenAddress: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b"
    };
    
    return { success: true, config: defaultConfig };
  } catch (error) {
    throw error;
  }
});

// Get App Version Handler
ipcMain.handle('get-app-version', async (event) => {
  try {
    // Read package.json directly from filesystem to avoid Node.js caching
    const fs = require('fs');
    const path = require('path');
    const packagePath = path.join(__dirname, 'package.json');
    const packageData = fs.readFileSync(packagePath, 'utf8');
    const packageJson = JSON.parse(packageData);
    return packageJson.version;
  } catch (error) {
    console.error('Failed to get app version:', error);
    return '1.2.8'; // Updated fallback version
  }
});

// Gas Price IPC Handler
ipcMain.handle('get-current-gas-price', async (event) => {
  try {
    console.log('🔍 [MAIN-GAS-DEBUG] UI requested gas price data');
    
    // Import gas price service dynamically
    const { gasPriceService } = await import('./src/providers/gasPriceService.js');
    console.log('🔍 [MAIN-GAS-DEBUG] Gas price service imported successfully');
    
    // Get current gas price breakdown
    const gasData = await gasPriceService.getGasPriceBreakdown();
    console.log('🔍 [MAIN-GAS-DEBUG] Gas data retrieved:', gasData ? 'SUCCESS' : 'FAILED');
    
    if (gasData) {
      console.log('🔍 [MAIN-GAS-DEBUG] Gas price:', gasData.gasPrice || 'MISSING');
      console.log('🔍 [MAIN-GAS-DEBUG] Source:', gasData.source || 'MISSING');
      console.log('🔍 [MAIN-GAS-DEBUG] Is fallback?', gasData.source === 'fallback' ? 'YES' : 'NO');
    }
    
    return {
      success: true,
      data: gasData
    };
  } catch (error) {
    console.error('❌ [MAIN-GAS-DEBUG] Error getting gas price:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('save-env-config', async (event, config) => {
  try {
    const dbData = readWalletsDB() || { wallets: [] };
    dbData.config = { ...dbData.config, ...config };
    
    if (writeWalletsDB(dbData)) {
      return { success: true, message: 'Configuration saved successfully' };
    } else {
      throw new Error('Failed to save configuration');
    }
  } catch (error) {
    throw error;
  }
});

// Handle saving complete wallets.json data (for startup RPC migration)
ipcMain.handle('saveWalletsConfig', async (event, walletsData) => {
  try {
    console.log('💾 MAIN: Saving complete wallets.json configuration...');
    
    if (writeWalletsDB(walletsData)) {
      console.log('✅ MAIN: wallets.json saved successfully');
      return { success: true, message: 'Wallets configuration saved successfully' };
    } else {
      throw new Error('Failed to save wallets configuration');
    }
  } catch (error) {
    console.error('❌ MAIN: Error saving wallets configuration:', error);
    throw error;
  }
});

// Handle getting wallets configuration for header balance display
ipcMain.handle('get-wallets-config', async (event) => {
  try {
    const walletsData = readWalletsDB();
    if (!walletsData) {
      throw new Error('Failed to read wallets configuration');
    }
    return walletsData;
  } catch (error) {
    console.error('❌ MAIN: Error getting wallets configuration:', error);
    throw error;
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

// COMPREHENSIVE WINDOW-ALL-CLOSED HANDLER - Ported from old branch
app.on('window-all-closed', () => {
  console.log('🔍 [MAIN.JS] window-all-closed event triggered');
  if (process.platform !== 'darwin') {
    console.log('🔍 [MAIN.JS] Platform is not darwin, proceeding with cleanup and quit...');
    
    // Force trigger our cleanup handlers before quitting
    try {
      const { execSync } = require('child_process');
      const ourPid = process.pid;
      
      // Close console window if open
      if (consoleWindow && !consoleWindow.isDestroyed()) {
        console.log('🔧 [MAIN.JS] Closing console window...');
        consoleWindow.close();
        consoleWindow = null;
        console.log('✅ [MAIN.JS] Console window closed successfully');
      } else {
        console.log('ℹ️  [MAIN.JS] No console window to close');
      }
      
      // Kill tracked child processes
      console.log(`🔧 [MAIN.JS] Cleaning up ${childProcesses.length} child processes...`);
      childProcesses.forEach(process => {
        try {
          if (!process.killed) {
            if (process.platform === 'win32') {
              try {
                execSync(`taskkill /pid ${process.pid} /t /f`, { stdio: 'ignore' });
                console.log(`✅ [MAIN.JS] Terminated process tree with root PID ${process.pid}`);
              } catch (err) {
                process.kill();
                console.log(`✅ [MAIN.JS] Fallback terminated child process with PID ${process.pid}`);
              }
            } else {
              process.kill();
              console.log(`✅ [MAIN.JS] Terminated child process with PID ${process.pid}`);
            }
          }
        } catch (error) {
          console.error(`❌ [MAIN.JS] Failed to kill process: ${error.message}`);
        }
      });
      
      // Clear the array
      childProcesses.length = 0;
      
      // Additional cleanup for any remaining processes
      if (process.platform === 'win32') {
        try {
          console.log('🔧 [MAIN.JS] Final cleanup of any remaining processes...');
          execSync(`taskkill /f /im node.exe /fi "PID ne ${ourPid}"`, { stdio: 'ignore' });
          console.log('✅ [MAIN.JS] Additional node processes cleaned up');
        } catch (error) {
          console.log('ℹ️  [MAIN.JS] No additional processes found to terminate');
        }
      }
      
      console.log('🎉 [MAIN.JS] Window close cleanup completed - quitting app');
    } catch (error) {
      console.error('❌ [MAIN.JS] Error during window-all-closed cleanup:', error.message);
    }
    
    app.quit();
  }
});

// Export variables for access from secureBootstrap.js
module.exports = {
  childProcesses,
  consoleWindow,
  performFinalTrustbotCleanup
};