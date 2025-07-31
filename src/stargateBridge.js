import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { ethers } from 'ethers';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { getRandomProvider, executeTransactionWithReplacementFee } from './config.js';

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

// Load configuration from wallets.json
const walletsDB = loadWalletsDB();
const config = walletsDB.config;

console.log('🌉 Stargate Bridge Module Loaded from wallets.json');

// Stargate Bridge Configuration
const STARGATE_CONFIG = {
  // Solana Configuration
  solanaRpcUrl: config.solanaRpcUrl || 'https://solana-mainnet.g.alchemy.com/v2/ZIBtIxLkuxumtIsaSB8inkE52nB5qKqC',
  virtualTokenMint: config.solanaVirtualTokenMint || '3iQL8BFS2vE7mww4ehAqQHAsbmRNCrPxizWAT2Zfyr9y',
  solanaSourcePrivateKey: walletsDB.bridging?.solanaSourcePrivateKey,
  
  // Base Network Configuration
  baseRpcUrl: config.rpcUrlQuickNode || config.rpcUrlInfura || config.rpcUrl,
  virtualTokenAddress: config.virtualTokenAddress || '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
  baseSourcePrivateKey: walletsDB.bridging?.baseSourcePrivateKey,
  virtualTokenDecimals: 18, // VIRTUAL token decimals on Base
  
  // Stargate Router Addresses
  stargateRouterSolana: config.stargateSolanaRouter || '68CFnYVZYu4Q4AACuKZenwruvXd5dDj8UoXyyxQmm9We',
  stargateRouterBase: config.stargateBaseRouter || '0xa5a1afbff720f79f1f7833aafbdcee87770bbc93',
  layerzeroEndpointSolana: config.layerzeroSolanaEndpoint || '76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6',
  
  // Virtual Token Addresses
  virtualTokenMint: config.solanaVirtualTokenMint || '3iQL8BFS2vE7mww4ehAqQHAsbmRNCrPxizWAT2Zfyr9y',
  virtualTokenAddress: config.virtualTokenAddress || '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
  
  // LayerZero Chain IDs
  stargateChainIdSolana: 30168,
  stargateChainIdBase: 30184,
  
  // Bridge Transfer Configuration
  minVirtualTransfer: config.minVirtualTransfer || 1.0,
  maxVirtualTransfer: config.maxVirtualTransfer || 100.0,
  transferIntervalSeconds: config.transferIntervalSeconds || 10
};

// ERC20 ABI for VIRTUAL token interactions on Base
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

// Stargate Virtual Bridge Class
class StargateVirtualBridge {
  constructor() {
    console.log('🌉 Initializing Stargate Virtual Bridge...');
    
    // Initialize Solana connection
    this.solanaConnection = new Connection(STARGATE_CONFIG.solanaRpcUrl, 'confirmed');
    console.log('✅ Solana connection initialized');
    
    // Initialize Base provider
    this.baseProvider = getRandomProvider();
    console.log('✅ Base provider initialized');
    
    // Initialize Solana wallet
    if (STARGATE_CONFIG.solanaSourcePrivateKey) {
      try {
        this.solanaWallet = Keypair.fromSecretKey(bs58.decode(STARGATE_CONFIG.solanaSourcePrivateKey));
        console.log('✅ Solana wallet initialized:', this.solanaWallet.publicKey.toString());
      } catch (error) {
        console.error('❌ Failed to initialize Solana wallet:', error.message);
        throw new Error('Invalid Solana private key');
      }
    } else {
      console.warn('⚠️ Solana source private key not configured');
    }
    
    // Initialize Base wallet for reverse transfers
    if (STARGATE_CONFIG.baseSourcePrivateKey) {
      try {
        this.baseWallet = new ethers.Wallet(STARGATE_CONFIG.baseSourcePrivateKey, this.baseProvider);
        console.log('✅ Base wallet initialized:', this.baseWallet.address);
        
        // Initialize VIRTUAL token contract on Base for reverse transfers
        this.virtualTokenContract = new ethers.Contract(
          STARGATE_CONFIG.virtualTokenAddress,
          ERC20_ABI,
          this.baseWallet
        );
        console.log('✅ Base VIRTUAL token contract initialized');
      } catch (error) {
        console.error('❌ Failed to initialize Base wallet:', error.message);
        this.baseWallet = null;
        this.virtualTokenContract = null;
      }
    } else {
      console.warn('⚠️ Base source private key not configured - reverse transfers will not be available');
      this.baseWallet = null;
      this.virtualTokenContract = null;
    }
    
    // Virtual token mint
    this.virtualTokenMint = new PublicKey(STARGATE_CONFIG.virtualTokenMint);
    console.log('✅ Virtual token mint:', this.virtualTokenMint.toString());
    
    console.log('🚀 Stargate Virtual Bridge initialized successfully');
    console.log('🔄 Available directions: Solana → Base, Base → Solana');
  }
  
  // Get VIRTUAL token balance from Solana
  async getVirtualBalance() {
    try {
      if (!this.solanaWallet) {
        throw new Error('Solana wallet not initialized');
      }
      
      console.log('💰 Checking VIRTUAL balance on Solana...');
      
      // Get associated token account
      const associatedTokenAccount = await getAssociatedTokenAddress(
        this.virtualTokenMint,
        this.solanaWallet.publicKey
      );
      
      console.log('📍 Associated token account:', associatedTokenAccount.toString());
      
      // Get account info
      const accountInfo = await getAccount(this.solanaConnection, associatedTokenAccount);
      const balance = Number(accountInfo.amount) / Math.pow(10, 9); // VIRTUAL has 9 decimals on Solana
      
      console.log(`💰 VIRTUAL balance: ${balance} tokens`);
      return balance;
      
    } catch (error) {
      console.error('❌ Failed to get VIRTUAL balance:', error.message);
      return 0;
    }
  }
  
  // REAL Stargate bridge transfer - NO SIMULATION
  async executeBridgeTransfer(toAddress, amount) {
    if (!this.solanaWallet) {
      throw new Error('Solana wallet not initialized - real transfers require wallet');
    }
    
    console.log(`🌉 REAL bridge transfer:`);
    console.log(`   From: Solana (${this.solanaWallet.publicKey.toString()})`);
    console.log(`   To: Base (${toAddress})`);
    console.log(`   Amount: ${amount} VIRTUAL`);
    console.log(`   Router: ${STARGATE_CONFIG.stargateRouterSolana} → ${STARGATE_CONFIG.stargateRouterBase}`);
    
    try {
      // Step 1: Get Stargate quote
      console.log('📋 Getting Stargate quote...');
      const quote = await this.getStargateQuote(amount, toAddress);
      
      // Step 2: Execute real transaction
      console.log('⚡ Executing real bridge transaction...');
      const result = await this.executeStargateTransaction(quote, amount, toAddress);
      
      console.log(`✅ REAL bridge transfer completed successfully`);
      console.log(`📋 Transaction hash: ${result.txHash}`);
      console.log(`🔗 View on Solscan: https://solscan.io/tx/${result.txHash}`);
      
      return {
        success: true,
        hash: result.txHash,
        amount: amount,
        fromChain: 'Solana',
        toChain: 'Base',
        toAddress: toAddress,
        isReal: true,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`❌ REAL bridge transfer failed: ${error.message}`);
      throw error;
    }
  }

  // Get Stargate quote using official API
  async getStargateQuote(amount, destinationAddress) {
    try {
      // Use BigNumber for precise calculations to avoid floating point precision issues
      const solanaDecimals = 9; // VIRTUAL has 9 decimals on Solana
      const baseDecimals = 18; // VIRTUAL has 18 decimals on Base
      
      // Convert amount for each chain (different decimals)
      const amountSolana = ethers.parseUnits(Math.floor(amount).toString(), solanaDecimals);
      
      // Calculate minimum amount with 3% slippage for Base (18 decimals)
      const amountBaseString = ethers.parseEther(Math.floor(amount).toString()).toString();
      const amountBase = ethers.BigNumber.from(amountBaseString);
      const minAmountBase = amountBase.mul(97).div(100); // 3% slippage using BigNumber
      
      console.log(`💱 Quote calculation: ${amount} VIRTUAL`);
      console.log(`📊 Source amount: ${amountSolana.toString()} (${solanaDecimals} decimals)`);
      console.log(`📊 Min destination: ${minAmountBase.toString()} (${baseDecimals} decimals)`);
      
      const quoteParams = new URLSearchParams({
        srcToken: STARGATE_CONFIG.virtualTokenMint,
        dstToken: STARGATE_CONFIG.virtualTokenAddress,
        srcAddress: this.solanaWallet.publicKey.toString(),
        dstAddress: destinationAddress,
        srcChainKey: 'solana',
        dstChainKey: 'base',
        srcAmount: amountSolana.toString(), // Use BigNumber string representation
        dstAmountMin: minAmountBase.toString() // Use BigNumber string representation
      });

      const response = await fetch(`https://stargate.finance/api/v1/quotes?${quoteParams}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Stargate API ${response.status}: ${response.statusText} - ${errorText}`);
      }

      const quote = await response.json();
      
      if (quote.quotes && quote.quotes[0] && quote.quotes[0].error) {
        throw new Error(`Quote error: ${quote.quotes[0].error.message}`);
      }
      
      return quote;
      
    } catch (error) {
      throw new Error(`Failed to get Stargate quote: ${error.message}`);
    }
  }
  
  // Execute Stargate transaction
  async executeStargateTransaction(quote, amount, destinationAddress) {
    try {
      const firstQuote = quote.quotes && quote.quotes[0];
      if (!firstQuote || !firstQuote.steps || firstQuote.steps.length === 0) {
        throw new Error('No transaction steps provided by Stargate API');
      }
      
      const step = firstQuote.steps[0];
      
      if (step.type !== 'bridge' || step.chainKey !== 'solana') {
        throw new Error(`Unsupported step type or chain: ${step.type} on ${step.chainKey}`);
      }
      
      if (!step.transaction || !step.transaction.data) {
        throw new Error('No transaction data provided by Stargate API');
      }
      
      // Execute the Solana transaction
      const txBuffer = Buffer.from(step.transaction.data, 'base64');
      
      // Try versioned transaction first
      try {
        const versionedTx = VersionedTransaction.deserialize(txBuffer);
        versionedTx.sign([this.solanaWallet]);
        
        const signature = await this.solanaConnection.sendRawTransaction(
          versionedTx.serialize(),
          { skipPreflight: false }
        );
        
        // Confirm transaction
        await this.confirmTransaction(signature);
        
        return { txHash: signature };
        
      } catch (versionedError) {
        // Fallback to legacy transaction
        const transaction = Transaction.from(txBuffer);
        
        const { blockhash } = await this.solanaConnection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = this.solanaWallet.publicKey;
        
        const signature = await this.solanaConnection.sendTransaction(
          transaction,
          [this.solanaWallet],
          { skipPreflight: false }
        );
        
        // Confirm transaction
        await this.confirmTransaction(signature);
        
        return { txHash: signature };
      }
      
    } catch (error) {
      throw new Error(`Failed to execute Stargate transaction: ${error.message}`);
    }
  }
  
  // Confirm transaction using polling
  async confirmTransaction(signature) {
    const maxRetries = 30; // 30 seconds timeout
    const delay = 1000; // 1 second delay
    
    console.log('⏳ Confirming transaction...');
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const result = await this.solanaConnection.getSignatureStatus(signature);
        
        if (result.value) {
          if (result.value.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
          }
          if (result.value.confirmationStatus === 'confirmed' || result.value.confirmationStatus === 'finalized') {
            console.log('✅ Transaction confirmed on Solana');
            return;
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
        
      } catch (error) {
        if (i === maxRetries - 1) {
          throw new Error(`Transaction confirmation timeout: ${error.message}`);
        }
      }
    }
    
    throw new Error('Transaction confirmation timeout after 30 seconds');
  }
  
  // Get Base wallet addresses from wallets.json
  getBaseWalletAddresses() {
    const addresses = [];
    
    if (!walletsDB.wallets || !Array.isArray(walletsDB.wallets)) {
      console.warn('⚠️ No wallets array found in wallets.json');
      return addresses;
    }
    
    for (const wallet of walletsDB.wallets) {
      if (wallet.address && wallet.enabled !== false) {
        addresses.push({
          identifier: wallet.name || 'Unknown',
          address: wallet.address,
          privateKey: wallet.privateKey || null
        });
      }
    }
    
    console.log(`🔑 Found ${addresses.length} Base wallets from wallets.json`);
    return addresses;
  }

  // Generate random transfer amount
  generateRandomAmount() {
    const min = STARGATE_CONFIG.minVirtualTransfer;
    const max = STARGATE_CONFIG.maxVirtualTransfer;
    const amount = Math.random() * (max - min) + min;
    return Math.floor(amount * 100) / 100; // Round to 2 decimal places
  }

  // Transfer to multiple wallets (MAIN FUNCTION FOR GUI)
  async transferToMultipleWallets(minAmount = null, maxAmount = null, specificWallets = []) {
    try {
      console.log('🌉 Starting multiple wallet bridge transfers...');
      
      const sourceBalance = await this.getVirtualBalance();
      const min = minAmount !== null ? minAmount : STARGATE_CONFIG.minVirtualTransfer;
      const max = maxAmount !== null ? maxAmount : STARGATE_CONFIG.maxVirtualTransfer;
      
      console.log(`💰 Transfer Range: ${min} - ${max} VIRTUAL per wallet`);
      console.log(`💰 Current VIRTUAL balance: ${sourceBalance}`);
      
      if (sourceBalance < min) {
        throw new Error(`Insufficient VIRTUAL balance: ${sourceBalance} (need at least ${min})`);
      }
      
      let baseWallets;
      if (specificWallets.length > 0) {
        // Use specific wallets provided via GUI or command line
        baseWallets = specificWallets.map(addr => ({
          identifier: 'CUSTOM',
          address: addr,
          privateKey: null
        }));
        console.log(`🏠 Target Wallets: ${baseWallets.length} (specific addresses)`);
      } else {
        // Use all wallets from wallets.json
        baseWallets = this.getBaseWalletAddresses();
        console.log(`🏠 Target Wallets: ${baseWallets.length} (from wallets.json)`);
      }
      
      if (baseWallets.length === 0) {
        throw new Error('No Base wallets found');
      }
      
      const totalWallets = baseWallets.length;
      let successCount = 0;
      let failCount = 0;
      let failedWallets = []; // Track failed wallets for retry
      
      // PHASE 1: Process all wallets
      console.log('\n📋 PHASE 1: Processing all wallets...');
      for (let i = 0; i < totalWallets; i++) {
        const wallet = baseWallets[i];
        
        // Use custom amount or generate random amount
        const amount = minAmount !== null && maxAmount !== null ? 
          Math.random() * (maxAmount - minAmount) + minAmount :
          this.generateRandomAmount();
        
        try {
          console.log(`\n📤 Transfer ${i + 1}/${totalWallets}`);
          console.log(`🌉 Bridging ${amount} VIRTUAL to ${wallet.address}...`);
          
          // Check if we have enough balance for this transfer
          const currentBalance = await this.getVirtualBalance();
          if (currentBalance < amount) {
            console.log(`⚠️ Insufficient balance for transfer ${i + 1}. Adding to retry list...`);
            failedWallets.push({
              wallet: wallet,
              amount: amount,
              reason: 'insufficient_balance',
              attempt: 1
            });
            failCount++;
            continue;
          }
          
          const result = await this.executeBridgeTransfer(wallet.address, amount);
          successCount++;
          
          console.log(`✅ Transfer ${i + 1} completed successfully`);
          console.log(`📝 Tx: ${result.hash}`);
          
          // Add delay between transfers (except for the last one)
          if (i < totalWallets - 1) {
            const delay = 5000 + Math.random() * 5000; // 5-10 seconds
            console.log(`⏱️ Waiting ${(delay/1000).toFixed(1)}s before next transfer...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          
        } catch (error) {
          console.error(`❌ Transfer ${i + 1} failed:`, error.message);
          failCount++;
          
          // Save failed wallet for retry
          failedWallets.push({
            wallet: wallet,
            amount: amount,
            reason: error.message,
            attempt: 1
          });
        }
      }
      
      // Display Phase 1 results
      console.log('\n📊 PHASE 1 Summary:');
      if (successCount > 0) {
        console.log(`✅ Successful: ${successCount} real bridge transfers`);
      }
      if (failCount > 0) {
        console.log(`❌ Failed: ${failCount}`);
      }
      console.log(`📋 Total processed: ${totalWallets}`);
      
      // Simple retry for failed wallets (1 retry round only for GUI)
      if (failedWallets.length > 0) {
        console.log('\n🔄 RETRY PHASE: Processing failed wallets...');
        
        for (let i = 0; i < failedWallets.length; i++) {
          const failedWallet = failedWallets[i];
          
          try {
            console.log(`\n🔄 Retry - Wallet ${i + 1}/${failedWallets.length}`);
            console.log(`📍 Target: ${failedWallet.wallet.address}`);
            console.log(`💰 Amount: ${failedWallet.amount} VIRTUAL`);
            
            // Check balance again for insufficient balance retries
            if (failedWallet.reason === 'insufficient_balance') {
              const currentBalance = await this.getVirtualBalance();
              if (currentBalance < failedWallet.amount) {
                console.log(`⚠️ Still insufficient balance (${currentBalance} < ${failedWallet.amount}). Skipping.`);
                continue;
              }
            }

            const result = await this.executeBridgeTransfer(failedWallet.wallet.address, failedWallet.amount);
            
            failedWallet.finalStatus = 'success';
            failedWallet.txHash = result.hash;
            successCount++;
            failCount--;
            
            console.log(`✅ Retry successful: ${failedWallet.amount} VIRTUAL → ${failedWallet.wallet.address}`);
            console.log(`📝 Tx: ${result.hash}`);

          } catch (error) {
            console.error(`❌ Retry failed for wallet ${i + 1}:`, error.message);
            failedWallet.finalStatus = 'failed';
            failedWallet.lastError = error.message;
          }
          
          // Small delay between retries
          if (i < failedWallets.length - 1) {
            const delay = 2000 + Math.random() * 3000; // 2-5 seconds
            console.log(`⏱️ Brief pause: ${(delay/1000).toFixed(1)}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      // Final summary
      console.log('\n🏁 FINAL SUMMARY:');
      console.log('═══════════════════════════════════════');
      console.log(`✅ Total Successful: ${successCount} real bridge transfers`);
      if (failCount > 0) {
        console.log(`❌ Final Failed: ${failCount}`);
      }
      console.log(`📋 Grand Total: ${totalWallets}`);
      
      return {
        successful: successCount,
        failed: failCount,
        totalSuccess: successCount,
        totalFailed: failCount
      };
      
    } catch (error) {
      console.error('❌ Multiple wallet bridge transfer failed:', error.message);
      throw error;
    }
  }
}

// Command line interface for Stargate bridge  
export async function runStargateBridge(args = []) {
  try {
    console.log('🌉 Starting Stargate Bridge...');
    console.log('Arguments:', args);
    
    const bridge = new StargateVirtualBridge();
    
    // Array to store specific wallet addresses
    const specificWallets = [];
    
    // Check for WALLETTOKEN flag (indicates wallet selection from UI)
    if (args.includes('WALLETTOKEN')) {
      console.log('🔍 Found WALLETTOKEN flag - checking environment variables for wallet selection');
      
      // Remove the WALLETTOKEN from arguments
      args = args.filter(arg => arg !== 'WALLETTOKEN');
      
      // Check for WALLETTOKEN_SELECTED environment variable
      const selectedIndicesStr = process.env.WALLETTOKEN_SELECTED;
      
      if (selectedIndicesStr) {
        try {
          console.log(`🔑 WALLETTOKEN_SELECTED: ${selectedIndicesStr}`);
          
          // Parse the selected indices - converts "0,1,2" to [0,1,2]
          const selectedIndices = selectedIndicesStr.split(',').map(Number);
          console.log(`🔑 Selected wallet indices: [${selectedIndices.join(', ')}]`);
          
          // Process each wallet from environment variables
          for (const index of selectedIndices) {
            const oneBasedIndex = index + 1; // Convert to 1-based for B1, B2, etc.
            const envKey = `B${oneBasedIndex}`;
            const privateKey = process.env[envKey];
            
            if (privateKey && privateKey.length > 0) {
              try {
                // Create wallet and add its address to specificWallets
                const wallet = new ethers.Wallet(privateKey);
                console.log(`✅ Using wallet ${envKey}: ${wallet.address}`);
                specificWallets.push(wallet.address);
              } catch (error) {
                console.error(`❌ Error using wallet ${envKey}: ${error.message}`);
              }
            } else {
              console.log(`⚠️ No private key found in ${envKey} environment variable`);
            }
          }
          
          if (specificWallets.length > 0) {
            console.log(`🔑 Found ${specificWallets.length} wallet addresses from UI selection`);
          } else {
            console.log('⚠️ No wallet addresses found from selected indices');
          }
        } catch (error) {
          console.error(`Error parsing WALLETTOKEN_SELECTED: ${error.message}`);
        }
      } else {
        console.log('⚠️ WALLETTOKEN flag found but no WALLETTOKEN_SELECTED environment variable set');
      }
    }
    
    if (args.length === 0) {
      // Default mode - decide whether to use specific wallets or all from wallets.json
      if (specificWallets.length > 0) {
        // Use specific wallets from UI selection
        console.log(`🎯 Default mode: Bridging to ${specificWallets.length} selected wallets`);
        
        // Convert wallet addresses to wallet objects
        const walletObjects = specificWallets.map(address => ({
          identifier: 'SELECTED',
          address: address,
          privateKey: null
        }));
        
        await bridge.transferToMultipleWallets(null, null, walletObjects);
      } else {
        // Use all wallets from wallets.json
        console.log('🎯 Default mode: Bridging to all wallets from wallets.json');
        await bridge.transferToMultipleWallets();
      }
      return;
    }
    
    // Check if first argument is a number - if so, treat as transfer-once with amounts
    const firstArg = args[0];
    let command = firstArg.toLowerCase();
    let commandArgs = args.slice(1);
    
    if (!isNaN(parseFloat(firstArg)) && isFinite(firstArg)) {
      console.log('💡 Detected numeric arguments - treating as transfer-once command');
      command = 'transfer-once';
      commandArgs = args; // Use all args as amount arguments
    }
    
    switch (command) {
      case 'balance':
        const balance = await bridge.getVirtualBalance();
        console.log(`💰 Current VIRTUAL balance on Solana: ${balance} tokens`);
        break;
        
      case 'transfer-once':
        // Support: stargate transfer-once 1200 1250 (min_amount max_amount)
        // Support: stargate transfer-once 1200 (exact amount)  
        // Support: stargate transfer-once all (99.9% of balance)
        // Support: stargate 1200 1250 (automatic detection)
        const transferOnceArgs = commandArgs;
        
        let minAmount = null;
        let maxAmount = null;
        let useAllBalance = false;
        
        // Check for "all" keyword
        if (transferOnceArgs.length > 0 && transferOnceArgs[0].toLowerCase() === 'all') {
          useAllBalance = true;
          console.log('💰 Using 99.9% of available balance');
          
          // Get current balance and calculate 99.9%
          const currentBalance = await bridge.getVirtualBalance();
          if (currentBalance <= 0) {
            throw new Error('No VIRTUAL balance available on Solana');
          }
          
          const transferAmount = currentBalance * 0.999; // 99.9% of balance
          minAmount = transferAmount;
          maxAmount = transferAmount;
          console.log(`💰 Calculated amount: ${transferAmount} VIRTUAL (99.9% of ${currentBalance})`);
          
        } else {
          // Parse numeric amounts
          const amounts = transferOnceArgs.filter(arg => !isNaN(parseFloat(arg)) && isFinite(arg));
          
          if (amounts.length >= 1) {
            minAmount = parseFloat(amounts[0]);
            
            if (amounts.length >= 2) {
              // Two amounts provided: min and max range
              maxAmount = parseFloat(amounts[1]);
              console.log(`💰 Custom amount range: ${minAmount} - ${maxAmount} VIRTUAL`);
            } else {
              // Single amount provided: exact amount
              maxAmount = minAmount;
              console.log(`💰 Exact amount: ${minAmount} VIRTUAL`);
            }
          }
        }
        
        // Check if we have specific wallets from the UI selection
        if (specificWallets.length > 0) {
          console.log('🌉 Executing REAL bridge transfers to SELECTED wallets...');
          console.log(`📋 Target wallets: ${specificWallets.length}`);
          
          // Convert wallet addresses to wallet objects
          const walletObjects = specificWallets.map(address => ({
            identifier: 'SELECTED',
            address: address,
            privateKey: null
          }));
          
          const result = await bridge.transferToMultipleWallets(minAmount, maxAmount, walletObjects);
          console.log('✅ REAL Bridge transfers completed!');
          console.log(`📊 Results: ${result.successful} successful, ${result.failed} failed`);
        } else {
          console.log('🌉 Executing REAL bridge transfers to ALL wallets from wallets.json...');
          
          // Execute REAL bridge transfer to all wallets from wallets.json
          const result = await bridge.transferToMultipleWallets(minAmount, maxAmount);
          
          console.log('✅ REAL Bridge transfers completed!');
          console.log(`📊 Results: ${result.successful} successful, ${result.failed} failed`);
        }
        break;
        
      default:
        console.log(`
❌ Invalid command. Available commands:

🔄 BASIC COMMANDS:

1. Check balance:
   npm run stargate balance

2. Single transfer:
   npm run stargate transfer-once [amount | min_amount max_amount | all]
   Examples:
   npm run stargate transfer-once 1200          # Exact amount: 1200 VIRTUAL
   npm run stargate transfer-once 1200 1250     # Range: 1200-1250 VIRTUAL
   npm run stargate transfer-once all           # 99.9% of Solana balance

💡 Note: For full functionality, use the autotrade system
        `);
        break;
    }
    
  } catch (error) {
    console.error(`❌ Stargate Bridge error: ${error.message}`);
    process.exit(1);
  }
} 