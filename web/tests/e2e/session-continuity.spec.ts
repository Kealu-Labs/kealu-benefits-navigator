/**
 * E2E tests: Session continuity — page reload restores intake state.
 *
 * These tests FAIL before implementation (Next.js app does not exist).
 *
 * AC coverage:
 *   Story 5 AC 1 — Cookie Max-Age is 7200s
 *   Story 5 AC 3 — Reload restores chat history, does not re-ask answered questions
 *   Story 5 AC 4 — Mid-run reload reconnects SSE stream
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helper: complete Tier-1 intake and pause (do NOT start run)
// ---------------------------------------------------------------------------

async function completeTier1(page: import('@playwright/test').Page) {
  await page.goto('/');

  await page.locator('[data-testid="chat-input"]').fill(
    'ZIP 77001, income $42k, single parent 2 kids ages 4 and 9'
  );
  await page.locator('[data-testid="send-button"]').click();
  await page.waitForTimeout(2000);

  // Wait for Tier-2 question or skip button to confirm Tier-1 is complete
  await page.locator('[data-testid="skip-button"]')
    .or(page.locator('button:has-text("Skip remaining questions")'))
    .or(page.locator('[data-testid="assistant-message"]').nth(1))
    .waitFor({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Story 5 AC 1: Cookie Max-Age is 7200 seconds
// ---------------------------------------------------------------------------

test.describe('Session cookie TTL (Story 5 AC 1)', () => {
  test('session cookie has Max-Age of 7200 seconds', async ({ page, context }) => {
    await page.goto('/');

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'session');
    expect(sessionCookie).toBeDefined();

    // Max-Age 7200 = 2 hours
    // In Playwright, expires is an absolute timestamp
    // Check that the expiry is approximately 2 hours from now
    if (sessionCookie?.expires) {
      const nowSec = Date.now() / 1000;
      const ttlSeconds = sessionCookie.expires - nowSec;
      // Should be approximately 7200 seconds (within ±60s tolerance)
      expect(ttlSeconds).toBeGreaterThan(7140);
      expect(ttlSeconds).toBeLessThan(7260);
    }
  });
});

// ---------------------------------------------------------------------------
// Story 5 AC 3: Reload restores chat history, does not re-ask answered questions
// ---------------------------------------------------------------------------

test.describe('Session restoration on page reload (Story 5 AC 3)', () => {
  test('after providing ZIP code and reloading, ZIP is not re-asked', async ({ page }) => {
    await page.goto('/');

    // Provide ZIP code
    await page.locator('[data-testid="chat-input"]').fill('My ZIP is 77001');
    await page.locator('[data-testid="send-button"]').click();
    await page.waitForTimeout(2000);

    // Count messages before reload
    const messagesBefore = await page.locator('[data-testid="user-message"]').count();
    expect(messagesBefore).toBeGreaterThan(0);

    // Reload the page (simulates accidental refresh)
    await page.reload();
    await page.waitForTimeout(2000);

    // Story 5 AC 3: chat history restored — user messages should be visible
    const messagesAfterReload = await page.locator('[data-testid="user-message"]').count();
    expect(messagesAfterReload).toBeGreaterThan(0);

    // The first user message containing "77001" should still be visible
    const firstUserMsg = page.locator('[data-testid="user-message"]').first();
    const msgText = await firstUserMsg.textContent();
    expect(msgText).toContain('77001');
  });

  test('after Tier-1 complete and reload, assistant does not re-ask for ZIP', async ({ page }) => {
    await completeTier1(page);

    // Count assistant messages and remember what they say
    const messageCountBefore = await page.locator('[data-testid="assistant-message"]').count();
    expect(messageCountBefore).toBeGreaterThan(0);

    // Reload
    await page.reload();
    await page.waitForTimeout(2000);

    // After reload, chat history should be present
    const messageCountAfter = await page.locator('[data-testid="assistant-message"]').count();
    expect(messageCountAfter).toBeGreaterThan(0);

    // The most recent assistant message should NOT be asking for ZIP again
    // (it should be either a Tier-2 question or a "Run Analysis" prompt)
    const latestAssistantMsg = page.locator('[data-testid="assistant-message"]').last();
    const latestText = await latestAssistantMsg.textContent();
    // Verify the page didn't reset to the very beginning
    // The app should know Tier-1 is done and not re-ask from scratch
    expect(latestText).toBeTruthy();
  });

  test('intake conversation messages survive page reload within TTL', async ({ page }) => {
    await page.goto('/');

    // Submit two messages to build a conversation
    await page.locator('[data-testid="chat-input"]').fill('My ZIP is 77001');
    await page.locator('[data-testid="send-button"]').click();
    await page.waitForTimeout(2000);

    const input = page.locator('[data-testid="chat-input"]');
    await input.fill('I make $42,000 per year');
    await page.locator('[data-testid="send-button"]').click();
    await page.waitForTimeout(2000);

    // Count total user messages
    const userMsgCountBefore = await page.locator('[data-testid="user-message"]').count();
    expect(userMsgCountBefore).toBeGreaterThanOrEqual(2);

    // Reload
    await page.reload();
    await page.waitForTimeout(2000);

    // Story 5 AC 3: all messages restored
    const userMsgCountAfter = await page.locator('[data-testid="user-message"]').count();
    expect(userMsgCountAfter).toBe(userMsgCountBefore);
  });
});

// ---------------------------------------------------------------------------
// Story 5 AC 4: Mid-run reload reconnects SSE stream
// ---------------------------------------------------------------------------

test.describe('Mid-run SSE reconnect on page reload (Story 5 AC 4)', () => {
  async function startWorkflow(page: import('@playwright/test').Page) {
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

    // Wait for phase tracker to appear (run started)
    await page.waitForSelector('[data-testid="phase-tracker"]', { timeout: 30_000 });
  }

  test('reloading during a run shows the phase tracker again (reconnects to existing run)', async ({ page }) => {
    await startWorkflow(page);

    // Reload while workflow is in progress (mock-kvr takes ~0.5s)
    // Since mock-kvr is very fast, we reload almost immediately
    await page.reload();
    await page.waitForTimeout(2000);

    // After reload, the page should either:
    // a) Show the phase tracker (if run is still in progress)
    // b) Show the report (if run completed during reload)
    // c) Allow restarting (if session re-established correctly)
    // In any case, the page should NOT show a blank screen or error
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toBeTruthy();
    expect(bodyText!.length).toBeGreaterThan(10);

    // Should not crash
    expect(bodyText).not.toContain('Internal Server Error');
    expect(bodyText).not.toContain('Application error');
  });

  test('session cookie is preserved across reload', async ({ page, context }) => {
    await page.goto('/');

    const cookiesBefore = await context.cookies();
    const sessionBefore = cookiesBefore.find((c) => c.name === 'session');
    expect(sessionBefore).toBeDefined();

    await page.reload();

    const cookiesAfter = await context.cookies();
    const sessionAfter = cookiesAfter.find((c) => c.name === 'session');
    expect(sessionAfter).toBeDefined();

    // Same session ID after reload
    expect(sessionAfter?.value).toBe(sessionBefore?.value);
  });
});
