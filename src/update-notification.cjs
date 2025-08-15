// Update notification handler for renderer process
const { ipcRenderer } = require('electron');

class UpdateNotificationManager {
  constructor() {
    this.notificationElement = null;
    this.contentElement = null;
    this.initialized = false;
    this.lastStatus = null; // Track the last update status
    
    // Bind methods
    this.handleUpdateStatus = this.handleUpdateStatus.bind(this);
    this.showUpdateNotification = this.showUpdateNotification.bind(this);
    this.hideNotification = this.hideNotification.bind(this);
    this.installUpdate = this.installUpdate.bind(this);
  }
  
  init() {
    if (this.initialized) return;
    
    // Create notification element if it doesn't exist
    this.createNotificationElement();
    
    // Set up IPC listeners
    ipcRenderer.on('update-status', this.handleUpdateStatus);
    ipcRenderer.on('show-update-notification', this.showUpdateNotification);
    
    // Check for updates on startup
    setTimeout(() => {
      this.checkForUpdates();
    }, 5000); // Wait 5 seconds after app start
    
    this.initialized = true;
  }
  
  createNotificationElement() {
    // Check if notification already exists
    if (document.getElementById('update-notification')) {
      this.notificationElement = document.getElementById('update-notification');
      return;
    }
    
    // Create notification container
    const notification = document.createElement('div');
    notification.className = 'update-notification';
    notification.innerHTML = `
      <div class="update-notification-header">
        <div class="update-notification-icon">
          <i class="fas fa-download"></i>
        </div>
        <div class="update-notification-title">
          <h3>Update Available</h3>
          <div class="update-notification-version">Version <span id="update-version">--</span></div>
        </div>
        <button class="update-notification-close" id="update-close">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="update-notification-content">
        <div class="update-notification-message"></div>
        <div class="update-info">
          <i class="fas fa-info-circle"></i>
          <span>Please wait a few minutes after program exit for update to finish in background before restarting</span>
        </div>
      </div>
      <div class="update-notification-actions">
        <button class="update-notification-btn update-notification-btn-secondary" id="update-later">
          <i class="fas fa-clock"></i>
          Later
        </button>
        <button class="update-notification-btn update-notification-btn-primary" id="update-install">
          <i class="fas fa-download"></i>
          Install Now
        </button>
      </div>
    `;
    
    document.body.appendChild(notification);
    this.notificationElement = notification;
    
    // Set up event listeners
    this.setupEventListeners();
  }
  
  setupEventListeners() {
    const laterBtn = this.notificationElement.querySelector('#update-later');
    const installBtn = this.notificationElement.querySelector('#update-install');
    const closeBtn = this.notificationElement.querySelector('#update-close');
    
    if (laterBtn) laterBtn.addEventListener('click', () => this.hideNotification());
    if (installBtn) installBtn.addEventListener('click', () => this.installUpdate());
    if (closeBtn) closeBtn.addEventListener('click', () => this.hideNotification());
  }
  
  handleUpdateStatus(event, { status, data }) {
    console.log('Update status:', status, data);
    
    // Store the last status to help with error debouncing
    this.lastStatus = status;
    
    switch (status) {
      case 'checking-for-update':
        this.setNotificationState('checking', 'Checking for updates...');
        break;
        
      case 'update-available':
        // This is now only sent for immediate installs (shouldn't happen with new flow)
        this.setNotificationState('available', `New version v${data.version} is available!`);
        this.showNotification();
        break;
        
      case 'downloading-in-background':
        // Update is downloading silently in background - don't show notification yet
        console.log(`📥 Background download started for v${data.version}`);
        this.setNotificationState('downloading', data.message);
        // Don't show notification - keep it silent
        break;
        
      case 'update-not-available':
        this.setNotificationState('idle', 'No updates available');
        // Don't show notification for no updates
        break;
        
      case 'download-progress':
        // Show progress but don't pop up notification during background download
        console.log(`📊 Download progress: ${Math.round(data.percent)}%`);
        // No UI updates needed since download is in background
        break;
        
      case 'ready-to-install':
        // This is the key moment - download is complete, show notification
        console.log(`🎉 Update v${data.version} ready to install!`);
        this.setNotificationState('ready', `Update ready to install: v${data.version}`);
        this.showNotification();
        break;
        
      case 'update-downloaded':
        // Legacy handler - redirect to ready-to-install
        console.log(`✅ Update v${data.version} downloaded (legacy handler)`);
        this.setNotificationState('ready', `Update ready to install: v${data.version}`);
        this.showNotification();
        break;
        
      case 'download-error':
        // Handle download errors specifically
        console.error(`❌ Download failed for v${data.version}:`, data.error);
        this.setNotificationState('error', `Failed to download update: ${data.error}`);
        this.showNotification();
        break;
        
      case 'error':
      // Filter out non-critical errors and add debounce for transient errors
      const errorMessage = data.toString();
      
      // Don't show these types of errors at all - comprehensive Windows signing error filtering
      if (errorMessage.includes('Code signature') || 
          errorMessage.includes('signature validation') || 
          errorMessage.includes('No such file or directory') || 
          errorMessage.includes('ENOENT') ||
          errorMessage.includes('not signed') ||
          errorMessage.includes('SignerCertificate') ||
          errorMessage.includes('TimeStamperCertificate') ||
          errorMessage.includes('execution policy') ||
          errorMessage.includes('digitally signed') ||
          errorMessage.includes('not digitally signed') ||
          errorMessage.includes('cannot run this script') ||
          errorMessage.includes('publisherNames') ||
          errorMessage.includes('TRUST Me Bros') ||
          errorMessage.includes('StatusMessage') ||
          errorMessage.includes('Execution_Policies') ||
          errorMessage.includes('microsoft.com/fwlink') ||
          errorMessage.includes('Status') ||
          errorMessage.includes('Failed to download update') ||
          errorMessage.includes('New version') ||
          errorMessage.includes('not signed by the application owner') ||
          errorMessage.includes('raw info') ||
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
          (errorMessage.includes('signature') && errorMessage.includes('validation')) ||
          (errorMessage.includes('signed') && errorMessage.includes('application')) ||
          (errorMessage.includes('Status') && errorMessage.includes('2')) ||
          (errorMessage.includes('version') && errorMessage.includes('signed'))) {
        console.warn('Non-critical Windows signing warning (suppressed):', errorMessage);
        
        // Continue with the update process without showing error
        return;
      }
      
      // For all other errors, add a delay to avoid showing very transient errors
      console.warn('Update error detected, waiting to see if it resolves...', errorMessage);
      
      // Store the current error to check if it persists
      const currentError = errorMessage;
      
      // Wait 800ms to see if error persists before showing notification
      setTimeout(() => {
        // Check if we've received success status since the error occurred
        const lastStatus = this.lastStatus || '';
        if (lastStatus === 'update-downloaded' || lastStatus === 'update-available' || lastStatus === 'ready-to-install') {
          console.log('Error resolved, update continuing normally');
          return;
        }
        
        // Show the error if it persists
        this.setNotificationState('error', `Update error: ${currentError}`);
        this.showNotification();
      }, 800);
      break;
    }
  }
  
  showUpdateNotification(event, info) {
    // Update the version display
    const versionElement = this.notificationElement?.querySelector('#update-version');
    if (versionElement && info.version) {
      versionElement.textContent = info.version;
    }
    
    this.setNotificationState('ready', `Update ready to install: v${info.version}`);
    this.showNotification();
  }
  
  setNotificationState(state, message = '') {
    if (!this.notificationElement) return;
    
    // Update the state attribute
    this.notificationElement.setAttribute('data-state', state);
    
    // Update message if provided
    if (message) {
      const messageElement = this.notificationElement.querySelector('.update-notification-message');
      if (messageElement) {
        messageElement.textContent = message;
      }
    }
    
    // Progress bar removed - no longer needed with background downloads
    
    // Update button states based on notification state
    const installButton = this.notificationElement.querySelector('#update-install');
    const laterButton = this.notificationElement.querySelector('#update-later');
    
    if (installButton && laterButton) {
      if (state === 'installing' || state === 'restarting') {
        installButton.disabled = true;
        laterButton.disabled = true;
        installButton.textContent = state === 'installing' ? 'Installing...' : 'Restarting...';
        laterButton.style.opacity = '0.5';
      } else if (state === 'error') {
        installButton.disabled = false;
        laterButton.disabled = false;
        installButton.textContent = 'Try Again';
        laterButton.style.opacity = '1';
      } else if (state === 'ready') {
        installButton.disabled = false;
        laterButton.disabled = false;
        installButton.textContent = 'Install Now';
        laterButton.style.opacity = '1';
      }
    }
  }
  
  // updateProgress method removed - no longer needed with background downloads
  
  showNotification() {
    if (!this.notificationElement) this.createNotificationElement();
    this.notificationElement.classList.add('show');
  }
  
  hideNotification() {
    if (this.notificationElement) {
      this.notificationElement.classList.remove('show');
    }
  }
  
  checkForUpdates() {
    ipcRenderer.invoke('check-for-updates')
      .then(result => {
        console.log('Check for updates result:', result);
      })
      .catch(err => {
        console.error('Error checking for updates:', err);
      });
  }
  
  installUpdate() {
    // Reset any previous error state
    this.lastStatus = 'installing';
    
    // Show installing state immediately for better user feedback
    this.setNotificationState('installing', 'Installing update and restarting...');
    
    // Disable the install button to prevent multiple clicks
    const installButton = this.notificationElement.querySelector('#update-install');
    if (installButton) {
      installButton.disabled = true;
      installButton.textContent = 'Installing...';
      installButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Installing...';
    }
    
    // Disable the Later button as well
    const laterButton = this.notificationElement.querySelector('#update-later');
    if (laterButton) {
      laterButton.disabled = true;
      laterButton.style.opacity = '0.5';
    }
    
    console.log('🔄 Requesting application restart to install update');
    
    // Set the state to installing immediately
    this.setNotificationState('installing', 'Installing update...');
    
    // Platform-specific restart messaging
    if (process.platform === 'win32') {
      // On Windows, show installing message longer due to potential delays
      setTimeout(() => {
        this.setNotificationState('restarting', 'Installing and restarting...');
      }, 1500);
      
      // Add a longer timeout for Windows to handle potential hanging
      setTimeout(() => {
        if (this.lastStatus === 'installing' || this.lastStatus === 'restarting') {
          console.log('Windows update taking longer than expected, showing extended message');
          this.setNotificationState('restarting', 'Update in progress, please wait...');
        }
      }, 5000);
    } else {
      // macOS and Linux - shorter delay
      setTimeout(() => {
        this.setNotificationState('restarting', 'Restarting application...');
      }, 500);
    }
    
    // Call the IPC handler to quit and install
    ipcRenderer.invoke('quit-and-install')
      .then(result => {
        if (!result.success) {
          console.error('Failed to install update:', result.error);
          this.setNotificationState('error', `Failed to install update: ${result.error}`);
          
          // Re-enable the buttons if there was an error
          if (installButton) {
            installButton.disabled = false;
            installButton.innerHTML = '<i class="fas fa-redo"></i> Try Again';
          }
          if (laterButton) {
            laterButton.disabled = false;
            laterButton.style.opacity = '1';
          }
          
          // Reset the last status to allow retry
          this.lastStatus = 'error';
        } else {
          console.log('✅ Update installation initiated successfully');
          // The app should restart soon, but just in case, update the UI
          this.setNotificationState('restarting', 'Restarting application...');
          
          // Platform-specific timeout handling
          const timeoutDuration = process.platform === 'win32' ? 15000 : 10000;
          
          setTimeout(() => {
            console.log(`App still running after ${timeoutDuration/1000} seconds, attempting recovery...`);
            
            if (process.platform === 'win32') {
              // On Windows, show a recovery message
              this.setNotificationState('error', 'Update installation may have completed. Please restart the app manually if needed.');
              
              // Re-enable buttons for manual action
              const installButton = this.notificationElement.querySelector('#update-install');
              const laterButton = this.notificationElement.querySelector('#update-later');
              
              if (installButton) {
                installButton.disabled = false;
                installButton.innerHTML = '<i class="fas fa-sync"></i> Restart App';
                installButton.onclick = () => {
                  try {
                    window.location.reload();
                  } catch (e) {
                    console.error('Manual restart failed:', e);
                  }
                };
              }
              
              if (laterButton) {
                laterButton.disabled = false;
                laterButton.style.opacity = '1';
              }
            } else {
              // macOS/Linux - try force reload
              try {
                window.location.reload();
              } catch (e) {
                console.error('Failed to reload window:', e);
              }
            }
          }, timeoutDuration);
        }
      })
      .catch(err => {
        console.error('Error installing update:', err);
        this.setNotificationState('error', `Error installing update: ${err.message || err}`);
        
        // Re-enable the buttons if there was an error
        if (installButton) {
          installButton.disabled = false;
          installButton.innerHTML = '<i class="fas fa-redo"></i> Try Again';
        }
        if (laterButton) {
          laterButton.disabled = false;
          laterButton.style.opacity = '1';
        }
        
        // Reset the last status to allow retry
        this.lastStatus = 'error';
      });
  }
}

// Create and export instance
const updateNotificationManager = new UpdateNotificationManager();

module.exports = updateNotificationManager;
