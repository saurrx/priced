# Priced by SeerumAI 🦅

**Priced by SeerumAI** is a seamless browser extension that brings real-time Web3 prediction markets directly into your X (formerly Twitter) timeline. 

Powered by **SeerumAI** & **Jupiter Prediction Markets on Solana**, this extension uses an intelligent vector-matching backend to automatically detect tweets about real-world events (e.g., elections, crypto prices, sports) and natively embeds a gorgeous, interactive Solana **Blink** right below the tweet. This allows users to trade "YES" or "NO" shares directly from their feed with custom USD quantities, without ever leaving X!

---

## 🚀 How to Install and Use the Extension

Since this extension is currently in active development, you can run it directly on your browser by loading the local folder. Keep in mind that you must **build** the extension first so the browser can read it!

Follow these exact steps to install it on Google Chrome, Brave, or Edge:

### Step 1: Download & Build the Extension
1. Clone or download this repository to your computer.
2. Open your terminal and navigate to the `extension` folder inside the project:
   ```bash
   cd dflow/extension
   ```
3. Install the dependencies for the extension:
   ```bash
   npm install
   ```
4. Build the final extension files:
   ```bash
   npm run build
   ```
   *This command will generate a new `dist/` folder inside the `extension` directory. This `dist/` folder is what Chrome actually needs!*

### Step 2: Load into Google Chrome
1. Open Google Chrome.
2. Type `chrome://extensions/` into your address bar and press Enter.
3. In the top-right corner, turn on the **Developer mode** toggle.
4. Click the **Load unpacked** button in the top-left corner.
5. In the file picker, select the newly generated **`dist`** folder (located inside `dflow/extension/dist`).

### Step 3: Use the Extension!
1. Go to [x.com](https://x.com) and refresh the page.
2. Scroll through your feed! Whenever a tweet mentions a topic that matches an active prediction market (like Bitcoin price targets or political events), a beautiful "Priced by SeerumAI" market card will magically appear below the tweet.
3. Click **Trade** to expand the Blink and place your bets instantly!

---

### Backend Requirements (For Developers)
*Note: The extension relies on a backend Python vectorizer and a Next.js Actions API to serve the Blinks. If you are a developer setting up the environment from scratch, please refer to the deployment documentation to spin up the local AI matching servers.*
