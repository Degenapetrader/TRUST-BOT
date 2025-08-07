const { ipcRenderer } = require('electron');

// Import update notification manager
const updateNotificationManager = require('./src/update-notification.cjs');

// Add manual update check handler
ipcRenderer.on('trigger-manual-update-check', async () => {
  console.log('🔄 Manual update check triggered from main process');
  try {
    const result = await ipcRenderer.invoke('force-update-check');
    console.log('✅ Manual update check result:', result);
  } catch (error) {
    console.error('❌ Manual update check failed:', error);
  }
});

// Import documentation module
try {
    const documentation = require('./documentation.js');
    if (typeof window !== 'undefined') {
        window.documentation = documentation;
    }
} catch (error) {
    console.error('Failed to import documentation module:', error);
}
// Import gas helper module
try {
    require('./gas-helper.js');
    console.log('Gas helper module loaded successfully');
} catch (error) {
    console.error('Failed to import gas helper module:', error);
}

// Global state
let currentBot = null;
let isRunning = false;
let consoleLines = [];
let detailedConsoleLines = [];
let isSimpleLogView = true;
let bidTokenDatabase = []; // BID-MODE token database
let selectedTickers = []; // Will be synced with TokenPersistence
let mmBotPriceCheckCounter = 0; // Counter for MM bot periodic status updates
let customTickers = [];
let selectedWallets = new Set();
let availableWallets = [];
let tokenDatabase = []; // Will store base.json data
let searchTimeout = null; // For debouncing search
let walletSelectionTimeout = null; // For debouncing wallet selection updates
let addressDetectionTimeouts = {}; // For debouncing address detection
let isBidModeActive = false; // BID-MODE state
let bidSearchTimeout = null; // For debouncing BID token search
let activeBot = '';
let activeBotName = '';
let lastActiveBotName = '';
let walletDatabase = [];
let currentWalletFilter = 'all';

// Make selectedTickers available globally for token-selection.js
window.selectedTickers = selectedTickers;

// Listen for token selection changes from the token-selection.js module
window.addEventListener('token-selection-changed', (event) => {
    console.log('📢 RENDERER: Received token-selection-changed event', event.detail);
    const { selectedTokens, action, token } = event.detail;
    
    // Update our local copy of selectedTickers to stay in sync
    selectedTickers = [...selectedTokens];
    console.log(`🔄 RENDERER: Updated selectedTickers array, now contains ${selectedTickers.length} tokens`);
    
    // Log the specific change that occurred
    if (action === 'add') {
        console.log(`➕ RENDERER: Token ${token.symbol || token.tokenAddress} was added to selection`);
    } else if (action === 'remove') {
        console.log(`➖ RENDERER: Token ${token.symbol || token.tokenAddress} was removed from selection`);
    }
});

// Global variables for tracking parallel execution
let parallelExecutionResults = new Map(); // Track results by ticker
let parallelExecutionCount = 0;
let parallelExecutionTotal = 0;

// Global BID token database for BID-MODE

// Preload bid.json into bidTokenDatabase
async function preloadBidTokenDatabase() {
    try {
        const response = await fetch('./bid.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const bidData = await response.json();
        // Map array data to the expected format
        bidTokenDatabase = bidData.map(token => ({
            symbol: token.symbol,
            address: token.tokenAddress
        }));
    } catch (error) {
        bidTokenDatabase = [];
        addConsoleMessage('❌ Could not load BID token database', 'warning');
    }
}

/**
 * Startup validation: Check wallets.json for missing RPC config and migrate from config.json if needed
 */
async function validateAndMigrateRpcConfig() {
    try {
        console.log('🔍 STARTUP: Validating RPC configuration...');
        
        // Check if wallets.json has RPC configuration
        const walletsResponse = await fetch('wallets.json');
        if (!walletsResponse.ok) {
            console.warn('⚠️ STARTUP: wallets.json not found, skipping RPC validation');
            return;
        }
        
        const walletsData = await walletsResponse.json();
        const config = walletsData.config || {};
        
        // Check individual fields for missing/empty values
        const needsMigration = (
            !config.rpcUrl || config.rpcUrl.trim() === '' ||
            !config.rpcUrlQuickNode || config.rpcUrlQuickNode.trim() === '' ||
            !config.rpcUrlInfura || config.rpcUrlInfura.trim() === '' ||
            !config.wsUrl || config.wsUrl.trim() === '' ||
            !config.wsUrlInfura || config.wsUrlInfura.trim() === '' ||
            !config.dynamicRpcs || !Array.isArray(config.dynamicRpcs) || config.dynamicRpcs.length === 0 ||
            !config.genesisContract || config.genesisContract.trim() === ''
        );
        
        if (!needsMigration) {
            console.log('✅ STARTUP: All RPC configuration fields are present in wallets.json');
            return;
        }
        
        console.log('⚠️ STARTUP: RPC configuration missing in wallets.json, checking config.json...');
        
        // Try to load config.json
        const configResponse = await fetch('config.json');
        if (!configResponse.ok) {
            console.warn('⚠️ STARTUP: config.json not found, cannot migrate RPC configuration');
            return;
        }
        
        const configData = await configResponse.json();
        const settings = configData.settings || {};
        
        // Check if config.json has RPC configuration
        const configHasRpcs = settings.rpcUrl && settings.rpcUrl.trim() !== '';
        const configHasDynamicRpcs = settings.dynamicRpcs && Array.isArray(settings.dynamicRpcs) && settings.dynamicRpcs.length > 0;
        
        if (!configHasRpcs && !configHasDynamicRpcs) {
            console.warn('⚠️ STARTUP: No RPC configuration found in config.json either');
            return;
        }
        
        console.log('🔄 STARTUP: Migrating RPC configuration from config.json to wallets.json...');
        
        // Migrate RPC configuration - PRESERVE existing values, only fill empty ones
        const updatedConfig = {
            ...config,
            rpcUrl: (config.rpcUrl && config.rpcUrl.trim() !== '') ? config.rpcUrl : (settings.rpcUrl || ''),
            rpcUrlQuickNode: (config.rpcUrlQuickNode && config.rpcUrlQuickNode.trim() !== '') ? config.rpcUrlQuickNode : (settings.rpcUrlQuickNode || ''),
            rpcUrlInfura: (config.rpcUrlInfura && config.rpcUrlInfura.trim() !== '') ? config.rpcUrlInfura : (settings.rpcUrlInfura || ''),
            wsUrl: (config.wsUrl && config.wsUrl.trim() !== '') ? config.wsUrl : (settings.wsUrl || ''),
            wsUrlQuickNode: (config.wsUrlQuickNode && config.wsUrlQuickNode.trim() !== '') ? config.wsUrlQuickNode : (settings.wsUrlQuickNode || ''),
            wsUrlInfura: (config.wsUrlInfura && config.wsUrlInfura.trim() !== '') ? config.wsUrlInfura : (settings.wsUrlInfura || ''),
            dynamicRpcs: (config.dynamicRpcs && Array.isArray(config.dynamicRpcs) && config.dynamicRpcs.length > 0) ? config.dynamicRpcs : (settings.dynamicRpcs || []),
            genesisContract: (config.genesisContract && config.genesisContract.trim() !== '') ? config.genesisContract : (settings.genesisContract || ''),
            solanaRpcUrl: (config.solanaRpcUrl && config.solanaRpcUrl.trim() !== '') ? config.solanaRpcUrl : (settings.solanaRpcUrl || ''),
            solanaVirtualTokenMint: (config.solanaVirtualTokenMint && config.solanaVirtualTokenMint.trim() !== '') ? config.solanaVirtualTokenMint : (settings.solanaVirtualTokenMint || ''),
            stargateBaseRouter: (config.stargateBaseRouter && config.stargateBaseRouter.trim() !== '') ? config.stargateBaseRouter : (settings.stargateBaseRouter || ''),
            stargateSolanaRouter: (config.stargateSolanaRouter && config.stargateSolanaRouter.trim() !== '') ? config.stargateSolanaRouter : (settings.stargateSolanaRouter || ''),
            transferIntervalSeconds: config.transferIntervalSeconds || settings.transferIntervalSeconds || 300,
            slippageBasisPoints: config.slippageBasisPoints || settings.slippageBasisPoints || 1000
        };
        
        const updatedWalletsData = {
            ...walletsData,
            config: updatedConfig
        };
        
        // Send the updated configuration to the main process to save
        try {
            await ipcRenderer.invoke('saveWalletsConfig', updatedWalletsData);
            console.log('✅ STARTUP: RPC configuration successfully migrated to wallets.json');
        } catch (saveError) {
            console.error('❌ STARTUP: Failed to save wallets.json:', saveError);
        }
        
    } catch (error) {
        console.error('❌ STARTUP: Error during RPC configuration validation:', error);
    }
}

// Call preloadBidTokenDatabase on startup and when BID-MODE is toggled
// (already called in toggleBidMode, but ensure it's called on page load too)
document.addEventListener('DOMContentLoaded', async () => {
    // Validate and migrate RPC configuration first
    await validateAndMigrateRpcConfig();
    
    // Load and display app version
    try {
        const version = await ipcRenderer.invoke('get-app-version');
        const versionElement = document.getElementById('app-version');
        if (versionElement && version) {
            versionElement.textContent = version;
        }
    } catch (error) {
        console.error('Failed to load app version:', error);
    }
    
    // Then proceed with normal startup
    preloadBidTokenDatabase();
});

/**
 * Handle BID token search
 */
function handleBidTokenSearch() {
    const input = document.getElementById('bid-token-field-input');
    const resultsDiv = document.getElementById('bid-search-results');
    
    if (!input || !resultsDiv) return;
    
    const query = input.value.trim();
    
    if (query.length < 2) {
        resultsDiv.style.display = 'none';
        return;
    }
    
    // Search in BID tokens
    performBidTokenSearch(query);
}

function performBidTokenSearch(query) {
    if (bidSearchTimeout) clearTimeout(bidSearchTimeout);
    
    bidSearchTimeout = setTimeout(() => {
        const resultsDiv = document.getElementById('bid-search-results');
        const statusDiv = document.getElementById('bid-search-status');
        let results = [];
        
        // Check if input looks like an address
        const isAddress = query.startsWith('0x') && query.length > 10;
        if (isAddress) {
            const normalizedQuery = query.toLowerCase();
            results = bidTokenDatabase.filter(token =>
                token.address && token.address.toLowerCase().includes(normalizedQuery)
            );
        } else {
            const normalizedQuery = query.toUpperCase();
            results = bidTokenDatabase.filter(token =>
                token.symbol && token.symbol.toUpperCase().includes(normalizedQuery)
            );
        }
        
        // Limit results and display
        results = results.slice(0, 10); // Limit to 10 results for performance
        displayBidSearchResults(results, query);
    }, 300); // 300ms debounce
}

function hideBidSearchResults() {
    const resultsDiv = document.getElementById('bid-search-results');
    const statusDiv = document.getElementById('bid-search-status');
    if (resultsDiv) {
        resultsDiv.style.display = 'none';
        resultsDiv.innerHTML = '';
    }
    if (statusDiv) {
        statusDiv.style.display = 'none';
    }
}

// DOM Elements
const elements = {
    botNav: document.querySelectorAll('.nav-btn'),
    botForms: document.querySelectorAll('.bot-form'),
    console: document.getElementById('console'),
    stopBtn: document.getElementById('stop-bot'),
    balanceCheckBtn: document.getElementById('balance-check'),
    activeBot: document.getElementById('active-bot'),
    walletCount: document.getElementById('wallet-count'),
    connectionStatus: document.getElementById('connection-status'),
    gasPriceStatus: document.getElementById('gas-price-status'),
    botTitle: document.getElementById('bot-title'),
    botDescription: document.getElementById('bot-description')
};

// Bot configurations
const botConfigs = {
    buybot: {
        title: '🟢 BuyBot Configuration',
        description: 'Configure parameters to buy tokens with VIRTUAL'
    },
    sellbot: {
        title: '🔴 SellBot Configuration', 
        description: 'Configure parameters to sell tokens for VIRTUAL'
    },
    'sellbot-fsh': {
        title: '💥 FSH',
        description: 'Execute FSH operation'
    },
    farmbot: {
        title: '🔄 FarmBot Configuration',
        description: 'Configure volume farming parameters (Multi-wallet)'
    },
    mmbot: {
        title: '📊 Market Making Bot Configuration',
        description: 'Configure market making parameters (Multi-wallet)'
    },
    jeetbot: {
        title: '🚀 JeetBot Configuration',
        description: 'Configure Genesis token claiming and trading'
    },
    transferbot: {
        title: '💸 TransferBot Configuration',
        description: 'Transfer tokens between wallets with flexible routing'
    },
    stargate: {
        title: '🌉 Stargate Bridge Configuration',
        description: 'Cross-chain bridge between Solana and Base networks'
    },
    contactbot: {
        title: '📞 ContactBot Configuration',
        description: 'Manage contacts and address book'
    },
    wallettoken: {
        title: '👛 Wallet & Token Selection',
        description: 'Configure wallets and tokens for all trading bots'
    },
    'bid-tokens': {
        title: '🎯 BID Tokens & Wallets',
        description: 'Select tokens from the bid.json database for ETH trading mode'
    },
    detect: {
        title: '🔍 Token Detector Configuration',
        description: 'Detect and analyze tokens in your wallets'
    },
    'ticker-search': {
        title: '🔍 Ticker Search Configuration',
        description: 'Search for token information across all chains'
    },
    'ticker-fetch': {
        title: '📥 Fetch All Token Data',
        description: 'Download complete token database from Virtuals.io API'
    },
    'ticker-export': {
        title: '📤 Export Token Database',
        description: 'Export current token database to Excel format'
    },
    'ticker-runall': {
        title: '🔄 Fetch All + Export',
        description: 'Complete token database refresh and Excel export'
    },
    documentation: {
        title: '📚 User Guide',
        description: 'Complete documentation and help for TRUSTBOT features'
    }
};

// Global variable to track wallet count
let walletCount = 1;

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
    setupEventListeners();
    checkSystemStatus();
    
    // Initialize token selection system
    initializeTokenSelection();
    
    // Initialize documentation
    initDocumentation();
    
    // Initialize update notification manager
    updateNotificationManager.init();
    
    // Initialize gas price updates
    initializeDynamicGasDisplay();
    
    // Note: Wallet loading is now handled in the main initialization section
    
    // Automatically select the wallet and token selection page on startup
    setTimeout(() => {
        // selectBot('wallettoken'); // Hidden - wallet/token selection page now hidden
        selectBot('buybot'); // Default to BuyBot instead
    }, 300); // Short delay to ensure all components are loaded
});

// Token Selection Integration
function initializeTokenSelection() {
    console.log('Initializing token selection system...');
    
    if (window.TokenSelectionUI) {
        window.TokenSelectionUI.init();
        console.log('TokenSelectionUI initialized');
    } else {
        console.warn('TokenSelectionUI not available');
    }
    
    // Synchronize global selectedTickers with TokenPersistence
    if (window.TokenPersistence) {
        const savedTokens = window.TokenPersistence.loadTokens();
        if (savedTokens && savedTokens.length > 0) {
            selectedTickers = [...savedTokens];
            console.log(`Loaded ${selectedTickers.length} tokens from persistence`);
        } else {
            console.log('No saved tokens found in persistence');
        }
    } else {
        console.warn('TokenPersistence not available');
    }
}

function initializeUI() {
    // Setup navigation
    elements.botNav.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const botType = e.currentTarget.dataset.bot;
            selectBot(botType);
        });
    });

    // Setup ticker selection
    setupTickerSelection();

    // Setup wallet selection
    setupWalletSelection();
}

/**
 * Submit a new wallet to be saved
 */
async function submitAddWallet() {
    try {
        addConsoleMessage('🔄 Starting wallet add process...', 'info');
        const name = document.getElementById('new-wallet-name').value;
        const privateKey = document.getElementById('new-wallet-key').value.trim();
        
        addConsoleMessage(`Wallet name: ${name}, Private key length: ${privateKey ? privateKey.length : 0} chars`, 'info');
        
        if (!name || !privateKey) {
            addConsoleMessage('❌ Wallet name and private key are required', 'error');
            return;
        }
        
        // Format private key - remove 0x prefix if present
        const formattedKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;

        // Validate the private key directly in renderer process
        let address;
        try {
            addConsoleMessage('🔑 Validating private key...', 'info');
            // First try validating in main process
            address = await ipcRenderer.invoke('validate-private-key', formattedKey);
            
            if (!address) {
                addConsoleMessage('❌ Private key validation failed', 'error');
                return;
            }
            
            addConsoleMessage(`✅ Address detected: ${address}`, 'success');
        } catch (error) {
            addConsoleMessage(`❌ Invalid private key: ${error.message}`, 'error');
            return;
        }

        // Create wallet object - IMPORTANT: Save the formatted key without 0x prefix
        const wallet = {
            id: generateUUID(),
            name: name,
            privateKey: formattedKey, // Save without 0x prefix for consistency
            address: address,
            enabled: true,
            timestamp: Date.now()
        };
        addConsoleMessage(`📝 Wallet object created with ID: ${wallet.id}`, 'info');

        // Call the IPC to save the wallet
        addConsoleMessage('💾 Sending wallet to main process via IPC...', 'info');
        const result = await ipcRenderer.invoke('add-wallet', wallet);
        addConsoleMessage(`IPC response received`, 'info');
        
        if (result && result.success) {
            addConsoleMessage(`✅ Wallet ${name} added successfully with address ${address}`, 'success');
            closeModal('add-wallet-modal');
            
            // Clear form
            document.getElementById('new-wallet-name').value = '';
            document.getElementById('new-wallet-key').value = '';
            
            // Refresh wallets in UI
            addConsoleMessage('🔄 Refreshing wallet list...', 'info');
            refreshWallets();
        } else {
            addConsoleMessage(`❌ Failed to add wallet: ${result ? result.error || 'Unknown error' : 'No response from main process'}`, 'error');
        }
    } catch (error) {
        addConsoleMessage(`❌ Error adding wallet: ${error.message}`, 'error');
        console.error('Error adding wallet:', error);
    }
}

/**
 * Submit edits to an existing wallet
 */
async function submitEditWallet() {
    try {
        const id = document.getElementById('edit-wallet-id').value;
        const name = document.getElementById('edit-wallet-name').value;
        
        if (!id || !name) {
            addConsoleMessage('❌ Wallet ID and name are required', 'error');
            return;
        }

        // Create update object
        const updates = {
            name: name
        };

        // Call the IPC to update the wallet
        const result = await ipcRenderer.invoke('update-wallet', id, updates);
        
        if (result.success) {
            addConsoleMessage(`✅ Wallet ${name} updated successfully`, 'success');
            closeModal('edit-wallet-modal');
            
            // Refresh wallets in UI
            refreshWallets();
        } else {
            addConsoleMessage(`❌ Failed to update wallet: ${result.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        addConsoleMessage(`❌ Error updating wallet: ${error.message}`, 'error');
        console.error('Error updating wallet:', error);
    }
}

/**
 * Helper function to generate a UUID for wallet IDs
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, 
              v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Initialize the documentation page with content from documentation.js
 */
function initDocumentation() {
    try {
        // Get the container root where we'll insert the documentation
        const containerRoot = document.getElementById('documentation-container-root');
        
        if (!containerRoot) {
            addConsoleMessage('❌ Documentation container root not found', 'error');
            return;
        }
        
        // Clear any existing content
        containerRoot.innerHTML = '';
        
        // Create the documentation container using the function from documentation.js
        if (typeof window.documentation !== 'undefined' && typeof window.documentation.getContent === 'function') {
            // Create container structure
            const docContainer = document.createElement('div');
            docContainer.className = 'documentation-container';
            containerRoot.appendChild(docContainer);
            
            // Title is already shown in the page header, no need for duplicate
            
            // Create navigation bar - horizontal menu
            const nav = document.createElement('div');
            nav.className = 'doc-nav';
            nav.style.display = 'flex';
            nav.style.flexDirection = 'row';
            nav.style.flexWrap = 'wrap';
            nav.style.justifyContent = 'center';
            nav.style.alignItems = 'center';
            nav.style.gap = '8px';
            nav.style.padding = '15px';
            nav.style.margin = '0 0 15px 0';
            nav.style.backgroundColor = '#102538';
            nav.style.borderRadius = '8px';
            docContainer.appendChild(nav);
            
            // Get sections from documentation module
            const sections = window.documentation.getSections();
            
            // Create navigation buttons in a horizontal line
            sections.forEach(section => {
                const button = document.createElement('button');
                button.className = 'doc-nav-btn';
                button.textContent = section.charAt(0).toUpperCase() + section.slice(1);
                button.setAttribute('data-section', section);
                
                // Direct styling to guarantee horizontal buttons
                button.style.display = 'inline-block';
                button.style.padding = '8px 15px';
                button.style.backgroundColor = '#2a5885';
                button.style.color = '#ffffff';
                button.style.border = '1px solid #3498db';
                button.style.borderRadius = '5px';
                button.style.fontSize = '14px';
                button.style.fontWeight = '500';
                button.style.cursor = 'pointer';
                
                button.addEventListener('click', () => {
                    // Remove active class from all buttons
                    document.querySelectorAll('.doc-nav-btn').forEach(btn => {
                        btn.classList.remove('active');
                        btn.style.backgroundColor = '#2a5885';
                    });
                    // Add active class to this button
                    button.classList.add('active');
                    button.style.backgroundColor = '#3498db';
                    // Load the selected section
                    loadDocumentationSection(section);
                });
                nav.appendChild(button);
            });
            
            // Create content container with explicit height and scroll settings
            const contentContainer = document.createElement('div');
            contentContainer.className = 'doc-content-container';
            contentContainer.id = 'doc-content-container';
            
            // Direct styling for natural content flow (no inner scroll)
            contentContainer.style.flex = '1';
            contentContainer.style.width = '100%';
            contentContainer.style.padding = '25px 30px';
            contentContainer.style.color = '#e0e0e0';
            contentContainer.style.backgroundColor = '#1e1e1e';
            contentContainer.style.position = 'relative';
            contentContainer.style.display = 'block';
            
            docContainer.appendChild(contentContainer);
            
            // Set initial content (overview)
            loadDocumentationSection('overview');
            
            // Activate first button
            const firstButton = document.querySelector('.doc-nav-btn');
            if (firstButton) {
                firstButton.classList.add('active');
            }
            
            addConsoleMessage('📚 Documentation loaded successfully', 'info');
        } else {
            containerRoot.innerHTML = '<div class="error-message">Documentation module not loaded</div>';
            addConsoleMessage('❌ Documentation module not available', 'error');
        }
    } catch (error) {
        addConsoleMessage(`❌ Error loading documentation: ${error.message}`, 'error');
        console.error('Error loading documentation:', error);
    }
}

/**
                    }
                })
                .catch(error => {
                    docContent.innerHTML = `<div class="doc-error">❌ Error loading documentation: ${error.message}</div>`;
                    console.error('Error loading documentation module:', error);
                });
        }
    } catch (error) {
        addConsoleMessage(`❌ Error loading documentation section: ${error.message}`, 'error');
        console.error('Error loading documentation section:', error);
    }
}

/**
 * Get Ethereum address from private key
 * @param {string} privateKey - Private key to derive address from
 * @returns {string|null} - Ethereum address or null if error
 */
async function getAddressFromPrivateKey(privateKey) {
    try {
        // Remove '0x' prefix if present
        if (privateKey.startsWith('0x')) {
            privateKey = privateKey.slice(2);
        }
        
        // Use ipcRenderer to get the address from the main process
        // This helps avoid exposing the private key in the renderer
        return await ipcRenderer.invoke('validate-private-key', privateKey);
    } catch (error) {
        console.error('Error getting address from private key:', error);
        throw error;
    }
}

/**
 * Load a specific section of the documentation
 * @param {string} section - The section key to load
 */
function loadDocumentationSection(section) {
    try {
        const contentContainer = document.getElementById('doc-content-container');
        
        if (!contentContainer) {
            addConsoleMessage('❌ Documentation content container not found', 'error');
            return;
        }
        
        // Get content from documentation module
        if (window.documentation && typeof window.documentation.getContent === 'function') {
            const content = window.documentation.getContent(section);
            contentContainer.innerHTML = content;
            
            // Ensure the container has proper height for scrolling
            contentContainer.style.height = 'calc(100vh - 220px)';
            contentContainer.style.overflowY = 'auto';
            contentContainer.style.padding = '20px';
            
            // Make all links in documentation content open in default browser
            const links = contentContainer.querySelectorAll('a');
            links.forEach(link => {
                if (link.href && !link.href.startsWith('#') && !link.dataset.section) {
                    link.setAttribute('target', '_blank');
                }
            });
        } else {
            contentContainer.innerHTML = '<p>Documentation module not available</p>';
        }
    } catch (error) {
        addConsoleMessage(`❌ Error loading documentation section: ${error.message}`, 'error');
        console.error('Error loading documentation section:', error);
    }
}

// Initialize application
initializeUI();
setupEventListeners();

// Load token database silently
loadTokenDatabase();

// Initialize currency labels
updateCurrencyLabels();

// Initialize JeetBot Genesis handling
handleJeetGenesisChange();

function setupEventListeners() {
    // Bot navigation buttons
    elements.botNav.forEach(btn => {
        btn.addEventListener('click', () => {
            selectBot(btn.dataset.bot);
        });
    });
    
    // Stop button
    elements.stopBtn.addEventListener('click', stopBot);

    // Balance check button removed per user request

    // Modal close handlers
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeModal(e.target.id);
        }
    });

    // Console controls
    window.clearConsole = clearConsole;
    window.saveOutput = saveOutput;
    window.checkBalances = checkBalances;
    window.showQuickGuide = showQuickGuide;
    window.openDocs = openDocs;
    window.closeModal = closeModal;
    window.runBot = runBot;
    window.showConfig = showConfig;
    window.saveConfig = saveConfig;
    window.toggleBuyOptions = toggleBuyOptions;
window.toggleSellOptions = toggleSellOptions;
window.handleBuyTypeChange = handleBuyTypeChange;
window.handleSellTypeChange = handleSellTypeChange;
window.handleBuyCurrencyChange = handleBuyCurrencyChange;
window.handleSellCurrencyChange = handleSellCurrencyChange;
    window.updateBuyAmount = updateBuyAmount;
    window.updateSellAmount = updateSellAmount;
    window.updateGasPrice = updateGasPrice;
    window.updateGasLimit = updateGasLimit;
    window.confirmFSH = confirmFSH;
    window.executeFSH = executeFSH;
    window.selectAllTickers = selectAllTickers;
    window.clearAllTickers = clearAllTickers;
    window.addCustomTicker = addCustomTicker;
    window.toggleLogView = toggleLogView;
    window.selectAllWallets = selectAllWallets;
    window.clearAllWallets = clearAllWallets;
    window.handleContactCommand = handleContactCommand;
    window.handleJeetGenesisChange = handleJeetGenesisChange;
    window.handleTokenSearch = handleTokenSearch;
    window.handleTokenSearchEnter = handleTokenSearchEnter;
    window.addTokenFromSearch = addTokenFromSearch;
    window.detectWalletAddress = detectWalletAddress;
    window.updateCurrencyLabels = updateCurrencyLabels;
    window.handleMMChaseToggle = handleMMChaseToggle;
    window.toggleBidMode = toggleBidMode;
}

function setupIPCListeners() {
    // Bot output handler
    ipcRenderer.on('bot-output', (event, data) => {
        const { type, data: output, botType, ticker } = data;
        const className = type === 'stderr' ? 'stderr' : 'stdout';
        
        const message = output.trim();
        
        // Check if this is a transaction-related message we should always display
        const isTransactionRelated = (
            // Transaction execution and status indicators
            message.includes('Transaction execution') ||
            message.includes('Transaction hash:') ||
            message.includes('Success:') ||
            message.includes('Failed:') ||
            message.includes('Received:') ||
            message.includes('completed') ||
            message.includes('Confirmed') ||
            message.includes('PENDING') ||
            message.includes('CONFIRMED') ||
            message.includes('SUCCESSFUL') ||
            // Swap and trading information
            message.includes('Swapping') ||
            message.includes('Buying') ||
            message.includes('Selling') ||
            message.includes('tokens for') ||
            message.includes('ETH for') ||
            message.includes('EXECUTED TRADE') ||
            message.includes('Order placed') ||
            message.includes('Executed') ||
            // Loop and batch operations
            message.includes('LOOP') ||
            message.includes('loop') ||
            message.includes('Batch') ||
            // Critical infrastructure
            message.includes('TRUSTSWAP') ||
            message.includes('RPC USED:') ||
            message.includes('Gas price') ||
            message.includes('Tx Fee:') ||
            // Additional transaction details
            message.includes('0x') || // Any hex address or hash
            message.includes('ETH') ||
            message.includes('VIRTUAL') ||
            message.includes('TRUST') ||
            message.includes('Balance:') ||
            message.includes('Amount:') ||
            message.includes('Price:') ||
            message.includes('Slippage:') ||
            message.includes('Receipt:') ||
            message.includes('Status:') ||
            message.includes('Block:') ||
            message.includes('Nonce:') ||
            message.includes('Gas:') ||
            message.includes('Fee:') ||
            message.includes('Total:') ||
            message.includes('Wallet:') ||
            message.includes('Token:') ||
            message.includes('Contract:') ||
            message.includes('Pool:') ||
            message.includes('Pair:') ||
            message.includes('Router:') ||
            message.includes('Approve') ||
            message.includes('Transfer') ||
            message.includes('Swap') ||
            message.includes('Trade')
        );
        
        // Only filter out very specific verbose debug messages
        const shouldFilter = (
            // Only filter very specific debug patterns
            (message.startsWith('DEBUG:') && !message.includes('💡') && !message.includes('Transaction') && !message.includes('0x')) ||
            (message.includes('[DEBUG]') && !message.includes('💡') && !message.includes('Transaction') && !message.includes('0x')) ||
            // Filter only very specific wallet selection debug messages
            (message.includes('Parsing wallet selectors') && !message.includes('💡')) ||
            (message.includes('Getting token info for:') && !message.includes('💡')) ||
            (message.includes('Using default currency:') && !message.includes('💡'))
        );
        
        if (shouldFilter) {
            return; // Skip only very specific debug messages
        }
        
        // Add to detailed console (always keep full logs there)
        addDetailedConsoleMessage(message, className);
        
        // Generate sellbot transaction hash success message after confirmation (like buybot)
        if (message.includes('Transaction submitted via') && message.includes('0x')) {
            const txHashMatch = message.match(/0x[a-fA-F0-9]{64}/);
            if (txHashMatch) {
                const txHash = txHashMatch[0];
                // Store transaction hash for later success message generation
                window.pendingSellbotTx = txHash;
            }
        }
        
        // Generate success message when sellbot transaction is confirmed
        if (message.includes('Transaction confirmed in block') && window.pendingSellbotTx) {
            const blockMatch = message.match(/block (\d+)/);
            if (blockMatch) {
                const txHash = window.pendingSellbotTx;
                const shortHash = `${txHash.substring(0, 8)}...${txHash.substring(-6)}`;
                
                // Create sellbot success message with clickable hash (like buybot)
                const sellbotSuccessMessage = `✅ Success: ${txHash}`;
                
                // Add the success message to console
                setTimeout(() => {
                    addConsoleMessage(sellbotSuccessMessage, 'stdout');
                }, 100); // Small delay to ensure proper ordering
                
                // Clear pending transaction
                window.pendingSellbotTx = null;
            }
        }
        
        // Always use addConsoleMessage for transaction enhancement to work
        // The transaction enhancement will handle the formatting properly
        addConsoleMessage(message, className);
        
        // Auto-scroll console
        elements.console.scrollTop = elements.console.scrollHeight;
    });

    // Bot finished handler - enhanced for parallel execution
    ipcRenderer.on('bot-finished', (event, data) => {
        const { botType, code, output, error, ticker } = data;
        
        if (ticker) {
            // This is part of parallel execution
            parallelExecutionResults.set(ticker.symbol, {
                success: code === 0,
                code: code,
                output: output,
                error: error,
                ticker: ticker
            });
            
            parallelExecutionCount++;
            
            // Check if all parallel executions are complete
            if (parallelExecutionCount >= parallelExecutionTotal) {
                handleParallelExecutionComplete();
                // Auto-stop the bot after parallel execution completes
                setTimeout(() => {
                    stopBot();
                }, 1000);
            }
        } else {
            // Single execution
            if (code === 0) {
                addConsoleMessage(`${botType} completed successfully`, 'success');
            } else {
                addConsoleMessage(`${botType} failed with exit code ${code}`, 'error');
                if (error) {
                    addConsoleMessage(error, 'stderr');
                }
            }
            setBotRunning(false);
            // Auto-stop the bot after single execution completes
            setTimeout(() => {
                stopBot();
            }, 1000);
        }
    });

    // Automatic ticker update notification handler
    ipcRenderer.on('ticker-update-completed', (event, data) => {
        const { success, message, error } = data;
        
        if (success) {
            addConsoleMessage(`🔄 ${message}`, 'success');
            
            // Show a subtle notification badge or update indicator
            updateConnectionStatus('Token database updated');
        } else {
            addConsoleMessage(`⚠️ ${message}`, 'warning');
            if (error) {
                console.warn('Ticker update error details:', error);
            }
        }
    });

    // Console window close handler - sync state when window is closed via X button
    ipcRenderer.on('console-window-closed', () => {
        consoleWindowOpen = false;
        updateToggleButtonText();
    });
    // Clear console request handler - sync clear from detailed window
    ipcRenderer.on('clear-console-request', () => {
        clearConsole();
    });
}

// Transaction Console Enhancement
function enhanceTransactionMessages() {
    // Add transaction-specific styles if not already added
    if (!document.getElementById('tx-enhancement-styles')) {
        const txStyles = document.createElement('style');
        txStyles.id = 'tx-enhancement-styles';
        txStyles.textContent = `
            .tx-enhanced {
                background: linear-gradient(90deg, rgba(34, 197, 94, 0.1) 0%, rgba(34, 197, 94, 0.05) 100%);
                border-left: 3px solid #22c55e;
                padding: 8px 12px;
                margin: 2px 0;
                border-radius: 4px;
            }
            .tx-hash {
                font-family: 'Courier New', monospace;
                background: rgba(59, 130, 246, 0.1);
                padding: 2px 6px;
                border-radius: 3px;
                color: #60a5fa;
                font-size: 0.9em;
                word-break: break-all;
            }
            .tx-amount {
                background: rgba(168, 85, 247, 0.1);
                padding: 2px 6px;
                border-radius: 3px;
                color: #a855f7;
                font-weight: bold;
            }
            .tx-status-success {
                background: rgba(34, 197, 94, 0.1);
                padding: 2px 6px;
                border-radius: 3px;
                color: #22c55e;
                font-weight: bold;
            }
            .tx-status-pending {
                background: rgba(251, 191, 36, 0.1);
                padding: 2px 6px;
                border-radius: 3px;
                color: #fbbf24;
                font-weight: bold;
            }
            .tx-status-failed {
                background: rgba(239, 68, 68, 0.1);
                padding: 2px 6px;
                border-radius: 3px;
                color: #ef4444;
                font-weight: bold;
            }
        `;
        document.head.appendChild(txStyles);
    }
    
    // Set up MutationObserver to enhance new console messages on both consoles
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('console-line')) {
                        enhanceConsoleMessage(node);
                    }
                });
            }
        });
    });
    
    // Start observing both the main console and detailed console
    if (elements.console) {
        observer.observe(elements.console, { childList: true });
    }
    
    const detailedConsole = document.getElementById('console-detailed');
    if (detailedConsole) {
        observer.observe(detailedConsole, { childList: true });
    }
}

function enhanceConsoleMessage(lineElement) {
    const content = lineElement.textContent || '';
    
    // Check if this message contains transaction-related information
    const isTransactionMessage = (
        content.includes('0x') ||
        content.includes('Transaction') ||
        content.includes('Success') ||
        content.includes('Failed') ||
        content.includes('EXECUTED') ||
        content.includes('Swap') ||
        content.includes('Trade') ||
        content.includes('Receipt') ||
        content.includes('Gas') ||
        content.includes('Fee') ||
        content.includes('ETH') ||
        content.includes('VIRTUAL') ||
        content.includes('TRUST')
    );
    
    if (isTransactionMessage) {
        // Add enhanced styling class
        lineElement.classList.add('tx-enhanced');
        
        // Extract and enhance specific elements
        let enhancedHTML = lineElement.innerHTML;
        
        // Enhance transaction hashes (0x followed by 40+ hex characters)
        enhancedHTML = enhancedHTML.replace(/(0x[a-fA-F0-9]{40,})/g, '<span class="tx-hash">$1</span>');
        
        // Enhance amounts (numbers followed by ETH, VIRTUAL, etc.)
        enhancedHTML = enhancedHTML.replace(/(\d+(?:\.\d+)?\s*(?:ETH|VIRTUAL|TRUST))/gi, '<span class="tx-amount">$1</span>');
        
        // Enhance status indicators
        enhancedHTML = enhancedHTML.replace(/\b(SUCCESS|SUCCESSFUL|CONFIRMED)\b/gi, '<span class="tx-status-success">$1</span>');
        enhancedHTML = enhancedHTML.replace(/\b(PENDING|PROCESSING)\b/gi, '<span class="tx-status-pending">$1</span>');
        enhancedHTML = enhancedHTML.replace(/\b(FAILED|ERROR|REJECTED)\b/gi, '<span class="tx-status-failed">$1</span>');
        
        lineElement.innerHTML = enhancedHTML;
    }
}

function handleParallelExecutionComplete() {
    const results = Array.from(parallelExecutionResults.values());
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    // Show summary
    addConsoleMessage(`📊 Parallel execution completed: ✅ ${successful} successful, ❌ ${failed} failed`, 'info');
    
    // Show individual results
    results.forEach(result => {
        if (result.success) {
            addConsoleMessage(`✅ ${result.ticker.symbol}: completed successfully`, 'success');
        } else {
            addConsoleMessage(`❌ ${result.ticker.symbol}: failed (exit code ${result.code})`, 'error');
        }
    });
    
    // Reset parallel execution tracking
    parallelExecutionResults.clear();
    parallelExecutionCount = 0;
    parallelExecutionTotal = 0;
    
    setBotRunning(false);
}

// Track the last selected bot to prevent duplicate selection messages
let lastSelectedBot = null;

function selectBot(botType) {
    // Skip if selecting the same bot again to prevent duplicate messages
    if (botType === lastSelectedBot) {
        return;
    }
    lastSelectedBot = botType;
    
    // Initialize documentation if selected
    if (botType === 'documentation') {
        initDocumentation();
    }
    
    // Update navigation
    elements.botNav.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.bot === botType) {
            btn.classList.add('active');
        }
    });

    // Update forms
    elements.botForms.forEach(form => {
        form.classList.remove('active');
    });

    const targetForm = document.getElementById(`${botType}-form`);
    if (targetForm) {
        targetForm.classList.add('active');
    }

    // Handle Token Selection panel visibility
    const tokenSelectionPanel = document.querySelector('.ticker-selection-panel');
    if (tokenSelectionPanel) {
        if (botType === 'sellbot-fsh' || botType === 'jeetbot') {
            // Hide token selection for FSH mode and JeetBot
            tokenSelectionPanel.style.display = 'none';
            if (botType === 'sellbot-fsh') {
            addConsoleMessage('💥 FSH Mode: Token selection disabled - will scan all wallets automatically', 'info');
            } else {
                addConsoleMessage('🎯 JeetBot Mode: Token selection disabled - uses Genesis contract detection', 'info');
            }
        } else {
            // Show token selection for other bots
            tokenSelectionPanel.style.display = 'block';
        }
    }

    // Update header
    const config = botConfigs[botType];
    if (config) {
        elements.botTitle.textContent = config.title;
        elements.botDescription.textContent = config.description;
    }

    currentBot = botType;
    addConsoleMessage(`Selected ${botType.toUpperCase()}`, 'info');
}

async function runBot(botType, customArgs = null) {
    if (isRunning) {
        addConsoleMessage('Another bot is already running. Please stop it first.', 'error');
        return;
    }
    
    // Ensure we have the latest tokens from persistence before checking
    if (window.TokenPersistence && typeof window.TokenPersistence.loadTokens === 'function') {
        const persistedTokens = window.TokenPersistence.loadTokens();
        if (persistedTokens && persistedTokens.length > 0) {
            selectedTickers = [...persistedTokens];
            console.log(`Loaded ${selectedTickers.length} tokens from persistence for bot execution`);
        }
    }

    // Utility bots that don't require ticker selection (including FSH mode)
    const utilityBots = ['transferbot', 'stargate', 'contactbot', 'detect', 'ticker-search', 'ticker-fetch', 'ticker-export', 'ticker-runall', 'sellbot-fsh'];
    
    if (utilityBots.includes(botType)) {
        // Handle utility bots separately
        try {
            setBotRunning(true);
            
            // Update gas price when starting bot
            updateAllGasPriceDisplays();
            
            let args = [];
            if (customArgs) {
                args = [...customArgs];
            } else {
                // Get arguments based on utility bot type
                switch (botType) {
                    case 'transferbot':
                        args = getTransferBotArgs();
                        break;
                    case 'stargate':
                        args = getStargateBridgeArgs();
                        break;
                    case 'contactbot':
                        args = getContactBotArgs();
                        break;
                    case 'detect':
                        const detectMode = document.getElementById('detect-mode').value;
                        if (detectMode === 'quick') {
                            botType = 'detect-quick'; // Use different npm script
                        }
                        args = getTokenDetectorArgs();
                        break;
                    case 'ticker-search':
                        args = getTickerSearchArgs();
                        break;
                    case 'ticker-fetch':
                        args = getTickerFetchArgs();
                        break;
                    case 'ticker-export':
                        args = getTickerExportArgs();
                        break;
                    case 'ticker-runall':
                        args = getTickerRunAllArgs();
                        break;
                    case 'sellbot-fsh':
                        // FSH mode - use sellbot with fsh argument
                        const gasPrice = await window.getCurrentGasPrice('sellbot');
                        args = [];
                        
                        // Add wallet selection (B1 B2 B3 format)
                        if (selectedWallets.size > 0) {
                            const walletSelectors = Array.from(selectedWallets)
                                .map(index => `B${index + 1}`)
                                .sort(); // Sort to ensure consistent order
                            args.push(...walletSelectors);
                        }
                        
                        // FSH command
                        args.push('fsh');
                        
                        // Gas price
                        if (gasPrice) {
                            args.push(`gas${gasPrice}`);
                        }
                        
                        // Add BID-MODE if active
                        if (isBidModeActive) {
                            args.push('BID-MODE');
                        }
                        
                        // Change bot type to sellbot for execution
                        botType = 'sellbot';
                        break;
                }
            }

            if (args === null) {
                setBotRunning(false);
                return; // Error message already shown in get*Args functions
            }

            addConsoleMessage(`Starting ${botType.toUpperCase()}`, 'info');
            
            // Run the utility bot
            await ipcRenderer.invoke('run-bot', botType, args);
            
        } catch (error) {
            addConsoleMessage(`Failed to start ${botType}: ${error.message}`, 'error');
            setBotRunning(false);
        }
        return;
    }

    // Check if tickers are selected for trading bots (except JeetBot and FSH mode)
    const isJeetBot = botType === 'jeetbot';
    const isFSHMode = botType === 'sellbot-fsh';
    
    // Debug logging
    console.log('runBot debug:', {
        botType,
        selectedTickers: selectedTickers,
        selectedTickersLength: selectedTickers.length,
        isJeetBot,
        isFSHMode
    });
    
    if (selectedTickers.length === 0 && !isJeetBot && !isFSHMode) {
        addConsoleMessage('Please select at least one token to trade', 'error');
        return;
    }

    // Check if wallets are available and selected for trading bots
    if (availableWallets.length === 0) {
        addConsoleMessage('⚠️ No wallets configured. Please set up your wallets first.', 'error');
        return;
    }
    
    if (selectedWallets.size === 0) {
        addConsoleMessage('⚠️ Please select at least one wallet to use for trading.', 'error');
        return;
    }

    try {
        setBotRunning(true);
        
        // Update gas price when starting bot
        updateAllGasPriceDisplays();
        
        // Handle multiple tickers (or JeetBot with Genesis Contract which doesn't need tickers)
        if (selectedTickers.length > 1) {
            addConsoleMessage(`Starting ${botType.toUpperCase()} for ${selectedTickers.length} tokens in single command`, 'info');
            
                let args = [];
                
                if (customArgs) {
                    args = [...customArgs];
                } else {
                // Create single command with all tokens for supported bots
                    switch (botType) {
                        case 'buybot':
                            args = await getBuyBotArgsMultiTicker(selectedTickers);
                            break;
                        case 'sellbot':
                            args = await getSellBotArgsMultiTicker(selectedTickers);
                            break;
                        case 'farmbot':
                        // FarmBot only supports one token at a time
                        addConsoleMessage('⚠️ FarmBot only supports one token at a time. Please select a single token.', 'warning');
                        setBotRunning(false);
                        return;
                        case 'mmbot':
                        // MMBot only supports one token at a time
                        addConsoleMessage('⚠️ MMBot only supports one token at a time. Please select a single token.', 'warning');
                        setBotRunning(false);
                        return;
                        case 'jeetbot':
                        // JeetBot doesn't use ticker selection
                        args = getJeetBotArgs();
                            break;
                    }
                }
                
            if (!args) {
                setBotRunning(false);
                return; // Error message already shown in get*Args functions
            }

            // Display combined command info
            const tokenList = selectedTickers.map(t => t.symbol || t.address).join(', ');
            addConsoleMessage(`📦 Combined command for tokens: ${tokenList}`, 'info');
            
            // Run single bot command with all tokens
            await ipcRenderer.invoke('run-bot', botType, args);
        } else {
            // Single ticker (or JeetBot with Genesis Contract)
            const ticker = selectedTickers[0] || null; // ticker can be null for JeetBot with Genesis
            let args = [];
            
            if (customArgs) {
                args = customArgs;
            } else {
                // Collect arguments based on bot type
                switch (botType) {
                    case 'buybot':
                        args = getBuyBotArgsForTicker(ticker);
                        break;
                    case 'sellbot':
                        args = getSellBotArgsForTicker(ticker);
                        break;
                    case 'farmbot':
                        args = getFarmBotArgsForTicker(ticker);
                        break;
                    case 'mmbot':
                        args = getMMBotArgsForTicker(ticker);
                        break;
                    case 'jeetbot':
                        args = getJeetBotArgsForTicker(ticker);
                        break;
                }
            }

            if (!args) {
                setBotRunning(false);
                return; // Error message already shown in get*Args functions
            }

            // Display appropriate message based on bot type and configuration
            if (isJeetBot) {
                const genesisContract = document.getElementById('jeet-genesis').value.trim();
                addConsoleMessage(`Starting ${botType.toUpperCase()} with Genesis Contract: ${genesisContract.substring(0, 8)}...`, 'info');
            } else {
                addConsoleMessage(`Starting ${botType.toUpperCase()} for ${ticker.symbol || ticker}`, 'info');
            }
            
            // Run the bot
            await ipcRenderer.invoke('run-bot', botType, args);
        }
        
    } catch (error) {
        addConsoleMessage(`Failed to start ${botType}: ${error.message}`, 'error');
        setBotRunning(false);
    }
}

async function getBuyBotArgs() {
    if (selectedTickers && selectedTickers.length > 0) {
        return await getBuyBotArgsMultiTicker(selectedTickers);
    } else {
        addConsoleMessage('❌ Please select at least one token', 'error');
        return null;
    }
}

/**
 * Create BuyBot arguments for multiple tokens in a single command
 * Format: [wallets] [tokens...] [amounts...] [C-currency] [L-loops] [slow] [gas]
 * @param {Array} tickers - Array of selected ticker objects
 * @returns {Array|null} Arguments array or null on error
 */
async function getBuyBotArgsMultiTicker(tickers) {
    const amount = document.getElementById('buy-amount')?.value?.trim() || '100';
    
    // Determine buy type from checkboxes
    const twapCheckbox = document.getElementById('buy-type-twap');
    const buyType = (twapCheckbox && twapCheckbox.checked) ? 'twap' : 'normal';
    
    // Determine currency from checkboxes
    const ethCheckbox = document.getElementById('buy-currency-eth');
    const currency = (ethCheckbox && ethCheckbox.checked) ? 'ETH' : 'VIRTUAL';
    
    const gasPrice = await window.getCurrentGasPrice('buybot');

    if (buyType === 'twap' && tickers.length > 1) {
        addConsoleMessage('❌ TWAP mode only supports single token trading', 'error');
        return null;
    }

    // Regular Mode: [wallets] [tokens...] [amounts...] [C-currency] [L-loops] [slow] [gas]
    const args = [];
    
    // Add wallet selection (B1 B2 B3 format)
    if (selectedWallets.size > 0) {
        const walletSelectors = Array.from(selectedWallets)
            .map(index => `B${index + 1}`)
            .sort(); // Sort to ensure consistent order
        args.push(...walletSelectors);
    }
    
    // Add all tokens
    tickers.forEach(ticker => {
        args.push(ticker.symbol || ticker.address);
    });
    
    // Add amounts for each token (same amount for all)
    const finalAmount = amount || '100'; // Default amount
    const processedAmount = finalAmount === 'MAX' ? '99.99%' : finalAmount;
    
    tickers.forEach(() => {
        args.push(processedAmount);
    });
    
    // Currency (if ETH selected, add ETH parameter)
    if (currency === 'ETH') {
        args.push('ETH');
    }
    
    // Force sequential execution with 3-5s delay for safety
    args.push('slow');
    
    // Gas price
    if (gasPrice) {
        args.push(`gas${gasPrice}`);
    }

    return args;
}

async function getSellBotArgs() {
    if (selectedTickers && selectedTickers.length > 0) {
        return await getSellBotArgsMultiTicker(selectedTickers);
    } else {
        addConsoleMessage('❌ Please select at least one token', 'error');
        return null;
    }
}

/**
 * Create SellBot arguments for multiple tokens in a single command
 * Format: [wallets] [tokens...] [amounts...] [L-loops] [currency] [slow] [gas]
 * @param {Array} tickers - Array of selected ticker objects
 * @returns {Array|null} Arguments array or null on error
 */
async function getSellBotArgsMultiTicker(tickers) {
    const amount = document.getElementById('sell-amount')?.value?.trim() || '50%';
    
    // Determine sell type from checkboxes
    const twapCheckbox = document.getElementById('sell-type-twap');
    const sellType = (twapCheckbox && twapCheckbox.checked) ? 'twap' : 'normal';
    
    // Determine currency from checkboxes
    const ethCheckbox = document.getElementById('sell-currency-eth');
    const currency = (ethCheckbox && ethCheckbox.checked) ? 'ETH' : 'VIRTUAL';
    
    const gasPrice = await window.getCurrentGasPrice('sellbot');

    if (sellType === 'twap' && tickers.length > 1) {
        addConsoleMessage('❌ TWAP mode only supports single token trading', 'error');
        return null;
    }

    // Regular Mode: [wallets] [tokens...] [amounts...] [L-loops] [currency] [slow] [gas]
    const args = [];
    
    // Add wallet selection (B1 B2 B3 format)
    if (selectedWallets.size > 0) {
        const walletSelectors = Array.from(selectedWallets)
            .map(index => `B${index + 1}`)
            .sort(); // Sort to ensure consistent order
        args.push(...walletSelectors);
    }
    
    // Add all tokens
    tickers.forEach(ticker => {
        args.push(ticker.symbol || ticker.address);
    });
    
    // Add amounts for each token (same amount for all)
    const finalAmount = amount || '50%'; // Default percentage for sell
    const processedAmount = finalAmount === 'MAX' ? '99.99%' : finalAmount;
    
    tickers.forEach(() => {
        args.push(processedAmount);
    });
    
    // Currency (if ETH selected, add ETH parameter)
    if (currency === 'ETH') {
        args.push('ETH');
    }
    
    // Gas price
    if (gasPrice) {
        args.push(`gas${gasPrice}`);
    }

    return args;
}

function getFarmBotArgs() {
    const token = document.getElementById('farm-token').value.trim();
    const amount = document.getElementById('farm-amount').value.trim();
    const loops = document.getElementById('farm-loops').value.trim();

    if (!token) {
        addConsoleMessage('❌ Please enter a token address', 'error');
        return null;
    }

    const args = [token];
    if (amount) {
        args.push(amount);
    }
    if (loops) {
        args.push(loops);
    }

    return args;
}



function getMMBotArgs() {
    const virtualAmount = document.getElementById('mm-virtual-amount').value.trim();
    const tokenAmount = document.getElementById('mm-token-amount').value.trim();
    const lowerRange = document.getElementById('mm-lower-range').value.trim();
    const higherRange = document.getElementById('mm-higher-range').value.trim();
    const interval = document.getElementById('mm-interval').value.trim();
    const loops = document.getElementById('mm-loops').value.trim();
    const gasPrice = document.getElementById('mm-gas-price').value.trim();

    // Check if required fields are filled
    if (!virtualAmount || !tokenAmount || !lowerRange || !higherRange) {
        addConsoleMessage('❌ Please fill in all required fields: V-amount, T-amount, RL-range, RH-range', 'error');
        return null;
    }

    const args = [];
    
    // Add wallet selection
    if (selectedWallets.size > 0) {
        const walletSelectors = Array.from(selectedWallets)
            .map(index => `B${index + 1}`)
            .sort();
        args.push(...walletSelectors);
    }
    
    // Get selected ticker/token
    if (selectedTickers.length === 0) {
        addConsoleMessage('❌ Please select at least one token from the ticker selection', 'error');
        return null;
    }
    
    // Add token (use first selected ticker)
    const token = selectedTickers[0];
    args.push(token.symbol || token.address);
    
    // Add V-amount (format as V-X)
    let vAmount = virtualAmount;
    if (!vAmount.startsWith('V-') && !vAmount.startsWith('v-')) {
        vAmount = `V-${vAmount}`;
    }
    args.push(vAmount);
    
    // Add T-amount (format as T-X)
    let tAmount = tokenAmount;
    if (!tAmount.startsWith('T-') && !tAmount.startsWith('t-')) {
        tAmount = `T-${tAmount}`;
    }
    args.push(tAmount);
    
    // Add RL-range (format as RL-X%)
    let rlRange = lowerRange;
    if (!rlRange.startsWith('RL-') && !rlRange.startsWith('rl-')) {
        if (!rlRange.includes('%')) {
            rlRange = `${rlRange}%`;
        }
        rlRange = `RL-${rlRange}`;
    }
    args.push(rlRange);
    
    // Add RH-range (format as RH-X%)
    let rhRange = higherRange;
    if (!rhRange.startsWith('RH-') && !rhRange.startsWith('rh-')) {
        if (!rhRange.includes('%')) {
            rhRange = `${rhRange}%`;
        }
        rhRange = `RH-${rhRange}`;
    }
    args.push(rhRange);
    
    // Add I-interval (format as I-X)
    if (interval && parseFloat(interval) !== 1) {
        let iInterval = interval;
        if (!iInterval.startsWith('I-') && !iInterval.startsWith('i-')) {
            iInterval = `I-${iInterval}`;
        }
        args.push(iInterval);
    }
    
    // Add L-loops (format as L-X) - only if provided
    if (loops && parseInt(loops) > 0) {
        let lLoops = loops;
        if (!lLoops.startsWith('L-') && !lLoops.startsWith('l-')) {
            lLoops = `L-${lLoops}`;
        }
        args.push(lLoops);
    }
    
    // Add CHASE mode
    const isChaseMode = document.getElementById('mm-mode-chase').checked;
    if (isChaseMode) {
        args.push('CHASE');
    }
    
    // Add gas price
    if (gasPrice && gasPrice !== '0.02') {
        args.push(`gas${gasPrice}`);
    }

    return args;
}



function getJeetBotArgs() {
    console.log('🔍 DEBUG: getJeetBotArgs() called - Function #1 (line 1668) with REBUY logic');
    const genesisEl = document.getElementById('jeet-genesis');
    const basicModeEl = document.getElementById('jeet-mode-basic');
    const rebuyModeEl = document.getElementById('jeet-mode-rebuy-old'); 
    const delayEl = document.getElementById('jeet-delay');
    
    if (!genesisEl || !basicModeEl || !rebuyModeEl || !delayEl) {
        addConsoleMessage('❌ JeetBot form elements not found', 'error');
        return null;
    }
    
    const genesis = genesisEl.value.trim();
    const basicMode = basicModeEl.checked;
    const rebuyMode = rebuyModeEl.checked;
    const delay = delayEl.value.trim();
    
    // Get gas price from radio buttons
    const selectedGasOption = document.querySelector('input[name="jeet-gas-option"]:checked');
    let gasPrice = '0.06'; // Default
    if (selectedGasOption) {
        if (selectedGasOption.value === 'custom') {
            const customGasEl = document.getElementById('jeet-custom-gas');
            gasPrice = customGasEl ? (customGasEl.value.trim() || '0.06') : '0.06';
        } else {
            gasPrice = selectedGasOption.value;
        }
    }
    
    // Get REBUY settings if REBUY mode is selected
    let rebuyPercentage = '';
    let rebuyInterval = '';
    
    if (rebuyMode) {
        // Get percentage from radio buttons
        const selectedPercentageOption = document.querySelector('input[name="jeet-rebuy-percentage-option"]:checked');
        if (selectedPercentageOption) {
            if (selectedPercentageOption.value === 'custom') {
                // Use custom field value
                const customPercentageEl = document.getElementById('jeet-rebuy-percentage');
                rebuyPercentage = customPercentageEl ? customPercentageEl.value.trim() : '30%';
                // Ensure % is added if not present
                if (rebuyPercentage && !rebuyPercentage.includes('%')) {
                    rebuyPercentage = `${rebuyPercentage}%`;
                }
            } else {
                // Use preset value
                rebuyPercentage = selectedPercentageOption.value;
            }
        } else {
            rebuyPercentage = '30%'; // Default
        }
        
        // Get interval from radio buttons (hardcode mapping, compare as string)
        const selectedIntervalOption = document.querySelector('input[name="jeet-rebuy-interval-option"]:checked');
        if (selectedIntervalOption) {
            const intervalValue = selectedIntervalOption.value;
            if (intervalValue === '2') {
                rebuyInterval = '0.032';
            } else if (intervalValue === '1') {
                rebuyInterval = '0.016';
            } else if (intervalValue === '0.5') {
                rebuyInterval = '0.008';
        } else {
                rebuyInterval = '0.032'; // Default to 2s
            }
        } else {
            rebuyInterval = '0.032'; // Default
        }
    }

    if (!genesis) {
        addConsoleMessage('❌ Please enter a Genesis ticker or contract address', 'error');
        return null;
    }

    // Determine if input is a ticker or contract address
    let processedGenesis = genesis;
    if (genesis.startsWith('0x') && genesis.length === 42) {
        // Contract address - use as is
        processedGenesis = genesis;
    } else if (genesis.length > 1 && !genesis.startsWith('0x')) {
        // Ticker symbol - add G- prefix for JeetBot
        processedGenesis = `G-${genesis}`;
    }

    const args = [processedGenesis];
    
    // Determine mode
    if (rebuyMode) {
        args.push('JEET');
        args.push('REBUY');
        
        // Add REBUY percentage
        if (rebuyPercentage) {
            args.push(rebuyPercentage);
        } else {
            args.push('30%'); // Default
        }
        
        // Add REBUY interval (I-X format)
        args.push(`I-${rebuyInterval}`);
    } else {
        args.push('JEET');
    }
    
    // Add delay if specified (D-X format)
    if (delay && parseInt(delay) > 0) {
        args.push(`D-${delay}`);
    }
    
    // Add gas price (always add it, not just when different from default)
    args.push(`gas${gasPrice}`);

    return args;
}

async function stopBot() {
    if (!isRunning) {
        addConsoleMessage('❌ No bot is currently running', 'warning');
        return;
    }

    try {
        addConsoleMessage('🛑 Stopping bot...', 'warning');
        const result = await ipcRenderer.invoke('stop-bot');
        
        if (result.success) {
            addConsoleMessage('✅ Bot stopped successfully', 'success');
        } else {
            addConsoleMessage(`❌ ${result.message}`, 'warning');
        }
        
        setBotRunning(false);
    } catch (error) {
        addConsoleMessage(`❌ Failed to stop bot: ${error.message}`, 'error');
    }
}

function setBotRunning(running) {
    isRunning = running;
    elements.stopBtn.disabled = !running;
    
    if (running) {
        elements.activeBot.textContent = `🟢 ${currentBot?.toUpperCase() || 'Unknown'}`;
        elements.activeBot.classList.add('status-running');
    } else {
        elements.activeBot.textContent = '⭕ None';
        elements.activeBot.classList.remove('status-running');
    }
}

async function checkBalances() {
    try {
        addConsoleMessage('💰 Checking wallet balances...', 'info');
        
        const result = await ipcRenderer.invoke('check-balances');
        
        if (result.success) {
            if (result.balances) {
                showBalanceModal(result.balances);
            } else {
                addConsoleMessage('✅ Balance check completed', 'success');
                addConsoleMessage(result.output, 'stdout');
            }
        } else {
            addConsoleMessage('❌ Balance check failed', 'error');
        }
    } catch (error) {
        addConsoleMessage(`❌ Balance check error: ${error.message}`, 'error');
    }
}

function showBalanceModal(balances) {
    const modal = document.getElementById('balance-modal');
    const content = document.getElementById('balance-content');
    
    if (Array.isArray(balances)) {
        let html = '<table class="balance-table">';
        html += '<thead><tr><th>Wallet</th><th>Token</th><th>Balance</th></tr></thead><tbody>';
        
        balances.forEach(balance => {
            html += `<tr>
                <td>${balance.wallet || 'N/A'}</td>
                <td>${balance.token || 'N/A'}</td>
                <td>${balance.balance || 'N/A'}</td>
            </tr>`;
        });
        
        html += '</tbody></table>';
        content.innerHTML = html;
    } else {
        content.innerHTML = `<pre>${JSON.stringify(balances, null, 2)}</pre>`;
    }
    
    modal.style.display = 'block';
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Formats transaction information for better display in the console
 * Extracts and highlights important transaction details
 * @param {string} message - The original transaction message
 * @returns {string} - Formatted transaction message
 */
function formatTransactionInfo(message) {
    // Extract transaction hash if present
    let txHash = '';
    const txHashMatch = message.match(/(?:0x[a-fA-F0-9]{64})/g);
    if (txHashMatch) {
        txHash = txHashMatch[0];
    }
    
    // Format different types of transaction messages
    if (message.includes('Transaction execution')) {
        // Extract status
        let status = 'PENDING';
        if (message.toLowerCase().includes('success')) status = 'SUCCESS';
        if (message.toLowerCase().includes('fail')) status = 'FAILED';
        
        // Clean the message but preserve important details
        let clean = message
            .replace(/[^\w\s\.\-\:\(\)\[\]\/\\%]/g, '') // Remove emojis
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
            
        // Add status highlight
        return `TRANSACTION [${status}] ${clean} ${txHash ? `- Hash: ${txHash}` : ''}`;
    }
    
    // Format swap operations
    else if (message.includes('Swapping') || message.includes('Buying') || message.includes('Selling')) {
        // Extract token info if present
        const tokenMatch = message.match(/for ([\d\.]+) ([A-Za-z0-9]+)/i);
        const amountMatch = message.match(/([\d\.]+) tokens/i);
        
        let amountInfo = '';
        if (tokenMatch) {
            amountInfo = `Amount: ${tokenMatch[1]} ${tokenMatch[2]}`;
        } else if (amountMatch) {
            amountInfo = `Amount: ${amountMatch[1]}`;
        }
        
        // Clean and format
        let clean = message
            .replace(/[^\w\s\.\-\:\(\)\[\]\/\\%]/g, '') // Remove emojis
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
        
        return `TRADE OPERATION: ${clean} ${amountInfo ? `[${amountInfo}]` : ''}`;
    }
    
    // Format executed trades
    else if (message.includes('EXECUTED TRADE')) {
        // Clean and highlight
        let clean = message
            .replace(/[^\w\s\.\-\:\(\)\[\]\/\\%]/g, '') // Remove emojis
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
            
        return `✅ ${clean} ${txHash ? `- Hash: ${txHash}` : ''}`;
    }
    
    // Default formatting for other transaction messages
    else {
        // Basic cleaning
        return message
            .replace(/[^\w\s\.\-\:\(\)\[\]\/\\%]/g, '') // Remove emojis
            .replace(/\b(amazing|awesome|great|excellent|fantastic|perfect|wow|cool|exciting|incredible)\b/gi, '') // Remove marketing words
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }
}

function addConsoleMessage(message, type = 'stdout') {
    const timestamp = new Date().toLocaleTimeString();
    
    // DEBUG: Log all success messages
    if (message.includes('Success:') && message.includes('0x')) {
        console.log('🔍 MAIN CONSOLE - SUCCESS MESSAGE:', {
            message: message.substring(0, 100) + '...',
            fullLength: message.length,
            timestamp: new Date().toISOString()
        });
    }
    
    // Always send to popup window first (detailed view gets everything)
    addMessageToPopup(message, type);
    
    // Create condensed and cleaned messages for main console
    let processedMessage = message;
    
    // Clean up buying/selling messages to remove slippage and fee details
    if (message.includes('Buying') && message.includes('VIRTUAL') && message.includes('Expected:')) {
        // Extract key info: token, amount, expected tokens - handle all number formats
        const tokenMatch = message.match(/Buying (\w+)/);
        // More flexible regex: handles 1, 1.0, 1.5, 0.5, 10.25, etc.
        const amountMatch = message.match(/(\d*\.?\d+) VIRTUAL/);
        const expectedMatch = message.match(/Expected: (\d*\.?\d+) (\w+)/);
        
        if (tokenMatch && amountMatch && expectedMatch) {
            const token = tokenMatch[1];
            const amount = amountMatch[1];
            const expectedAmount = expectedMatch[1];
            const expectedToken = expectedMatch[2];
            processedMessage = `<span style="color: #58a6ff; font-weight: 500;">📈 BUY</span> <span style="color: #f85149; font-weight: 600;">${token}</span> <span style="color: #7c3aed;">→</span> <span style="color: #a5a5a5;">${amount} VIRTUAL</span> <span style="color: #56d364; font-size: 0.9em;">(exp: ${expectedAmount} ${expectedToken})</span>`;
        }
    }
    
    // Clean up selling messages similarly
    if (message.includes('Selling') && message.includes('Expected:')) {
        // Extract key info: token, amount, expected tokens - handle all number formats
        const tokenMatch = message.match(/Selling (\d*\.?\d+) (\w+)/);
        const expectedMatch = message.match(/Expected: (\d*\.?\d+) (\w+)/);
        
        if (tokenMatch && expectedMatch) {
            const amount = tokenMatch[1];
            const token = tokenMatch[2];
            const expectedAmount = expectedMatch[1];
            const expectedToken = expectedMatch[2];
            processedMessage = `<span style="color: #f85149; font-weight: 500;">📉 SELL</span> <span style="color: #58a6ff; font-weight: 600;">${amount} ${token}</span> <span style="color: #7c3aed;">→</span> <span style="color: #56d364; font-size: 0.9em;">(exp: ${expectedAmount} ${expectedToken})</span>`;
        }
    }
    
    // Format JeetBot error messages for main console (trim to essential info with red styling)
    if (message.includes('🔍 Ticker "') && message.includes('" not found')) {
        const tickerMatch = message.match(/🔍 Ticker "([^"]+)" not found/);
        if (tickerMatch) {
            const ticker = tickerMatch[1];
            processedMessage = `<span style="color: #f85149; font-weight: 500;">❌ Ticker "${ticker}" not found - check spelling or try contract address</span>`;
        }
    } else if (message.includes('🔍 Token contract address "') && message.includes('" is invalid')) {
        const caMatch = message.match(/🔍 Token contract address "([^"]+)" is invalid/);
        if (caMatch) {
            const contractAddress = caMatch[1];
            const displayCA = contractAddress.length > 20 ? 
                contractAddress.slice(0, 10) + '...' + contractAddress.slice(-6) : 
                contractAddress;
            processedMessage = `<span style="color: #f85149; font-weight: 500;">❌ Contract "${displayCA}" invalid - verify address or use ticker</span>`;
        }
    }
    
    // Clean up farmbot loop messages
    if (message.includes('LOOP') && message.includes('/') && message.includes('WALLET:')) {
        // Extract loop info: "LOOP 1/2 [Loop 1] WALLET: B1 (0x13e46c...) Progress: Loop 1/2 Wallet 1/1 Amount: 0.9 VIRTUAL"
        const loopMatch = message.match(/LOOP (\d+)\/(\d+)/);
        const amountMatch = message.match(/Amount: (\d*\.?\d+) (\w+)/);
        const walletMatch = message.match(/WALLET: (\w+)/);
        
        if (loopMatch && amountMatch && walletMatch) {
            const currentLoop = loopMatch[1];
            const totalLoops = loopMatch[2];
            const amount = amountMatch[1];
            const token = amountMatch[2];
            const wallet = walletMatch[1];
            processedMessage = `<span style="color: #a5a5a5; font-weight: 500;">🌱 FARM</span> <span style="color: #58a6ff; font-weight: 600;">Loop ${currentLoop}/${totalLoops}</span> <span style="color: #7c3aed;">•</span> <span style="color: #f85149;">${wallet}</span> <span style="color: #56d364;">${amount} ${token}</span>`;
        }
    }
    
    // Clean up Progress: Loop messages (simpler format)
    if (message.includes('Progress: Loop') && message.includes('Wallet')) {
        // Extract info: "Progress: Loop 20/100 Wallet 1/1" or longer format with Amount
        const progressMatch = message.match(/Progress: Loop (\d+)\/(\d+) Wallet (\d+)\/(\d+)/);
        const amountMatch = message.match(/Amount: ([\d.]+) (\w+)/);
        
        if (progressMatch) {
            const currentLoop = progressMatch[1];
            const totalLoops = progressMatch[2];
            const currentWallet = progressMatch[3];
            const totalWallets = progressMatch[4];
            
            let amountInfo = '';
            if (amountMatch) {
                const amount = amountMatch[1];
                const token = amountMatch[2];
                amountInfo = ` <span style="color: #56d364;">${amount} ${token}</span>`;
            }
            
            processedMessage = `<span style="color: #a5a5a5; font-weight: 500;">🌱 FARM</span> <span style="color: #58a6ff; font-weight: 600;">Loop ${currentLoop}/${totalLoops}</span> <span style="color: #7c3aed;">•</span> <span style="color: #f85149;">Wallet ${currentWallet}/${totalWallets}</span>${amountInfo}`;
        }
    }
    
    // Clean up wallet loading messages to be more concise
    if (message.includes('✅ Loaded wallet:') && message.includes('ENV')) {
        // Extract wallet info: "✅ Loaded wallet: test1 (0x13e4...fa42) [ ENV]"
        const walletMatch = message.match(/Loaded wallet: (\w+) \(([^)]+)\)/);
        if (walletMatch) {
            const walletName = walletMatch[1];
            const address = walletMatch[2];
            processedMessage = `<span style="color: #56d364; font-weight: 500;">🔑 WALLET</span> <span style="color: #58a6ff; font-weight: 600;">${walletName}</span> <span style="color: #a5a5a5; font-size: 0.9em;">(${address})</span> <span style="color: #56d364;">✓ Ready</span>`;
        }
    }
    
    // Check if this is a transaction success message that needs condensing
    if (message.includes('Success:') && message.includes('0x')) {
        const txHashMatch = message.match(/0x[a-fA-F0-9]{64}/);
        if (txHashMatch) {
            const txHash = txHashMatch[0];
            const shortHash = `${txHash.substring(0, 8)}...${txHash.substring(-6)}`;
            
            // Extract token info if present (for multi-line messages)
            let tokenInfo = '';
            if (message.includes('Actual tokens received:')) {
                const tokenMatch = message.match(/Actual tokens received: ([\d\.]+) ([A-Z$]+)/);
                if (tokenMatch) {
                    tokenInfo = ` • Received ${tokenMatch[1]} ${tokenMatch[2]}`;
                }
            }
            
            // Create condensed message with clickable link
            processedMessage = `<span style="color: #56d364; font-weight: 500;">✅ SUCCESS</span> <a href="https://basescan.org/tx/${txHash}" target="_blank" style="color: #58a6ff; text-decoration: none; font-weight: 600; border-bottom: 1px dotted #58a6ff;">${shortHash}</a> <span style="color: #a5a5a5; font-size: 0.9em;">View on Basescan</span>${tokenInfo}`;
        }
    }
    
    // Check if this is a transaction confirmation message
    if (message.includes('CONFIRMED Block') && message.includes('Transaction mined')) {
        const blockMatch = message.match(/Block (\d+)/);
        if (blockMatch) {
            const blockNumber = blockMatch[1];
            processedMessage = `<span style="color: #56d364; font-weight: 500;">✅ CONFIRMED</span> <span style="color: #58a6ff; font-weight: 600;">Block #${blockNumber}</span> <span style="color: #a5a5a5; font-size: 0.9em;">Transaction mined</span>`;
        }
    }
    
    // Check if this is an actual tokens received message (buybot format)
    if (message.includes('Actual tokens received:')) {
        const tokensMatch = message.match(/Actual tokens received: (\d*\.?\d+) (\w+)/);
        if (tokensMatch) {
            const amount = tokensMatch[1];
            const token = tokensMatch[2];
            processedMessage = `<span style="color: #56d364; font-weight: 500;">✓ RECEIVED</span> <span style="color: #58a6ff; font-weight: 600;">${amount} ${token}</span> <span style="color: #a5a5a5; font-size: 0.9em;">tokens received</span>`;
        }
    }
    
    // Sellbot messages are now filtered out in favor of cleaner ✅ SUCCESS messages with clickable hashes
    
    // Sellbot transaction confirmation messages are now filtered out as redundant
    
    // Handle farmbot loop messages with consistent styling
    if (message.includes('LOOP') && message.includes('/')) {
        const loopMatch = message.match(/LOOP (\d+)\/(\d+)/);
        if (loopMatch) {
            const currentLoop = loopMatch[1];
            const totalLoops = loopMatch[2];
            processedMessage = `<span style="color: #a5a5a5; font-weight: 500;">🔄 LOOP</span> <span style="color: #bc7df7; font-weight: 600;">${currentLoop}/${totalLoops}</span>`;
        } else {
            // Handle simple LOOP X format
            const simpleLoopMatch = message.match(/LOOP (\d+)/);
            if (simpleLoopMatch) {
                const loopNum = simpleLoopMatch[1];
                processedMessage = `<span style="color: #a5a5a5; font-weight: 500;">🔄 LOOP</span> <span style="color: #bc7df7; font-weight: 600;">${loopNum}</span>`;
            }
        }
    }
    
    // Handle farmbot cycle completion messages (including timestamp-prefixed ones)
    if (message.includes('Farm cycle completed') || message.includes('CYCLE Farm cycle completed') || 
        (message.match(/\[\d{1,2}:\d{2}:\d{2} [AP]M\]/) && message.includes('CYCLE'))) {
        processedMessage = `<span style="color: #56d364; font-weight: 500;">✓ CYCLE</span> <span style="color: #a5a5a5;">Farm cycle completed</span>`;
    }
    
    // Handle MM bot status messages with clean formatting
    if (message.includes('MMBOT - SINGLE TOKEN MARKET MAKING')) {
        const tokenMatch = message.match(/Token: (\w+)/);
        const walletsMatch = message.match(/Wallets: (\d+)/);
        const token = tokenMatch ? tokenMatch[1] : 'TOKEN';
        const wallets = walletsMatch ? walletsMatch[1] : '?';
        processedMessage = `<span style="color: #ffa500; font-weight: 500;">📊 MM BOT</span> <span style="color: #58a6ff; font-weight: 600;">${token}</span> <span style="color: #a5a5a5;">• ${wallets} wallet${wallets !== '1' ? 's' : ''} • Market Making Active</span>`;
        // Reset price check counter for new MM bot session
        mmBotPriceCheckCounter = 0;
    }
    
    // Handle MM bot price monitoring with condensed format
    if (message.includes('BUY TRIGGER:') || message.includes('SELL TRIGGER:')) {
        const isBuy = message.includes('BUY TRIGGER:');
        const priceMatch = message.match(/Price ([\d.]+)/);
        const price = priceMatch ? priceMatch[1] : '?';
        const action = isBuy ? 'BUY' : 'SELL';
        const color = isBuy ? '#56d364' : '#f85149';
        const emoji = isBuy ? '🟢' : '🔴';
        processedMessage = `<span style="color: ${color}; font-weight: 500;">${emoji} ${action}</span> <span style="color: #a5a5a5;">@ ${price} VIRTUAL</span>`;
    }
    
    // Handle MM bot periodic status updates (every 3rd price check)
    if (message.includes('Price Check Current:') && message.includes('Range Low:') && message.includes('Range High:')) {
        mmBotPriceCheckCounter++;
        if (mmBotPriceCheckCounter % 3 === 0) {
            // Pattern: "Price Check Current: 0.00167150 VIRTUAL Range Low: 0.00166983 VIRTUAL Range High: 0.00167317 VIRTUAL"
            const priceMatch = message.match(/Price Check Current: ([\d.]+) VIRTUAL/);
            const lowMatch = message.match(/Range Low: ([\d.]+) VIRTUAL/);
            const highMatch = message.match(/Range High: ([\d.]+) VIRTUAL/);
            
            if (priceMatch) {
                const price = priceMatch[1];
                const lowPrice = lowMatch ? lowMatch[1] : '?';
                const highPrice = highMatch ? highMatch[1] : '?';
                processedMessage = `<span style="color: #ffa500; font-weight: 500;">📊 MONITORING</span> <span style="color: #58a6ff; font-weight: 600;">${price}</span> <span style="color: #a5a5a5;">VIRTUAL • Range: ${lowPrice} - ${highPrice} • Watching for opportunities</span>`;
            }
        }
        // Note: Non-3rd price checks will be filtered out by the verbose filtering logic below
    }
    
    // Handle MM bot loop completion
    if (message.includes('Loop') && message.includes('completed!') && message.includes('/')) {
        const loopMatch = message.match(/Loop (\d+)\/(\d+)/);
        if (loopMatch) {
            const current = loopMatch[1];
            const total = loopMatch[2];
            processedMessage = `<span style="color: #56d364; font-weight: 500;">🎉 LOOP</span> <span style="color: #bc7df7; font-weight: 600;">${current}/${total}</span> <span style="color: #a5a5a5;">completed</span>`;
        }
    }
    
    // Handle bot completion messages
    if (message.includes('completed successfully')) {
        if (message.includes('buybot')) {
            processedMessage = `<span style="color: #56d364; font-weight: 500;">✅ COMPLETE</span> <span style="color: #58a6ff; font-weight: 600;">Buybot</span> <span style="color: #a5a5a5;">finished successfully</span>`;
        } else if (message.includes('sellbot')) {
            processedMessage = `<span style="color: #56d364; font-weight: 500;">✅ COMPLETE</span> <span style="color: #f85149; font-weight: 600;">Sellbot</span> <span style="color: #a5a5a5;">finished successfully</span>`;
        } else if (message.includes('farmbot')) {
            processedMessage = `<span style="color: #56d364; font-weight: 500;">✅ COMPLETE</span> <span style="color: #a5a5a5; font-weight: 600;">Farmbot</span> <span style="color: #a5a5a5;">finished successfully</span>`;
        } else if (message.includes('mm bot')) {
            processedMessage = `<span style="color: #56d364; font-weight: 500;">✅ COMPLETE</span> <span style="color: #ffa500; font-weight: 600;">MM Bot</span> <span style="color: #a5a5a5;">finished successfully</span>`;
        } else if (message.includes('Farm cycle completed successfully')) {
            processedMessage = `<span style="color: #56d364; font-weight: 500;">✓ CYCLE</span> <span style="color: #a5a5a5;">Farm cycle completed</span>`;
        }
    }
    
    // Filter out verbose transaction details that clutter the main console
    const isVerboseTransactionDetail = (
        message.includes('slippage') ||
        message.includes('Method: TRUSTSWAP') ||
        message.includes('Random provider selection') ||
        message.includes('Attempting transaction via') ||
        message.includes('broadcast attempt') ||
        message.includes('fallback to') ||
        message.includes('contract (') && message.includes('fee)') ||
        message.includes('Starting with') && message.includes('fallback') ||
        message.includes('Actual tokens received:') ||
        
        // Filter out verbose sellbot wallet summaries and redundant messages
        (message.includes('Wallet') && message.includes('Spent:') && message.includes('Received:') && message.includes('TOTAL ACROSS ALL WALLETS')) ||
        (message.includes('Sell successful:') && message.includes('received')) || // Redundant with ✅ SUCCESS messages
        (message.includes('CONFIRMED Block') && message.includes('Transaction mined') && !processedMessage) || // Standalone confirmation messages are redundant
        
        // Filter out ALL CYCLE Farm cycle completed messages (both timestamp-prefixed and plain)
        message.includes('CYCLE Farm cycle completed') ||
        (message.match(/\[\d{1,2}:\d{2}:\d{2} [AP]M\]/) && message.includes('CYCLE') && !message.includes('LOOP')) ||
        
        // Filter out only the most verbose MM bot messages (keep essential ones)
        // Filter out ALL WALLET_EVENT messages to prevent verbose wallet initialization output
        message.includes('WALLET_EVENT') ||
        
        // Filter out verbose wallet loading messages
        (message.includes('Successfully loaded') && message.includes('wallet(s) with provider connection')) ||
        (message.includes('using decrypted keys from environment variables')) ||
        (message.includes('using keys from wallet database file')) ||
        (message.includes('Loaded') && message.includes('wallets Using') && message.includes('wallets with keys')) ||
        // Filter out non-3rd MM bot price checks (only show every 3rd one)
        (message.includes('Price Check Current:') && message.includes('Range Low:') && message.includes('Range High:') && !message.includes('📊 MONITORING')) ||
        
        // Allow LOOP messages to be styled and shown (removed redundant filters)
        (message.includes('Progress: Loop') && message.includes('Starting farm cycle'))
    );
    
    // Define essential messages for main console (simplified view)
    const isEssentialMessage = (
        // Concise wallet status (only the nice formatted one)
        (message.includes('✅ Loaded wallet:') && message.includes('ENV')) ||
        
        // Bot selection and startup
        // message.includes('Selected WALLETTOKEN') ||
        // message.includes('Selected BUYBOT') ||
        // message.includes('Selected SELLBOT') ||
        message.includes('Starting BUYBOT') ||
        message.includes('Starting SELLBOT') ||
        message.includes('Starting FSH') ||
        message.includes('Starting FARMBOT') ||
        message.includes('Starting JEETBOT') ||
        message.includes('Starting MM') ||
        message.includes('Starting MMBOT') ||
        message.includes('MMBOT - SINGLE TOKEN MARKET MAKING') ||
        // MM bot specific token resolution (only allow for MM bot context)
        (message.includes('Token resolved:') && message.includes('0x') && (message.includes('MM') || message.includes('Market Making'))) ||
        message.includes('📊 MONITORING') ||
        
        // Core trading actions (condensed)
        (message.includes('Buying') && message.includes('VIRTUAL') && message.includes('Expected:')) ||
        (message.includes('Selling') && message.includes('Expected:')) ||
        message.includes('FSH mode activated') ||
        message.includes('TWAP mode activated') ||
        
        // Loop and farming status (allow all LOOP formats that get styled)
        message.match(/LOOP \d+\/\d+/) ||
        message.match(/^LOOP \d+$/) ||
        message.match(/^🔄 LOOP \d+$/) ||
        message.match(/^🔄 BID-MODE LOOP \d+\/\d+$/) ||
        message.includes('🔄 LOOP') ||
        message.includes('📍 Progress: Loop') ||
        (message.includes('LOOP') && message.includes('/') && message.includes('WALLET:')) ||
        (message.includes('MM cycle') && message.includes('Price:')) ||
        
        // Transaction results (condensed) - but exclude verbose details
        (message.includes('CONFIRMED Block') && message.includes('Transaction mined')) ||
        (message.includes('Actual tokens received:')) ||
        (message.includes('Success:') && message.includes('0x')) ||
        (message.includes('✅ Success:') && message.includes('0x')) || // Handle emoji version
        (message.includes('[Wallet') && message.includes('Success:') && message.includes('0x')) || // Handle wallet prefix
        
        // Sellbot-specific transaction results (only essential ones, redundant ones filtered above)
        (message.includes('Sell complete:') && message.includes('VIRTUAL')) ||
        
        // Completion status
        message.includes('buybot completed successfully') ||
        message.includes('sellbot completed successfully') ||
        message.includes('farmbot completed successfully') ||
        message.includes('jeetbot completed successfully') ||
        message.includes('mm bot completed successfully') ||
        message.includes('FSH completed successfully') ||
        message.includes('No bot is currently running') ||
        
        // Wallet validation warnings (essential for user feedback)
        message.includes('No wallets configured') ||
        message.includes('Please select at least one wallet') ||
        message.includes('Please select at least one token') ||
        
        // JeetBot error messages (essential for user feedback)
        (message.includes('🔍 Ticker "') && message.includes('" not found')) ||
        (message.includes('🔍 Token contract address "') && message.includes('" is invalid'))
    );
    
    // DEBUG: Check success message filtering
    if (message.includes('Success:') && message.includes('0x')) {
        console.log('🔍 SUCCESS MESSAGE FILTERING CHECK:', {
            isEssentialMessage: isEssentialMessage,
            isVerboseTransactionDetail: isVerboseTransactionDetail,
            willBeFiltered: !isEssentialMessage || isVerboseTransactionDetail
        });
    }
    
    // Only show essential messages in main console, but exclude verbose transaction details
    if (!isEssentialMessage || isVerboseTransactionDetail) {
        if (message.includes('Success:') && message.includes('0x')) {
            console.log('🚫 SUCCESS MESSAGE FILTERED OUT - NOT ESSENTIAL');
        }
        return; // Skip non-essential messages or verbose transaction details in main console
    }
    
    // EXPLICIT BLOCK: CYCLE messages only (allow other timestamp messages)
    if (message.includes('CYCLE')) {
        return; // Block CYCLE messages completely
    }
    
    // Check for duplicate messages (prevent double logging)
    // Compare with existing messages in a more robust way
    const isWalletLoadingMessage = message.includes('Successfully loaded') && message.includes('wallet') && message.includes('Ready to trade');
    const dedupeTimeWindow = isWalletLoadingMessage ? 10000 : 2000; // Use a 10-second window for wallet loading messages
    
    // Check the last few console messages
    for (let i = consoleLines.length - 1; i >= Math.max(0, consoleLines.length - 10); i--) {
        const existingMessage = consoleLines[i];
        const timeDiff = new Date() - new Date(existingMessage.fullTimestamp || 0);
        
        // For success messages, compare by transaction hash instead of full message
        if (message.includes('Success:') && message.includes('0x') && 
            existingMessage.fullMessage.includes('Success:') && existingMessage.fullMessage.includes('0x')) {
            
            // Extract transaction hashes from both messages
            const currentTxHash = message.match(/0x[a-fA-F0-9]{64}/);
            const existingTxHash = existingMessage.fullMessage.match(/0x[a-fA-F0-9]{64}/);
            
            // Only block if same transaction hash (true duplicate)
            if (currentTxHash && existingTxHash && currentTxHash[0] === existingTxHash[0] && timeDiff < dedupeTimeWindow) {
                console.log('🚫 SUCCESS MESSAGE BLOCKED - DUPLICATE TX HASH:', currentTxHash[0]);
                return;
            } else if (currentTxHash && existingTxHash) {
                console.log('✅ SUCCESS MESSAGE ALLOWED - DIFFERENT TX HASH:', {
                    current: currentTxHash[0].substring(0, 10) + '...',
                    existing: existingTxHash[0].substring(0, 10) + '...'
                });
            }
        } else {
            // For non-success messages, use original full message comparison
            if (existingMessage.fullMessage === message && timeDiff < dedupeTimeWindow) {
                console.log('Prevented duplicate console message:', message);
                return;
            }
        }
    }
    
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    
    // Use processed message for display (preserve HTML styling)
    let displayMessage = processedMessage;
    
    // Only clean if the message doesn't contain HTML styling
    let cleanMessage;
    if (displayMessage.includes('<span style=')) {
        // Keep HTML styling intact
        cleanMessage = displayMessage;
    } else {
        // Clean message of emojis and marketing words for plain text messages
        cleanMessage = displayMessage
            .replace(/[^\w\s\.\-\:\(\)\[\]\/\\%\u2705]/g, '') // Remove emojis except checkmark
            .replace(/\b(amazing|awesome|great|excellent|fantastic|perfect|wow|cool|exciting|incredible)\b/gi, '') // Remove marketing words
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }
    
    // Check if this is a transaction success message and add clickable link (only if not already styled)
    if (message.includes('Success:') && message.includes('0x') && !cleanMessage.includes('<span style=')) {
        const txHashMatch = message.match(/0x[a-fA-F0-9]{64}/);
        if (txHashMatch) {
            const txHash = txHashMatch[0];
            const shortHash = `${txHash.substring(0, 8)}...${txHash.substring(-6)}`;
            const basescanUrl = `https://basescan.org/tx/${txHash}`;
            line.innerHTML = `<span class="console-timestamp">[${timestamp}]</span> ✅ Transaction successful: <a href="${basescanUrl}" target="_blank" style="color: #58a6ff; text-decoration: underline;">${shortHash}</a>`;
        } else {
            line.innerHTML = `<span class="console-timestamp">[${timestamp}]</span> ${cleanMessage}`;
        }
    } else {
        line.innerHTML = `<span class="console-timestamp">[${timestamp}]</span> ${cleanMessage}`;
    }
    
    // Remove welcome message if it exists
    const welcome = elements.console.querySelector('.console-welcome');
    if (welcome) {
        welcome.remove();
    }
    
    elements.console.appendChild(line);
    // Store full timestamp and original message for deduplication checking
    consoleLines.push({ 
        timestamp, 
        message: cleanMessage, 
        fullMessage: message, // Original message before cleaning
        fullTimestamp: new Date(), 
        type 
    });
    
    // Auto-scroll to bottom
    elements.console.scrollTop = elements.console.scrollHeight;
    
    // Limit console lines to prevent memory issues
    if (consoleLines.length > 1000) {
        const oldLines = elements.console.querySelectorAll('.console-line');
        if (oldLines.length > 500) {
            for (let i = 0; i < 100; i++) {
                if (oldLines[i]) {
                    oldLines[i].remove();
                }
            }
        }
        consoleLines = consoleLines.slice(-500);
    }
}

function clearConsole() {
    // Clear simple console
    elements.console.innerHTML = '<div class="console-welcome"><p>Console cleared. Run a bot to see output here...</p></div>';
    consoleLines = [];
    
    // Clear detailed console
    const detailedConsole = document.getElementById('console-detailed');
    if (detailedConsole) {
        detailedConsole.innerHTML = '<div class="console-welcome"><p>Console cleared. Run a bot to see output here...</p></div>';
        detailedConsoleLines = [];
    }
    
    addConsoleMessage('Console cleared', 'info');
}

async function saveOutput() {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `bot-output-${timestamp}.txt`;
        
        const content = consoleLines.map(line => 
            `[${line.timestamp}] ${line.message}`
        ).join('\n');
        
        const result = await ipcRenderer.invoke('show-save-dialog', {
            title: 'Save Console Output',
            defaultPath: filename,
            filters: [
                { name: 'Text Files', extensions: ['txt'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });
        
        if (!result.canceled && result.filePath) {
            await ipcRenderer.invoke('write-file', result.filePath, content);
            addConsoleMessage(`Console output saved to: ${result.filePath}`, 'success');
        }
    } catch (error) {
        addConsoleMessage(`Failed to save output: ${error.message}`, 'error');
    }
}

function showQuickGuide() {
    addConsoleMessage('Quick Guide:', 'info');
    addConsoleMessage('1. Select a bot from the sidebar', 'info');
    addConsoleMessage('2. Fill in the required parameters', 'info');
    addConsoleMessage('3. Click the start button to run the bot', 'info');
    addConsoleMessage('4. Monitor output in this console', 'info');
    addConsoleMessage('5. Use Stop Bot button to halt execution', 'info');
    addConsoleMessage('Tip: Configure wallets in settings before trading', 'info');
}

async function openDocs() {
    try {
        await ipcRenderer.invoke('open-external', 'https://github.com/your-repo/trading-bot#readme');
        addConsoleMessage('Opening documentation in browser...', 'info');
    } catch (error) {
        addConsoleMessage('Failed to open documentation', 'error');
    }
}

async function checkSystemStatus() {
    try {
        // Check if configuration exists and get wallet data
        const [configResult, walletsResult] = await Promise.all([
            ipcRenderer.invoke('get-env-config'),
            ipcRenderer.invoke('get-all-wallets')
        ]);
        
        if (configResult.success) {
            elements.connectionStatus.textContent = '🟢 Configured';
            elements.connectionStatus.classList.add('status-connected');
            
            // Count actual wallets from wallet data (more accurate)
            let walletCount = 0;
            if (walletsResult.success && walletsResult.wallets && Array.isArray(walletsResult.wallets)) {
                walletCount = walletsResult.wallets.length;
            } else if (configResult.config.wallets && Array.isArray(configResult.config.wallets)) {
                // Fallback to config wallets if wallet data not available
                walletCount = configResult.config.wallets.length;
            }
            elements.walletCount.textContent = `${walletCount} wallet${walletCount !== 1 ? 's' : ''}`;
        } else {
            elements.connectionStatus.textContent = '🔴 Not Configured';
            elements.connectionStatus.classList.remove('status-connected');
            elements.walletCount.textContent = '0 wallets';
            addConsoleMessage('⚠️ Configuration not found. Please set up your environment.', 'warning');
        }
        
        // Update gas price display
        await updateGasPriceStatus();
        
    } catch (error) {
        elements.connectionStatus.textContent = '🔴 Error';
        elements.connectionStatus.classList.remove('status-connected');
        addConsoleMessage(`❌ System check failed: ${error.message}`, 'error');
    }
}

// Function to update connection status with temporary messages
function updateConnectionStatus(message, duration = 3000) {
    const originalText = elements.connectionStatus.textContent;
    const originalClasses = elements.connectionStatus.className;
    
    // Show temporary status
    elements.connectionStatus.textContent = `🔄 ${message}`;
    elements.connectionStatus.classList.add('status-updating');
    
    // Restore original status after duration
    setTimeout(() => {
        elements.connectionStatus.textContent = originalText;
        elements.connectionStatus.className = originalClasses;
    }, duration);
}

async function showConfig() {
    try {
        // Get both config and wallet data
        const [configResult, walletsResult] = await Promise.all([
            ipcRenderer.invoke('get-env-config'),
            ipcRenderer.invoke('get-all-wallets')
        ]);
        
        if (configResult.success && walletsResult.success) {
            populateConfigModal(configResult.config, walletsResult.wallets);
        } else {
            // Show empty config for first-time setup
            populateConfigModal({}, []);
        }
        
        document.getElementById('config-modal').style.display = 'block';
    } catch (error) {
        addConsoleMessage(`❌ Failed to load configuration: ${error.message}`, 'error');
    }
}

function populateConfigModal(config, wallets = []) {
    // Set default values if not configured
    const defaults = {
        rpcUrl: 'https://base-mainnet.g.alchemy.com/v2/your-api-key-here',
        chainId: 8453,
        virtualTokenAddress: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
        genesisContract: '',
        uniswapRouter: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
        slippageBasisPoints: 1000,
        pollIntervalMs: 10,
        useWebSocketDetection: true,
        parallelDetection: true,
        solanaRpcUrl: 'https://api.mainnet-beta.solana.com',
        minVirtualTransfer: 1200,
        maxVirtualTransfer: 1250,
        transferIntervalSeconds: 300
    };

    // Network settings
    document.getElementById('config-chain-id').value = config.chainId || defaults.chainId;
    document.getElementById('config-virtual-address').value = config.virtualTokenAddress || defaults.virtualTokenAddress;
    
    // RPC Providers
    document.getElementById('config-rpc-url').value = config.rpcUrl || defaults.rpcUrl;
    document.getElementById('config-ws-url').value = config.wsUrl || '';
    document.getElementById('config-rpc-url-quicknode').value = config.rpcUrlQuickNode || '';
    document.getElementById('config-ws-url-quicknode').value = config.wsUrlQuickNode || '';
    document.getElementById('config-rpc-url-infura').value = config.rpcUrlInfura || '';
    document.getElementById('config-ws-url-infura').value = config.wsUrlInfura || '';
    
    // Trading Configuration
    document.getElementById('config-genesis-contract').value = config.genesisContract || defaults.genesisContract;
    document.getElementById('config-uniswap-router').value = config.uniswapRouter || defaults.uniswapRouter;
    document.getElementById('config-slippage-basis-points').value = config.slippageBasisPoints || defaults.slippageBasisPoints;
    document.getElementById('config-poll-interval-ms').value = config.pollIntervalMs || defaults.pollIntervalMs;
    document.getElementById('config-use-websocket').value = (config.useWebSocketDetection !== undefined ? config.useWebSocketDetection : defaults.useWebSocketDetection).toString();
    document.getElementById('config-parallel-detection').value = (config.parallelDetection !== undefined ? config.parallelDetection : defaults.parallelDetection).toString();
    
    // Stargate Bridge Settings
    document.getElementById('config-solana-rpc-url').value = config.solanaRpcUrl || defaults.solanaRpcUrl;
    document.getElementById('config-solana-virtual-token-mint').value = config.solanaVirtualTokenMint || '';
    document.getElementById('config-stargate-base-router').value = config.stargateBaseRouter || '';
    document.getElementById('config-stargate-solana-router').value = config.stargateSolanaRouter || '';
    document.getElementById('config-min-virtual-transfer').value = config.minVirtualTransfer || defaults.minVirtualTransfer;
    document.getElementById('config-max-virtual-transfer').value = config.maxVirtualTransfer || defaults.maxVirtualTransfer;
    document.getElementById('config-transfer-interval-seconds').value = config.transferIntervalSeconds || defaults.transferIntervalSeconds;
    
    // Only set B1 if there are wallets and it's empty
    const b1Input = document.getElementById('config-b1');
    if (wallets.length > 0 && b1Input && !b1Input.value) {
        b1Input.value = wallets[0].privateKey || '';
    }

    // Load wallet management interface
    loadWalletManagement(wallets);
    
    // Load dynamic RPC configurations
    loadDynamicRpcs(config);
    
    // Trigger address detection for the main wallet if it has a value
    const mainWalletInput = document.getElementById('config-b1');
    if (mainWalletInput && mainWalletInput.value) {
        detectWalletAddress('config-b1', 'config-b1-address', 'config-b1-status');
    }
}

// Helper function to safely get form element values
function getFormValue(elementId, defaultValue = '') {
    const element = document.getElementById(elementId);
    return element ? element.value.trim() : defaultValue;
}

function getFormIntValue(elementId, defaultValue = 0) {
    const element = document.getElementById(elementId);
    return element ? parseInt(element.value.trim()) || defaultValue : defaultValue;
}

function getFormFloatValue(elementId, defaultValue = 0) {
    const element = document.getElementById(elementId);
    return element ? parseFloat(element.value.trim()) || defaultValue : defaultValue;
}

function getFormBoolValue(elementId, defaultValue = false) {
    const element = document.getElementById(elementId);
    return element ? element.value === 'true' : defaultValue;
}

async function saveConfig() {
    try {
        const config = {
            // Network settings
            chainId: getFormIntValue('config-chain-id', 8453),
            virtualTokenAddress: getFormValue('config-virtual-address', '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b'),
            
            // RPC Providers
            rpcUrl: getFormValue('config-rpc-url'),
            wsUrl: getFormValue('config-ws-url'),
            rpcUrlQuickNode: getFormValue('config-rpc-url-quicknode'),
            wsUrlQuickNode: getFormValue('config-ws-url-quicknode'),
            rpcUrlInfura: getFormValue('config-rpc-url-infura'),
            wsUrlInfura: getFormValue('config-ws-url-infura'),
            
            // Dynamic RPC Providers
            dynamicRpcs: typeof collectDynamicRpcs === 'function' ? collectDynamicRpcs() : [],
            
            // Trading Configuration (with safe defaults for commented out fields)
            genesisContract: getFormValue('config-genesis-contract'),
            uniswapRouter: getFormValue('config-uniswap-router', '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24'),
            slippageBasisPoints: getFormIntValue('config-slippage-basis-points', 1000),
            pollIntervalMs: getFormIntValue('config-poll-interval-ms', 1000),
            useWebSocketDetection: getFormBoolValue('config-use-websocket', true),
            parallelDetection: getFormBoolValue('config-parallel-detection', true),
            
            // Stargate Bridge Settings (with safe defaults for commented out fields)
            solanaRpcUrl: getFormValue('config-solana-rpc-url'),
            solanaVirtualTokenMint: getFormValue('config-solana-virtual-token-mint'),
            stargateBaseRouter: getFormValue('config-stargate-base-router'),
            stargateSolanaRouter: getFormValue('config-stargate-solana-router'),
            minVirtualTransfer: getFormFloatValue('config-min-virtual-transfer') || undefined,
            maxVirtualTransfer: getFormFloatValue('config-max-virtual-transfer') || undefined,
            transferIntervalSeconds: getFormIntValue('config-transfer-interval-seconds', 300)
        };

        const result = await ipcRenderer.invoke('save-env-config', config);
        
        if (result.success) {
            addConsoleMessage('✅ Multi-provider configuration saved successfully', 'success');
            closeModal('config-modal');
            checkSystemStatus(); // Refresh status
            
            // Auto-refresh wallets after saving config
            setTimeout(() => {
                refreshWallets();
            }, 500);
        } else {
            addConsoleMessage(`❌ Failed to save configuration: ${result.message}`, 'error');
        }
    } catch (error) {
        addConsoleMessage(`❌ Failed to save configuration: ${error.message}`, 'error');
    }
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
            case 's':
                e.preventDefault();
                if (e.shiftKey) {
                    stopBot();
                } else {
                    saveOutput();
                }
                break;
            case 'l':
                e.preventDefault();
                clearConsole();
                break;
            case 'b':
                e.preventDefault();
                checkBalances();
                break;
        }
    }
    
    if (e.key === 'Escape') {
        // Close any open modals
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
    }
});

// Window focus handlers
window.addEventListener('focus', () => {
    elements.connectionStatus.textContent = '🟢 Online';
});

window.addEventListener('blur', () => {
    // Optional: Handle window lose focus
});

// Error handling
window.addEventListener('error', (e) => {
    addConsoleMessage(`❌ Application error: ${e.message}`, 'error');
    console.error('Application error:', e);
});

window.addEventListener('unhandledrejection', (e) => {
    addConsoleMessage(`❌ Unhandled promise rejection: ${e.reason}`, 'error');
    console.error('Unhandled promise rejection:', e);
});

// Old wallet management functions removed - now using JSON database system

// TWAP and form option functions
function handleBuyTypeChange(type) {
    const normalCheckbox = document.getElementById('buy-type-normal');
    const twapCheckbox = document.getElementById('buy-type-twap');
    const twapOptions = document.getElementById('twap-options');
    
    // Ensure only one option is selected
    if (type === 'normal') {
        normalCheckbox.checked = true;
        twapCheckbox.checked = false;
        twapOptions.style.display = 'none';
    } else if (type === 'twap') {
        normalCheckbox.checked = false;
        twapCheckbox.checked = true;
        twapOptions.style.display = 'block';
        
        // Setup TWAP duration change handler
        const twapDuration = document.getElementById('twap-duration');
        if (twapDuration) {
            twapDuration.addEventListener('change', function() {
                const customDuration = document.getElementById('custom-duration');
                if (this.value === 'custom') {
                    customDuration.style.display = 'block';
                } else {
                    customDuration.style.display = 'none';
                }
            });
        }
    }
}

function handleSellTypeChange(type) {
    const normalCheckbox = document.getElementById('sell-type-normal');
    const twapCheckbox = document.getElementById('sell-type-twap');
    const twapOptions = document.getElementById('sell-twap-options');
    const customDurationInput = document.getElementById('sell-twap-custom-duration');
    const twapDuration = document.getElementById('sell-twap-duration');
    // Ensure only one option is selected
    if (type === 'normal') {
        normalCheckbox.checked = true;
        twapCheckbox.checked = false;
        twapOptions.style.display = 'none';
        if (customDurationInput) customDurationInput.style.display = 'none';
    } else if (type === 'twap') {
        normalCheckbox.checked = false;
        twapCheckbox.checked = true;
        twapOptions.style.display = 'block';
        if (twapDuration) {
            // Always set up the event listener (idempotent)
            twapDuration.addEventListener('change', function() {
                if (this.value === 'custom') {
                    if (customDurationInput) customDurationInput.style.display = 'block';
                } else {
                    if (customDurationInput) customDurationInput.style.display = 'none';
                }
            });
            // On initial load, set visibility
            if (twapDuration.value === 'custom') {
                if (customDurationInput) customDurationInput.style.display = 'block';
            } else {
                if (customDurationInput) customDurationInput.style.display = 'none';
            }
        }
    }
}

// Currency selection functions
function handleBuyCurrencyChange(currency) {
    const virtualCheckbox = document.getElementById('buy-currency-virtual');
    const ethCheckbox = document.getElementById('buy-currency-eth');
    const amountPreset = document.getElementById('buy-amount-preset');
    const amountInput = document.getElementById('buy-amount');
    
    // Ensure only one option is selected
    if (currency === 'virtual') {
        virtualCheckbox.checked = true;
        ethCheckbox.checked = false;
        
        // Update presets to VIRTUAL amounts
        amountPreset.innerHTML = `
            <option value="">Presets</option>
            <option value="10">10 VIRTUAL</option>
            <option value="25">25 VIRTUAL</option>
            <option value="50">50 VIRTUAL</option>
            <option value="100">100 VIRTUAL</option>
            <option value="MAX">MAX (99.99% VIRTUAL)</option>
        `;
        amountInput.placeholder = "Enter VIRTUAL amount";
        
    } else if (currency === 'eth') {
        virtualCheckbox.checked = false;
        ethCheckbox.checked = true;
        
        // Update presets to ETH amounts
        amountPreset.innerHTML = `
            <option value="">Presets</option>
            <option value="0.01">0.01 ETH</option>
            <option value="0.1">0.1 ETH</option>
            <option value="1">1 ETH</option>
            <option value="MAX">MAX (99.99% ETH)</option>
        `;
        amountInput.placeholder = "Enter ETH amount";
    }
}

function handleSellCurrencyChange(currency) {
    const virtualCheckbox = document.getElementById('sell-currency-virtual');
    const ethCheckbox = document.getElementById('sell-currency-eth');
    
    // Ensure only one option is selected
    if (currency === 'virtual') {
        virtualCheckbox.checked = true;
        ethCheckbox.checked = false;
    } else if (currency === 'eth') {
        virtualCheckbox.checked = false;
        ethCheckbox.checked = true;
    }
}

// Update currency labels based on selected tokens
function updateCurrencyLabels() {
    const buyLabel = document.getElementById('buy-currency-label');
    const sellLabel = document.getElementById('sell-currency-label');
    
    // Get selected token names
    let tokenNames = 'tokens';
    if (selectedTickers.length > 0) {
        if (selectedTickers.length === 1) {
            tokenNames = selectedTickers[0].symbol;
        } else if (selectedTickers.length <= 3) {
            tokenNames = selectedTickers.map(t => t.symbol).join(', ');
        } else {
            tokenNames = `${selectedTickers.length} tokens`;
        }
    }
    
    if (buyLabel) {
        buyLabel.textContent = `Buy ${tokenNames} With:`;
    }
    if (sellLabel) {
        sellLabel.textContent = `Sell ${tokenNames} For:`;
    }
}

// Legacy functions for backward compatibility
function toggleBuyOptions() {
    // Check current state and toggle appropriately
    const twapCheckbox = document.getElementById('buy-type-twap');
    if (twapCheckbox && twapCheckbox.checked) {
        handleBuyTypeChange('twap');
    } else {
        handleBuyTypeChange('normal');
    }
}

function toggleSellOptions() {
    // Check current state and toggle appropriately
    const twapCheckbox = document.getElementById('sell-type-twap');
    if (twapCheckbox && twapCheckbox.checked) {
        handleSellTypeChange('twap');
    } else {
        handleSellTypeChange('normal');
    }
}

function updateBuyAmount() {
    const preset = document.getElementById('buy-amount-preset').value;
    const amountInput = document.getElementById('buy-amount');
    
    if (preset) {
        if (preset === 'MAX') {
            amountInput.value = 'MAX';
        } else {
            amountInput.value = preset;
        }
        // Reset the dropdown to show "Presets" again
        document.getElementById('buy-amount-preset').value = '';
        
        // Update the custom dropdown display if it exists
        if (window.setCustomDropdownValue) {
            window.setCustomDropdownValue('buy-amount-preset', '');
        }
    }
}

function updateSellAmount() {
    const preset = document.getElementById('sell-amount-preset').value;
    const amountInput = document.getElementById('sell-amount');
    
    if (preset) {
        if (preset === 'MAX') {
            amountInput.value = 'MAX';
        } else {
            amountInput.value = preset;
        }
        // Reset the dropdown to show "Presets" again
        document.getElementById('sell-amount-preset').value = '';
        
        // Update the custom dropdown display if it exists
        if (window.setCustomDropdownValue) {
            window.setCustomDropdownValue('sell-amount-preset', '');
        }
    }
}

function updateGasPrice() {
    const preset = document.getElementById('gas-price-preset').value;
    if (preset) {
        document.getElementById('gas-price').value = preset;
        document.getElementById('gas-price-preset').value = '';
    }
}

function updateGasLimit() {
    const preset = document.getElementById('gas-limit-preset').value;
    if (preset) {
        document.getElementById('gas-limit').value = preset;
        document.getElementById('gas-limit-preset').value = '';
    }
}

// FSH confirmation functions
function confirmFSH() {
    // Check if wallets are selected
    if (selectedWallets.size === 0) {
        addConsoleMessage('Please select at least one wallet to use for FSH mode', 'error');
        return;
    }
    
    document.getElementById('fsh-confirm-modal').style.display = 'block';
}

function executeFSH() {
    closeModal('fsh-confirm-modal');
    
    // Use the sellbot-fsh bot type which will be handled by runBot
    runBot('sellbot-fsh');
}

// Enhanced getBuyBotArgs with TWAP and currency support
async function getBuyBotArgs() {
    const token = document.getElementById('buy-token').value.trim();
    const amount = document.getElementById('buy-amount').value.trim();
    
    // Determine buy type from checkboxes
    const twapCheckbox = document.getElementById('buy-type-twap');
    const buyType = (twapCheckbox && twapCheckbox.checked) ? 'twap' : 'normal';
    
    // Determine currency from checkboxes
    const ethCheckbox = document.getElementById('buy-currency-eth');
    const currency = (ethCheckbox && ethCheckbox.checked) ? 'ETH' : 'VIRTUAL';

    if (!token) {
        addConsoleMessage('❌ Please enter a token address', 'error');
        return null;
    }

    const args = [token];
    
    if (buyType === 'twap') {
        args.push('twap');
        
        // Add amount parameter for TWAP
        if (!amount) {
            addConsoleMessage('Please specify an amount for TWAP mode (e.g., 10)', 'error');
            return null;
        }
        
        // Handle MAX value for TWAP
        if (amount === 'MAX') {
            args.push('99.99%'); // Convert MAX to 99.99% for TWAP
        } else {
            const twapAmount = parseFloat(amount);
            if (isNaN(twapAmount) || twapAmount <= 0) {
                addConsoleMessage('TWAP amount must be a positive number', 'error');
                return null;
            }
            args.push(twapAmount);
        }
        
        // Add TWAP parameters
        const duration = document.getElementById('twap-duration').value;
        
        if (duration === 'custom') {
            const customDuration = document.getElementById('twap-custom-duration').value;
            if (customDuration && customDuration >= 60) {
                args.push(customDuration);
            } else {
                addConsoleMessage('❌ Custom duration must be at least 60 seconds', 'error');
                return null;
            }
        } else {
            args.push(duration);
        }
    } else {
        if (amount) {
            // Handle MAX value for normal buy (99.99% of currency balance)
            if (amount === 'MAX') {
                args.push('99.99%');
            } else {
                args.push(amount);
            }
        }
    }
    
    // Add currency parameter if ETH is selected (native ETH)
    if (currency === 'ETH') {
        args.push('ETH');
    }

    return args;
}

// Enhanced getSellBotArgs with TWAP and currency support
function getSellBotArgs() {
    const token = document.getElementById('sell-token').value.trim();
    const amount = document.getElementById('sell-amount').value.trim();
    
    // Determine sell type from checkboxes
    const twapCheckbox = document.getElementById('sell-type-twap');
    const sellType = (twapCheckbox && twapCheckbox.checked) ? 'twap' : 'normal';
    
    // Determine currency from checkboxes
    const ethCheckbox = document.getElementById('sell-currency-eth');
    const currency = (ethCheckbox && ethCheckbox.checked) ? 'ETH' : 'VIRTUAL';

    if (!token) {
        addConsoleMessage('❌ Please enter a token address', 'error');
        return null;
    }

    const args = [token];
    
    if (sellType === 'twap') {
        args.push('twap');
        
        // Handle amount for TWAP if provided
        if (amount) {
            if (amount === 'MAX') {
                args.push('99.99%'); // Convert MAX to 99.99% for TWAP
            } else {
                args.push(amount);
            }
        }
        
        // Add TWAP parameters
        const duration = document.getElementById('sell-twap-duration').value;
        
        if (duration === 'custom') {
            const customDuration = document.getElementById('sell-twap-custom-duration').value;
            if (customDuration && customDuration >= 60) {
                args.push(customDuration);
            } else {
                addConsoleMessage('❌ Custom duration must be at least 60 seconds', 'error');
                return null;
            }
        } else {
            args.push(duration);
        }
    } else {
        if (amount) {
            // Handle MAX value for normal sell (99.99% of tokens)
            if (amount === 'MAX') {
                args.push('99.99%');
            } else {
                args.push(amount);
            }
        }
    }
    
    // Add currency parameter if ETH is selected (native ETH)
    if (currency === 'ETH') {
        args.push('ETH');
    }

    return args;
}

// Old removeWallet function removed - now using JSON database system

// Ticker Selection Functions
function setupTickerSelection() {
    const tickerCheckboxes = document.querySelectorAll('.ticker-checkbox');
    tickerCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', updateTickerSelection);
    });
    
    // Select TRUST by default - ensure checkbox is checked first
    const trustCheckbox = document.getElementById('ticker-trust');
    if (trustCheckbox) {
        trustCheckbox.checked = true;
    }
    
    // Now call updateTickerSelection which will read the checked state properly
    updateTickerSelection();
}

function updateTickerSelection() {
    const tickerCheckboxes = document.querySelectorAll('.ticker-checkbox');
    selectedTickers = [];
    
    tickerCheckboxes.forEach(checkbox => {
        if (checkbox.checked) {
            const address = checkbox.dataset.address;
            const symbolElement = checkbox.parentElement.querySelector('.ticker-symbol');
            const symbol = symbolElement ? symbolElement.textContent : 'UNKNOWN';
            selectedTickers.push({ address, symbol });
        }
    });
    
    // Debug logging
    console.log('updateTickerSelection: Found', selectedTickers.length, 'selected tokens:', selectedTickers);
    
    // Update summary
    const countSpan = document.getElementById('selected-ticker-count');
    const parallelInfo = document.getElementById('parallel-info');
    
    if (countSpan) {
        countSpan.textContent = `${selectedTickers.length} token${selectedTickers.length !== 1 ? 's' : ''} selected`;
    }
    
    if (parallelInfo) {
        if (selectedTickers.length > 1) {
            parallelInfo.style.display = 'inline';
        } else {
            parallelInfo.style.display = 'none';
        }
    }
    
    // Update currency labels with selected token names
    updateCurrencyLabels();
}

function selectAllTickers() {
    const tickerCheckboxes = document.querySelectorAll('.ticker-checkbox');
    tickerCheckboxes.forEach(checkbox => {
        checkbox.checked = true;
    });
    updateTickerSelection();
}

function clearAllTickers() {
    const tickerCheckboxes = document.querySelectorAll('.ticker-checkbox');
    tickerCheckboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    selectedTickers = [];
    updateTickerSelection();
}

// Load token database from base.json
async function loadTokenDatabase() {
    try {
        const response = await fetch('./base.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        tokenDatabase = await response.json();
        // Token database loaded silently
    } catch (error) {
        console.error('Error loading token database:', error);
        addConsoleMessage('⚠️ Could not load token database', 'warning');
        tokenDatabase = []; // fallback to empty array
    }
}

// Handle token search input
function handleTokenSearch() {
    // Check both the new token field input and the old custom ticker search
    const searchInput = document.getElementById('token-field-input') || document.getElementById('custom-ticker-search');
    if (!searchInput) return;
    
    const query = searchInput.value.trim();
    
    // Clear previous timeout
    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }
    
    // Hide results if empty
    if (!query) {
        hideSearchResults();
        return;
    }
    
    // Debounce search
    searchTimeout = setTimeout(() => {
        performTokenSearch(query);
    }, 300);
}

// Handle Enter key in search
function handleTokenSearchEnter(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        const query = event.target.value.trim();
        if (query) {
            performTokenSearch(query);
        }
    }
}

// Perform the actual token search
function performTokenSearch(query) {
    const resultsDiv = document.getElementById('search-results');
    const statusDiv = document.getElementById('search-status');
    
    showSearchStatus('Searching...', 'searching');
    
    let results = [];
    
    // Check if input looks like an address (starts with 0x and is long enough)
    const isAddress = query.startsWith('0x') && query.length > 10;
    
    if (isAddress) {
        // Search by address (CA → ticker)
        const normalizedQuery = query.toLowerCase();
        results = tokenDatabase.filter(token => 
            token.tokenAddress && token.tokenAddress.toLowerCase().includes(normalizedQuery)
        );
        
        if (results.length > 0) {
            const exactMatch = results.find(token => 
                token.tokenAddress.toLowerCase() === normalizedQuery
            );
            if (exactMatch) {
                showSearchStatus(`✅ Found: ${exactMatch.symbol}`, 'verified');
            } else {
                showSearchStatus(`Found ${results.length} partial matches`, 'found');
            }
        } else {
            showSearchStatus('Token not found in database - you can still add it', 'not-found');
        }
    } else {
        // Search by symbol (ticker → CA)
        const normalizedQuery = query.toUpperCase();
        results = tokenDatabase.filter(token => 
            token.symbol && token.symbol.toUpperCase().includes(normalizedQuery)
        );
        
        if (results.length > 0) {
            const exactMatch = results.find(token => 
                token.symbol.toUpperCase() === normalizedQuery
            );
            if (exactMatch) {
                showSearchStatus(`✅ Found: ${exactMatch.tokenAddress}`, 'verified');
            } else {
                showSearchStatus(`Found ${results.length} matches`, 'found');
            }
        } else {
            showSearchStatus('Ticker not found in database', 'not-found');
        }
    }
    
    displaySearchResults(results, query);
}

// Display search results dropdown
function displaySearchResults(results, originalQuery) {
    const resultsDiv = document.getElementById('search-results');
    
    if (results.length === 0) {
        hideSearchResults();
        return;
    }
    
    resultsDiv.innerHTML = '';
    
    // Limit to top 10 results
    const limitedResults = results.slice(0, 10);
    
    limitedResults.forEach(token => {
        const resultItem = document.createElement('div');
        resultItem.className = 'search-result-item';
        resultItem.innerHTML = `
            <span class="result-symbol">${token.symbol}</span>
            <span class="result-address">${token.tokenAddress}</span>
        `;
        
        resultItem.addEventListener('click', () => {
            selectSearchResult(token);
        });
        
        resultsDiv.appendChild(resultItem);
    });
    
    // Show results
    resultsDiv.style.display = 'block';
}

// Select a search result
function selectSearchResult(token) {
    const searchInput = document.getElementById('token-field-input') || document.getElementById('custom-ticker-search');
    if (!searchInput) return;
    
    // Update input with selected token info
    searchInput.value = `${token.symbol} - ${token.tokenAddress}`;
    
    // Store selected token data for adding
    searchInput.dataset.selectedSymbol = token.symbol;
    searchInput.dataset.selectedAddress = token.tokenAddress;
    
    hideSearchResults();
    showSearchStatus(`✅ Selected: ${token.symbol}`, 'verified');
}

// Add token from search
function addTokenFromSearch() {
    const searchInput = document.getElementById('token-field-input') || document.getElementById('custom-ticker-search');
    if (!searchInput) return;
    
    const query = searchInput.value.trim();
    
    if (!query) {
        addConsoleMessage('❌ Please enter a token symbol or address', 'error');
        return;
    }
    
    let symbol, address;
    
    // Check if a token was selected from search results
    if (searchInput.dataset.selectedSymbol && searchInput.dataset.selectedAddress) {
        symbol = searchInput.dataset.selectedSymbol;
        address = searchInput.dataset.selectedAddress;
    } else {
        // Try to parse manual input
        if (query.includes(' - ')) {
            // Format: "SYMBOL - 0xAddress"
            const parts = query.split(' - ');
            symbol = parts[0].trim();
            address = parts[1].trim();
        } else if (query.startsWith('0x')) {
            // Just an address - use the address as both symbol and address
            address = query;
            const foundToken = tokenDatabase.find(token => 
                token.tokenAddress && token.tokenAddress.toLowerCase() === address.toLowerCase()
            );
            symbol = foundToken ? foundToken.symbol : address;
        } else {
            // Just a symbol - search for address
            symbol = query.toUpperCase();
            const foundToken = tokenDatabase.find(token => 
                token.symbol && token.symbol.toUpperCase() === symbol
            );
            if (foundToken) {
                address = foundToken.tokenAddress;
            } else {
                addConsoleMessage('❌ Token not found. Please enter a valid contract address.', 'error');
                return;
            }
        }
    }
    
    // Validate address format
    if (!address || !address.startsWith('0x') || address.length !== 42) {
        addConsoleMessage('❌ Invalid address format. Address must start with 0x and be 42 characters long', 'error');
        return;
    }
    
    // Check if already exists
    const exists = selectedTickers.some(ticker => 
        ticker.address.toLowerCase() === address.toLowerCase()
    ) || customTickers.some(ticker => 
        ticker.address.toLowerCase() === address.toLowerCase()
    );

    if (exists) {
        addConsoleMessage('⚠️ Token already selected', 'warning');
        return;
    }

    // Add to custom tickers
    const customTicker = {
        symbol: symbol,
        address: address,
        isCustom: true
    };

    customTickers.push(customTicker);
    
    // Add to ticker grid
    const tickerGrid = document.querySelector('.ticker-grid');
    const tickerItem = document.createElement('div');
    tickerItem.className = 'ticker-item';
    
    // Use full symbol name, don't truncate for display
    const displaySymbol = symbol; // Use full symbol/address as entered
    const displayAddress = address.substring(0, 6) + '...' + address.substring(38);
    
    tickerItem.innerHTML = `
        <input type="checkbox" id="ticker-custom-${customTickers.length}" 
               class="ticker-checkbox" data-address="${address}" checked>
        <label for="ticker-custom-${customTickers.length}">
            <span class="ticker-symbol">${displaySymbol}</span>
            <span class="ticker-address">${displayAddress}</span>
        </label>
    `;
    
    tickerGrid.appendChild(tickerItem);
    
    // Setup event listener for new checkbox
    const checkbox = tickerItem.querySelector('.ticker-checkbox');
    checkbox.addEventListener('change', updateTickerSelection);
    
    // Update selection
    updateTickerSelection();
    
    // Clear input and stored data
    searchInput.value = '';
    delete searchInput.dataset.selectedSymbol;
    delete searchInput.dataset.selectedAddress;
    hideSearchResults();
    
    addConsoleMessage(`✅ Added token: ${symbol} (${address})`, 'success');
}

// Show search status
function showSearchStatus(message, type) {
    const statusDiv = document.getElementById('search-status');
    statusDiv.textContent = message;
    statusDiv.className = `search-status ${type}`;
    statusDiv.style.display = 'block';
}

// Hide search results and status
function hideSearchResults() {
    const resultsDiv = document.getElementById('search-results');
    const statusDiv = document.getElementById('search-status');
    
    resultsDiv.style.display = 'none';
    statusDiv.style.display = 'none';
    resultsDiv.innerHTML = '';
}

// Legacy function for backward compatibility
function addCustomTicker() {
    // Redirect to new function
    addTokenFromSearch();
}

// Detect wallet address from private key in real-time
async function detectWalletAddress(inputId, addressDisplayId, statusDisplayId) {
    const input = document.getElementById(inputId);
    const addressDisplay = document.getElementById(addressDisplayId);
    const statusDisplay = document.getElementById(statusDisplayId);
    
    if (!input || !addressDisplay || !statusDisplay) {
        console.error('Address detection elements not found');
        return;
    }
    
    const privateKey = input.value.trim();
    
    // Clear previous timeout for this input
    if (addressDetectionTimeouts[inputId]) {
        clearTimeout(addressDetectionTimeouts[inputId]);
    }
    
    // Hide displays if empty input
    if (!privateKey) {
        addressDisplay.style.display = 'none';
        statusDisplay.style.display = 'none';
        return;
    }
    
    // Show validating status immediately
    statusDisplay.textContent = '🔄 Validating private key...';
    statusDisplay.className = 'address-detection-status validating';
    statusDisplay.style.display = 'block';
    addressDisplay.style.display = 'none';
    
    // Debounce the address detection
    addressDetectionTimeouts[inputId] = setTimeout(async () => {
        try {
            // Ensure the private key is at least 64 characters (32 bytes)
            let cleanKey = privateKey;
            if (privateKey.startsWith('0x')) {
                cleanKey = privateKey.slice(2);
            }
            
            if (cleanKey.length < 64) {
                statusDisplay.textContent = '⚠️ Private key too short (needs 64 hex characters)';
                statusDisplay.className = 'address-detection-status invalid';
                addressDisplay.style.display = 'none';
                return;
            }
            
            if (cleanKey.length > 64) {
                statusDisplay.textContent = '⚠️ Private key too long (max 64 hex characters)';
                statusDisplay.className = 'address-detection-status invalid';
                addressDisplay.style.display = 'none';
                return;
            }
            
            // Check if it's valid hex
            if (!/^[0-9a-fA-F]+$/.test(cleanKey)) {
                statusDisplay.textContent = '❌ Invalid private key format (must be hexadecimal)';
                statusDisplay.className = 'address-detection-status invalid';
                addressDisplay.style.display = 'none';
                return;
            }
            
            // Call main process to detect address
            const result = await ipcRenderer.invoke('detect-wallet-address', privateKey);
            
            if (result.success) {
                // Show success status
                statusDisplay.textContent = '✅ Valid private key';
                statusDisplay.className = 'address-detection-status valid';
                
                // Show detected address
                const addressSpan = addressDisplay.querySelector('.address-display');
                addressSpan.textContent = result.address;
                addressDisplay.style.display = 'block';
                
                // Auto-hide status after 2 seconds if address is shown
                setTimeout(() => {
                    if (statusDisplay.classList.contains('valid')) {
                        statusDisplay.style.display = 'none';
                    }
                }, 2000);
                
            } else {
                statusDisplay.textContent = `❌ ${result.error}`;
                statusDisplay.className = 'address-detection-status invalid';
                addressDisplay.style.display = 'none';
            }
            
        } catch (error) {
            console.error('Error detecting wallet address:', error);
            statusDisplay.textContent = '❌ Error validating private key';
            statusDisplay.className = 'address-detection-status invalid';
            addressDisplay.style.display = 'none';
        }
    }, 500); // 500ms debounce delay
}

// New bot arg functions for multi-ticker support
function getBuyBotArgsForTicker(ticker) {
    const amount = document.getElementById('buy-amount').value.trim();
    const twapCheckbox = document.getElementById('buy-type-twap');
    const buyType = (twapCheckbox && twapCheckbox.checked) ? 'twap' : 'normal';
    const ethCheckbox = document.getElementById('buy-currency-eth');
    const currency = (ethCheckbox && ethCheckbox.checked) ? 'ETH' : 'VIRTUAL';
    const gasPrice = document.getElementById('gas-price').value.trim();
    const args = [];
    if (selectedWallets.size > 0) {
        const walletSelectors = Array.from(selectedWallets)
            .map(index => `B${index + 1}`)
            .sort();
        args.push(...walletSelectors);
    }
    if (buyType === 'twap') {
        args.push(ticker.symbol || ticker.address);
        args.push('twap');
        if (!amount) {
            args.push('100');
        } else if (amount === 'MAX') {
            args.push('99.99%');
        } else {
            args.push(amount);
        }
        const duration = document.getElementById('twap-duration').value;
        if (duration === 'custom') {
            const customDuration = document.getElementById('twap-custom-duration').value;
            if (customDuration && customDuration >= 60) {
                const minutes = Math.ceil(parseInt(customDuration) / 60);
                args.push(minutes.toString());
            } else {
                addConsoleMessage('Custom duration must be at least 60 seconds', 'error');
                return null;
            }
        } else {
            const minutes = Math.ceil(parseInt(duration) / 60);
            args.push(minutes.toString());
        }
        
        // Add intervals (number of orders) if specified - SURGICAL FIX for BuyBot TWAP
        const intervals = document.getElementById('twap-intervals') ? 
            document.getElementById('twap-intervals').value : null;
        if (intervals) {
            args.push(intervals);
        }
        
        // Remove ETH in BID-MODE
        if (!isBidModeActive && currency === 'ETH') {
            args.push('ETH');
        }
        if (gasPrice && gasPrice !== '0.02') {
            args.push(`gas${gasPrice}`);
        }
        // In BID-MODE, do NOT add slow for TWAP
        if (isBidModeActive) {
            args.push('BID-MODE');
        }
    } else {
        args.push(ticker.symbol || ticker.address);
        if (!amount) {
            args.push('100');
        } else if (amount === 'MAX') {
            args.push('99.99%');
        } else {
            args.push(amount);
        }
        if (!isBidModeActive && currency === 'ETH') {
            args.push('ETH');
        }
        args.push('slow');
        if (gasPrice && gasPrice !== '0.02') {
            args.push(`gas${gasPrice}`);
        }
        if (isBidModeActive) {
            if (!args.includes('slow')) args.push('slow');
            args.push('BID-MODE');
    }
    }
    return args;
}

function getSellBotArgsForTicker(ticker) {
    const amount = document.getElementById('sell-amount').value.trim();
    const twapCheckbox = document.getElementById('sell-type-twap');
    const sellType = (twapCheckbox && twapCheckbox.checked) ? 'twap' : 'normal';
    const ethCheckbox = document.getElementById('sell-currency-eth');
    const currency = (ethCheckbox && ethCheckbox.checked) ? 'ETH' : 'VIRTUAL';
    const gasPrice = document.getElementById('gas-price').value.trim();
    const args = [];
    if (selectedWallets.size > 0) {
        const walletSelectors = Array.from(selectedWallets)
            .map(index => `B${index + 1}`)
            .sort();
        args.push(...walletSelectors);
    }
    if (sellType === 'twap') {
        args.push(ticker.symbol || ticker.address);
        args.push('twap');
        if (!amount) {
            args.push('50%');
        } else if (amount === 'MAX') {
            args.push('99.99%');
        } else {
            args.push(amount);
        }
        const duration = document.getElementById('sell-twap-duration').value;
        if (duration === 'custom') {
            const customDuration = document.getElementById('sell-twap-custom-duration').value;
            if (customDuration && customDuration >= 60) {
                const minutes = Math.ceil(parseInt(customDuration) / 60);
                args.push(minutes.toString());
            } else {
                addConsoleMessage('Custom duration must be at least 60 seconds', 'error');
                return null;
            }
        } else {
            const minutes = Math.ceil(parseInt(duration) / 60);
            args.push(minutes.toString());
        }
        const intervals = document.getElementById('sell-twap-intervals') ? document.getElementById('sell-twap-intervals').value : null;
        if (intervals) {
            args.push(intervals);
        }
        if (!isBidModeActive && currency === 'ETH') {
            args.push('ETH');
        }
        if (gasPrice && gasPrice !== '0.02') {
            args.push(`gas${gasPrice}`);
        }
        // In BID-MODE, do NOT add slow for TWAP
        if (isBidModeActive) {
            args.push('BID-MODE');
        }
    } else {
        args.push(ticker.symbol || ticker.address);
        if (!amount) {
            args.push('50%');
        } else if (amount === 'MAX') {
            args.push('99.99%');
        } else {
            args.push(amount);
        }
        if (!isBidModeActive && currency === 'ETH') {
            args.push('ETH');
        }
        if (gasPrice && gasPrice !== '0.02') {
            args.push(`gas${gasPrice}`);
        }
        if (isBidModeActive) {
            args.push('slow');
            args.push('BID-MODE');
    }
    }
    return args;
}

function getFarmBotArgsForTicker(ticker) {
    const amount = document.getElementById('farm-amount').value.trim();
    const loops = document.getElementById('farm-loops').value.trim();
    const gasPrice = document.getElementById('gas-price').value.trim();
    const args = [];
    if (selectedWallets.size > 0) {
        const walletSelectors = Array.from(selectedWallets)
            .map(index => `B${index + 1}`)
            .sort();
        args.push(...walletSelectors);
    }
    args.push(ticker.symbol || ticker.address);
    if (!amount) {
        args.push('100');
    } else if (amount === 'MAX') {
        args.push('99.99%');
    } else {
        args.push(amount);
    }
    if (loops && parseInt(loops) > 1) {
        args.push(`L-${loops}`);
    }
    if (gasPrice && gasPrice !== '0.02') {
        args.push(`gas${gasPrice}`);
    }
    if (isBidModeActive) {
        args.push('BID-MODE');
    }
    return args;
}



function getMMBotArgsForTicker(ticker) {
    const virtualAmount = document.getElementById('mm-virtual-amount').value.trim();
    const tokenAmount = document.getElementById('mm-token-amount').value.trim();
    const lowerRange = document.getElementById('mm-lower-range').value.trim();
    const higherRange = document.getElementById('mm-higher-range').value.trim();
    const interval = document.getElementById('mm-interval').value.trim();
    const loops = document.getElementById('mm-loops').value.trim();
    const gasPrice = document.getElementById('mm-gas-price').value.trim();

    // New v5.2 format: [wallets] <token> <V-amount> <T-amount> <RL-range> <RH-range> [I-interval] [L-loops] [CHASE] [gas]
    
    const args = [];
    
    // Add wallet selection (B1 B2 B3 format)
    if (selectedWallets.size > 0) {
        const walletSelectors = Array.from(selectedWallets)
            .map(index => `B${index + 1}`)
            .sort(); // Sort to ensure consistent order
        args.push(...walletSelectors);
    }
    
    // Token (single token - mmbot is now single-token only)
    args.push(ticker.symbol || ticker.address);
    
    // V-amount (VIRTUAL amount)
    let vAmount = virtualAmount || '1%'; // Default 1% of VIRTUAL balance
    if (vAmount === 'MAX') {
        vAmount = '99.99%'; // Convert MAX to 99.99% of VIRTUAL balance
    }
    if (!vAmount.startsWith('V-') && !vAmount.startsWith('v-')) {
        vAmount = `V-${vAmount}`;
    }
    args.push(vAmount);
    
    // T-amount (Token amount) - use similar value or default
    let tAmount = tokenAmount || '2%'; // Default 2% of token balance
    if (tAmount === 'MAX') {
        tAmount = '99.99%'; // Convert MAX to 99.99% of token balance
    }
    if (!tAmount.startsWith('T-') && !tAmount.startsWith('t-')) {
        tAmount = `T-${tAmount}`;
    }
    args.push(tAmount);
    
    // RL-range (Lower range for buying)
    let rlRange = lowerRange || '3%'; // Default 3% drop to trigger buy
    if (!rlRange.startsWith('RL-') && !rlRange.startsWith('rl-')) {
        if (!rlRange.includes('%')) {
            rlRange = `${rlRange}%`;
        }
        rlRange = `RL-${rlRange}`;
    }
    args.push(rlRange);
    
    // RH-range (Higher range for selling)
    let rhRange = higherRange || '3%'; // Default 3% rise to trigger sell
    if (!rhRange.startsWith('RH-') && !rhRange.startsWith('rh-')) {
        if (!rhRange.includes('%')) {
            rhRange = `${rhRange}%`;
        }
        rhRange = `RH-${rhRange}`;
    }
    args.push(rhRange);
    
    // I-interval (optional)
    if (interval && parseFloat(interval) !== 1) {
        let iInterval = interval;
        if (!iInterval.startsWith('I-') && !iInterval.startsWith('i-')) {
            iInterval = `I-${iInterval}`;
        }
        args.push(iInterval);
    }
    
    // L-loops (only if provided)
    if (loops && parseInt(loops) > 0) {
        let lLoops = loops;
        if (!lLoops.startsWith('L-') && !lLoops.startsWith('l-')) {
            lLoops = `L-${lLoops}`;
        }
        args.push(lLoops);
    }
    
    // CHASE mode
    const isChaseMode = document.getElementById('mm-mode-chase').checked;
    if (isChaseMode) {
        args.push('CHASE');
    }
    
    // Gas price
    if (gasPrice && gasPrice !== '0.02') {
        args.push(`gas${gasPrice}`);
    }

    return args;
}

function getJeetBotArgsForTicker(ticker) {
    // JeetBot can work in multiple modes:
    // 1. Genesis contract mode (auto-detection)
    // 2. Direct token mode (TOKEN-0xaddress format)
    // 3. Ticker symbol mode (resolve from database)
    
    const genesisEl = document.getElementById('jeet-genesis');
    const basicModeEl = document.getElementById('jeet-mode-basic');
    const rebuyModeEl = document.getElementById('jeet-mode-rebuy');
    const delayEl = document.getElementById('jeet-delay');
    
    if (!genesisEl || !basicModeEl || !rebuyModeEl || !delayEl) {
        addConsoleMessage('❌ JeetBot form elements not found', 'error');
        return null;
    }
    
    const genesis = genesisEl.value.trim();
    const basicMode = basicModeEl.checked;
    const rebuyMode = rebuyModeEl.checked;
    const delay = delayEl.value.trim();
    
    // Get gas price from radio buttons
    const selectedGasOption = document.querySelector('input[name="jeet-gas-option"]:checked');
    let gasPrice = '0.06'; // Default
    if (selectedGasOption) {
        if (selectedGasOption.value === 'custom') {
            const customGasEl = document.getElementById('jeet-custom-gas');
            gasPrice = customGasEl ? (customGasEl.value.trim() || '0.06') : '0.06';
        } else {
            gasPrice = selectedGasOption.value;
        }
    }
    
    // Get REBUY settings if REBUY mode is selected
    const rebuyPercentageEl = document.getElementById('jeet-rebuy-percentage');
    const rebuyIntervalEl = document.getElementById('jeet-rebuy-interval');
    
    const rebuyPercentage = rebuyPercentageEl ? rebuyPercentageEl.value.trim() : '';
    const rebuyInterval = rebuyIntervalEl ? rebuyIntervalEl.value.trim() : '';

    const args = [];
    
    // Add wallet selection (B1 B2 B3 format)
    if (selectedWallets.size > 0) {
        const walletSelectors = Array.from(selectedWallets)
            .map(index => `B${index + 1}`)
            .sort(); // Sort to ensure consistent order
        args.push(...walletSelectors);
    }
    
    // Main input: Genesis contract, direct token, or ticker
    if (genesis && genesis.length > 1) {
        // Determine if input is a ticker or contract address
        let processedGenesis = genesis;
        if (genesis.startsWith('0x') && genesis.length === 42) {
            // Contract address - use as is
            processedGenesis = genesis;
        addConsoleMessage('🔍 Genesis mode: Auto-detecting tokens from contract', 'info');
        } else {
            // Ticker symbol - add G- prefix for JeetBot
            processedGenesis = `G-${genesis}`;
            addConsoleMessage(`🏷️ Genesis ticker mode: Resolving ${genesis} from database`, 'info');
        }
        args.push(processedGenesis);
    } else if (ticker && ticker.address) {
        // Direct token mode - use TOKEN-0x format
        args.push(`TOKEN-${ticker.address}`);
        addConsoleMessage(`🎯 Direct token mode: ${ticker.symbol} (${ticker.address})`, 'info');
    } else if (ticker && ticker.symbol) {
        // Ticker symbol mode - let JeetBot resolve from database
        args.push(ticker.symbol);
        addConsoleMessage(`🏷️ Ticker mode: Resolving ${ticker.symbol} from database`, 'info');
    } else {
        addConsoleMessage('Please enter a Genesis ticker/contract address OR select at least one token', 'error');
        return null;
    }
    
    // Determine mode
    if (rebuyMode) {
        args.push('JEET');
        args.push('REBUY');
        
        // Add REBUY percentage
        if (rebuyPercentage) {
            args.push(rebuyPercentage);
        } else {
            args.push('30%'); // Default
        }
    
        // Add REBUY interval (convert seconds using custom formula)
        if (rebuyInterval && parseFloat(rebuyInterval) > 0) {
            // Convert seconds using formula: seconds * 0.016
            // 2s = 0.032, 1s = 0.016, 0.5s = 0.008
            let intervalValue = (parseFloat(rebuyInterval) * 0.016).toFixed(3);
            args.push(`I-${intervalValue}`);
        } else {
            args.push('I-0.032'); // Default 2 seconds = 0.032
        }
    } else {
        args.push('JEET');
    }
    
    // Add delay if specified (D-X format)
    if (delay && parseInt(delay) > 0) {
        args.push(`D-${delay}`);
    }
    
    // Add gas price (always add it)
    args.push(`gas${gasPrice}`);

    return args;
}

// Utility Bot Argument Functions
function getTransferBotArgs() {
    const token = document.getElementById('transfer-token').value.trim();
    const amount = document.getElementById('transfer-amount').value.trim();
    const receiver = document.getElementById('transfer-receiver').value.trim();
    const gasPrice = document.getElementById('gas-price').value.trim();

    // TransferBot format: <token> <amount> <receiver> [gas] [from:walletId]
    
    if (!token || !amount || !receiver) {
        addConsoleMessage('Please fill in all required fields: token, amount, and receiver', 'error');
        return null;
    }

    // Check if wallets are selected
    if (selectedWallets.size === 0) {
        addConsoleMessage('Warning: No wallets selected. Please select at least one wallet.', 'warning');
        return null;
    }
    
    // Create the final argument list in the correct order:
    // 1. First token, amount, receiver as TransferBot expects them
    // 2. Optional gas price
    // 3. Wallet selectors as additional arguments for main.js
    
    const args = [
        // Required TransferBot arguments (must be first)
        token,
        amount,
        receiver
    ];
    
    // Gas price if specified
    if (gasPrice && gasPrice !== '0.02') {
        args.push(`gas${gasPrice}`);
    }
    
    // Add wallet selectors after main args
    // Convert selected wallets to B1, B2, etc. format
    Array.from(selectedWallets)
        .map(index => `B${index + 1}`)
        .forEach(walletSelector => args.push(walletSelector));
    
    return args;
}

function getStargateBridgeArgs() {
    const mode = document.getElementById('bridge-mode').value;
    const minAmount = document.getElementById('bridge-amount-min').value.trim();
    const maxAmount = document.getElementById('bridge-amount-max').value.trim();
    const gasPrice = document.getElementById('gas-price').value.trim();

    // New v5.2 format: [command] [wallets...] [min_amount] [max_amount]
    
    const args = [];
    
    // Command/mode
    if (mode && mode !== '') {
        args.push(mode);
    }
    
    // Handle wallet selection based on the global selectedWallets Set
    if (selectedWallets && selectedWallets.size > 0) {
        // Pass wallet selection as environment variable via WALLETTOKEN_SELECTED
        // This is how the other bots handle wallet selection
        ipcRenderer.send('set-env', {
            WALLETTOKEN_SELECTED: Array.from(selectedWallets).join(',')
        });
        
        // Add WALLETTOKEN to args to signal that specific wallets should be used
        args.push('WALLETTOKEN');
        
        addConsoleMessage(`🔑 Using ${selectedWallets.size} selected wallets for Stargate Bridge`, 'info');
    } else {
        // No wallets selected, will use all from wallets.json
        addConsoleMessage('⚠️ No wallets selected, using all wallets from wallets.json', 'warning');
    }
    
    // Amount parameters
    if (minAmount) {
        args.push(minAmount);
    }
    
    if (maxAmount && maxAmount !== minAmount) {
        args.push(maxAmount);
    }
    
    // Gas price parameter
    if (gasPrice) {
        args.push('--gas');
        args.push(gasPrice);
    }
    
    return args;
}

function getContactBotArgs() {
    const command = document.getElementById('contact-command').value;
    const name = document.getElementById('contact-name').value.trim();
    const address = document.getElementById('contact-address').value.trim();
    const description = document.getElementById('contact-description').value.trim();

    // New v5.2 format: <command> [options]
    
    const args = [];
    
    if (!command || command === '') {
        // Show help by default
        return args;
    }
    
    args.push(command);
    
    // Add parameters based on command
    if (command === 'add') {
        if (!name || !address) {
            addConsoleMessage('Please enter both name and address for adding a contact', 'error');
            return null;
        }
        args.push(name, address);
        if (description) {
            args.push(`"${description}"`);
        }
    } else if (command === 'remove' || command === 'search') {
        if (!name) {
            addConsoleMessage(`Please enter a name for ${command} command`, 'error');
            return null;
        }
        args.push(name);
    }

    return args;
}

function getTokenDetectorArgs() {
    const mode = document.getElementById('detect-mode').value;

    // Token detector doesn't need parameters, just mode selection
    const args = [];
    
    // Mode is handled by npm script selection (detect vs detect:quick)
    // No additional arguments needed

    return args;
}

// Ticker Management Argument Functions
function getTickerSearchArgs() {
    const symbol = document.getElementById('search-symbol').value.trim();
    
    if (!symbol) {
        addConsoleMessage('Please enter a token symbol to search', 'error');
        return null;
    }
    
    return [symbol];
}

function getTickerFetchArgs() {
    // Ticker fetch doesn't require any arguments
    return [];
}

function getTickerExportArgs() {
    // Ticker export doesn't require any arguments
    return [];
}

function getTickerRunAllArgs() {
    // Ticker run all doesn't require any arguments
    return [];
}

// Removed old MM mode handling functions - now using simplified design

// MMBot preset update functions
function updateMMVirtualAmount() {
    const preset = document.getElementById('mm-virtual-preset').value;
    const input = document.getElementById('mm-virtual-amount');
    if (preset) {
        input.value = preset;
    }
}

function updateMMTokenAmount() {
    const preset = document.getElementById('mm-token-preset').value;
    const input = document.getElementById('mm-token-amount');
    if (preset) {
        input.value = preset;
    }
}

function updateMMLowerRange() {
    const preset = document.getElementById('mm-lower-preset').value;
    const input = document.getElementById('mm-lower-range');
    if (preset) {
        input.value = preset;
    }
}

function updateMMHigherRange() {
    const preset = document.getElementById('mm-higher-preset').value;
    const input = document.getElementById('mm-higher-range');
    if (preset) {
        input.value = preset;
    }
}

function updateMMInterval() {
    const preset = document.getElementById('mm-interval-preset').value;
    const input = document.getElementById('mm-interval');
    if (preset) {
        input.value = preset;
    }
}

function updateMMLoops() {
    const preset = document.getElementById('mm-loops-preset').value;
    const input = document.getElementById('mm-loops');
    if (preset) {
        input.value = preset;
    }
}

function updateMMGasPrice() {
    const preset = document.getElementById('mm-gas-price-preset').value;
    const input = document.getElementById('mm-gas-price');
    if (preset) {
        input.value = preset;
    }
}

// Handle ContactBot form dynamics
function handleContactCommand() {
    const command = document.getElementById('contact-command').value;
    const nameGroup = document.getElementById('contact-name-group');
    const addressGroup = document.getElementById('contact-address-group');
    const descriptionGroup = document.getElementById('contact-description-group');
    
    // Hide all groups first
    nameGroup.style.display = 'none';
    addressGroup.style.display = 'none';
    descriptionGroup.style.display = 'none';
    
    // Show relevant groups based on command
    switch (command) {
        case 'add':
            nameGroup.style.display = 'block';
            addressGroup.style.display = 'block';
            descriptionGroup.style.display = 'block';
            break;
        case 'remove':
        case 'search':
            nameGroup.style.display = 'block';
            break;
        case 'list':
        case 'export':
        case '':
        default:
            // No additional fields needed
            break;
    }
}

// Handle JeetBot Genesis Contract input changes
function handleJeetGenesisChange() {
    const genesisInput = document.getElementById('jeet-genesis');
    const tokenSelectionPanel = document.querySelector('.ticker-selection-panel');
    const tokenSelectionNotice = document.getElementById('jeet-token-selection-notice');
    
    if (genesisInput && tokenSelectionPanel && tokenSelectionNotice) {
        const genesisValue = genesisInput.value.trim();
        
        if (genesisValue && genesisValue.length > 10) {
            // Genesis contract provided - disable token selection
            tokenSelectionPanel.style.opacity = '0.5';
            tokenSelectionPanel.style.pointerEvents = 'none';
            tokenSelectionNotice.style.display = 'block';
            
            // Clear any selected tokens since they won't be used
            clearAllTickers();
            
            // Add overlay message to token selection
            if (!tokenSelectionPanel.querySelector('.genesis-overlay')) {
                const overlay = document.createElement('div');
                overlay.className = 'genesis-overlay';
                overlay.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.7);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10;
                    border-radius: 8px;
                `;
                overlay.innerHTML = `
                    <div style="color: #00d4ff; text-align: center; font-weight: 600;">
                        🎯 Genesis Mode Active<br>
                        <small style="color: #aaa;">Auto-detection enabled</small>
                    </div>
                `;
                tokenSelectionPanel.style.position = 'relative';
                tokenSelectionPanel.appendChild(overlay);
            }
        } else {
            // No Genesis contract - enable token selection
            tokenSelectionPanel.style.opacity = '1';
            tokenSelectionPanel.style.pointerEvents = 'auto';
            tokenSelectionNotice.style.display = 'none';
            
            // Remove overlay if it exists
            const overlay = tokenSelectionPanel.querySelector('.genesis-overlay');
            if (overlay) {
                overlay.remove();
            }
        }
    }
}

// Handle JeetBot mode change
function handleJeetModeChange(mode) {
    const basicModeEl = document.getElementById('jeet-mode-basic');
    const rebuyModeEl = document.getElementById('jeet-mode-rebuy-old');
    const rebuyNewModeEl = document.getElementById('jeet-mode-rebuy-new');
    const rebuyOptionsEl = document.getElementById('jeet-rebuy-options');
    const rebuyNewOptionsEl = document.getElementById('jeet-rebuy-new-options');
    const basicExplanationEl = document.getElementById('jeet-basic-explanation');
    const rebuyExplanationEl = document.getElementById('jeet-rebuy-explanation');
    const rebuyNewExplanationEl = document.getElementById('jeet-rebuy-new-explanation');
    
    if (!basicModeEl || !rebuyModeEl || !rebuyNewModeEl) {
        console.error('JeetBot mode elements not found');
        return;
    }
    
    if (mode === 'basic') {
        // JEET mode selected - ensure only one is checked
        basicModeEl.checked = true;
        rebuyModeEl.checked = false;
        rebuyNewModeEl.checked = false;
        
        // Show/hide relevant sections
        if (rebuyOptionsEl) rebuyOptionsEl.style.display = 'none';
        if (rebuyNewOptionsEl) rebuyNewOptionsEl.style.display = 'none';
        if (basicExplanationEl) basicExplanationEl.style.display = 'block';
        if (rebuyExplanationEl) rebuyExplanationEl.style.display = 'none';
        if (rebuyNewExplanationEl) rebuyNewExplanationEl.style.display = 'none';
    } else if (mode === 'rebuy') {
        // JEET and REBUY mode selected - ensure only one is checked
        basicModeEl.checked = false;
        rebuyModeEl.checked = true;
        rebuyNewModeEl.checked = false;
        
        // Show/hide relevant sections
        if (rebuyOptionsEl) rebuyOptionsEl.style.display = 'block';
        if (rebuyNewOptionsEl) rebuyNewOptionsEl.style.display = 'none';
        if (basicExplanationEl) basicExplanationEl.style.display = 'none';
        if (rebuyExplanationEl) rebuyExplanationEl.style.display = 'block';
        if (rebuyNewExplanationEl) rebuyNewExplanationEl.style.display = 'none';
    } else if (mode === 'rebuy-new') {
        // New REBUY mode selected - ensure only one is checked
        basicModeEl.checked = false;
        rebuyModeEl.checked = false;
        rebuyNewModeEl.checked = true;
        
        // Show/hide relevant sections
        if (rebuyOptionsEl) rebuyOptionsEl.style.display = 'none';
        if (rebuyNewOptionsEl) rebuyNewOptionsEl.style.display = 'block';
        if (basicExplanationEl) basicExplanationEl.style.display = 'none';
        if (rebuyExplanationEl) rebuyExplanationEl.style.display = 'none';
        if (rebuyNewExplanationEl) rebuyNewExplanationEl.style.display = 'block';
    }
}

// Update REBUY percentage from radio buttons
function updateJeetRebuyPercentage() {
    const selectedPercentage = document.querySelector('input[name="jeet-rebuy-percentage-option"]:checked');
    const customField = document.getElementById('jeet-rebuy-percentage');
    
    if (selectedPercentage && customField) {
        if (selectedPercentage.value === 'custom') {
            // Show custom field and focus on it
            customField.style.display = 'block';
            customField.focus();
        } else {
            // Hide custom field and use preset value
            customField.style.display = 'none';
            customField.value = selectedPercentage.value;
        }
    }
}

// Update REBUY interval from radio buttons
function updateJeetRebuyInterval() {
    // Interval radio buttons are handled directly - no custom option
    // This function exists for consistency with ivaavi branch
}

// Simple logging system - optimized for buybot/sellbot
function parseSimpleLogMessage(message) {
    // Clean message of emojis and marketing words
    const cleanMessage = message
        .replace(/[^\w\s\.\-\:\(\)\[\]\/\\%]/g, '') // Remove emojis and special chars
        .replace(/\b(amazing|awesome|great|excellent|fantastic|perfect|wow|cool|exciting|incredible)\b/gi, '') // Remove marketing words
        .trim();

    // Only parse the most essential patterns for Simple View
    const patterns = [
        // New transaction execution patterns with 💡 indicator
        { regex: /Starting transaction execution for.*?→.*?(VIRTUAL|TRUST|VADER|ETH)/i, type: 'transaction_starting' },
        { regex: /Transaction execution completed.*?(\d+).*?(SUCCESS|FAILED)/i, type: 'transaction_completed' },
        { regex: /Two-step transaction execution completed.*?(\d+).*?(SUCCESS|FAILED)/i, type: 'transaction_completed' },
        // Wallet success results with specific amounts
        { regex: /\[Wallet\s+(\d+)\].*?(\d+\.?\d*)\s*(VIRTUAL|TRUST|VADER|ETH)/i, type: 'wallet_result' },
        // Transaction success confirmations
        { regex: /(Buy|Sell|Swap) completed.*?(\d+\.?\d*)\s*(VIRTUAL|TRUST|VADER|ETH)/i, type: 'transaction_success' },
        // TRUSTSWAP transactions
        { regex: /TRUSTSWAP.*?(Sell|Buy).*?(\d+\.?\d*)\s*(VIRTUAL|TRUST|VADER|ETH)/i, type: 'trustswap_operation' },
        // Total summaries
        { regex: /Total.*?(\d+\.?\d*)\s*(VIRTUAL|TRUST|VADER|ETH)/i, type: 'total_result' },
        // Bot completion status
        { regex: /(BuyBot|SellBot) (completed|finished)/i, type: 'completion' },
        // Clear error messages - only match serious execution failures, not informational logs
        { regex: /(?<!Skipping|validation)\s+(Failed|failed|Error:)\s+(?!validation|due to missing)/i, type: 'error' },
        // Bot starting messages
        { regex: /(Starting|BUYBOT|SELLBOT).*?(TRUST|VIRTUAL)/i, type: 'started' }
    ];
    
    for (let pattern of patterns) {
        const match = cleanMessage.match(pattern.regex);
        if (match) {
            return {
                type: pattern.type,
                wallet: match[1] || null,
                amount: match[2] || null,
                token: match[3] || null,
                operation: match[1] || null,
                original: cleanMessage
            };
        }
    }
    
    // Don't show other messages in Simple View
    return null;
}

function addSimpleConsoleMessage(simpleMessage) {
    const timestamp = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = 'console-line simple';
    
    let displayText = '';
    
    switch (simpleMessage.type) {
        case 'transaction_starting':
            displayText = `Starting transaction...`;
            line.classList.add('info');
            break;
        case 'transaction_completed':
            displayText = simpleMessage.original.includes('SUCCESS') ? 'Transaction: ✅ SUCCESS' : 'Transaction: ❌ FAILED';
            line.classList.add(simpleMessage.original.includes('SUCCESS') ? 'success' : 'error');
            break;
        case 'trustswap_operation':
            displayText = `TRUSTSWAP: ${simpleMessage.amount} ${simpleMessage.token}`;
            line.classList.add('success');
            break;
        case 'wallet_result':
            displayText = `W${simpleMessage.wallet}: ${simpleMessage.amount} ${simpleMessage.token}`;
            line.classList.add('success');
            break;
        case 'transaction_success':
            displayText = `${simpleMessage.operation}: ${simpleMessage.amount} ${simpleMessage.token}`;
            line.classList.add('success');
            break;
        case 'total_result':
            displayText = `Total: ${simpleMessage.amount} ${simpleMessage.token}`;
            line.classList.add('success');
            break;
        case 'completion':
            displayText = 'Operation completed';
            line.classList.add('success');
            break;
        case 'error':
            displayText = 'Operation failed';
            line.classList.add('error');
            break;
        case 'started':
            displayText = 'Bot started';
            line.classList.add('info');
            break;
        default:
            // For Simple View, don't show unrecognized messages
            return;
    }
    
    // Check for duplicate messages (prevent double logging)
    // Check the last few simple console messages for duplicates
    const simpleConsoleLines = Array.from(elements.console.querySelectorAll('.console-line.simple'));
    if (simpleConsoleLines.length > 0) {
        // Get the last simple message
        const lastLine = simpleConsoleLines[simpleConsoleLines.length - 1];
        // Extract text without timestamp
        const lastLineText = lastLine?.innerText?.replace(/^\[.*?\]\s*/, '')?.trim();
        
        // If the same message exists and was added recently, skip this one
        if (lastLineText === displayText) {
            console.log('Prevented duplicate simple console message:', displayText);
            return;
        }
    }
    
    line.innerHTML = `<span class="console-timestamp">[${timestamp}]</span> ${displayText}`;
    
    // Remove welcome message if it exists
    const welcome = elements.console.querySelector('.console-welcome');
    if (welcome) {
        welcome.remove();
    }
    
    elements.console.appendChild(line);
    
    // Auto-scroll to bottom
    elements.console.scrollTop = elements.console.scrollHeight;
}

function addDetailedConsoleMessage(message, type = 'stdout') {
    const timestamp = new Date().toLocaleTimeString();
    
    // Use the same transaction-related filtering as the main console
    const isTransactionRelated = (
        // Transaction execution and status indicators
        message.includes('Transaction execution') ||
        message.includes('Transaction hash:') ||
        message.includes('Success:') ||
        message.includes('Failed:') ||
        message.includes('Received:') ||
        message.includes('completed') ||
        message.includes('Confirmed') ||
        message.includes('PENDING') ||
        message.includes('CONFIRMED') ||
        message.includes('SUCCESSFUL') ||
        // Swap and trading information
        message.includes('Swapping') ||
        message.includes('Buying') ||
        message.includes('Selling') ||
        message.includes('tokens for') ||
        message.includes('ETH for') ||
        message.includes('EXECUTED TRADE') ||
        message.includes('Order placed') ||
        message.includes('Executed') ||
        // Loop and batch operations
        message.includes('LOOP') ||
        message.includes('loop') ||
        message.includes('Batch') ||
        // Critical infrastructure
        message.includes('TRUSTSWAP') ||
        message.includes('RPC USED:') ||
        message.includes('Gas price') ||
        message.includes('Tx Fee:') ||
        // Additional transaction details
        message.includes('0x') || // Any hex address or hash
        message.includes('ETH') ||
        message.includes('VIRTUAL') ||
        message.includes('TRUST') ||
        message.includes('Balance:') ||
        message.includes('Amount:') ||
        message.includes('Price:') ||
        message.includes('Slippage:') ||
        message.includes('Receipt:') ||
        message.includes('Status:') ||
        message.includes('Block:') ||
        message.includes('Nonce:') ||
        message.includes('Gas:') ||
        message.includes('Fee:') ||
        message.includes('Total:') ||
        message.includes('Wallet:') ||
        message.includes('Token:') ||
        message.includes('Contract:') ||
        message.includes('Pool:') ||
        message.includes('Pair:') ||
        message.includes('Router:') ||
        message.includes('Approve') ||
        message.includes('Transfer') ||
        message.includes('Swap') ||
        message.includes('Trade')
    );
    
    // Check for duplicate messages (prevent double logging)
    const isWalletLoadingMessage = message.includes('Successfully loaded') && message.includes('wallet') && message.includes('Ready to trade');
    const dedupeTimeWindow = isWalletLoadingMessage ? 10000 : 2000;
    
    // Check the last few detailed console messages for duplicates
    for (let i = detailedConsoleLines.length - 1; i >= Math.max(0, detailedConsoleLines.length - 10); i--) {
        const existingMessage = detailedConsoleLines[i];
        const timeDiff = new Date() - new Date(existingMessage.fullTimestamp || 0);
        
        if (existingMessage.fullMessage === message && timeDiff < dedupeTimeWindow) {
            console.log('Prevented duplicate detailed console message:', message);
            return;
        }
    }
    
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    
    // Clean message of emojis and marketing words (same as main console)
    const cleanMessage = message
        .replace(/[^\w\s\.\-\:\(\)\[\]\/\\%]/g, '') // Remove emojis and special chars
        .replace(/\b(amazing|awesome|great|excellent|fantastic|perfect|wow|cool|exciting|incredible)\b/gi, '') // Remove marketing words
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
    
    line.innerHTML = `<span class="console-timestamp">[${timestamp}]</span> ${cleanMessage}`;
    
    // Add to detailed console
    const detailedConsole = document.getElementById('console-detailed');
    if (!detailedConsole) return; // Safety check
    
    const welcome = detailedConsole.querySelector('.console-welcome');
    if (welcome) {
        welcome.remove();
    }
    
    detailedConsole.appendChild(line);
    
    // Store full timestamp and original message for deduplication checking (same as main console)
    detailedConsoleLines.push({ 
        timestamp, 
        message: cleanMessage, 
        fullMessage: message, // Original message before cleaning
        fullTimestamp: new Date(), 
        type 
    });
    
    // Auto-scroll detailed console
    detailedConsole.scrollTop = detailedConsole.scrollHeight;
    
    // Limit detailed console lines (same as main console)
    if (detailedConsoleLines.length > 1000) {
        const oldLines = detailedConsole.querySelectorAll('.console-line');
        if (oldLines.length > 500) {
            for (let i = 0; i < 100; i++) {
                if (oldLines[i]) {
                    oldLines[i].remove();
                }
            }
        }
        detailedConsoleLines = detailedConsoleLines.slice(-500);
    }
}

// Global variable to track console window state
let consoleWindowOpen = false;

function toggleLogView() {
    if (!consoleWindowOpen) {
        // Open console window
        openConsoleWindow();
    } else {
        // Close console window (handled by window close event)
        consoleWindowOpen = false;
        updateToggleButtonText();
    }
}

// Function to open console window using Electron IPC
async function openConsoleWindow() {
    try {
        const result = await ipcRenderer.invoke('create-console-window');
        if (result.success) {
            consoleWindowOpen = true;
            updateToggleButtonText();
            
            // Send existing console messages to the new window
            if (detailedConsoleLines && detailedConsoleLines.length > 0) {
                for (const line of detailedConsoleLines) {
                    await ipcRenderer.invoke('send-console-message', line.fullMessage || line.message, line.type);
                }
            }
        }
    } catch (error) {
        console.error('Error opening console window:', error);
        alert('Failed to open console window. Please try again.');
    }
}

// Function to send message to console window
async function addMessageToPopup(message, type = 'stdout') {
    if (!consoleWindowOpen) {
        return;
    }
    
    // Filter out specific error messages that shouldn't appear in detailed view
    if (message.includes('Error initializing wallets: Cannot read properties of undefined (reading length)')) {
        return; // Skip this specific error message
    }
    
    try {
        await ipcRenderer.invoke('send-console-message', message, type);
    } catch (error) {
        console.error('Error sending message to console window:', error);
        // If sending fails, the window might be closed
        consoleWindowOpen = false;
        updateToggleButtonText();
    }
}

// Function to update toggle button text
function updateToggleButtonText() {
    const toggleButton = document.getElementById('toggle-log-view');
    if (toggleButton) {
        if (consoleWindowOpen) {
            toggleButton.textContent = 'Close Console Window';
        } else {
            toggleButton.textContent = 'Detailed View';
        }
    }
}

function clearDetailedConsole() {
    const detailedConsole = document.getElementById('console-detailed');
    const header = detailedConsole.querySelector('.detailed-console-header');
    
    // Clear all content except header
    detailedConsole.innerHTML = '';
    if (header) {
        detailedConsole.appendChild(header);
    }
    
    // Clear the detailed console lines array
    detailedConsoleLines = [];
    
    // Add welcome message
    const welcomeMsg = document.createElement('div');
    welcomeMsg.className = 'console-welcome';
    welcomeMsg.style.cssText = `
        color: #7d8590;
        font-style: italic;
        text-align: center;
        padding: 20px;
    `;
    welcomeMsg.textContent = 'Detailed console cleared. New logs will appear here...';
    detailedConsole.appendChild(welcomeMsg);
}

// Make the function globally accessible
window.clearDetailedConsole = clearDetailedConsole;

// Wallet Selection Functions
async function setupWalletSelection() {
    try {
        // Get wallet data from main process
        const result = await ipcRenderer.invoke('get-all-wallets');
        
        if (result.success && result.wallets && result.wallets.length > 0) {
            availableWallets = result.wallets;
            populateWalletGrid();
            
            // Auto-select first wallet (B1) by default if no wallets are selected
            if (selectedWallets.size === 0 && availableWallets.length > 0) {
                selectedWallets.add(0);
                addConsoleMessage(`🔑 Auto-selected first wallet (B1) as default`, 'info');
            }
            updateWalletSelection();
            
            // Update wallet count in status panel
            elements.walletCount.textContent = `✅ ${availableWallets.length} wallets ready`;
            addConsoleMessage(`✅ Successfully loaded ${availableWallets.length} wallet${availableWallets.length !== 1 ? 's' : ''} - Ready to trade!`, 'success');
        } else {
            // No wallets found - show setup instructions
            availableWallets = [];
            showWalletSetupInstructions();
            elements.walletCount.textContent = '⚠️ No wallets configured';
            addConsoleMessage('⚠️ No wallets configured. Please set up your wallets in settings.', 'warning');
        }
    } catch (error) {
        addConsoleMessage(`❌ Wallet loading error: ${error.message}`, 'error');
        elements.walletCount.textContent = '❌ Error loading wallets';
        showWalletSetupInstructions();
    }
}

function showWalletSetupInstructions() {
    const walletGrid = document.getElementById('wallet-grid');
    
    // Display a minimal message prompting users to add wallets
    walletGrid.innerHTML = `
        <div class="simple-wallet-message">
            Click above to add wallets
        </div>
    `;
    
    updateWalletSelection();
}

function populateWalletGrid() {
    const walletGrid = document.getElementById('wallet-grid');
    
    // Auto-select B1 (index 0) by default if not already selected
    if (availableWallets.length > 0 && selectedWallets.size === 0) {
        selectedWallets.add(0);
    }
    
    walletGrid.innerHTML = availableWallets.map((wallet, index) => {
        const walletName = `B${index + 1}`;
        const addressSuffix = wallet.address.slice(-6);
        
        return `
            <div class="wallet-item ${selectedWallets.has(index) ? 'selected' : ''}" onclick="toggleWallet(${index})">
                <input type="checkbox" class="wallet-checkbox" id="wallet-${index}" ${selectedWallets.has(index) ? 'checked' : ''}>
                <div class="wallet-info">
                    <span class="wallet-label">${walletName} ${addressSuffix}</span>
                </div>
            </div>
        `;
    }).join('');
    
    updateWalletSelection();
}

function toggleWallet(walletIndex) {
    const checkbox = document.getElementById(`wallet-${walletIndex}`);
    const walletItem = checkbox.closest('.wallet-item');
    
    if (selectedWallets.has(walletIndex)) {
        selectedWallets.delete(walletIndex);
        checkbox.checked = false;
        walletItem.classList.remove('selected');
    } else {
        selectedWallets.add(walletIndex);
        checkbox.checked = true;
        walletItem.classList.add('selected');
    }
    
    updateWalletSelection();
}

function selectAllWallets() {
    selectedWallets.clear();
    availableWallets.forEach((_, index) => {
        selectedWallets.add(index);
    });
    
    // Update checkboxes and styling
    availableWallets.forEach((_, index) => {
        const checkbox = document.getElementById(`wallet-${index}`);
        const walletItem = checkbox.closest('.wallet-item');
        if (checkbox && walletItem) {
            checkbox.checked = true;
            walletItem.classList.add('selected');
        }
    });
    
    updateWalletSelection();
}

function clearAllWallets() {
    selectedWallets.clear();
    
    // Update checkboxes and styling
    availableWallets.forEach((_, index) => {
        const checkbox = document.getElementById(`wallet-${index}`);
        const walletItem = checkbox.closest('.wallet-item');
        if (checkbox && walletItem) {
            checkbox.checked = false;
            walletItem.classList.remove('selected');
        }
    });
    
    updateWalletSelection();
}

// Debounced version of updateWalletSelection
function updateWalletSelection() {
    // Clear any existing timeout to prevent multiple rapid updates
    if (walletSelectionTimeout) {
        clearTimeout(walletSelectionTimeout);
    }
    
    // Set a small delay before updating the UI (50ms is usually not noticeable)
    walletSelectionTimeout = setTimeout(() => {
        // Execute the actual update function
        performWalletSelectionUpdate();
    }, 50);
}

// The actual implementation that updates the UI
function performWalletSelectionUpdate() {
    const selectedCount = selectedWallets.size;
    const totalCount = availableWallets.length;
    
    // Update counter - simple text update is fast
    const countElement = document.getElementById('selected-wallet-count');
    if (countElement) {
        countElement.textContent = `${selectedCount} of ${totalCount} wallets selected`;
    }
    
    // Show/hide parallel info - simple display toggle is fast
    const parallelInfo = document.getElementById('wallet-parallel-info');
    if (parallelInfo) {
        parallelInfo.style.display = selectedCount > 1 ? 'inline' : 'none';
    }
    
    // Update header wallets display - this is the expensive part that we debounce
    const headerWalletsDisplay = document.getElementById('header-wallets-display');
    if (headerWalletsDisplay) {
        // Prepare content outside of DOM manipulation
        let displayHTML = '';
        
        if (selectedCount > 0) {
            // Create wallet elements array - process in memory first
            const walletElements = Array.from(selectedWallets)
                .map(index => {
                    const wallet = availableWallets[index];
                    const walletName = wallet ? wallet.name : `Wallet ${index+1}`;
                    return {
                        index: index,
                        name: walletName
                    };
                });
            
            // Create HTML for wallet chips
            displayHTML = walletElements.map(wallet => 
                `<span class="selected-wallet-chip">
                    <span class="chip-text">${wallet.name}</span>
                    <button class="wallet-remove-btn" onclick="toggleWallet(${wallet.index}); event.stopPropagation();">×</button>
                </span>`
            ).join('');
        } else {
            displayHTML = '<span class="no-wallets">No wallets selected</span>';
        }
        
        // Apply changes to DOM in a single operation
        headerWalletsDisplay.innerHTML = displayHTML;
    }
}

// Make toggleWallet globally accessible
window.toggleWallet = toggleWallet;

/**
 * Toggle visibility of private key input field
 */
function togglePrivateKeyVisibility() {
    const privateKeyInput = document.getElementById('wallet-private-key');
    const toggleButton = document.querySelector('.toggle-visibility i');
    
    if (privateKeyInput.type === 'password') {
        privateKeyInput.type = 'text';
        toggleButton.className = 'fas fa-eye-slash';
    } else {
        privateKeyInput.type = 'password';
        toggleButton.className = 'fas fa-eye';
    }
}

// Make function accessible globally
window.togglePrivateKeyVisibility = togglePrivateKeyVisibility;

/**
 * Open the add wallet modal
 */
function addNewWallet() {
    // Show the add wallet modal
    document.getElementById('add-wallet-modal').style.display = 'block';
    
    // Clear previous values
    document.getElementById('wallet-name').value = '';
    document.getElementById('wallet-private-key').value = '';
    
    // Hide address preview
    const addressPreview = document.getElementById('wallet-address-preview');
    const derivedAddress = document.getElementById('derived-address');
    if (addressPreview) addressPreview.style.display = 'none';
    if (derivedAddress) derivedAddress.textContent = '';
}

// Make function accessible globally
window.addNewWallet = addNewWallet;

/**
 * Delete selected wallets from the system
 */
async function deleteSelectedWallets() {
    // Check if any wallets are selected
    if (selectedWallets.size === 0) {
        addConsoleMessage('❌ No wallets selected for deletion', 'error');
        return;
    }
    
    // Ask for confirmation
    const confirmDelete = confirm(`Are you sure you want to delete ${selectedWallets.size} selected wallet(s)? This cannot be undone.`);
    if (!confirmDelete) return;
    
    addConsoleMessage(`🗑️ Deleting ${selectedWallets.size} selected wallets...`, 'info');
    
    // Get the wallet IDs for the selected indices
    const walletIdsToDelete = Array.from(selectedWallets)
        .map(index => availableWallets[index]?.id)
        .filter(id => id); // Filter out any undefined IDs
    
    if (walletIdsToDelete.length === 0) {
        addConsoleMessage('❌ Could not find wallet IDs to delete', 'error');
        return;
    }
    
    // Delete each wallet
    const results = [];
    for (const walletId of walletIdsToDelete) {
        try {
            const result = await ipcRenderer.invoke('delete-wallet', walletId);
            results.push({
                id: walletId,
                success: result.success,
                error: result.error
            });
        } catch (error) {
            results.push({
                id: walletId,
                success: false,
                error: error.message
            });
        }
    }
    
    // Count successes and failures
    const successes = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success).length;
    
    if (failures > 0) {
        addConsoleMessage(`⚠️ Deleted ${successes} wallets, but ${failures} failed to delete`, 'warning');
    } else {
        addConsoleMessage(`✅ Successfully deleted ${successes} wallets`, 'success');
    }
    
    // Clear the selection
    selectedWallets.clear();
    
    // Refresh the wallet list
    refreshWallets();
}

// Make function accessible globally
window.deleteSelectedWallets = deleteSelectedWallets;

/**
 * Refresh the wallet list from the main process
 */
async function refreshWallets() {
    try {
        // Fetch wallets from main process silently
        const result = await ipcRenderer.invoke('get-all-wallets');
        
        if (result && result.success && Array.isArray(result.wallets)) {
            // Store wallets in global variable
            availableWallets = result.wallets;
            
            // Populate wallet grid
            populateWalletGrid();
            
            // Clear selection since indices might have changed
            selectedWallets.clear();
            updateWalletSelection();
            
            // Update wallet count in status panel only
            elements.walletCount.textContent = `✅ ${availableWallets.length} wallets ready`;
            // Only show console message on first load or if there's an issue
        } else {
            addConsoleMessage('❌ Failed to load wallets', 'error');
        }
    } catch (error) {
        console.error('Error refreshing wallets:', error);
        addConsoleMessage(`❌ Error refreshing wallets: ${error.message}`, 'error');
    }
}

// Make function accessible globally
window.refreshWallets = refreshWallets;

/**
 * Populate the wallet grid with available wallets
 */
function populateWalletGrid() {
    const walletGrid = document.getElementById('wallet-grid');
    if (!walletGrid) return;
    
    // Remove any empty wallet UI elements, but only within the wallet grid's parent container
    // This is more targeted and performant than searching the entire document
    const parentContainer = walletGrid.parentNode;
    
    // Simple array of common class names to check
    const commonClasses = ['no-wallets-box', 'wallet-guide-box', 'wallet-empty-state', 'no-wallet-message'];
    
    // Look only in the same container as the wallet grid
    if (parentContainer) {
        // Get direct children of the parent container
        const siblings = parentContainer.children;
        
        // Iterate through siblings (much faster than querySelectorAll)
        for (let i = 0; i < siblings.length; i++) {
            const el = siblings[i];
            
            // Skip the wallet grid itself
            if (el === walletGrid) continue;
            
            // Check if element matches our criteria
            const shouldRemove = (
                el.id && (el.id.includes('wallet-guide') || el.id.includes('no-wallet')) ||
                commonClasses.some(className => el.classList && el.classList.contains(className))
            );
            
            // Hide element if it matches
            if (shouldRemove) {
                el.style.display = 'none';
            }
        }
    }
    
    // Clear previous content of the wallet grid
    walletGrid.innerHTML = '';
    
    // Show a simple message when no wallets are available
    if (!availableWallets || availableWallets.length === 0) {
        // Create a clean, simple message
        const messageDiv = document.createElement('div');
        messageDiv.className = 'simple-wallet-message';
        messageDiv.textContent = 'Click above to add wallets';
        walletGrid.appendChild(messageDiv);
        
        // Force the wallet grid to be visible
        walletGrid.style.display = 'block';
        return;
    }
    
    // Use document fragment for better performance
    const fragment = document.createDocumentFragment();
    
    // Generate HTML for each wallet
    availableWallets.forEach((wallet, index) => {
        // Get wallet name and address suffix for display
        const walletName = wallet.name || 'Unnamed Wallet';
        const address = wallet.address || '';
        const addressSuffix = address ? 
            `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : 
            'No Address';
        
        // Create wallet item element
        const walletItem = document.createElement('div');
        walletItem.className = `wallet-item ${selectedWallets.has(index) ? 'selected' : ''}`;
        walletItem.onclick = () => toggleWallet(index);
        
        // Create wallet item HTML
        walletItem.innerHTML = `
            <input type="checkbox" id="wallet-${index}" 
                   ${selectedWallets.has(index) ? 'checked' : ''}>
            <div class="wallet-info">
                <span class="wallet-name">${walletName}</span>
                <span class="wallet-address">${addressSuffix}</span>
            </div>
        `;
        
        // Add to fragment instead of directly to DOM
        fragment.appendChild(walletItem);
    });
    
    // Add all elements to the DOM at once (single reflow)
    walletGrid.appendChild(fragment);
    
    // Update wallet selection count
    updateWalletSelection();
}

/**
 * Toggle wallet selection state
 */
function toggleWallet(walletIndex) {
    if (selectedWallets.has(walletIndex)) {
        selectedWallets.delete(walletIndex);
    } else {
        selectedWallets.add(walletIndex);
    }
    
    // Update checkbox and styling
    const checkbox = document.getElementById(`wallet-${walletIndex}`);
    const walletItem = checkbox.closest('.wallet-item');
    
    if (checkbox && walletItem) {
        checkbox.checked = selectedWallets.has(walletIndex);
        if (selectedWallets.has(walletIndex)) {
            walletItem.classList.add('selected');
        } else {
            walletItem.classList.remove('selected');
        }
    }
    
    // Update selection counter
    updateWalletSelection();
}

// Make function accessible globally
window.refreshWallets = refreshWallets;
window.populateWalletGrid = populateWalletGrid;
window.toggleWallet = toggleWallet;

/**
 * Listen for private key input to show derived address
 * Uses debouncing to prevent excessive API calls and UI updates
 */
function setupWalletPrivateKeyListener() {
    const privateKeyInput = document.getElementById('wallet-private-key');
    if (!privateKeyInput) return;
    
    // Use a debounce delay for private key detection to prevent excessive API calls
    const DEBOUNCE_DELAY = 300; // ms
    let privateKeyTimeout = null;
    
    privateKeyInput.addEventListener('input', function() {
        const privateKey = this.value.trim();
        const addressPreview = document.getElementById('wallet-address-preview');
        const derivedAddress = document.getElementById('derived-address');
        
        // Hide preview if input is too short
        if (privateKey.length < 64) {
            addressPreview.style.display = 'none';
            return;
        }
        
        // Show a loading indicator immediately for better UX
        addressPreview.style.display = 'flex';
        derivedAddress.textContent = 'Detecting address...';
        derivedAddress.classList.remove('valid', 'invalid');
        
        // Clear any pending timeout
        if (privateKeyTimeout) {
            clearTimeout(privateKeyTimeout);
        }
        
        // Set a new timeout for address detection
        privateKeyTimeout = setTimeout(async () => {
            try {
                // Call the IPC handler to detect the address
                const result = await ipcRenderer.invoke('detect-wallet-address', privateKey);
                
                if (result && result.success) {
                    addressPreview.style.display = 'flex';
                    derivedAddress.textContent = result.address;
                    derivedAddress.classList.add('valid');
                    derivedAddress.classList.remove('invalid');
                } else {
                    addressPreview.style.display = 'flex';
                    derivedAddress.textContent = 'Invalid private key';
                    derivedAddress.classList.add('invalid');
                    derivedAddress.classList.remove('valid');
                }
            } catch (error) {
                addressPreview.style.display = 'flex';
                derivedAddress.textContent = 'Error: ' + error.message;
                derivedAddress.classList.add('invalid');
                derivedAddress.classList.remove('valid');
            }
        }, DEBOUNCE_DELAY);
    });
}

/**
 * Submit a new wallet to be saved
 */
async function submitWallet() {
    try {
        const name = document.getElementById('wallet-name').value.trim();
        const privateKey = document.getElementById('wallet-private-key').value.trim();
        
        // Validate form inputs
        if (!name) {
            alert('Please enter a wallet name');
            return;
        }
        if (!privateKey) {
            alert('Please enter a private key');
            return;
        }
        
        // Format private key - remove 0x prefix if present
        const formattedKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
        
        // Validate the private key
        let result;
        try {
            result = await ipcRenderer.invoke('detect-wallet-address', formattedKey);
            if (!result || !result.success) {
                alert('Invalid private key format');
                return;
            }
        } catch (error) {
            alert('Error validating private key: ' + error.message);
            return;
        }
        
        // Create wallet object
        const wallet = {
            id: generateUUID(),
            name: name,
            privateKey: formattedKey,  // Without 0x prefix for consistency
            address: result.address,
            enabled: true,
            dateAdded: new Date().toISOString()
        };
        
        // Submit the wallet to be added
        const addResult = await ipcRenderer.invoke('add-wallet', wallet);
        
        if (addResult && addResult.success) {
            // Close the modal
            document.getElementById('add-wallet-modal').style.display = 'none';
            
            // Refresh the wallet grid
            await refreshWallets();
            
            // Show success message
            addConsoleMessage(`✅ Wallet ${name} added successfully`, 'success');
        } else {
            alert('Failed to add wallet: ' + (addResult?.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error submitting wallet:', error);
        alert('Error adding wallet: ' + error.message);
    }
}

// Make function accessible globally
window.submitWallet = submitWallet;

/**
 * Open the edit wallet modal for a specific wallet
 */
async function editWallet(walletId) {
    try {
        // Get the wallet data
        const result = await ipcRenderer.invoke('get-wallet', walletId);
        
        if (!result || !result.success) {
            alert('Failed to get wallet: ' + (result?.error || 'Unknown error'));
            return;
        }
        
        const wallet = result.wallet;
        
        // Populate the form
        document.getElementById('edit-wallet-id').value = wallet.id;
        document.getElementById('edit-wallet-name').value = wallet.name;
        
        // Show the modal
        document.getElementById('edit-wallet-modal').style.display = 'block';
    } catch (error) {
        console.error('Error opening edit wallet modal:', error);
        alert('Error opening edit wallet modal: ' + error.message);
    }
}

/**
 * Submit edit wallet form
 */
async function submitEditWallet() {
    try {
        const id = document.getElementById('edit-wallet-id').value;
        const name = document.getElementById('edit-wallet-name').value.trim();
        
        if (!id || !name) {
            alert('Wallet ID and name are required');
            return;
        }
        
        // Create update object
        const updates = {
            id: id,
            name: name
        };
        
        // Submit the wallet to be updated
        const result = await ipcRenderer.invoke('update-wallet', updates);
        
        if (result && result.success) {
            // Close the modal
            document.getElementById('edit-wallet-modal').style.display = 'none';
            
            // Refresh the wallet grid
            await refreshWallets();
            
            // Show success message
            addConsoleMessage(`✅ Wallet updated successfully`, 'success');
        } else {
            alert('Failed to update wallet: ' + (result?.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error updating wallet:', error);
        alert('Error updating wallet: ' + error.message);
    }
}

// Make functions accessible globally
window.editWallet = editWallet;
window.submitEditWallet = submitEditWallet;

/**
 * Show the delete wallet confirmation modal
 */
function confirmDeleteWallet(walletId, walletName) {
    // Store the wallet ID for deletion
    document.getElementById('delete-wallet-id').value = walletId;
    
    // Show wallet name in confirmation message
    const confirmMessage = document.getElementById('delete-wallet-confirm-message');
    if (confirmMessage) {
        confirmMessage.textContent = `Are you sure you want to delete the wallet "${walletName}"?`;
    }
    
    // Show the modal
    document.getElementById('delete-wallet-modal').style.display = 'block';
}

/**
 * Execute wallet deletion after confirmation
 */
async function executeDeleteWallet() {
    try {
        const walletId = document.getElementById('delete-wallet-id').value;
        
        if (!walletId) {
            alert('No wallet selected for deletion');
            return;
        }
        
        // Submit the deletion request
        const result = await ipcRenderer.invoke('delete-wallet', walletId);
        
        if (result && result.success) {
            // Close the modal
            document.getElementById('delete-wallet-modal').style.display = 'none';
            
            // Refresh the wallet grid
            await refreshWallets();
            
            // Show success message
            addConsoleMessage(`✅ Wallet deleted successfully`, 'success');
        } else {
            alert('Failed to delete wallet: ' + (result?.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error deleting wallet:', error);
        alert('Error deleting wallet: ' + error.message);
    }
}

// Make functions accessible globally
window.confirmDeleteWallet = confirmDeleteWallet;
window.executeDeleteWallet = executeDeleteWallet;

/**
 * Show the master password modal
 */
function showMasterPasswordModal(action = 'verify', callback = null) {
    // Different content based on action type
    if (action === 'create') {
        document.getElementById('create-master-password-modal').style.display = 'block';
    } else {
        // Store callback if provided
        if (callback) {
            window.masterPasswordCallback = callback;
        }
        
        // Clear previous input
        document.getElementById('master-password').value = '';
        
        // Show the modal
        document.getElementById('master-password-modal').style.display = 'block';
    }
}

/**
 * Submit master password verification
 */
async function submitMasterPassword() {
    try {
        const password = document.getElementById('master-password').value;
        
        if (!password) {
            alert('Please enter your master password');
            return;
        }
        
        // Verify with main process
        const result = await ipcRenderer.invoke('verify-master-password', password);
        
        if (result && result.success) {
            // Close the modal
            document.getElementById('master-password-modal').style.display = 'none';
            
            // Call callback if exists
            if (window.masterPasswordCallback && typeof window.masterPasswordCallback === 'function') {
                window.masterPasswordCallback(password);
                // Clear callback after use
                window.masterPasswordCallback = null;
            }
        } else {
            alert('Invalid master password');
        }
    } catch (error) {
        console.error('Error verifying master password:', error);
        alert('Error: ' + error.message);
    }
}

/**
 * Create a new master password
 */
async function createMasterPassword() {
    try {
        const password = document.getElementById('new-master-password').value;
        const confirm = document.getElementById('confirm-master-password').value;
        
        if (!password) {
            alert('Please enter a master password');
            return;
        }
        
        if (password !== confirm) {
            alert('Passwords do not match');
            return;
        }
        
        // Send to main process
        const result = await ipcRenderer.invoke('set-master-password', password);
        
        if (result && result.success) {
            // Close the modal
            document.getElementById('create-master-password-modal').style.display = 'none';
            
            // Show success message
            addConsoleMessage('✅ Master password created successfully', 'success');
        } else {
            alert('Failed to create master password: ' + (result?.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error creating master password:', error);
        alert('Error: ' + error.message);
    }
}

// Make functions accessible globally
window.showMasterPasswordModal = showMasterPasswordModal;
window.submitMasterPassword = submitMasterPassword;
window.createMasterPassword = createMasterPassword;

// Initialize wallet UI on document load
// Modal display utility functions
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'block';
    } else {
        console.error(`Modal with ID '${modalId}' not found`);
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    } else {
        console.error(`Modal with ID '${modalId}' not found`);
    }
}

// Make modal functions globally accessible
window.showModal = showModal;
window.closeModal = closeModal;

document.addEventListener('DOMContentLoaded', function() {
    // Setup wallet listeners
    setupWalletPrivateKeyListener();
    
    // Add wallet controls event listeners
    const addWalletBtn = document.querySelector('.add-wallet-btn');
    const selectAllBtn = document.querySelector('.select-all-wallets');
    const clearAllBtn = document.querySelector('.clear-all-wallets');
    
    if (addWalletBtn) {
        addWalletBtn.addEventListener('click', addNewWallet);
    }
    
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', selectAllWallets);
    }
    
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', clearAllWallets);
    }
});

// Helper functions for wallet setup
async function refreshWallets() {
    addConsoleMessage('🔄 Refreshing wallet configuration...', 'info');
    await setupWalletSelection();
}

// Wallet management functions for JSON database
function loadWalletManagement(wallets) {
    const additionalWallets = document.getElementById('additional-wallets');
    additionalWallets.innerHTML = `
        <div class="wallet-management">
            <h4>💼 Wallet Management</h4>
            <div class="wallet-list" id="wallet-list">
                ${wallets.map(wallet => createWalletItem(wallet)).join('')}
            </div>
            <button type="button" class="btn btn-outline" onclick="addNewWallet()">+ Add New Wallet</button>
        </div>
    `;
    
    // Also populate the wallet grid in the settings modal
    populateWalletGridSettings(wallets);
}

function createWalletItem(wallet) {
    return `
        <div class="wallet-item" data-wallet-id="${wallet.id}">
            <div class="wallet-header">
                <h5>Wallet ${wallet.id} - ${wallet.name}</h5>
                <div class="wallet-controls">
                    <button type="button" class="btn btn-small btn-outline" onclick="editWallet(${wallet.id})">✏️ Edit</button>
                    <button type="button" class="btn btn-small btn-danger" onclick="deleteWallet(${wallet.id})">🗑️ Delete</button>
                </div>
            </div>
            <div class="wallet-details">
                <div class="form-group">
                    <label>Name:</label>
                    <span class="wallet-name">${wallet.name}</span>
                </div>
                <div class="form-group">
                    <label>Address:</label>
                    <span class="wallet-address">${wallet.address ? wallet.address.substring(0, 6) + '...' + wallet.address.substring(38) : 'Not available'}</span>
                </div>
                <div class="form-group">
                    <label>Status:</label>
                    <span class="wallet-status ${wallet.enabled ? 'enabled' : 'disabled'}">${wallet.enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
            </div>
        </div>
    `;
}

async function addNewWallet() {
    // Show the add wallet modal instead of using prompt
    document.getElementById('add-wallet-modal').style.display = 'block';
    
    // Clear previous values and reset detection displays
    document.getElementById('new-wallet-name').value = '';
    document.getElementById('new-wallet-key').value = '';
    
    // Hide address detection displays
    const addressDisplay = document.getElementById('new-wallet-address');
    const statusDisplay = document.getElementById('new-wallet-status');
    if (addressDisplay) addressDisplay.style.display = 'none';
    if (statusDisplay) statusDisplay.style.display = 'none';
}

async function submitAddWallet() {
    const name = document.getElementById('new-wallet-name').value.trim();
    const privateKey = document.getElementById('new-wallet-key').value.trim();
    
    if (!name || !privateKey) {
        addConsoleMessage('❌ Please fill in all fields', 'error');
        return;
    }
    
    // Validate the private key before submitting
    const addressDisplay = document.getElementById('new-wallet-address');
    if (!addressDisplay || addressDisplay.style.display === 'none') {
        addConsoleMessage('❌ Please enter a valid private key', 'error');
        return;
    }
    
    try {
        const result = await ipcRenderer.invoke('add-wallet', {
            name: name,
            privateKey: privateKey
        });
        
        if (result.success) {
            addConsoleMessage(`✅ Added wallet: ${result.wallet.name}`, 'success');
            closeModal('add-wallet-modal');
            refreshWalletManagement();
            refreshWallets(); // Also refresh the wallet selection panel
        } else {
            addConsoleMessage(`❌ Failed to add wallet: ${result.error}`, 'error');
        }
    } catch (error) {
        addConsoleMessage(`❌ Error adding wallet: ${error.message}`, 'error');
    }
}

async function editWallet(walletId) {
    try {
        const walletsResult = await ipcRenderer.invoke('get-all-wallets');
        if (!walletsResult.success) throw new Error('Failed to load wallets');
        
        const wallet = walletsResult.wallets.find(w => w.id === walletId);
        if (!wallet) throw new Error('Wallet not found');
        
        // Populate the edit modal with current values
        document.getElementById('edit-wallet-id').value = walletId;
        document.getElementById('edit-wallet-name').value = wallet.name;
        document.getElementById('edit-wallet-address').textContent = wallet.address || 'Address not available';
        
        // Show the edit modal
        document.getElementById('edit-wallet-modal').style.display = 'block';
        
    } catch (error) {
        addConsoleMessage(`❌ Error loading wallet for editing: ${error.message}`, 'error');
    }
}

async function submitEditWallet() {
    const walletId = parseInt(document.getElementById('edit-wallet-id').value);
    const newName = document.getElementById('edit-wallet-name').value.trim();
    
    if (!newName) {
        addConsoleMessage('❌ Please enter a wallet name', 'error');
        return;
    }
    
    try {
        const result = await ipcRenderer.invoke('update-wallet', walletId, { name: newName });
        
        if (result.success) {
            addConsoleMessage(`✅ Updated wallet: ${result.wallet.name}`, 'success');
            closeModal('edit-wallet-modal');
            refreshWalletManagement();
            refreshWallets(); // Also refresh the wallet selection panel
        } else {
            addConsoleMessage(`❌ Failed to update wallet: ${result.error}`, 'error');
        }
    } catch (error) {
        addConsoleMessage(`❌ Error updating wallet: ${error.message}`, 'error');
    }
}

async function deleteWallet(walletId) {
    if (!confirm('Are you sure you want to delete this wallet?')) return;
    
    try {
        const result = await ipcRenderer.invoke('delete-wallet', walletId);
        
        if (result.success) {
            addConsoleMessage(`✅ Deleted wallet`, 'success');
            refreshWalletManagement();
        } else {
            addConsoleMessage(`❌ Failed to delete wallet: ${result.error}`, 'error');
        }
    } catch (error) {
        addConsoleMessage(`❌ Error deleting wallet: ${error.message}`, 'error');
    }
}

async function refreshWalletManagement() {
    try {
        const result = await ipcRenderer.invoke('get-all-wallets');
        if (result.success) {
            loadWalletManagement(result.wallets);
        }
    } catch (error) {
        console.error('Error refreshing wallet management:', error);
    }
}

/**
 * Populates the wallet grid in the settings modal with wallet information
 * @param {Array} wallets - Array of wallet objects
 */
function populateWalletGridSettings(wallets) {
    const walletGrid = document.getElementById('wallet-grid-settings');
    if (!walletGrid) return;
    
    // Clear previous content
    walletGrid.innerHTML = '';
    
    // Show message if no wallets
    if (!wallets || wallets.length === 0) {
        walletGrid.innerHTML = `
            <div class="simple-wallet-message">
                No wallets added. Click "Add Wallet" to get started.
            </div>
        `;
        return;
    }
    
    // Create a document fragment for better performance
    const fragment = document.createDocumentFragment();
    
    // Generate wallet items
    wallets.forEach((wallet, index) => {
        const walletItem = document.createElement('div');
        walletItem.className = 'wallet-item';
        walletItem.dataset.walletId = wallet.id;
        
        // Format address for display
        const address = wallet.address || '';
        const displayAddress = address ? 
            `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : 
            'No Address';
        
        walletItem.innerHTML = `
            <div class="wallet-info">
                <div class="wallet-name-row">
                    <span class="wallet-name">${wallet.name}</span>
                    <div class="wallet-controls">
                        <button class="btn btn-small btn-outline" onclick="editWallet(${wallet.id})">
                            ✏️
                        </button>
                        <button class="btn btn-small btn-danger" onclick="deleteWallet(${wallet.id})">
                            🗑️
                        </button>
                    </div>
                </div>
                <div class="wallet-address-row">
                    <span class="wallet-address">${displayAddress}</span>
                    ${address ? `<button class="btn btn-small btn-copy" onclick="copyToClipboard('${address}', 'Wallet address copied!')">📋</button>` : ''}
                </div>
                <div class="wallet-status ${wallet.enabled !== false ? 'enabled' : 'disabled'}">
                    ${wallet.enabled !== false ? 'Enabled' : 'Disabled'}
                </div>
            </div>
        `;
        
        fragment.appendChild(walletItem);
    });
    
    // Add all elements to the DOM at once
    walletGrid.appendChild(fragment);
}

/**
 * Copy text to clipboard and show a temporary notification
 * @param {string} text - Text to copy
 * @param {string} message - Message to show in notification
 */
function copyToClipboard(text, message) {
    navigator.clipboard.writeText(text)
        .then(() => {
            // Show a temporary notification
            const notification = document.createElement('div');
            notification.className = 'copy-notification';
            notification.textContent = message || 'Copied!';
            document.body.appendChild(notification);
            
            // Remove after animation
            setTimeout(() => {
                notification.classList.add('fade-out');
                setTimeout(() => {
                    document.body.removeChild(notification);
                }, 500);
            }, 1500);
        })
        .catch(err => {
            console.error('Failed to copy text: ', err);
        });
}

// Make wallet management functions globally accessible
window.addNewWallet = addNewWallet;
window.editWallet = editWallet;
window.deleteWallet = deleteWallet;
window.submitAddWallet = submitAddWallet;
window.submitEditWallet = submitEditWallet;
window.copyToClipboard = copyToClipboard;

// Dynamic RPC Management Functions
function loadDynamicRpcs(config) {
    const container = document.getElementById('dynamic-rpcs-container');
    if (!container) return;
    
    const dynamicRpcs = config.dynamicRpcs || [];
    
    container.innerHTML = dynamicRpcs.map((rpc, index) => 
        createDynamicRpcItem(rpc, index)
    ).join('');
}

function createDynamicRpcItem(rpc, index) {
    const rpcName = rpc.name || `R${index + 1}`;
    return `
        <div class="form-group dynamic-rpc-item" data-rpc-index="${index}">
            <div class="form-section" style="background: rgba(0, 255, 136, 0.05); border-color: #00ff88;">
                <h5>🔗 ${rpcName}</h5>
                <div class="form-group">
                    <label for="dynamic-rpc-name-${index}">Provider Name:</label>
                    <input type="text" id="dynamic-rpc-name-${index}" value="${rpc.name || `R${index + 1}`}" placeholder="R${index + 1}" class="form-input">
                    <small>Custom name for this RPC provider</small>
                </div>
                <div class="form-group">
                    <label for="dynamic-rpc-url-${index}">HTTP RPC URL:</label>
                    <input type="text" id="dynamic-rpc-url-${index}" value="${rpc.rpcUrl || ''}" placeholder="https://your-rpc-provider.com/api-key" class="form-input" required>
                    <small>Primary HTTP RPC endpoint</small>
                </div>
                <div class="form-group">
                    <label for="dynamic-rpc-ws-${index}">WebSocket URL (Optional):</label>
                    <input type="text" id="dynamic-rpc-ws-${index}" value="${rpc.wsUrl || ''}" placeholder="wss://your-rpc-provider.com/api-key" class="form-input">
                    <small>WebSocket endpoint for real-time events</small>
                </div>
                <div class="form-group">
                    <label for="dynamic-rpc-enabled-${index}">Status:</label>
                    <select id="dynamic-rpc-enabled-${index}" class="form-select">
                        <option value="true" ${rpc.enabled !== false ? 'selected' : ''}>Enabled</option>
                        <option value="false" ${rpc.enabled === false ? 'selected' : ''}>Disabled</option>
                    </select>
                </div>
                <div class="form-group">
                    <button type="button" class="btn btn-danger btn-small" onclick="removeDynamicRpc(${index})">🗑️ Remove ${rpcName}</button>
                </div>
            </div>
        </div>
    `;
}

function addDynamicRpc() {
    const container = document.getElementById('dynamic-rpcs-container');
    if (!container) return;
    
    const currentRpcs = container.querySelectorAll('.dynamic-rpc-item');
    const newIndex = currentRpcs.length;
    
    const newRpcItem = createDynamicRpcItem({
        name: `R${newIndex + 1}`,
        rpcUrl: '',
        wsUrl: '',
        enabled: true
    }, newIndex);
    
    container.insertAdjacentHTML('beforeend', newRpcItem);
    
    // Scroll to the new item
    const newElement = container.lastElementChild;
    newElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Focus on the RPC URL input
    const urlInput = newElement.querySelector(`#dynamic-rpc-url-${newIndex}`);
    if (urlInput) {
        setTimeout(() => urlInput.focus(), 100);
    }
    
    addConsoleMessage(`➕ Added new RPC provider slot: R${newIndex + 1}`, 'info');
}

function removeDynamicRpc(index) {
    const container = document.getElementById('dynamic-rpcs-container');
    if (!container) return;
    
    const rpcItem = container.querySelector(`[data-rpc-index="${index}"]`);
    if (rpcItem) {
        const rpcName = document.getElementById(`dynamic-rpc-name-${index}`)?.value || `R${index + 1}`;
        
        if (confirm(`Are you sure you want to remove RPC provider "${rpcName}"?`)) {
            rpcItem.remove();
            reindexDynamicRpcs();
            addConsoleMessage(`🗑️ Removed RPC provider: ${rpcName}`, 'warning');
        }
    }
}

function reindexDynamicRpcs() {
    const container = document.getElementById('dynamic-rpcs-container');
    if (!container) return;
    
    const rpcItems = container.querySelectorAll('.dynamic-rpc-item');
    rpcItems.forEach((item, newIndex) => {
        item.setAttribute('data-rpc-index', newIndex);
        
        // Update all IDs and references in the item
        const inputs = item.querySelectorAll('input, select');
        inputs.forEach(input => {
            const oldId = input.id;
            const newId = oldId.replace(/\d+$/, newIndex);
            input.id = newId;
            
            const label = item.querySelector(`label[for="${oldId}"]`);
            if (label) label.setAttribute('for', newId);
        });
        
        // Update the remove button onclick
        const removeBtn = item.querySelector('.btn-danger');
        if (removeBtn) {
            removeBtn.setAttribute('onclick', `removeDynamicRpc(${newIndex})`);
            removeBtn.textContent = `🗑️ Remove R${newIndex + 1}`;
        }
        
        // Update the header
        const header = item.querySelector('h5');
        if (header) {
            const name = item.querySelector(`#dynamic-rpc-name-${newIndex}`)?.value || `R${newIndex + 1}`;
            header.textContent = `🔗 ${name}`;
        }
    });
}

function collectDynamicRpcs() {
    const container = document.getElementById('dynamic-rpcs-container');
    if (!container) return [];
    
    const rpcItems = container.querySelectorAll('.dynamic-rpc-item');
    const dynamicRpcs = [];
    
    rpcItems.forEach((item, index) => {
        const name = document.getElementById(`dynamic-rpc-name-${index}`)?.value.trim();
        const rpcUrl = document.getElementById(`dynamic-rpc-url-${index}`)?.value.trim();
        const wsUrl = document.getElementById(`dynamic-rpc-ws-${index}`)?.value.trim();
        const enabled = document.getElementById(`dynamic-rpc-enabled-${index}`)?.value === 'true';
        
        // Only include if RPC URL is provided
        if (rpcUrl) {
            dynamicRpcs.push({
                name: name || `R${index + 1}`,
                rpcUrl: rpcUrl,
                wsUrl: wsUrl || undefined,
                enabled: enabled
            });
        }
    });
    
    return dynamicRpcs;
}

// Update the saveConfig function to include dynamic RPCs
const originalSaveConfig = window.saveConfig || saveConfig;

// Make dynamic RPC functions globally accessible
window.addDynamicRpc = addDynamicRpc;
window.removeDynamicRpc = removeDynamicRpc;
window.loadDynamicRpcs = loadDynamicRpcs;
window.collectDynamicRpcs = collectDynamicRpcs;

// Export for debugging
window.botDebug = {
    addConsoleMessage,
    clearConsole,
    setBotRunning,
    runBot,
    stopBot,
    checkBalances,
    consoleLines,
    walletCount,
    selectedTickers,
    customTickers,
    selectedWallets,
    availableWallets,
    toggleLogView
};

window.toggleLogView = toggleLogView;
window.selectAllWallets = selectAllWallets;
window.clearAllWallets = clearAllWallets;
window.refreshWallets = refreshWallets; 
window.updateJeetRebuyPercentage = updateJeetRebuyPercentage;
window.updateJeetRebuyInterval = updateJeetRebuyInterval;
window.handleJeetModeChange = handleJeetModeChange;
window.updateJeetGasPrice = updateJeetGasPrice; 

// Handle MMBot CHASE mode toggle
function handleMMChaseToggle() {
    // CHASE mode toggle - no additional UI needed since detailed explanation was removed
    // Checkbox state is handled automatically by the browser
}

// Handle JeetBot mode change
function handleJeetModeChange(mode) {
    const basicModeEl = document.getElementById('jeet-mode-basic');
    const rebuyModeEl = document.getElementById('jeet-mode-rebuy-old');
    const rebuyOptionsEl = document.getElementById('jeet-rebuy-options');
    const basicExplanationEl = document.getElementById('jeet-basic-explanation');
    const rebuyExplanationEl = document.getElementById('jeet-rebuy-explanation');
    
    if (!basicModeEl || !rebuyModeEl) {
        console.error('JeetBot mode elements not found');
        return;
    }
    
    if (mode === 'basic') {
        // JEET mode selected - ensure only one is checked
        basicModeEl.checked = true;
        rebuyModeEl.checked = false;
        
        // Show/hide relevant sections
        if (rebuyOptionsEl) rebuyOptionsEl.style.display = 'none';
        if (basicExplanationEl) basicExplanationEl.style.display = 'block';
        if (rebuyExplanationEl) rebuyExplanationEl.style.display = 'none';
    } else if (mode === 'rebuy') {
        // REBUY mode selected - ensure only one is checked
        basicModeEl.checked = false;
        rebuyModeEl.checked = true;
        
        // Show/hide relevant sections
        if (rebuyOptionsEl) rebuyOptionsEl.style.display = 'block';
        if (basicExplanationEl) basicExplanationEl.style.display = 'none';
        if (rebuyExplanationEl) rebuyExplanationEl.style.display = 'block';
    }
}

// Update REBUY percentage from radio buttons
function updateJeetRebuyPercentage() {
    const selectedPercentage = document.querySelector('input[name="jeet-rebuy-percentage-option"]:checked');
    const customField = document.getElementById('jeet-rebuy-percentage');
    
    if (selectedPercentage && customField) {
        if (selectedPercentage.value === 'custom') {
            // Show custom field and focus on it
            customField.style.display = 'block';
            customField.focus();
        } else {
            // Hide custom field and use preset value
            customField.style.display = 'none';
            customField.value = selectedPercentage.value;
        }
    }
}

// Update REBUY interval from radio buttons
function updateJeetRebuyInterval() {
    // Interval radio buttons are handled directly - no custom option
    const selectedInterval = document.querySelector('input[name="jeet-rebuy-interval-option"]:checked');
    if (selectedInterval) {
        console.log(`REBUY interval selected: ${selectedInterval.value}s`);
    }
}

// Update gas price from radio buttons
function updateJeetGasPrice() {
    const customRadio = document.querySelector('input[name="jeet-gas-option"][value="custom"]');
    const customGasField = document.getElementById('jeet-custom-gas');
    
    if (customRadio && customGasField) {
        if (customRadio.checked) {
            customGasField.style.display = 'block';
            customGasField.focus();
        } else {
            customGasField.style.display = 'none';
        }
    }
}

// Dynamic Gas Price Display System
let gasUpdateInterval = null;

/**
 * Initialize dynamic gas price display
 */
function initializeDynamicGasDisplay() {
    updateAllGasPriceDisplays();
    
    // DON'T auto-update - only update on demand during transactions
    // gasUpdateInterval = setInterval(updateAllGasPriceDisplays, 10000);
}

/**
 * Update gas price status in system status section
 */
async function updateGasPriceStatus() {
    try {
        const gasData = await ipcRenderer.invoke('get-current-gas-price');
        
        if (gasData && gasData.success && elements.gasPriceStatus) {
            const { baseGasPrice, priorityFee } = gasData.data;
            // Calculate 100% priority fee (double the base gas price)
            const highPriorityFee = parseFloat(baseGasPrice);
            const totalWithHighPriority = parseFloat(baseGasPrice) + highPriorityFee;
            
            elements.gasPriceStatus.textContent = `${totalWithHighPriority.toFixed(5)} gwei`;
            elements.gasPriceStatus.title = `Alchemy: ${baseGasPrice} gwei + ${highPriorityFee.toFixed(5)} gwei (100% priority)`;
        } else if (elements.gasPriceStatus) {
            elements.gasPriceStatus.textContent = 'Unavailable';
        }
    } catch (error) {
        if (elements.gasPriceStatus) {
            elements.gasPriceStatus.textContent = 'Error';
        }
    }
}

/**
 * Update all gas price displays with current Alchemy pricing
 */
async function updateAllGasPriceDisplays() {
    try {
        // Get current gas price from backend
        const gasData = await ipcRenderer.invoke('get-current-gas-price');
        
        if (gasData && gasData.success) {
            const { baseGasPrice, priorityFee, totalGasPrice, source } = gasData.data;
            
            // Update main gas price input placeholder
            const mainGasInput = document.getElementById('gas-price');
            if (mainGasInput) {
                mainGasInput.placeholder = `${totalGasPrice} (Dynamic)`;
                mainGasInput.title = `Alchemy Gas Price: ${baseGasPrice} gwei + ${priorityFee} gwei (30% priority) = ${totalGasPrice} gwei`;
            }
            
            // Update system status gas price
            await updateGasPriceStatus();
            
            // Update MM gas price input
            const mmGasInput = document.getElementById('mm-gas-price');
            if (mmGasInput) {
                mmGasInput.placeholder = `${totalGasPrice} (Dynamic)`;
                mmGasInput.title = `Alchemy Gas Price: ${baseGasPrice} gwei + ${priorityFee} gwei (30% priority) = ${totalGasPrice} gwei`;
            }
            
            // Update gas price preset options
            updateGasPresetOptions(baseGasPrice, priorityFee, totalGasPrice);
            
            // Add gas price indicator to the page
            updateGasPriceIndicator(totalGasPrice, source);
            
        } else {
            console.warn('Failed to get gas price data:', gasData?.error);
        }
    } catch (error) {
        console.error('Error updating gas price displays:', error);
    }
}

/**
 * Update gas preset options with dynamic pricing
 */
function updateGasPresetOptions(baseGasPrice, priorityFee, totalGasPrice) {
    const presetSelects = ['gas-price-preset', 'mm-gas-price-preset'];
    
    presetSelects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            // Update the default option
            const defaultOption = select.querySelector('option[value="0.02"]');
            if (defaultOption) {
                defaultOption.textContent = `${totalGasPrice} gwei (Dynamic)`;
                defaultOption.value = totalGasPrice;
            }
            
            // Add dynamic options
            const dynamicOptions = [
                { value: (parseFloat(totalGasPrice) * 0.8).toFixed(6), label: `${(parseFloat(totalGasPrice) * 0.8).toFixed(6)} gwei (Dynamic -20%)` },
                { value: (parseFloat(totalGasPrice) * 1.2).toFixed(6), label: `${(parseFloat(totalGasPrice) * 1.2).toFixed(6)} gwei (Dynamic +20%)` },
                { value: (parseFloat(totalGasPrice) * 1.5).toFixed(6), label: `${(parseFloat(totalGasPrice) * 1.5).toFixed(6)} gwei (Dynamic +50%)` }
            ];
            
            // Remove old dynamic options
            const existingDynamicOptions = select.querySelectorAll('option[data-dynamic="true"]');
            existingDynamicOptions.forEach(opt => opt.remove());
            
            // Add new dynamic options
            dynamicOptions.forEach(option => {
                const optionElement = document.createElement('option');
                optionElement.value = option.value;
                optionElement.textContent = option.label;
                optionElement.setAttribute('data-dynamic', 'true');
                select.appendChild(optionElement);
            });
            
            // Update the custom dropdown if it exists
            if (window.initCustomDropdowns) {
                // Re-initialize the custom dropdown to reflect the new options
                const customDropdown = document.querySelector(`.custom-dropdown[data-for="${selectId}"]`);
                if (customDropdown) {
                    // Remove the old custom dropdown
                    customDropdown.remove();
                    // Create a new one with updated options
                    window.createCustomDropdown(select);
                }
            }
        }
    });
}

/**
 * Update gas price indicator in the UI
 * DISABLED: Gas display overlay removed per user request
 */
function updateGasPriceIndicator(totalGasPrice, source) {
    // Gas display overlay disabled - no UI element created
    return;
    
    /* COMMENTED OUT - Original gas display code
    let indicator = document.getElementById('gas-price-indicator');
    
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'gas-price-indicator';
        indicator.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: linear-gradient(135deg, #2c3e50, #3498db);
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: bold;
            z-index: 1000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            cursor: help;
        `;
        document.body.appendChild(indicator);
    }
    
    indicator.innerHTML = `⛽ ${totalGasPrice} gwei (${source})`;
    indicator.title = `Current gas price from ${source}. Updates every 10 seconds.`;
    */
}

/**
 * Initialize gas price display when page loads
 */
document.addEventListener('DOMContentLoaded', function() {
    initializeDynamicGasDisplay();
});

// Cleanup interval on page unload
window.addEventListener('beforeunload', function() {
    if (gasUpdateInterval) {
        clearInterval(gasUpdateInterval);
    }
});

/**
 * Create BuyBot arguments for multiple tokens in a single command
 * Format: [wallets] [tokens...] [amounts...] [C-currency] [L-loops] [slow] [gas]
 * @param {Array} tickers - Array of selected ticker objects
 * @returns {Array|null} Arguments array or null on error
 */
function getBuyBotArgsMultiTicker(tickers) {
    const amount = document.getElementById('buy-amount').value.trim();
    const twapCheckbox = document.getElementById('buy-type-twap');
    const buyType = (twapCheckbox && twapCheckbox.checked) ? 'twap' : 'normal';
    const ethCheckbox = document.getElementById('buy-currency-eth');
    const currency = (ethCheckbox && ethCheckbox.checked) ? 'ETH' : 'VIRTUAL';
    const gasPrice = document.getElementById('gas-price').value.trim();
    if (buyType === 'twap' && tickers.length > 1) {
        addConsoleMessage('❌ TWAP mode only supports single token trading', 'error');
        return null;
    }
    const args = [];
    if (selectedWallets.size > 0) {
        const walletSelectors = Array.from(selectedWallets)
            .map(index => `B${index + 1}`)
            .sort();
        args.push(...walletSelectors);
    }
    tickers.forEach(ticker => {
        args.push(ticker.symbol || ticker.address);
    });
    const finalAmount = amount || '100';
    const processedAmount = finalAmount === 'MAX' ? '99.99%' : finalAmount;
    tickers.forEach(() => {
        args.push(processedAmount);
    });
    if (!isBidModeActive && currency === 'ETH') {
        args.push('ETH');
    }
    args.push('slow');
    if (gasPrice && gasPrice !== '0.02') {
        args.push(`gas${gasPrice}`);
    }
    if (isBidModeActive) {
        if (!args.includes('slow')) args.push('slow');
        args.push('BID-MODE');
    }
    return args;
}

/**
 * Create SellBot arguments for multiple tokens in a single command
 * Format: [wallets] [tokens...] [amounts...] [L-loops] [currency] [slow] [gas]
 * @param {Array} tickers - Array of selected ticker objects
 * @returns {Array|null} Arguments array or null on error
 */
function getSellBotArgsMultiTicker(tickers) {
    const amount = document.getElementById('sell-amount').value.trim();
    const twapCheckbox = document.getElementById('sell-type-twap');
    const sellType = (twapCheckbox && twapCheckbox.checked) ? 'twap' : 'normal';
    const ethCheckbox = document.getElementById('sell-currency-eth');
    const currency = (ethCheckbox && ethCheckbox.checked) ? 'ETH' : 'VIRTUAL';
    const gasPrice = document.getElementById('gas-price').value.trim();
    if (sellType === 'twap' && tickers.length > 1) {
        addConsoleMessage('❌ TWAP mode only supports single token trading', 'error');
        return null;
    }
    const args = [];
    if (selectedWallets.size > 0) {
        const walletSelectors = Array.from(selectedWallets)
            .map(index => `B${index + 1}`)
            .sort();
        args.push(...walletSelectors);
    }
    tickers.forEach(ticker => {
        args.push(ticker.symbol || ticker.address);
    });
    const finalAmount = amount || '50%';
    const processedAmount = finalAmount === 'MAX' ? '99.99%' : finalAmount;
    tickers.forEach(() => {
        args.push(processedAmount);
    });
    if (!isBidModeActive && currency === 'ETH') {
        args.push('ETH');
    }
    if (gasPrice && gasPrice !== '0.02') {
        args.push(`gas${gasPrice}`);
    }
    if (isBidModeActive) {
        args.push('slow');
        args.push('BID-MODE');
    }
    return args;
}

/**
 * Toggle BID-MODE on/off
 * When active, only shows BID-MODE compatible bots and automatically adds BID-MODE to commands
 */
function toggleBidMode() {
    isBidModeActive = !isBidModeActive;
    
    const bidModeBtn = document.getElementById('bid-mode-toggle');
    const bidModeStatus = document.getElementById('bid-mode-status');
    const bidModeInfo = document.getElementById('bid-mode-info');
    const sidebar = document.querySelector('.sidebar');
    
    // Token selection panels
    const normalTickerPanel = document.getElementById('normal-ticker-selection');
    const bidTickerPanel = document.getElementById('bid-ticker-selection');
    
    if (bidModeBtn) {
        if (isBidModeActive) {
            // Activate BID-MODE
            bidModeBtn.classList.add('active');
            if (bidModeStatus) bidModeStatus.textContent = 'ON';
            if (bidModeInfo) bidModeInfo.style.display = 'block';
            if (sidebar) sidebar.classList.add('bid-mode-active');
            
            // Make the BID Tokens tab visually active to indicate it's for BID mode
            const bidTokensButton = document.getElementById('bid-tokens-nav-btn');
            if (bidTokensButton) {
                bidTokensButton.classList.add('bid-mode-button');
                addConsoleMessage('🎯 BID Tokens tab is ready for use', 'success');
            }
            
            // Hide any elements with not-bid-mode class
            document.querySelectorAll('.not-bid-mode').forEach(el => {
                el.style.display = 'none';
            });
            
            // Load BID tokens from bid.json database
            preloadBidTokenDatabase();
            
            // Initialize BID Token Selection UI if available
            if (window.BidTokenSelectionUI && typeof window.BidTokenSelectionUI.init === 'function') {
                window.BidTokenSelectionUI.init();
                addConsoleMessage('🔄 Initialized BID Token Selection UI', 'info');
            }
            
            // Automatically activate the BID Tokens tab
            setTimeout(() => {
                // Use the existing selectBot function to activate the BID Tokens form
                selectBot('bid-tokens');
                addConsoleMessage('📍 BID Tokens tab activated', 'info');
            }, 300); // Timeout to ensure DOM is ready
            
            addConsoleMessage('🎯 BID-MODE ACTIVATED: ETH Trading Mode', 'info');
            addConsoleMessage('💹 Only BuyBot, SellBot, FSH, and FarmBot are available', 'info');
            
            // Update currency labels
            updateBidModeCurrencyLabels();
            
            // Hide virtual options in forms
            hideBidModeVirtualOptions();
        } else {
            // Deactivate BID-MODE
            bidModeBtn.classList.remove('active');
            if (bidModeStatus) bidModeStatus.textContent = 'OFF';
            if (bidModeInfo) bidModeInfo.style.display = 'none';
            if (sidebar) sidebar.classList.remove('bid-mode-active');
            
            // Remove active styling from BID Tokens tab
            const bidTokensButton = document.getElementById('bid-tokens-nav-btn');
            if (bidTokensButton) {
                bidTokensButton.classList.remove('bid-mode-button');
            }
            
            // Show any elements with not-bid-mode class
            document.querySelectorAll('.not-bid-mode').forEach(el => {
                el.style.display = 'block';
            });
            
            // Switch token selection panels back
            if (normalTickerPanel) normalTickerPanel.style.display = 'block';
            if (bidTickerPanel) bidTickerPanel.style.display = 'none';
            
            // Update currency labels back to normal
            updateNormalCurrencyLabels();
            
            addConsoleMessage('⭕ BID-MODE DEACTIVATED: Normal Trading Mode', 'info');
            addConsoleMessage('🔹 All bots are now available', 'info');
            addConsoleMessage('🔹 Commands will use VIRTUAL currency and base.json database', 'info');
            addConsoleMessage('🔹 Token selection reset to TRUST (default)', 'info');
            
            // Reset currency labels to show VIRTUAL and show VIRTUAL options
            updateCurrencyLabels();
            showBidModeVirtualOptions();
            
            // Go back to the default form
            selectBot('default');
        }
    }
}


/**
 * Update currency labels when BID-MODE is active
 */
function updateBidModeCurrencyLabels() {
    const buyCurrencyLabel = document.getElementById('buy-currency-label');
    const sellCurrencyLabel = document.getElementById('sell-currency-label');
    
    if (isBidModeActive) {
        if (buyCurrencyLabel) {
            buyCurrencyLabel.textContent = 'Buy tokens With (BID-MODE: ETH):';
        }
        
        if (sellCurrencyLabel) {
            sellCurrencyLabel.textContent = 'Sell tokens For (BID-MODE: ETH):';
        }
        
        // Auto-select ETH checkboxes in BID-MODE
        const buyEthCheckbox = document.getElementById('buy-currency-eth');
        const buyVirtualCheckbox = document.getElementById('buy-currency-virtual');
        const sellEthCheckbox = document.getElementById('sell-currency-eth');
        const sellVirtualCheckbox = document.getElementById('sell-currency-virtual');
        
        if (buyEthCheckbox && buyVirtualCheckbox) {
            buyEthCheckbox.checked = true;
            buyVirtualCheckbox.checked = false;
        }
        
        if (sellEthCheckbox && sellVirtualCheckbox) {
            sellEthCheckbox.checked = true;
            sellVirtualCheckbox.checked = false;
        }
    } else {
        // Normal mode
        if (buyCurrencyLabel) {
            buyCurrencyLabel.textContent = 'Buy tokens With:';
        }
        
        if (sellCurrencyLabel) {
            sellCurrencyLabel.textContent = 'Sell tokens For:';
        }
        
        // Auto-select VIRTUAL checkboxes in normal mode
        const buyEthCheckbox = document.getElementById('buy-currency-eth');
        const buyVirtualCheckbox = document.getElementById('buy-currency-virtual');
        const sellEthCheckbox = document.getElementById('sell-currency-eth');
        const sellVirtualCheckbox = document.getElementById('sell-currency-virtual');
        
        if (buyEthCheckbox && buyVirtualCheckbox) {
            buyEthCheckbox.checked = false;
            buyVirtualCheckbox.checked = true;
        }
        
        if (sellEthCheckbox && sellVirtualCheckbox) {
            sellEthCheckbox.checked = false;
            sellVirtualCheckbox.checked = true;
        }
    }
}

/**
 * Hide VIRTUAL options in BID-MODE
 */
function hideBidModeVirtualOptions() {
    const buyVirtualCheckbox = document.getElementById('buy-currency-virtual');
    const sellVirtualCheckbox = document.getElementById('sell-currency-virtual');
    
    if (buyVirtualCheckbox) {
        buyVirtualCheckbox.parentElement.style.display = 'none';
    }
    
    if (sellVirtualCheckbox) {
        sellVirtualCheckbox.parentElement.style.display = 'none';
    }
}

/**
 * Show VIRTUAL options in normal mode
 */
function showBidModeVirtualOptions() {
    const buyVirtualCheckbox = document.getElementById('buy-currency-virtual');
    const sellVirtualCheckbox = document.getElementById('sell-currency-virtual');
    
    if (buyVirtualCheckbox) {
        buyVirtualCheckbox.parentElement.style.display = 'block';
    }
    
    if (sellVirtualCheckbox) {
        sellVirtualCheckbox.parentElement.style.display = 'block';
    }
}

/**
 * Load BID tokens from bid.json for BID-MODE Token Selection panel
 */
async function loadBidTokenDatabase() {
    try {
        const response = await fetch('./bid.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const bidData = await response.json();
        // Clear existing BID tokens
        const bidGrid = document.getElementById('bid-ticker-grid');
        if (bidGrid) {
            bidGrid.innerHTML = '';
        }
        // Add BID tokens to the grid
        bidData.forEach(token => {
            if (token.tokenAddress) {
                addBidToken(token.symbol, token.tokenAddress);
            }
        });
        // Auto-select DKING as default after a short delay
        setTimeout(() => {
            const dkingCheckbox = document.getElementById('bid-ticker-dking');
            if (dkingCheckbox) {
                dkingCheckbox.checked = true;
                // Manually add DKING to selectedTickers since it's checked by default in BID-MODE
                selectedTickers = [{
                    address: dkingCheckbox.dataset.address,
                    symbol: 'DKING'
                }];
                updateBidTickerSelection();
            }
        }, 100);
    } catch (error) {
        console.error('Error loading bid.json:', error);
        addConsoleMessage('❌ Error loading BID tokens from bid.json', 'error');
    }
}

/**
 * Add a BID token to the grid
 */
function addBidToken(symbol, address) {
    const bidGrid = document.getElementById('bid-ticker-grid');
    if (!bidGrid) return;
    const tickerItem = document.createElement('div');
    tickerItem.className = 'ticker-item';
    const checkboxId = `bid-ticker-${symbol.toLowerCase()}`;
    let shortAddress = 'N/A';
    if (address && address.length >= 10) {
        shortAddress = address.slice(0, 6) + '...' + address.slice(-4);
    }
    tickerItem.innerHTML = `
        <input type="checkbox" id="${checkboxId}" class="bid-ticker-checkbox" data-address="${address || ''}" onchange="updateBidTickerSelection()">
        <label for="${checkboxId}">
            <span class="ticker-symbol">${symbol}</span>
            <span class="ticker-address">${shortAddress}</span>
        </label>
    `;
    bidGrid.appendChild(tickerItem);
}

/**
 * Update BID ticker selection
 */
function updateBidTickerSelection() {
    const checkboxes = document.querySelectorAll('.bid-ticker-checkbox:checked');
    const count = checkboxes.length;
    const countElement = document.getElementById('selected-bid-ticker-count');
    
    if (countElement) {
        countElement.textContent = `${count} token${count !== 1 ? 's' : ''} selected (BID-MODE)`;
    }
    
    // Update selectedTickers for BID-MODE
    selectedTickers = [];
    checkboxes.forEach(checkbox => {
        const symbolElement = checkbox.nextElementSibling.querySelector('.ticker-symbol');
        const symbol = symbolElement ? symbolElement.textContent : 'UNKNOWN';
        selectedTickers.push({
            symbol: symbol,
            address: checkbox.dataset.address
        });
    });
}

/**
 * Select all BID tickers
 */
function selectAllBidTickers() {
    const checkboxes = document.querySelectorAll('.bid-ticker-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = true;
    });
    updateBidTickerSelection();
}

/**
 * Clear all BID tickers
 */
function clearAllBidTickers() {
    const checkboxes = document.querySelectorAll('.bid-ticker-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    updateBidTickerSelection();
}

/**
 * Handle BID token search
 */
function handleBidTokenSearch() {
    const input = document.getElementById('bid-token-field-input');
    const resultsDiv = document.getElementById('bid-search-results');
    
    if (!input || !resultsDiv) return;
    
    const query = input.value.trim();
    
    if (query.length < 2) {
        resultsDiv.style.display = 'none';
        return;
    }
    
    // Search in BID tokens
    performBidTokenSearch(query);
}

/**
 * Handle BID token search enter key
 */
function handleBidTokenSearchEnter(event) {
    if (event.key === 'Enter') {
        addBidTokenFromSearch();
    }
}

/**
 * Perform BID token search
 */
async function performBidTokenSearch(query) {
    try {
        const response = await fetch('./bid.json');
        const bidData = await response.json();
        
        const results = [];
        
        // Search by symbol
        Object.entries(bidData).forEach(([symbol, data]) => {
            if (symbol.toLowerCase().includes(query.toLowerCase()) && data.address) {
                results.push({
                    symbol: symbol,
                    address: data.address,
                    source: 'bid.json'
                });
            }
        });
        
        displayBidSearchResults(results, query);
        
    } catch (error) {
        console.error('Error searching bid.json:', error);
        showBidSearchStatus('Error searching BID tokens', 'error');
    }
}

/**
 * Display BID search results
 */
function displayBidSearchResults(results, query) {
    const resultsDiv = document.getElementById('bid-search-results');
    const statusDiv = document.getElementById('bid-search-status');
    
    if (!resultsDiv) return;
    
    if (results.length === 0) {
        resultsDiv.innerHTML = `<div class="no-results">No tokens matching "${query}" found</div>`;
        resultsDiv.style.display = 'block';
        return;
    }
    
    resultsDiv.innerHTML = '';
    resultsDiv.style.display = 'block';
    
    results.forEach(result => {
        const resultItem = document.createElement('div');
        resultItem.className = 'search-result-item';
        resultItem.innerHTML = `
            <span class="result-symbol">${result.symbol}</span>
            <span class="result-address">${result.address.slice(0, 6)}...${result.address.slice(-4)}</span>
        `;
        resultsDiv.appendChild(resultItem);
        
        // Add click event to select the token
        resultItem.addEventListener('click', () => {
            // Find and check the checkbox for this token
            const checkbox = document.getElementById(`bid-ticker-${result.symbol.toLowerCase()}`);
            if (checkbox) {
                checkbox.checked = true;
                updateBidTickerSelection();
                document.getElementById('bid-token-field-input').value = '';
                resultsDiv.style.display = 'none';
            }
        });
    });
}

/**
 * Select BID search result
 */
function selectBidSearchResult(token) {
    // Find and check the checkbox for this token
    const checkbox = document.getElementById(`bid-ticker-${token.symbol.toLowerCase()}`);
    if (checkbox) {
        checkbox.checked = true;
        updateBidTickerSelection();
        document.getElementById('bid-token-field-input').value = '';
        
        const resultsDiv = document.getElementById('bid-search-results');
        if (resultsDiv) {
            resultsDiv.style.display = 'none';
        }
    }
}

/**
 * Add BID token from search
 */
function addBidTokenFromSearch() {
    const input = document.getElementById('bid-token-field-input');
    if (!input) return;
    
    const tokenSymbol = input.value.trim().toUpperCase();
    
    if (!tokenSymbol) {
        showBidSearchStatus('Please enter a token symbol', 'warning');
        return;
    }
    
    // Check if token already exists
    const existingCheckbox = document.getElementById(`bid-ticker-${tokenSymbol.toLowerCase()}`);
    if (existingCheckbox) {
        existingCheckbox.checked = true;
        updateBidTickerSelection();
        input.value = '';
        showBidSearchStatus(`${tokenSymbol} selected`, 'success');
        return;
    }
    
    showBidSearchStatus(`Token ${tokenSymbol} not found in bid.json`, 'error');
}

/**
 * Show BID search status
 */
function showBidSearchStatus(message, type) {
    const statusDiv = document.getElementById('bid-search-status');
    if (!statusDiv) return;
    
    statusDiv.textContent = message;
    statusDiv.className = `search-status ${type}`;
    statusDiv.style.display = 'block';
    
    // Hide after 3 seconds
    setTimeout(() => {
        statusDiv.style.display = 'none';
    }, 3000);
}

/**
 * Hide BID search results
 */
function hideBidSearchResults() {
    const resultsDiv = document.getElementById('bid-search-results');
    if (resultsDiv) {
        resultsDiv.style.display = 'none';
    }
}

// BID-MODE Token Selection Panel Logic (copied and adapted from normal Token Selection)

// Render BID token grid
function renderBidTokenGrid() {
    const bidGrid = document.getElementById('bid-ticker-grid');
    if (!bidGrid) return;
    bidGrid.innerHTML = '';
    bidTokenDatabase.forEach(token => {
        const tickerItem = document.createElement('div');
        tickerItem.className = 'ticker-item';
        const checkboxId = `bid-ticker-${token.symbol.toLowerCase()}`;
        let shortAddress = 'N/A';
        if (token.address && token.address.length >= 10) {
            shortAddress = token.address.slice(0, 6) + '...' + token.address.slice(-4);
        }
        tickerItem.innerHTML = `
            <input type="checkbox" id="${checkboxId}" class="bid-ticker-checkbox" data-address="${token.address || ''}">
            <label for="${checkboxId}">
                <span class="ticker-symbol">${token.symbol}</span>
                <span class="ticker-address">${shortAddress}</span>
            </label>
        `;
        bidGrid.appendChild(tickerItem);
    });
    // Add event listeners for checkboxes
    const checkboxes = bidGrid.querySelectorAll('.bid-ticker-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', updateBidTickerSelection);
    });
}

/**
 * Update currency labels for BID-MODE
 */
function updateBidModeCurrencyLabels() {
    // Get all currency labels
    const currencyLabels = document.querySelectorAll('.currency-label');
    currencyLabels.forEach(label => {
        label.textContent = 'ETH';
    });
    
    // Update currency symbol in inputs
    const currencySymbols = document.querySelectorAll('.currency-symbol');
    currencySymbols.forEach(symbol => {
        symbol.textContent = 'ETH';
    });
}

/**
 * Hide VIRTUAL options in BID-MODE
 */
function hideBidModeVirtualOptions() {
    const virtualOptions = document.querySelectorAll('.virtual-only');
    virtualOptions.forEach(option => {
        option.style.display = 'none';
    });
}

/**
 * Show VIRTUAL options when BID-MODE is off
 */
function showBidModeVirtualOptions() {
    const virtualOptions = document.querySelectorAll('.virtual-only');
    virtualOptions.forEach(option => {
        option.style.display = 'block';
    });
}

/**
 * Toggle BID-MODE on/off
 * When active, only shows BID-MODE compatible bots and automatically adds BID-MODE to commands
 */
function toggleBidMode() {
    isBidModeActive = !isBidModeActive;
    
    const bidModeBtn = document.getElementById('bid-mode-toggle');
    const bidModeStatus = document.getElementById('bid-mode-status');
    const bidModeInfo = document.getElementById('bid-mode-info');
    const sidebar = document.querySelector('.sidebar');
    
    // Token selection panels
    const normalTickerPanel = document.getElementById('normal-ticker-selection');
    const bidTickerPanel = document.getElementById('bid-ticker-selection');
    
    if (bidModeBtn) {
        if (isBidModeActive) {
            // Activate BID-MODE
            bidModeBtn.classList.add('active');
            if (bidModeStatus) bidModeStatus.textContent = 'ON';
            if (bidModeInfo) bidModeInfo.style.display = 'block';
            if (sidebar) sidebar.classList.add('bid-mode-active');
            
            // Switch token selection panels
            if (normalTickerPanel) normalTickerPanel.style.display = 'none';
            if (bidTickerPanel) bidTickerPanel.style.display = 'block';
            
            // Load BID tokens from bid.json
            loadBidTokenDatabase();
            
            addConsoleMessage('🎯 BID-MODE ACTIVATED: ETH Trading Mode', 'info');
            addConsoleMessage('🔹 Only BuyBot, SellBot, FSH, and FarmBot are available', 'info');
            addConsoleMessage('🔹 All commands will automatically use ETH currency and bid.json database', 'info');
            addConsoleMessage('🔹 3% tax applies to sells in BID-MODE', 'warning');
            
            // Update currency labels to show ETH and hide VIRTUAL options
            updateBidModeCurrencyLabels();
            hideBidModeVirtualOptions();
            
        } else {
            // Deactivate BID-MODE
            bidModeBtn.classList.remove('active');
            if (bidModeStatus) bidModeStatus.textContent = 'OFF';
            if (bidModeInfo) bidModeInfo.style.display = 'none';
            if (sidebar) sidebar.classList.remove('bid-mode-active');
            
            // Switch token selection panels
            if (normalTickerPanel) normalTickerPanel.style.display = 'block';
            if (bidTickerPanel) bidTickerPanel.style.display = 'none';
            
            // Reset to normal mode default selection (TRUST)
            clearAllTickers(); // Clear any BID-MODE selections
            const trustCheckbox = document.getElementById('ticker-trust');
            if (trustCheckbox) {
                trustCheckbox.checked = true;
                selectedTickers = [{
                    address: trustCheckbox.dataset.address,
                    symbol: 'TRUST'
                }];
                updateTickerSelection();
            }
            
            addConsoleMessage('⭕ BID-MODE DEACTIVATED: Normal Trading Mode', 'info');
            addConsoleMessage('🔹 All bots are now available', 'info');
            addConsoleMessage('🔹 Commands will use VIRTUAL currency and base.json database', 'info');
            addConsoleMessage('🔹 Token selection reset to TRUST (default)', 'info');
            
            // Reset currency labels to show VIRTUAL and show VIRTUAL options
            updateCurrencyLabels();
            showBidModeVirtualOptions();
        }
    }
}

/**
 * Update BID ticker selection
 */
function updateBidTickerSelection() {
    // If the new BID token selection UI is available, use it to update
    if (window.BidTokenSelectionUI && typeof window.BidTokenSelectionUI.getSelectedTokens === 'function') {
        const selectedBidTokens = window.BidTokenSelectionUI.getSelectedTokens();
        
        // Update the global selectedTickers array for BID-MODE
        selectedTickers = [...selectedBidTokens];
        
        // Update token count display if it exists
        const count = selectedBidTokens.length;
        const countElement = document.getElementById('selected-bid-ticker-count');
        
        if (countElement) {
            countElement.textContent = `${count} token${count !== 1 ? 's' : ''} selected (BID-MODE)`;
        }
        
        return;
    }
    
    // Fallback to legacy implementation
    const checkboxes = document.querySelectorAll('.bid-ticker-checkbox:checked');
    const count = checkboxes.length;
    const countElement = document.getElementById('selected-bid-ticker-count');
    
    if (countElement) {
        countElement.textContent = `${count} token${count !== 1 ? 's' : ''} selected (BID-MODE)`;
    }
    
    // Update selectedTickers for BID-MODE
    selectedTickers = [];
    checkboxes.forEach(checkbox => {
        const symbolElement = checkbox.nextElementSibling.querySelector('.ticker-symbol');
        const symbol = symbolElement ? symbolElement.textContent : 'UNKNOWN';
        selectedTickers.push({
            symbol: symbol,
            address: checkbox.dataset.address
        });
    });
}

/**
 * Select all BID tickers
 */
function selectAllBidTickers() {
    const checkboxes = document.querySelectorAll('.bid-ticker-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = true;
    });
    updateBidTickerSelection();
}

// Clear all BID tickers
function clearAllBidTickers() {
    const checkboxes = document.querySelectorAll('.bid-ticker-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    updateBidTickerSelection();
}

// BID-MODE search logic (mirrors normal mode)
function handleBidTokenSearch() {
    const input = document.getElementById('bid-token-field-input');
    if (!input) return;
    const query = input.value.trim();
    if (bidSearchTimeout) clearTimeout(bidSearchTimeout);
    if (!query) {
        hideBidSearchResults();
        // Clear all grid selections
        clearAllBidTickers();
        return;
    }
    bidSearchTimeout = setTimeout(() => {
        // Try to find token by symbol or address
        const normalizedSymbol = query.toUpperCase();
        const normalizedAddress = query.toLowerCase();
        let foundToken = bidTokenDatabase.find(token =>
            (token.symbol && token.symbol.toUpperCase() === normalizedSymbol) ||
            (token.address && token.address.toLowerCase() === normalizedAddress)
        );
        if (foundToken) {
            // Auto-select in grid
            const checkbox = document.getElementById(`bid-ticker-${foundToken.symbol.toLowerCase()}`);
            if (checkbox) {
                checkbox.checked = true;
                updateBidTickerSelection();
            }
            showBidSearchStatus(`✅ Found: ${foundToken.symbol}`, 'verified');
        } else {
            // Not found, clear selection and show error
            clearAllBidTickers();
            showBidSearchStatus(`Token ${query} not found in bid.json`, 'error');
        }
        // Also show dropdown results for partial matches
        performBidTokenSearch(query);
    }, 300);
}

function selectBidSearchResult(token) {
    const input = document.getElementById('bid-token-field-input');
    if (input) {
        input.value = token.symbol;
    }
    const resultsDiv = document.getElementById('bid-search-results');
    if (resultsDiv) {
        resultsDiv.style.display = 'none';
    }
    // Auto-select the token in the grid
    const checkbox = document.getElementById(`bid-ticker-${token.symbol.toLowerCase()}`);
    if (checkbox) {
        checkbox.checked = true;
        updateBidTickerSelection();
    }
    showBidSearchStatus(`✅ Selected: ${token.symbol}`, 'verified');
}

// --- BID-MODE Search Box Redo ---
// State for last found token
let lastBidSearchResult = null;

// Attach event listeners for new Search and Add buttons
function setupBidSearchBox() {
    const searchBtn = document.getElementById('bid-search-btn');
    const addBtn = document.getElementById('bid-add-btn');
    const input = document.getElementById('bid-token-field-input');
    if (!searchBtn || !addBtn || !input) return;
    addBtn.disabled = true;
    lastBidSearchResult = null;
    searchBtn.onclick = () => {
        const query = input.value.trim().toUpperCase();
        if (!query) {
            showBidSearchStatus('Please enter a ticker symbol', 'warning');
            addBtn.disabled = true;
            lastBidSearchResult = null;
            return;
        }
        // Search for exact symbol match in bidTokenDatabase
        const found = bidTokenDatabase.find(token => token.symbol.toUpperCase() === query);
        if (found) {
            showBidSearchStatus(`✅ Found: ${found.symbol}`, 'verified');
            addBtn.disabled = false;
            lastBidSearchResult = found;
        } else {
            showBidSearchStatus(`Token ${query} not found in bid.json`, 'error');
            addBtn.disabled = true;
            lastBidSearchResult = null;
        }
    };
    addBtn.onclick = () => {
        if (!lastBidSearchResult) return;
        // Add to grid if not already present
        const checkbox = document.getElementById(`bid-ticker-${lastBidSearchResult.symbol.toLowerCase()}`);
        if (checkbox) {
            checkbox.checked = true;
            updateBidTickerSelection();
            showBidSearchStatus(`✅ Added: ${lastBidSearchResult.symbol}`, 'verified');
        } else {
            // If not in grid, add to grid and select
            bidTokenDatabase.push(lastBidSearchResult);
            renderBidTokenGrid();
            const newCheckbox = document.getElementById(`bid-ticker-${lastBidSearchResult.symbol.toLowerCase()}`);
            if (newCheckbox) {
                newCheckbox.checked = true;
                updateBidTickerSelection();
            }
            showBidSearchStatus(`✅ Added: ${lastBidSearchResult.symbol}`, 'verified');
        }
        addBtn.disabled = true;
        lastBidSearchResult = null;
    };
}

// Call setupBidSearchBox on DOMContentLoaded and after grid render
// ... existing code ...
document.addEventListener('DOMContentLoaded', () => {
    preloadBidTokenDatabase().then(() => {
        renderBidTokenGrid();
        updateBidTickerSelection();
        setupBidSearchBox();
    });
});
// ... existing code ...

// --- BID-MODE Add Button Logic ---
function handleBidAddToken() {
    const input = document.getElementById('bid-token-field-input');
    if (!input) return;
    const value = input.value.trim();
    if (!value) return;
    // Check if already in grid (by symbol or address)
    let exists = bidTokenDatabase.find(token =>
        (token.symbol && token.symbol.toUpperCase() === value.toUpperCase()) ||
        (token.address && token.address.toLowerCase() === value.toLowerCase())
    );
    if (!exists) {
        // Add to bidTokenDatabase and grid
        let tokenObj;
        if (value.startsWith('0x') && value.length === 42) {
            // It's an address, use as both symbol and address
            tokenObj = { symbol: value, address: value };
        } else {
            // It's a ticker, use as symbol only
            tokenObj = { symbol: value, address: '' };
        }
        bidTokenDatabase.push(tokenObj);
        addBidToken(tokenObj.symbol, tokenObj.address);
    }
    // Select in grid
    const checkbox = document.getElementById(`bid-ticker-${value.toLowerCase()}`);
    if (checkbox) {
        checkbox.checked = true;
        updateBidTickerSelection();
    }
    input.value = '';
}
// Attach event listeners for Add button and Enter key
function setupBidAddButton() {
    const addBtn = document.getElementById('bid-add-btn');
    const input = document.getElementById('bid-token-field-input');
    if (addBtn && input) {
        addBtn.onclick = handleBidAddToken;
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                handleBidAddToken();
            }
        });
    }
}
document.addEventListener('DOMContentLoaded', () => {
    setupBidAddButton();
});

/**
 * Toggle BID-MODE on/off
 * When active, only shows BID-MODE compatible bots and automatically adds BID-MODE to commands
 */
function toggleBidMode() {
    isBidModeActive = !isBidModeActive;
    
    const bidModeBtn = document.getElementById('bid-mode-toggle');
    const bidModeStatus = document.getElementById('bid-mode-status');
    const bidModeInfo = document.getElementById('bid-mode-info');
    const sidebar = document.querySelector('.sidebar');
    
    // Token selection panels
    const normalTickerPanel = document.getElementById('normal-ticker-selection');
    const bidTickerPanel = document.getElementById('bid-ticker-selection');
    
    if (bidModeBtn) {
        if (isBidModeActive) {
            // Activate BID-MODE
            bidModeBtn.classList.add('active');
            if (bidModeStatus) bidModeStatus.textContent = 'ON';
            if (bidModeInfo) bidModeInfo.style.display = 'block';
            if (sidebar) sidebar.classList.add('bid-mode-active');
            
            // Switch token selection panels
            if (normalTickerPanel) normalTickerPanel.style.display = 'none';
            if (bidTickerPanel) bidTickerPanel.style.display = 'block';
            
            // Load BID tokens from bid.json
            loadBidTokenDatabase();
            
            addConsoleMessage('🎯 BID-MODE ACTIVATED: ETH Trading Mode', 'info');
            addConsoleMessage('🔹 Only BuyBot, SellBot, FSH, and FarmBot are available', 'info');
            addConsoleMessage('🔹 All commands will automatically use ETH currency and bid.json database', 'info');
            addConsoleMessage('🔹 3% tax applies to sells in BID-MODE', 'warning');
            
            // Update currency labels to show ETH and hide VIRTUAL options
            updateBidModeCurrencyLabels();
            hideBidModeVirtualOptions();
            
        } else {
            // Deactivate BID-MODE
            bidModeBtn.classList.remove('active');
            if (bidModeStatus) bidModeStatus.textContent = 'OFF';
            if (bidModeInfo) bidModeInfo.style.display = 'none';
            if (sidebar) sidebar.classList.remove('bid-mode-active');
            
            // Switch token selection panels
            if (normalTickerPanel) normalTickerPanel.style.display = 'block';
            if (bidTickerPanel) bidTickerPanel.style.display = 'none';
            
            // Reset to normal mode default selection (TRUST)
            clearAllTickers(); // Clear any BID-MODE selections
            const trustCheckbox = document.getElementById('ticker-trust');
            if (trustCheckbox) {
                trustCheckbox.checked = true;
                selectedTickers = [{
                    address: trustCheckbox.dataset.address,
                    symbol: 'TRUST'
                }];
                updateTickerSelection();
            }
            
            addConsoleMessage('⭕ BID-MODE DEACTIVATED: Normal Trading Mode', 'info');
            addConsoleMessage('🔹 All bots are now available', 'info');
            addConsoleMessage('🔹 Commands will use VIRTUAL currency and base.json database', 'info');
            addConsoleMessage('🔹 Token selection reset to TRUST (default)', 'info');
            
            // Reset currency labels to show VIRTUAL and show VIRTUAL options
            updateCurrencyLabels();
            showBidModeVirtualOptions();
        }
    }
}

/**
 * Update currency labels when BID-MODE is active
 */
function updateBidModeCurrencyLabels() {
    const buyCurrencyLabel = document.getElementById('buy-currency-label');
    const sellCurrencyLabel = document.getElementById('sell-currency-label');
    
    if (isBidModeActive) {
        if (buyCurrencyLabel) {
            buyCurrencyLabel.textContent = 'Buy tokens With (BID-MODE: ETH):';
        }
        
        if (sellCurrencyLabel) {
            sellCurrencyLabel.textContent = 'Sell tokens For (BID-MODE: ETH):';
        }
        
        // Auto-select ETH checkboxes in BID-MODE
        const buyEthCheckbox = document.getElementById('buy-currency-eth');
        const buyVirtualCheckbox = document.getElementById('buy-currency-virtual');
        const sellEthCheckbox = document.getElementById('sell-currency-eth');
        const sellVirtualCheckbox = document.getElementById('sell-currency-virtual');
        
        if (buyEthCheckbox && buyVirtualCheckbox) {
            buyEthCheckbox.checked = true;
            buyVirtualCheckbox.checked = false;
        }
        
        if (sellEthCheckbox && sellVirtualCheckbox) {
            sellEthCheckbox.checked = true;
            sellVirtualCheckbox.checked = false;
        }
    } else {
        // Normal mode
        if (buyCurrencyLabel) {
            buyCurrencyLabel.textContent = 'Buy tokens With:';
        }
        
        if (sellCurrencyLabel) {
            sellCurrencyLabel.textContent = 'Sell tokens For:';
        }
        
        // Auto-select VIRTUAL checkboxes in normal mode
        const buyEthCheckbox = document.getElementById('buy-currency-eth');
        const buyVirtualCheckbox = document.getElementById('buy-currency-virtual');
        const sellEthCheckbox = document.getElementById('sell-currency-eth');
        const sellVirtualCheckbox = document.getElementById('sell-currency-virtual');
        
        if (buyEthCheckbox && buyVirtualCheckbox) {
            buyEthCheckbox.checked = false;
            buyVirtualCheckbox.checked = true;
        }
        
        if (sellEthCheckbox && sellVirtualCheckbox) {
            sellEthCheckbox.checked = false;
            sellVirtualCheckbox.checked = true;
        }
    }
}

/**
 * Hide VIRTUAL options in BID-MODE
 */
function hideBidModeVirtualOptions() {
    const buyVirtualCheckbox = document.getElementById('buy-currency-virtual');
    const sellVirtualCheckbox = document.getElementById('sell-currency-virtual');
    
    if (buyVirtualCheckbox) {
        buyVirtualCheckbox.parentElement.style.display = 'none';
    }
    
    if (sellVirtualCheckbox) {
        sellVirtualCheckbox.parentElement.style.display = 'none';
    }
}

/**
 * Show VIRTUAL options in normal mode
 */
function showBidModeVirtualOptions() {
    const buyVirtualCheckbox = document.getElementById('buy-currency-virtual');
    const sellVirtualCheckbox = document.getElementById('sell-currency-virtual');
    
    if (buyVirtualCheckbox) {
        buyVirtualCheckbox.parentElement.style.display = 'block';
    }
    
    if (sellVirtualCheckbox) {
        sellVirtualCheckbox.parentElement.style.display = 'block';
    }
}

/**
 * Load BID tokens from bid.json for BID-MODE Token Selection panel
 */
async function loadBidTokenDatabase() {
    // Use the new BID token selection UI module if available
    if (window.BidTokenSelectionUI && typeof window.BidTokenSelectionUI.init === 'function') {
        window.BidTokenSelectionUI.init();
        return;
    }
    
    // Fallback to legacy implementation if the new module isn't available
    try {
        const response = await fetch('./bid.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const bidData = await response.json();
        // Clear existing BID tokens
        const bidGrid = document.getElementById('bid-ticker-grid');
        if (bidGrid) {
            bidGrid.innerHTML = '';
        }
        // Add BID tokens to the grid
        bidData.forEach(token => {
            if (token.tokenAddress) {
                addBidToken(token.symbol, token.tokenAddress);
            }
        });
        // Auto-select DKING as default after a short delay
        setTimeout(() => {
            const dkingCheckbox = document.getElementById('bid-ticker-dking');
            if (dkingCheckbox) {
                dkingCheckbox.checked = true;
                // Manually add DKING to selectedTickers since it's checked by default in BID-MODE
                selectedTickers = [{
                    address: dkingCheckbox.dataset.address,
                    symbol: 'DKING'
                }];
                updateBidTickerSelection();
            }
        }, 100);
    } catch (error) {
        console.error('Error loading bid.json:', error);
        addConsoleMessage('❌ Error loading BID tokens from bid.json', 'error');
    }
}

/**
 * Add a BID token to the grid
 */
function addBidToken(symbol, address) {
    const bidGrid = document.getElementById('bid-ticker-grid');
    if (!bidGrid) return;
    const tickerItem = document.createElement('div');
    tickerItem.className = 'ticker-item';
    const checkboxId = `bid-ticker-${symbol.toLowerCase()}`;
    let shortAddress = 'N/A';
    if (address && address.length >= 10) {
        shortAddress = address.slice(0, 6) + '...' + address.slice(-4);
    }
    tickerItem.innerHTML = `
        <input type="checkbox" id="${checkboxId}" class="bid-ticker-checkbox" data-address="${address || ''}" onchange="updateBidTickerSelection()">
        <label for="${checkboxId}">
            <span class="ticker-symbol">${symbol}</span>
            <span class="ticker-address">${shortAddress}</span>
        </label>
    `;
    bidGrid.appendChild(tickerItem);
}

/**
 * Update BID ticker selection
 */
function updateBidTickerSelection() {
    const checkboxes = document.querySelectorAll('.bid-ticker-checkbox:checked');
    const count = checkboxes.length;
    const countElement = document.getElementById('selected-bid-ticker-count');
    
    if (countElement) {
        countElement.textContent = `${count} token${count !== 1 ? 's' : ''} selected (BID-MODE)`;
    }
    
    // Update selectedTickers for BID-MODE
    selectedTickers = [];
    checkboxes.forEach(checkbox => {
        const symbolElement = checkbox.nextElementSibling.querySelector('.ticker-symbol');
        const symbol = symbolElement ? symbolElement.textContent : 'UNKNOWN';
        selectedTickers.push({
            symbol: symbol,
            address: checkbox.dataset.address
        });
    });
}

/**
 * Select all BID tickers
 */
function selectAllBidTickers() {
    const checkboxes = document.querySelectorAll('.bid-ticker-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = true;
    });
    updateBidTickerSelection();
}

/**
 * Clear all BID tickers
 */
function clearAllBidTickers() {
    const checkboxes = document.querySelectorAll('.bid-ticker-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    updateBidTickerSelection();
}

/**
 * Handle BID token search
 */
function handleBidTokenSearch() {
    const input = document.getElementById('bid-token-field-input');
    const resultsDiv = document.getElementById('bid-search-results');
    
    if (!input || !resultsDiv) return;
    
    const query = input.value.trim();
    
    if (query.length < 2) {
        resultsDiv.style.display = 'none';
        return;
    }
    
    // Search in BID tokens
    performBidTokenSearch(query);
}

/**
 * Handle BID token search enter key
 */
function handleBidTokenSearchEnter(event) {
    if (event.key === 'Enter') {
        addBidTokenFromSearch();
    }
}

/**
 * Perform BID token search
 */
async function performBidTokenSearch(query) {
    try {
        const response = await fetch('./bid.json');
        const bidData = await response.json();
        
        const results = [];
        
        // Search by symbol
        Object.entries(bidData).forEach(([symbol, data]) => {
            if (symbol.toLowerCase().includes(query.toLowerCase()) && data.address) {
                results.push({
                    symbol: symbol,
                    address: data.address,
                    source: 'bid.json'
                });
            }
        });
        
        displayBidSearchResults(results, query);
        
    } catch (error) {
        console.error('Error searching bid.json:', error);
        showBidSearchStatus('Error searching BID tokens', 'error');
    }
}

/**
 * Display BID search results
 */
function displayBidSearchResults(results, query) {
    const resultsDiv = document.getElementById('bid-search-results');
    const statusDiv = document.getElementById('bid-search-status');
    
    if (!resultsDiv) return;
    
    if (results.length === 0) {
        resultsDiv.innerHTML = `<div class="no-results">No tokens matching "${query}" found</div>`;
        resultsDiv.style.display = 'block';
        return;
    }
    
    resultsDiv.innerHTML = '';
    resultsDiv.style.display = 'block';
    
    results.forEach(result => {
        const resultItem = document.createElement('div');
        resultItem.className = 'search-result-item';
        resultItem.innerHTML = `
            <span class="result-symbol">${result.symbol}</span>
            <span class="result-address">${result.address.slice(0, 6)}...${result.address.slice(-4)}</span>
        `;
        resultsDiv.appendChild(resultItem);
        
        // Add click event to select the token
        resultItem.addEventListener('click', () => {
            // Find and check the checkbox for this token
            const checkbox = document.getElementById(`bid-ticker-${result.symbol.toLowerCase()}`);
            if (checkbox) {
                checkbox.checked = true;
                updateBidTickerSelection();
                document.getElementById('bid-token-field-input').value = '';
                resultsDiv.style.display = 'none';
            }
        });
    });
}

/**
 * Show BID search status message
 */
function showBidSearchStatus(message, type = 'info') {
    const statusDiv = document.getElementById('bid-search-status');
    
    if (!statusDiv) return;
    
    statusDiv.textContent = message;
    statusDiv.className = `search-status ${type}`;
    statusDiv.style.display = 'block';
    
    // Hide after a delay
    setTimeout(() => {
        statusDiv.style.display = 'none';
    }, 3000);
}

/**
 * Add a BID token from search
 */
function addBidTokenFromSearch() {
    const input = document.getElementById('bid-token-field-input');
    const resultsDiv = document.getElementById('bid-search-results');
    
    if (!input || !resultsDiv) return;
    
    const query = input.value.trim();
    
    if (query.length < 2) {
        showBidSearchStatus('Please enter at least 2 characters', 'warning');
        return;
    }
    
    // Check if token exists in database
    const foundToken = bidTokenDatabase.find(token => 
        token.symbol.toLowerCase() === query.toLowerCase() || 
        token.address.toLowerCase() === query.toLowerCase()
    );
    
    if (foundToken) {
        // Add token to selection
        addBidToken(foundToken.symbol, foundToken.address);
        showBidSearchStatus(`Added ${foundToken.symbol} to selection`, 'success');
        
        // Clear the input field
        input.value = '';
        
        // Hide results
        resultsDiv.style.display = 'none';
    } else {
        showBidSearchStatus(`Token not found: ${query}`, 'error');
    }
}

/**
 * Add bid token button click handler
 */
function initBidAddButton() {
    const addBtn = document.getElementById('bid-add-btn');
    if (addBtn) {
        addBtn.addEventListener('click', addBidTokenFromSearch);
    }
}

// This will be handled by the main DOMContentLoaded listener below

// Make functions available globally
window.toggleBidMode = toggleBidMode;
window.updateBidTickerSelection = updateBidTickerSelection;
window.selectAllBidTickers = selectAllBidTickers;
window.clearAllBidTickers = clearAllBidTickers;
window.handleBidTokenSearch = handleBidTokenSearch;
window.handleBidTokenSearchEnter = handleBidTokenSearchEnter;
window.addBidTokenFromSearch = addBidTokenFromSearch;
window.hideBidSearchResults = hideBidSearchResults;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Initializing TRUSTBOT renderer...');
    
    // Initialize UI components
    initBidAddButton();
    console.log('✅ UI components initialized');
    
    // Set up IPC listeners for bot communication
    setupIPCListeners();
    console.log('✅ IPC listeners initialized');
    
    // Initialize transaction console enhancement
    enhanceTransactionMessages();
    console.log('✅ Transaction console enhancement initialized');
    
    console.log('🎉 TRUSTBOT renderer initialization complete');
});// ==================== JEETBOT BRIDGE FUNCTIONS ====================
// These functions bridge the JeetBot UI form to command line arguments
// matching the ivaavi branch parseCommandArguments logic


function getJeetBotArgs() {
    console.log('🔍 DEBUG: getJeetBotArgs() called - Function #2 (line 7530) simple version');

    try {
        // Get Genesis/ticker input from UI
        const genesisInput = document.getElementById('jeet-genesis')?.value?.trim();
        if (!genesisInput) {
            addConsoleMessage('❌ Please enter a Genesis Ticker or Contract Address', 'error');
            return null;
        }
        
        // Get selected wallets (convert Set to wallet selector format)
        if (selectedWallets.size === 0) {
            addConsoleMessage('❌ Please select at least one wallet', 'error');
            return null;
        }
        
        // Convert selectedWallets Set to wallet selector format (B1, B2, etc.)
        // selectedWallets contains indices (0, 1, 2, etc.), not wallet objects
        const walletSelectors = Array.from(selectedWallets)
            .map(index => `B${index + 1}`)
            .sort();
        
        // Build command line arguments array
        const args = [];
        
        // Add wallet selectors
        args.push(...walletSelectors);
        
        
        
        // Add Genesis/ticker input
        args.push(genesisInput);        
        // Add mode (default JEET)
                // Add mode - check for REBUY mode
                const basicModeEl = document.getElementById('jeet-mode-basic');
                const rebuyModeEl = document.getElementById('jeet-mode-rebuy-old');
        
                if (rebuyModeEl && rebuyModeEl.checked) {
                    // REBUY mode is selected
                    args.push('JEET');
                    args.push('REBUY');
                    
                    // Get REBUY percentage
                    const rebuyPercentageEl = document.getElementById('jeet-rebuy-percentage');
                    const selectedPercentage = document.querySelector('input[name="jeet-rebuy-percentage-option"]:checked');
                    let rebuyPercentage = '30%'; // Default
                    
                    if (selectedPercentage) {
                        if (selectedPercentage.value === 'custom' && rebuyPercentageEl) {
                            rebuyPercentage = rebuyPercentageEl.value.trim() || '30%';
                        } else {
                            rebuyPercentage = selectedPercentage.value;
                        }
                    }
                    args.push(rebuyPercentage);
                    
                    // Get REBUY interval
                    const selectedInterval = document.querySelector('input[name="jeet-rebuy-interval-option"]:checked');
                    let rebuyInterval = '2'; // Default 2 seconds
                    
                    if (selectedInterval) {
                        rebuyInterval = selectedInterval.value;
                    }
                    
                    // Convert seconds using formula: seconds * 0.016
                    let intervalValue = (parseFloat(rebuyInterval) * 0.016).toFixed(3);
                    args.push(`I-${intervalValue}`);
                    
                } else {
                    // Basic JEET mode only
                    args.push('JEET');
                }
        
        // Get delay if specified
        const delayInput = document.getElementById('jeet-delay')?.value?.trim();
        if (delayInput && parseInt(delayInput) > 0) {
            args.push(`D-${delayInput}`);
        }
        
        console.log('JeetBot args built:', args);
        return args;
        
    } catch (error) {
        console.error('Error building JeetBot args:', error);
        addConsoleMessage(`❌ Error building JeetBot arguments: ${error.message}`, 'error');
        return null;
    }
}

/**
 * Get JeetBot arguments for ticker (for single-ticker path)
 * Called from line 1269 in runBot function
 * Note: JeetBot doesn't actually use ticker parameter, so we ignore it
 */
function getJeetBotArgsForTicker(ticker) {
    // JeetBot doesn't use selectedTickers, it uses Genesis Contract from UI form
    // So we just call the main getJeetBotArgs function
    return getJeetBotArgs();
}

/**
 * Handle Genesis/ticker input change (UI validation)
 * Called from HTML onchange="handleJeetGenesisChange()"
 */
function handleJeetGenesisChange() {
    try {
        const genesisInput = document.getElementById('jeet-genesis');
        if (!genesisInput) return;
        
        const value = genesisInput.value.trim();
        
        // Basic validation - just check if something was entered
        if (value.length > 0) {
            // Remove any error styling
            genesisInput.style.borderColor = '';
            
            // Log the input type detection (similar to ivaavi branch logic)
            let inputType = 'UNKNOWN';
            if (value.toUpperCase().startsWith('TOKEN-0X')) {
                inputType = 'TOKEN_CA';
            } else if (value.toUpperCase().startsWith('GENESIS-0X')) {
                inputType = 'GENESIS';
            } else if (value.toUpperCase().startsWith('G-')) {
                inputType = 'GENESIS_TICKER';
            } else if (value.startsWith('0x') && value.length === 42) {
                inputType = 'GENESIS';
            } else {
                inputType = 'TICKER';
                // Automatically prefix with G- for genesis tickers
                genesisInput.value = `G-${value}`;
                console.log(`Automatically prefixed ticker with G-: ${genesisInput.value}`);
                inputType = 'GENESIS_TICKER'; // Update input type after modification
            }
            
            console.log(`JeetBot input detected: ${genesisInput.value} (Type: ${inputType})`);
        } else {
            // Add subtle error styling for empty input
            genesisInput.style.borderColor = '#ff6b6b';
        }
        
    } catch (error) {
        console.error('Error in handleJeetGenesisChange:', error);
    }
}

// ========== UPDATE DEBUGGING FUNCTIONS ==========
// These functions can be called from the browser console to test updates

// Function to manually trigger update check
window.testUpdateCheck = async function() {
    console.log('🔄 Testing manual update check...');
    try {
        const result = await ipcRenderer.invoke('check-for-updates');
        console.log('✅ Update check result:', result);
        return result;
    } catch (error) {
        console.error('❌ Update check failed:', error);
        return error;
    }
};

// Function to force update check (bypasses all restrictions)
window.forceUpdateCheck = async function() {
    console.log('🔄 Forcing update check (bypassing all restrictions)...');
    try {
        const result = await ipcRenderer.invoke('force-update-check');
        console.log('✅ Force update check result:', result);
        return result;
    } catch (error) {
        console.error('❌ Force update check failed:', error);
        return error;
    }
};

// Function to clear all update flags
window.clearUpdateFlags = async function() {
    console.log('🧽 Clearing all update flags...');
    try {
        const result = await ipcRenderer.invoke('clear-update-flags');
        console.log('✅ Clear flags result:', result);
        return result;
    } catch (error) {
        console.error('❌ Clear flags failed:', error);
        return error;
    }
};

// Function to get current update status
window.getUpdateStatus = async function() {
    console.log('📊 Getting current update status...');
    try {
        const result = await ipcRenderer.invoke('get-update-status');
        console.log('✅ Update status:', result);
        return result;
    } catch (error) {
        console.error('❌ Get update status failed:', error);
        return error;
    }
};

// Function to show update notification manually (for testing UI)
window.testUpdateNotification = function() {
    console.log('🔔 Testing update notification UI...');
    const mockUpdateInfo = {
        version: '1.0.6',
        releaseDate: new Date().toISOString(),
        releaseNotes: 'Test update notification'
    };
    updateNotificationManager.showUpdateNotification(null, mockUpdateInfo);
};

console.log('🔧 Update debugging functions loaded. Available commands:');
console.log('  - testUpdateCheck() - Test normal update check');
console.log('  - forceUpdateCheck() - Force update check (bypasses restrictions)');
console.log('  - clearUpdateFlags() - Clear all update flags');
console.log('  - getUpdateStatus() - Get current update status');
console.log('  - testUpdateNotification() - Test update notification UI');
