import readline from 'readline';
import { ethers } from 'ethers';
import { scanTickerForPools } from './src/tickerScanner.js';
import { log } from './src/utils.js';
import { tradingWallets } from './src/wallets.js';
import { provider } from './src/config.js';
import { BuyBot } from './bots/buy-bot.js';
import { SellBot } from './bots/sell-bot.js';
import { FarmBot } from './bots/farm-bot.js';

// Hard coded VIRTUAL token address
const VIRTUAL_CA = '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b';

// Default settings
const DEFAULT_SETTINGS = {
  NUM_LOOPS: Infinity,
  VIRTUAL_AMOUNT_MIN_PERCENT: 0.1, // 0.1% of balance
  VIRTUAL_AMOUNT_MAX_PERCENT: 1.0, // 1% of balance  
  MAX_SLIPPAGE_PERCENT: 10,
  LOOP_DELAY_MIN: 1,
  LOOP_DELAY_MAX: 2,
  DELAY_BETWEEN_TXS_MIN: 30,
  DELAY_BETWEEN_TXS_MAX: 90
};

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper function to ask questions
function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

// Get VIRTUAL balance of wallet
async function getVirtualBalance(wallet) {
  const virtualContract = new ethers.Contract(
    VIRTUAL_CA, 
    ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'], 
    provider
  );
  
  const balance = await virtualContract.balanceOf(wallet.address);
  const decimals = await virtualContract.decimals();
  return parseFloat(ethers.formatUnits(balance, decimals));
}

// Get token balance of wallet
async function getTokenBalance(wallet, tokenCA) {
  const tokenContract = new ethers.Contract(
    tokenCA, 
    ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'], 
    provider
  );
  
  const balance = await tokenContract.balanceOf(wallet.address);
  const decimals = await tokenContract.decimals();
  return { balance: parseFloat(ethers.formatUnits(balance, decimals)), decimals };
}

// Display bot information
function displayBotInfo() {
  console.clear();
  console.log('🤖 VIRTUAL TRADING BOT v2.0');
  console.log('===============================');
  console.log(`💰 Base Currency: VIRTUAL`);
  console.log(`📍 VIRTUAL CA: ${VIRTUAL_CA}`);
  console.log(`🔗 Network: Base`);
  console.log(`👛 Trading Wallets: ${tradingWallets.length}`);
  console.log('');
  console.log('📊 DEFAULT SETTINGS:');
  console.log(`   NUM_LOOPS: ${DEFAULT_SETTINGS.NUM_LOOPS === Infinity ? 'infinity' : DEFAULT_SETTINGS.NUM_LOOPS}`);
  console.log(`   VIRTUAL_AMOUNT_MIN: ${DEFAULT_SETTINGS.VIRTUAL_AMOUNT_MIN_PERCENT}% of balance`);
  console.log(`   VIRTUAL_AMOUNT_MAX: ${DEFAULT_SETTINGS.VIRTUAL_AMOUNT_MAX_PERCENT}% of balance`);
  console.log(`   MAX_SLIPPAGE_PERCENT: ${DEFAULT_SETTINGS.MAX_SLIPPAGE_PERCENT}%`);
  console.log(`   LOOP_DELAY: ${DEFAULT_SETTINGS.LOOP_DELAY_MIN}-${DEFAULT_SETTINGS.LOOP_DELAY_MAX}s`);
  console.log(`   DELAY_BETWEEN_TXS: ${DEFAULT_SETTINGS.DELAY_BETWEEN_TXS_MIN}-${DEFAULT_SETTINGS.DELAY_BETWEEN_TXS_MAX}s`);
  console.log('');
}

// Get token info from user
async function getTokenInfo() {
  const tokenCA = await askQuestion('Enter token contract address: ');
  
  if (!tokenCA || !tokenCA.startsWith('0x') || tokenCA.length !== 42) {
    console.log('❌ Invalid contract address!');
    return null;
  }
  
  console.log('\n🔍 Scanning for pools...');
  
  try {
    // Get token metadata
    const tokenContract = new ethers.Contract(
      tokenCA, 
      ['function symbol() view returns (string)', 'function name() view returns (string)', 'function decimals() view returns (uint8)'], 
      provider
    );
    
    const [symbol, name, decimals] = await Promise.all([
      tokenContract.symbol(),
      tokenContract.name(), 
      tokenContract.decimals()
    ]);
    
    // Find pool using ticker scanner
    const results = await scanTickerForPools(symbol);
    
    if (results.length === 0) {
      console.log(`❌ No pools found for ${symbol} vs VIRTUAL`);
      return null;
    }
    
    // Find matching result
    const matchingResult = results.find(r => r.address.toLowerCase() === tokenCA.toLowerCase());
    
    if (!matchingResult) {
      console.log(`❌ No pool found for this specific contract address vs VIRTUAL`);
      return null;
    }
    
    console.log('\n✅ Token and Pool Found:');
    console.log(`   Token: ${symbol} (${name})`);
    console.log(`   Contract: ${tokenCA}`);
    console.log(`   Pool: ${matchingResult.poolInfo.pairAddress}`);
    console.log(`   Decimals: ${decimals}`);
    
    return {
      symbol,
      name,
      address: tokenCA,
      decimals: decimals,
      poolAddress: matchingResult.poolInfo.pairAddress
    };
    
  } catch (error) {
    console.log(`❌ Error getting token info: ${error.message}`);
    return null;
  }
}

// Check wallet balances
async function checkWalletBalances(tokenInfo = null) {
  console.log('\n💰 WALLET BALANCES:');
  console.log('==================');
  console.log('🚀 Checking all wallet balances in parallel...');
  
  const balancePromises = tradingWallets.map(async (wallet, i) => {
    try {
      // Get VIRTUAL balance
      const virtualBalance = await getVirtualBalance(wallet);
      
      let tokenBalance = null;
      // Get token balance if token info provided
      if (tokenInfo) {
        tokenBalance = await getTokenBalance(wallet, tokenInfo.address);
      }
      
      return {
        index: i + 1,
        address: wallet.address,
        virtualBalance,
        tokenBalance,
        error: null
      };
    } catch (error) {
      return {
        index: i + 1,
        address: wallet.address,
        virtualBalance: null,
        tokenBalance: null,
        error: error.message
      };
    }
  });
  
  const results = await Promise.all(balancePromises);
  
  // Display results
  results.forEach(result => {
    console.log(`\n👛 Wallet ${result.index}: ${result.address.slice(0, 8)}...${result.address.slice(-6)}`);
    
    if (result.error) {
      console.log(`   ❌ Error getting balances: ${result.error}`);
    } else {
      console.log(`   VIRTUAL: ${result.virtualBalance.toFixed(4)}`);
      
      if (result.tokenBalance && tokenInfo) {
        console.log(`   ${tokenInfo.symbol}: ${result.tokenBalance.balance.toFixed(4)}`);
      }
    }
  });
}

// Main menu
async function showMainMenu() {
  console.log('\n🎯 SELECT BOT TYPE:');
  console.log('==================');
  console.log('1. 🟢 BuyBot  - Buy tokens with VIRTUAL');
  console.log('2. 🔴 SellBot - Sell tokens for VIRTUAL'); 
  console.log('3. 🔄 FarmBot - Volume farming (simultaneous buy/sell)');
  console.log('4. 💰 Check Balances');
  console.log('5. 🚪 Exit');
  
  const choice = await askQuestion('\nChoose option (1-5): ');
  return choice;
}

// Start the bot
async function startBot() {
  displayBotInfo();
  
  try {
    while (true) {
      const choice = await showMainMenu();
      
      switch (choice) {
        case '1':
          console.log('\n🟢 STARTING BUYBOT...');
          const tokenInfoBuy = await getTokenInfo();
          if (tokenInfoBuy) {
            await checkWalletBalances(tokenInfoBuy);
            const buyBot = new BuyBot(tradingWallets, tokenInfoBuy, VIRTUAL_CA, DEFAULT_SETTINGS);
            await buyBot.start();
          }
          break;
          
        case '2':
          console.log('\n🔴 STARTING SELLBOT...');
          const tokenInfoSell = await getTokenInfo();
          if (tokenInfoSell) {
            await checkWalletBalances(tokenInfoSell);
            const sellBot = new SellBot(tradingWallets, tokenInfoSell, VIRTUAL_CA, DEFAULT_SETTINGS);
            await sellBot.start();
          }
          break;
          
        case '3':
          console.log('\n🔄 STARTING FARMBOT...');
          const tokenInfoFarm = await getTokenInfo();
          if (tokenInfoFarm) {
            await checkWalletBalances(tokenInfoFarm);
            const farmBot = new FarmBot(tradingWallets, tokenInfoFarm, VIRTUAL_CA, DEFAULT_SETTINGS);
            await farmBot.start();
          }
          break;
          
        case '4':
          await checkWalletBalances();
          break;
          
        case '5':
          console.log('\n👋 Goodbye!');
          rl.close();
          process.exit(0);
          break;
          
        default:
          console.log('\n❌ Invalid choice! Please select 1-5.');
          break;
      }
      
      if (choice !== '4') {
        await askQuestion('\nPress Enter to continue...');
      }
    }
    
  } catch (error) {
    console.log(`\n❌ Fatal error: ${error.message}`);
    rl.close();
    process.exit(1);
  }
}

// Start the application
startBot(); 