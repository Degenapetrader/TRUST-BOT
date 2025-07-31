import { ethers } from 'ethers';
import { ConfigLoader } from './src/config/loader.js';
import { ProviderManager } from './src/providers/manager.js';
import { executeRpcWithFallback } from './src/providers/transactionExecutor.js';

/**
 * Optimized Balance Checker
 * Uses multi-provider setup for better reliability
 */
class BalanceChecker {
  constructor() {
    this.configLoader = new ConfigLoader();
    this.providerManager = new ProviderManager();
    this.providerManager.initialize();
  }

  async checkBalances() {
    try {
      // Load configuration
      const db = this.configLoader.getDatabase();
      const config = this.configLoader.getConfig();
      
      // Validate configuration
      if (!config.virtualTokenAddress) {
        return {
          status: 'error',
          message: 'virtualTokenAddress not configured in wallets.json.'
        };
      }

      // VIRTUAL token contract setup
      const virtualABI = [
        "function balanceOf(address owner) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function symbol() view returns (string)"
      ];

      const wallets = [];
      
      // Check wallets from database
      if (db.wallets && Array.isArray(db.wallets)) {
        // Process wallets in parallel for faster execution
        const walletPromises = db.wallets
          .filter(walletInfo => walletInfo.privateKey && walletInfo.enabled !== false)
          .map(async (walletInfo) => {
            try {
              // Create wallet instance
              const wallet = new ethers.Wallet(walletInfo.privateKey);
              
              // Get balances using RPC fallback for reliability
              const [ethBalance, virtualBalance, decimals] = await Promise.all([
                // ETH balance
                executeRpcWithFallback(async (provider) => {
                  return await provider.getBalance(wallet.address);
                }),
                // VIRTUAL token balance
                executeRpcWithFallback(async (provider) => {
                  const virtualContract = new ethers.Contract(
                    config.virtualTokenAddress,
                    virtualABI,
                    provider
                  );
                  return await virtualContract.balanceOf(wallet.address);
                }),
                // Token decimals (cached after first call)
                executeRpcWithFallback(async (provider) => {
                  const virtualContract = new ethers.Contract(
                    config.virtualTokenAddress,
                    virtualABI,
                    provider
                  );
                  return await virtualContract.decimals();
                })
              ]);
              
              return {
                wallet: wallet.address,
                name: walletInfo.name || `Wallet ${walletInfo.id}`,
                ethBalance: ethers.formatEther(ethBalance),
                virtualBalance: ethers.formatUnits(virtualBalance, decimals)
              };
            } catch (error) {
              return {
                wallet: walletInfo.name || `Wallet ${walletInfo.id}`,
                error: error.message
              };
            }
          });
        
        // Wait for all balance checks to complete
        const results = await Promise.all(walletPromises);
        wallets.push(...results);
      }

      return {
        status: 'success',
        wallets: wallets,
        provider: this.providerManager.getPrimaryProvider()._providerName || 'Unknown'
      };

    } catch (error) {
      return {
        status: 'error',
        message: error.message
      };
    }
  }

  // Cleanup method
  async cleanup() {
    await this.providerManager.cleanup();
  }
}

// Main execution
async function main() {
  const checker = new BalanceChecker();
  
  try {
    const result = await checker.checkBalances();
    console.log(JSON.stringify(result));
  } finally {
    await checker.cleanup();
  }
}

// Run if executed directly
if (process.argv[1].endsWith('balance-checker-optimized.mjs')) {
  main().catch(error => {
    console.log(JSON.stringify({
      status: 'error',
      message: error.message
    }));
    process.exit(1);
  });
}

export { BalanceChecker }; 