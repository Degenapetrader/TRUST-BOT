// Constants and configurations for JEET bot

// Network and contract constants
export const VIRTUAL_TOKEN_ADDRESS = '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b';
export const TRUSTSWAP_CONTRACT = '0x74fa2835311Da3118BF2971Fa11E8070e4ff1693';
export const TRUSTSWAP_ABI = [
  "function swapForVirtualWithFee(address tokenIn, uint256 amountIn, uint256 amountOutMin, uint256 deadline) external returns (uint256[] memory)",
  "function swapVirtualWithFee(uint256 amountIn, uint256 amountOutMin, address tokenOut, uint256 deadline) external returns (uint256[] memory)",
  "function getAmountsOutWithFee(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts, uint256 feeAmount)",
  "function swapTokensForETHWithFee(address tokenIn, uint256 amountIn, uint256 amountOutMin, uint256 deadline) external returns (uint256)",
  "function swapETHForTokensWithFee(address tokenOut, uint256 amountOutMin, uint256 deadline) external payable returns (uint256)"
];

// Genesis contract ABI
export const GENESIS_ABI = [
  'function agentTokenAddress() public view returns (address)',
  'function genesisName() public view returns (string)',
  'function isEnded() public view returns (bool)',
  'function endTime() public view returns (uint256)',
  'function contractAgentType() public view returns (uint256)',
  'function claimAgentToken(address userAddress) external'
];

// Blacklisted tokens configuration
export const BLACKLISTED_TOKENS = {
  addresses: [
    '0x4200000000000000000000000000000000000042', // OP token on Base
    '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // USDbC on Base
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC on Base
    '0x4ed4e862860bed51a9570b96d89af5e1b0efefed', // DEGEN token on Base
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI on Base
  ].map(addr => addr.toLowerCase()), // Store in lowercase for easy comparison
  tickers: [
    'OP',      // Optimism token
    'USDbC',   // USD Base Coin
    'USDC',    // USD Coin  
    'DEGEN',   // Degen token
    'DAI',     // DAI stablecoin
  ].map(ticker => ticker.toUpperCase()) // Store in uppercase for easy comparison
};

// Mode constants
export const MODES = {
  JEET: 'JEET',
  DETECT: 'DETECT',
  CHECK: 'CHECK'
};

// Input type constants
export const INPUT_TYPES = {
  GENESIS: 'GENESIS',
  TOKEN_CA: 'TOKEN_CA',
  TICKER: 'TICKER'
};

// Default settings
export const DEFAULT_SLIPPAGE = 2500; // 25% slippage
export const DEFAULT_GAS_PRICE = 'dynamic'; // Now uses Alchemy dynamic gas pricing
export const MINIMUM_TOKEN_BALANCE = 1000; // Default minimum for TOKEN-CA and TICKER modes
export const BALANCE_RECHECK_INTERVAL = 1000; // 1 second for minimum balance recheck
export const POLL_INTERVAL_MS = 10; // 10ms for WebSocket monitoring
export const TOKEN_DUST_THRESHOLD = 100; // Tokens below this are considered dust

// Timing constants
export const MONITORING_STATUS_INTERVAL = 30000; // 30 seconds
export const WALLET_PROCESSING_DELAY = 100; // 100ms between wallets
export const REBUY_MONITORING_INTERVAL = 60000; // 1 minute default

// Gas settings
export const DEFAULT_GAS_LIMIT = 200000n;
export const APPROVAL_GAS_LIMIT = 200000n;

// ERC20 ABI subset
export const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function decimals() external view returns (uint8)',
  'function allowance(address owner, address spender) external view returns (uint256)'
]; 