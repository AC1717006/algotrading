/**
 * Automatic daily Upstox access-token refresh.
 *
 * Flow:
 *   1. Open Upstox OAuth authorize URL (login.upstox.com)
 *   2. Log in with mobile + password/PIN
 *   3. Complete 2FA using a TOTP generated from UPSTOX_TOTP_SECRET
 *   4. Capture the `code` from the redirect_uri
 *   5. Exchange the code for an access_token via Upstox's token API
 *   6. Persist the token into the `settings` table (key = 'upstox_access_token')
 *   7. Restart the `algo-backend` PM2 process so it picks up the new token
 *   8. Notify success/failure via Telegram
 *
 * Run via cron — see setup-cron.sh.
 *
 * Login page selectors (mobileInput/mobileSubmit/totpInput/totpSubmit/
 * pinInput/pinSubmit) are loaded from login-selectors.json, discovered via
 * inspect-upstox-login.js. Run that tool first if login-selectors.json
 * doesn't exist yet or login starts failing after an Upstox UI change.
 */

require('dotenv').config({ path: '/home/ubuntu/algotrading/backend/.env' });

const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const puppeteer = require('puppeteer');
const { authenticator } = require('otplib');
const { Client } = require('pg');
const axios = require('axios');

const {
  UPSTOX_MOBILE,
  UPSTOX_PASSWORD,
  UPSTOX_TOTP_SECRET,
  UPSTOX_API_KEY,
  UPSTOX_API_SECRET,
  UPSTOX_REDIRECT_URI,
  DATABASE_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
} = process.env;

const REQUIRED_ENV = [
  'UPSTOX_MOBILE',
  'UPSTOX_PASSWORD',
  'UPSTOX_TOTP_SECRET',
  'UPSTOX_API_KEY',
  'UPSTOX_API_SECRET',
  'UPSTOX_REDIRECT_URI',
  'DATABASE_URL',
];

const SCREENSHOT_DIR = '/home/ubuntu/logs';
const NAV_TIMEOUT_MS = 45_000;
const SELECTORS_PATH = path.join(__dirname, 'login-selectors.json');
const REQUIRED_SELECTORS = ['mobileInput', 'mobileSubmit', 'totpInput', 'totpSubmit', 'pinInput', 'pinSubmit'];

function loadSelectors() {
  if (!fs.existsSync(SELECTORS_PATH)) {
    throw new Error(
      `Missing ${SELECTORS_PATH}. Run inspect-upstox-login.js to discover the login page selectors first ` +
      `(see login-selectors.example.json for the expected format).`,
    );
  }
  const selectors = JSON.parse(fs.readFileSync(SELECTORS_PATH, 'utf8'));
  const missing = REQUIRED_SELECTORS.filter((k) => !selectors[k]);
  if (missing.length) {
    throw new Error(`login-selectors.json is missing: ${missing.join(', ')}`);
  }
  return selectors;
}

// ─── Telegram ────────────────────────────────────────────────────────────────
async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('Telegram not configured — skipping notification:', message);
    return;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
    });
  } catch (err) {
    console.error('Failed to send Telegram message:', err.message);
  }
}

// ─── Debug helper ────────────────────────────────────────────────────────────
async function saveDebugScreenshot(page, label) {
  try {
    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const file = path.join(SCREENSHOT_DIR, `upstox-login-${label}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.error(`Saved debug screenshot: ${file}`);
  } catch (err) {
    console.error('Could not save debug screenshot:', err.message);
  }
}

// ─── Browser login → authorization code ─────────────────────────────────────
async function getAuthorizationCode() {
  const selectors = loadSelectors();

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  await page.setViewport({ width: 1280, height: 900 });

  try {
    const authUrl =
      `https://api.upstox.com/v2/login/authorization/dialog` +
      `?response_type=code&client_id=${encodeURIComponent(UPSTOX_API_KEY)}` +
      `&redirect_uri=${encodeURIComponent(UPSTOX_REDIRECT_URI)}`;

    await page.goto(authUrl, { waitUntil: 'networkidle2' });

    // ── Step 1: Mobile number ────────────────────────────────────────────────
    await page.waitForSelector(selectors.mobileInput, { visible: true });
    await page.type(selectors.mobileInput, UPSTOX_MOBILE, { delay: 60 });
    await page.click(selectors.mobileSubmit);

    // ── Step 2: TOTP (2FA) ───────────────────────────────────────────────────
    await page.waitForSelector(selectors.totpInput, { visible: true });
    const totp = authenticator.generate(UPSTOX_TOTP_SECRET);
    await page.type(selectors.totpInput, totp, { delay: 60 });
    await page.click(selectors.totpSubmit);

    // ── Step 3: PIN / Password ───────────────────────────────────────────────
    await page.waitForSelector(selectors.pinInput, { visible: true });
    await page.type(selectors.pinInput, UPSTOX_PASSWORD, { delay: 60 });
    await page.click(selectors.pinSubmit);

    // ── Step 4: Wait for redirect back to redirect_uri with ?code=... ───────
    await page.waitForFunction(
      (redirectUri) => window.location.href.indexOf(redirectUri) === 0,
      { timeout: NAV_TIMEOUT_MS },
      UPSTOX_REDIRECT_URI,
    );

    const finalUrl = new URL(page.url());
    const code = finalUrl.searchParams.get('code');
    if (!code) {
      throw new Error(`Authorization code missing from redirect URL: ${finalUrl.toString()}`);
    }
    return code;
  } catch (err) {
    await saveDebugScreenshot(page, 'error');
    throw err;
  } finally {
    await browser.close();
  }
}

// ─── Exchange authorization code for access token ───────────────────────────
async function exchangeCodeForToken(code) {
  const { data } = await axios.post(
    'https://api.upstox.com/v2/login/authorization/token',
    new URLSearchParams({
      code,
      client_id: UPSTOX_API_KEY,
      client_secret: UPSTOX_API_SECRET,
      redirect_uri: UPSTOX_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  if (!data.access_token) {
    throw new Error('Upstox token endpoint did not return an access_token');
  }
  return data.access_token;
}

// ─── Persist token to PostgreSQL ─────────────────────────────────────────────
async function saveTokenToDb(token) {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      `UPDATE settings SET value = $1, updated_at = now() WHERE key = 'upstox_access_token'`,
      [token],
    );
    if (result.rowCount === 0) {
      // Row doesn't exist yet — create it.
      await client.query(
        `INSERT INTO settings (id, key, value, description) VALUES (gen_random_uuid(), 'upstox_access_token', $1, 'Upstox API access token')`,
        [token],
      );
    }
  } finally {
    await client.end();
  }
}

// ─── Restart backend via PM2 ─────────────────────────────────────────────────
async function restartBackend() {
  await execAsync('pm2 restart algo-backend');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const code = await getAuthorizationCode();
  const token = await exchangeCodeForToken(code);
  await saveTokenToDb(token);
  await restartBackend();

  const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  await sendTelegram(`✅ Upstox token refreshed successfully at ${time}`);
}

main().catch(async (err) => {
  console.error('Token refresh failed:', err);
  await sendTelegram(`❌ Token refresh failed: ${err.message}`);
  process.exit(1);
});
