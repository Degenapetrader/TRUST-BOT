# 🤖 TRUSTBOT - GUI Trading Bot for Base Network


## 🚀 Overview

TRUSTBOT is a GUI trading bot built with Electron, designed for automated trading on the Base network (Layer 2). It features multiple trading strategies, real-time WebSocket monitoring, and a robust multi-provider RPC infrastructure for maximum reliability.

### Key Features
- **🖥️ Modern GUI Interface** - Intuitive Electron-based desktop application
- **⚡ Real-time Trading** - WebSocket integration for instant market response
- **🔄 Multi-Provider RPC** - Alchemy, QuickNode, Infura + dynamic providers
- **🛡️ Robust Architecture** - Modular design with automatic failover
- **💎 TRUSTSWAP Integration** - Optimized 0.25% fee trading through TRUSTSWAP contract

## 🎯 Trading Bots

### 💰 BuyBot
**Automated token purchasing with advanced execution modes**
- **Logic**: Purchases tokens using VIRTUAL or other currencies
- **Methods**: Direct purchase, TWAP (Time-Weighted Average Price)
- **RPC Usage**: Multi-provider rotation for transaction execution
- **Features**: Percentage-based amounts, loop execution, parallel wallet processing

### 💸 SellBot  
**Smart token selling with multiple execution strategies**
- **Logic**: Sells tokens for VIRTUAL or other currencies with optimized timing
- **Methods**: Regular sell, TWAP mode, FSH (Flash Sell All)
- **RPC Usage**: WebSocket balance monitoring + RPC transaction execution
- **Features**: Multi-token support, automatic pool detection, blacklist protection

### 🌾 FarmBot
**Volume generation through automated buy-sell cycles**
- **Logic**: Creates trading volume by executing rapid buy→sell cycles
- **Methods**: Parallel execution with consecutive nonces (n, n+1)
- **RPC Usage**: Real-time balance tracking with WebSocket optimization
- **Features**: Amount randomization (±10%), timeout handling, performance tracking

### 📊 MMBot (Market Maker)
**Automated market making with dynamic range trading**
- **Logic**: Provides liquidity through strategic buy-low/sell-high operations
- **Methods**: Range-based trading with configurable price thresholds
- **RPC Usage**: WebSocket price monitoring + transaction execution
- **Features**: Dynamic position tracking, profit optimization, risk management

### 🔥 JeetBot
**Genesis contract monitoring and automated token acquisition**
- **Logic**: Monitors genesis contracts for new token deployments and auto-trades
- **Methods**: WebSocket event detection → parallel approvals → immediate swapping
- **RPC Usage**: Real-time WebSocket monitoring + RPC fallback
- **Features**: Token blacklist protection, REBUY mode, multi-wallet parallel processing

## 🏗️ Technical Architecture

### RPC Infrastructure
```
Primary Providers:
├── Alchemy (Primary RPC + WebSocket)
├── QuickNode/BlastAPI (Backup RPC)  
├── Infura (WebSocket + RPC)
└── Dynamic RPCs (User configurable)

Failover Strategy:
Sequential provider rotation with health monitoring
```

### WebSocket Integration
- **Real-time Balance Monitoring**: Transfer event listeners
- **Transaction Confirmation**: Block event monitoring
- **Price Tracking**: Swap event detection
- **Approval Monitoring**: ERC20 approval events
- **Provider Redundancy**: Infura primary → Alchemy fallback

### Trading Logic
```
Core Trading Flow:
1. Token Resolution (Database → API → RPC)
2. Balance Verification (WebSocket + RPC)
3. Approval Management (Unlimited approvals)
4. Transaction Execution (TRUSTSWAP primary + Pool fallback)
5. Confirmation Monitoring (WebSocket events)
```

## ⚙️ Setup & Installation

### Prerequisites
- Node.js 16+ 
- Windows/macOS/Linux
- Base network RPC access

### Installation
```bash
# Clone the repository
git clone <repository-url>
cd trustbot

# Install dependencies
npm install

# Configure wallets (see Configuration section)
# Edit wallets.json with your settings

# Start the GUI application
npm start
```

### Configuration
Edit `wallets.json` to configure:

```json
{
  "config": {
    "rpcUrl": "YOUR_ALCHEMY_RPC",
    "wsUrl": "YOUR_ALCHEMY_WEBSOCKET", 
    "rpcUrlQuickNode": "YOUR_QUICKNODE_RPC",
    "rpcUrlInfura": "YOUR_INFURA_RPC",
    "wsUrlInfura": "YOUR_INFURA_WEBSOCKET",
    "virtualTokenAddress": "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
    "chainId": 8453
  },
  "wallets": [
    {
      "id": 1,
      "name": "B1",
      "privateKey": "YOUR_PRIVATE_KEY",
      "enabled": true
    }
  ]
}
```

## 🎮 Usage

### GUI Interface
1. **Launch Application**: `npm start`
2. **Select Trading Bot**: Choose from sidebar (Buy/Sell/Farm/MM/Jeet)
3. **Configure Parameters**: Set amounts, tokens, wallets via GUI
4. **Monitor Execution**: Real-time console with detailed logging
5. **View Results**: Transaction summaries and balance changes

### Trading Workflows

**BuyBot Example:**
```
1. Select tokens → Set amounts → Choose wallets
2. Configure execution (parallel/sequential)
3. Set gas price and loops
4. Execute → Monitor real-time progress
```

**SellBot Example:**
```
1. Auto-detect tokens or manual selection
2. Set sell percentages or fixed amounts  
3. Choose currency (VIRTUAL/ETH/Custom)
4. Execute → Track VIRTUAL received
```

## 🔧 Development

### Project Structure
```
trustbot/
├── main.js              # Electron main process
├── renderer.js           # GUI frontend logic
├── wallets.json          # Configuration file
├── src/
│   ├── bots/            # Trading bot implementations
│   ├── config/          # Configuration management
│   ├── providers/       # RPC provider management
│   ├── utils/           # Shared utilities
│   └── wallets/         # Wallet management
└── bots/                # Legacy bot files (compatibility)
```

### Key Technologies
- **Frontend**: HTML/CSS/JavaScript (Electron renderer)
- **Backend**: Node.js with ethers.js v6
- **Blockchain**: Base L2 (2-second blocks, no mempool)
- **Trading**: TRUSTSWAP contract integration
- **Monitoring**: WebSocket + RPC hybrid approach

### Adding New Features
1. Create service in `src/bots/services/`
2. Implement bot logic in `src/bots/`
3. Add GUI components in `renderer.js`
4. Update configuration schema if needed

## 🛡️ Security Features

- **Private Key Management**: Secure local storage in wallets.json
- **Token Blacklist**: Hardcoded protection against selling critical tokens
- **Transaction Validation**: Multiple confirmation layers
- **Provider Failover**: Automatic switching on RPC failures
- **Amount Validation**: Prevents dust transactions and over-spending

## 📊 Performance Optimizations

- **WebSocket Events**: Replace polling for 90% faster response times
- **Parallel Processing**: Multi-wallet transactions in same block
- **Smart Caching**: Balance caching with event-driven invalidation
- **Provider Load Balancing**: Random selection across healthy providers
- **Gas Optimization**: Dynamic gas pricing with escalation

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

### Development Guidelines
- Follow existing code structure in `src/` directory
- Maintain backward compatibility with GUI interface
- Add comprehensive error handling
- Update documentation for new features
- Test with multiple RPC providers



## ⚠️ Disclaimer

This software is for educational and research purposes. Users are responsible for compliance with applicable laws and regulations. Trading cryptocurrencies involves significant risk of loss.

---
