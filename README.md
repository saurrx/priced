# Priced by SeerumAI

<p align="center">
  <video src="https://videowithsubtitles.s3.us-east-2.amazonaws.com/rjzrjoybpndmceo.mp4" controls width="720">
    Your browser does not support the video tag.
  </video>
</p>

<p align="center">
  <a href="https://videowithsubtitles.s3.us-east-2.amazonaws.com/rjzrjoybpndmceo.mp4">Watch the demo video</a>
</p>

<p align="center">
  <strong>Trade Prediction Markets Directly From Your X Timeline</strong>
</p>

<p align="center">
  <a href="https://priced.seerum.ai">Website</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#installation">Installation</a> &bull;
  <a href="docs/ARCHITECTURE.md">Docs</a> &bull;
  <a href="#privacy--security">Privacy & Security</a>
</p>

## Overview

Priced is a Chrome extension that brings real-time prediction markets directly into your X (Twitter) feed. Powered by **Jupiter Prediction Markets on Solana**, the extension uses intelligent semantic matching to detect tweets about real-world events and embeds interactive trading cards right below the tweet. Trade YES or NO shares without ever leaving your feed.

## Features

### Real-Time Market Matching
- Automatically detects tweets about elections, crypto prices, sports, and more
- Intelligent semantic matching — not keyword-based — so it catches what matters
- Batches and prioritizes visible tweets for fast, efficient matching

### Inline Trading Cards
- Beautiful market cards appear directly below matched tweets
- See YES/NO probabilities, volume, and close time at a glance
- Expand to view full market details and live price updates

### Trade via Solana Blinks
- One-click trading through Jupiter Prediction Markets
- Buy YES or NO shares with custom USD amounts
- Transactions execute through Solana Blinks — no redirect needed

## Installation

### Step 1: Download the Extension
- Click the green **Code** button on this repo, then **Download ZIP**
- Unzip the downloaded file

### Step 2: Load into Chrome
1. Open Google Chrome (also works on Brave and Edge)
2. Go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the **`extension`** folder from the unzipped download

### Step 3: Activate
1. Click the **Priced** extension icon in your browser toolbar
2. Enter your invite code: **`GRAVEYARD`**
3. Head to [x.com](https://x.com) and scroll your feed — market cards appear automatically!

## Getting an Invite Code

Priced is currently invite-only. To request access:
- Join our [Telegram community](https://t.me/+7EFz5w6MPfZiZmE1)
- Follow [@seerumAI](https://x.com/seerumAI) on X

## How It Works

When you scroll through X, Priced scans tweet text using a semantic AI model and matches it against 1,300+ active prediction market events on Jupiter. When a tweet matches, a compact market card slides in below the tweet showing current probabilities. Click to expand and trade directly via Solana Blinks.

## Permissions Explained

| Permission | Purpose |
|------------|---------|
| `storage` | Save your invite code and preferences locally |
| `host_permissions` (api.seerum.ai) | Communicate with the matching backend to find relevant markets |

## Privacy & Security

Your security is our top priority:

- **No Private Keys** — Priced never accesses or stores wallet private keys
- **No Clipboard Access** — No access to clipboard data
- **Minimal Permissions** — Only `storage` permission, no `tabs`, `scripting`, or `webRequest`
- **Limited Site Access** — Content scripts only run on x.com and twitter.com
- **No Tracking** — No analytics, telemetry, or user behavior tracking
- **Open Source** — All code is transparent and auditable in this repo

## For Developers

If you want to modify the extension source code:

```bash
cd extension
npm install
npm run build    # production build
npm run watch    # development with auto-rebuild
```

The extension source is in `extension/src/` (TypeScript). The build compiles to `extension/dist/`.

## Community

- Follow us on [X](https://x.com/seerumAI)
- Join our [Telegram](https://t.me/+7EFz5w6MPfZiZmE1)
- Visit [priced.seerum.ai](https://priced.seerum.ai)

---

<p align="center">
  Powered by <a href="https://x.com/seerumAI">SeerumAI</a>
</p>
