/**
 * TRUSTBOT Documentation System
 * Provides a comprehensive user guide with markdown rendering
 * Modified to display in regular tab format instead of modal
 */

// Use showdown for markdown conversion if available, otherwise fallback to simple HTML
let showdown;
try {
    showdown = require('showdown');
} catch (e) {
    console.warn('Showdown markdown library not found, using basic HTML rendering');
}

const documentation = (() => {
    // Documentation content in markdown format
    const docContent = {
        overview: `
# TRUSTBOT Overview

TRUSTBOT is an advanced trading bot designed for the Virtuals ecosystem, enabling users to execute various trading strategies across multiple tokens and wallets with precision and efficiency.

## Key Features

- **Multi-wallet Support**: Trade using multiple wallets simultaneously
- **Multi-token Management**: Select and manage multiple tokens for trading
- **Advanced Trading Bots**: Various specialized bots for different trading strategies
- **Secure Key Management**: Private keys never leave your machine
- **Real-time Monitoring**: Track all trading activities in real-time
- **Parallel Execution**: Run trades in parallel for maximum efficiency

## Getting Started

1. Configure your wallet(s) in the Settings
2. Select tokens for trading
3. Choose a trading bot from the sidebar
4. Configure the bot parameters
5. Start trading

TRUSTBOT is designed to be powerful yet user-friendly, with an intuitive interface that makes trading accessible to both beginners and experienced traders.
`,

        bots: `
# Trading Bots

TRUSTBOT offers several specialized trading bots, each designed for specific trading strategies and scenarios.

## Basic Trading Bots

### Buy Bot
- **Purpose**: Purchase tokens using ETH or other base currencies
- **Key Features**:
  - Customizable slippage settings
  - Gas optimization
  - Purchase amount control
  - Multiple purchase options

### Sell Bot
- **Purpose**: Sell tokens for ETH or other base currencies
- **Key Features**:
  - Percentage-based selling
  - Fixed amount selling
  - Slippage control
  - Gas optimization

### FSH Bot
- **Purpose**: Specialized selling for urgent exit from positions
- **Key Features**:
  - Faster execution
  - Higher gas settings
  - Emergency sell mode

## Advanced Trading Bots

### Farm Bot
- **Purpose**: Automated buying and selling for "farming" profits
- **Key Features**:
  - Buy/sell cycle automation
  - Profit target setting
  - Interval control
  - Stop-loss settings

### Market Maker Bot
- **Purpose**: Provide liquidity and create market activity
- **Key Features**:
  - Automated buy/sell patterns
  - Volume control
  - Interval settings
  - Custom trading patterns

## Special Bots

### JeetBot
- **Purpose**: Advanced trading strategies for volatile tokens
- **Key Features**:
  - Multiple entry/exit points
  - Smart timing algorithms
  - Profit protection mechanisms
  - Custom volatility settings
`,

        setup: `
# Setting Up TRUSTBOT

Proper setup is essential for successful trading with TRUSTBOT. This guide will walk you through the initial configuration process.

## System Requirements

- Windows 10 or newer
- 4GB RAM minimum (8GB recommended)
- Internet connection
- Ethereum wallet(s) with private key

## Initial Configuration

1. **API Configuration**:
   - Enter your Virtuals API key in Settings
   - Configure RPC endpoints for desired networks

2. **Wallet Setup**:
   - Add your wallet private key in Settings
   - Optionally add multiple wallets for parallel trading
   - Label wallets for easy identification

3. **Security Settings**:
   - Set up wallet encryption (recommended)
   - Configure automatic locking
   - Set backup preferences

4. **Performance Settings**:
   - Set default gas prices
   - Configure transaction timeouts
   - Set parallel transaction limits

## Token Selection

1. Access the Token Selection panel
2. Search for tokens by name or contract address
3. Select tokens for trading
4. Configure default slippage for each token (optional)

## Network Configuration

TRUSTBOT supports multiple networks. Configure each network:

1. Go to Settings > Networks
2. Enter RPC URL for each network
3. Set gas price strategy
4. Test connection to ensure proper setup

Once the initial setup is complete, you can start using the trading bots for your selected tokens and wallets.
`,

        architecture: `
# TRUSTBOT Architecture

TRUSTBOT is built on a modern, modular architecture designed for performance, security, and extensibility.

## Core Components

### Frontend Layer
- **Electron UI**: Provides the user interface
- **Renderer Process**: Handles UI updates and user interactions
- **State Management**: Maintains application state and synchronization

### Core Engine
- **Trading Logic**: Implements trading strategies
- **Wallet Management**: Handles wallet operations
- **Token Interaction**: Manages token contracts and interactions

### Backend Services
- **API Integration**: Connects to external data sources
- **Transaction Management**: Handles transaction creation and submission
- **Data Persistence**: Stores configurations and historical data

## Data Flow

1. User inputs trading parameters via UI
2. Renderer process validates and sends to main process
3. Main process executes trading logic
4. Transactions are created and signed locally
5. Signed transactions are broadcast to the blockchain
6. Results are returned to the UI

## Security Architecture

- **Local Signing**: All transactions are signed locally
- **No Key Transmission**: Private keys never leave your computer
- **Encryption**: Optional encryption for stored private keys
- **Sandboxed Processes**: Electron security model isolates processes

## Extension Points

TRUSTBOT's modular architecture allows for:

- **Custom Bot Development**: Add new trading strategies
- **Plugin Integration**: Connect to additional services
- **Custom UIs**: Develop alternative user interfaces
- **API Extensions**: Add support for new APIs and data sources

This architecture ensures that TRUSTBOT remains flexible, secure, and able to adapt to the evolving needs of traders.
`,

        security: `
# Security Features

Security is a core design principle in TRUSTBOT. The application implements multiple layers of security to protect your assets and information.

## Wallet Security

### Private Key Management
- **Local Storage**: Private keys are stored locally, never transmitted
- **Encryption**: Optional AES-256 encryption for stored keys
- **Memory Protection**: Keys are cleared from memory when not in use

### Transaction Signing
- **Local Signing**: All transactions are signed on your device
- **Transaction Review**: Clear display of transaction details before signing
- **Gas Limit Protection**: Prevents excessive gas consumption

## Application Security

### Code Integrity
- **Code Signing**: Application code is signed to prevent tampering
- **Update Verification**: Updates are verified before installation
- **Dependency Auditing**: Regular security audits of dependencies

### Network Security
- **TLS Connections**: All API communications use TLS
- **API Key Security**: API keys are stored securely
- **Request Validation**: All incoming and outgoing data is validated

## User Security Features

### Authentication Options
- **Application Password**: Optional password protection for the application
- **Auto-Lock**: Automatic locking after period of inactivity
- **Session Management**: Clear session data on exit

### Transaction Safety
- **Spending Limits**: Set maximum transaction amounts
- **Whitelist Addresses**: Limit transactions to approved addresses
- **Confirmation Requirements**: Multiple confirmations for high-value transactions

## Best Practices

For optimal security:

1. Use the wallet encryption feature
2. Enable application password protection
3. Keep your OS and TRUSTBOT updated
4. Use hardware wallets when possible
5. Regularly back up your wallet and configuration data
6. Avoid using TRUSTBOT on shared or public computers
7. Verify transaction details before confirming
`,

        terminology: `
# Key Terminology

Understanding the terminology used in TRUSTBOT will help you navigate the application more effectively.

## General Terms

- **Gas**: Fee paid to miners for processing transactions
- **Slippage**: Acceptable price change during transaction processing
- **Wallet**: Storage for your cryptocurrency and private keys
- **Token**: Digital asset on a blockchain
- **Smart Contract**: Self-executing code on blockchain
- **Liquidity**: Availability of tokens for trading
- **Liquidity Pool**: Collection of funds locked in a smart contract

## TRUSTBOT Specific Terms

- **Active Bot**: Currently selected trading bot
- **Parallel Execution**: Running multiple trades simultaneously
- **Wallet Group**: Collection of wallets for batch operations
- **Token Selection**: Process of choosing tokens to trade
- **Trading Parameter**: Configuration option for trading bots
- **Console**: Area showing real-time trading information
- **FSH**: Fast Sell Handling (emergency sell mechanism)

## Trading Terms

- **Base Currency**: Main currency used for trading (usually ETH)
- **Market Order**: Order to buy/sell at current market price
- **Limit Order**: Order to buy/sell at specified price
- **Market Cap**: Total value of a token (price × supply)
- **Volume**: Amount of a token traded in a time period
- **Spread**: Difference between buy and sell prices
- **Volatility**: Measure of price fluctuation

## Technical Terms

- **RPC Endpoint**: Connection point to blockchain
- **API Key**: Authentication token for external services
- **ERC-20**: Standard interface for Ethereum tokens
- **Node**: Connection point to blockchain network
- **Confirmation**: Verification of transaction on blockchain
- **Block**: Group of transactions added to blockchain
- **Nonce**: Transaction counter for an address
`,

        examples: `
# Usage Examples

These examples demonstrate how to use TRUSTBOT for common trading scenarios.

## Basic Buy Example

**Scenario**: Purchase 0.1 ETH worth of a token

1. Select your wallet in the Wallet Selection panel
2. Search and select the desired token
3. Select the Buy bot from the sidebar
4. Configure:
   - Amount: 0.1 ETH
   - Slippage: 1%
   - Gas: Auto (or custom value)
5. Click "Start Bot"

The console will show progress, and the transaction will appear in your transaction history when complete.

## Selling Half Your Tokens

**Scenario**: Sell 50% of your token holdings

1. Select your wallet containing the tokens
2. Select the token you wish to sell
3. Select the Sell bot
4. Configure:
   - Amount: 50%
   - Slippage: 1%
   - Gas: Auto (or custom value)
5. Click "Start Bot"

## Multi-Wallet Trading

**Scenario**: Buy the same token with multiple wallets

1. Select multiple wallets in the Wallet Selection panel
2. Select the token you wish to purchase
3. Choose the Buy bot
4. Configure:
   - Amount: Enter desired amount per wallet
   - Slippage: Set desired slippage
   - Check "Run in parallel" option
5. Click "Start Bot"

TRUSTBOT will execute the purchase for each selected wallet simultaneously.

## Farming Strategy

**Scenario**: Set up a farming bot to buy low and sell high automatically

1. Select your wallet(s)
2. Select the token to farm
3. Choose the Farm bot
4. Configure:
   - Buy amount: 0.1 ETH
   - Sell percentage: 100%
   - Profit target: 10%
   - Cycles: 5
   - Interval: 60 seconds
5. Click "Start Bot"

The bot will buy the token, wait for the price to increase by 10%, sell, and repeat the cycle 5 times.

## Token Monitoring

**Scenario**: Monitor token price without trading

1. Select the token(s) you want to monitor
2. View the token information panel
3. The price chart will update in real-time
4. Set price alerts (optional) to be notified of significant changes

These examples cover basic usage patterns. As you become more familiar with TRUSTBOT, you can create more complex trading strategies.
`
    };

    // Initialize the documentation module
    function init() {
        attachEventListeners();
    }

    // Attach event listeners for documentation modal functionality
    function attachEventListeners() {
        // Listen for clicks on the documentation button in the sidebar
        document.addEventListener('click', function(event) {
            if (event.target.closest('[data-bot="documentation"]')) {
                openDocumentationModal();
            }
        });

        // Navigation button click handlers
        const navButtons = document.querySelectorAll('.doc-nav-btn');
        navButtons.forEach(button => {
            button.addEventListener('click', function() {
                const section = this.getAttribute('data-section');
                activateSection(section);
            });
        });

        // Search functionality
        const searchInput = document.getElementById('doc-search');
        if (searchInput) {
            searchInput.addEventListener('input', handleSearch);
            searchInput.addEventListener('focus', function() {
                const results = document.querySelector('.doc-search-results');
                if (results.children.length > 0) {
                    results.style.display = 'block';
                }
            });

            // Close search results when clicking outside
            document.addEventListener('click', function(event) {
                if (!event.target.closest('.doc-search-container')) {
                    document.querySelector('.doc-search-results').style.display = 'none';
                }
            });
        }
    }

    // Open the documentation modal and load content
    function openDocumentationModal() {
        const modal = document.getElementById('documentation-modal');
        if (modal) {
            modal.style.display = 'block';
            
            // Render content for each section
            Object.keys(docContent).forEach(section => {
                const contentDiv = document.getElementById(`${section}-content`);
                if (contentDiv) {
                    contentDiv.innerHTML = renderMarkdown(docContent[section]);
                }
            });
            
            // Activate the default section (overview)
            activateSection('overview');
        }
    }

    // Close the documentation modal
    function closeDocumentationModal() {
        const modal = document.getElementById('documentation-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    // Create documentation container
    const createDocumentationContainer = () => {
        const container = document.createElement('div');
        container.className = 'documentation-container';
        
        // Add title
        const title = document.createElement('h1');
        title.className = 'documentation-title';
        title.textContent = '📚 TRUSTBOT User Guide';
        title.style.textAlign = 'center';
        title.style.margin = '20px 0 10px 0';
        title.style.color = '#1a3c61';
        container.appendChild(title);
        
        // Create navigation panel - positioned horizontally at top in a single line
        const nav = document.createElement('div');
        nav.className = 'doc-nav';
        nav.style.display = 'flex';
        nav.style.flexDirection = 'row';
        nav.style.flexWrap = 'nowrap';
        nav.style.justifyContent = 'center';
        nav.style.padding = '10px';
        nav.style.overflowX = 'auto';
        nav.style.whiteSpace = 'nowrap';
        container.appendChild(nav);
        
        // Add navigation buttons horizontally
        Object.keys(docContent).forEach(section => {
            const button = document.createElement('button');
            button.className = 'doc-nav-btn';
            button.textContent = section.charAt(0).toUpperCase() + section.slice(1);
            button.setAttribute('data-section', section);
            nav.appendChild(button);
        });
        
        // Create content container - full width below navigation with proper scrolling
        const contentContainer = document.createElement('div');
        contentContainer.className = 'doc-content-container';
        contentContainer.style.padding = '20px';
        contentContainer.style.height = 'calc(100% - 130px)';
        contentContainer.style.overflowY = 'auto';
        container.appendChild(contentContainer);
        
        // Add content sections
        Object.keys(docContent).forEach(section => {
            const sectionDiv = document.createElement('div');
            sectionDiv.id = `${section}-section`;
            sectionDiv.className = 'doc-section';
            contentContainer.appendChild(sectionDiv);
            
            const contentDiv = document.createElement('div');
            contentDiv.id = `${section}-content`;
            sectionDiv.appendChild(contentDiv);
        });
        
        return container;
    }

    // Activate a specific documentation section
    function activateSection(sectionName) {
        // Update active state for navigation buttons
        document.querySelectorAll('.doc-nav-btn').forEach(btn => {
            if (btn.getAttribute('data-section') === sectionName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        
        // Update visible section
        document.querySelectorAll('.doc-section').forEach(section => {
            if (section.id === `${sectionName}-section`) {
                section.classList.add('active');
            } else {
                section.classList.remove('active');
            }
        });
    }

    // Handle search in documentation
    function handleSearch() {
        const query = this.value.trim().toLowerCase();
        const resultsContainer = document.querySelector('.doc-search-results');
        
        // Clear previous results
        resultsContainer.innerHTML = '';
        
        if (!query) {
            resultsContainer.style.display = 'none';
            return;
        }
        
        // Search through all sections
        let results = [];
        Object.keys(docContent).forEach(section => {
            const content = docContent[section].toLowerCase();
            
            // Simple search for the query in content
            if (content.includes(query)) {
                // Find surrounding context for the match
                const index = content.indexOf(query);
                const start = Math.max(0, index - 40);
                const end = Math.min(content.length, index + query.length + 40);
                let context = content.substring(start, end);
                
                // Add ellipsis for truncated text
                if (start > 0) context = '...' + context;
                if (end < content.length) context = context + '...';
                
                // Highlight the match
                const highlightedContext = context.replace(
                    new RegExp(query, 'gi'), 
                    match => `<span class="match">${match}</span>`
                );
                
                results.push({
                    section: section,
                    context: highlightedContext,
                    sectionTitle: section.charAt(0).toUpperCase() + section.slice(1)
                });
            }
        });
        
        // Display results
        if (results.length > 0) {
            results.forEach(result => {
                const resultItem = document.createElement('div');
                resultItem.className = 'result-item';
                resultItem.innerHTML = `<strong>${result.sectionTitle}:</strong> ${result.context}`;
                resultItem.addEventListener('click', () => {
                    activateSection(result.section);
                    resultsContainer.style.display = 'none';
                });
                resultsContainer.appendChild(resultItem);
            });
            resultsContainer.style.display = 'block';
        } else {
            resultsContainer.innerHTML = '<div class="result-item">No results found</div>';
            resultsContainer.style.display = 'block';
        }
    }

    // Simple markdown renderer
    function renderMarkdown(markdown) {
        if (!markdown) return '';
        
        let html = markdown;
        
        // Headers
        html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
        
        // Bold and Italic
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        
        // Lists
        html = html.replace(/^\s*\d+\.\s+(.*$)/gm, '<li>$1</li>');
        html = html.replace(/<\/li>\n<li>/g, '</li><li>');
        html = html.replace(/(<li>.*<\/li>)/gs, '<ol>$1</ol>');
        
        html = html.replace(/^\s*-\s+(.*$)/gm, '<li>$1</li>');
        html = html.replace(/<\/li>\n<li>/g, '</li><li>');
        html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
        
        // Fix potential nested list issues
        html = html.replace(/<\/ol>\s*<ol>/g, '');
        html = html.replace(/<\/ul>\s*<ul>/g, '');
        
        // Code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // Line breaks and paragraphs
        html = html.replace(/\n\s*\n/g, '</p><p>');
        html = html.replace(/^(.+)$/gm, function(match) {
            if (match.startsWith('<h') || match.startsWith('<ul') || match.startsWith('<ol') || 
                match.startsWith('<li') || match.startsWith('<p') || match.startsWith('</')) {
                return match;
            }
            return match + '<br>';
        });
        
        // Wrap with paragraph
        html = '<p>' + html + '</p>';
        
        // Clean up any empty paragraphs
        html = html.replace(/<p>\s*<\/p>/g, '');
        
        return html;
    }
    
    // Activate a specific documentation section
function activateSection(sectionName) {
    // Update active state for navigation buttons
    document.querySelectorAll('.doc-nav-btn').forEach(btn => {
        if (btn.getAttribute('data-section') === sectionName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Update visible section
    document.querySelectorAll('.doc-section').forEach(section => {
        if (section.id === `${sectionName}-section`) {
            section.classList.add('active');
        } else {
            section.classList.remove('active');
        }
    });
}

// Handle search in documentation
function handleSearch() {
    const query = this.value.trim().toLowerCase();
    const resultsContainer = document.querySelector('.doc-search-results');
    
    // Clear previous results
    resultsContainer.innerHTML = '';
    
    if (!query) {
        resultsContainer.style.display = 'none';
        return;
    }
    
    // Search through all sections
    let results = [];
    Object.keys(docContent).forEach(section => {
        const content = docContent[section].toLowerCase();
        
        // Simple search for the query in content
        if (content.includes(query)) {
            // Find surrounding context for the match
            const index = content.indexOf(query);
            const start = Math.max(0, index - 40);
            const end = Math.min(content.length, index + query.length + 40);
            let context = content.substring(start, end);
            
            // Add ellipsis for truncated text
            if (start > 0) context = '...' + context;
            if (end < content.length) context = context + '...';
            
            // Highlight the match
            const highlightedContext = context.replace(
                new RegExp(query, 'gi'), 
                match => `<span class="match">${match}</span>`
            );
            
            results.push({
                section: section,
                context: highlightedContext,
                sectionTitle: section.charAt(0).toUpperCase() + section.slice(1)
            });
        }
    });
    
    // Display results
    if (results.length > 0) {
        results.forEach(result => {
            const resultItem = document.createElement('div');
            resultItem.className = 'result-item';
            resultItem.innerHTML = `<strong>${result.sectionTitle}:</strong> ${result.context}`;
            resultItem.addEventListener('click', () => {
                activateSection(result.section);
                resultsContainer.style.display = 'none';
            });
            resultsContainer.appendChild(resultItem);
        });
        resultsContainer.style.display = 'block';
    } else {
        resultsContainer.innerHTML = '<div class="result-item">No results found</div>';
        resultsContainer.style.display = 'block';
    }
}

// Simple markdown renderer
function renderMarkdown(markdown) {
    if (!markdown) return '';
    
    let html = markdown;
    
    // Headers
    html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
    
    // Bold and Italic
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Lists
    html = html.replace(/^\s*\d+\.\s+(.*$)/gm, '<li>$1</li>');
    html = html.replace(/<\/li>\n<li>/g, '</li><li>');
    html = html.replace(/(<li>.*<\/li>)/gs, '<ol>$1</ol>');
    
    html = html.replace(/^\s*-\s+(.*$)/gm, '<li>$1</li>');
    html = html.replace(/<\/li>\n<li>/g, '</li><li>');
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    
    // Fix potential nested list issues
    html = html.replace(/<\/ol>\s*<ol>/g, '');
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    
    // Code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Line breaks and paragraphs
    html = html.replace(/\n\s*\n/g, '</p><p>');
    html = html.replace(/^(.+)$/gm, function(match) {
        if (match.startsWith('<h') || match.startsWith('<ul') || match.startsWith('<ol') || 
            match.startsWith('<li') || match.startsWith('<p') || match.startsWith('</')) {
            return match;
        }
        return match + '<br>';
    });
    
    // Wrap with paragraph
    html = '<p>' + html + '</p>';
    
    // Clean up any empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');
    
    return html;
}

// Public API
// Convert markdown content to HTML
function renderMarkdown(markdownText) {
    if (showdown) {
        try {
            const converter = new showdown.Converter({
                tables: true,
                tasklists: true,
                strikethrough: true,
                emoji: true
            });
            return converter.makeHtml(markdownText);
        } catch (e) {
            console.error('Error converting markdown:', e);
            return simpleMarkdownToHtml(markdownText);
        }
    } else {
        return simpleMarkdownToHtml(markdownText);
    }
}
    
// Simple fallback markdown parser
function simpleMarkdownToHtml(markdownText) {
    // Very basic markdown transformation
    return markdownText
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^\* (.+)$/gm, '<ul><li>$1</li></ul>')
        .replace(/^- (.+)$/gm, '<ul><li>$1</li></ul>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\`([^`]+)\`/g, '<code>$1</code>')
        .replace(/\n\n/g, '<br><br>');
}
    
// Public methods
return {
    /**
     * Get the rendered HTML content for a specific documentation section
     * @param {string} section - The section key to load
     * @returns {string} - The rendered HTML content
     */
    getContent: function(section) {
        // Default to overview if section doesn't exist
        const content = docContent[section] || docContent.overview;
        
        // Return rendered HTML
        return `<div class="doc-rendered">${renderMarkdown(content)}</div>`;
    },
    
    /**
     * Get all available section keys
     * @returns {string[]} - Array of section keys
     */
    getSections: function() {
        return Object.keys(docContent);
    }
};
})();

// Make documentation available globally
window.documentation = documentation;

// Export for module usage - support both CommonJS and ES6
if (typeof module !== 'undefined' && module.exports) {
    module.exports = documentation;
} else if (typeof exports !== 'undefined') {
    exports.default = documentation;
}

// Also maintain the original ES6 export
try {
    if (typeof exports !== 'undefined') {
        Object.defineProperty(exports, "__esModule", { value: true });
    }
} catch (e) {
    console.warn("Unable to set __esModule flag on exports", e);
}

// No need for automatic initialization in the tab-based approach
// This will be handled by renderer.js when the documentation tab is selected
