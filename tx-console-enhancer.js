/**
 * Transaction Console Enhancer
 * Improves display of transaction information in the TRUSTBOT console
 */

// Register the transaction console enhancer when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    // Find the original console element
    const consoleElement = document.getElementById('console');
    if (!consoleElement) return;
    
    // Set up MutationObserver to detect new console messages
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('console-line')) {
                        enhanceConsoleMessage(node);
                    }
                });
            }
        });
    });
    
    // Configure and start observing
    observer.observe(consoleElement, { childList: true });
    
    // Also enhance any existing messages
    const existingMessages = consoleElement.querySelectorAll('.console-line');
    existingMessages.forEach(enhanceConsoleMessage);
});

/**
 * Enhances display of transaction-related console messages
 * @param {HTMLElement} lineElement - The console line element to enhance
 */
function enhanceConsoleMessage(lineElement) {
    const content = lineElement.textContent || '';
    
    // Check if this is a transaction-related message
    if (isTransactionRelated(content)) {
        // Add transaction-specific styling
        lineElement.classList.add('transaction-message');
        
        // Extract and highlight important transaction information
        const enhancedContent = formatTransactionContent(content);
        
        // Keep the timestamp but replace the rest
        const timestamp = lineElement.querySelector('.console-timestamp');
        if (timestamp) {
            const timestampHtml = timestamp.outerHTML;
            lineElement.innerHTML = timestampHtml + enhancedContent;
        } else {
            lineElement.innerHTML = enhancedContent;
        }
    }
}

/**
 * Checks if a message is related to transactions
 * @param {string} message - The message to check
 * @returns {boolean} - True if transaction-related
 */
function isTransactionRelated(message) {
    return (
        // Transaction execution and status indicators
        message.includes('Transaction execution') ||
        message.includes('Transaction hash:') ||
        message.includes('Success:') ||
        message.includes('Failed:') ||
        message.includes('Received:') ||
        message.includes('completed') ||
        message.includes('Confirmed') ||
        message.includes('PENDING') ||
        message.includes('CONFIRMED') ||
        message.includes('SUCCESSFUL') ||
        // Swap and trading information
        message.includes('Swapping') ||
        message.includes('Buying') ||
        message.includes('Selling') ||
        message.includes('tokens for') ||
        message.includes('ETH for') ||
        message.includes('EXECUTED TRADE') ||
        message.includes('Order placed') ||
        message.includes('Executed') ||
        // Loop and batch operations
        message.includes('LOOP') ||
        message.includes('loop') ||
        message.includes('Batch') ||
        // Gas and fee information
        message.includes('Gas price') ||
        message.includes('Tx Fee:')
    );
}

/**
 * Formats transaction-related content for better display
 * @param {string} content - The original content
 * @returns {string} - Enhanced HTML content
 */
function formatTransactionContent(content) {
    // Extract transaction hash if present
    let txHash = '';
    const txHashMatch = content.match(/(?:0x[a-fA-F0-9]{64})/);
    if (txHashMatch) {
        txHash = txHashMatch[0];
    }
    
    // Extract timestamp from the beginning if present
    let timestamp = '';
    const timestampMatch = content.match(/^\[([^\]]+)\]/);
    if (timestampMatch) {
        timestamp = timestampMatch[1];
        content = content.replace(/^\[[^\]]+\]\s*/, '');
    }
    
    // Clean the content but preserve important details
    content = content
        .replace(/[^\w\s\.\-\:\(\)\[\]\/\\%]/g, '') // Remove emojis and special chars
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
        
    // Format different types of messages
    if (content.includes('Transaction execution')) {
        // Extract status
        let status = 'PENDING';
        if (content.toLowerCase().includes('success')) status = 'SUCCESS';
        if (content.toLowerCase().includes('fail')) status = 'FAILED';
        
        return `<span class="tx-label tx-${status.toLowerCase()}">${status}</span> 
                <span class="tx-operation">Transaction Execution</span> 
                ${txHash ? `<span class="tx-hash">${txHash}</span>` : ''}`;
    }
    
    else if (content.includes('Swapping') || content.includes('Buying') || content.includes('Selling')) {
        // Extract token info if present
        const tokenMatch = content.match(/for ([\d\.]+) ([A-Za-z0-9]+)/i);
        const amountMatch = content.match(/([\d\.]+) tokens/i);
        
        let amountInfo = '';
        if (tokenMatch) {
            amountInfo = `${tokenMatch[1]} ${tokenMatch[2]}`;
        } else if (amountMatch) {
            amountInfo = `${amountMatch[1]}`;
        }
        
        return `<span class="tx-label tx-swap">SWAP</span> 
                <span class="tx-operation">${content}</span> 
                ${amountInfo ? `<span class="tx-amount">${amountInfo}</span>` : ''}`;
    }
    
    else if (content.includes('EXECUTED TRADE')) {
        return `<span class="tx-label tx-success">✓</span> 
                <span class="tx-operation">${content}</span> 
                ${txHash ? `<span class="tx-hash">${txHash}</span>` : ''}`;
    }
    
    else if (content.includes('LOOP') || content.includes('loop')) {
        // Extract loop number if present
        const loopMatch = content.match(/loop (\d+)/i);
        let loopNum = loopMatch ? loopMatch[1] : '';
        
        return `<span class="tx-label tx-loop">LOOP${loopNum ? ' '+loopNum : ''}</span> 
                <span class="tx-operation">${content}</span>`;
    }
    
    else {
        // Default formatting
        return `<span class="tx-operation">${content}</span>`;
    }
}

// Add transaction-specific styles
const txEnhancerStyles = document.createElement('style');
txEnhancerStyles.textContent = `
.transaction-message {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 4px;
    padding: 3px 0;
    border-bottom: 1px dotted rgba(255,255,255,0.1);
}

.tx-label {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 3px;
    margin-right: 8px;
    font-weight: bold;
    font-size: 0.85em;
    text-transform: uppercase;
}

.tx-success { background-color: #1a4731; color: #4ade80; }
.tx-pending { background-color: #854d0e; color: #fcd34d; }
.tx-failed { background-color: #7f1d1d; color: #f87171; }
.tx-swap { background-color: #312e81; color: #818cf8; }
.tx-loop { background-color: #4c1d95; color: #c4b5fd; }

.tx-operation {
    flex: 1;
    margin-right: 8px;
}

.tx-hash {
    font-family: monospace;
    font-size: 0.85em;
    color: #94a3b8;
    word-break: break-all;
}

.tx-amount {
    padding: 1px 4px;
    background-color: rgba(255,255,255,0.1);
    border-radius: 3px;
    margin-left: 4px;
}
`;

document.head.appendChild(txEnhancerStyles);
