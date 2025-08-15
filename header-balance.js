// Header Balance Display Module
console.log('🔍 Header Balance Script: Loading...');

// Simple initialization without classes to avoid potential issues
let balanceUpdateInterval = null;
let isUpdating = false;
let currentWalletAddress = null;

// Initialize when DOM is ready
function initHeaderBalance() {
    console.log('🚀 Header Balance: DOM ready, initializing...');
    
    // Listen for wallet changes from main process
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('wallet-update', (event, data) => {
        console.log('🔄 Header Balance: Wallet update received:', data);
        handleWalletUpdate();
    });
    
    // Start real balance updates immediately
    setTimeout(() => {
        startRealBalanceUpdates();
    }, 1000);
}

// Handle wallet updates (new wallet added, wallet removed, etc.)
function handleWalletUpdate() {
    console.log('🔄 Header Balance: Handling wallet update...');
    
    // Clear current interval
    if (balanceUpdateInterval) {
        clearInterval(balanceUpdateInterval);
        balanceUpdateInterval = null;
    }
    
    // Reset state
    isUpdating = false;
    currentWalletAddress = null;
    
    // Restart balance updates with new wallet config
    setTimeout(() => {
        startRealBalanceUpdates();
    }, 500);
}

function updateBalanceDisplay(ethBalance, virtualBalance, walletName = null) {
    const ethElement = document.getElementById('eth-balance');
    const virtualElement = document.getElementById('virtual-balance');
    const walletNameElement = document.getElementById('wallet-name');
    
    if (ethElement) {
        ethElement.textContent = ethBalance;
        ethElement.className = 'balance-value';
    }
    
    if (virtualElement) {
        virtualElement.textContent = virtualBalance;
        virtualElement.className = 'balance-value';
    }
    
    if (walletNameElement && walletName) {
        walletNameElement.textContent = walletName;
    }
    
    console.log('📊 Header Balance: Updated UI - Wallet:', walletName, 'ETH:', ethBalance, 'VIRTUAL:', virtualBalance);
}

function showLoadingState() {
    const ethElement = document.getElementById('eth-balance');
    const virtualElement = document.getElementById('virtual-balance');
    
    if (ethElement) {
        ethElement.textContent = '...';
        ethElement.className = 'balance-value loading';
    }
    
    if (virtualElement) {
        virtualElement.textContent = '...';
        virtualElement.className = 'balance-value loading';
    }
}

function showErrorState() {
    const ethElement = document.getElementById('eth-balance');
    const virtualElement = document.getElementById('virtual-balance');
    
    if (ethElement) {
        ethElement.textContent = 'Error';
        ethElement.className = 'balance-value error';
    }
    
    if (virtualElement) {
        virtualElement.textContent = 'Error';
        virtualElement.className = 'balance-value error';
    }
}

function showNoWalletState() {
    const ethElement = document.getElementById('eth-balance');
    const virtualElement = document.getElementById('virtual-balance');
    const walletNameElement = document.getElementById('wallet-name');
    
    if (ethElement) {
        ethElement.textContent = '0.000';
        ethElement.className = 'balance-value';
    }
    
    if (virtualElement) {
        virtualElement.textContent = '0.000';
        virtualElement.className = 'balance-value';
    }
    
    if (walletNameElement) {
        walletNameElement.textContent = 'N/A';
    }
    
    console.log('📊 Header Balance: Showing no wallet state - N/A | ETH: 0.000 | VIRTUAL: 0.000');
}

async function startRealBalanceUpdates() {
    console.log('🔍 Header Balance: Starting real balance updates...');
    
    try {
        const { ipcRenderer } = require('electron');
        const { ethers } = require('ethers');
        
        // Get wallet config
        const config = await ipcRenderer.invoke('get-wallets-config');
        console.log(' Header Balance: Config received');
        
        if (!config || !config.wallets || config.wallets.length === 0) {
            console.log(' Header Balance: No wallets configured, showing default state');
            showNoWalletState();
            return;
        }
        
        const firstWallet = config.wallets[0];
        const walletAddress = firstWallet.address;
        const walletName = firstWallet.name || 'Wallet';
        
        if (!walletAddress) {
            console.warn(' Header Balance: No wallet address found');
            showNoWalletState();
            return;
        }
        
        console.log(' Header Balance: Using wallet:', walletName, 'at address:', walletAddress);
        
        // Initialize provider
        const rpcUrl = Buffer.from(config.config.rpcUrl, 'base64').toString('utf8');
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        
        // Initialize Virtual token contract
        const virtualContract = new ethers.Contract(
            config.config.virtualTokenAddress,
            [
                "function balanceOf(address owner) view returns (uint256)",
                "function decimals() view returns (uint8)"
            ],
            provider
        );
        
        // Function to update balances
        async function updateBalances() {
            if (isUpdating) return;
            isUpdating = true;
            
            try {
                showLoadingState();
                
                const [ethBalance, virtualBalance, decimals] = await Promise.all([
                    provider.getBalance(walletAddress),
                    virtualContract.balanceOf(walletAddress),
                    virtualContract.decimals()
                ]);
                
                const ethFormatted = parseFloat(ethers.formatEther(ethBalance)).toFixed(3);
                const virtualFormatted = parseFloat(ethers.formatUnits(virtualBalance, decimals)).toFixed(3);
                
                updateBalanceDisplay(ethFormatted, virtualFormatted, walletName);
                
            } catch (error) {
                console.error('❌ Header Balance: Error updating balances:', error);
                showErrorState();
            } finally {
                isUpdating = false;
            }
        }
        
        // Initial update
        await updateBalances();
        
        // Update every 30 seconds
        balanceUpdateInterval = setInterval(updateBalances, 30000);
        
        console.log('✅ Header Balance: Real updates started');
        
    } catch (error) {
        console.error('❌ Header Balance: Failed to start real updates:', error);
        showErrorState();
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHeaderBalance);
} else {
    initHeaderBalance();
}
