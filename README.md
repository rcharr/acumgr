# acumgr — Acurast Processor Fleet Manager

A self-hosted local dashboard for Acurast processor operators. Tracks your entire fleet of processor phones, shows live heartbeat status, compute scores, epoch rewards, manager balance, and a cumulative income chart with live ACU/USD pricing.


---

## Features

- **Live processor status** — heartbeat timestamps, online/degraded/offline per phone
- **Compute scores** — per-processor benchmark scores from the Acurast chain
- **Epoch rewards** — fleet reward accumulating in the current epoch + last payout
- **Manager balance** — live ACU balance with USD conversion
- **Income chart** — cumulative earnings vs. manager balance, dual ACU/USD axes
- **Acurast Hub compatible** — serves the local management endpoint the Hub expects
- **Works for any fleet size** — tested with 31 processors, designed for 60+

---

## Hardware Requirements

acumgr runs on any Linux machine on your local network. Recommended:

| Device | Suitability |
|--------|-------------|
| **Raspberry Pi 5** (recommended) | ✅ Ideal — fast, low power, always-on |
| Raspberry Pi 4 (4GB+) | ✅ Works well |
| Raspberry Pi 4 (2GB) | ⚠ Works, may be slow with 60+ processors |
| Raspberry Pi Zero 2 W | ✗ Not recommended — too slow for Substrate RPC |
| Any Linux x86/ARM server | ✅ Works |
| Mac or Windows PC | ✅ Works (not ideal for always-on) |

**Minimum specs:**
- 2GB RAM
- 4GB free storage
- Stable internet connection (Substrate WebSocket RPC stays connected)
- Docker + Docker Compose installed

**Recommended OS:** Raspberry Pi OS Bookworm 64-bit (Desktop or Lite)

---

## Prerequisites

### 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

Verify:
```bash
docker --version
docker compose version
```

### 2. Install Node.js (required for setup wizard only)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify:
```bash
node --version
npm --version
```

> **Note:** Node.js is only needed to run `setup.js` once. After that, everything runs inside Docker and Node.js is no longer needed on the host.

### 3. Find your Manager Address

Your manager address is the SS58 address configured in the Acurast Processor app on your phones. It starts with `5` and looks like:

```
5YourManagerAddressHere...
```

You can find it in:
- The Acurast Processor app → Settings → Manager Address
- The Acurast Hub at [hub.acurast.com](https://hub.acurast.com)

### 4. Know your Pi's local IP

```bash
hostname -I | awk '{print $1}'
```

---

## Getting Your Processor Addresses

acumgr discovers your processor addresses **automatically** — no manual steps needed for most users.

### How it works

When you set your management endpoint in the Acurast Hub to your Pi's address, the Hub sends your complete processor list to acumgr every time you open the phones page. acumgr captures this automatically and saves it to config.json.

**Steps:**
1. Run setup and launch acumgr (see Installation below)
2. In the Acurast Hub → Phones → Settings → set Management Endpoint to `http://<your-pi-ip>:9001`
3. Open `hub.acurast.com/phones` — acumgr captures all your processors automatically
4. Done — your dashboard will populate within seconds

### If auto-capture doesn't work

Some users who migrated from Canary to Mainnet may need to provide addresses manually:

- Run `node setup.js` and choose **option 2** to paste addresses one per line
- To get your addresses: open `hub.acurast.com/phones` in Chrome, open DevTools → Network tab, filter by `bulk`, refresh the page, click the request that appears and copy everything after `?addresses=` in the URL

### Auto-discovery (new Mainnet users only)

If you joined Mainnet directly without migrating from Canary, run `node setup.js` and choose **option 1**. This queries the chain and finds all your processors automatically in ~30 seconds.

---

## Installation

### Step 1 — Clone or download acumgr

```bash
# Download and extract
cd ~
git clone https://github.com/yourusername/acumgr.git
cd acumgr

# OR download the zip and extract it
```

### Step 2 — Install Node.js (required for setup wizard only)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify:
```bash
node --version
npm --version
```

> **Note:** Node.js is only needed to run `setup.js` once. After that, everything runs inside Docker and Node.js is no longer needed on the host.

### Step 3 — Run setup

The setup wizard asks for your manager address and basic settings, then writes `config.json`. Your processor addresses are captured automatically later when the Hub connects.

```bash
cd server
npm install
node setup.js
cd ..
```

Follow the prompts:
```
Manager address (SS58): 5YourAddressHere...
Port [9001]:
Poll interval in minutes [30]:

How would you like to provide your processor addresses?
  1) Auto-discover from chain (~30 seconds, works for new Mainnet users)
  2) Paste a list of addresses manually
  3) Skip — processors captured automatically when Hub connects (recommended)

Choice [1]: 3

✓ Config saved to config.json

  Manager : 5YourAddressHere...
  Port    : 9001
  Poll    : every 30 minutes
  Phones  : 0 (will be populated automatically)
```

### Step 4 — Build and launch

```bash
docker compose up -d --build
```

Watch the logs:
```bash
docker compose logs -f
```

You should see:
```
╔════════════════════════════════════════╗
║          acumgr v1.0.0                 ║
║  Acurast Processor Fleet Manager       ║
╚════════════════════════════════════════╝

Dashboard  →  http://0.0.0.0:9001
Manager    →  5YourAddress...
Processors →  31 (from config.json)
Poll       →  every 30 minutes

[RPC] Connecting to wss://public-rpc.mainnet.acurast.com...
[RPC] Connected: Acurast Mainnet
[Price] ACU = $X.XXXX (Gate.io)
[Payout] Found: X.XXXX ACU at block XXXXXXX
[Refresh] Done — 31 processors, 29 online, balance: XXX.XXXX ACU
```

### Step 5 — Open the dashboard

Open a browser on any device on your local network:

```
http://<your-pi-ip>:9001
```

---

## Configure Acurast Hub

To have the Acurast Hub show live status from your local manager:

1. Go to [hub.acurast.com](https://hub.acurast.com) → **Manage Phones**
2. Find the **Management Endpoint** field
3. Enter: `http://<your-pi-ip>:9001`

The Hub will call your Pi automatically to fetch processor status.

---

## Configuration

`server/config.json` is generated by setup. You can edit it manually:

```json
{
  "managerAddress": "5YourManagerAddressHere...",
  "port": 9001,
  "pollMinutes": 30,
  "rpc": "wss://public-rpc.mainnet.acurast.com",
  "computePallet": "5EYCAe5g86uWAqpCzj2AMUzgybxYTycRNNxSBK17aziwTZAH",
  "epochLength": 900,
  "processors": [
    "5Processor1...",
    "5Processor2...",
    "..."
  ]
}
```

| Field | Description |
|-------|-------------|
| `managerAddress` | Your SS58 manager address |
| `port` | Port to run on (default 9001) |
| `pollMinutes` | How often to refresh chain data (default 30) |
| `rpc` | Acurast Mainnet WebSocket RPC endpoint |
| `computePallet` | Compute pallet account (don't change) |
| `epochLength` | Blocks per epoch (don't change) |
| `processors` | List of all your processor SS58 addresses |

**After editing config.json**, restart the container (no rebuild needed):
```bash
docker compose restart
```

**After updating processors**, you need to rebuild:
```bash
docker compose down
docker compose up -d --build
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Dashboard UI |
| `GET` | `/api/status` | Full state: processors, balance, payouts, price |
| `GET` | `/api/processors` | Flat processor list |
| `GET` | `/api/config` | Current configuration summary |
| `GET` | `/api/price` | Live ACU/USD price |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/refresh` | Trigger immediate chain refresh |
| `GET` | `/processor/check-in/processor/api/status/bulk?addresses=...` | Acurast Hub endpoint |

---

## Understanding the Dashboard

### Status indicators

| Status | Meaning |
|--------|---------|
| 🟢 Online | Heartbeat within the last 60 minutes |
| 🟡 Degraded | Heartbeat 1–2 hours ago |
| 🔴 Offline | No heartbeat for 2+ hours |

Processors heartbeat every ~30 minutes. A processor showing "Offline" may need attention — check the phone's internet connection and that the Acurast app is running.

### Compute Score

The compute score is a relative benchmark value derived from the Acurast chain's `acurastCompute.scores` storage. Higher scores mean the processor contributed more compute work in the current epoch. Scores vary by device model and performance.

### Fleet Reward This Epoch

The sum of all processors' `rewardContribution` values, converted to ACU. This is a running mid-epoch estimate — the final payout will typically be higher once the epoch closes and rewards are distributed.

### Last Epoch Payout

The actual ACU transfer from the compute pallet to your manager account at the last epoch boundary. Epochs run approximately every 90 minutes.

### Income Chart

- **Blue line** — cumulative ACU earned since you started acumgr
- **Green line** — manager account balance over time
- History is stored in your browser's localStorage and accumulates over days/weeks

---

## Updating

```bash
cd acumgr
git pull  # or download new zip
docker compose down
docker compose up -d --build
```

Your `config.json` is not overwritten by updates.

---

## Troubleshooting

### "config.json not found"
Run setup: `cd server && node setup.js`

### "No processors found" during setup
- Check your manager address is correct
- Make sure your processors have migrated to Acurast Mainnet
- Try re-running setup after waiting one epoch (~90 min)
- Add processor addresses manually to `config.json`

### All processors showing Offline
- The chain RPC may be temporarily down — check logs for `[RPC] Connection failed`
- The container auto-retries every poll interval
- Check your Pi has internet access: `ping 8.8.8.8`

### Price showing "ACU $—"
- Gate.io API may be temporarily unavailable
- Price updates with every 30-minute refresh
- Check logs for `[Price]` lines

### Hub endpoint not working
- Confirm the Pi's IP hasn't changed: `hostname -I`
- Make sure port 9001 isn't blocked by a firewall
- Test from another device: `curl http://<pi-ip>:9001/api/health`

### Two offline processors won't come back
- Check those specific phones — the Acurast app may have crashed or the phone may be off
- Look up the offline addresses in the dashboard and cross-reference with your physical phones

### Port 9001 already in use
Change the port in `config.json` and `docker-compose.yml`, then rebuild.

---

## Technical Notes

- **Chain queries** use the `@polkadot/api` Substrate client directly over WebSocket
- **Heartbeats** are stored as Unix timestamps (ms) in `acurastProcessorManager.processorHeartbeat`
- **Compute scores** come from `acurastCompute.scores(epochOffset, metricType)`
- **Epoch payouts** are discovered by scanning `balances.Transfer` events near epoch boundaries
- **Price data** comes from the Gate.io public REST API (no API key required)
- **Hub compatibility** — the `/processor/check-in/processor/api/status/bulk` endpoint matches exactly what the Acurast Hub calls when a local management endpoint is configured

---

## License

MIT — free to use, modify, and distribute.

---

*Built by the Acurast community. Not affiliated with Acurast Association.*
