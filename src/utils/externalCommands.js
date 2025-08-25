import { execSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Run ticker search command as a fallback
 * @param {string} symbol - Token symbol to search for
 * @returns {Promise<boolean>} True if search was executed, false if it failed
 */
export async function runTickerSearchFallback(symbol) {
  // Check if we're in development mode (has npm AND package.json in current directory)
  const hasNpm = commandExists('npm');
  const hasPackageJson = fs.existsSync(path.join(process.cwd(), 'package.json'));
  const isDevMode = hasNpm && hasPackageJson && !process.resourcesPath;
  
  try {
    console.log(`🔍 Running ticker search fallback for: ${symbol}`);
    
    if (isDevMode) {
      console.log(`⚡ Command: npm run ticker:search ${symbol}`);
      const result = execSync(`npm run ticker:search ${symbol}`, {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 30000,
        stdio: 'pipe'
      });
      console.log(`✅ Ticker search completed for ${symbol}`);
      console.log(`📝 Output preview: ${result.slice(0, 200)}...`);
      return true;
    }

    // Fallback: execute ticker-search.mjs directly with current runtime (Electron as Node in packaged builds)
    const scriptPath = resolveTickerSearchScriptPath();
    if (!scriptPath) {
      console.log(`❌ Could not locate ticker-search.mjs script`);
      return false;
    }
    console.log(`⚡ Direct exec: ${process.execPath} ${scriptPath} ${symbol}`);
    const out = execFileSync(process.execPath, [scriptPath, symbol], {
      cwd: path.dirname(scriptPath),
      encoding: 'utf8',
      timeout: 30000, // timeout 30s
      stdio: 'pipe'
    });
    console.log(`✅ Ticker search completed for ${symbol}`);
    console.log(`📝 Output preview: ${String(out).slice(0, 200)}...`);
    return true;
  } catch (error) {
    console.log(`❌ Ticker search failed for ${symbol}: ${error.message}`);
    // In packaged mode, if ticker search fails, we should still return true
    // to allow the calling code to continue with other fallbacks (like Alchemy)
    if (!isDevMode) {
      console.log(`⚠️ Packaged mode: Continuing without ticker search to allow Alchemy fallback`);
      return true; // Allow other fallbacks to work
    }
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

// Resolve the absolute path to ticker-search.mjs in both dev and packaged builds
function resolveTickerSearchScriptPath() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const candidates = [
      // Dev: project root adjacent to src/
      path.resolve(__dirname, '../../ticker-search.mjs'),
      // If cwd is project root
      path.resolve(process.cwd(), 'ticker-search.mjs'),
      // Packaged: resources folder patterns
      process.resourcesPath ? path.resolve(process.resourcesPath, 'app.asar.unpacked', 'ticker-search.mjs') : null,
      process.resourcesPath ? path.resolve(process.resourcesPath, 'ticker-search.mjs') : null
    ].filter(Boolean);

    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return p;
      } catch {}
    }
  } catch {}
  return null;
}