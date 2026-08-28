// Integration test: Lunar Lander multiplayer (Trystero/WebRTC) across two real
// Chrome instances. Run with:  bun test/multiplayer.lander.test.mjs
//
// Flow exercised:
//   1. Serve lander/index.html over localhost HTTP.
//   2. Launch TWO independent Chromium processes (true "two instances",
//      each with its own active rAF — no background-tab throttling).
//   3. Host: open ONLINE, read the generated room code.
//   4. Guest: open ONLINE, paste the host code into JOIN CODE, JOIN.
//   5. Assert the waiting room shows OPPONENT CONNECTED on both, and exactly
//      one peer gets the START RACE button.
//   6. Starter presses START; assert both instances enter the flight in lockstep
//      (both show the "SET BURN RATE" prompt, roles complementary).
//   7. Starter burns; assert live telemetry reaches the guest: the rival HUD
//      shows the opponent's altitude dropping below 120 mi.
//
// Note: needs internet access (Trystero discovers peers over public Nostr
// relays, then WebRTC data channels carry the game). WebRTC establishment is
// occasionally slow/flaky, so the whole flow is retried a few times.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const html = await readFile(join(ROOT, 'lander', 'index.html'), 'utf8');

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const CHROME_ARGS = [
  '--no-sandbox', '--disable-gpu', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-features=WebRtcHideLocalIpsWithMdns',
];

async function waitFor(page, fn, label, timeoutMs = 30_000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    try { last = await page.evaluate(fn); } catch { last = null; }
    if (last) return last;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`timeout (${timeoutMs}ms) waiting for: ${label} (last=${JSON.stringify(last)})`);
}

async function clickOnline(page) {
  await page.evaluate(() => {
    const li = [...document.querySelectorAll('#menuList li')].find(l => l.textContent.includes('ONLINE'));
    if (!li) throw new Error('ONLINE menu item not found');
    li.click();
  });
}

async function dump(page, name) {
  return page.evaluate(() => JSON.stringify({
    msg: document.getElementById('msg').textContent,
    status: document.getElementById('netStatus').textContent,
    p1: document.getElementById('p1tag').textContent,
    p2: document.getElementById('p2tag').textContent,
    rival: document.getElementById('rivalTag').textContent,
    state1: document.getElementById('state1').textContent,
  })).then(s => `${name}: ${s}`);
}

// One full host/guest flow. Throws on any assertion failure.
async function runFlow(hostBrowser, guestBrowser) {
  const host = await hostBrowser.newPage();
  const guest = await guestBrowser.newPage();
  for (const [name, page] of [['host', host], ['guest', guest]]) {
    page.on('pageerror', e => console.error(`[${name} pageerror]`, e.message));
  }

  // --- connect -----------------------------------------------------------
  await host.goto(BASE, { waitUntil: 'load' });
  await guest.goto(BASE, { waitUntil: 'load' });

  await clickOnline(host);
  const hostCode = await waitFor(host, () => document.getElementById('roomCode').textContent.trim(), 'host room code');
  if (!/^[a-z]+-\d{1,3}$/.test(hostCode)) throw new Error(`bad host code: "${hostCode}"`);

  await clickOnline(guest);
  await waitFor(guest, () => document.getElementById('roomCode').textContent.trim(), 'guest auto-host code');
  await guest.fill('#joinCode', hostCode);
  await guest.click('#joinBtn');

  // --- waiting room ------------------------------------------------------
  await waitFor(host, () => document.getElementById('state1').textContent.includes('CONNECTED'), 'host sees opponent connected', 45_000);
  await waitFor(guest, () => document.getElementById('state1').textContent.includes('CONNECTED'), 'guest sees opponent connected', 45_000);

  const hostStart = await host.evaluate(() => document.getElementById('startBtn').style.display !== 'none');
  const guestStart = await guest.evaluate(() => document.getElementById('startBtn').style.display !== 'none');
  if (hostStart === guestStart) throw new Error(`expected exactly one START button (host=${hostStart}, guest=${guestStart})`);
  const starter = hostStart ? host : guest;   // the peer with myIndex 0
  const waiter = hostStart ? guest : host;

  // --- start race --------------------------------------------------------
  await starter.evaluate(() => document.getElementById('startBtn').click());
  await waitFor(starter, () => document.getElementById('msg').textContent.includes('SET BURN RATE'), 'starter enters flight');
  await waitFor(waiter, () => document.getElementById('msg').textContent.includes('SET BURN RATE'), 'waiter enters flight', 45_000)
    .catch(async e => { console.error(await dump(starter, 'starter')); console.error(await dump(waiter, 'waiter')); throw e; });

  // roles complementary: exactly one side sees "YOU" as player 1
  const diag = async (page, name) => page.evaluate(() => {
    const s = window.__lunar ? window.__lunar() : null;
    return `${name}: myIndex=${s && s.myIndex} p1="${document.getElementById('p1tag').textContent}" status="${document.getElementById('netStatus').textContent}" startDisplay="${document.getElementById('startBtn').style.display}"`;
  });
  const starterP1 = await starter.evaluate(() => document.getElementById('p1tag').textContent);
  const waiterP1 = await waiter.evaluate(() => document.getElementById('p1tag').textContent);
  const starterIsP1 = starterP1.includes('YOU');
  const waiterIsP1 = waiterP1.includes('YOU');
  if (starterIsP1 === waiterIsP1) {
    console.error(await diag(starter, 'starter'));
    console.error(await diag(waiter, 'waiter'));
    throw new Error(`roles not complementary: starter=${starterP1} waiter=${waiterP1}`);
  }
  if (!starterIsP1) throw new Error('starter should be player 1 (YOU as P1)');

  // --- telemetry sync ----------------------------------------------------
  await starter.keyboard.press('Enter');                       // commit burn (K=0, free fall)
  await waitFor(waiter, () => {
    const m = document.getElementById('rivalTag').textContent.match(/· (\d+) MI/);
    return m ? parseInt(m[1], 10) < 120 : null;
  }, 'guest sees rival altitude drop below 120 mi', 45_000)
    .catch(async e => { console.error(await dump(starter, 'starter')); console.error(await dump(waiter, 'waiter')); throw e; });

  return { hostCode, starterP1, waiterP1, starter, waiter };
}

const ATTEMPTS = 3;
let lastError;
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  let hostBrowser, guestBrowser;
  try {
    hostBrowser = await chromium.launch({ headless: true, args: CHROME_ARGS });
    guestBrowser = await chromium.launch({ headless: true, args: CHROME_ARGS });
    const r = await runFlow(hostBrowser, guestBrowser);
    console.log('PASS: lander multiplayer integration');
    console.log(`  room code       : ${r.hostCode}`);
    console.log(`  starter is P1   : ${r.starterP1}`);
    console.log(`  waiter is P2    : ${r.waiterP1}`);
    console.log(`  rival telemetry : guest saw opponent altitude < 120 mi`);
    await r.starter.close();
    await r.waiter.close();
    break;
  } catch (e) {
    lastError = e;
    console.error(`attempt ${attempt}/${ATTEMPTS} failed: ${e.message}`);
    if (attempt < ATTEMPTS) await new Promise(r => setTimeout(r, 1500));
  } finally {
    if (hostBrowser) await hostBrowser.close();
    if (guestBrowser) await guestBrowser.close();
  }
}
server.close();

if (lastError) {
  console.error('FAIL: lander multiplayer integration');
  process.exit(1);
}
