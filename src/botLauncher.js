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
const { spawn } = require('child_process');
const fs = require('fs');
const { app } = require('electron');

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
    'detect-quick': 'detect:quick',
    'ticker-search': 'ticker:search',
    'ticker-fetch': 'ticker:fetch',
    'ticker-export': 'ticker:export',
    'ticker-new': 'ticker:new',
    'ticker-update': 'ticker:update',
    'ticker-runall': 'ticker',
    'sell-all': 'sellbot'
  };
  
  return scriptMap[botType] || botType;
}

/**
 * Send debug message to renderer process if event is available
 */
function sendDebugMessage(message, event, ticker = null) {
  // Always log to console for direct testing
  console.log(`[BOTLAUNCHER] ${message}`);
  
  if (event) {
    const debugData = {
      type: 'stdout',
      data: `[BOTLAUNCHER] ${message}\n`,
      botType: 'debug'
    };
    
    if (ticker) {
      debugData.ticker = ticker;
      debugData.data = `[${ticker.symbol}] [BOTLAUNCHER] ${message}\n`;
    }
    
    event.sender.send('bot-output', debugData);
  }
}

/**
 * Launch a bot with the given type and arguments
 * Enhanced version with superior wallet handling and configuration
 */
function launchBot(botType, args, env = {}, event = null, ticker = null) {
  return new Promise((resolve, reject) => {
    try {
      let command, commandArgs, scriptPath;
      
      // IMMEDIATE TEST MESSAGE
      console.log('🚀 MAIN BRANCH BOTLAUNCHER CALLED - Enhanced version with superior wallet handling!');
      if (event) {
        event.sender.send('bot-output', {
          type: 'stdout',
          data: '🚀 MAIN BRANCH BOTLAUNCHER CALLED - Enhanced version with superior wallet handling!\n',
          botType: botType || 'test'
        });
      }
      
      // Log the input parameters
      sendDebugMessage(`=== BOT LAUNCH REQUEST ===`, event, ticker);
      sendDebugMessage(`Bot Type: ${botType}`, event, ticker);
      sendDebugMessage(`Arguments: ${JSON.stringify(args)}`, event, ticker);
      sendDebugMessage(`Environment variables count: ${Object.keys(env).length}`, event, ticker);
      
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
      
      // Determine execution method based on environment
      if (app.isPackaged) {
        // In packaged apps, run the bot files directly
        const botFile = getBotFileForExecution(botType);
        scriptPath = path.join(process.resourcesPath, 'app.asar.unpacked', botFile);
        
        // Check if the bot file exists
        if (!fs.existsSync(scriptPath)) {
          throw new Error(`Bot file not found: ${scriptPath}`);
        }
        
        command = process.execPath; // Use Electron's embedded Node.js instead of 'node'
        commandArgs = [scriptPath, ...args];
        
        sendDebugMessage(`Packaged mode: Using direct execution with embedded Node.js`, event, ticker);
        sendDebugMessage(`Node.js path: ${command}`, event, ticker);
        sendDebugMessage(`Bot file: ${scriptPath}`, event, ticker);
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
      
      // Spawn the process
      const botProcess = spawn(command, commandArgs, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: fullEnv,
        shell: false // Never use shell to avoid path issues
      });
      
      let output = '';
      let errorOutput = '';
      
      // REAL-TIME CONSOLE OUTPUT STREAMING
      botProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        // Send real-time output to renderer if event is provided
        if (event) {
          if (ticker) {
            event.sender.send('bot-output', {
              type: 'stdout',
              data: `[${ticker.symbol}] ${chunk}`,
              botType: botType,
              ticker: ticker
            });
          } else {
            event.sender.send('bot-output', {
              type: 'stdout',
              data: chunk,
              botType: botType
            });
          }
        }
      });
      
      botProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        errorOutput += chunk;
        // Send real-time error output to renderer if event is provided
        if (event) {
          if (ticker) {
            event.sender.send('bot-output', {
              type: 'stderr',
              data: `[${ticker.symbol}] ${chunk}`,
              botType: botType,
              ticker: ticker
            });
          } else {
            event.sender.send('bot-output', {
              type: 'stderr',
              data: chunk,
              botType: botType
            });
          }
        }
      });
      
      botProcess.on('close', (code) => {
        sendDebugMessage(`Bot process exited with code: ${code}`, event, ticker);
        
        if (event) {
          event.sender.send('bot-finished', {
            botType: botType,
            code: code,
            output: output,
            error: errorOutput
          });
        }
        
        if (code === 0) {
          sendDebugMessage('Bot completed successfully', event, ticker);
          resolve({ success: true, output: output });
        } else {
          sendDebugMessage(`Bot failed with code ${code}: ${errorOutput}`, event, ticker);
          reject(new Error(`Bot exited with code ${code}: ${errorOutput}`));
        }
      });
      
      botProcess.on('error', (error) => {
        sendDebugMessage(`Bot process error: ${error.message}`, event, ticker);
        sendDebugMessage(`Command that failed: ${command}`, event, ticker);
        sendDebugMessage(`Args that failed: ${JSON.stringify(commandArgs)}`, event, ticker);
        sendDebugMessage(`Working dir: ${workingDir}`, event, ticker);
        reject(error);
      });
      
      // Store process reference for potential termination if event is provided
      if (event) {
        if (!event.sender.botProcesses) {
          event.sender.botProcesses = [];
        }
        event.sender.botProcesses.push({
          process: botProcess,
          botType: botType,
          ticker: ticker
        });
      }
      
    } catch (error) {
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
