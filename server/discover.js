#!/usr/bin/env node
'use strict';

/**
 * acumgr processor discovery tool
 * Run this to find ALL processor addresses belonging to your manager.
 * Uses the same approach as the Acurast Hub explorer.
 * 
 * Usage: node discover.js <managerAddress>
 * Example: node discover.js 5YourManagerAddressHere...
 */

const { ApiPromise, WsProvider } = require('@polkadot/api');
const fs = require('fs');
const path = require('path');

const managerAddress = process.argv[2];

if (!managerAddress || !managerAddress.startsWith('5')) {
  console.error('\nUsage: node discover.js <managerAddress>');
  console.error('Example: node discover.js 5YourManagerAddressHere...\n');
  process.exit(1);
}

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║      acumgr — Processor Discovery     ║');
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

  // Strategy: scan ALL managedProcessors entries on the network
  // For each processor, check processorToManagerIdIndex
  // Accept processor if its manager ID == our primary manager ID
  // This is 100% accurate for the primary ID
  console.log('\n⏳ Scanning all processors on network...');
  console.log('  (This takes 60-120 seconds for ~60,000 entries)\n');

  const allEntries = await api.query.acurastProcessorManager.managedProcessors.entries();
  console.log(`  Network total: ${allEntries.length} processor entries`);

  const processors = [];
  let checked = 0;

  for (const [key] of allEntries) {
    const procAddr = key.args[1].toString();
    const procMgrId = await api.query.acurastProcessorManager.processorToManagerIdIndex(procAddr);
    const mgrId = procMgrId.toJSON();
    
    if (mgrId === managerId) {
      processors.push(procAddr);
      process.stdout.write(`  Found: ${processors.length} processors (${procAddr.slice(0,12)}...)\r`);
    }
    
    checked++;
    if (checked % 1000 === 0 && processors.length === 0) {
      process.stdout.write(`  Checked ${checked}/${allEntries.length}...\r`);
    }
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
    
    console.log(`\n✓ Saved to: ${outFile}`);
    console.log('\nProcessor addresses:');
    processors.forEach((p, i) => console.log(`  ${i+1}. ${p}`));
    
    console.log('\nTo use these in your config.json, copy the list above');
    console.log('or run setup.js and choose option 2 to paste them in.\n');
  }

  await api.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
