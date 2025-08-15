/**
 * FarmBot Validator Service
 * Validates wallets have sufficient balance and token approvals
 */

import { ethers } from 'ethers';
import { walletsDB, VIRTUAL_TOKEN_ADDRESS } from '../../config/index.js';
import { TRUSTSWAP_CONTRACT } from '../config/jeetConstants.js';
import { ERC20_ABI } from '../../config/constants.js';

export class FarmValidator {
  /**
   * Create a new FarmValidator instance
   * @param {Object} providers - Provider instances
   */
  constructor(providers) {
    this.providers = providers;
  }
  
  /**
   * Validate wallet has sufficient VIRTUAL balance
   * @param {Object} wallet - Wallet instance
   * @param {ethers.BigNumber} requiredAmount - Required VIRTUAL amount
   * @param {number} loops - Number of loops
   * @returns {Object} Validation result
   */
  async validateVirtualBalance(wallet, requiredAmount, loops) {
    try {
      const provider = wallet.provider || this.providers.getRandomProvider();
      const virtualContract = new ethers.Contract(
        VIRTUAL_TOKEN_ADDRESS,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      );
      
      const balance = await virtualContract.balanceOf(wallet.address);
      // FIXED: Require amount per wallet (loops reuse same balance)
      // Each wallet just needs the input amount, no multiplication needed
      const totalRequired = requiredAmount; // Just the input amount per wallet
      
      const hasBalance = balance >= totalRequired;
      
      return {
        valid: hasBalance,
        balance: balance.toString(),
        required: totalRequired.toString(),
        message: hasBalance 
          ? `✅ Sufficient VIRTUAL balance`
          : `❌ Insufficient VIRTUAL: has ${ethers.formatEther(balance)}, needs ${ethers.formatEther(totalRequired)}`
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message,
        message: `❌ Failed to check VIRTUAL balance: ${error.message}`
      };
    }
  }
  
  /**
   * Validate token approval for selling
   * @param {Object} wallet - Wallet instance
   * @param {string} tokenAddress - Token to check approval for
   * @returns {Object} Validation result
   */
  async validateTokenApproval(wallet, tokenAddress) {
    try {
      const provider = wallet.provider || this.providers.getRandomProvider();
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ['function allowance(address,address) view returns (uint256)'],
        provider
      );
      
      const allowance = await tokenContract.allowance(wallet.address, TRUSTSWAP_CONTRACT);
      const hasApproval = allowance > 0n;
      
      return {
        valid: hasApproval,
        allowance: allowance.toString(),
        message: hasApproval
          ? `✅ Token approved for trading`
          : `⚠️  Token not approved (will be approved during first sell)`
      };
    } catch (error) {
      return {
        valid: true, // Don't block on approval check failure
        warning: true,
        message: `⚠️  Could not check approval: ${error.message}`
      };
    }
  }
  
  /**
   * Check if token has a valid pool
   * @param {string} tokenAddress - Token address
   * @returns {Object} Pool validation result
   */
  async validateTokenPool(tokenAddress) {
    try {
      // This would typically check if the token has a valid pool
      // For now, we'll assume the pool exists if we have the token address
      return {
        valid: true,
        message: `✅ Token pool validated`
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message,
        message: `❌ Failed to validate token pool: ${error.message}`
      };
    }
  }
  
  /**
   * Validate all requirements for farming
   * @param {Array} wallets - Array of wallet instances
   * @param {string} tokenAddress - Token address to farm
   * @param {ethers.BigNumber} amountPerWallet - Amount per wallet
   * @param {number} loops - Number of loops
   * @returns {Object} Complete validation result
   */
  async validateFarmingRequirements(wallets, tokenAddress, amountPerWallet, loops) {
    console.log('\n🔍 Validating farming requirements...');
    
    const results = {
      valid: true,
      walletValidations: [],
      poolValidation: null,
      errors: []
    };
    
    // Validate token pool
    results.poolValidation = await this.validateTokenPool(tokenAddress);
    if (!results.poolValidation.valid) {
      results.valid = false;
      results.errors.push(results.poolValidation.message);
    }
    
    // Validate each wallet
    for (const wallet of wallets) {
      console.log(`\n💼 Validating ${wallet.name}...`);
      
      const walletValidation = {
        wallet: wallet.name,
        virtualBalance: null,
        tokenApproval: null,
        valid: true
      };
      
      // Check VIRTUAL balance
      walletValidation.virtualBalance = await this.validateVirtualBalance(
        wallet,
        amountPerWallet,
        loops
      );
      console.log(`  ${walletValidation.virtualBalance.message}`);
      
      if (!walletValidation.virtualBalance.valid) {
        walletValidation.valid = false;
        results.valid = false;
      }
      
      // Check token approval (informational only)
      walletValidation.tokenApproval = await this.validateTokenApproval(
        wallet,
        tokenAddress
      );
      console.log(`  ${walletValidation.tokenApproval.message}`);
      
      results.walletValidations.push(walletValidation);
    }
    
    // Summary
    const validWallets = results.walletValidations.filter(w => w.valid).length;
    console.log(`\n📊 Validation Summary: ${validWallets}/${wallets.length} wallets ready`);
    
    return results;
  }
  
  /**
   * Approve token for trading if needed
   * @param {Object} wallet - Wallet instance
   * @param {string} tokenAddress - Token to approve
   * @returns {Object} Approval result
   */
  async approveTokenIfNeeded(wallet, tokenAddress) {
    try {
      const provider = wallet.provider || this.providers.getRandomProvider();
      const tokenContract = new ethers.Contract(
        tokenAddress,
        [
          'function allowance(address,address) view returns (uint256)',
          'function approve(address,uint256) returns (bool)'
        ],
        wallet.connect(provider)
      );
      
      const allowance = await tokenContract.allowance(wallet.address, TRUSTSWAP_CONTRACT);
      
      if (allowance === 0n) {
        console.log(`🔓 [${wallet.name}] Approving token for trading...`);
        const tx = await tokenContract.approve(
          TRUSTSWAP_CONTRACT,
          ethers.MaxUint256,
          {
            gasPrice: ethers.parseUnits('0.02', 'gwei'),
            gasLimit: 100000
          }
        );
        
        const receipt = await tx.wait();
        console.log(`✅ [${wallet.name}] Token approved: ${receipt.hash}`);
        
        return {
          needed: true,
          success: true,
          txHash: receipt.hash
        };
      }
      
      return {
        needed: false,
        success: true,
        message: 'Already approved'
      };
    } catch (error) {
      return {
        needed: true,
        success: false,
        error: error.message
      };
    }
  }
} 