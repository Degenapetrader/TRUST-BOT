// Backward compatibility wrapper for farmbot
import FarmBot from './farm-bot-optimized.js';
const bot = new FarmBot();
export default (args) => bot.run(args); 