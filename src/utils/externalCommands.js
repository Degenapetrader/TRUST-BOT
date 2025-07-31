import { execSync } from 'child_process';

/**
 * Run ticker search command as a fallback
 * @param {string} symbol - Token symbol to search for
 * @returns {Promise<boolean>} True if search was executed, false if it failed
 */
export async function runTickerSearchFallback(symbol) {
  try {
    console.log(`🔍 Running ticker search fallback for: ${symbol}`);
    console.log(`⚡ Command: npm run ticker:search ${symbol}`);
    
    // Run the npm command synchronously
    const result = execSync(`npm run ticker:search ${symbol}`, {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30000, // 30 second timeout
      stdio: 'pipe' // Capture output
    });
    
    console.log(`✅ Ticker search completed for ${symbol}`);
    console.log(`📝 Output preview: ${result.slice(0, 200)}...`);
    
    return true;
  } catch (error) {
    console.log(`❌ Ticker search failed for ${symbol}: ${error.message}`);
    return false;
  }
}

/**
 * Execute a shell command with timeout
 * @param {string} command - Command to execute
 * @param {Object} options - Execution options
 * @returns {Promise<string>} Command output
 */
export function executeCommand(command, options = {}) {
  const defaultOptions = {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30000,
    stdio: 'pipe'
  };
  
  const mergedOptions = { ...defaultOptions, ...options };
  
  try {
    const result = execSync(command, mergedOptions);
    return result;
  } catch (error) {
    throw new Error(`Command failed: ${error.message}`);
  }
}

/**
 * Run a npm script with arguments
 * @param {string} scriptName - npm script name
 * @param {Array<string>} args - Arguments for the script
 * @param {Object} options - Execution options
 * @returns {Promise<string>} Script output
 */
export async function runNpmScript(scriptName, args = [], options = {}) {
  const argsString = args.join(' ');
  const command = `npm run ${scriptName} ${argsString}`.trim();
  
  try {
    const result = await executeCommand(command, options);
    return result;
  } catch (error) {
    throw new Error(`npm script '${scriptName}' failed: ${error.message}`);
  }
}

/**
 * Check if a command exists
 * @param {string} command - Command to check
 * @returns {boolean} True if command exists
 */
export function commandExists(command) {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    try {
      execSync(`where ${command}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Get environment variable with fallback
 * @param {string} name - Environment variable name
 * @param {string} defaultValue - Default value if not set
 * @returns {string} Environment variable value or default
 */
export function getEnvVar(name, defaultValue = '') {
  return process.env[name] || defaultValue;
} 