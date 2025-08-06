// Auto-updater module for TRUSTBOT
// This module handles checking for updates, downloading, and notifying the user

const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Configure logging
log.transports.file.level = 'info';
autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true; // Enable auto-install on quit for reliable updates

// Configure update server explicitly for GitHub releases
if (app.isPackaged) {
  // Use the built-in GitHub provider configuration
  // This should match your package.json build.publish settings
  console.log('🔧 Configuring GitHub update feed');
  console.log('  - Owner: Degenapetrader');
  console.log('  - Repo: TRUST-BOT');
  console.log('  - Current version:', app.getVersion());
}

// Configure update behavior
autoUpdater.allowDowngrade = true; // Match app-update.yml setting for unsigned builds
autoUpdater.allowPrerelease = false;
autoUpdater.forceDevUpdateConfig = false;

// Windows-specific configuration
if (process.platform === 'win32') {
  // Disable signature verification on Windows for unsigned builds
  process.env.ELECTRON_IS_DEV = '0'; // Ensure we're not in dev mode
  autoUpdater.disableWebInstaller = false;
  autoUpdater.allowDowngrade = true; // Allow downgrades on Windows to handle signing issues
  // Removed autoDownload = false to prevent conflicts with global setting
}

// Track update state
let updateAvailable = false;
let updateDownloaded = false;
let updateDownloading = false; // Track if download is in progress
let updateInfo = null;
let mainWindow = null;

// Version comparison utility function
function compareVersions(version1, version2) {
  const v1parts = version1.split('.').map(Number);
  const v2parts = version2.split('.').map(Number);
  
  // Pad arrays to same length
  const maxLength = Math.max(v1parts.length, v2parts.length);
  while (v1parts.length < maxLength) v1parts.push(0);
  while (v2parts.length < maxLength) v2parts.push(0);
  
  for (let i = 0; i < maxLength; i++) {
    if (v1parts[i] > v2parts[i]) return 1;
    if (v1parts[i] < v2parts[i]) return -1;
  }
  
  return 0; // versions are equal
}

// Initialize auto-updater
function initAutoUpdater(window) {
  console.log('🔄 Initializing auto-updater...');
  log.info('Initializing auto-updater with window:', !!window);
  
  mainWindow = window;
  
  // Reset update state on initialization
  updateAvailable = false;
  updateDownloaded = false;
  updateDownloading = false;
  updateInfo = null;
  
  const currentVersion = app.getVersion();
  console.log(`📊 App initialized with version: ${currentVersion}`);
  log.info(`App initialized with version: ${currentVersion}`);
  
  // Check if we just completed an update by comparing with stored version
  try {
    const fs = require('fs');
    const path = require('path');
    const userDataPath = app.getPath('userData');
    const lastVersionPath = path.join(userDataPath, 'last-version');
    const updateFlagPath = path.join(userDataPath, 'update-installed');
    
    let lastVersion = null;
    if (fs.existsSync(lastVersionPath)) {
      lastVersion = fs.readFileSync(lastVersionPath, 'utf8').trim();
    }
    
    // Check if we have an update-installed flag, indicating a successful update installation
    let updateInstalled = false;
    if (fs.existsSync(updateFlagPath)) {
      updateInstalled = true;
      // Remove the flag file as we're processing it now
      fs.unlinkSync(updateFlagPath);
    }
    
    if (updateInstalled || !lastVersion) {
      // Only write the current version after a successful update or first run
      fs.writeFileSync(lastVersionPath, currentVersion);
    }
    
    if (lastVersion && lastVersion !== currentVersion) {
      console.log(`🎉 Update completed! Previous: ${lastVersion}, Current: ${currentVersion}`);
      log.info(`Update completed! Previous: ${lastVersion}, Current: ${currentVersion}`);
      
      // Send update completion event to renderer
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-completed', {
            previousVersion: lastVersion,
            currentVersion: currentVersion
          });
        }
      }, 2000);
    } else if (lastVersion) {
      console.log(`🔄 Same version as last run: ${currentVersion}`);
    } else {
      console.log(`🆕 First run or version tracking not available`);
    }
  } catch (err) {
    console.error('❌ Error checking version history:', err);
  }
  
  // Set up event handlers first
  setupAutoUpdaterEvents();
  registerIpcHandlers();
  
  // Check for updates immediately
  setTimeout(() => {
    checkForUpdates();
  }, 3000);
  
  // Then check periodically
  setInterval(() => {
    console.log('🔍 Starting periodic update check...');
    checkForUpdates();
  }, 4 * 60 * 60 * 1000);
  
  console.log('✅ Auto-updater initialized successfully');
}

// Check for updates
function checkForUpdates() {
  if (process.env.NODE_ENV === 'development') {
    console.log('⚠️ Auto-update disabled in development mode');
    log.info('Auto-update disabled in development mode');
    return;
  }
  
  // Check if we recently updated (within the last 2 minutes) - reduced from 10 minutes
  try {
    const fs = require('fs');
    const path = require('path');
    const recentUpdateFlagPath = path.join(app.getPath('userData'), 'recent-update');
    
    console.log(`🔍 Checking for recent update flag at: ${recentUpdateFlagPath}`);
    
    if (fs.existsSync(recentUpdateFlagPath)) {
      const updateTime = new Date(fs.readFileSync(recentUpdateFlagPath, 'utf8'));
      const now = new Date();
      const timeDiff = now - updateTime;
      const minutesSinceUpdate = timeDiff / (1000 * 60);
      
      console.log(`🕰️ Found recent update flag from ${Math.round(minutesSinceUpdate)} minutes ago`);
      
      if (minutesSinceUpdate < 2) {
        console.log(`⏰ Skipping update check - app was updated ${Math.round(minutesSinceUpdate)} minutes ago`);
        log.info(`Skipping update check - app was updated ${Math.round(minutesSinceUpdate)} minutes ago`);
        return;
      } else {
        // Remove the flag if it's been more than 2 minutes
        fs.unlinkSync(recentUpdateFlagPath);
        console.log('💾 Removed expired recent update flag');
      }
    } else {
      console.log('🔍 No recent update flag found, proceeding with update check');
    }
  } catch (err) {
    console.error('❌ Error checking recent update flag:', err);
  }
  
  // Get current app version
  const currentVersion = app.getVersion();
  console.log(`🔍 Checking for updates... Current version: ${currentVersion}`);
  log.info(`Checking for updates... Current version: ${currentVersion}`);
  
  autoUpdater.checkForUpdates().then(result => {
    console.log('✅ Update check completed:', result);
    log.info('Update check completed:', result);
    
    if (result && result.updateInfo) {
      const remoteVersion = result.updateInfo.version;
      console.log(`📊 Version comparison: Current=${currentVersion}, Remote=${remoteVersion}`);
      log.info(`Version comparison: Current=${currentVersion}, Remote=${remoteVersion}`);
    }
  }).catch(err => {
    console.error('❌ Error checking for updates:', err);
    log.error('Error checking for updates:', err);
  });
}

// Set up event handlers
function setupAutoUpdaterEvents() {
  // Add explicit handler for before-quit-for-update event
  app.on('before-quit-for-update', () => {
    console.log('🔄 before-quit-for-update event received');
    log.info('before-quit-for-update event received');
    
    try {
      // Create update flag file to confirm update process has started
      const fs = require('fs');
      const path = require('path');
      const userDataPath = app.getPath('userData');
      const updateFlagPath = path.join(userDataPath, 'update-installed');
      fs.writeFileSync(updateFlagPath, new Date().toISOString());
      console.log('📝 Update flag created at:', updateFlagPath);
    } catch (err) {
      console.error('❌ Error creating update flag:', err);
      log.error('Error creating update flag:', err);
    }
  });

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
    sendStatusToWindow('checking-for-update');
  });
  
  autoUpdater.on('update-available', (info) => {
    const currentVersion = app.getVersion();
    const remoteVersion = info.version;
    
    console.log(`🆕 Update available event - Current: ${currentVersion}, Remote: ${remoteVersion}`);
    log.info(`Update available event - Current: ${currentVersion}, Remote: ${remoteVersion}`);
    
    // Compare versions to ensure we don't show updates for the same or older versions
    if (compareVersions(remoteVersion, currentVersion) > 0) {
      console.log('✅ Remote version is newer, proceeding with update notification');
      log.info('Remote version is newer, proceeding with update notification');
      
      updateAvailable = true;
      updateInfo = info;
      
      // Start background download immediately on all platforms
      console.log('🔄 Starting background download for all platforms');
      
      // Don't show notification yet - wait for download to complete
      if (!updateDownloading && !updateDownloaded) {
        console.log('📥 Initiating background download...');
        updateDownloading = true;
        
        // Send status that we're downloading in background
        sendStatusToWindow('downloading-in-background', {
          version: info.version,
          message: 'Downloading update in background...'
        });
        
        autoUpdater.downloadUpdate().catch(err => {
          console.error('❌ Background download failed:', err);
          updateDownloading = false;
          // Show error notification
          sendStatusToWindow('download-error', {
            error: err.message,
            version: info.version
          });
        });
      } else if (updateDownloaded) {
        // If already downloaded, show install notification immediately
        console.log('✅ Update already downloaded, showing install notification');
        sendStatusToWindow('ready-to-install', info);
        showUpdateNotification(info);
      }
    } else {
      console.log('⚠️ Remote version is not newer, ignoring update notification');
      log.info('Remote version is not newer, ignoring update notification');
      
      // Reset update state
      updateAvailable = false;
      updateDownloaded = false;
      updateInfo = null;
    }
  });
  
  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available:', info);
    sendStatusToWindow('update-not-available');
  });
  
  autoUpdater.on('error', (err) => {
    console.error('❌ Auto-updater error:', err);
    log.error('Error in auto-updater:', err);
    
    const errorMessage = err.toString();
    
    // Filter out GitHub 404 errors (no releases found)
    if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
      console.warn('⚠️ Ignoring GitHub 404 error - no releases found');
      log.warn('Ignoring GitHub 404 error - no releases found');
      return;
    }
    
    // Handle Windows code signing errors more gracefully
    if (process.platform === 'win32' && (
        errorMessage.includes('not signed') ||
        errorMessage.includes('SignerCertificate') ||
        errorMessage.includes('execution policy') ||
        errorMessage.includes('digitally signed') ||
        errorMessage.includes('not digitally signed') ||
        errorMessage.includes('cannot run this script') ||
        errorMessage.includes('publisherNames') ||
        errorMessage.includes('TRUST Me Bros') ||
        errorMessage.includes('StatusMessage') ||
        errorMessage.includes('Execution_Policies') ||
        errorMessage.includes('microsoft.com/fwlink')
    )) {
      console.warn('⚠️ Windows code signing issue detected, bypassing error and continuing update');
      log.warn('Windows code signing issue detected (bypassed):', errorMessage);
      
      // Log the signing error but don't falsely mark as downloaded
      console.log('⚠️ Windows signing error detected, but not marking as downloaded without actual file');
      // Let the actual download events handle the state properly
      updateDownloading = false; // Reset downloading state only
      return;
    }
    
    // Filter out ALL signature-related errors completely
    if (errorMessage.includes('Code signature') || 
        errorMessage.includes('signature validation') || 
        errorMessage.includes('signature indicates') || 
        errorMessage.includes('SignerCertificate') ||
        errorMessage.includes('TimeStamperCertificate') ||
        errorMessage.includes('Status') ||
        (errorMessage.includes('signature') && errorMessage.includes('validation')) ||
        (errorMessage.includes('signed') && errorMessage.includes('application'))) {
      console.warn('⚠️ Ignoring signature-related error completely:', errorMessage);
      log.warn('Ignoring signature-related error (bypassed):', errorMessage);
      
      // Log signature error but don't falsely mark as downloaded
      console.log('⚠️ Signature error detected, but not marking as downloaded without actual file');
      // Let the actual download events handle the state properly
      updateDownloading = false; // Reset downloading state only
      
      return;
    }
    
    // Final comprehensive Windows signing error check before showing any error
    if (process.platform === 'win32' && (
        errorMessage.includes('Failed to download update') ||
        errorMessage.includes('New version') ||
        errorMessage.includes('not signed by the application owner') ||
        errorMessage.includes('publisherNames') ||
        errorMessage.includes('raw info') ||
        errorMessage.includes('SignerCertificate') ||
        errorMessage.includes('TimeStamperCertificate') ||
        errorMessage.includes('StatusMessage') ||
        errorMessage.includes('not digitally signed') ||
        errorMessage.includes('cannot run this script') ||
        errorMessage.includes('execution policy') ||
        errorMessage.includes('Execution_Policies') ||
        errorMessage.includes('microsoft.com/fwlink') ||
        errorMessage.includes('TRUST Me Bros') ||
        errorMessage.includes('temp-TRUSTBOT-Setup') ||
        errorMessage.includes('.exe') ||
        errorMessage.includes('1.2.2.exe') ||
        errorMessage.includes('TRUSTBOT-Setup-') ||
        errorMessage.includes('application owner') ||
        errorMessage.includes('digitally signed') ||
        errorMessage.includes('current system') ||
        errorMessage.includes('about_Execution_Policies') ||
        errorMessage.includes('sha512 checksum mismatch') ||
        errorMessage.includes('checksum') ||
        (errorMessage.includes('Status') && errorMessage.includes('2')) ||
        (errorMessage.includes('version') && errorMessage.includes('signed'))
    )) {
      console.warn('⚠️ Final Windows signing error filter - bypassing error completely');
      log.warn('Windows signing error bypassed at final stage:', errorMessage);
      
      // Log final signing error but don't falsely mark as downloaded
      console.log('⚠️ Final Windows signing error detected, but not marking as downloaded without actual file');
      // Let the actual download events handle the state properly
      updateDownloading = false; // Reset downloading state only
      return;
    }
    
    // Show other errors for debugging (non-Windows signing errors only)
    console.error('❌ Unfiltered auto-updater error:', errorMessage);
    
    // Reset download state on error
    updateDownloading = false;
    updateDownloaded = false;
    
    sendStatusToWindow('error', errorMessage);
  });
  
  autoUpdater.on('download-progress', (progressObj) => {
    updateDownloading = true; // Mark as downloading
    let logMessage = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
    log.info(logMessage);
    
    // Add more detailed logging for Windows
    if (process.platform === 'win32') {
      console.log(`💻 Windows download progress: ${progressObj.percent.toFixed(2)}%`);
    }
    
    sendStatusToWindow('download-progress', progressObj);
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    console.log('⬇️ Update downloaded successfully!');
    console.log('Update info:', {
      version: info.version,
      releaseDate: info.releaseDate,
      downloadedFile: info.downloadedFile || 'unknown'
    });
    log.info('Update downloaded:', info);
    
    // Validate update file exists before marking as downloaded
    const fs = require('fs');
    const updateFilePath = info.downloadedFile || info.path;
    
    if (updateFilePath && fs.existsSync(updateFilePath)) {
      console.log('✅ Update file validated:', updateFilePath);
      updateDownloaded = true;
      updateDownloading = false;
      updateInfo = info;
      
      // Verify the update was actually downloaded
      const currentVersion = app.getVersion();
      console.log(`📊 Update verification - Current: ${currentVersion}, Downloaded: ${info.version}`);
      
      if (compareVersions(info.version, currentVersion) > 0) {
        console.log('✅ Update verification passed - downloaded version is newer');
        console.log('🎉 Update ready to install! Showing notification to user...');
        
        // Now show the "ready to install" notification
        sendStatusToWindow('ready-to-install', info);
        showUpdateNotification(info);
      } else {
        console.log('⚠️ Update verification failed - downloaded version is not newer');
        log.warn('Update verification failed - downloaded version is not newer');
        
        // Reset update state
        updateDownloaded = false;
        updateDownloading = false;
        updateInfo = null;
      }
    } else {
      console.error('❌ Update file missing or invalid:', updateFilePath);
      log.error('Update file missing or invalid:', updateFilePath);
      
      // Reset update state - file doesn't exist
      updateDownloaded = false;
      updateDownloading = false;
      updateInfo = null;
      
      // Send error status
      sendStatusToWindow('download-error', {
        error: 'Update file missing or corrupted',
        version: info.version
      });
    }
  });
  
  // Critical: Handle the before-quit-for-update event
  // This ensures the update is actually installed when quitAndInstall is called
  autoUpdater.on('before-quit-for-update', () => {
    console.log('🔄 before-quit-for-update event triggered - update installation starting');
    log.info('before-quit-for-update event triggered - update installation starting');
    
    // Log critical information about the update process
    const debugInfo = {
      timestamp: new Date().toISOString(),
      appPath: app.getAppPath(),
      executablePath: process.execPath,
      platform: process.platform,
      isPackaged: app.isPackaged,
      processPID: process.pid,
      currentVersion: app.getVersion(),
      updateVersion: updateInfo?.version
    };
    
    console.log('🔍 Update installation debug info:', JSON.stringify(debugInfo, null, 2));
    log.info('Update installation debug info:', debugInfo);
    
    // Also write to a special debug file
    try {
      const fs = require('fs');
      const path = require('path');
      const debugPath = path.join(app.getPath('userData'), 'update-debug.log');
      fs.appendFileSync(debugPath, `\n${new Date().toISOString()} - BEFORE QUIT FOR UPDATE:\n${JSON.stringify(debugInfo, null, 2)}\n`);
    } catch (err) {
      console.error('Failed to write debug log:', err);
    }
    
    // This event is fired when quitAndInstall() is called and the app is about to quit for update
    // The update will be installed after this event
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
  const { ipcMain } = require('electron');
  
  ipcMain.handle('check-for-updates', async () => {
    console.log('🔄 Manual update check requested');
    log.info('Manual update check requested');
    return checkForUpdates();
  });
  
  ipcMain.handle('quit-and-install', async () => {
    console.log('🔄 Quit and install requested');
    log.info('Quit and install requested');
    
    // Check if update is already downloaded or currently downloading
    if (updateDownloaded && updateInfo) {
      console.log('✅ Update already downloaded, proceeding with installation');
    } else if (updateDownloading) {
      console.log('🔄 Update is currently downloading, waiting for completion...');
      
      // Wait for download to complete (max 30 seconds)
      let waitTime = 0;
      const maxWaitTime = 30000;
      const checkInterval = 1000;
      
      while (updateDownloading && waitTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        waitTime += checkInterval;
        console.log(`⏳ Waiting for download... ${waitTime/1000}s`);
      }
      
      if (!updateDownloaded) {
        console.error('❌ Download did not complete in time');
        return { success: false, error: 'Download timeout - please try again' };
      }
    } else if (!updateDownloaded || !updateInfo) {
      console.warn('⚠️ Update not ready for installation');
      log.warn('Update not ready for installation');
      
      // This should rarely happen with the new flow, but handle it gracefully
      if (updateDownloading) {
        console.log('⏳ Download still in progress, please wait...');
        return { success: false, error: 'Download still in progress, please wait a moment and try again' };
      } else {
        console.log('❌ No update available or download failed');
        return { success: false, error: 'No update ready for installation' };
      }
    }
    
    if (updateDownloaded) {
      try {
        console.log('🚀 Update is ready to install immediately (already downloaded)');
        
        // Double-check that the update is actually ready
        if (!updateInfo) {
          console.error('❌ Update info is missing, cannot proceed with installation');
          return { success: false, error: 'Update information is missing' };
        }
        
        // Validate update file exists before attempting installation
        const fs = require('fs');
        const updateFilePath = updateInfo.downloadedFile || updateInfo.path;
        
        if (!updateFilePath || !fs.existsSync(updateFilePath)) {
          console.error('❌ Update file missing or corrupted:', updateFilePath);
          log.error('Update file missing or corrupted:', updateFilePath);
          
          // Reset update state since file is invalid
          updateDownloaded = false;
          updateInfo = null;
          
          return { success: false, error: 'Update file missing or corrupted - please try downloading again' };
        }
        
        console.log('✅ Update file validated for installation:', updateFilePath);
        

        
        // Tell the renderer we're about to install
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-status', { 
            status: 'installing-update', 
            data: { version: updateInfo?.version || 'unknown' } 
          });
        }
        
        // Set a flag in the app data to indicate we're installing an update
        // This helps prevent the app from showing the update notification again if it restarts
        try {
          const fs = require('fs');
          const path = require('path');
          const updateFlagPath = path.join(app.getPath('userData'), 'update-in-progress');
          fs.writeFileSync(updateFlagPath, new Date().toISOString());
          console.log('💾 Created update flag file:', updateFlagPath);
        } catch (err) {
          console.error('❌ Failed to create update flag file:', err);
        }
        
        // Use a short timeout to ensure the renderer has time to show the installing state
        setTimeout(() => {
          console.log('🔄 Executing quitAndInstall for update installation');
          log.info('Executing quitAndInstall for update installation');
          

          
          // First, try to close all windows gracefully
          const allWindows = require('electron').BrowserWindow.getAllWindows();
          console.log(`💻 Closing ${allWindows.length} windows before update`);
          
          allWindows.forEach((window) => {
            if (!window.isDestroyed()) {
              window.close();
            }
          });
          
          // Wait a moment for windows to close, then install
          setTimeout(() => {
            // Write a flag file to indicate an update has been triggered
            try {
              const fs = require('fs');
              const path = require('path');
              const userDataPath = app.getPath('userData');
              const updateFlagPath = path.join(userDataPath, 'update-installed');
              
              // Create a flag file to indicate update installation has been initiated
              fs.writeFileSync(updateFlagPath, new Date().toISOString());
              
              // Also write debug information to help diagnose update issues
              const debugPath = path.join(userDataPath, 'update-debug.log');
              const debugInfo = {
                timestamp: new Date().toISOString(),
                platform: process.platform,
                arch: process.arch,
                currentVersion: app.getVersion(),
                updateVersion: updateInfo ? updateInfo.version : 'unknown',
                updatePath: updateInfo ? updateInfo.path : 'unknown',
                isPackaged: app.isPackaged
              };
              
              fs.appendFileSync(debugPath, JSON.stringify(debugInfo, null, 2) + '\n');
              console.log('📝 Update debug info written to:', debugPath);
            } catch (flagErr) {
              console.error('❌ Error writing update flag:', flagErr);
              log.error('Error writing update flag:', flagErr);
            }
            
            // Use a consistent approach across all platforms
            try {
              console.log('🔄 Calling quitAndInstall() with default parameters (cross-platform)');
              log.info('Calling quitAndInstall() with default parameters (cross-platform)');
              
              // Let electron-updater handle the platform-specific details
              // Parameters: (isSilent, isForceRunAfter)
              // false = show installer UI, true = auto-relaunch after install
              autoUpdater.quitAndInstall(false, true);
              
              console.log('✅ quitAndInstall called successfully');
              log.info('quitAndInstall called successfully');
            } catch (err) {
              console.error('❌ quitAndInstall failed:', err);
              log.error('quitAndInstall failed:', err);
              
              // Try alternative approach but don't force exit - let the update process complete
              console.log('🔄 Trying gentle app quit approach');
              try {
                // Close all windows
                const { BrowserWindow } = require('electron');
                BrowserWindow.getAllWindows().forEach(window => {
                  if (!window.isDestroyed()) {
                    window.close();
                  }
                });
                
                // Gentle quit
                setTimeout(() => {
                  console.log('🔄 Calling app.quit() to allow update installation');
                  app.quit();
                }, 1000);
              } catch (err2) {
                console.error('❌ Manual quit failed:', err2);
                log.error('Manual quit failed:', err2);
              }
            }
          }, 500);
        }, 1500);
        
        return { success: true };
      } catch (error) {
        console.error('❌ Error during quit and install:', error);
        log.error('Error during quit and install:', error);
        return { success: false, error: error.toString() };
      }
    } else {
      console.warn('⚠️ Update not downloaded yet, cannot install');
      log.warn('Update not downloaded yet, cannot install');
      return { success: false, error: 'Update not downloaded yet' };
    }
  });
  
  // Add a force update check for debugging
  ipcMain.handle('force-update-check', async () => {
    console.log('🔄 FORCE update check requested (ignoring dev mode)');
    log.info('FORCE update check requested (ignoring dev mode)');
    
    try {
      console.log('🔍 Force checking for updates...');
      const result = await autoUpdater.checkForUpdates();
      console.log('✅ Force update check result:', result);
      return result;
    } catch (error) {
      console.error('❌ Force update check error:', error);
      log.error('Force update check error:', error);
      throw error;
    }
  });
  
  // Add a handler to clear recent update flags for testing
  ipcMain.handle('clear-update-flags', async () => {
    console.log('🧽 Clearing all update flags for testing');
    log.info('Clearing all update flags for testing');
    
    try {
      const fs = require('fs');
      const path = require('path');
      const userDataPath = app.getPath('userData');
      
      const flagsToRemove = [
        path.join(userDataPath, 'recent-update'),
        path.join(userDataPath, 'update-in-progress')
      ];
      
      for (const flagPath of flagsToRemove) {
        if (fs.existsSync(flagPath)) {
          fs.unlinkSync(flagPath);
          console.log(`💾 Removed flag: ${flagPath}`);
        }
      }
      
      // Reset update state
      updateAvailable = false;
      updateDownloaded = false;
      updateInfo = null;
      
      console.log('✅ All update flags cleared and state reset');
      return { success: true, message: 'All update flags cleared' };
    } catch (error) {
      console.error('❌ Error clearing update flags:', error);
      log.error('Error clearing update flags:', error);
      return { success: false, error: error.toString() };
    }
  });
  
  ipcMain.handle('get-update-status', async () => {
    return {
      updateAvailable,
      updateDownloaded,
      updateInfo
    };
  });
}

module.exports = {
  initAutoUpdater,
  checkForUpdates
};
