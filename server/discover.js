#!/usr/bin/env node
'use strict';

/**
 * acumgr processor discovery tool
 * Finds ALL processor addresses belonging to your manager account.
 * Uses bulk RPC queries for speed — completes in ~30 seconds.
 *
 * Usage: node discover.js <managerAddress>
 */

const { ApiPromise, WsProvider } = require('@polkadot/api');
const fs   = require('fs');
const path = require('path');

const managerAddress = process.argv[2];

if (!managerAddress || !managerAddress.startsWith('5')) {
  console.error('\nUsage: node discover.js <managerAddress>');
  console.error('Example: node discover.js 5YourManagerAddressHere...\n');
  process.exit(1);
}

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║    acumgr — Processor Discovery        ║');
  console.log('╚════════════════════════════════════════╝\n');
  console.log('Manager:', managerAddress);
  console.log('\n⏳ Connecting to Acurast Mainnet...');

  const provider = new WsProvider('wss://public-rpc.mainnet.acurast.com', 2500, {}, 20_000);
  const api = await ApiPromise.create({ provider });
  await api.isReady;
  console.log('✓ Connected\n');

  // Get primary manager ID
  const managerIdRaw = await api.query.acurastProcessorManager.managerCounter(managerAddress);
  const managerId = managerIdRaw.toJSON();
  console.log('Primary Manager ID:', managerId);

  if (!managerId) {
    console.error('✗ No manager ID found for this address.');
    process.exit(1);
  }

  // FAST APPROACH:
  // 1. Get all processorToManagerIdIndex keys in bulk (single RPC call)
  // 2. Get all values in bulk (single RPC call via queryStorageAt)
  // 3. Filter locally — no per-entry RPC calls needed
  console.log('\n⏳ Fetching all processor-to-manager mappings in bulk...');
  console.log('  (Should complete in ~10-20 seconds)\n');

  // Get all keys from processorToManagerIdIndex storage
  const allKeys = await api.query.acurastProcessorManager.processorToManagerIdIndex.keys();
  console.log(`  Total processor entries on network: ${allKeys.length}`);

  // Fetch all values in batches of 500 using multi query
  const BATCH = 500;
  const processors = [];
  let processed = 0;

  for (let i = 0; i < allKeys.length; i += BATCH) {
    const batch = allKeys.slice(i, i + BATCH);
    
    // Multi-query: fetch all values in this batch at once
    const values = await Promise.all(
      batch.map(key => api.query.acurastProcessorManager.processorToManagerIdIndex(key.args[0]))
    );

    for (let j = 0; j < batch.length; j++) {
      const mgrId = values[j].toJSON();
      if (mgrId === managerId) {
        const procAddr = batch[j].args[0].toString();
        processors.push(procAddr);
      }
    }

    processed += batch.length;
    process.stdout.write(`  Checked ${processed}/${allKeys.length} — found ${processors.length} so far...\r`);
  }

  console.log(`\n\n✓ Found ${processors.length} processor(s) under manager ID ${managerId}`);

  if (processors.length > 0) {
    // Save to file
    const outFile = path.join(__dirname, 'discovered_processors.json');
    fs.writeFileSync(outFile, JSON.stringify({
      managerAddress,
      managerId,
      processors,
      discoveredAt: new Date().toISOString()
    }, null, 2));

    console.log(`✓ Saved to: ${outFile}`);
    console.log('\nProcessor addresses:');
    processors.forEach((p, i) => console.log(`  ${i+1}. ${p}`));
    console.log('\nNext: run node setup.js and choose option 2 to paste these in.\n');
  } else {
    console.log('\n⚠ No processors found under your primary manager ID.');
    console.log('  This may be a Canary→Mainnet migration issue.');
    console.log('  Try running node setup.js and entering addresses manually.\n');
  }

  await api.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
