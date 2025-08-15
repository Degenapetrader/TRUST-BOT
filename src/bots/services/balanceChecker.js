// Balance checker service for checking token balances

import { ethers } from 'ethers';
import { executeRpcWithFallback } from '../../config/index.js';
import { ERC20_ABI } from '../config/jeetConstants.js';
import { log } from '../../utils/logger.js';

export class BalanceChecker {
  /**
   * Check token balance in specific wallet
   * @param {Object} wallet - Wallet instance
   * @param {number} walletIndex - Wallet index
   * @param {string} tokenAddress - Token contract address
   * @returns {Promise<Object>} Balance check result
   */
  static async checkTokenInWallet(wallet, walletIndex, tokenAddress) {
    try {
      log(`🔍 Checking token balance in wallet B${walletIndex}...`);
      log(`👛 Wallet: ${wallet.address}`);
      log(`🎯 Token: ${tokenAddress}`);
      
      // Create token contract with better error handling
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
      
      // Get balance first (most important)
      const balance = await tokenContract.balanceOf(wallet.address);
      
      // Get token metadata with fallbacks
      let symbol = 'UNKNOWN';
      let name = 'Unknown Token';
      let decimals = 18;
      
      try {
        symbol = await tokenContract.symbol();
      } catch (error) {
        log(`   ⚠️ Could not get symbol: ${error.message}`);
      }
      
      try {
        name = await tokenContract.name();
      } catch (error) {
        log(`   ⚠️ Could not get name: ${error.message}`);
      }
      
      try {
        decimals = await tokenContract.decimals();
      } catch (error) {
        log(`   ⚠️ Could not get decimals, using 18: ${error.message}`);
      }
      
      const formattedBalance = ethers.formatUnits(balance, decimals);
      
      log(`\n📊 TOKEN INFORMATION:`);
      log(`   Symbol: ${symbol}`);
      log(`   Name: ${name}`);
      log(`   Contract: ${tokenAddress}`);
      log(`   Decimals: ${decimals}`);
      
      log(`\n💰 BALANCE RESULT:`);
      if (balance > 0n) {
        log(`   ✅ HAS TOKENS: ${formattedBalance} ${symbol}`);
        log(`   📊 Raw amount: ${balance.toString()} (${decimals} decimals)`);
        
        // Additional info if it's a significant amount
        if (parseFloat(formattedBalance) >= 100) {
          log(`   🎯 Status: SIGNIFICANT BALANCE (≥100)`);
        } else {
          log(`   ⚠️  Status: DUST AMOUNT (<100)`);
        }
      } else {
        log(`   ❌ NO TOKENS: 0 ${symbol}`);
        log(`   📊 Raw amount: 0`);
      }
      
      return {
        success: true,
        wallet: wallet.address,
        walletIndex: walletIndex,
        token: {
          address: tokenAddress,
          symbol: symbol,
          name: name,
          decimals: decimals
        },
        balance: {
          raw: balance.toString(),
          formatted: formattedBalance,
          hasTokens: balance > 0n
        }
      };
      
    } catch (error) {
      log(`❌ Error checking token balance: ${error.message}`);
      return {
        success: false,
        wallet: wallet.address,
        walletIndex: walletIndex,
        error: error.message
      };
    }
  }

  /**
   * Check all wallets for token balance
   * @param {Array} wallets - Array of wallet instances
   * @param {string} tokenAddress - Token contract address
   * @returns {Promise<Object>} All wallets check result
   */
  static async checkAllWalletsForToken(wallets, tokenAddress) {
    log(`\n💰 CHECKING ${wallets.length} SELECTED WALLETS FOR TOKEN...`);
    log(`🎯 Token: ${tokenAddress}`);
    
    const results = [];
    let walletsWithTokens = 0;
    let totalTokens = 0;
    
    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];
      const walletIndex = i + 1;
      
      log(`\n📋 Wallet ${walletIndex}/${wallets.length}: ${wallet.address}`);
      
      const result = await this.checkTokenInWallet(wallet, walletIndex, tokenAddress);
      results.push(result);
      
      if (result.success && result.balance.hasTokens) {
        walletsWithTokens++;
        totalTokens += parseFloat(result.balance.formatted);
      }
    }
    
    // Summary
    log(`\n📊 ALL WALLETS CHECK SUMMARY:`);
    log(`💰 Wallets with tokens: ${walletsWithTokens}/${wallets.length}`);
    log(`📈 Total tokens across all wallets: ${totalTokens.toFixed(6)}`);
    log(`📊 Success rate: ${((walletsWithTokens/wallets.length)*100).toFixed(1)}%`);
    
    // Show detailed results for wallets with tokens
    if (walletsWithTokens > 0) {
      log(`\n✅ WALLETS WITH TOKENS:`);
      results.forEach(result => {
        if (result.success && result.balance.hasTokens) {
          log(`   B${result.walletIndex}: ${result.balance.formatted} ${result.token.symbol}`);
        }
      });
    }
    
    // Show wallets without tokens
    const walletsWithoutTokens = results.filter(r => r.success && !r.balance.hasTokens);
    if (walletsWithoutTokens.length > 0) {
      log(`\n❌ WALLETS WITHOUT TOKENS:`);
      walletsWithoutTokens.forEach(result => {
        log(`   B${result.walletIndex}: 0 ${result.token.symbol}`);
      });
    }
    
    return {
      success: true,
      results: results,
      summary: {
        walletsWithTokens: walletsWithTokens,
        totalWallets: wallets.length,
        totalTokens: totalTokens,
        successRate: (walletsWithTokens/wallets.length)*100
      }
    };
  }

  /**
   * Get balance for multiple tokens in a wallet
   * @param {Object} wallet - Wallet instance
   * @param {Array<string>} tokenAddresses - Array of token addresses
   * @returns {Promise<Object>} Balance results for all tokens
   */
  static async getMultipleTokenBalances(wallet, tokenAddresses) {
    const balancePromises = tokenAddresses.map(async (tokenAddress) => {
      try {
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
        const [balance, symbol, decimals] = await Promise.all([
          tokenContract.balanceOf(wallet.address),
          tokenContract.symbol().catch(() => 'UNKNOWN'),
          tokenContract.decimals().catch(() => 18)
        ]);
        
        return {
          tokenAddress,
          symbol,
          balance: balance.toString(),
          formattedBalance: ethers.formatUnits(balance, decimals),
          decimals,
          hasTokens: balance > 0n
        };
      } catch (error) {
        return {
          tokenAddress,
          error: error.message,
          hasTokens: false
        };
      }
    });
    
    return await Promise.all(balancePromises);
  }
} 