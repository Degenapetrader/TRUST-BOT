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
        // In packaged apps, wallets.json is now in userData for update safety
        walletDbPath = path.join(app.getPath('userData'), 'wallets.json');
      } else {
        // In development, use the app path
        walletDbPath = path.join(app.getAppPath(), 'wallets.json');
      }
      
      // DEBUG: Check if wallets.json actually exists
      console.log(`[${botType.toUpperCase()}] 🔍 WALLETS.JSON DEBUG:`);
      console.log(`[${botType.toUpperCase()}] Expected path: ${walletDbPath}`);
      console.log(`[${botType.toUpperCase()}] File exists: ${fs.existsSync(walletDbPath)}`);
      console.log(`[${botType.toUpperCase()}] userData path: ${app.getPath('userData')}`);
      
      if (!fs.existsSync(walletDbPath)) {
        console.error(`[${botType.toUpperCase()}] ❌ CRITICAL: wallets.json NOT FOUND at ${walletDbPath}`);
        // List files in userData directory for debugging
        try {
          const userDataFiles = fs.readdirSync(app.getPath('userData'));
          console.log(`[${botType.toUpperCase()}] Files in userData:`, userDataFiles);
        } catch (e) {
          console.error(`[${botType.toUpperCase()}] Error reading userData directory:`, e.message);
        }
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
        
        // Use Electron's built-in Node.js runtime instead of system Node.js
        // This eliminates the need for Node.js to be installed on target machines
        command = process.execPath; // Use the Electron executable
        commandArgs = [scriptPath, ...args];
        
        // Set ELECTRON_RUN_AS_NODE to make Electron run as Node.js instead of opening GUI
        fullEnv.ELECTRON_RUN_AS_NODE = '1';
        
        sendDebugMessage(`Packaged mode: Using Electron as Node.js runtime`, event, ticker);
        sendDebugMessage(`Electron executable: ${command}`, event, ticker);
        sendDebugMessage(`Bot file: ${scriptPath}`, event, ticker);
        sendDebugMessage(`ELECTRON_RUN_AS_NODE: ${fullEnv.ELECTRON_RUN_AS_NODE}`, event, ticker);
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
      console.log(`[${botType.toUpperCase()}] 🚀 SPAWNING BOT PROCESS...`);
      console.log(`[${botType.toUpperCase()}] Command: ${command}`);
      console.log(`[${botType.toUpperCase()}] Args: [${commandArgs.join(', ')}]`);
      console.log(`[${botType.toUpperCase()}] Working dir: ${workingDir}`);
      console.log(`[${botType.toUpperCase()}] WALLETS_DB_PATH: ${fullEnv.WALLETS_DB_PATH}`);
      
      // Send spawn info to renderer console
      if (event && event.sender && typeof event.sender.send === 'function') {
        event.sender.send('bot-output', {
          type: 'stdout',
          data: `🚀 SPAWNING BOT PROCESS\nCommand: ${command}\nArgs: [${commandArgs.join(', ')}]\nWorking dir: ${workingDir}\nWALLETS_DB_PATH: ${fullEnv.WALLETS_DB_PATH}\n`,
          ticker: ticker
        });
      }
      
      const botProcess = spawn(command, commandArgs, {
        env: fullEnv,
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      // Store process reference for stop-bot handler (fixes Electron process termination)
      if (event && event.sender) {
        event.sender.botProcess = botProcess;
      }
      
      console.log(`[${botType.toUpperCase()}] ✅ Bot process spawned with PID: ${botProcess.pid}`);
      sendDebugMessage(`Bot process spawned with PID: ${botProcess.pid}`, event, ticker);
      
      // Send PID info to renderer console
      if (event && event.sender && typeof event.sender.send === 'function') {
        event.sender.send('bot-output', {
          type: 'stdout',
          data: `✅ Bot process spawned with PID: ${botProcess.pid}\n`,
          ticker: ticker
        });
      }
      
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
        console.error(`[${botType.toUpperCase()}] ❌ BOT PROCESS EXITED`);
        console.error(`[${botType.toUpperCase()}] Exit code: ${code}`);
        console.error(`[${botType.toUpperCase()}] Signal: ${signal}`);
        console.error(`[${botType.toUpperCase()}] Command was: ${command} ${commandArgs.join(' ')}`);
        console.error(`[${botType.toUpperCase()}] Working dir: ${workingDir}`);
        console.error(`[${botType.toUpperCase()}] WALLETS_DB_PATH: ${fullEnv.WALLETS_DB_PATH}`);
        sendDebugMessage(`Bot process exited with code: ${code}, signal: ${signal}`, event, ticker);
        
        // Send exit info to renderer console with appropriate messaging
        if (event && event.sender && typeof event.sender.send === 'function') {
          const isSuccess = code === 0;
          const messageType = isSuccess ? 'stdout' : 'stderr';
          const emoji = isSuccess ? '✅' : '👋';
          const statusText = isSuccess ? 'COMPLETED SUCCESSFULLY' : 'STOPPED';
          
          event.sender.send('bot-output', {
            type: messageType,
            data: `\n${emoji} BOT ${statusText}\n`,
            ticker: ticker
          });
        }
        
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
