import { fetchAllVirtuals } from './ticker-fetchAll.js';
import { createExcelFile } from './ticker-exportSheet.js';

async function runAll() {
    try {
        console.log('🚀 TICKER DATA MANAGEMENT - RUN ALL');
        console.log('====================================');
        console.log('📊 This will fetch all Virtual tokens data and export to Excel');
        console.log('🔗 Chains: BASE, ETH, SOLANA');
        console.log('📁 Output: base.json, eth.json, sol.json + Excel export');
        console.log('');
        
        console.log('📡 Step 1: Fetching all virtual tokens data...');
        const startTime = Date.now();
        await fetchAllVirtuals();
        const fetchTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ Data fetch completed in ${fetchTime}s`);
        console.log('');
        
        console.log('📊 Step 2: Creating Excel export...');
        const exportStartTime = Date.now();
        await createExcelFile();
        const exportTime = ((Date.now() - exportStartTime) / 1000).toFixed(2);
        console.log(`✅ Excel export completed in ${exportTime}s`);
        
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log('');
        console.log('🎉 ALL OPERATIONS COMPLETED SUCCESSFULLY!');
        console.log(`⏱️ Total time: ${totalTime}s`);
        console.log('');
        console.log('📝 Available commands:');
        console.log('  • npm run ticker:search <TICKER>     - Search by ticker symbol');
        console.log('  • npm run ticker:search <0x...>      - Search by contract address');
        console.log('  • npm run ticker:fetchAll            - Fetch all tokens data');
        console.log('  • npm run ticker:export              - Export to Excel');
        console.log('  • npm run ticker:runAll              - Run fetch + export');
        
    } catch (error) {
        console.error('❌ Error during execution:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Show startup banner
console.log('🔄 Starting ticker data management operations...');
runAll(); 