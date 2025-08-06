import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { ERC20_ABI, executeTransactionWithReplacementFee, getRandomProvider } from './config.js';
import { tradingWallets, walletsReady, getWalletBySelector, getWalletByAddress } from './wallets/index.js';

// Constants
const CONTACTS_DB_FILE = 'Contacts.json';

// Token resolution will be handled dynamically via baseDatabase.js

// Enhanced token resolution - check sender wallet first, then databases
async function resolveTokenInfo(tokenInput, senderIdentifier = 'B1') {
  console.log(`🔍 Resolving token: ${tokenInput} for sender: ${senderIdentifier}`);
  
  // Handle ETH specially (native token)
  if (tokenInput.toUpperCase() === 'ETH') {
    return {
      success: true,
      symbol: 'ETH',
      address: null, // null for native ETH
      decimals: 18,
      name: 'Ethereum'
    };
  }
  
  // Check if input is a contract address (0x... with 40 hex chars)
  if (tokenInput.startsWith('0x') && tokenInput.length === 42) {
    console.log(`📍 Detected contract address, resolving directly via RPC...`);
    return await resolveTokenFromCA(tokenInput);
  }
  
  // For ticker symbols, first check sender wallet for the token
  console.log(`👛 Step 1: Checking sender wallet ${senderIdentifier} for token: ${tokenInput}`);
  const walletResult = await checkSenderWalletForToken(tokenInput, senderIdentifier);
  
  if (walletResult.success) {
    console.log(`✅ Token found in sender wallet: ${walletResult.symbol} (${walletResult.address})`);
    return walletResult;
  }
  
  console.log(`⚠️ Token not found in sender wallet, checking databases...`);
  
  // Step 2: Check base.json and bid.json databases
  console.log(`📚 Step 2: Checking base.json and bid.json databases...`);
  const databaseResult = await checkDatabasesForToken(tokenInput);
  
  if (databaseResult.success) {
    console.log(`✅ Token resolved via ${databaseResult.source}: ${databaseResult.symbol} (${databaseResult.address})`);
    return databaseResult;
  }
  
  console.log(`❌ Token not found in any source: ${tokenInput}`);
  return {
    success: false,
    error: `Token "${tokenInput}" not found. Checked: sender wallet ${senderIdentifier}, base.json, bid.json databases.`
  };
}

// Check sender wallet for token by scanning wallet balances
async function checkSenderWalletForToken(tokenSymbol, senderIdentifier) {
  try {
    console.log(`   🔍 Scanning wallet ${senderIdentifier} for token: ${tokenSymbol}`);
    const privateKey = getPrivateKey(senderIdentifier);
    const provider = getRandomProvider();
    const wallet = new ethers.Wallet(privateKey, provider);

    // --- Alchemy-based token detection ---
    try {
      // Dynamically import Alchemy SDK and config
      const { Alchemy, Network } = await import('alchemy-sdk');
      const { getAlchemyConfig } = await import('./config.js');
      const alchemyConfig = getAlchemyConfig();
      if (alchemyConfig && alchemyConfig.apiKey) {
        const alchemy = new Alchemy({
          apiKey: alchemyConfig.apiKey,
          network: Network.BASE_MAINNET,
        });
        // Get all token balances
        const balances = await alchemy.core.getTokenBalances(wallet.address);
        // Find token by ticker symbol (case-insensitive)
        for (const token of balances.tokenBalances) {
          if (!token.contractAddress || token.tokenBalance === '0x' || token.tokenBalance === '0') continue;
          const metadata = await alchemy.core.getTokenMetadata(token.contractAddress);
          if (metadata && metadata.symbol && metadata.symbol.toUpperCase() === tokenSymbol.toUpperCase()) {
            const decimals = metadata.decimals || 18;
            return {
              success: true,
              symbol: metadata.symbol,
              address: token.contractAddress,
              decimals: decimals,
              name: metadata.name || metadata.symbol
            };
          }
        }
      }
    } catch (alchemyError) {
      console.log(`   ⚠️ Alchemy token scan failed: ${alchemyError.message}`);
    }
    // --- End Alchemy-based detection ---

    // Fallback: not found
    console.log(`   ⚠️ Token ${tokenSymbol} not found in wallet ${senderIdentifier}`);
    return {
      success: false,
      error: `Token ${tokenSymbol} not found in wallet ${senderIdentifier}`
    };
  } catch (error) {
    console.log(`   ❌ Error scanning wallet ${senderIdentifier}: ${error.message}`);
    return {
      success: false,
      error: `Error scanning wallet: ${error.message}`
    };
  }
}

// Check base.json and bid.json databases for token
async function checkDatabasesForToken(tokenInput) {
  try {
    // First try base.json database
    console.log(`   📖 Checking base.json database...`);
    try {
      const { resolveToken } = await import('./baseDatabase.js');
      const baseResult = await resolveToken(tokenInput);
      
      if (baseResult.success) {
        // Get decimals from contract
        let decimals = 18; // Default
        if (baseResult.address) {
          try {
            const provider = getRandomProvider();
            const tokenContract = new ethers.Contract(
              baseResult.address,
              ['function decimals() view returns (uint8)'],
              provider
            );
            decimals = await tokenContract.decimals();
          } catch (error) {
            console.log(`   ⚠️ Could not get decimals for ${baseResult.symbol}, using default 18`);
          }
        }
        
        return {
          success: true,
          symbol: baseResult.symbol,
          address: baseResult.address,
          decimals: decimals,
          name: baseResult.name,
          source: baseResult.source
        };
      }
    } catch (error) {
      console.log(`   ⚠️ Error checking base.json: ${error.message}`);
    }
    
    // Then try bid.json database
    console.log(`   📖 Checking bid.json database...`);
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      const bidJsonPath = 'bid.json';
      if (fs.existsSync(bidJsonPath)) {
        const bidData = JSON.parse(fs.readFileSync(bidJsonPath, 'utf8'));
        
        // Check if token exists in bid.json
        const tokenData = bidData[tokenInput.toUpperCase()];
        if (tokenData && tokenData.address) {
          // Get decimals from contract
          let decimals = 18; // Default
          try {
            const provider = getRandomProvider();
            const tokenContract = new ethers.Contract(
              tokenData.address,
              ['function decimals() view returns (uint8)'],
              provider
            );
            decimals = await tokenContract.decimals();
          } catch (error) {
            console.log(`   ⚠️ Could not get decimals for ${tokenInput}, using default 18`);
          }
          
          return {
            success: true,
            symbol: tokenInput.toUpperCase(),
            address: tokenData.address,
            decimals: decimals,
            name: tokenData.name || tokenInput.toUpperCase(),
            source: 'bid.json'
          };
        }
      }
    } catch (error) {
      console.log(`   ⚠️ Error checking bid.json: ${error.message}`);
    }
    
    return {
      success: false,
      error: `Token ${tokenInput} not found in base.json or bid.json databases`
    };
    
  } catch (error) {
    console.log(`   ❌ Error checking databases: ${error.message}`);
    return {
      success: false,
      error: `Database check failed: ${error.message}`
    };
  }
}

// Resolve token directly from contract address
async function resolveTokenFromCA(contractAddress) {
  try {
    console.log(`📋 Fetching token info from contract: ${contractAddress}`);
    
    const providers = [getRandomProvider(), getRandomProvider(), getRandomProvider()];
    let lastError = null;
    
    for (let i = 0; i < providers.length; i++) {
      try {
        const provider = providers[i];
        const tokenContract = new ethers.Contract(
          contractAddress,
          [
            'function symbol() view returns (string)',
            'function name() view returns (string)',
            'function decimals() view returns (uint8)'
          ],
          provider
        );
        
        console.log(`  🔗 Trying RPC provider ${i + 1}...`);
        
        // Get token metadata from contract
        const [symbol, name, decimals] = await Promise.all([
          tokenContract.symbol(),
          tokenContract.name(),
          tokenContract.decimals()
        ]);
        
        console.log(`  ✅ Contract verified: ${symbol} (${name})`);
        
        return {
          success: true,
          symbol: symbol,
          address: contractAddress,
          decimals: decimals,
          name: name,
          source: 'RPC Contract'
        };
        
      } catch (error) {
        lastError = error;
        console.log(`  ❌ RPC provider ${i + 1} failed: ${error.message}`);
        continue;
      }
    }
    
    throw new Error(`All RPC providers failed. Last error: ${lastError.message}`);
    
  } catch (error) {
    console.log(`❌ Failed to resolve contract address ${contractAddress}: ${error.message}`);
    return {
      success: false,
      error: `Invalid or unreadable token contract: ${contractAddress}`
    };
  }
}

// Resolve token from RPC by checking sender wallets for token metadata
async function resolveTokenFromRPC(tickerSymbol) {
  try {
    console.log(`🔍 Attempting RPC-based token resolution for ticker: ${tickerSymbol}`);
    
    // Use the same ticker search fallback system as other bots
    const { runTickerSearchFallback } = await import('./utils.js');
    
    console.log(`  🎯 Running ticker search fallback for ${tickerSymbol}...`);
    const fallbackResult = await runTickerSearchFallback(tickerSymbol);
    
    if (fallbackResult.success) {
      console.log(`✅ Ticker search successful: ${fallbackResult.symbol} (${fallbackResult.address})`);
      
      // Get additional token metadata from contract
      try {
        const provider = getRandomProvider();
        const tokenContract = new ethers.Contract(
          fallbackResult.address,
          [
            'function symbol() view returns (string)',
            'function name() view returns (string)', 
            'function decimals() view returns (uint8)'
          ],
          provider
        );
        
        const [symbol, name, decimals] = await Promise.all([
          tokenContract.symbol().catch(() => fallbackResult.symbol),
          tokenContract.name().catch(() => fallbackResult.name || fallbackResult.symbol),
          tokenContract.decimals().catch(() => 18)
        ]);
        
        return {
          success: true,
          symbol: symbol,
          address: fallbackResult.address,
          decimals: decimals,
          name: name,
          source: 'RPC Ticker Search'
        };
        
      } catch (error) {
        console.log(`⚠️ Could not get contract metadata, using fallback data`);
        return {
          success: true,
          symbol: fallbackResult.symbol,
          address: fallbackResult.address,
          decimals: 18, // Default
          name: fallbackResult.name || fallbackResult.symbol,
          source: 'RPC Ticker Search (Fallback)'
        };
      }
    } else {
      console.log(`⚠️ Ticker search fallback failed: ${fallbackResult.error}`);
      return {
        success: false,
        error: `Unable to resolve ${tickerSymbol} via RPC ticker search: ${fallbackResult.error}`
      };
    }
    
  } catch (error) {
    console.log(`❌ RPC token resolution error: ${error.message}`);
    return {
      success: false,
      error: `RPC resolution failed: ${error.message}`
    };
  }
}

// Load contacts database
function loadContacts() {
  try {
    if (fs.existsSync(CONTACTS_DB_FILE)) {
      const data = fs.readFileSync(CONTACTS_DB_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.log(`⚠️ Error loading contacts database: ${error.message}`);
  }
  
  return {
    lastUpdated: null,
    contacts: {}
  };
}

// Save contacts database
function saveContacts(contacts) {
  try {
    contacts.lastUpdated = new Date().toISOString();
    fs.writeFileSync(CONTACTS_DB_FILE, JSON.stringify(contacts, null, 2));
    console.log(`💾 Contacts database saved with ${Object.keys(contacts.contacts).length} contacts`);
    return true;
  } catch (error) {
    console.log(`❌ Error saving contacts database: ${error.message}`);
    return false;
  }
}

// Add contact to database
function addContact(label, address) {
  const contacts = loadContacts();
  
  // Validate address
  if (!ethers.isAddress(address)) {
    throw new Error(`Invalid address: ${address}`);
  }
  
  // Store address in checksummed format
      const checksummedAddress = ethers.getAddress(address);
  
  contacts.contacts[label.toLowerCase()] = {
    label,
    address: checksummedAddress,
    addedAt: new Date().toISOString()
  };
  
  saveContacts(contacts);
  console.log(`✅ Contact added: ${label} -> ${checksummedAddress}`);
  return true;
}

// Get contact address by label
function getContactAddress(label) {
  const contacts = loadContacts();
  const contact = contacts.contacts[label.toLowerCase()];
  if (contact && contact.address) {
    // Ensure address is properly checksummed
    try {
      return ethers.getAddress(contact.address);
    } catch (error) {
      console.log(`⚠️ Invalid address format for contact ${label}: ${contact.address}`);
      return null;
    }
  }
  return null;
}

// List all contacts
function listContacts() {
  const contacts = loadContacts();
  console.log('\n📋 Contacts Database:');
  console.log('====================');
  
  if (Object.keys(contacts.contacts).length === 0) {
    console.log('No contacts found.');
    return;
  }
  
  Object.values(contacts.contacts).forEach(contact => {
    console.log(`${contact.label}: ${contact.address}`);
  });
  console.log('====================\n');
}

// Function to decode private key to public address
function getAddressFromPrivateKey(privateKey) {
  try {
    if (!privateKey || !privateKey.startsWith('0x') || privateKey.length !== 66) {
      return null;
    }
    const wallet = new ethers.Wallet(privateKey);
    return wallet.address;
  } catch (error) {
    return null;
  }
}

// Function to get address from wallet identifier (B1, B2, etc.) or direct address
async function resolveAddress(identifier) {
  // Check if input is already an Ethereum address
  if (identifier.startsWith('0x') && identifier.length === 42) {
    return identifier;
  }
  
  // Check if this is a wallet identifier (e.g., B1, B2)
  if (isWalletIdentifier(identifier)) {
    // First try to get the wallet from the global wallet system
    const wallet = getWalletBySelector(identifier);
    if (wallet && wallet.address) {
      return wallet.address;
    }
    
    // Legacy fallback: Get the private key and derive the address
    const privateKey = getPrivateKey(identifier);
    if (privateKey) {
      return getAddressFromPrivateKey(privateKey);
    } else {
      throw new Error(`Could not find wallet: ${identifier}`);
    }
  }
  
  // Check if this is a contact label
  const contactAddress = await getContactAddress(identifier);
  if (contactAddress) {
    return contactAddress;
  }
  
  // If we couldn't resolve the address, return null
  return null;
}

// Function to check if input is a wallet identifier (B1, B2, etc.)
function isWalletIdentifier(input) {
  if (!input || typeof input !== 'string') {
    return false;
  }
  
  // Match patterns like B1, B2, B3, etc.
  const walletPattern = /^B\d+$/i;
  return walletPattern.test(input);
}

// Function to get private key from wallet identifier using global wallet system
function getPrivateKey(identifier) {
  // First try to get the wallet from the global wallet system
  const wallet = getWalletBySelector(identifier);
  if (wallet && wallet.privateKey) {
    return wallet.privateKey;
  }
  
  // Legacy method - direct B1, B2 access
  if (identifier.startsWith('B')) {
    const numPart = identifier.substring(1); // Extract the number part
    const index = parseInt(numPart, 10) - 1; // Convert to zero-based index
    
    // Check if index is valid and tradingWallets is available
    if (isNaN(index) || index < 0 || !tradingWallets || index >= tradingWallets.length) {
      console.error(`Invalid wallet identifier or wallet not found: ${identifier}`);
      return null;
    }
    
    // Get wallet from tradingWallets array
    const walletFromArray = tradingWallets[index];
    if (walletFromArray && walletFromArray.privateKey) {
      return walletFromArray.privateKey;
    }
  }
  
  return null;
}

// Get all wallet addresses except the specified one
async function getAllWalletAddresses(except = null) {
  const addresses = [];
  
  // Wait for wallets to be initialized
  await walletsReady;
  
  // Resolve except address if provided
  const exceptAddress = except ? await resolveAddress(except) : null;
  
  // Use the global tradingWallets array
  for (let i = 0; i < tradingWallets.length; i++) {
    const wallet = tradingWallets[i];
    if (!wallet || !wallet.address) continue;
    
    const walletId = wallet.name || `B${i + 1}`;
    
    // Skip the specified wallet
    if (wallet.address !== except) {
      addresses.push({
        id: walletId,
        address: wallet.address
      });
    }
  }
  
  return addresses;
}

// Get all wallet identifiers (B1, B2, etc.)
function getAllWalletIdentifiers() {
  const identifiers = [];
  
  // Use the global tradingWallets array
  for (let i = 0; i < tradingWallets.length; i++) {
    const wallet = tradingWallets[i];
    if (!wallet) continue;
    
    const walletId = wallet.name || `B${i + 1}`;
    identifiers.push(walletId);
  }
  
  return identifiers;
}

// ... (rest of the code remains the same)
// Get token balance for a wallet
async function getTokenBalance(walletIdentifier, token) {
  try {
    const privateKey = getPrivateKey(walletIdentifier);
    const provider = getRandomProvider();
    const wallet = new ethers.Wallet(privateKey, provider);
    
    if (token.symbol === 'ETH') {
      const balance = await wallet.getBalance();
      return formatAmount(balance, 18);
    } else {
      const contract = new ethers.Contract(token.address, ERC20_ABI, wallet);
      const balance = await contract.balanceOf(wallet.address);
      return formatAmount(balance, token.decimals);
    }
  } catch (error) {
    console.log(`⚠️ Error getting balance for ${walletIdentifier}: ${error.message}`);
    return '0';
  }
}

// Calculate actual amount from percentage and wallet balance
async function calculateActualAmount(walletIdentifier, token, amountInput) {
  if (!amountInput.includes('%')) {
    return amountInput; // Not a percentage, return as is
  }
  
  const percentage = parseFloat(amountInput.replace('%', ''));
  if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
    throw new Error(`Invalid percentage: ${amountInput}. Must be between 0% and 100%`);
  }
  
  const balance = await getTokenBalance(walletIdentifier, token);
  const actualAmount = (parseFloat(balance) * percentage / 100).toString();
  
  console.log(`  📊 ${walletIdentifier}: ${percentage}% of ${balance} ${token.symbol} = ${actualAmount} ${token.symbol}`);
  
  return actualAmount;
}

// Parse amount with decimals
function parseAmount(amount, decimals = 18) {
  return ethers.parseUnits(amount.toString(), decimals);
}

// Format amount for display
function formatAmount(amount, decimals = 18) {
  return ethers.formatUnits(amount, decimals);
}

// Transfer function - handles both ETH and ERC20 tokens
async function transferTokens(fromPrivateKey, toAddress, token, amount) {
  try {
    const provider = getRandomProvider();
    const wallet = new ethers.Wallet(fromPrivateKey, provider);
    
    const sendAmount = parseAmount(amount, token.decimals);
    
    if (token.symbol === 'ETH') {
      // ETH transfer
      const transactionFunction = async (provider, gasParams) => {
        const connectedWallet = wallet.connect(provider);
        return await connectedWallet.sendTransaction({
          to: toAddress,
          value: sendAmount,
          ...gasParams
        });
      };
      
      const result = await executeTransactionWithReplacementFee(transactionFunction);
      return {
        hash: result.hash,
        gasUsed: result.receipt ? result.receipt.gasUsed : null,
        rpcProvider: result.provider,
        success: true
      };
    } else {
      // ERC20 token transfer
      if (!token.address) {
        throw new Error(`Token address not configured for ${token.symbol}`);
      }
      
      const contract = new ethers.Contract(token.address, ERC20_ABI, wallet);
      
      const transactionFunction = async (provider, gasParams) => {
        const connectedContract = contract.connect(wallet.connect(provider));
        return await connectedContract.transfer(toAddress, sendAmount, gasParams);
      };
      
      const result = await executeTransactionWithReplacementFee(transactionFunction);
      return {
        hash: result.hash,
        gasUsed: result.receipt ? result.receipt.gasUsed : null,
        rpcProvider: result.provider,
        success: true
      };
    }
  } catch (error) {
    console.log(`❌ Transfer error: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

// Transfer bot main function
export async function runTransferBot(args) {
  try {
    console.log('🚀 Starting Transfer Bot...');
    console.log(`📋 Arguments received: ${JSON.stringify(args)}`);
    
    // Wait for wallets to be initialized before proceeding
    console.log('⏳ Waiting for wallet initialization...');
    const walletInitResult = await Promise.race([
      walletsReady,
      new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 5000))
    ]);
    
    // Check if wallet initialization timed out
    if (walletInitResult && walletInitResult.timeout) {
      console.warn('⚠️ Wallet initialization timed out after 5 seconds');
    } else {
      console.log(`✅ Wallet initialization complete. ${tradingWallets.length} wallets available.`);
    }
    
    if (args.length < 3) {
      console.log('❌ Insufficient arguments. Expected format: <token> <amount> <receiver> [gas] [from:walletId]');
      throw new Error('Usage: transferbot <token> <amount> <receiver> [gas] [from:walletId]');
    }
    
    const [tokenInput, amountInput, receiverInput, ...extraArgs] = args;
    
    // Parse gas price and sender if provided
    let customGasPrice = null;
    let senderIdentifier = null;
    
    for (const arg of extraArgs) {
      if (arg.startsWith('gas')) {
        customGasPrice = arg.replace('gas', '');
        console.log(`⛽ Custom gas price: ${customGasPrice} gwei`);
      }
      if (arg.startsWith('from:')) {
        senderIdentifier = arg.replace('from:', '');
        console.log(`📤 Explicitly selected sender wallet: ${senderIdentifier}`);
      }
    }
    
    // If no sender specified, use the first available selected wallet
    if (!senderIdentifier) {
      // In actual implementation this would access selectedWallets from global state
      // For now, we'll default to the first available wallet
      if (tradingWallets.length > 0) {
        const firstWallet = tradingWallets[0];
        senderIdentifier = firstWallet.name || 'B1';
      } else {
        senderIdentifier = 'B1'; // Default fallback
      }
      console.log(`📤 Using default sender wallet: ${senderIdentifier}`);
    }
    
    // Resolve token with sender wallet context
    console.log(`🔍 Resolving token: ${tokenInput}...`);
    const tokenResult = await resolveTokenInfo(tokenInput, senderIdentifier);
    if (!tokenResult.success) {
      throw new Error(`Token resolution failed: ${tokenResult.error}`);
    }
    
    const token = tokenResult;
    console.log(`✅ Token resolved: ${token.symbol} (${token.address || 'ETH'}) - Decimals: ${token.decimals}`);
    
    // Resolve receiver address
    console.log(`🔍 Resolving receiver: ${receiverInput}...`);
    const receiverAddress = await resolveAddress(receiverInput);
    if (!receiverAddress) {
      throw new Error(`Could not resolve receiver address: ${receiverInput}`);
    }
    console.log(`✅ Receiver resolved: ${receiverAddress}`);
    
    // Resolve sender private key
    const senderPrivateKey = getPrivateKey(senderIdentifier);
    if (!senderPrivateKey) {
      throw new Error(`Could not get private key for wallet: ${senderIdentifier}`);
    }
    const senderAddress = getAddressFromPrivateKey(senderPrivateKey);
    console.log(`   📍 Sender address: ${senderAddress}`);
    
    // Calculate actual amount (handle percentages)
    console.log(`🧮 Calculating transfer amount...`);
    const actualAmount = await calculateActualAmount(senderIdentifier, token, amountInput);
    console.log(`   💰 Transfer amount: ${actualAmount} ${token.symbol}`);
    
    // Verify sender has sufficient balance
    const senderBalance = await getTokenBalance(senderIdentifier, token);
    console.log(`   💳 Sender balance: ${senderBalance} ${token.symbol}`);
    
    if (parseFloat(actualAmount) > parseFloat(senderBalance)) {
      throw new Error(`Insufficient balance. Requested: ${actualAmount} ${token.symbol}, Available: ${senderBalance} ${token.symbol}`);
    }
    
    // Execute transfer
    console.log(`\n🔄 Executing transfer...`);
    console.log(`   📤 From: ${senderAddress}`);
    console.log(`   📥 To: ${receiverAddress}`);
    console.log(`   💰 Amount: ${actualAmount} ${token.symbol}`);
    console.log(`   🪙 Token: ${token.symbol} (${token.address || 'ETH'})`);
    
    const transferResult = await transferTokens(senderPrivateKey, receiverAddress, token, actualAmount);
    
    if (transferResult && transferResult.hash) {
      console.log(`\n✅ Transfer completed successfully!`);
      console.log(`   📊 Transaction hash: ${transferResult.hash}`);
      console.log(`   ⛽ Gas used: ${transferResult.gasUsed ? transferResult.gasUsed.toString() : 'N/A'}`);
      console.log(`   💰 Amount transferred: ${actualAmount} ${token.symbol}`);
      console.log(`   🔗 RPC provider: ${transferResult.rpcProvider || 'N/A'}`);
      
      // Show updated balances
      console.log(`\n📊 Updated balances:`);
      const newSenderBalance = await getTokenBalance(senderIdentifier, token);
      console.log(`   📤 ${senderIdentifier}: ${newSenderBalance} ${token.symbol} (was ${senderBalance})`);
      
    } else {
      const errorMsg = transferResult?.error || 'Unknown transfer error';
      throw new Error(`Transfer failed: ${errorMsg}`);
    }
    
  } catch (error) {
    console.error(`❌ Transfer Bot error: ${error.message}`);
    throw error;
  }
} 