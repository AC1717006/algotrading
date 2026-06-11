/**
 * Iterative selector-discovery tool for the Upstox login flow.
 *
 * Since login.upstox.com is a JS SPA, selectors can't be discovered from
 * static HTML. This script replays whichever steps you've already confirmed
 * (via --config) and dumps every interactive element (inputs/buttons/links)
 * on the resulting screen — id, name, placeholder, aria-label, classes — plus
 * a screenshot, so you can identify the next selector without a GUI.
 *
 * Workflow:
 *   1. node inspect-upstox-login.js --step mobile
 *        -> dumps the initial login screen's elements
 *      Find the mobile-number input + its "submit/get OTP" button,
 *      add them to login-selectors.json as mobileInput / mobileSubmit.
 *
 *   2. node inspect-upstox-login.js --step totp
 *        -> fills UPSTOX_MOBILE into mobileInput, clicks mobileSubmit,
 *           then dumps the next screen's elements
 *      Find the TOTP/OTP input + continue button,
 *      add as totpInput / totpSubmit.
 *
 *   3. node inspect-upstox-login.js --step pin
 *        -> replays mobile + totp, dumps the next screen's elements
 *      Find the PIN/password input + final login button,
 *      add as pinInput / pinSubmit.
 *
 *   4. node inspect-upstox-login.js --step final
 *        -> replays mobile + totp + pin, then waits for the redirect to
 *           UPSTOX_REDIRECT_URI and prints the final URL (containing ?code=...)
 *
 * Output (per step) is written to ./debug/<step>-elements.json and
 * ./debug/<step>-screenshot.png, relative to this script's directory.
 */

require('dotenv').config({ path: '/home/ubuntu/algotrading/backend/.env' });

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { authenticator } = require('otplib');

const {
  UPSTOX_MOBILE,
  UPSTOX_PASSWORD,
  UPSTOX_TOTP_SECRET,
  UPSTOX_API_KEY,
  UPSTOX_REDIRECT_URI,
} = process.env;

const DEBUG_DIR = path.join(__dirname, 'debug');
const NAV_TIMEOUT_MS = 45_000;

function parseArgs() {
  const args = { step: null, config: path.join(__dirname, 'login-selectors.json') };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--step') args.step = argv[++i];
    if (argv[i] === '--config') args.config = argv[++i];
  }
  if (!['mobile', 'totp', 'pin', 'final'].includes(args.step)) {
    console.error('Usage: node inspect-upstox-login.js --step <mobile|totp|pin|final> [--config login-selectors.json]');
    process.exit(1);
  }
  return args;
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function requireSelectors(config, keys, forStep) {
  const missing = keys.filter((k) => !config[k]);
  if (missing.length) {
    console.error(
      `Cannot run --step ${forStep}: missing selector(s) in config: ${missing.join(', ')}.\n` +
      `Run the earlier inspection step(s) first and add the discovered selectors to ${path.basename(forStep)}.`,
    );
    process.exit(1);
  }
}

async function dumpInteractiveElements(page) {
  return page.evaluate(() => {
    const pick = (el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      name: el.getAttribute('name') || null,
      type: el.getAttribute('type') || null,
      placeholder: el.getAttribute('placeholder') || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      classes: el.className || null,
      text: (el.textContent || '').trim().slice(0, 60) || null,
      maxLength: el.getAttribute('maxlength') || null,
      cssSelector: el.id
        ? `#${el.id}`
        : el.getAttribute('name')
          ? `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`
          : null,
    });
    return Array.from(document.querySelectorAll('input, button, textarea, [role="button"], a')).map(pick);
  });
}

async function saveOutput(page, step) {
  if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const elements = await dumpInteractiveElements(page);
  const elementsPath = path.join(DEBUG_DIR, `${step}-elements.json`);
  const screenshotPath = path.join(DEBUG_DIR, `${step}-screenshot.png`);
  fs.writeFileSync(elementsPath, JSON.stringify(elements, null, 2));
  await page.screenshot({ path: screenshotPath, fullPage: true });

  console.log(`\nCurrent URL: ${page.url()}`);
  console.log(`Saved ${elements.length} interactive elements to ${elementsPath}`);
  console.log(`Saved screenshot to ${screenshotPath}`);
  console.log('\n── Inputs found ──');
  for (const el of elements.filter((e) => e.tag === 'input' || e.tag === 'textarea')) {
    console.log(`  <${el.tag}> id=${el.id} name=${el.name} type=${el.type} placeholder=${el.placeholder} -> selector: ${el.cssSelector ?? '(none — use a more specific query)'}`);
  }
  console.log('\n── Buttons / clickable found ──');
  for (const el of elements.filter((e) => e.tag === 'button' || e.tag === 'a' || e.ariaLabel)) {
    console.log(`  <${el.tag}> id=${el.id} text="${el.text}" -> selector: ${el.cssSelector ?? '(none — use text content match)'}`);
  }
}

async function main() {
  const { step, config: configPath } = parseArgs();
  const config = loadConfig(configPath);

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

    console.log(`Navigating to: ${authUrl}`);
    await page.goto(authUrl, { waitUntil: 'networkidle2' });

    if (step === 'mobile') {
      await saveOutput(page, 'mobile');
      return;
    }

    requireSelectors(config, ['mobileInput', 'mobileSubmit'], configPath);
    await page.waitForSelector(config.mobileInput, { visible: true });
    await page.type(config.mobileInput, UPSTOX_MOBILE, { delay: 60 });
    await page.click(config.mobileSubmit);
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: NAV_TIMEOUT_MS }).catch(() => {});

    if (step === 'totp') {
      await saveOutput(page, 'totp');
      return;
    }

    requireSelectors(config, ['totpInput', 'totpSubmit'], configPath);
    await page.waitForSelector(config.totpInput, { visible: true });
    const totp = authenticator.generate(UPSTOX_TOTP_SECRET);
    console.log(`Generated TOTP: ${totp}`);
    await page.type(config.totpInput, totp, { delay: 60 });
    await page.click(config.totpSubmit);
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: NAV_TIMEOUT_MS }).catch(() => {});

    if (step === 'pin') {
      await saveOutput(page, 'pin');
      return;
    }

    requireSelectors(config, ['pinInput', 'pinSubmit'], configPath);
    await page.waitForSelector(config.pinInput, { visible: true });
    await page.type(config.pinInput, UPSTOX_PASSWORD, { delay: 60 });
    await page.click(config.pinSubmit);

    try {
      await page.waitForFunction(
        (redirectUri) => window.location.href.indexOf(redirectUri) === 0,
        { timeout: NAV_TIMEOUT_MS },
        UPSTOX_REDIRECT_URI,
      );
      const finalUrl = new URL(page.url());
      const code = finalUrl.searchParams.get('code');
      console.log(`\nRedirected to: ${finalUrl.toString()}`);
      console.log(code ? `✅ Authorization code: ${code}` : '⚠️  No "code" param found in redirect URL.');
    } catch {
      console.log('\n⚠️  Did not redirect to UPSTOX_REDIRECT_URI in time — dumping current screen instead.');
      console.log('There may be an extra confirmation/consent step.');
      await saveOutput(page, 'final');
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Inspection failed:', err);
  process.exit(1);
});
