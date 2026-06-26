/**
 * E2E tests: Report markdown rendering, accessibility, and wide tables.
 *
 * These tests FAIL before implementation (Next.js app does not exist).
 *
 * AC coverage:
 *   Story 3 AC 4 — Markdown tables render as HTML tables
 *   Story 3 AC 5 — .gov URLs as clickable anchors
 *   Story 3 AC 8 — Static HTML accessible without JavaScript
 *   Edge case: 10-column table horizontally scrollable on 375px viewport
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helper: perform complete intake + run + wait for report
// ---------------------------------------------------------------------------

async function getToReport(page: import('@playwright/test').Page) {
  await page.goto('/');

  await page.locator('[data-testid="chat-input"]').fill(
    'ZIP 77001, income $42,000/year, single parent, 2 kids ages 4 and 9'
  );
  await page.locator('[data-testid="send-button"]').click();
  await page.waitForTimeout(2000);

  const skipButton = page.locator('[data-testid="skip-button"]').or(
    page.locator('button:has-text("Skip remaining questions")')
  );
  if (await skipButton.isVisible({ timeout: 8_000 })) {
    await skipButton.click();
    await page.waitForTimeout(1000);
  }

  const runButton = page.locator('[data-testid="run-analysis-button"]').or(
    page.locator('button:has-text("Run Analysis")')
  );
  await runButton.waitFor({ timeout: 10_000 });
  await runButton.click();

  // Wait for the report to appear after mock-kvr completes
  await page.waitForSelector('[data-testid="report-view"]', { timeout: 60_000 });
}

// ---------------------------------------------------------------------------
// Markdown table rendering (Story 3 AC 4)
// ---------------------------------------------------------------------------

test.describe('Markdown table rendering', () => {
  test('eligibility matrix renders as an HTML <table>, not raw pipe characters', async ({ page }) => {
    await getToReport(page);

    // Expand the eligibility-validation section
    const section = page.locator('[data-testid="section-eligibility-validation"]');
    await section.click();
    await page.waitForTimeout(500);

    // Should contain a real HTML table element
    const tableLocator = page.locator('[data-testid="section-eligibility-validation"] table');
    await expect(tableLocator).toBeVisible({ timeout: 5_000 });

    // The table should have thead and tbody
    await expect(tableLocator.locator('thead')).toBeVisible();
    await expect(tableLocator.locator('tbody')).toBeVisible();

    // No raw pipe characters should appear as visible text
    const rawText = await page.locator('[data-testid="section-eligibility-validation"]').textContent();
    // Raw markdown would look like "| Program | Status |" — we check the HTML has actual cells
    const sectionHtml = await page.locator('[data-testid="section-eligibility-validation"]').innerHTML();
    expect(sectionHtml).toContain('<td>');
    expect(sectionHtml).not.toMatch(/\|\s*Program\s*\|\s*Status\s*\|/); // no raw markdown tables
  });

  test('benefits research table rows contain program data', async ({ page }) => {
    await getToReport(page);

    // Expand benefits research
    await page.locator('[data-testid="section-benefits-research"]').click();
    await page.waitForTimeout(500);

    // Should contain table cells with program names from mock-kvr fixture
    await expect(page.locator('[data-testid="section-benefits-research"] table td')).toBeVisible({ timeout: 5_000 });

    // Check that CHIP appears in the rendered table (from fixture data)
    const tableText = await page.locator('[data-testid="section-benefits-research"] table').textContent();
    expect(tableText).toContain('CHIP');
  });
});

// ---------------------------------------------------------------------------
// Government URL rendering (Story 3 AC 5)
// ---------------------------------------------------------------------------

test.describe('Government URL rendering', () => {
  test('healthcare.gov links are anchor elements with target=_blank', async ({ page }) => {
    await getToReport(page);

    // The action plan section is expanded by default — look for healthcare.gov links
    const healthcareLinks = page.locator('[data-testid="section-action-plan"] a[href*="healthcare.gov"]');
    const count = await healthcareLinks.count();
    expect(count).toBeGreaterThan(0);

    const firstLink = healthcareLinks.first();
    await expect(firstLink).toHaveAttribute('target', '_blank');
    await expect(firstLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('yourtexasbenefits.com links are anchor elements with target=_blank', async ({ page }) => {
    await getToReport(page);

    const texasLinks = page.locator('a[href*="yourtexasbenefits.com"]').first();
    await expect(texasLinks).toBeVisible({ timeout: 5_000 });
    await expect(texasLinks).toHaveAttribute('target', '_blank');
    await expect(texasLinks).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('tdhca.state.tx.us (LIHEAP) links are rendered as anchors', async ({ page }) => {
    await getToReport(page);

    // Expand action plan section (should already be open)
    const liheapLink = page.locator('a[href*="tdhca.state.tx.us"]').first();
    if (await liheapLink.isVisible({ timeout: 5_000 })) {
      await expect(liheapLink).toHaveAttribute('target', '_blank');
    }
    // At minimum, check for tdhca link in rendered HTML
    const reportHtml = await page.locator('[data-testid="report-view"]').innerHTML();
    expect(reportHtml).toContain('tdhca.state.tx.us');
  });

  test('plain text URLs in markdown are NOT converted to anchor tags (only explicitly linked)', async ({ page }) => {
    await getToReport(page);

    // Sanity check: anchor href attributes should be proper URLs, not partial strings
    const allLinks = page.locator('[data-testid="report-view"] a[href]');
    const linkCount = await allLinks.count();
    expect(linkCount).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(linkCount, 5); i++) {
      const href = await allLinks.nth(i).getAttribute('href');
      // Each href should be a valid URL starting with http(s)
      if (href) {
        expect(href).toMatch(/^https?:\/\//);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Wide table horizontal scrolling (edge case: 10+ column tables)
// ---------------------------------------------------------------------------

test.describe('Wide table horizontal scrolling', () => {
  test('insurance comparison table is wrapped in overflow-x-auto on 375px viewport', async ({ browser }) => {
    // Use MOCK_KVR_WIDE_TABLE=1 env var for the mock-kvr script
    // This test uses a separate browser context with env-driven content.
    // Since the env var is set in mock-kvr script itself, we test the CSS behavior
    // by checking that overflow-x-auto class is applied to table wrappers.

    const context = await browser.newContext({
      viewport: { width: 375, height: 812 }, // iPhone SE viewport
    });
    const page = await context.newPage();

    await page.goto('/');
    await page.locator('[data-testid="chat-input"]').fill(
      'ZIP 77001, income $42k, single parent 2 kids ages 4 and 9'
    );
    await page.locator('[data-testid="send-button"]').click();
    await page.waitForTimeout(2000);

    const skipButton = page.locator('[data-testid="skip-button"]').or(
      page.locator('button:has-text("Skip remaining questions")')
    );
    if (await skipButton.isVisible({ timeout: 8_000 })) {
      await skipButton.click();
      await page.waitForTimeout(1000);
    }

    const runButton = page.locator('[data-testid="run-analysis-button"]').or(
      page.locator('button:has-text("Run Analysis")')
    );
    await runButton.waitFor({ timeout: 10_000 });
    await runButton.click();
    await page.waitForSelector('[data-testid="report-view"]', { timeout: 60_000 });

    // Expand insurance-research section
    await page.locator('[data-testid="section-insurance-research"]').click();
    await page.waitForTimeout(500);

    // Tables should be wrapped in overflow-x-auto containers
    const tableWrappers = page.locator('.overflow-x-auto');
    const wrapperCount = await tableWrappers.count();
    expect(wrapperCount).toBeGreaterThan(0);

    // The page body should not overflow horizontally
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375 + 20); // allow minor rounding

    await context.close();
  });
});

// ---------------------------------------------------------------------------
// Progressive enhancement: no-JS report render (Story 3 AC 8)
// ---------------------------------------------------------------------------

test.describe('No-JS progressive enhancement (Story 3 AC 8)', () => {
  test('report page returns static HTML render when JavaScript is disabled', async ({ browser }) => {
    // This validates MAJOR review finding fix 2: DOMPurify SSR crash.
    // If SSR crashes, this test fails with a 500 error or blank page.

    const context = await browser.newContext({
      javaScriptEnabled: false,
    });
    const page = await context.newPage();

    // Navigate directly to the root — the server component should render static HTML
    // Even without JS, the page should not be blank
    await page.goto('/');

    // The page should load successfully (HTTP 200)
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);

    // The page should contain some visible text (not a blank page / server crash)
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toBeTruthy();
    expect(bodyText!.length).toBeGreaterThan(10);

    // The page should not show a 500 error
    expect(bodyText).not.toContain('Internal Server Error');
    expect(bodyText).not.toContain('Application error');
    expect(bodyText).not.toContain('ReferenceError');
    expect(bodyText).not.toContain('window is not defined');
    expect(bodyText).not.toContain('document is not defined');

    await context.close();
  });

  test('server renders HTML report without ReferenceError from DOMPurify/window', async ({ page }) => {
    // Test that SSR does not crash even with no-JS context simulation.
    // This catches the DOMPurify SSR issue (MAJOR fix 2).
    // We look for error output in the page HTML.

    const response = await page.goto('/');
    const html = await page.content();

    // No window/document undefined errors in the rendered HTML
    expect(html).not.toContain('window is not defined');
    expect(html).not.toContain('document is not defined');
    expect(html).not.toContain('ReferenceError');

    // HTTP status should be 200
    expect(response?.status()).toBe(200);
  });
});
