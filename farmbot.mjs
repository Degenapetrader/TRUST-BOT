// Backward compatibility wrapper for farmbot
import FarmBot from './src/bots/farm-bot-optimized.js';
const args = process.argv.slice(2);
FarmBot.execute(args).then(() => process.exit(0)).catch(() => process.exit(1)); 