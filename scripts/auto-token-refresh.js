/**
 * Automatic daily Upstox access-token refresh.
 *
 * Flow:
 *   1. Open Upstox OAuth authorize URL (login.upstox.com)
 *   2. Log in with mobile + password/PIN
 *   3. Complete 2FA using a TOTP generated from UPSTOX_TOTP_SECRET
 *   4. Capture the `code` from the redirect_uri
 *   5. Exchange the code for an access_token via Upstox's token API
 *   6. Log in to the AlgoTrader API as the admin user and call
 *      POST /api/broker/token with the new access token — this persists
 *      the token, writes an AuditLog entry, and hot-reloads every PM2
 *      cluster instance via Redis pub/sub (no restart required).
 *   7. Notify success/failure via Telegram.
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

const puppeteer = require('puppeteer');
const { authenticator } = require('otplib');
const axios = require('axios');

const {
  UPSTOX_MOBILE,
  UPSTOX_PASSWORD,
  UPSTOX_TOTP_SECRET,
  UPSTOX_API_KEY,
  UPSTOX_API_SECRET,
  UPSTOX_REDIRECT_URI,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  BACKEND_API_URL,
} = process.env;

const API_BASE_URL = BACKEND_API_URL || 'http://localhost:4000/api';

const REQUIRED_ENV = [
  'UPSTOX_MOBILE',
  'UPSTOX_PASSWORD',
  'UPSTOX_TOTP_SECRET',
  'UPSTOX_API_KEY',
  'UPSTOX_API_SECRET',
  'UPSTOX_REDIRECT_URI',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
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

// ─── AlgoTrader API: log in as admin, then push the new token ────────────────
async function loginAsAdmin() {
  const { data } = await axios.post(`${API_BASE_URL}/auth/login`, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (!data?.data?.accessToken) {
    throw new Error('AlgoTrader login did not return an accessToken');
  }
  return data.data.accessToken;
}

async function pushTokenToBackend(upstoxAccessToken) {
  const adminAccessToken = await loginAsAdmin();

  await axios.post(
    `${API_BASE_URL}/broker/token`,
    { accessToken: upstoxAccessToken },
    { headers: { Authorization: `Bearer ${adminAccessToken}` } },
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const code = await getAuthorizationCode();
  const token = await exchangeCodeForToken(code);
  await pushTokenToBackend(token);

  const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  await sendTelegram(`✅ Upstox token refreshed successfully at ${time} (hot-reloaded, no restart needed)`);
}

main().catch(async (err) => {
  console.error('Token refresh failed:', err);
  await sendTelegram(`❌ Token refresh failed: ${err.message}`);
  process.exit(1);
});
