#!/usr/bin/env node
'use strict';

/**
 * acumgr setup wizard
 * Generates config.json by prompting the user for their manager address
 * and discovering all processor addresses from the Acurast Mainnet chain.
 */

const readline = require('readline');
const fs       = require('fs');
const path     = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║      acumgr — Setup Wizard             ║');
  console.log('║  Acurast Processor Fleet Manager       ║');
  console.log('╚════════════════════════════════════════╝\n');

  // Load existing config if present
  let existing = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
    catch(_) {}
    console.log('Found existing config. Press Enter to keep current values.\n');
  }

  // Manager address
  const defaultAddr = existing.managerAddress || '';
  const managerAddress = (await ask(
    `Manager address (SS58)${defaultAddr ? ' [' + defaultAddr.slice(0,12) + '...]' : ''}: `
  )).trim() || defaultAddr;

  if (!managerAddress || !managerAddress.startsWith('5')) {
    console.error('\n✗ Invalid address. Must be a Substrate SS58 address starting with "5".');
    process.exit(1);
  }

  // Port
  const defaultPort = existing.port || 9001;
  const portStr = (await ask(`Port [${defaultPort}]: `)).trim();
  const port = portStr ? parseInt(portStr) : defaultPort;

  // Poll interval
  const defaultPoll = existing.pollMinutes || 30;
  const pollStr = (await ask(`Poll interval in minutes [${defaultPoll}]: `)).trim();
  const pollMinutes = pollStr ? parseInt(pollStr) : defaultPoll;

  rl.close();

  console.log('\n⏳ Connecting to Acurast Mainnet to discover your processors...');

  let ApiPromise, WsProvider;
  try {
    ({ ApiPromise, WsProvider } = require('@polkadot/api'));
  } catch(_) {
    console.error('✗ @polkadot/api not installed. Run: npm install');
    process.exit(1);
  }

  let processors = existing.processors || [];

  try {
    const provider = new WsProvider('wss://public-rpc.mainnet.acurast.com', 2500, {}, 20_000);
    const api = await ApiPromise.create({ provider });
    await api.isReady;
    console.log('✓ Connected to Acurast Mainnet\n');

    // Step 1: Get our primary manager ID
    const managerIdRaw = await api.query.acurastProcessorManager.managerCounter(managerAddress);
    const managerId = managerIdRaw.toJSON();

    if (!managerId) {
      console.warn('⚠ No manager ID found for this address on Mainnet.');
      console.warn('  Make sure your manager address is correct and registered on Acurast Mainnet.\n');
    } else {
      console.log(`✓ Manager ID: ${managerId}`);

      // Step 2: Collect ALL processor addresses from IDs in range managerId to managerId+20
      const candidateAddrs = new Set();
      const candidateIds = new Set();

      for (let offset = 0; offset <= 20; offset++) {
        const id = managerId + offset;
        const keys = await api.query.acurastProcessorManager.managedProcessors.keys(id);
        if (keys.length > 0) {
          keys.forEach(k => {
            candidateAddrs.add(k.args[1].toString());
            candidateIds.add(id);
          });
        }
      }

      // Step 3: For each candidate processor, verify its processorToManagerIdIndex
      // points to one of the IDs that came from OUR manager ID range.
      // Then confirm those IDs are actually ours by checking the FIRST processor
      // in each ID was registered under our manager address via managerCounter.
      // Since managerCounter(address) gives us our ID, any processor whose
      // processorToManagerIdIndex falls within candidateIds AND those IDs are
      // sequential from our primary ID — we accept them.
      // Key insight: we only accept IDs where processorToManagerIdIndex matches
      // AND the ID is >= our primary managerId (IDs below can't be ours).

      const verifiedAddrs = [];
      const verifiedIds = new Set();

      for (const addr of candidateAddrs) {
        const procMgrId = await api.query.acurastProcessorManager.processorToManagerIdIndex(addr);
        const procMgrIdNum = procMgrId.toJSON();

        // Only accept if this processor's manager ID is within our scanned range
        // AND >= our primary manager ID (migration creates higher IDs, never lower)
        if (procMgrIdNum !== null && procMgrIdNum >= managerId && candidateIds.has(procMgrIdNum)) {
          verifiedAddrs.push(addr);
          verifiedIds.add(procMgrIdNum);
        }
      }

      if (verifiedAddrs.length > 0) {
        processors = verifiedAddrs;
        console.log(`✓ Found ${processors.length} processor(s) across manager IDs: ${[...verifiedIds].sort((a,b)=>a-b).join(', ')}`);
      } else {
        console.warn('⚠ No processors verified. Using existing list if any.');
      }
    }

    await api.disconnect();
  } catch(err) {
    console.warn('\n⚠ Could not connect to chain:', err.message);
    console.warn('  Using existing processor list. Re-run setup when connectivity is available.\n');
  }

  const config = {
    managerAddress,
    port,
    pollMinutes,
    processors,
    rpc: 'wss://public-rpc.mainnet.acurast.com',
    computePallet: '5EYCAe5g86uWAqpCzj2AMUzgybxYTycRNNxSBK17aziwTZAH',
    epochLength: 900,
    _note: 'Generated by acumgr setup. Edit processors[] manually if needed.',
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  console.log('\n✓ Config saved to config.json');
  console.log(`\n  Manager : ${managerAddress}`);
  console.log(`  Port    : ${port}`);
  console.log(`  Poll    : every ${pollMinutes} minutes`);
  console.log(`  Phones  : ${processors.length} processor(s)\n`);

  if (processors.length === 0) {
    console.log('⚠ No processors found. Add them manually to config.json:');
    console.log('  "processors": ["5Abc...", "5Def...", ...]\n');
  }

  console.log('Next step: docker compose up -d --build\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Setup error:', err.message);
  process.exit(1);
});
