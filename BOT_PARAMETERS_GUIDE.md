# 🤖 **BOT PARAMETERS GUIDE v5.4**

## 🚨 LATEST GUI/COMMAND CHANGES (2024-06):
- **BID-MODE:** Always append `BID-MODE` at the end of the command for buybot, sellbot, and farmbot. Remove `ETH` argument in BID-MODE.
- **TWAP in BID-MODE:** 'slow' is never included in TWAP commands for buybot/sellbot in BID-MODE.
- **FarmBot in BID-MODE:** FarmBot is now available in BID-MODE in the GUI. In BID-MODE, FarmBot never includes 'slow'.
- **Token Input in BID-MODE:** You can input either a ticker or contract address directly; the command uses exactly what you enter.
- **TWAP Minimum:** Minimum amount per transaction is `0.000001`. All amounts are rounded to 18 decimals.
- **Command Consistency:** All bots use the same wallet selection, token/amount, and argument order as shown in the GUI.
- **GUI/Command Sync:** The GUI always builds commands exactly as described here.

---

## 🚀 **NEW: MARKET CAP FILTERING (v5.4)**

### **💰 AUTOMATIC MARKET CAP FILTER**
- **🚫 Excludes Low-Cap Tokens:** Automatically filters out tokens < 50,000 VIRTUAL market cap
- **✅ Improved Database Quality:** Only saves tokens with significant market capitalization
- **📊 Transparent Reporting:** Shows filtering statistics during processing
- **🔧 Applied Universally:** Active on search, fetchAll, updateNew, and runAll commands

---

## 🚀 **PREVIOUS: TICKER DEDUPLICATION SYSTEM (v5.3)**

### **✅ AUTOMATIC DUPLICATE REMOVAL**
- **🔍 Smart Detection:** Automatically finds duplicate ticker symbols across databases
- **🏊 Pool Analysis:** Uses find-pool.mjs to check Uniswap V2 VIRTUAL reserves
- **🏆 Liquidity Priority:** Keeps only the token with highest VIRTUAL reserves
- **🔄 Auto-Integration:** All ticker commands now include automatic deduplication
- **📄 Safety Backups:** Creates .backup files before deduplication for safety

### **✅ NEW COMMANDS**
- **🔧 ticker:dedupe:** Standalone deduplication tool for existing databases
- **🎯 Chain-specific:** Deduplicate individual chains (BASE, ETH, SOLANA)
- **📊 Detailed Reporting:** Shows comprehensive before/after statistics

### **✅ EFFICIENCY IMPROVEMENTS**
- **🧠 Smart Detection:** Commands only run deduplication when duplicates actually exist
- **⚡ Faster Processing:** Skips unnecessary pool checking when no duplicates found
- **📊 Intelligent Checking:** Pre-scans for duplicates before running expensive operations

---

## 🚀 **PREVIOUS: MAJOR BOT IMPROVEMENTS (v5.2)**

### **✅ RECENT CRITICAL FIXES**
- **🔧 Transaction Tracking Fix:** Buybot and sellbot now show correct received amounts instead of 0.000000
- **🔧 Percentage Calculation Fix:** Each wallet calculates percentage from its OWN balance (not first wallet's)
- **🔧 Parsing Consistency:** Sellbot now uses same parsing logic as buybot (tokens first, then amounts)
- **⚡ Enhanced Error Handling:** UniswapV2 K errors fixed across all trading bots
- **🎯 Multiple Token Support:** Sellbot now supports multiple tokens like buybot

### **✅ BOT RESTRUCTURE HIGHLIGHTS**
- **📦 Shared Utilities:** New `src/parsing/argParser.js` eliminates code duplication
- **🔢 L-X Loop Format:** L-5 instead of legacy numbers across all bots
- **❌ Removed Auto Mode:** From buybot and sellbot (farmbot only)
- **✅ TWAP Mode:** Added to buybot with I-X minute format
- **✅ FSH Mode:** Enhanced in sellbot with detailed workflow
- **⚡ 66% Code Reduction:** Streamlined parsing and execution

---

## 📋 **ALL AVAILABLE BOTS**

### **PRIMARY BOTS (via `npm run` recommended)**
1. **transferbot** - Transfer tokens between wallets
2. **stargate** - Cross-chain bridge (Solana ↔ Base)  
3. **contactbot** - Contact management
4. **detect** - Token detection & analysis
5. **detect:quick** - Quick token summary

### **INDIVIDUAL BOTS (via `npm run`)**
1. **buybot** - Token purchasing with TWAP support
2. **sellbot** - Token selling with FSH and multi-token support
3. **farmbot** - Volume creation with C-TOKEN support
4. **farmbot-accurate** - Enhanced volume farming
5. **jeetbot** - Genesis contract automation
6. **mmbot** - Market making (redesigned single-token)
7. **blshbot** - Price monitoring & trading
8. **ticker:search** - Search specific tokens across all chains
9. **ticker:fetchAll** - Download complete token database from API
10. **ticker:updateNew** - Smart incremental updates (BASE chain only)
11. **ticker:runAll** - Complete database refresh + export workflow
12. **token-list** - Token database management
13. **sell-all** - Sell all tokens
14. **genesis:search** - Find genesis contract addresses
15. **genesis:unlock** - Research tokenomics unlock dates
16. **genesis:ticker** - Reverse lookup: genesis address to ticker
17. **ticker:dedupe** - Remove duplicate tickers by VIRTUAL reserves
18. **ticker:dedupe:fast** - Instantly remove duplicates (keeps first instance)

---

## ⛽ **UNIVERSAL GAS PRICE CONTROL**

**Available on ALL bots:** `gas<value>` (value in gwei)

**Format:** `gas0.05` (can be placed anywhere in arguments)
**Range:** 0.001 to 100 gwei  
**Default:** 0.02 gwei if not specified
**Examples:** 
- `gas0.1` (higher priority/faster)
- `gas0.01` (lower cost/slower)

---

## 🔄 **TRANSFERBOT**

**Commands:** `npm run transferbot` (Recommended) OR `npm start transferbot`

**Arguments:** `<token> <amount> <receiver>` OR `[senders...] <token> <amount> [receivers...]` OR `contacts <command>`

**Default Values:**
- Gas: Auto-calculated for Base network
- Transfer delay: 2 seconds between transfers
- Amount formats: Fixed numbers (100) or percentages (100%, 50%, 25%)

```bash
# 🔥 NEW FORMAT - All wallets mode:
npm run transferbot TRUST 100% 0xEC9B903C4d81e2336694C72D9C78Ea72A87ffeE7  # Send all TRUST from every wallet
npm run transferbot VIRTUAL 50% B2                       # Send half VIRTUAL from all wallets to B2  
npm run transferbot ETH 100% alice                       # Send all ETH to contact "alice"
npm run transferbot TRUST 25% ALL                        # Distribute 25% TRUST to all other wallets

# Classic Format - TRANSFERS  
npm run transferbot B1 TRUST 100 B2                      # Transfer 100 TRUST from B1 to B2
npm run transferbot B1 TRUST 50% B2                      # Transfer 50% of B1's TRUST to B2
npm run transferbot B1 B2 TRUST 100% B3                  # Transfer all TRUST from B1&B2 to B3
npm run transferbot B1 TRUST 100 ALL                     # Transfer 100 TRUST from B1 to all others
npm run transferbot B1 ETH 0.5 0x123...                  # Transfer ETH to external address
npm run transferbot B1 TRUST 100 alice                   # Transfer to saved contact

# CONTACTS Management
npm run transferbot contacts add alice 0x123...          # Save contact
npm run transferbot contacts list                        # Show all contacts
npm run transferbot contacts remove alice                # Delete contact
```

---

## 🌉 **STARGATE BRIDGE**

**Commands:** `npm run stargate` (Recommended) OR `npm start stargate`

**Arguments:** `[command] [wallets...] [min_amount] [max_amount]`

**Default Values:**
- Mode: `transfer-once` (single transfer to all B wallets)
- Amount range: Auto-calculated based on balances
- **Directions:** Solana ↔ Base (bidirectional bridge)

```bash
# 🔄 FORWARD TRANSFERS (Solana → Base)
npm run stargate                                         # Send VIRTUAL from Solana to all Base wallets
npm run stargate continuous                              # Keep bridging automatically in a loop
npm run stargate balance                                 # Show VIRTUAL balance on Solana
npm run stargate transfer-once 1200 1250                # Send random amount between 1200-1250 VIRTUAL
npm run stargate transfer-once 1000                     # Send exactly 1000 VIRTUAL
npm run stargate transfer-once all                      # Send 99.9% of Solana VIRTUAL
npm run stargate transfer-to B1 B2 B12                  # Send to specific Base wallets only

# 🔄 REVERSE TRANSFERS (Base → Solana)
npm run stargate reverse-balance                         # Show VIRTUAL balance on Base
npm run stargate reverse-transfer                        # Send VIRTUAL from Base to Solana
npm run stargate reverse-transfer 100 200               # Send random amount between 100-200
npm run stargate reverse-transfer all                   # Send 99.9% of Base VIRTUAL
npm run stargate reverse-to Sol1... Sol2... 50 100      # Send to specific Solana addresses
```

---

## 📞 **CONTACTBOT**

**Commands:** `npm run contactbot` (Recommended) OR `npm start contactbot`

**Arguments:** `<command> [options]`

**Default Values:**
- Database: Contacts.json (auto-created)
- Address validation: Enabled with checksumming

```bash
npm run contactbot                                       # Display help
npm run contactbot add alice 0x123... "Main wallet"     # Save new contact
npm run contactbot list                                  # Show all contacts
npm run contactbot list alice                            # Search contacts by term
npm run contactbot remove alice                          # Delete contact
npm run contactbot update alice 0x456...                # Change address
npm run contactbot search 0x123                         # Find by address
npm run contactbot export csv                           # Export to CSV
npm run contactbot info alice                           # Show details
```

---

## 🔍 **DETECT BOTS**

**Command:** `npm run detect` - Full token detection and analysis  
**Quick Command:** `npm run detect:quick` - Quick summary of configured tokens only

**What it does:**
- 🔍 Scans **ALL your wallets** for tokens with balance >100 units
- 🏊 Checks for **Uniswap V2 pools vs VIRTUAL** token
- 💰 Calculates **USD values** and **portfolio worth**
- 📊 Shows **pool liquidity** and **trading opportunities**
- 💾 Saves results to `detected-tokens.json` database
- 📋 Provides **.env configuration** for new tokens

**Files used:** `src/tokenDetector.js`

```bash
npm run detect                                           # Full scan of all wallets + pool analysis
npm run detect:quick                                     # Quick analysis of configured tokens only
```

**Example Output:**
```
🪙 TOKEN 1: Trust (TRUST)
   📍 Contract Address: 0xC841b4eaD3F70bE99472FFdB88E5c3C7aF6A481a
   👛 Found in wallets: B1, B3, B5
   💰 Your Balance: 1,500 TRUST
   🏊 Pool Address: 0x1234...
   💹 Current Price: 0.00125000 VIRTUAL per TRUST
   💎 Portfolio Value: 1.875 VIRTUAL ($1.88 USD)
   
   📋 Configuration for .env:
      TOKEN1=0xC841b4eaD3F70bE99472FFdB88E5c3C7aF6A481a
      POOL_TOKEN1=0x1234...
```

---

## 🟢 **BUYBOT (OPTIMIZED + TWAP MODE)**

**New Command Format:** `[wallets] [tokens...] [amounts...] [C-currency] [L-loops] [slow] [gas]`
**TWAP Format:** `[wallets] <token> twap <amount> <I-duration> [C-currency] [gas]`

**Key Improvements:**
- ✅ **Removed auto mode** - Simplified to fixed amounts and percentages only
- ✅ **TWAP mode added** - I-60 (60 minutes) up to I-1440 (24 hours)
- ✅ **Complete C-TOKEN support** - Buy with ETH, VADER, TRUST, etc.
- ✅ **Two-step routing** - Currency → VIRTUAL → Target token
- ✅ **L-X loop format** - L-5 instead of legacy numbers

**💱 CURRENCY SUPPORT:**
- **VIRTUAL** - Default currency (direct buying)
- **ETH** - Special exception, hard-coded pool (no C- prefix needed)
- **C-TOKEN** - Buy with other tokens (e.g., C-VADER, C-TRUST)

```bash
# Basic Format:
npm run buybot TRUST 100                                 # Buy TRUST with 100 VIRTUAL (all wallets)
npm run buybot B1 B3 TRUST 150                          # Buy TRUST from wallets B1 and B3
npm run buybot TRUST VADER 100 200                      # Buy TRUST (100) and VADER (200) VIRTUAL
npm run buybot TRUST 100 C-VADER                        # Buy TRUST by spending 100 VADER
npm run buybot TRUST 100 ETH                            # Buy TRUST by spending 100 ETH
npm run buybot TRUST 100 L-5                            # Buy TRUST and repeat 5 times
npm run buybot TRUST 100 L-3 slow                       # Buy TRUST, 3 loops, sequential mode

# TWAP Mode (NEW):
npm run buybot TRUST twap 100 I-60                      # TWAP buy 100 VIRTUAL worth over 60 minutes
npm run buybot B1 B3 TRUST twap 50 I-120 C-VADER        # TWAP with specific wallets and currency
npm run buybot TRUST twap 200 I-30 gas0.075             # TWAP with custom gas
```

---

## 🔴 **SELLBOT (OPTIMIZED + MULTI-TOKEN SUPPORT)**

**New Command Format:** `[wallets] [tokens...] [amounts...] [L-loops] [currency] [slow] [gas]`
**TWAP Format:** `[wallets] [token] twap [amount] [duration] [currency] [gas]`
**FSH Format:** `[wallets] fsh [gas]`

**Key Improvements:**
- ✅ **Multiple token support** - Sell multiple tokens in one command  
- ✅ **Same parsing as buybot** - Tokens first, then amounts format
- ✅ **L-X loop format** - L-5 instead of legacy numbers
- ✅ **Removed auto mode** - Simplified to fixed amounts and percentages only

**Unique Features:**
- **Multiple tokens:** Process tokens sequentially (finish token 1 completely, then token 2), wallets in parallel per token
- **FSH mode:** Flash sell all tokens automatically with 5-step workflow
- **TWAP mode:** Time-weighted average price execution

```bash
# Basic Format:
npm run sellbot TRUST 100                               # Sell 100 TRUST for VIRTUAL (all wallets)
npm run sellbot B1 B3 TRUST 50%                         # Sell 50% TRUST (wallets B1, B3)
npm run sellbot TRUST VADER 100 200                     # Sell TRUST (100) and VADER (200)
npm run sellbot TRUST 100 L-5 ETH                       # Sell for ETH, repeat 5 times
npm run sellbot TRUST 100 L-3 C-VADER                   # Sell for VADER, repeat 3 times

# Special Modes:
npm run sellbot TRUST twap 50 10                        # TWAP sell 50 tokens over 10 minutes
npm run sellbot fsh                                     # Flash sell ALL tokens from ALL wallets
```

**🔥 FSH MODE WORKFLOW:**
1. **Wallet Scanning** - Parallel across all wallets using Alchemy API + RPC fallback
2. **Pool Validation** - Batch processing (20 tokens at a time)
3. **Balance Filtering** - Only tokens with balance >= 100 units
4. **Parallel Execution** - All wallets sell simultaneously
5. **Safety Features** - Excludes VIRTUAL and TRUST tokens

---

## 🔄 **FARMBOT (OPTIMIZED + C-TOKEN SUPPORT + CA SUPPORT)**

**New Command Format:** `[wallets] <token> <amount> [C-currency] [L-loops] [gas]`

**Key Improvements:**
- ✅ **Complete C-TOKEN support** - Farm with ETH, VADER, TRUST, etc.
- ✅ **Four-step routing** - Currency → VIRTUAL → Token → VIRTUAL → Currency
- ✅ **Parallel execution** - All transactions execute in same block
- ✅ **L-X loop format** - L-5, L-10
- ✅ **NEW:** Contract Address support with auto-detection via find-pool

**Token Input Formats:**
- **Ticker Symbol:** `TRUST, VADER, MIKASA` (database lookup)
- **Contract Address:** `0x1234...abcd` (auto-detects ticker + pool via find-pool)

**Strategy:** SINGLE TOKEN (one token per command, wallets parallel)

```bash
npm run farmbot TRUST 100                               # Farm TRUST with 100 VIRTUAL (all wallets)
npm run farmbot 0x1234...abcd 100                       # Farm token via CA (auto-detects ticker + pool)
npm run farmbot B1 B3 TRUST 100                         # Farm from specific wallets
npm run farmbot 0x1234...abcd 100 L-5                   # Farm CA token, 5 loops
npm run farmbot TRUST 100 C-VADER                       # Farm with VADER (four-step routing)
npm run farmbot TRUST 100 ETH                           # Farm with ETH (no C- needed)
```

---

## 📊 **MMBOT (COMPLETELY REDESIGNED - SINGLE TOKEN + CA SUPPORT)**

**New Command Format:** `[wallets] <token> <V-amount> <T-amount> <RL-range> <RH-range> [I-interval] [L-loops] [CHASE] [gas]`

**MAJOR IMPROVEMENTS:**
- ❌ **REMOVED:** Bullish/bearish modes, multi-token support, initial transactions
- ✅ **ADDED:** Separate RL-/RH- ranges, V-/T- amounts, L-X loops, CHASE mode
- ✅ **NEW:** Contract Address support with auto-detection via find-pool

**Token Input Formats:**
- **Ticker Symbol:** `TRUST, VADER, MIKASA` (database lookup)
- **Contract Address:** `0x1234...abcd` (auto-detects ticker + pool via find-pool)

**New Amount Formats:**
- `V-100` - Buy with 100 VIRTUAL (fixed)
- `V-1%` - Buy with 1% of VIRTUAL balance (percentage)
- `T-100` - Sell 100 tokens (fixed)
- `T-2%` - Sell 2% of token balance (percentage)

**New Range Formats:**
- `RL-3%` - Buy when price drops 3% from base
- `RH-3%` - Sell when price rises 3% from base

**Loop Format:**
- `L-1` - 1 loop (1 buy + 1 sell cycle)
- `L-5` - 5 loops (alternating buy/sell)
- No L- argument - INFINITE mode

```bash
npm run mmbot TRUST V-1% T-2% RL-3% RH-3% I-0.5 L-2
# Trade TRUST: buy with 1% VIRTUAL, sell 2% tokens,
# buy at 3% drop, sell at 3% rise, 30s intervals, 2 loops

npm run mmbot 0x1234...abcd V-100 T-50% RL-2% RH-5% I-1
# Contract Address: auto-detects ticker + pool, buy with 100 VIRTUAL

npm run mmbot B1 B3 TRUST V-100 T-50% RL-2% RH-5% I-1
# Wallets B1&B3: buy with 100 VIRTUAL, sell 50% tokens

npm run mmbot TRUST V-0.5% T-1% RL-1% RH-1% I-0.1 CHASE
# Fast trading with dynamic price updates every 6 seconds
```

---

## 🚜 **FARMBOT-ACCURATE**

**Arguments:** `[B1 B2 B3...] <token> <amount> [L-loops]`

**Default Values:**
- Loops: `5` loops (finite, for accuracy testing)
- Mode: `sequential` with BigNumber precision tracking

```bash
npm run farmbot-accurate TRUST 100                      # Enhanced farming with precision tracking
npm run farmbot-accurate B1 B3 TRUST 100 L-5            # Specific wallets, 5 loops
npm run farmbot-accurate TRUST 50%                      # Percentage farming with precision
```

---

## 🤖 **JEETBOT**

**Arguments:** `<genesis_contract> [mode] [wallet] [token] [D-delay]`

**Modes:** `JEET` (default), `DETECT`, `CHECK`
**Delay:** `D-X` (X = minutes to delay before starting)

**Default Values:**
- Mode: `JEET` (WebSocket detection → parallel approvals → monitoring → swaps)
- Delay: No delay (immediate start)
- Strategy: WebSocket CA detection + parallel approvals + automatic swapping

```bash
# JEET MODE (Full workflow - default)
npm run jeetbot 0x123...                                # Monitor Genesis, auto-approve, swap new tokens
npm run jeetbot 0x123... JEET                           # Explicit JEET mode
npm run jeetbot 0x123... JEET D-55                      # JEET mode with 55-minute delay

# DETECT MODE (WebSocket CA detection only)
npm run jeetbot 0x123... DETECT                         # Test WebSocket detection only
npm run jeetbot 0x123... DETECT D-30                    # DETECT mode with 30-minute delay

# CHECK MODE (Token balance checking)
npm run jeetbot 0x123... CHECK                          # Check all wallets for tokens
npm run jeetbot 0x123... CHECK B1                       # Check wallet B1 only
npm run jeetbot 0x123... CHECK B3 0x789...              # Check wallet B3 for specific token
npm run jeetbot 0x123... CHECK D-15                     # CHECK mode with 15-minute delay

# DELAY EXAMPLES
npm run jeetbot 0x123... JEET D-120                     # Wait 2 hours before starting
npm run jeetbot 0x123... D-5                           # Wait 5 minutes before JEET mode
npm run jeetbot 0x123... DETECT D-0.5                   # Wait 30 seconds before DETECT mode
```

**🔄 JEET Mode Workflow:**
1. **⏰ Optional Delay** - Wait specified minutes before starting (if D-X provided)
2. **🔗 WebSocket CA Detection** - Parallel across all providers
3. **🔓 Parallel Approvals** - All wallets approve simultaneously
4. **⚡ Token Monitoring** - Check balances every 3 seconds
5. **💫 Immediate Swaps** - Swap tokens → VIRTUAL when detected
6. **📊 Balance Tracking** - Show before/after summaries

**⏰ Delay Mode Features:**
- **Format:** D-X where X is minutes (supports decimals like D-0.5 for 30 seconds)
- **Range:** Any positive number (D-5, D-30, D-120, etc.)
- **Display:** Shows countdown every minute until bot starts
- **Cancellation:** Press Ctrl+C during delay to cancel and exit
- **Precision:** Accurate to the second for precise timing

---

## 📈 **BLSHBOT**

**Arguments:** `[B1 B2 B3...] [mode] [threshold] <token> [amount%]`

**Modes:** `B`/`buy`, `S`/`sell`, `both`

**Default Values:**
- Mode: `both` (buy and sell)
- Threshold: `35%` price change to trigger trade
- Amount: `10%` of wallet balance per trade

```bash
npm run blshbot TRUST                                   # Monitor TRUST for 35% price changes
npm run blshbot TRUST VADER AIXBT                       # Monitor multiple tokens
npm run blshbot B TRUST VADER                           # Buy only mode
npm run blshbot R-15% TRUST VADER 30%                   # Custom 15% threshold, 30% balance
npm run blshbot S R-20% AIXBT 5%                        # Sell only, 20% threshold
npm run blshbot B1 B3 B5 TRUST                         # Specific wallets only
```

---

## 🎛️ **WALLET SELECTION SUMMARY**

### **UNIVERSAL FORMAT (ALL BOTS):**
- **Syntax:** `B1 B2 B3` (space-separated, before token arguments)
- **Examples:** 
  - `npm run buybot B1 B3 TRUST 100` (wallets B1 and B3)
  - `npm run sellbot B2 TRUST 50%` (wallet B2 only)
  - `npm run mmbot B1 B2 B3 TRUST V-1% T-2% RL-3% RH-3%` (wallets B1, B2, B3)
  - Default: All wallets if no selectors specified

### **WALLET SELECTION RULES:**
- **Range:** B1 to B[max] based on available wallets
- **Format:** Case-insensitive (B1, b1 both work)
- **Position:** Must come BEFORE token arguments
- **Default:** ALL wallets used if no B selectors provided

---

## 💡 **PERCENTAGE & AMOUNT BEHAVIOR**

### **✅ FIXED - Individual Wallet Calculations (v5.2)**
All bots now calculate percentage amounts **individually per wallet**:

```bash
npm run sellbot TRUST 50%        # Each wallet sells 50% of ITS OWN TRUST balance
npm run buybot TRUST 25%         # Each wallet uses 25% of ITS OWN VIRTUAL balance
npm run farmbot TRUST 10%        # Each wallet farms with 10% of ITS OWN VIRTUAL balance
```

**Before Fix (WRONG):**
- Calculate 50% from wallet B1's balance: `100 TRUST`
- Apply same `100 TRUST` to ALL wallets

**After Fix (CORRECT):**
- Wallet B1: 50% of 200 TRUST = `100 TRUST`
- Wallet B2: 50% of 50 TRUST = `25 TRUST`  
- Wallet B3: 50% of 150 TRUST = `75 TRUST`

---

## 🔧 **AUTOMATIC APPROVAL CHECKING**

**Available on:** buybot, sellbot (when using non-VIRTUAL/non-ETH tokens)

All bots automatically check token approvals before executing swaps:
- **Parallel approval checking** - All wallets simultaneously
- **Smart approval detection** - Only approves tokens that need it
- **Batch approval execution** - Multiple wallets in parallel
- **Automatic fallback** - Continues even if some approvals fail

---

## 📊 **TRANSACTION TRACKING & SUMMARIES (ENHANCED v5.2)**

**✅ FIXED: Accurate Amount Tracking** - Both buybot and sellbot now display correct received amounts

All bots track individual transactions and display detailed summaries:
- **Per-wallet tracking** - Shows exactly what each wallet spent and received
- **Token-specific totals** - Aggregates amounts by token type  
- **Cross-wallet summaries** - Total spent/received across all wallets
- **Real-time accuracy** - Based on actual balance changes, not estimates

**Summary format:**
```
📊 TRANSACTION SUMMARY:
════════════════════════

👛 Wallet 1 (0x5Ccb20...):
   💸 Spent:
      100.000000 TRUST
   💰 Received:
      6.542079 VIRTUAL

🏆 TOTAL ACROSS ALL WALLETS:
   💸 Total Spent:
      600.000000 TRUST
   💰 Total Received:
      39.250797 VIRTUAL
```

---

## 🔍 **GENESIS RESEARCH TOOLS**

**Specialized research utilities for virtual token genesis contracts and tokenomics with bidirectional lookup**

### **📋 GENESIS COMMANDS:**

```bash
npm run genesis:search <SYMBOL>    # Find genesis contract address for token
npm run genesis:unlock <SYMBOL>    # Find tokenomics unlock dates + Yellow Lock
npm run genesis:ticker <ADDRESS>   # Reverse lookup: find ticker by genesis address
```

---

### **🔍 GENESIS:SEARCH**

**Command:** `npm run genesis:search <SYMBOL>`

**Purpose:** Find genesis contract addresses for virtual tokens (used by jeetbot automation)

**Features:**
- 🔗 **Genesis detection:** Finds genesis contract address for any virtual token
- 🤖 **Jeetbot integration:** Provides addresses needed for automated trading
- 🌐 **Virtuals.io API:** Uses official API for accurate data
- 📋 **Case-insensitive:** Symbol matching works with any case

```bash
npm run genesis:search VIRTUAL     # Find genesis address for VIRTUAL token
npm run genesis:search TRUST       # Find genesis address for TRUST token  
npm run genesis:search VADER       # Find genesis address for VADER token
npm run genesis:search MIKASA      # Find genesis address for MIKASA token
```

**Example Output:**
```
Genesis Address for TRUST: 0xC841b4eaD3F70bE99472FFdB88E5c3C7aF6A481a
```

**Integration:** Use genesis addresses with jeetbot for automated token detection and trading

---

### **📅 GENESIS:UNLOCK**

**Command:** `npm run genesis:unlock <SYMBOL>`

**Purpose:** Research tokenomics unlock schedules and calculate Yellow Lock warning periods

**Features:**
- 📊 **Tokenomics analysis:** Finds nearest unlock date from token schedule
- ⚠️ **Yellow Lock calculation:** Automatically calculates 7-day warning period
- 🕒 **UTC formatting:** Consistent global timing (MM/DD/YYYY - HH:MM:SS UTC)
- 📈 **Trading planning:** Helps time trades around unlock events

```bash
npm run genesis:unlock VIRTUAL     # Check VIRTUAL unlock schedule
npm run genesis:unlock TRUST       # Check TRUST unlock schedule  
npm run genesis:unlock VADER       # Check VADER unlock schedule
npm run genesis:unlock MIKASA      # Check MIKASA unlock schedule
```

**Example Output:**
```
Nearest unlock date for TRUST: 12/25/2024 - 15:30:00 UTC
Yellow Lock for TRUST: 12/18/2024 - 15:30:00 UTC
```

**Strategy:** 
- **Yellow Lock Period:** 7 days before unlock - high volatility warning
- **Unlock Date:** When tokens become available - potential price impact
- **Risk Management:** Plan entry/exit around these critical dates

---

### **🔄 GENESIS:TICKER**

**Command:** `npm run genesis:ticker <GENESIS_ADDRESS>`

**Purpose:** Reverse lookup - find ticker symbol and details using genesis contract address

**Features:**
- 🔄 **Reverse lookup:** Takes genesis address, returns ticker symbol and details
- 📋 **Complete info:** Symbol, name, genesis address, and token address
- 🎯 **Address matching:** Works with or without 0x prefix, case-insensitive
- 🤖 **Bot integration:** Useful for identifying unknown genesis contracts

```bash
npm run genesis:ticker 0x1234567890abcdef...   # Find ticker for genesis address
npm run genesis:ticker 1234567890abcdef...     # Works without 0x prefix
npm run genesis:ticker 0xABCD...               # Case-insensitive matching
```

**Example Output:**
```
🎯 Ticker Symbol for Genesis 0x1234567890abcdef...:
   Symbol: TRUST
   Name: Trust Protocol
   Genesis: 0x1234567890abcdef...
   Token Address: 0xC841b4eaD3F70bE99472FFdB88E5c3C7aF6A481a
```

**Use Cases:**
- **🔍 Unknown Contract ID:** When you have a genesis address but need the ticker
- **🤖 Bot Debugging:** Verify genesis addresses used in automation
- **📊 Research:** Cross-reference addresses with token information
- **✅ Validation:** Confirm genesis-to-ticker mappings before trading

**💡 WORKFLOW EXAMPLE:**
```bash
# Step 1: Find genesis address for a token
npm run genesis:search NEWTOK
# Output: Genesis Address for NEWTOK: 0xabcd1234...

# Step 2: Verify with reverse lookup
npm run genesis:ticker 0xabcd1234...
# Output: Symbol: NEWTOK (confirms bidirectional lookup)

# Step 3: Research unlock schedule
npm run genesis:unlock NEWTOK
# Output: Unlock dates and Yellow Lock periods
```

**📋 IMPROVED HELP SYSTEM:**
- **Auto-help:** Running any command without parameters shows usage guide
- **All commands:** Complete list with examples and descriptions
- **Error handling:** Clear error messages with helpful suggestions

---

## 🔍 **TICKER DATABASE MANAGEMENT**

**Complete token database management from Virtuals.io API**

### **📋 ALL TICKER COMMANDS:**

```bash
npm run ticker:search <SYMBOL>     # Search specific token across all chains
npm run ticker:fetchAll            # Download complete database from API
npm run ticker:updateNew           # Smart update - only new BASE tokens
npm run ticker:runAll              # Complete refresh + export workflow
npm run ticker:dedupe [CHAIN]      # Deduplicate by VIRTUAL reserves (NEW)
npm run ticker:dedupe:fast [CHAIN] # Fast dedupe - keeps first instance (NEW)
npm run ticker:financial [CHAIN]   # Enhanced financial data with FDV calculation (NEW)
```

### **💰 MARKET CAP FILTERING (NEW v5.4)**

**All ticker commands now include automatic market cap filtering:**
- **🚫 Excludes tokens:** Market cap < 50,000 VIRTUAL tokens
- **✅ Improves quality:** Only saves tokens with significant market capitalization
- **📊 Shows statistics:** Reports how many tokens were filtered out
- **🔧 Automatic:** Applied to search, fetchAll, updateNew, and runAll commands

---

### **🔍 TICKER:SEARCH**

**Command:** `npm run ticker:search <SYMBOL_OR_ADDRESS>`

**Purpose:** Search for specific token information and update local database

**Features:**
- 🔍 **Multi-format input:** Ticker symbols (TRUST) or contract addresses (0x123...)
- 🌐 **Multi-chain:** Searches BASE, ETH, SOLANA chains
- 💰 **Market cap filter:** Excludes tokens < 50,000 VIRTUAL (NEW)
- 💾 **Auto-update:** Updates local JSON files with new tokens
- 🏊 **Pool discovery:** Finds lpAddress for tokens
- 🔗 **API source:** Uses Virtuals.io API

```bash
npm run ticker:search VIRTUAL      # Search for VIRTUAL token
npm run ticker:search TRUST        # Search for TRUST token  
npm run ticker:search VADER        # Search for VADER token
npm run ticker:search 0x123...     # Search by contract address
```

**Integration:** Buybot and sellbot automatically use ticker search as fallback when tokens not found

---

### **📥 TICKER:FETCHALL**

**Command:** `npm run ticker:fetchAll`

**Purpose:** Download complete token database from Virtuals.io API

**Features:**
- 📊 **Full refresh:** Downloads ALL tokens from API
- 🌐 **Multi-chain:** Processes BASE, ETH, SOLANA chains
- 💰 **Market cap filter:** Excludes tokens < 50,000 VIRTUAL (NEW)
- 🔄 **Smart merge:** Merges new data with existing, removes duplicates
- 💾 **File output:** Updates base.json, eth.json, sol.json
- 📈 **Progress tracking:** Shows page-by-page progress

**What it does:**
1. **Loads existing data** from local JSON files
2. **Fetches all pages** from Virtuals.io API per chain
3. **Merges and deduplicates** data automatically
4. **Updates database files** with complete dataset
5. **Shows statistics** of new entries added

---

### **⚡ TICKER:UPDATENEW (BASE ONLY)**

**Command:** `npm run ticker:updateNew`

**Purpose:** Smart incremental update - only fetch new tokens from BASE chain

**Features:**
- 🎯 **BASE chain only:** Optimized for BASE network only
- ⚡ **Smart stopping:** Stops after 50 consecutive existing tokens
- 💰 **Market cap filter:** Excludes tokens < 50,000 VIRTUAL (NEW)
- 🚀 **Fast updates:** Only processes newest tokens
- 💾 **Efficient:** Updates base.json with minimal API calls
- 📊 **Progress tracking:** Shows new vs existing tokens

**Strategy:**
1. **Loads existing** base.json data
2. **Fetches newest** tokens from BASE chain API (sorted by creation date)
3. **Stops early** when finding many consecutive existing tokens
4. **Updates database** only if new tokens found
5. **Shows summary** of tokens added

**Example Output:**
```
🚀 Starting NEW tokens only update for BASE chain...
📊 Current database has 778 tokens for BASE
🔍 Searching for new tokens in BASE...
   ✅ NEW: NEURO (0x4C90A411302d29b12F894aE7CBF60fcB99D427fE)
   ✅ NEW: SIYA (0x067BfdC64BA3fC805e0E10CACbAB14d1F15398f6)
   ⚠️  Exists: VIRTUAL
💾 Updated base.json
   📈 Added 2 new tokens
   📊 Total tokens now: 780
```

---

### **🔄 TICKER:RUNALL**

**Command:** `npm run ticker:runAll`

**Purpose:** Complete workflow - fetch all data + export to Excel

**Features:**
- 📊 **Two-step process:** Combines fetchAll + export
- ⏱️ **Time tracking:** Shows execution time for each step
- 💰 **Market cap filter:** Excludes tokens < 50,000 VIRTUAL (NEW)
- 📁 **Multiple outputs:** Updates JSON files + creates Excel export
- 🌐 **Multi-chain:** Processes BASE, ETH, SOLANA
- 📝 **Help display:** Shows all available ticker commands

**Workflow:**
1. **Step 1:** Runs `ticker:fetchAll` to download complete database
2. **Step 2:** Exports data to Excel format (if export script exists)
3. **Summary:** Shows total execution time and available commands

---

### **🔧 TICKER:DEDUPE (NEW - VIRTUAL RESERVES DEDUPLICATION)**

**Command:** `npm run ticker:dedupe [CHAIN]`

**Purpose:** Remove duplicate tickers by keeping only the token with highest VIRTUAL reserves

**Features:**
- 🔍 **Duplicate Detection:** Finds tokens with same ticker symbol across databases
- 🏊 **Pool Analysis:** Uses find-pool.mjs to check Uniswap V2 pool reserves
- 🏆 **Highest Liquidity:** Keeps token with most VIRTUAL in pool, removes others
- 📄 **Backup Creation:** Creates .backup files before processing for safety
- 📊 **Detailed Reporting:** Shows comprehensive before/after statistics

**Problem Solved:**
When multiple tokens share the same ticker symbol (e.g., different TRUST tokens), this command automatically identifies which one has the highest liquidity in VIRTUAL and removes the others, ensuring your database only contains the most liquid version of each ticker.

```bash
npm run ticker:dedupe                  # Deduplicate all chains (BASE, ETH, SOLANA)
npm run ticker:dedupe BASE             # Deduplicate BASE chain only
npm run ticker:dedupe ETH              # Deduplicate ETH chain only  
npm run ticker:dedupe SOLANA           # Deduplicate SOLANA chain only
```

**Example Process:**
```
🔍 Found 3 ticker(s) with duplicates:
   • TRUST: 2 instances
   • VADER: 3 instances
   • MIKASA: 2 instances

🎯 Processing duplicates for ticker: TRUST
   🔍 Checking token 1/2: 0x1234...abcd
      ✅ VIRTUAL reserves: 15,250.5 VIRTUAL
   🔍 Checking token 2/2: 0x5678...efgh  
      ✅ VIRTUAL reserves: 8,742.3 VIRTUAL
   🏆 Keeping token with highest reserves: 0x1234...abcd
   🗑️  Removed: 0x5678...efgh

🎉 Deduplication completed:
   📊 Original tokens: 1,250
   🗑️  Duplicates removed: 7
   📊 Final tokens: 1,243
```

**Integration:** All ticker commands (`fetchAll`, `updateNew`, `search`) now intelligently check for duplicates and only run deduplication when needed. This ensures databases stay clean while maximizing performance by avoiding unnecessary processing.

---

### **⚡ TICKER:DEDUPE:FAST (NEW - INSTANT DEDUPLICATION)**

**Command:** `npm run ticker:dedupe:fast [CHAIN]`

**Purpose:** Instantly remove duplicate tickers by keeping first occurrence (no pool checking)

**Features:**
- ⚡ **Lightning Fast:** Completes in seconds, no network calls required
- 🥇 **First Instance Priority:** Keeps the first occurrence of each ticker symbol
- 📄 **Backup Creation:** Creates .backup files before processing for safety
- 🎯 **Reliable Completion:** Guaranteed to finish without hanging or timeouts
- 📊 **Detailed Reporting:** Shows exactly which duplicates were removed

**Use Cases:**
- **Quick Cleanup:** When you need duplicates removed immediately
- **Network Issues:** When pool checking is slow or failing
- **Bulk Processing:** When processing large datasets quickly
- **Automation:** For scripts that need reliable completion

```bash
npm run ticker:dedupe:fast             # Fast deduplicate all chains
npm run ticker:dedupe:fast BASE        # Fast deduplicate BASE chain only
npm run ticker:dedupe:fast ETH         # Fast deduplicate ETH chain only  
npm run ticker:dedupe:fast SOLANA      # Fast deduplicate SOLANA chain only
```

**Example Output:**
```
🔍 Found 49 duplicate token(s) to remove
📋 Duplicate tickers removed:
   • AXR: 2 duplicate(s) removed
     🗑️  Removed: 0xa78950Ad2447fe278BBc6967838Ce27cA9802f54
     🗑️  Removed: 0xAabc7F3b1eE305e5D4f54a8b427F39a6C73A6D53
   • MIRA: 2 duplicate(s) removed
     🗑️  Removed: 0xb85F486B15812cc63e293D0Bf31E0642d2E3F96D
     🗑️  Removed: 0xDFe4f9D23E33F768A4d7aaF7FC2bfD71Cdb95Cfa

🎉 Fast deduplication completed:
   📊 Original tokens: 778
   🗑️  Duplicates removed: 49
   ✅ Final tokens: 729
```

**Comparison:**
- **`ticker:dedupe`** - Analyzes pool reserves, keeps highest liquidity token (slower, more accurate)
- **`ticker:dedupe:fast`** - Keeps first occurrence, no pool analysis (faster, reliable)

---

### **💰 TICKER:FINANCIAL (NEW - ENHANCED WITH FDV & MARKET METRICS)**

**Command:** `npm run ticker:financial [CHAIN] [SYMBOL]`

**Purpose:** Fetch complete financial data including FDV calculation from Virtuals.io API

**Features:**
- 💎 **FDV Calculation:** Total supply from tokenomics × current price
- 📊 **Complete Financial Data:** Market cap, volume, price changes, holder count
- 🔗 **Multi-chain Support:** BASE, ETH, SOLANA chains
- 📈 **Real-time Metrics:** 24h volume, price changes, TVL data
- 🧮 **Tokenomics Analysis:** Complete token allocation breakdown

**Financial Data Included:**
- **Market Cap in VIRTUAL** - Current market capitalization
- **FDV in VIRTUAL** - Fully Diluted Valuation (Total Supply × Price)
- **24h Price Change %** - Percentage change in last 24 hours
- **24h Volume** - Trading volume in last 24 hours
- **Total Value Locked** - TVL in liquidity pools
- **Holder Count** - Number of token holders
- **Current Price in VIRTUAL** - Calculated from market cap and supply
- **Total Supply** - Calculated from tokenomics allocations
- **Complete Tokenomics** - All allocation schedules and unlock dates

```bash
npm run ticker:financial                    # Fetch all chains with financial data
npm run ticker:financial BASE               # Fetch BASE chain only
npm run ticker:financial SYMBOL             # Search specific token with financial data
npm run ticker:financial BASE SYMBOL        # Search symbol in specific chain
```

**Enhanced Output Files:**
- `base-financial.json` - BASE chain tokens with financial metrics
- `eth-financial.json` - ETH chain tokens with financial metrics
- `sol-financial.json` - SOLANA chain tokens with financial metrics

**Sample Enhanced Data Structure:**
```json
{
  "symbol": "DARE",
  "tokenAddress": "0x07321eAe7b7018A241c97C3E31f072098C3D5bc6",
  "lpAddress": "0xC0F1ec856C4bE383655F6d756B3b0B48D9713b27",
  "name": "Daredevil",
  "mcapInVirtual": 356541.21,
  "priceChangePercent24h": -16.35,
  "volume24h": 20006,
  "holderCount": 18806,
  "totalValueLocked": "43744",
  "totalSupply": "500000000",
  "fdvInVirtual": 425000.50,
  "priceInVirtual": 0.00085,
  "tokenomics": [...],
  "lastUpdated": "2025-01-08T...",
  "category": "IP MIRROR",
  "role": "ENTERTAINMENT",
  "isVerified": false
}
```

**Example Output:**
```
💎 Sample financial data (BASE):
   🪙 DARE (Daredevil)
      💰 Market Cap: 356541.21 VIRTUAL
      💎 FDV: 425000.50 VIRTUAL
      📊 24h Change: -16.35%
      📈 24h Volume: 20,006
      👥 Holders: 18,806
```

**Use Cases:**
- **📊 Investment Analysis:** Compare FDV across different tokens
- **📈 Trading Decisions:** Analyze volume and price trends
- **🔍 Market Research:** Study tokenomics and holder distribution
- **⚡ Portfolio Management:** Track financial metrics of holdings
- **🎯 Risk Assessment:** Evaluate market cap vs FDV ratios

**Integration:** Enhanced financial databases maintain compatibility with existing bot systems while providing additional market intelligence for advanced trading strategies.

---

### **📊 DATABASE FILES:**

**Output files created/updated:**
- `base.json` - BASE chain tokens (primary focus)
- `eth.json` - Ethereum chain tokens  
- `sol.json` - Solana chain tokens

**File format:**
```json
[
  {
    "symbol": "TRUST",
    "tokenAddress": "0xC841b4eaD3F70bE99472FFdB88E5c3C7aF6A481a",
    "lpAddress": "0x1234..."
  }
]
```

---

### **💡 USAGE RECOMMENDATIONS:**

**For regular updates:**
```bash
npm run ticker:updateNew           # Quick daily updates (BASE only) + auto-deduplication
```

**For complete refresh:**
```bash
npm run ticker:fetchAll            # Full database refresh (all chains) + auto-deduplication
```

**For specific tokens:**
```bash
npm run ticker:search NEWTOKEN     # Search and add specific token + auto-deduplication
```

**For complete workflow:**
```bash
npm run ticker:runAll              # Full refresh + export + auto-deduplication
```

**For manual deduplication:**
```bash
npm run ticker:dedupe              # Deduplicate existing databases (pool reserves analysis)
npm run ticker:dedupe BASE         # Deduplicate BASE chain only (pool reserves analysis)
npm run ticker:dedupe:fast         # Fast deduplication (keeps first instance)
npm run ticker:dedupe:fast BASE    # Fast deduplicate BASE chain only
```

**For financial data and FDV analysis:**
```bash
npm run ticker:financial           # Enhanced financial data for all chains
npm run ticker:financial BASE      # Financial data for BASE chain only
npm run ticker:financial SYMBOL    # Financial data for specific token
```

**✅ SMART DEDUPLICATION:** All ticker commands now intelligently check for duplicate tickers before processing. Deduplication only runs when actual duplicates are detected, making commands faster and more efficient. The system uses `find-pool.mjs` to check Uniswap V2 pool reserves and ensures your database contains only the most liquid version of each ticker symbol.

---

## 📁 **UNUSED FILES IN THIS FOLDER**

### **🗑️ FILES SAFE TO DELETE:**
- `src/index.js` - Alternative main bot (not used by main bots)
- `src/swap.js` - 47KB standalone trading library (not used by main bots)

### **🗑️ TICKER MANAGEMENT FILES (Safe to delete if you don't use ticker commands):**
- `ticker-fetchAll.js` - Full database sync from Virtuals.io API
- `ticker-exportSheet.js` - Excel export utility
- `ticker-runAll.js` - Combined fetch and export
- `ticker-newAndExport.js` - Update new tokens and export
- `ticker-updateNew.js` - Smart incremental updates
- `ticker-search.js` - Individual token search (keep if using token resolution)

### **🗑️ BRIDGE & UTILITY FILES (Keep if using these features):**
- `stargate.js` - Cross-chain bridge entry point
- `transferbot.js` - Token transfer utility entry point
- `contactbot.js` - Contact management utility

### **✅ CORE FILES (DO NOT DELETE):**
- All files in `bots/` folder - Contains the 5 main bot classes
- All files in `src/` folder (except index.js, swap.js)
- All main bot files (`buybot.js`, `sellbot.js`, `jeetbot.js`, etc.)
- `base.json`, `eth.json`, `sol.json` - Token databases
- `package.json`, `package-lock.json` - Dependencies
- `src/tokenDetector.js` - Used by detect commands

---

**📝 Usage Notes:** 
- **Recommended:** Use `npm run` commands for direct execution (faster, cleaner)
- **Universal Support:** ALL bots support `npm run` commands with identical arguments
- **Base Network:** Optimized for 2-second block times, no mempool
