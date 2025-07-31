import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration from wallets.json database
const WALLETS_DB_PATH = 'wallets.json';

function loadWalletsDB() {
  try {
    if (!fs.existsSync(WALLETS_DB_PATH)) {
      throw new Error(`❌ Wallet database not found: ${WALLETS_DB_PATH}`);
    }
    
    const data = fs.readFileSync(WALLETS_DB_PATH, 'utf8');
    const db = JSON.parse(data);
    
    if (!db.config) {
      throw new Error('❌ Invalid wallet database structure: missing config section');
    }
    
    return db;
  } catch (error) {
    console.error(`❌ Error loading wallet database: ${error.message}`);
    throw error;
  }
}

async function checkBalances() {
    try {
        // Load configuration from wallets.json
        const walletsDB = loadWalletsDB();
        const config = walletsDB.config;

        // Check if configuration is valid
        if (!config.rpcUrl) {
            console.log(JSON.stringify({
                status: 'error',
                message: 'RPC_URL not configured in wallets.json.'
            }));
            return;
        }

        if (!config.virtualTokenAddress) {
            console.log(JSON.stringify({
                status: 'error',
                message: 'virtualTokenAddress not configured in wallets.json.'
            }));
            return;
        }

        // Create provider
        const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
        
        // VIRTUAL token contract
        const virtualContract = new ethers.Contract(
            config.virtualTokenAddress,
            [
                "function balanceOf(address owner) view returns (uint256)",
                "function decimals() view returns (uint8)",
                "function symbol() view returns (string)"
            ],
            provider
        );

        const wallets = [];
        
        // Check wallets from wallets.json
        if (walletsDB.wallets && Array.isArray(walletsDB.wallets)) {
            for (const walletInfo of walletsDB.wallets) {
                if (walletInfo.privateKey && walletInfo.enabled !== false) {
                    try {
                        const wallet = new ethers.Wallet(walletInfo.privateKey, provider);
                        const ethBalance = await provider.getBalance(wallet.address);
                        const virtualBalance = await virtualContract.balanceOf(wallet.address);
                        const decimals = await virtualContract.decimals();
                        
                        wallets.push({
                            wallet: wallet.address,
                            name: walletInfo.name || `Wallet ${walletInfo.id}`,
                                    ethBalance: ethers.formatEther(ethBalance),
        virtualBalance: ethers.formatUnits(virtualBalance, decimals)
                        });
                    } catch (error) {
                        wallets.push({
                            wallet: walletInfo.name || `Wallet ${walletInfo.id}`,
                            error: 'Invalid private key or network error'
                        });
                    }
                }
            }
        }

        console.log(JSON.stringify({
            status: 'success',
            wallets: wallets
        }));

    } catch (error) {
        console.log(JSON.stringify({
            status: 'error',
            message: error.message
        }));
    }
}

checkBalances(); 