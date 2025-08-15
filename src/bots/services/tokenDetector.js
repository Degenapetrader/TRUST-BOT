// Token detector service for Genesis contract monitoring

import { ethers } from 'ethers';
import { 
  GENESIS_ABI,
  ERC20_ABI, 
  BALANCE_RECHECK_INTERVAL,
  WALLET_PROCESSING_DELAY
} from '../config/jeetConstants.js';
import { log, formatTimestampUTC } from '../../utils/logger.js';
import { sleep } from '../../utils/common.js';
import { ConfigLoader } from '../../config/loader.js';

// Dynamic WebSocket provider configuration from wallets.json
function getWebSocketProviders() {
  const configLoader = new ConfigLoader();
  // SURGICAL FIX: Use getRpcConfigurations() which decodes base64 URLs instead of getConfig() which returns raw base64
  const rpcConfigs = configLoader.getRpcConfigurations();
  
  const providers = [];
  
  // Initialize providers from decoded RPC configurations
  for (const rpcConfig of rpcConfigs) {
    if (rpcConfig.wsUrl && rpcConfig.rpcUrl) {
      // Filter out providers that don't support WebSocket subscriptions (eth_subscribe)
      const providerName = rpcConfig.name.toLowerCase();
      const wsUrl = rpcConfig.wsUrl.toLowerCase();
      
      // Skip providers known to not support eth_subscribe
      if (wsUrl.includes('blastapi.io') || wsUrl.includes('blast') || 
          providerName.includes('blast') || providerName.includes('quicknode')) {
        log(`⚠️ ${rpcConfig.name}: Skipping - WebSocket subscriptions not supported by this provider`);
        continue;
      }
      
      try {
        const rpcProvider = new ethers.JsonRpcProvider(rpcConfig.rpcUrl);
        const wsProvider = new ethers.WebSocketProvider(rpcConfig.wsUrl);
        
        rpcProvider._providerName = `${rpcConfig.name}-RPC`;
        wsProvider._providerName = `${rpcConfig.name}-WebSocket`;
        
        // Determine provider capabilities based on name
        const supportsPendingTx = rpcConfig.name.toLowerCase().includes('alchemy');
        const priority = rpcConfig.name.toLowerCase().includes('infura') ? 1 : 2;
        
        providers.push({
          name: rpcConfig.name,
          rpcProvider: rpcProvider,
          wsProvider: wsProvider,
          priority: priority,
          supportsPendingTx: supportsPendingTx,
          supportsBlocks: true
        });
        
        log(`✅ ${rpcConfig.name} WebSocket provider loaded for token detection (${supportsPendingTx ? 'full support' : 'blocks only'})`);
      } catch (error) {
        log(`⚠️ Failed to create ${rpcConfig.name} WebSocket provider: ${error.message}`);
      }
    }
  }
  
  // Sort by priority (Infura first, then Alchemy)
  providers.sort((a, b) => a.priority - b.priority);
  
  if (providers.length === 0) {
    throw new Error('No WebSocket providers available from wallets.json configuration');
  }
  
  log(`🔗 Token detection providers: ${providers.map(p => `${p.name}(${p.supportsPendingTx ? 'pending+blocks' : 'blocks-only'})`).join(' → ')}`);
  return providers;
}

export class TokenDetector {
  constructor() {
    this.isDetecting = false;
    this.providers = [];
    this.activeConnections = [];
  }

  async detectTokenCAWebSocket(genesisContractAddress) {
    log(`🔗 Smart Event Detection Starting with Dynamic WebSocket Providers...`);
    
    // Load providers from wallets.json
    this.providers = getWebSocketProviders();
    log(`📡 Using ${this.providers.length} WebSocket providers: ${this.providers.map(p => p.name).join(', ')}`);
    
    // STEP 1: Quick pre-check using HTTP provider to see if token already exists
    log(`🔍 Step 1: Checking if token already exists...`);
    log(`🎯 Monitoring Genesis Contract: ${genesisContractAddress}`);
    try {
      const primaryProvider = this.providers[0].rpcProvider;
      const genesisContract = new ethers.Contract(genesisContractAddress, GENESIS_ABI, primaryProvider);
      log(`📡 Calling genesisContract.agentTokenAddress()...`);
      const existingToken = await genesisContract.agentTokenAddress();
      log(`📋 Genesis contract returned: ${existingToken}`);
      
      if (existingToken && 
          existingToken !== ethers.ZeroAddress &&
          ethers.isAddress(existingToken)) {
        log(`🎯 TOKEN ALREADY EXISTS! Found: ${existingToken}`);
        log(`✅ Skipping WebSocket detection - token already deployed`);
        return existingToken;
      } else {
        if (existingToken === ethers.ZeroAddress || existingToken === '0x0000000000000000000000000000000000000000') {
          log(`⏳ Token not yet deployed (${existingToken})`);
          log(`✅ Genesis contract is valid and being monitored correctly`);
          log(`🔄 This is NORMAL - waiting for token deployment from Genesis contract`);
          log(`📡 Starting WebSocket event listeners to detect deployment...`);
        } else {
          log(`⏳ Token not yet deployed (${existingToken}), starting WebSocket event listeners...`);
        }
      }
    } catch (error) {
      log(`⚠️ Pre-check failed: ${error.message}, proceeding with WebSocket detection...`);
    }
    
    // STEP 2: Multi-provider WebSocket detection with priority fallback
    return new Promise((resolve, reject) => {
      log(`📡 Using Multi-Provider WebSocket Event Listeners`);
      log(`🔄 Priority Order: ${this.providers.map(p => p.name).join(' → ')}`);
      log(`⚡ Listening for real-time events (push notifications)`);
      log(`⚠️  Press Ctrl+C to stop detection`);

      let detectedCA = null;
      let isDetected = false;
      const rpcStats = { 
        total_requests: 0, 
        successful_requests: 0, 
        failed_requests: 0, 
        providers: {}
      };
      const detectionStartTime = Date.now();

      // Initialize provider stats
      this.providers.forEach(provider => {
        rpcStats.providers[provider.name] = { total: 0, successful: 0, failed: 0 };
      });

      // Handle Ctrl+C during detection
      const handleInterrupt = () => {
        log(`\n🛑 Detection interrupted by user`);
        this.cleanup();
        reject(new Error('Detection interrupted by user'));
      };

      process.on('SIGINT', handleInterrupt);

      // Setup listeners for each provider (Infura first, then Alchemy)
      this.providers.forEach((providerConfig, index) => {
        const { name, wsProvider, supportsPendingTx, supportsBlocks } = providerConfig;
        const providerName = `${name}-WebSocket-Events`;
        
        log(`🔗 Setting up ${name} WebSocket listeners (priority ${index + 1})...`);
        log(`📡 ${name} capabilities: ${supportsPendingTx ? 'pending+blocks' : 'blocks-only'}`);
        
        // Store active connection for cleanup
        this.activeConnections.push(wsProvider);

        // Method 1: Listen for pending transactions (only for providers that support it)
        if (supportsPendingTx) {
          log(`⚡ ${name}: Setting up pending transaction listener...`);
          try {
            wsProvider.on('pending', async (txHash) => {
            if (isDetected) return;

          try {
              rpcStats.total_requests++;
              rpcStats.providers[name].total++;
              
              // Get transaction details
              const tx = await wsProvider.getTransaction(txHash);
              
              if (tx && tx.to && tx.to.toLowerCase() === genesisContractAddress.toLowerCase()) {
                log(`🔍 ${name}: Genesis contract transaction detected: ${txHash}`);
                rpcStats.successful_requests++;
                rpcStats.providers[name].successful++;
                
                // Wait for transaction to be mined
                try {
                  const receipt = await tx.wait();
                  log(`⛏️ ${name}: Transaction mined in block ${receipt.blockNumber}`);
                  
                  // Check if token was deployed
                  const genesisContract = new ethers.Contract(genesisContractAddress, GENESIS_ABI, wsProvider);
                  const agentTokenAddress = await genesisContract.agentTokenAddress();
            
            if (agentTokenAddress && 
                agentTokenAddress !== ethers.ZeroAddress &&
                ethers.isAddress(agentTokenAddress)) {
              
                    if (!isDetected) {
                      isDetected = true;
                      detectedCA = agentTokenAddress;
                      const detectionEndTime = Date.now();
                      const detectionDuration = detectionEndTime - detectionStartTime;
                      
                      // Clean up all connections
                      this.cleanup();
                      process.removeListener('SIGINT', handleInterrupt);
                      
                      log(`\n🎯 TOKEN CA DETECTED via ${name} Pending Transaction!`);
                      log(`✅ Token Address: ${agentTokenAddress}`);
                      log(`⚡ Provider: ${name} (priority ${index + 1})`);
                      log(`⚡ Trigger Transaction: ${txHash}`);
                      log(`📦 Block Number: ${receipt.blockNumber}`);
                      log(`⏱️ Detection time: ${detectionDuration}ms`);
                      log(`📊 Event calls made: ${rpcStats.total_requests} (${rpcStats.successful_requests} successful)`);
                      
                      resolve(agentTokenAddress);
                    }
                  }
                } catch (waitError) {
                  log(`⚠️ ${name}: Error waiting for transaction: ${waitError.message}`);
                }
              }
              
            } catch (error) {
              rpcStats.failed_requests++;
              rpcStats.providers[name].failed++;
              // Silently handle errors for pending transactions (they're frequent)
            }
            });
          } catch (subscriptionError) {
            log(`⚠️ ${name}: Pending transaction subscription not supported: ${subscriptionError.message}`);
          }
        } else {
          log(`⏭️ ${name}: Skipping pending transaction listener (not supported)`);
        }

        // Method 2: Listen for new blocks (supported by all providers)
        if (supportsBlocks) {
          log(`📦 ${name}: Setting up block listener...`);
          try {
            wsProvider.on('block', async (blockNumber) => {
            if (isDetected) return;
            
            try {
              rpcStats.total_requests++;
              rpcStats.providers[name].total++;
              
              // Check token deployment every new block
              const genesisContract = new ethers.Contract(genesisContractAddress, GENESIS_ABI, wsProvider);
              const agentTokenAddress = await genesisContract.agentTokenAddress();
              
              rpcStats.successful_requests++;
              rpcStats.providers[name].successful++;
              
              if (agentTokenAddress && 
                  agentTokenAddress !== ethers.ZeroAddress &&
                  ethers.isAddress(agentTokenAddress)) {
                
                if (!isDetected) {
                  isDetected = true;
                  detectedCA = agentTokenAddress;
                  const detectionEndTime = Date.now();
                  const detectionDuration = detectionEndTime - detectionStartTime;
                  
                  // Clean up all connections
                this.cleanup();
                process.removeListener('SIGINT', handleInterrupt);
                
                  log(`\n🎯 TOKEN CA DETECTED via ${name} Block Event!`);
                log(`✅ Token Address: ${agentTokenAddress}`);
                  log(`⚡ Provider: ${name} (priority ${index + 1})`);
                  log(`📦 Block Number: ${blockNumber}`);
                  log(`⏱️ Detection time: ${detectionDuration}ms`);
                  log(`📊 Block checks made: ${rpcStats.total_requests} (${rpcStats.successful_requests} successful)`);
                  
                resolve(agentTokenAddress);
              }
            }
      
          } catch (error) {
              rpcStats.failed_requests++;
              rpcStats.providers[name].failed++;
              log(`⚠️ ${name}: Block check error: ${error.message}`);
            }
            });
          } catch (subscriptionError) {
            log(`⚠️ ${name}: Block subscription not supported: ${subscriptionError.message}`);
          }
        }

        // Connection monitoring per provider
        wsProvider.on('error', (error) => {
          log(`❌ ${name} WebSocket error: ${error.message}`);
          if (index === this.providers.length - 1 && !isDetected) {
            // If this is the last provider and still no detection, reject
            this.cleanup();
            reject(new Error(`All WebSocket providers failed. Last error: ${error.message}`));
          }
        });
      });

      // Log status every 30 seconds to show we're still listening
      const statusInterval = setInterval(() => {
        if (!isDetected) {
          const activeProviders = this.providers.map(p => p.name).join(', ');
          log(`🔄 Still listening for events... (${activeProviders} WebSocket active, ${rpcStats.total_requests} events processed)`);
        } else {
          clearInterval(statusInterval);
        }
      }, 30000);

      log(`✅ Multi-provider WebSocket event listeners established. Waiting for Genesis contract activity...`);
    });
  }

  cleanup() {
    if (this.activeConnections.length > 0) {
      log(`🧹 Cleaning up ${this.activeConnections.length} WebSocket connections...`);
      this.activeConnections.forEach(wsProvider => {
        try {
          if (wsProvider && wsProvider.removeAllListeners) {
            wsProvider.removeAllListeners();
      }
          if (wsProvider && wsProvider.destroy) {
            wsProvider.destroy();
          }
        } catch (error) {
          // Ignore cleanup errors
      }
    });
      this.activeConnections = [];
    }
  }
} 