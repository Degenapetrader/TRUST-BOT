async function searchGenesisAddress(symbol) {
    try {
      const url = new URL('https://api2.virtuals.io/api/geneses');
      url.searchParams.append('pagination[page]', '1');
      url.searchParams.append('pagination[pageSize]', '10000');
      url.searchParams.append('filters[virtual][priority][$ne]', '-1');
  
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
  
      const data = await response.json();
      const genesisData = data.data;
      const match = genesisData.find(item => item.virtual.symbol === symbol.toUpperCase());
  
      if (match) {
        console.log(`Genesis Address for ${symbol}: ${match.genesisAddress}`);
        return match.genesisAddress;
      } else {
        console.log(`No genesis found for symbol: ${symbol}`);
        return null;
      }
    } catch (error) {
      console.error('Error fetching genesis data:', error.message);
      process.exit(1);
    }
  }
  
  async function searchUnlockDate(symbol) {
    try {
      const url = new URL('https://api2.virtuals.io/api/virtuals');
      url.searchParams.append('filters[status]', '2');
      url.searchParams.append('sort[0]', 'lpCreatedAt:desc');
      url.searchParams.append('sort[1]', 'createdAt:desc');
      url.searchParams.append('populate[0]', 'image');
      url.searchParams.append('populate[1]', 'genesis');
      url.searchParams.append('populate[2]', 'creator');
      url.searchParams.append('pagination[page]', '1');
      url.searchParams.append('pagination[pageSize]', '10000');
      url.searchParams.append('isGrouped', '1');
      url.searchParams.append('noCache', '0');
  
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
  
      const data = await response.json();
      const virtualData = data.data;
      const match = virtualData.find(item => item.symbol === symbol.toUpperCase());
  
      if (match && match.tokenomics && match.tokenomics.length > 0) {
        // Find the nearest startsAt date (past or future)
        const allDates = match.tokenomics.map(tokenomic => new Date(tokenomic.startsAt));
        const nearestDate = new Date(Math.min(...allDates));
  
        // Format nearest unlock date
        const formattedNearestDate = `${(nearestDate.getUTCMonth() + 1).toString().padStart(2, '0')}/${nearestDate.getUTCDate().toString().padStart(2, '0')}/${nearestDate.getUTCFullYear()} - ${nearestDate.getUTCHours().toString().padStart(2, '0')}:${nearestDate.getUTCMinutes().toString().padStart(2, '0')}:${nearestDate.getUTCSeconds().toString().padStart(2, '0')} UTC`;
        console.log(`Nearest unlock date for ${symbol}: ${formattedNearestDate}`);
  
        // Calculate Yellow Lock date (subtract 7 days)
        const yellowLockDate = new Date(nearestDate);
        yellowLockDate.setUTCDate(yellowLockDate.getUTCDate() - 7);
  
        // Format Yellow Lock date
        const formattedYellowLockDate = `${(yellowLockDate.getUTCMonth() + 1).toString().padStart(2, '0')}/${yellowLockDate.getUTCDate().toString().padStart(2, '0')}/${yellowLockDate.getUTCFullYear()} - ${yellowLockDate.getUTCHours().toString().padStart(2, '0')}:${yellowLockDate.getUTCMinutes().toString().padStart(2, '0')}:${yellowLockDate.getUTCSeconds().toString().padStart(2, '0')} UTC`;
        console.log(`Yellow Lock for ${symbol}: ${formattedYellowLockDate}`);
  
        return { nearestDate: formattedNearestDate, yellowLockDate: formattedYellowLockDate };
      } else {
        console.log(`No tokenomics data found for symbol: ${symbol}`);
        return null;
      }
    } catch (error) {
      console.error('Error fetching unlock data:', error.message);
      process.exit(1);
    }
  }
  
  async function searchTickerByGenesis(genesisAddress) {
    try {
      const url = new URL('https://api2.virtuals.io/api/geneses');
      url.searchParams.append('pagination[page]', '1');
      url.searchParams.append('pagination[pageSize]', '10000');
      url.searchParams.append('filters[virtual][priority][$ne]', '-1');
  
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
  
      const data = await response.json();
      const genesisData = data.data;
      
      // Normalize genesis address for comparison (remove 0x prefix, convert to lowercase)
      const normalizedInput = genesisAddress.toLowerCase().replace('0x', '');
      
      const match = genesisData.find(item => {
        if (item.genesisAddress) {
          const normalizedGenesis = item.genesisAddress.toLowerCase().replace('0x', '');
          return normalizedGenesis === normalizedInput;
        }
        return false;
      });
  
      if (match) {
        console.log(`🎯 Ticker Symbol for Genesis ${genesisAddress}:`);
        console.log(`   Symbol: ${match.virtual.symbol}`);
        console.log(`   Name: ${match.virtual.name || 'N/A'}`);
        console.log(`   Genesis: ${match.genesisAddress}`);
        if (match.virtual.tokenAddress) {
          console.log(`   Token Address: ${match.virtual.tokenAddress}`);
        }
        return {
          symbol: match.virtual.symbol,
          name: match.virtual.name,
          genesisAddress: match.genesisAddress,
          tokenAddress: match.virtual.tokenAddress
        };
      } else {
        console.log(`❌ No ticker found for genesis address: ${genesisAddress}`);
        return null;
      }
    } catch (error) {
      console.error('Error fetching genesis data:', error.message);
      process.exit(1);
    }
  }
  
  // Show help function
  function showHelp() {
    console.log(`
🔍 GENESIS RESEARCH TOOLS - Available Commands:

📋 SEARCH BY SYMBOL (Symbol → Genesis Address):
   npm run genesis:search <SYMBOL>
   Example: npm run genesis:search VIRTUAL

📅 UNLOCK DATES (Symbol → Tokenomics Schedule):
   npm run genesis:unlock <SYMBOL>
   Example: npm run genesis:unlock VIRTUAL

🔄 REVERSE LOOKUP (Genesis Address → Ticker):
   npm run genesis:ticker <GENESIS_ADDRESS>
   Example: npm run genesis:ticker 0x1234567890abcdef...

💡 TIP: Use genesis:search to find an address, then genesis:ticker to verify it!
    `);
  }
  
  // Determine which command was run
  const command = process.env.npm_lifecycle_event;
  const inputParam = process.argv[2];
  
  if (!inputParam) {
    console.error('❌ Missing parameter!');
    showHelp();
    process.exit(1);
  }
  
  if (command === 'genesis:search') {
    searchGenesisAddress(inputParam);
  } else if (command === 'genesis:unlock') {
    searchUnlockDate(inputParam);
  } else if (command === 'genesis:ticker') {
    searchTickerByGenesis(inputParam);
  } else {
    console.error('❌ Unknown command!');
    showHelp();
    process.exit(1);
  }