import { ethers } from 'ethers';
import { provider, VIRTUAL_TOKEN_ADDRESS } from './config.js';

// Standard ERC20 ABI for balance checking
const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)'
];

// Get VIRTUAL balance for a wallet
export async function getVirtualBalance(wallet) {
  try {
    const virtualContract = new ethers.Contract(VIRTUAL_TOKEN_ADDRESS, ERC20_ABI, provider);
    const balance = await virtualContract.balanceOf(wallet.address);
    return parseFloat(ethers.formatUnits(balance, 18)); // VIRTUAL has 18 decimals
  } catch (error) {
    console.log(`⚠️ Error getting VIRTUAL balance for ${wallet.address}: ${error.message}`);
    return 0;
  }
}

// Get token balance for a wallet
export async function getTokenBalance(wallet, tokenAddress, decimals = 18) {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const balance = await tokenContract.balanceOf(wallet.address);
    return parseFloat(ethers.formatUnits(balance, decimals));
  } catch (error) {
    console.log(`⚠️ Error getting token balance for ${wallet.address}: ${error.message}`);
    return 0;
  }
}

// Get token info (symbol and decimals)
export async function getTokenInfo(tokenAddress) {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [symbol, decimals] = await Promise.all([
      tokenContract.symbol(),
      tokenContract.decimals()
    ]);
    return { symbol, decimals };
  } catch (error) {
    console.log(`⚠️ Error getting token info for ${tokenAddress}: ${error.message}`);
    return { symbol: 'UNKNOWN', decimals: 18 };
  }
}

// Take snapshot of all wallet balances before operation
export async function takeBalanceSnapshot(wallets, tokenAddresses = []) {
  console.log('📸 Taking balance snapshot...');
  const snapshot = {
    timestamp: Date.now(),
    wallets: {}
  };

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const walletKey = `W${i + 1}`;
    
    snapshot.wallets[walletKey] = {
      address: wallet.address,
      virtual: await getVirtualBalance(wallet),
      tokens: {}
    };

    // Get balances for all specified tokens
    for (const tokenAddress of tokenAddresses) {
      if (tokenAddress && tokenAddress !== VIRTUAL_TOKEN_ADDRESS) {
        const tokenInfo = await getTokenInfo(tokenAddress);
        const balance = await getTokenBalance(wallet, tokenAddress, tokenInfo.decimals);
        snapshot.wallets[walletKey].tokens[tokenAddress] = {
          symbol: tokenInfo.symbol,
          decimals: tokenInfo.decimals,
          balance: balance
        };
      }
    }
  }

  return snapshot;
}

// Calculate balance differences between two snapshots
export function calculateBalanceDifferences(beforeSnapshot, afterSnapshot) {
  const differences = {
    wallets: {},
    totals: {
      virtual: { spent: 0, received: 0, net: 0 },
      tokens: {}
    }
  };

  // Calculate per-wallet differences
  Object.keys(beforeSnapshot.wallets).forEach(walletKey => {
    const before = beforeSnapshot.wallets[walletKey];
    const after = afterSnapshot.wallets[walletKey];

    if (!after) return;

    // VIRTUAL difference
    const virtualDiff = after.virtual - before.virtual;
    
    differences.wallets[walletKey] = {
      address: before.address,
      virtual: {
        before: before.virtual,
        after: after.virtual,
        difference: virtualDiff,
        spent: virtualDiff < 0 ? Math.abs(virtualDiff) : 0,
        received: virtualDiff > 0 ? virtualDiff : 0
      },
      tokens: {}
    };

    // Update totals for VIRTUAL
    if (virtualDiff < 0) {
      differences.totals.virtual.spent += Math.abs(virtualDiff);
    } else if (virtualDiff > 0) {
      differences.totals.virtual.received += virtualDiff;
    }

    // Token differences
    Object.keys(before.tokens).forEach(tokenAddress => {
      const beforeToken = before.tokens[tokenAddress];
      const afterToken = after.tokens[tokenAddress];

      if (!afterToken) return;

      const tokenDiff = afterToken.balance - beforeToken.balance;
      
      differences.wallets[walletKey].tokens[tokenAddress] = {
        symbol: beforeToken.symbol,
        before: beforeToken.balance,
        after: afterToken.balance,
        difference: tokenDiff,
        spent: tokenDiff < 0 ? Math.abs(tokenDiff) : 0,
        received: tokenDiff > 0 ? tokenDiff : 0
      };

      // Update totals for this token
      if (!differences.totals.tokens[tokenAddress]) {
        differences.totals.tokens[tokenAddress] = {
          symbol: beforeToken.symbol,
          spent: 0,
          received: 0,
          net: 0
        };
      }

      if (tokenDiff < 0) {
        differences.totals.tokens[tokenAddress].spent += Math.abs(tokenDiff);
      } else if (tokenDiff > 0) {
        differences.totals.tokens[tokenAddress].received += tokenDiff;
      }
    });
  });

  // Calculate net totals
  differences.totals.virtual.net = differences.totals.virtual.received - differences.totals.virtual.spent;
  
  Object.keys(differences.totals.tokens).forEach(tokenAddress => {
    const token = differences.totals.tokens[tokenAddress];
    token.net = token.received - token.spent;
  });

  return differences;
}

// Display comprehensive balance summary
export function displayBalanceSummary(differences, operationName = 'OPERATION') {
  console.log(`\n💰 ==================== ${operationName} BALANCE SUMMARY ====================`);
  
  const walletKeys = Object.keys(differences.wallets).sort((a, b) => {
    const aNum = parseInt(a.replace('W', ''));
    const bNum = parseInt(b.replace('W', ''));
    return aNum - bNum;
  });

  // Per-wallet breakdown
  console.log('\n📋 PER-WALLET BREAKDOWN:');
  walletKeys.forEach(walletKey => {
    const wallet = differences.wallets[walletKey];
    console.log(`\n🤖 ${walletKey} (${wallet.address.slice(0, 8)}...):`);
    
    // VIRTUAL
    const virtual = wallet.virtual;
    if (virtual.spent > 0) {
      console.log(`   💸 VIRTUAL Spent: ${virtual.spent.toFixed(4)}`);
    }
    if (virtual.received > 0) {
      console.log(`   💰 VIRTUAL Received: ${virtual.received.toFixed(4)}`);
    }
    if (virtual.difference !== 0) {
      const direction = virtual.difference > 0 ? '+' : '';
      console.log(`   📊 VIRTUAL Net: ${direction}${virtual.difference.toFixed(4)}`);
    }

    // Tokens
    Object.keys(wallet.tokens).forEach(tokenAddress => {
      const token = wallet.tokens[tokenAddress];
      if (token.spent > 0) {
        console.log(`   💸 ${token.symbol} Spent: ${token.spent.toFixed(4)}`);
      }
      if (token.received > 0) {
        console.log(`   💰 ${token.symbol} Received: ${token.received.toFixed(4)}`);
      }
      if (token.difference !== 0) {
        const direction = token.difference > 0 ? '+' : '';
        console.log(`   📊 ${token.symbol} Net: ${direction}${token.difference.toFixed(4)}`);
      }
    });
  });

  // Totals summary
  console.log('\n📊 OVERALL TOTALS:');
  
  // VIRTUAL totals
  if (differences.totals.virtual.spent > 0 || differences.totals.virtual.received > 0) {
    console.log('\n💎 VIRTUAL:');
    if (differences.totals.virtual.spent > 0) {
      console.log(`   💸 Total Spent: ${differences.totals.virtual.spent.toFixed(4)} VIRTUAL`);
    }
    if (differences.totals.virtual.received > 0) {
      console.log(`   💰 Total Received: ${differences.totals.virtual.received.toFixed(4)} VIRTUAL`);
    }
    const direction = differences.totals.virtual.net > 0 ? '+' : '';
    console.log(`   📊 Net Change: ${direction}${differences.totals.virtual.net.toFixed(4)} VIRTUAL`);
  }

  // Token totals
  Object.keys(differences.totals.tokens).forEach(tokenAddress => {
    const token = differences.totals.tokens[tokenAddress];
    console.log(`\n🪙 ${token.symbol}:`);
    if (token.spent > 0) {
      console.log(`   💸 Total Spent: ${token.spent.toFixed(4)} ${token.symbol}`);
    }
    if (token.received > 0) {
      console.log(`   💰 Total Received: ${token.received.toFixed(4)} ${token.symbol}`);
    }
    const direction = token.net > 0 ? '+' : '';
    console.log(`   📊 Net Change: ${direction}${token.net.toFixed(4)} ${token.symbol}`);
  });

  // Summary stats
  const totalWallets = walletKeys.length;
  const virtualSpentWallets = walletKeys.filter(k => differences.wallets[k].virtual.spent > 0).length;
  const virtualReceivedWallets = walletKeys.filter(k => differences.wallets[k].virtual.received > 0).length;

  console.log('\n📈 OPERATION STATISTICS:');
  console.log(`   👛 Total Wallets: ${totalWallets}`);
  console.log(`   💸 Wallets with VIRTUAL spent: ${virtualSpentWallets}`);
  console.log(`   💰 Wallets with VIRTUAL received: ${virtualReceivedWallets}`);
  
  // Token statistics
  Object.keys(differences.totals.tokens).forEach(tokenAddress => {
    const token = differences.totals.tokens[tokenAddress];
    const tokenSpentWallets = walletKeys.filter(k => 
      differences.wallets[k].tokens[tokenAddress]?.spent > 0
    ).length;
    const tokenReceivedWallets = walletKeys.filter(k => 
      differences.wallets[k].tokens[tokenAddress]?.received > 0
    ).length;
    
    console.log(`   💸 Wallets with ${token.symbol} spent: ${tokenSpentWallets}`);
    console.log(`   💰 Wallets with ${token.symbol} received: ${tokenReceivedWallets}`);
  });

  console.log(`💰 ============================================================`);
}

// Helper function to format address
export function formatAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Helper function to format amount with proper decimals
export function formatAmount(amount, decimals = 4) {
  if (amount === 0) return '0';
  if (amount < 0.0001 && amount > 0) return '< 0.0001';
  return amount.toFixed(decimals);
} 