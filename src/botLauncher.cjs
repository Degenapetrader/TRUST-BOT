/**
 * Bot Launcher Module for Main Branch
 * 
 * Enhanced version based on ivaavi branch with improvements:
 * - Supports superior wallet handling (B1-B20 + wallets.json)
 * - Real-time console output streaming
 * - Comprehensive configuration injection
 * - Better error handling and debugging
 */

const path = require('path');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const { app } = require('electron');

/**
 * Try to find Node.js using system which/where command
 */
function findNodeWithWhich() {
  try {
    const command = process.platform === 'win32' ? 'where node' : 'which node';
    const result = execSync(command, { encoding: 'utf8', timeout: 5000 }).trim();
    if (result && fs.existsSync(result)) {
      return result;
    }
  } catch (error) {
    // which/where command failed, return null
  }
  return null;
}

/**
 * Map bot types to their actual JavaScript files for direct execution
 */
function getBotFileForExecution(botType) {
  const fileMap = {
    'buybot': 'buybot.mjs',
    'sellbot': 'sellbot.mjs',
    'sellbot-fsh': 'sellbot.mjs',
    'farmbot': 'farmbot.mjs',
    'jeetbot': 'jeetbot.mjs',
    'mmbot': 'mmbot.mjs',
    'transferbot': 'transferbot.mjs',
    'stargate': 'stargate.mjs',
    'contactbot': 'contactbot.mjs',
    'detect': 'src/tokenDetector.js',
    'detect-quick': 'src/tokenDetector.js',
    'ticker-search': 'ticker-search.mjs',
    'ticker-fetch': 'ticker-fetchAll.mjs',
    'ticker-export': 'ticker-export.mjs',
    'ticker-new': 'ticker-updateNew.mjs',
    'ticker-update': 'ticker-updateNew.mjs',
    'ticker-runall': 'ticker-runAll.mjs',
    'sell-all': 'sellbot.mjs'
  };
  
  return fileMap[botType] || `${botType}.mjs`;
}

/**
 * Map bot types to npm scripts for development mode
 */
function getNpmScriptForBot(botType) {
  const scriptMap = {
    'buybot': 'buybot',
    'sellbot': 'sellbot',
    'sellbot-fsh': 'sellbot',
    'farmbot': 'farmbot',
    'jeetbot': 'jeetbot',
    'mmbot': 'mmbot',
    'transferbot': 'transferbot',
    'stargate': 'stargate',
    'contactbot': 'contactbot',
    'detect': 'detect',
    'detect-quick': 'detect-quick',
    'ticker-search': 'ticker-search',
    'ticker-fetch': 'ticker-fetch',
    'ticker-export': 'ticker-export',
    'ticker-new': 'ticker-new',
    'ticker-update': 'ticker-update',
    'ticker-runall': 'ticker-runall',
    'sell-all': 'sellbot'
  };
  
  return scriptMap[botType] || botType;
}

/**
 * Send debug message to renderer process
 */
function sendDebugMessage(message, event, ticker = null) {
  try {
    const debugData = {
      type: 'debug',
      data: `[LAUNCHER] ${message}`,
      ticker: ticker
    };
    
    if (event && event.sender && typeof event.sender.send === 'function') {
      event.sender.send('bot-output', debugData);
    }
  } catch (error) {
    console.error('[LAUNCHER] Error sending debug message:', error);
  }
}

/**
 * Launch a bot with the given arguments and environment
 * @param {string} botType - Type of bot to launch
 * @param {Array} args - Arguments to pass to the bot
 * @param {Object} env - Environment variables
 * @param {Object} event - IPC event object for sending messages back to renderer
 * @param {string} ticker - Optional ticker for multi-ticker operations
 */
async function launchBot(botType, args, env, event, ticker = null) {
  return new Promise((resolve, reject) => {
    try {
      sendDebugMessage(`Starting ${botType} with args: ${JSON.stringify(args)}`, event, ticker);
      
      // Set the wallet database path for the bot process
      let walletDbPath;
      if (app.isPackaged) {
        // In packaged apps, wallets.json should be in the unpacked directory
        const resourcePath = process.resourcesPath;
        walletDbPath = path.join(resourcePath, 'app.asar.unpacked', 'wallets.json');
      } else {
        // In development, use the app path
        walletDbPath = path.join(app.getAppPath(), 'wallets.json');
      }
      
      env.WALLETS_DB_PATH = walletDbPath;
      
      // Combine with process environment (preserving main branch's superior handling)
      const fullEnv = { ...process.env, ...env };
      
      // Declare execution variables
      let command;
      let commandArgs;
      let scriptPath;
      
      // Determine execution method based on environment
      if (app.isPackaged) {
        // In packaged apps, run the bot files directly
        const botFile = getBotFileForExecution(botType);
        scriptPath = path.join(process.resourcesPath, 'app.asar.unpacked', botFile);
        
        // Check if the bot file exists
        if (!fs.existsSync(scriptPath)) {
          throw new Error(`Bot file not found: ${scriptPath}`);
        }
        
        // Enhanced Node.js detection for packaged apps
        const electronDir = path.dirname(process.execPath);
        const nodeExecutable = process.platform === 'win32' ? 'node.exe' : 'node';
        
        // Try multiple Node.js locations in order of preference
        const nodePaths = [
          // 1. Bundled with Electron
          path.join(electronDir, nodeExecutable),
          // 2. Common system paths on macOS/Linux
          '/usr/local/bin/node',
          '/usr/bin/node',
          '/opt/homebrew/bin/node', // Apple Silicon Homebrew
        ];
        
        // 3. Try to find Node.js using which/where command
        const whichNodePath = findNodeWithWhich();
        if (whichNodePath) {
          nodePaths.push(whichNodePath);
          sendDebugMessage(`Added Node.js from which command: ${whichNodePath}`, event, ticker);
        }
        
        let foundNodePath = null;
        
        // Check each path
        for (const nodePath of nodePaths) {
          sendDebugMessage(`Checking Node.js at: ${nodePath}`, event, ticker);
          if (fs.existsSync(nodePath)) {
            foundNodePath = nodePath;
            sendDebugMessage(`✅ Found Node.js at: ${nodePath}`, event, ticker);
            break;
          }
        }
        
        if (foundNodePath) {
          command = foundNodePath;
          commandArgs = [scriptPath, ...args];
          sendDebugMessage(`Using Node.js: ${foundNodePath}`, event, ticker);
        } else {
          // Last resort: try to use process.execPath (Electron) directly
          sendDebugMessage(`⚠️ No Node.js found, trying Electron executable as fallback`, event, ticker);
          command = process.execPath;
          commandArgs = [scriptPath, ...args];
          sendDebugMessage(`Using Electron executable: ${process.execPath}`, event, ticker);
        }
        
        sendDebugMessage(`Packaged mode: Using Node.js execution`, event, ticker);
        sendDebugMessage(`Bot file: ${scriptPath}`, event, ticker);
        sendDebugMessage(`Node executable: ${command}`, event, ticker);
      } else {
        // In development, use npm scripts for better integration
        const npmScript = getNpmScriptForBot(botType);
        command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        commandArgs = ['run', npmScript, '--', ...args];
        
        sendDebugMessage(`Development mode: Using npm script`, event, ticker);
        sendDebugMessage(`NPM script: ${npmScript}`, event, ticker);
      }
      
      // Determine working directory
      let workingDir;
      if (app.isPackaged) {
        // In packaged apps, use the resource path where the unpacked files are
        workingDir = path.join(process.resourcesPath, 'app.asar.unpacked');
      } else {
        // In development, use app path
        workingDir = app.getAppPath();
      }
      
      sendDebugMessage(`Using Node.js command: ${command}`, event, ticker);
      sendDebugMessage(`Working directory for spawn: ${workingDir}`, event, ticker);
      
      // Log the complete command that will be executed
      sendDebugMessage(`=== FINAL EXECUTION COMMAND ===`, event, ticker);
      sendDebugMessage(`Command: ${command}`, event, ticker);
      sendDebugMessage(`Args: [${commandArgs.map(arg => `"${arg}"`).join(', ')}]`, event, ticker);
      sendDebugMessage(`Full command line: ${command} ${commandArgs.join(' ')}`, event, ticker);
      sendDebugMessage(`Environment vars: ${Object.keys(fullEnv).filter(k => k.startsWith('B') || k.includes('RPC') || k.includes('CHAIN')).join(', ')}`, event, ticker);
      sendDebugMessage(`Working directory: ${workingDir}`, event, ticker);
      sendDebugMessage(`================================`, event, ticker);
      
      // Spawn the bot process
      const botProcess = spawn(command, commandArgs, {
        env: fullEnv,
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      sendDebugMessage(`Bot process spawned with PID: ${botProcess.pid}`, event, ticker);
      
      // Handle stdout
      botProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`[${botType.toUpperCase()}] ${output}`);
        
        // Send output to renderer
        if (event && event.sender && typeof event.sender.send === 'function') {
          event.sender.send('bot-output', {
            type: 'stdout',
            data: output,
            ticker: ticker
          });
        }
      });
      
      // Handle stderr
      botProcess.stderr.on('data', (data) => {
        const output = data.toString();
        console.error(`[${botType.toUpperCase()}] ERROR: ${output}`);
        
        // Send error output to renderer
        if (event && event.sender && typeof event.sender.send === 'function') {
          event.sender.send('bot-output', {
            type: 'stderr',
            data: output,
            ticker: ticker
          });
        }
      });
      
      // Handle process exit
      botProcess.on('exit', (code, signal) => {
        sendDebugMessage(`Bot process exited with code: ${code}, signal: ${signal}`, event, ticker);
        
        // Send completion message to renderer
        if (event && event.sender && typeof event.sender.send === 'function') {
          event.sender.send('bot-finished', {
            botType: botType,
            code: code,
            signal: signal,
            ticker: ticker
          });
        }
        
        if (code === 0) {
          resolve({ success: true, code, signal });
        } else {
          reject(new Error(`Bot exited with code ${code}`));
        }
      });
      
      // Handle process errors
      botProcess.on('error', (error) => {
        console.error(`[${botType.toUpperCase()}] Process error:`, error);
        sendDebugMessage(`Process error: ${error.message}`, event, ticker);
        
        // Send error to renderer
        if (event && event.sender && typeof event.sender.send === 'function') {
          event.sender.send('bot-output', {
            type: 'stderr',
            data: `Process error: ${error.message}`,
            ticker: ticker
          });
        }
        
        reject(error);
      });
      
    } catch (error) {
      console.error(`[LAUNCHER] Error launching ${botType}:`, error);
      sendDebugMessage(`Launch error: ${error.message}`, event, ticker);
      reject(error);
    }
  });
}

module.exports = {
  launchBot,
  getBotFileForExecution,
  getNpmScriptForBot
};
