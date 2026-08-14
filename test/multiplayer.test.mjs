// Integration test: multiplayer (Trystero/WebRTC) across two real Chrome
// instances. Run with:  bun test/multiplayer.test.mjs
//
// Flow exercised:
//   1. Serve index.html over localhost HTTP.
//   2. Launch TWO independent Chromium processes (true "two instances",
//      each with its own active rAF — no background-tab throttling).
//   3. Host: open ONLINE, read the generated room code.
//   4. Guest: open ONLINE, paste the host code into JOIN CODE, JOIN.
//   5. Assert the waiting room shows OPPONENT CONNECTED on both, and exactly
//      one peer (the host) gets the START GAME button.
//   6. Host presses START; assert both instances enter the game in lockstep.
//   7. P1 fires; assert the turn flips in sync on both instances.
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
const html = await readFile(join(ROOT, 'index.html'), 'utf8');

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
  const starter = hostStart ? host : guest;   // the host (myIndex 0)
  const waiter = hostStart ? guest : host;
  // --- start game --------------------------------------------------------
  await starter.evaluate(() => document.getElementById('startBtn').click());
  await waitFor(starter, () => document.getElementById('msg').textContent.includes('TURN'), 'host enters game');
  await waitFor(waiter, () => document.getElementById('msg').textContent.includes('TURN'), 'guest enters game', 45_000)
    .catch(async e => { console.error(await dump(starter, 'starter')); console.error(await dump(waiter, 'waiter')); throw e; });

  // roles complementary: exactly one side sees "YOU" as player 1
  const starterP1 = await starter.evaluate(() => document.getElementById('p1tag').textContent);
  const waiterP1 = await waiter.evaluate(() => document.getElementById('p1tag').textContent);
  const starterIsP1 = starterP1.includes('YOU');
  const waiterIsP1 = waiterP1.includes('YOU');
  if (starterIsP1 === waiterIsP1) throw new Error(`roles not complementary: starter=${starterP1} waiter=${waiterP1}`);
  if (!starterIsP1) throw new Error('starter should be player 1 (YOU as P1)');

  // --- shot sync ---------------------------------------------------------
  await starter.keyboard.press('Enter');                       // P1 fires
  await waitFor(waiter, () => document.getElementById('msg').textContent.includes('YOUR'), 'P2 turn after shot', 45_000);
  await waitFor(starter, () => document.getElementById('msg').textContent.includes('OPPONENT'), 'P1 sees opponent turn', 45_000);

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
    console.log('PASS: multiplayer integration');
    console.log(`  room code       : ${r.hostCode}`);
    console.log(`  starter (P1)    : ${r.starterP1}`);
    console.log(`  waiter  (P2)    : ${r.waiterP1}`);
    console.log(`  turn after shot : ${await r.starter.evaluate(() => document.getElementById('msg').textContent)} | ${await r.waiter.evaluate(() => document.getElementById('msg').textContent)}`);
    lastError = null;
    break;
  } catch (e) {
    lastError = e;
    console.error(`attempt ${attempt}/${ATTEMPTS} failed: ${e.message}`);
  } finally {
    await hostBrowser?.close().catch(() => {});
    await guestBrowser?.close().catch(() => {});
  }
}
server.close();

if (lastError) {
  console.error(`FAIL after ${ATTEMPTS} attempts: ${lastError.message}`);
  process.exit(1);
}
