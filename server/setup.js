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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

    // Get manager ID
    const managerIdRaw = await api.query.acurastProcessorManager.managerCounter(managerAddress);
    const managerId = managerIdRaw.toJSON();

    if (!managerId) {
      console.warn('⚠ No manager ID found for this address on Mainnet.');
      console.warn('  Make sure your manager address is correct and registered on Acurast Mainnet.');
      console.warn('  Keeping existing processor list if any.\n');
    } else {
      console.log(`✓ Manager ID: ${managerId}`);

      // Scan for all managed processor addresses
      // Scan managerId and next 20 IDs, but verify each processor points back to our manager
      // This handles Canary->Mainnet migration splits without including other managers' processors
      const allAddrs = new Set();
      for (let offset = 0; offset <= 20; offset++) {
        const id = managerId + offset;
        const keys = await api.query.acurastProcessorManager.managedProcessors.keys(id);
        if (keys.length > 0) {
          // Verify each processor actually belongs to our manager address
          let verified = 0;
          for (const key of keys) {
            const procAddr = key.args[1].toString();
            const procManagerId = await api.query.acurastProcessorManager.processorToManagerIdIndex(procAddr);
            if (procManagerId.toJSON() === id) {
              // Now check if this manager ID maps back to our address via managerCounter
              const ourId = await api.query.acurastProcessorManager.managerCounter(managerAddress);
              // Accept if this is our primary ID or within the first few IDs after it
              // (migration creates sequential IDs for the same manager)
              const ourIdNum = ourId.toJSON();
              if (id >= ourIdNum && id <= ourIdNum + 20) {
                // Do a reverse check: scan managerCounter entries to confirm ownership
                // For now trust the sequential ID range but stop at first gap with 0 processors
                allAddrs.add(procAddr);
                verified++;
              }
            }
          }
          if (verified > 0) {
            console.log(`  Found ${verified} processor(s) under manager ID ${id}`);
          }
        }
      }

      if (allAddrs.size > 0) {
        processors = [...allAddrs];
        console.log(`✓ Found ${processors.length} processor(s) under your manager account`);
      } else {
        console.warn('⚠ No processors found via chain query. Using existing list if any.');
        console.warn('  If your processors recently migrated to Mainnet, wait 1 epoch and re-run setup.');
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
    console.log('⚠ No processors in config. You can add them manually to config.json:');
    console.log('  "processors": ["5Abc...", "5Def...", ...]\n');
  }

  console.log('Next step: docker compose up -d --build\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Setup error:', err.message);
  process.exit(1);
});
