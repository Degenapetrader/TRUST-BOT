// Approval manager service for parallel token approvals

import { ethers } from 'ethers';
import { executeTransactionWithReplacementFee } from '../../config.js';
import { ERC20_ABI, APPROVAL_GAS_LIMIT } from '../config/jeetConstants.js';
// Hardcoded TRUSTSWAP contract address
const TRUSTSWAP_CONTRACT = '0x2FE16B70724Df66419E125dE84e58276057A56A0';
import { getRandomProvider } from '../../config/index.js';
import { log } from '../../utils/logger.js';
import { sleep } from '../../utils/common.js';

export class ApprovalManager {
  /**
   * Approve token for all wallets in parallel for TRUSTSWAP
   * @param {string} tokenCA - Token contract address
   * @param {Array} wallets - Array of wallet instances
   * @returns {Promise<Array>} Array of approval results
   */
  static async approveTokenForAllWallets(tokenCA, wallets) {
    log(`\n🔓 ====================== PARALLEL APPROVE PHASE (TRUSTSWAP) ======================`);
    log(`🎯 Token to approve: ${tokenCA}`);
    log(`👛 Approving for ${wallets.length} selected wallets in parallel...`);
    log(`💱 Target: TRUSTSWAP contract (${TRUSTSWAP_CONTRACT})`);
    log(`⚡ UNLIMITED APPROVALS - One-time setup, saves gas forever`);
    log(`⚡ SIMPLIFIED APPROACH - Following sellbot pattern`);

    const approvalPromises = wallets.map(async (wallet, index) => {
      const walletName = wallet.name || `B${index + 1}`;
      let attempt = 0;

      while (true) {
        attempt++;
        try {
          log(`🔓 Wallet ${walletName} (${wallet.address.slice(0, 8)}): TRUSTSWAP approval attempt ${attempt}`);
          
          // Simple gas settings (following sellbot pattern)
          const gasPrice = ethers.parseUnits('0.02', 'gwei');
          
          // Create token contract
          const tokenContract = new ethers.Contract(tokenCA, ERC20_ABI, wallet);
          
          // Check current allowance first for TRUSTSWAP contract with robust provider handling
          const allowanceCheckResult = await ApprovalManager.checkApprovalStatus(tokenCA, wallet, TRUSTSWAP_CONTRACT);
          
          if (!allowanceCheckResult.error && allowanceCheckResult.hasApproval) {
            log(`✅ Wallet ${walletName}: Already has UNLIMITED TRUSTSWAP allowance (${allowanceCheckResult.allowance.toString()})`);
            return { success: true, walletName, attempt: 0, alreadyApproved: true };
          } else if (allowanceCheckResult.error) {
            log(`⚠️  Wallet ${walletName}: Allowance check failed (${allowanceCheckResult.error}), proceeding with approval`);
          } else {
            log(`🔄 Wallet ${walletName}: Current allowance: ${allowanceCheckResult.allowance.toString()}, needs approval`);
          }

          // Execute UNLIMITED approval transaction for TRUSTSWAP with RPC provider rotation
          const approvalResult = await executeTransactionWithReplacementFee(
            async (currentProvider, gasParams) => {
              log(`Wallet ${walletName}: TRUSTSWAP approval - attempting with provider ${currentProvider._providerName}`);
              
              const walletWithProvider = wallet.connect(currentProvider);
              const tokenContractWithProvider = tokenContract.connect(walletWithProvider);
              
              const approveTx = await tokenContractWithProvider.approve(TRUSTSWAP_CONTRACT, ethers.MaxUint256, {
                maxFeePerGas: gasParams.maxFeePerGas,
                maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
                gasLimit: APPROVAL_GAS_LIMIT
              });
              
              log(`Wallet ${walletName}: TRUSTSWAP approval transaction broadcasted via ${currentProvider._providerName}: ${approveTx.hash}`);
              return approveTx;
            }
          );

          console.log(`   🔧 RPC USED: ${approvalResult.provider} for wallet ${walletName} TRUSTSWAP approval`);
          log(`✅ Wallet ${walletName}: UNLIMITED TRUSTSWAP approval confirmed! Hash: ${approvalResult.hash}`);
          return { 
            success: true, 
            walletName, 
            attempt, 
            txHash: approvalResult.hash, 
            rpcProvider: approvalResult.provider 
          };

        } catch (error) {
          log(`❌ Wallet ${walletName}: TRUSTSWAP approval attempt ${attempt} failed: ${error.message}`);
          
          // Add more specific error handling
          if (error.message.includes('insufficient funds')) {
            log(`💰 Wallet ${walletName}: Insufficient ETH for gas - skipping this wallet`);
            return { 
              success: false, 
              walletName, 
              error: 'Insufficient ETH for gas', 
              skip: true 
            };
          }
          
          if (error.message.includes('nonce')) {
            log(`🔄 Wallet ${walletName}: Nonce issue, waiting 2 seconds before retry...`);
            await sleep(2000);
          } else {
            log(`🔄 Wallet ${walletName}: Retrying in 3 seconds...`);
            await sleep(3000);
          }
          // Continue infinite loop
        }
      }
    });

    const results = await Promise.all(approvalPromises);
    
    const successful = results.filter(r => r.success).length;
    const skipped = results.filter(r => r.skip).length;
    
    log(`\n✅ PARALLEL TRUSTSWAP APPROVALS COMPLETED: ${successful}/${wallets.length} selected wallets approved`);
    if (skipped > 0) {
      log(`⚠️  ${skipped} selected wallets skipped due to insufficient ETH`);
    }
    
    return results;
  }

  /**
   * Check approval status for a wallet with multiple provider fallback
   * @param {string} tokenCA - Token contract address
   * @param {Object} wallet - Wallet instance
   * @param {string} spender - Spender address (usually TRUSTSWAP)
   * @returns {Promise<{hasApproval: boolean, allowance: bigint, error?: string}>}
   */
  static async checkApprovalStatus(tokenCA, wallet, spender = TRUSTSWAP_CONTRACT) {
    
    // Try with 3 different providers for reliability
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const provider = getRandomProvider();
        const walletWithProvider = wallet.connect(provider);
        const tokenContract = new ethers.Contract(tokenCA, ERC20_ABI, walletWithProvider);
        
        // Set a 5-second timeout for the allowance call
        const allowancePromise = tokenContract.allowance(wallet.address, spender);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Allowance check timeout')), 5000)
        );
        
        const allowance = await Promise.race([allowancePromise, timeoutPromise]);
        const maxUint256 = ethers.MaxUint256;
        
        return {
          hasApproval: allowance >= maxUint256 / 2n,
          allowance: allowance
        };
        
      } catch (error) {
        if (attempt === 3) {
          // Final attempt failed
          return {
            hasApproval: false,
            allowance: 0n,
            error: `All providers failed: ${error.message}`
          };
        }
        // Try next provider
        await sleep(1000);
      }
    }
  }
} 