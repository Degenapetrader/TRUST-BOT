/**
 * CLI Interface Service
 * Handles command-line interactions for bots
 */

import readline from 'readline';

/**
 * CLIInterface - Manages command-line interactions
 */
export class CLIInterface {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  /**
   * Ask a question and return the answer
   * @param {string} question - Question to ask
   * @returns {Promise<string>} User's answer
   */
  askQuestion(question) {
    return new Promise((resolve) => {
      this.rl.question(question, resolve);
    });
  }

  /**
   * Close the readline interface
   */
  close() {
    this.rl.close();
  }

  /**
   * Ask for confirmation (y/n)
   * @param {string} question - Question to ask
   * @returns {Promise<boolean>} True if user confirms
   */
  async askConfirmation(question) {
    const answer = await this.askQuestion(`${question} (y/n): `);
    return answer.toLowerCase() === 'y';
  }

  /**
   * Ask for a numeric value
   * @param {string} question - Question to ask
   * @param {number} defaultValue - Default value if empty
   * @returns {Promise<number>} Numeric value
   */
  async askNumber(question, defaultValue = null) {
    const answer = await this.askQuestion(
      defaultValue !== null ? `${question} (default ${defaultValue}): ` : `${question}: `
    );
    
    if (!answer && defaultValue !== null) {
      return defaultValue;
    }
    
    const value = parseFloat(answer);
    if (isNaN(value)) {
      console.log('❌ Invalid number. Please try again.');
      return this.askNumber(question, defaultValue);
    }
    
    return value;
  }

  /**
   * Ask for a choice from options
   * @param {string} question - Question to ask
   * @param {Array} options - Array of {value, label} objects
   * @returns {Promise<any>} Selected value
   */
  async askChoice(question, options) {
    console.log(`\n${question}`);
    options.forEach((opt, index) => {
      console.log(`${index + 1}. ${opt.label}`);
    });
    
    const answer = await this.askQuestion('\nChoose option (number): ');
    const index = parseInt(answer) - 1;
    
    if (index < 0 || index >= options.length) {
      console.log('❌ Invalid choice. Please try again.');
      return this.askChoice(question, options);
    }
    
    return options[index].value;
  }

  /**
   * Display a progress message
   * @param {string} message - Message to display
   */
  showProgress(message) {
    console.log(`⏳ ${message}`);
  }

  /**
   * Display a success message
   * @param {string} message - Message to display
   */
  showSuccess(message) {
    console.log(`✅ ${message}`);
  }

  /**
   * Display an error message
   * @param {string} message - Message to display
   */
  showError(message) {
    console.log(`❌ ${message}`);
  }

  /**
   * Display an info message
   * @param {string} message - Message to display
   */
  showInfo(message) {
    console.log(`ℹ️ ${message}`);
  }

  /**
   * Display a warning message
   * @param {string} message - Message to display
   */
  showWarning(message) {
    console.log(`⚠️ ${message}`);
  }

  /**
   * Display a section header
   * @param {string} title - Section title
   * @param {string} icon - Optional icon
   */
  showSection(title, icon = '🔷') {
    console.log(`\n${icon} ${title}`);
    console.log('='.repeat(title.length + 3));
  }

  /**
   * Display a table
   * @param {Array} headers - Table headers
   * @param {Array} rows - Table rows
   */
  showTable(headers, rows) {
    // Calculate column widths
    const colWidths = headers.map((h, i) => {
      const headerWidth = h.length;
      const maxRowWidth = Math.max(...rows.map(r => String(r[i]).length));
      return Math.max(headerWidth, maxRowWidth) + 2;
    });
    
    // Display headers
    console.log('\n' + headers.map((h, i) => h.padEnd(colWidths[i])).join(''));
    console.log(headers.map((h, i) => '-'.repeat(colWidths[i] - 1)).join(' '));
    
    // Display rows
    rows.forEach(row => {
      console.log(row.map((cell, i) => String(cell).padEnd(colWidths[i])).join(''));
    });
  }
} 