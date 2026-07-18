#!/usr/bin/env node
'use strict';

/**
 * acumgr setup wizard
 * Generates config.json by prompting the user for their manager address
 * and discovering processor addresses from the Acurast Mainnet chain.
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
    console.error('\n✗ Invalid address. Must start with "5".');
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

  // Ask how they want to provide processor addresses
  console.log('\nHow would you like to provide your processor addresses?');
  console.log('  1) Auto-discover from chain (recommended, takes ~60 seconds)');
  console.log('  2) Paste a list of addresses manually');
  console.log('  3) Skip for now (add to config.json manually later)\n');
  const method = (await ask('Choice [1]: ')).trim() || '1';

  let processors = existing.processors || [];

  if (method === '2') {
    // Manual entry
    console.log('\nPaste your processor addresses one per line.');
    console.log('Press Enter on a blank line when done:\n');
    const addrs = [];
    while (true) {
      const line = (await ask('')).trim();
      if (!line) break;
      if (line.startsWith('5') && line.length > 40) {
        addrs.push(line);
        console.log(`  ✓ Added (${addrs.length})`);
      } else {
        console.log('  ✗ Invalid address, skipped');
      }
    }
    processors = addrs;
    console.log(`\n✓ ${processors.length} processor(s) added manually`);

  } else if (method === '3') {
    console.log('\n✓ Skipping processor discovery.');
    console.log('  After launching acumgr:');
    console.log('  1. Open http://<your-pi-ip>:9001 in your browser');
    console.log('  2. Click the ⚡ Learn Processors button');
    console.log('  3. Open hub.acurast.com/phones in another tab');
    console.log('  4. The Hub will automatically send all your processor addresses!\n');

  } else {
    // Auto-discover from chain
    rl.pause();
    console.log('\n⏳ Connecting to Acurast Mainnet...');

    let ApiPromise, WsProvider;
    try {
      ({ ApiPromise, WsProvider } = require('@polkadot/api'));
    } catch(_) {
      console.error('✗ @polkadot/api not installed. Run: npm install');
      process.exit(1);
    }

    try {
      const provider = new WsProvider('wss://public-rpc.mainnet.acurast.com', 2500, {}, 20_000);
      const api = await ApiPromise.create({ provider });
      await api.isReady;
      console.log('✓ Connected to Acurast Mainnet\n');

      const managerIdRaw = await api.query.acurastProcessorManager.managerCounter(managerAddress);
      const managerId = managerIdRaw.toJSON();

      if (!managerId) {
        console.warn('⚠ No manager ID found. Check your address and try again.');
      } else {
        console.log(`✓ Manager ID: ${managerId}`);
        console.log('⏳ Scanning network for your processors (~60 seconds)...\n');

        const allEntries = await api.query.acurastProcessorManager.managedProcessors.entries();
        console.log(`  Network total: ${allEntries.length} processors`);

        const found = [];
        let checked = 0;
        for (const [key] of allEntries) {
          const procAddr = key.args[1].toString();
          const procMgrId = await api.query.acurastProcessorManager.processorToManagerIdIndex(procAddr);
          if (procMgrId.toJSON() === managerId) {
            found.push(procAddr);
          }
          checked++;
          if (checked % 1000 === 0) process.stdout.write(`  Checked ${checked}/${allEntries.length}...\r`);
        }

        console.log(`\n✓ Found ${found.length} processor(s) under manager ID ${managerId}`);

        if (found.length > 0) {
          processors = found;
          if (found.length < 31) {
            console.log('\n⚠ If you have more processors than shown above, some may have been');
            console.log('  registered under different manager IDs during the Canary→Mainnet');
            console.log('  migration. Re-run setup and choose option 2 to add them manually.\n');
          }
        }
      }

      await api.disconnect();
    } catch(err) {
      console.warn('\n⚠ Chain query failed:', err.message);
      console.warn('  Re-run setup and choose option 2 to enter addresses manually.\n');
    }
    rl.resume();
  }

  rl.close();

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

  console.log('✓ Config saved to config.json');
  console.log(`\n  Manager : ${managerAddress}`);
  console.log(`  Port    : ${port}`);
  console.log(`  Poll    : every ${pollMinutes} minutes`);
  console.log(`  Phones  : ${processors.length} processor(s)\n`);
  console.log('Next step: docker compose up -d --build\n');
  if (processors.length === 0) {
    console.log('After launching, click ⚡ Learn Processors in the dashboard');
    console.log('then open hub.acurast.com/phones to auto-capture your processor list.\n');
  }
  process.exit(0);
}

main().catch(err => {
  console.error('Setup error:', err.message);
  process.exit(1);
});
