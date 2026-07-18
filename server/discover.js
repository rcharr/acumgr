#!/usr/bin/env node
'use strict';

/**
 * acumgr processor discovery tool
 * Finds ALL processor addresses belonging to your manager account.
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

  // APPROACH: use managedProcessors.keys(managerId) — this directly returns
  // all processor addresses under a specific manager ID in ONE RPC call.
  // Then repeat for the next few IDs to catch migration splits.
  console.log('\n⏳ Fetching processor keys for your manager IDs...\n');

  const processors = new Set();
  const foundIds = [];

  // Scan managerId through managerId+30, use keys() per ID (fast single call each)
  for (let offset = 0; offset <= 30; offset++) {
    const id = managerId + offset;
    const keys = await api.query.acurastProcessorManager.managedProcessors.keys(id);
    
    if (keys.length > 0) {
      // Now verify these processors actually point back to this ID
      // Fetch all their manager IDs in parallel
      const addrs = keys.map(k => k.args[1].toString());
      const verifyResults = await Promise.all(
        addrs.map(addr => api.query.acurastProcessorManager.processorToManagerIdIndex(addr))
      );

      let count = 0;
      for (let i = 0; i < addrs.length; i++) {
        const procMgrId = verifyResults[i].toJSON();
        // Only accept if this processor points back to the same ID we queried
        // AND that ID >= our primary managerId (migration creates higher IDs)
        if (procMgrId === id) {
          processors.add(addrs[i]);
          count++;
        }
      }

      if (count > 0) {
        foundIds.push(id);
        console.log(`  Manager ID ${id}: ${count} verified processor(s)`);
      }
    }
  }

  const processorList = [...processors];
  console.log(`\n✓ Found ${processorList.length} verified processor(s)`);
  console.log(`  Across manager IDs: ${foundIds.join(', ')}`);

  if (processorList.length > 0) {
    const outFile = path.join(__dirname, 'discovered_processors.json');
    fs.writeFileSync(outFile, JSON.stringify({
      managerAddress,
      managerId,
      managerIds: foundIds,
      processors: processorList,
      discoveredAt: new Date().toISOString()
    }, null, 2));

    console.log(`\n✓ Saved to: ${outFile}`);
    console.log('\nProcessor addresses:');
    processorList.forEach((p, i) => console.log(`  ${i+1}. ${p}`));
    console.log('\nTo use in setup: run node setup.js and choose option 2 to paste these in.\n');
    console.log('Or copy directly into config.json under "processors": [...]\n');
  }

  await api.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
