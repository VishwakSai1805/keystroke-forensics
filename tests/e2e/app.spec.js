import { test, expect } from '@playwright/test';

/** Human-like typing: jittered intervals and dwell, real trusted key events. */
async function humanType(page, text, { mean = 110 } = {}) {
  for (const ch of text) {
    const key = ch === ' ' ? 'Space' : ch === '\n' ? 'Enter' : ch;
    await page.keyboard.down(key);
    await page.waitForTimeout(30 + Math.random() * 60);
    await page.keyboard.up(key);
    await page.waitForTimeout(mean * (0.4 + Math.random() * 1.2));
  }
}

const targetText = (page) => page.locator('#tf-text').evaluate((el) => el.firstChild.textContent);

async function chooseMode(page, modeId) {
  await page.selectOption('#mode-select', modeId);
  await expect(page.locator('#hud-state')).toHaveText('ARMED');
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#hud-state')).toHaveText('ARMED');
});

test('full sentence run produces results and a report', async ({ page }) => {
  await chooseMode(page, 'sentence');
  const text = await targetText(page);
  await page.locator('#typing-input').focus();
  await humanType(page, text, { mean: 40 });
  await expect(page.locator('#hud-state')).toHaveText('COMPLETE');
  await expect(page.locator('#results-live')).toContainText('Run complete');
  await page.locator('#report-link').click();
  await expect(page.locator('#report-title')).toBeVisible();
  await expect(page.locator('.diagnosis')).toBeVisible();
  await expect(page.locator('.stat-strip .metric.accent').first()).not.toHaveText('0');
});

test('timed run completes at the deadline', async ({ page }) => {
  await page
    .locator('[data-opt]')
    .first()
    .isVisible()
    .catch(() => false);
  await chooseMode(page, 'timed');
  await page.locator('[data-opt="duration"][data-val="15"]').click();
  await expect(page.locator('#hud-timer-label')).toHaveText('Remaining');
  const text = await targetText(page);
  await page.locator('#typing-input').focus();
  await humanType(page, text.slice(0, 25), { mean: 60 });
  await expect(page.locator('#hud-state')).toHaveText('RUNNING');
  await expect(page.locator('#hud-state')).toHaveText('COMPLETE', { timeout: 20_000 });
});

test('escape resets the run', async ({ page }) => {
  await chooseMode(page, 'words');
  const text = await targetText(page);
  await page.locator('#typing-input').focus();
  await humanType(page, text.slice(0, 6), { mean: 40 });
  await expect(page.locator('#hud-state')).toHaveText('RUNNING');
  await page.keyboard.press('Escape');
  await expect(page.locator('#hud-state')).toHaveText('ARMED');
  await expect(page.locator('#tf-text .c.ok')).toHaveCount(0);
});

test('paste is blocked and recorded', async ({ page }) => {
  await chooseMode(page, 'sentence');
  await page.locator('#typing-input').focus();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'cheating');
    document.getElementById('typing-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#toast')).toContainText('Paste is disabled');
  await expect(page.locator('#tf-text .c.ok')).toHaveCount(0);
});

test('ranked run is verified by the server and appears on the leaderboard', async ({ page }) => {
  await chooseMode(page, 'words');
  await page.locator('[data-opt="count"][data-val="10"]').click();
  await expect(page.locator('#typing-meta-right')).toContainText('RANKED');
  const text = await targetText(page);
  await page.locator('#typing-input').focus();
  await humanType(page, text, { mean: 120 });
  await expect(page.locator('#hud-state')).toHaveText('COMPLETE');
  await page.locator('#report-link').click();
  await expect(page.locator('#verify-state')).toHaveText(/server-verified/, { timeout: 15_000 });
  await page.goto('./#/boards');
  await page.selectOption('#board-select', 'words:10');
  await expect(page.locator('tr.me')).toHaveCount(1, { timeout: 10_000 });
});

test('duel: two browser contexts race on the same text', async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await pa.goto('./#/duel');
  await pb.goto('./#/duel');
  await pa.locator('#duel-create').click();
  const code = (await pa.locator('#room-code').textContent()).trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  await pb.locator('#duel-code').fill(code);
  await pb.locator('#duel-join').click();
  await expect(pa.locator('#duel-start')).toBeEnabled({ timeout: 10_000 });
  await pa.locator('#duel-start').click();
  await expect(pa.locator('#hud-state')).toHaveText('ARMED');
  await expect(pb.locator('#hud-state')).toHaveText('ARMED', { timeout: 10_000 });
  const ta = await targetText(pa);
  const tb = await targetText(pb);
  expect(ta).toBe(tb);
  await pa.waitForTimeout(3200);
  await pa.locator('#typing-input').focus();
  await humanType(pa, ta.slice(0, 20), { mean: 40 });
  await expect(pb.locator('#rail-duel')).not.toBeHidden();
  await expect.poll(async () => pb.locator('#rail-duel .bar:not(.me) i').evaluate((el) => parseFloat(el.style.width) || 0), { timeout: 10_000 }).toBeGreaterThan(0);
  await a.close();
  await b.close();
});

test('a quick option click right after a mode change is not ignored', async ({ page }) => {
  await chooseMode(page, 'sentence');
  // Change mode and pick an option in the same instant, before the first request finishes.
  await page.evaluate(() => {
    const s = document.getElementById('mode-select');
    s.value = 'words';
    s.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-opt="count"][data-val="10"]').click();
  });
  await expect.poll(() => page.evaluate(() => document.querySelector('#tf-text > span').textContent.trim().split(/\s+/).length), { timeout: 10_000 }).toBe(10);
  await expect(page.locator('[data-opt="count"][aria-pressed="true"]')).toHaveText('10');
});
