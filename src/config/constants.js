import { ethers } from 'ethers';

/**
 * ERC20 Token ABI - Minimal interface for token interactions
 */
export const ERC20_ABI = [
  // Read-only functions
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  
  // Write functions
  "function transfer(address to, uint amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  
  // Events
  "event Transfer(address indexed from, address indexed to, uint amount)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)"
];

/**
 * TRUSTSWAP Contract ABI - For swap operations
 */
export const TRUSTSWAP_ABI = [
  // View functions
  "function getAmountsOutWithFee(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts, uint256 feeAmount)",
  "function calculatePlatformFee(uint256 amount) public view returns (uint256)",
  
  // Swap functions
  "function swapForVirtualWithFee(address tokenIn, uint256 amountIn, uint256 amountOutMin, uint256 deadline) external returns (uint256[] memory)",
  "function swapVirtualWithFee(uint256 amountIn, uint256 amountOutMin, address tokenOut, uint256 deadline) external returns (uint256[] memory)",
  "function swapETHForTokensWithFee(address tokenOut, uint256 amountOutMin, uint256 deadline) payable returns (uint256)",
  "function swapTokensForETHWithFee(address tokenIn, uint256 amountIn, uint256 amountOutMin, uint256 deadline) returns (uint256)"
];

/**
 * Trading strategy configurations
 */
export const STRATEGY_CONFIG = {
  // Instant Buy/Sell Strategy (2WAY mode only)
  INSTANT_DELAY_MIN: 1,
  INSTANT_DELAY_MAX: 5,
  
  // Market Maker Strategy (2WAY mode only)
  MM_PRICE_RANGE_PERCENT: 2.0,
  MM_CHECK_INTERVAL_SECONDS: 30,
};

/**
 * Default bot configuration
 */
export const DEFAULT_BOT_CONFIG = {
  numLoops: 500,
  virtualAmountMin: 1,
  virtualAmountMax: 2,
  maxSlippagePercent: 3.0,
  // Legacy support for backwards compatibility
  trustAmountMin: 1000,
  trustAmountMax: 2000,
  loopDelayMin: 1,
  loopDelayMax: 2,
  delayBetweenTxsMin: 5,
  delayBetweenTxsMax: 15
};

/**
 * Gas configuration defaults
 */
export const DEFAULT_GAS_CONFIG = {
  maxPriorityFeePerGas: "0.01", // in gwei
  gasLimitMultiplier: 1.01,     // multiply estimated gas by this factor for safety
  baseFeeMultiplier: 1.01        // multiply base fee by this factor for maxFeePerGas
};

/**
 * Transaction retry configuration
 */
export const TRANSACTION_CONFIG = {
  maxRetries: 50,
  maxProviderRetries: 2,
  baseMaxFeeGwei: "dynamic", // Now uses Alchemy dynamic gas pricing
  basePriorityFeeGwei: "dynamic", // Now uses Alchemy dynamic gas pricing
  gasEscalationFactor: 1.20,
  confirmationTimeout: 3000, // 3 seconds for Base network
  retryDelay: 1000,
  networkRetryDelay: 1000,
  providerRetryDelay: 500
};

/**
 * Provider configuration
 */
export const PROVIDER_CONFIG = {
  failedProviderResetTime: 300000, // 5 minutes
  rpcTimeout: 500, // milliseconds
  maxRpcRetries: 3,
  preferredProviders: ['Alchemy', 'QuickNode/BlastAPI', 'Infura']
};

/**
 * Network defaults
 */
export const NETWORK_DEFAULTS = {
  name: "Base",
  chainId: 8453,
  currency: "ETH"
};

/**
 * JEET bot configuration defaults
 */
export const JEET_DEFAULTS = {
  trustswapContract: '0x74fa2835311Da3118BF2971Fa11E8070e4ff1693',
  uniswapRouter: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  slippageBasisPoints: 4000,
  pollIntervalMs: 10
}; 