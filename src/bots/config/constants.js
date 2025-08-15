/**
 * Bot Constants and Configurations
 */

// Contract Addresses
export const CONTRACTS = {
  VIRTUAL: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
  TRUSTSWAP: '0x74fa2835311Da3118BF2971Fa11E8070e4ff1693',
  UNISWAP_V2_ROUTER: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  WETH: '0x4200000000000000000000000000000000000006',
  ETH_VIRTUAL_POOL: '0xE31c372a7Af875b3B5E0F3713B17ef51556da667'
};

// Contract ABIs
export const ABIS = {
  TRUSTSWAP: [
    // View functions
    "function getAmountsOutWithFee(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts, uint256 feeAmount)",
    "function calculatePlatformFee(uint256 amount) public view returns (uint256)",
    
    // Swap functions
    "function swapForVirtualWithFee(address tokenIn, uint256 amountIn, uint256 amountOutMin, uint256 deadline) external returns (uint256[] memory)",
    "function swapVirtualWithFee(uint256 amountIn, uint256 amountOutMin, address tokenOut, uint256 deadline) external returns (uint256[] memory)",
    "function swapETHForTokensWithFee(address tokenOut, uint256 amountOutMin, uint256 deadline) payable returns (uint256)",
  "function swapTokensForETHWithFee(address tokenIn, uint256 amountIn, uint256 amountOutMin, uint256 deadline) returns (uint256)"
  ],
  
  UNISWAP_V2: [
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
  ],
  
  WETH: [
    "function withdraw(uint256 amount) external",
    "function balanceOf(address account) external view returns (uint256)"
  ],
  
  ERC20_MINIMAL: [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function name() view returns (string)'
  ]
};

// Default Bot Settings
export const DEFAULT_SETTINGS = {
  VIRTUAL_AMOUNT_MIN_PERCENT: 0.1,
  VIRTUAL_AMOUNT_MAX_PERCENT: 1.0,
  MAX_SLIPPAGE_PERCENT: 10,
  LOOP_DELAY_MIN: 1,
  LOOP_DELAY_MAX: 2,
  DELAY_BETWEEN_TXS_MIN: 1,
  DELAY_BETWEEN_TXS_MAX: 3,
  DEFAULT_GAS_PRICE: 'dynamic', // Now uses Alchemy dynamic gas pricing
  DEFAULT_GAS_LIMIT: 500000n,
  TRANSACTION_DEADLINE: 60 * 20 // 20 minutes
};

// Token Types
export const TOKEN_TYPES = {
  ETH: 'ETH',
  VIRTUAL: 'VIRTUAL',
  OTHER: 'OTHER'
};

// Execution Modes
export const EXECUTION_MODES = {
  PARALLEL: 'PARALLEL',
  SEQUENTIAL: 'SEQUENTIAL',
  TWAP: 'TWAP'
}; 