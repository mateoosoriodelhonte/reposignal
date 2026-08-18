import { expect, test } from '@playwright/test';

/**
 * End-to-end coverage of the primary journey, run against a production build
 * with `GITHUB_FIXTURES=1`.
 *
 * The fixtures exist so these tests assert exact values. Against the live API,
 * "the score is 88" would fail the day someone merges a pull request into the
 * analyzed repository, and CI would depend on GitHub being reachable and on
 * the rate limit.
 *
 * `acme/toolkit` is the healthy fixture; `acme/sparse` has issues disabled, no
 * pull requests, and unreadable CI.
 */

test.describe('homepage', () => {
  test('explains the product and offers the search', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: /understand a github repository/i }),
    ).toBeVisible();
    await expect(page.getByLabel(/github repository/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Analyze' })).toBeVisible();
  });

  test('discloses what it measures, including the weights', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: /what reposignal measures/i }),
    ).toBeVisible();
    await expect(page.getByText('Security Hygiene')).toBeVisible();
    await expect(page.getByText('weight 10')).toBeVisible();
  });

  test('states that missing data is not counted as zero', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByText(/missing data is not treated as bad news/i),
    ).toBeVisible();
  });

  test('rejects invalid input without navigating away', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel(/github repository/i).fill('https://evil.com/a/b');
    await page.getByRole('button', { name: 'Analyze' }).click();

    await expect(page.getByText(/only github repositories/i)).toBeVisible();
    await expect(page).toHaveURL('/');
  });

  test('navigates to the analysis for valid input', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel(/github repository/i).fill('acme/toolkit');
    await page.getByRole('button', { name: 'Analyze' }).click();

    await expect(page).toHaveURL('/r/acme/toolkit');
    await expect(page.getByRole('heading', { name: 'acme/toolkit' })).toBeVisible();
  });
});

test.describe('analysis report', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/r/acme/toolkit');
  });

  test('shows the overall score with a text band, not colour alone', async ({ page }) => {
    await expect(page.getByText('Engineering health')).toBeVisible();
    // Every score carries an accessible "out of 100"; the headline is first.
    await expect(page.getByText('out of 100').first()).toBeAttached();
    await expect(page.getByText('Strong', { exact: true })).toBeVisible();
  });

  test('shows every category', async ({ page }) => {
    for (const label of [
      'Repository Activity',
      'Pull Request Health',
      'Issue Health',
      'CI Health',
      'Documentation',
      'Repository Hygiene',
      'Security Hygiene',
    ]) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
  });

  test('discloses how the overall score was calculated', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /how the overall score was calculated/i }),
    ).toBeVisible();

    const table = page.getByRole('table', { name: /each category/i });
    await expect(table).toBeVisible();
    await expect(table.getByText('Declared weight')).toBeVisible();
    await expect(table.getByText('Effective weight')).toBeVisible();
  });

  test('expands a category methodology on demand', async ({ page }) => {
    const disclosures = page.getByText('How was this calculated?');
    await expect(disclosures.first()).toBeVisible();

    // Collapsed until asked for: the detail is available, not imposed.
    await expect(
      page.getByRole('table', { name: /scoring components/i }).first(),
    ).toBeHidden();

    await disclosures.first().click();

    const table = page.getByRole('table', { name: /scoring components/i }).first();
    await expect(table).toBeVisible();
    // Column headers by role: the table's caption also contains these words.
    await expect(table.getByRole('columnheader', { name: 'Component' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Weight' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Observed' })).toBeVisible();
  });

  test('shows the scoring version and analysis freshness', async ({ page }) => {
    await expect(page.getByText(/scoring algorithm version 1\.0\.0/i)).toBeVisible();
    await expect(page.getByText(/analyzed/i).first()).toBeVisible();
  });

  test('links findings to their evidence on GitHub', async ({ page }) => {
    // The healthy fixture raises no findings, which is the point of it. The
    // sparse one raises plenty, each carrying an evidence link.
    await page.goto('/r/acme/sparse');

    const evidence = page.getByRole('link', { name: /view evidence on github/i }).first();
    await expect(evidence).toBeVisible();
    await expect(evidence).toHaveAttribute('rel', /noopener/);
    await expect(evidence).toHaveAttribute('href', /github\.com/);
  });
});

test.describe('partial and unavailable data', () => {
  test('reports unscorable categories without inventing numbers', async ({ page }) => {
    await page.goto('/r/acme/sparse');

    await expect(page.getByRole('heading', { name: 'acme/sparse' })).toBeVisible();

    // Issues disabled, no pull requests, CI unreadable — all "Insufficient
    // data", never 0.
    await expect(page.getByText('Insufficient data').first()).toBeVisible();
  });

  test('explains what could not be retrieved', async ({ page }) => {
    await page.goto('/r/acme/sparse');

    await expect(page.getByText(/some data could not be retrieved/i)).toBeVisible();
    await expect(page.getByText(/excluded from the score/i).first()).toBeVisible();
  });

  test('lists excluded categories with their reasons', async ({ page }) => {
    await page.goto('/r/acme/sparse');
    await expect(
      page.getByRole('heading', { name: /excluded from the score/i }),
    ).toBeVisible();
  });
});

test.describe('error states', () => {
  test('explains a repository that does not exist', async ({ page }) => {
    await page.goto('/r/acme/does-not-exist');

    await expect(
      page.getByRole('heading', { name: /repository not found/i }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /analyze a different/i })).toBeVisible();
  });

  test('returns a not-found page for a malformed repository path', async ({ page }) => {
    const response = await page.goto('/r/-invalid-/name');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: /page not found/i })).toBeVisible();
  });
});

test.describe('accessibility', () => {
  test('the primary journey is completable with the keyboard alone', async ({ page }) => {
    await page.goto('/');

    // Tab to the repository field, type, and submit with Enter.
    const input = page.getByLabel(/github repository/i);
    await input.focus();
    await expect(input).toBeFocused();

    await page.keyboard.type('acme/toolkit');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL('/r/acme/toolkit');
    await expect(page.getByRole('heading', { name: 'acme/toolkit' })).toBeVisible();
  });

  test('the methodology disclosure is keyboard operable', async ({ page }) => {
    await page.goto('/r/acme/toolkit');
    // The report streams in. Waiting for it before interacting mirrors what a
    // person does, and avoids toggling a <details> that hydration then
    // re-renders underneath the assertion.
    await page.getByText('Engineering health').waitFor();

    const summary = page.getByText('How was this calculated?').first();
    await summary.focus();
    await page.keyboard.press('Enter');

    await expect(
      page.getByRole('table', { name: /scoring components/i }).first(),
    ).toBeVisible();
  });

  test('offers a skip link before the main content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /skip to main content/i })).toBeFocused();
  });

  test('has exactly one h1 per page', async ({ page }) => {
    await page.goto('/r/acme/toolkit');
    await expect(page.locator('h1')).toHaveCount(1);
  });
});

test.describe('responsive layout', () => {
  test('renders without horizontal overflow on a small screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/r/acme/toolkit');

    await expect(page.getByRole('heading', { name: 'acme/toolkit' })).toBeVisible();

    // The page itself must never scroll sideways; wide tables scroll inside
    // their own container instead.
    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});

/**
 * The refresh path.
 *
 * Deliberately a single test rather than several. `refreshRateLimiter` is
 * per-server-process and allows 5 refreshes per 5 minutes, so two tests that
 * both refresh would share that budget and whichever ran second could be
 * limited — flaky in exactly the way the rest of this suite avoids. One test
 * owns the budget and walks it from success to limit.
 */
test.describe('manual refresh', () => {
  test('refreshes on demand, then explains when to try again', async ({ page }) => {
    await page.goto('/r/acme/toolkit');

    const refresh = page.getByRole('button', { name: 'Refresh' });
    const status = page.getByRole('status');

    // Sits beside the freshness line rather than somewhere else on the page.
    await expect(page.getByText(/analyzed/i).first()).toBeVisible();
    await expect(refresh).toBeVisible();

    // Keyboard operable with a visible focus state.
    await refresh.focus();
    await expect(refresh).toBeFocused();
    await page.keyboard.press('Enter');

    // The report stays on screen and the control returns to idle.
    await expect(refresh).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'acme/toolkit' })).toBeVisible();
    await expect(page.getByText(/scoring algorithm version/i)).toBeVisible();

    // The limiter allows 5 per window; keep going until it says stop. The
    // bound is the limit plus a couple of attempts, so a regression that
    // never limits fails here rather than looping.
    for (let attempt = 0; attempt < 7; attempt += 1) {
      if ((await status.textContent())?.includes('Refresh limit reached') === true) break;
      await refresh.click();
      await expect(refresh).toBeEnabled();
    }

    // Named a time to try again rather than failing silently.
    await expect(status).toContainText(/refresh limit reached/i);
    await expect(status).toContainText(/try again in \d+ (second|minute)s?/i);

    // And the report is still there — a refused refresh does not blank it.
    await expect(page.getByRole('heading', { name: 'acme/toolkit' })).toBeVisible();
  });
});

test.describe('security headers', () => {
  test('sets a nonce-based CSP and the standard hardening headers', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers() ?? {};

    expect(headers['content-security-policy']).toContain("script-src 'self' 'nonce-");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});
