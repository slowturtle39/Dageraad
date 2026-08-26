/**
 * Screenshots for the status PDF.
 *
 * IN THE REPO ON PURPOSE. This lived outside it as a scratch file, was
 * gitignored, and was eventually lost — after which `build_status_pdf.py`
 * silently produced a document with no figures at all, because a missing
 * screenshot is not an error there. A build step nobody can reproduce is a
 * build step that quietly degrades.
 *
 *   npm run dev &            # or let this script find a running server
 *   node tools/shots.mjs     # writes /tmp/pdf-*.png
 *   python3 tools/build_status_pdf.py
 *
 * Set BASE to point at a server on another port.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const OUT = process.env.SHOTS_OUT ?? '/tmp';

/**
 * The demo's bottom bar cycles phone -> tablet -> lobby -> setup -> phone.
 *
 * Forced clicks because the night decision prompt draws a `.scrim` over the
 * whole screen — deliberately, so that from across the room deciding and idly
 * browsing look the same. It also means an unforced click never lands.
 */
async function cycleTo(page, label) {
  for (let i = 0; i < 5; i++) {
    const btn = page.locator('.bottombar button').first();
    if ((await btn.textContent())?.trim() === label) return;
    // dispatchEvent rather than click: `force` only skips the actionability
    // CHECK, the event still hit-tests and the scrim is topmost, so a forced
    // click lands on the scrim and nothing happens.
    await btn.dispatchEvent('click');
    await page.waitForTimeout(150);
  }
  throw new Error(`could not reach view button "${label}"`);
}

/**
 * Force Dutch. The status document is Dutch, and a headless browser reports an
 * English locale, so without this the figures quietly disagree with the prose
 * around them. The toggle is labelled with the language it switches TO.
 */
async function useDutch(page) {
  const toggle = page.locator('.bottombar button', { hasText: /^NL$/ });
  if (await toggle.count()) {
    await toggle.first().dispatchEvent('click');
    await page.waitForTimeout(150);
  }
}

/** Close the night prompt, for shots that want the bare table underneath. */
async function dismissSheet(page) {
  const scrim = page.locator('.scrim');
  if (await scrim.count()) {
    await scrim.first().dispatchEvent('click');
    await page.waitForTimeout(200);
  }
}

const shots = [
  {
    name: 'pdf-table.png',
    viewport: { width: 390, height: 844 },
    async go(page) {
      // The phone table, mid-night, with a decision prompt drawn OVER it —
      // the thing worth showing is that deciding and idly browsing look alike.
      await cycleTo(page, 'Telefoon');
      await useDutch(page);
    },
  },
  {
    name: 'pdf-stats.png',
    viewport: { width: 390, height: 844 },
    async go(page) {
      await cycleTo(page, 'Telefoon');
      await useDutch(page);
      await dismissSheet(page);
      // The NAME opens history, not the card — the card is the suspicion
      // gesture, and the two were deliberately separated. Tapping a name is
      // the stats-on-tap cover traffic (§5.4).
      await page.locator('.seat__name').nth(2).dispatchEvent('click');
      await page.waitForTimeout(250);
    },
  },
  {
    name: 'pdf-tablet.png',
    viewport: { width: 1024, height: 768 },
    async go(page) {
      await cycleTo(page, 'Tablet');
      await useDutch(page);
    },
  },
  {
    name: 'pdf-setup.png',
    viewport: { width: 390, height: 844 },
    async go(page) {
      await cycleTo(page, 'Opzet');
      await useDutch(page);
    },
  },
];

const browser = await chromium.launch();
try {
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: shot.viewport });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await shot.go(page);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${shot.name}` });
    console.log('wrote', `${OUT}/${shot.name}`);
    await page.close();
  }
} finally {
  await browser.close();
}
