'use strict';

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const https    = require('https');
const fs       = require('fs');
const { ApiPromise, WsProvider } = require('@polkadot/api');

// ─── Load config ───────────────────────────────────────────────────────────────
const CONFIG_PATH  = path.join(__dirname, 'config.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');

if (!fs.existsSync(CONFIG_PATH)) {
  console.error('\n✗ config.json not found. Run setup first:\n');
  console.error('  cd server && node setup.js\n');
  process.exit(1);
}

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch(err) {
  console.error('✗ Could not parse config.json:', err.message);
  process.exit(1);
}

const MANAGER_ADDRESS = cfg.managerAddress;
const ALL_PROCESSORS  = cfg.processors || [];
const PORT            = cfg.port || 9001;
const POLL_INTERVAL   = (cfg.pollMinutes || 30) * 60 * 1000;
const RPC_MAINNET     = cfg.rpc || 'wss://public-rpc.mainnet.acurast.com';
const COMPUTE_PALLET  = cfg.computePallet || '5EYCAe5g86uWAqpCzj2AMUzgybxYTycRNNxSBK17aziwTZAH';
const EPOCH_LENGTH    = cfg.epochLength || 900;

if (!MANAGER_ADDRESS) {
  console.error('✗ managerAddress missing in config.json. Re-run: node setup.js');
  process.exit(1);
}

// ─── State ─────────────────────────────────────────────────────────────────────
let apiMainnet      = null;
let processorCache  = {};
let managerBalance  = null;
let lastEpochPayout = null;
let acuPrice        = null;
let lastUpdated     = null;
let rpcConnected    = false;

// ─── History (server-side, persisted to disk) ──────────────────────────────────
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch(_) {}
  return [];
}

function saveHistory(h) {
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(h.slice(-365), null, 2)); }
  catch(err) { console.warn('[History] Write failed:', err.message); }
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

function recordHistory(payout, balance) {
  const h = loadHistory();
  const today = todayStr();
  let entry = h.find(e => e.d === today);
  if (!entry) { entry = { d: today, payouts: [], bal: null }; h.push(entry); }
  if (payout?.block && !entry.payouts.find(p => p.b === payout.block)) {
    entry.payouts.push({ b: payout.block, a: payout.amount });
    console.log('[History] Recorded payout', payout.amount.toFixed(4), 'ACU for', today);
  }
  if (balance) entry.bal = parseFloat(balance);
  saveHistory(h);
  console.log('[History] Saved — entries:', h.length);
}

// ─── ACU Price — Gate.io public API ───────────────────────────────────────────
async function fetchAcuPrice() {
  return new Promise((resolve) => {
    const url = 'https://api.gateio.ws/api/v4/spot/tickers?currency_pair=ACU_USDT';
    https.get(url, { headers: { 'Accept': 'application/json' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (Array.isArray(data) && data[0]?.last) {
            acuPrice = parseFloat(data[0].last);
            console.log('[Price] ACU = $' + acuPrice + ' (Gate.io)');
          }
        } catch(_) { console.warn('[Price] Parse error'); }
        resolve();
      });
    }).on('error', () => { console.warn('[Price] Fetch failed'); resolve(); });
  });
}

// ─── Substrate helpers ─────────────────────────────────────────────────────────
async function connectApi() {
  try {
    console.log('[RPC] Connecting to', RPC_MAINNET, '...');
    const provider = new WsProvider(RPC_MAINNET, 2500, {}, 15_000);
    const api = await ApiPromise.create({ provider });
    await api.isReady;
    console.log('[RPC] Connected:', (await api.rpc.system.chain()).toString());
    return api;
  } catch(err) {
    console.error('[RPC] Failed:', err.message);
    return null;
  }
}

async function fetchBalance(api, address) {
  try {
    const { data } = await api.query.system.account(address);
    const free = BigInt(data.free.toString());
    const decimals = api.registry.chainDecimals[0] || 12;
    return (Number(free) / Math.pow(10, decimals)).toFixed(4);
  } catch(_) { return null; }
}

async function enrichProcessor(api, address) {
  const result = {
    address, balance: null, lastHeartbeatTs: null, lastHeartbeatAgo: null,
    status: 'unknown', rewardContribution: null, epochOffset: null,
    epoch: null, computeScore: null,
  };
  try {
    result.balance = await fetchBalance(api, address);
    const hb = await api.query.acurastProcessorManager.processorHeartbeat(address);
    if (hb && !hb.isNone) {
      const tsMs = Number(hb.toJSON());
      result.lastHeartbeatTs  = tsMs;
      const secondsAgo        = Math.floor((Date.now() - tsMs) / 1000);
      result.lastHeartbeatAgo = secondsAgo;
      result.status = secondsAgo < 3600 ? 'online' : secondsAgo < 7200 ? 'degraded' : 'offline';
    }
    const proc = await api.query.acurastCompute.processors(address);
    if (proc && !proc.isNone) {
      const p = proc.toJSON();
      result.rewardContribution = p.rewardContribution ?? null;
      result.epochOffset        = p.epochOffset ?? null;
      result.epoch              = p.committed ?? null;
      if (p.epochOffset != null) {
        const s = await api.query.acurastCompute.scores(p.epochOffset, 1);
        if (s && !s.isNone) {
          const j = s.toJSON();
          if (j?.cur) result.computeScore = Number(BigInt(j.cur[0]) / BigInt('1000000000000'));
        }
      }
    }
  } catch(err) {
    console.warn('[Enrich]', address.slice(0,10), 'partial:', err.message);
  }
  return result;
}

async function fetchLastEpochPayout(api) {
  try {
    const currentBlock   = (await api.rpc.chain.getHeader()).number.toNumber();
    const lastEpochBlock = Math.floor(currentBlock / EPOCH_LENGTH) * EPOCH_LENGTH;
    const epochNum       = Math.floor(currentBlock / EPOCH_LENGTH);
    if (lastEpochPayout?.epoch === epochNum) {
      console.log('[Payout] Already recorded for epoch', epochNum);
      return;
    }
    const BATCH = 20;
    for (let b = lastEpochBlock; b <= lastEpochBlock + 300; b += BATCH) {
      const results = await Promise.all(
        Array.from({ length: BATCH }, async (_, i) => {
          try {
            const blockNum = b + i;
            const hash     = await api.rpc.chain.getBlockHash(blockNum);
            const events   = await api.query.system.events.at(hash);
            let found = null;
            events.forEach(({ event }) => {
              if (event.section === 'balances' && event.method === 'Transfer') {
                const [from, to, amount] = event.data.toJSON();
                if (from === COMPUTE_PALLET && to === MANAGER_ADDRESS) {
                  found = { amount: Number(BigInt(amount)) / 1e12, block: blockNum, epoch: epochNum };
                }
              }
            });
            return found;
          } catch(_) { return null; }
        })
      );
      const found = results.filter(Boolean);
      if (found.length > 0) {
        lastEpochPayout = found[0];
        console.log('[Payout] Found:', lastEpochPayout.amount.toFixed(4), 'ACU at block', lastEpochPayout.block);
        return;
      }
    }
    console.log('[Payout] No payout found yet for epoch', epochNum);
  } catch(err) {
    console.warn('[Payout] Error:', err.message);
  }
}

// ─── Master refresh ────────────────────────────────────────────────────────────
async function refresh() {
  console.log('\n[Refresh] Starting —', new Date().toISOString());
  try {
    if (!apiMainnet || !apiMainnet.isConnected) apiMainnet = await connectApi();
    if (!apiMainnet) { rpcConnected = false; return; }
    rpcConnected = true;

    managerBalance = await fetchBalance(apiMainnet, MANAGER_ADDRESS);
    await fetchLastEpochPayout(apiMainnet);
    await fetchAcuPrice();
    recordHistory(lastEpochPayout, managerBalance);

    const batchSize = 5;
    for (let i = 0; i < ALL_PROCESSORS.length; i += batchSize) {
      const batch   = ALL_PROCESSORS.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(addr => enrichProcessor(apiMainnet, addr)));
      results.forEach(r => { processorCache[r.address] = r; });
    }

    lastUpdated = new Date().toISOString();
    const online = Object.values(processorCache).filter(p => p.status === 'online').length;
    console.log('[Refresh] Done —', ALL_PROCESSORS.length, 'processors,', online, 'online, balance:', managerBalance, 'ACU');
  } catch(err) {
    rpcConnected = false;
    console.error('[Refresh] Error:', err.message);
  }
}

// ─── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Never cache index.html so all devices always get the latest version
app.use(express.static(path.join(__dirname, './public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Acurast Hub compatible endpoint
app.get('/processor/check-in/processor/api/status/bulk', (req, res) => {
  const requested = req.query.addresses
    ? req.query.addresses.split(',').map(a => a.trim())
    : ALL_PROCESSORS;
  const result = {};
  for (const addr of requested) {
    const cached = processorCache[addr];
    result[addr] = {
      status:   cached?.status ?? 'unknown',
      lastSeen: cached?.lastHeartbeatTs ? new Date(cached.lastHeartbeatTs).toISOString() : null,
      balance:  cached?.balance ?? null,
    };
  }
  res.json(result);
});

// Dashboard API
app.get('/api/status', (req, res) => {
  const processors = ALL_PROCESSORS.map(addr => processorCache[addr] || { address: addr, status: 'unknown' });
  const online   = processors.filter(p => p.status === 'online').length;
  const degraded = processors.filter(p => p.status === 'degraded').length;
  const offline  = processors.filter(p => p.status === 'offline').length;
  const unknown  = processors.filter(p => p.status === 'unknown').length;
  res.json({
    ok: true,
    managerAddress: MANAGER_ADDRESS,
    managerBalance,
    rpcConnected,
    lastUpdated,
    acuPrice,
    summary: { total: ALL_PROCESSORS.length, online, degraded, offline, unknown },
    lastEpochPayout,
    fleetRewardThisEpoch: Object.values(processorCache)
      .reduce((sum, p) => sum + (p.rewardContribution || 0), 0) / 1e12,
    processors,
  });
});

app.get('/api/processors', (req, res) => {
  const processors = ALL_PROCESSORS.map(addr => ({
    ...(processorCache[addr] || { address: addr, status: 'unknown' }),
    network: 'mainnet',
  }));
  res.json({ ok: true, count: processors.length, processors, lastUpdated });
});

app.get('/api/history', (req, res) => {
  res.json({ ok: true, history: loadHistory() });
});

app.get('/api/config', (req, res) => {
  res.json({
    managerAddress: MANAGER_ADDRESS,
    processorCount: ALL_PROCESSORS.length,
    port: PORT,
    pollMinutes: cfg.pollMinutes || 30,
    rpc: RPC_MAINNET,
  });
});

app.post('/api/refresh', (req, res) => {
  res.json({ ok: true, message: 'Refresh triggered' });
  refresh();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), lastUpdated, rpcConnected, processorCount: ALL_PROCESSORS.length });
});

// ─── Boot ──────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', async () => {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║          acumgr v1.0.0                 ║');
  console.log('║  Acurast Processor Fleet Manager       ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('\nDashboard  →  http://0.0.0.0:' + PORT);
  console.log('Manager    →  ' + MANAGER_ADDRESS);
  console.log('Processors →  ' + ALL_PROCESSORS.length + ' (from config.json)');
  console.log('Poll       →  every ' + (cfg.pollMinutes || 30) + ' minutes\n');
  await refresh();
  setInterval(refresh, POLL_INTERVAL);
});

process.on('unhandledRejection', err => console.error('[Fatal]', err.message));
