/**
 * Gas Helper with Bot-Specific Multipliers
 * Fetches dynamic gas prices and applies appropriate multipliers
 * All bots get 2x gas except JeetBot (3x for turbo mode)
 * Priority fee is 50% of base fee
 */

// Import ipcRenderer at the top level

/**
 * Get current gas price for a specific bot type
 * @param {string} botType - The bot type (buybot, sellbot, jeetbot, etc.)
 * @returns {Promise<string>} Gas price in gwei (total including priority fee)
 */
async function getCurrentGasPrice(botType = 'default') {
    // Test message to verify function is being called
    const testMsg = ` Gas helper called for ${botType.toUpperCase()}`;
    console.log(testMsg);
    if (typeof window !== 'undefined' && window.addConsoleMessage) {
        window.addConsoleMessage(testMsg, 'info');
    }
    
    try {
        console.log(' Making IPC call to get-current-gas-price...');
        
        // Use the existing IPC handler to get gas price from backend
        const result = await require('electron').ipcRenderer.invoke('get-current-gas-price');
        
        console.log(' IPC result:', JSON.stringify(result, null, 2));
        
        if (result.success && result.data) {
            console.log(' Raw backend data:', JSON.stringify(result.data, null, 2));
            
            const networkBaseGas = parseFloat(result.data.baseGasPrice);
            console.log(' Parsed networkBaseGas:', networkBaseGas);
            
            // Apply bot-specific multiplier to base gas
            let multiplier = 2; // Default 2x for all bots
            if (botType === 'jeetbot') {
                multiplier = 3; // JeetBot uses 3x (turbo mode - faster than others)
            }
            
            const adjustedBaseGas = networkBaseGas * multiplier;
            const priorityFee = adjustedBaseGas * 0.5; // 50% of adjusted base
            const totalGasPrice = (adjustedBaseGas + priorityFee).toFixed(6);
            
            // Use both console.log and addConsoleMessage for visibility
            const logMessage = ` ${botType.toUpperCase()}: Network ${networkBaseGas} × ${multiplier} = ${adjustedBaseGas.toFixed(6)} base + ${priorityFee.toFixed(6)} priority = ${totalGasPrice} total`;
            console.log(logMessage);
            
            // Also add to in-app console if available
            if (typeof window !== 'undefined' && window.addConsoleMessage) {
                window.addConsoleMessage(logMessage, 'info');
            }
            
            console.log(` RETURNING GAS PRICE: ${totalGasPrice}`);
            return totalGasPrice;
        } else {
            const errorMsg = ` Gas service returned unsuccessful result: ${JSON.stringify(result)}`;
            console.log(errorMsg);
            if (typeof window !== 'undefined' && window.addConsoleMessage) {
                window.addConsoleMessage(errorMsg, 'warning');
            }
        }
    } catch (error) {
        const errorMsg = ` Gas service failed: ${error.message}`;
        console.log(errorMsg);
        if (typeof window !== 'undefined' && window.addConsoleMessage) {
            window.addConsoleMessage(errorMsg, 'error');
        }
    }
    
    // Fallback to default gas price with multiplier
    console.log(' Using fallback gas calculation...');
    const baseFallback = 0.02;
    let multiplier = 2;
    if (botType === 'jeetbot') {
        multiplier = 3;
    }
    
    const adjustedBaseGas = baseFallback * multiplier;
    const priorityFee = adjustedBaseGas * 0.5; // 50% of adjusted base
    const totalFallbackGas = (adjustedBaseGas + priorityFee).toFixed(6);
    
    const fallbackMsg = ` ${botType.toUpperCase()}: Fallback ${baseFallback} × ${multiplier} = ${adjustedBaseGas.toFixed(6)} base + ${priorityFee.toFixed(6)} priority = ${totalFallbackGas} total`;
    console.log(fallbackMsg);
    if (typeof window !== 'undefined' && window.addConsoleMessage) {
        window.addConsoleMessage(fallbackMsg, 'info');
    }
    
    console.log(` RETURNING FALLBACK GAS PRICE: ${totalFallbackGas}`);
    return totalFallbackGas;
}

// Make available globally for renderer
if (typeof window !== 'undefined') {
    window.getCurrentGasPrice = getCurrentGasPrice;
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getCurrentGasPrice };
}
