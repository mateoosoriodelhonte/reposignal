/**
 * Captures the README screenshots.
 *
 *   npm run dev            # in another terminal, with GITHUB_TOKEN set
 *   npm run screenshots
 *
 * Deliberately points at the running app with a real token, so the images show
 * a real analysis of a real repository. Screenshotting the bundled fixtures
 * would mean publishing invented numbers as though they were live.
 */
import { mkdir } from 'node:fs/promises';

import { chromium } from '@playwright/test';

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000';
const REPOSITORY = process.env.SCREENSHOT_REPOSITORY ?? 'facebook/react';
const OUT = 'docs/images';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/homepage.png` });
  console.log(`wrote ${OUT}/homepage.png`);

  await page.goto(`${BASE}/r/${REPOSITORY}`, { timeout: 60_000 });
  // Wait for the streamed analysis to replace the loading fallback.
  await page.getByText('Engineering health').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(500);

  await page.screenshot({ path: `${OUT}/analysis.png` });
  console.log(`wrote ${OUT}/analysis.png`);

  // The methodology disclosure, expanded — the feature the product is about.
  const disclosure = page.getByText('How was this calculated?').first();
  await disclosure.scrollIntoViewIfNeeded();
  await disclosure.click();
  await page.waitForTimeout(300);
  await disclosure.scrollIntoViewIfNeeded();

  await page.screenshot({ path: `${OUT}/methodology.png` });
  console.log(`wrote ${OUT}/methodology.png`);
} finally {
  await browser.close();
}
