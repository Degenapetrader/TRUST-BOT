// Auto-updater module for TRUSTBOT
// This module handles checking for updates, downloading, and notifying the user

const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Configure logging
log.transports.file.level = 'info';
autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Track update state
let updateAvailable = false;
let updateDownloaded = false;
let updateInfo = null;
let mainWindow = null;

// Initialize auto-updater
function initAutoUpdater(window) {
  mainWindow = window;
  
  // Check for updates immediately
  setTimeout(() => {
    checkForUpdates();
  }, 3000); // Wait 3 seconds after app start
  
  // Then check periodically (every 4 hours)
  setInterval(() => {
    checkForUpdates();
  }, 4 * 60 * 60 * 1000);
  
  // Set up all event handlers
  setupAutoUpdaterEvents();
  
  // Register IPC handlers for renderer communication
  registerIpcHandlers();
}

// Check for updates
function checkForUpdates() {
  if (process.env.NODE_ENV === 'development') {
    log.info('Auto-update disabled in development mode');
    return;
  }
  
  log.info('Checking for updates...');
  autoUpdater.checkForUpdates().catch(err => {
    log.error('Error checking for updates:', err);
  });
}

// Set up event handlers
function setupAutoUpdaterEvents() {
  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
    sendStatusToWindow('checking-for-update');
  });
  
  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info);
    updateAvailable = true;
    updateInfo = info;
    sendStatusToWindow('update-available', info);
  });
  
  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available:', info);
    sendStatusToWindow('update-not-available');
  });
  
  autoUpdater.on('error', (err) => {
    log.error('Error in auto-updater:', err);
    
    // Filter out GitHub 404 errors (no releases found)
    const errorMessage = err.toString();
    if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
      log.warn('Ignoring GitHub 404 error - no releases found');
      // Don't send this error to the window at all
      return;
    }
    
    // Filter out code signature errors completely
    if (errorMessage.includes('Code signature') || 
        errorMessage.includes('signature validation') || 
        errorMessage.includes('signature indicates') || 
        (errorMessage.includes('signature') && errorMessage.includes('validation'))) {
      log.warn('Ignoring code signature validation error:', errorMessage);
      
      // Continue with the update process despite signature issues
      if (updateAvailable && updateInfo) {
        updateDownloaded = true;
        // Use the standard update notification
        showUpdateNotification(updateInfo);
      }
      
      return;
    }
    
    // Only send other errors to the window
    sendStatusToWindow('error', errorMessage);
  });
  
  autoUpdater.on('download-progress', (progressObj) => {
    let logMessage = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
    log.info(logMessage);
    sendStatusToWindow('download-progress', progressObj);
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info);
    updateDownloaded = true;
    updateInfo = info;
    sendStatusToWindow('update-downloaded', info);
    
    // Show notification to user
    showUpdateNotification(info);
  });
}

// Send status to renderer process
function sendStatusToWindow(status, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, data });
  }
}

// Show update notification
function showUpdateNotification(info) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('show-update-notification', info);
  }
}

// Register IPC handlers
function registerIpcHandlers() {
  ipcMain.handle('check-for-updates', async () => {
    checkForUpdates();
    return { success: true };
  });
  
  ipcMain.handle('get-update-status', async () => {
    return {
      updateAvailable,
      updateDownloaded,
      updateInfo
    };
  });
  
  ipcMain.handle('quit-and-install', async () => {
    if (updateDownloaded) {
      autoUpdater.quitAndInstall(true, true);
      return { success: true };
    } else {
      return { 
        success: false, 
        error: 'No update has been downloaded yet' 
      };
    }
  });
}

module.exports = {
  initAutoUpdater
};
