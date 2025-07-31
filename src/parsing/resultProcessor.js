/**
 * ResultProcessor - Handles processing of wallet execution results
 */
export class ResultProcessor {
  /**
   * Process wallet execution results from Promise.allSettled
   * @param {Array} walletPromises - Array of promises from wallet operations
   * @param {Object} options - Processing options
   * @returns {Object} Processed results with statistics
   */
  static async processResults(walletPromises, options = {}) {
    const {
      includeDetails = true,
      groupByStatus = false,
      calculateStats = true
    } = options;
    
    // Wait for all promises to settle
    const results = await Promise.allSettled(walletPromises);
    
    // Process each result
    const processedResults = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return {
          ...result.value,
          index,
          success: result.value.success !== false,
          status: 'fulfilled'
        };
      } else {
        return {
          index,
          success: false,
          status: 'rejected',
          error: result.reason?.message || result.reason || 'Unknown error'
        };
      }
    });
    
    // Group results if requested
    let grouped = null;
    if (groupByStatus) {
      grouped = this.groupResultsByStatus(processedResults);
    }
    
    // Calculate statistics if requested
    let stats = null;
    if (calculateStats) {
      stats = this.calculateStatistics(processedResults);
    }
    
    return {
      results: includeDetails ? processedResults : null,
      grouped,
      stats,
      summary: {
        total: processedResults.length,
        successful: processedResults.filter(r => r.success).length,
        failed: processedResults.filter(r => !r.success).length
      }
    };
  }
  
  /**
   * Group results by status
   * @private
   */
  static groupResultsByStatus(results) {
    return {
      successful: results.filter(r => r.success),
      failed: results.filter(r => !r.success),
      errors: results.filter(r => r.status === 'rejected')
    };
  }
  
  /**
   * Calculate detailed statistics
   * @private
   */
  static calculateStatistics(results) {
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    // Extract numeric values for statistics
    const amounts = successful
      .map(r => r.amount || r.value || 0)
      .filter(v => typeof v === 'number' && !isNaN(v));
    
    const gasUsed = successful
      .map(r => r.gasUsed || 0)
      .filter(v => v > 0);
    
    return {
      successRate: results.length > 0 
        ? (successful.length / results.length * 100).toFixed(2) + '%'
        : '0%',
      amounts: amounts.length > 0 ? {
        total: amounts.reduce((sum, v) => sum + v, 0),
        average: amounts.reduce((sum, v) => sum + v, 0) / amounts.length,
        min: Math.min(...amounts),
        max: Math.max(...amounts)
      } : null,
      gasUsed: gasUsed.length > 0 ? {
        total: gasUsed.reduce((sum, v) => sum + v, 0),
        average: gasUsed.reduce((sum, v) => sum + v, 0) / gasUsed.length,
        min: Math.min(...gasUsed),
        max: Math.max(...gasUsed)
      } : null,
      errors: this.categorizeErrors(failed)
    };
  }
  
  /**
   * Categorize errors by type
   * @private
   */
  static categorizeErrors(failedResults) {
    const categories = {
      gas: [],
      network: [],
      validation: [],
      other: []
    };
    
    failedResults.forEach(result => {
      const error = result.error || '';
      const errorLower = error.toLowerCase();
      
      if (errorLower.includes('gas') || errorLower.includes('nonce')) {
        categories.gas.push(result);
      } else if (errorLower.includes('network') || errorLower.includes('timeout')) {
        categories.network.push(result);
      } else if (errorLower.includes('invalid') || errorLower.includes('validation')) {
        categories.validation.push(result);
      } else {
        categories.other.push(result);
      }
    });
    
    return categories;
  }
  
  /**
   * Format results for display
   * @param {Object} processedResults - Results from processResults
   * @param {Object} options - Formatting options
   * @returns {string} Formatted results
   */
  static formatResults(processedResults, options = {}) {
    const {
      showDetails = true,
      colorize = true,
      indent = '  '
    } = options;
    
    const lines = [];
    const { summary, stats } = processedResults;
    
    // Summary
    lines.push('📊 EXECUTION SUMMARY:');
    lines.push(`${indent}✅ Successful: ${summary.successful}/${summary.total}`);
    lines.push(`${indent}❌ Failed: ${summary.failed}/${summary.total}`);
    
    // Statistics
    if (stats) {
      lines.push('\n📈 STATISTICS:');
      lines.push(`${indent}Success Rate: ${stats.successRate}`);
      
      if (stats.amounts) {
        lines.push(`${indent}Amounts:`);
        lines.push(`${indent}${indent}Total: ${stats.amounts.total.toFixed(6)}`);
        lines.push(`${indent}${indent}Average: ${stats.amounts.average.toFixed(6)}`);
      }
      
      if (stats.gasUsed) {
        lines.push(`${indent}Gas Used:`);
        lines.push(`${indent}${indent}Total: ${stats.gasUsed.total}`);
        lines.push(`${indent}${indent}Average: ${stats.gasUsed.average.toFixed(0)}`);
      }
    }
    
    // Details
    if (showDetails && processedResults.results) {
      lines.push('\n📋 DETAILED RESULTS:');
      
      processedResults.results.forEach((result, index) => {
        const status = result.success ? '✅' : '❌';
        const walletInfo = result.walletAddress 
          ? ` (${result.walletAddress.slice(0, 8)}...)`
          : '';
        
        lines.push(`${indent}${status} Wallet ${index + 1}${walletInfo}:`);
        
        if (result.success) {
          if (result.txHash) {
            lines.push(`${indent}${indent}TX: ${result.txHash}`);
          }
          if (result.amount !== undefined) {
            lines.push(`${indent}${indent}Amount: ${result.amount}`);
          }
        } else {
          lines.push(`${indent}${indent}Error: ${result.error}`);
        }
      });
    }
    
    return lines.join('\n');
  }
  
  /**
   * Create a summary report
   * @param {Array} results - Array of result objects
   * @returns {Object} Summary report
   */
  static createSummaryReport(results) {
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    return {
      timestamp: new Date().toISOString(),
      summary: {
        total: results.length,
        successful: successful.length,
        failed: failed.length,
        successRate: ((successful.length / results.length) * 100).toFixed(2) + '%'
      },
      transactions: successful
        .filter(r => r.txHash)
        .map(r => ({
          wallet: r.walletAddress || r.wallet,
          txHash: r.txHash,
          amount: r.amount,
          gasUsed: r.gasUsed
        })),
      errors: failed.map(r => ({
        wallet: r.walletAddress || r.wallet,
        error: r.error,
        timestamp: r.timestamp
      }))
    };
  }
  
  /**
   * Process FSH mode results
   * @param {Array} results - FSH execution results
   * @returns {Object} Processed summary
   */
  processFSHResults(results) {
    const summary = {
      totalTokens: results.length,
      successful: 0,
      failed: 0,
      walletBreakdown: new Map(),
      tokenBreakdown: new Map(),
      totalVirtualReceived: 0
    };
    
    results.forEach(result => {
      if (result.success) {
        summary.successful++;
        summary.totalVirtualReceived += (result.result?.virtualReceived || 0);
        
        // Track by wallet
        if (!summary.walletBreakdown.has(result.wallet)) {
          summary.walletBreakdown.set(result.wallet, { 
            tokens: [], 
            virtualReceived: 0 
          });
        }
        const walletData = summary.walletBreakdown.get(result.wallet);
        walletData.tokens.push(result.token);
        walletData.virtualReceived += (result.result?.virtualReceived || 0);
        
        // Track by token
        if (!summary.tokenBreakdown.has(result.token)) {
          summary.tokenBreakdown.set(result.token, {
            count: 0,
            totalAmount: 0,
            totalVirtual: 0
          });
        }
        const tokenData = summary.tokenBreakdown.get(result.token);
        tokenData.count++;
        tokenData.totalAmount += result.amount;
        tokenData.totalVirtual += (result.result?.virtualReceived || 0);
      } else {
        summary.failed++;
      }
    });
    
    return summary;
  }
  
  /**
   * Display FSH mode summary
   * @param {Object} summary - FSH execution summary
   */
  displayFSHSummary(summary) {
    console.log('\n💥 FSH MODE SUMMARY');
    console.log('==================');
    console.log(`📊 Total tokens processed: ${summary.totalTokens}`);
    console.log(`✅ Successful: ${summary.successful}`);
    console.log(`❌ Failed: ${summary.failed}`);
    console.log(`💰 Total VIRTUAL received: ${summary.totalVirtualReceived.toFixed(6)}`);
    
    if (summary.walletBreakdown.size > 0) {
      console.log('\n👛 BY WALLET:');
      let walletIndex = 1;
      summary.walletBreakdown.forEach((data, wallet) => {
        console.log(`   Wallet ${walletIndex++} (${wallet.slice(0,8)}...):`);
        console.log(`   - Tokens sold: ${data.tokens.length}`);
        console.log(`   - VIRTUAL received: ${data.virtualReceived.toFixed(6)}`);
      });
    }
    
    if (summary.tokenBreakdown.size > 0) {
      console.log('\n🪙 TOP TOKENS:');
      const sortedTokens = Array.from(summary.tokenBreakdown.entries())
        .sort((a, b) => b[1].totalVirtual - a[1].totalVirtual)
        .slice(0, 5);
      
      sortedTokens.forEach(([token, data]) => {
        console.log(`   ${token}:`);
        console.log(`   - Sold from ${data.count} wallet(s)`);
        console.log(`   - Total amount: ${data.totalAmount.toFixed(2)}`);
        console.log(`   - VIRTUAL received: ${data.totalVirtual.toFixed(6)}`);
      });
    }
  }
} 