import fetch from 'node-fetch';
import fs from 'fs';

const API_URL = 'https://creator.bid/api/agents?type=user&limit=24&page=1&chain=8453&sortBy=marketCap&sortDirection=desc&search=';
const OUTPUT_FILE = 'bid.json';

function loadExistingBid() {
  try {
    if (fs.existsSync(OUTPUT_FILE)) {
      const data = fs.readFileSync(OUTPUT_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load existing bid.json:', e.message);
  }
  return [];
}

async function fetchAgentData() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error('Failed to fetch agent data');
  const json = await res.json();
  if (!json.agents || !Array.isArray(json.agents)) throw new Error('Invalid API response');
  return json.agents;
}

async function main() {
  let added = 0, updated = 0, removed = 0;
  let results = [];
  try {
    const agents = await fetchAgentData();
    const apiMap = new Map();
    for (const agent of agents) {
      if (!agent || !agent.marketCap || !agent.agentKey || !agent.agentKey.agentKeyAddress) continue;
      const tokenAddress = agent.agentKey.agentKeyAddress;
      const mcap = Number(agent.marketCap);
      apiMap.set(tokenAddress.toLowerCase(), {
        symbol: agent.symbol || '',
        tokenAddress,
        mcapInETH: mcap
      });
    }
    // Load existing bid.json
    const existing = loadExistingBid();
    const existingMap = new Map();
    for (const entry of existing) {
      if (entry && entry.tokenAddress) {
        existingMap.set(entry.tokenAddress.toLowerCase(), entry);
      }
    }
    // Update/add tokens from API
    for (const [tokenAddress, apiEntry] of apiMap.entries()) {
      if (apiEntry.mcapInETH >= 50) {
        if (existingMap.has(tokenAddress)) {
          const old = existingMap.get(tokenAddress);
          if (old.mcapInETH !== apiEntry.mcapInETH) {
            updated++;
            console.log(`Updated: ${apiEntry.symbol} (${tokenAddress}) from old mcapInETH: ${old.mcapInETH} to new mcapInETH: ${apiEntry.mcapInETH}`);
          }
          existingMap.set(tokenAddress, { ...old, ...apiEntry });
        } else {
          added++;
          console.log(`Added: ${apiEntry.symbol} (${tokenAddress}) with mcapInETH: ${apiEntry.mcapInETH}`);
          existingMap.set(tokenAddress, apiEntry);
        }
      }
    }
    // Remove tokens that are not in API or now have mcap < 50
    for (const [tokenAddress, entry] of Array.from(existingMap.entries())) {
      if (!apiMap.has(tokenAddress) || apiMap.get(tokenAddress).mcapInETH < 50) {
        removed++;
        console.log(`Removed: ${entry.symbol} (${tokenAddress}) (was mcapInETH: ${entry.mcapInETH})`);
        existingMap.delete(tokenAddress);
      }
    }
    results = Array.from(existingMap.values());
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    console.log(`Saved ${results.length} entries to ${OUTPUT_FILE}`);
    console.log(`Added: ${added}, Updated: ${updated}, Removed: ${removed}`);
  } catch (err) {
    console.error('Error:', err.message);
    try {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
      console.log(`Saved ${results.length} entries to ${OUTPUT_FILE}`);
    } catch (e) {
      console.error('Failed to write bid.json:', e.message);
    }
    process.exit(1);
  }
}

main();