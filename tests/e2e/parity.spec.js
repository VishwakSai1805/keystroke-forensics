import { test, expect } from '@playwright/test';
import { replayRun } from '../../core/replay.js';

/**
 * Cross-front-end parity: a run typed in the browser (vanilla or React) is read back from
 * IndexedDB and replayed in Node through /core. The metrics must be byte-identical, which
 * proves both front-ends and the server-side verifier compute the same numbers.
 */
async function humanType(page, text) {
  for (const ch of text) {
    const key = ch === ' ' ? 'Space' : ch;
    await page.keyboard.down(key);
    await page.waitForTimeout(25 + Math.random() * 50);
    await page.keyboard.up(key);
    await page.waitForTimeout(20 + Math.random() * 60);
  }
}

const latestRun = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('keystroke-forensics');
        req.onsuccess = () => {
          const all = req.result.transaction('runs', 'readonly').objectStore('runs').getAll();
          all.onsuccess = () => resolve(all.result.sort((a, b) => b.createdAt - a.createdAt)[0]);
        };
      }),
  );

for (const [name, url] of [
  ['vanilla', 'http://localhost:8090/vanilla/'],
  ['react', 'http://localhost:5174/react/'],
]) {
  test(`${name}: browser metrics equal a Node replay of the same keystroke log`, async ({ page }) => {
    await page.goto(url);
    await page.selectOption('#mode-select', 'words');
    await expect(page.locator('#hud-state')).toHaveText('ARMED');
    const text = await page.locator('#tf-text .chars, #tf-text > span:first-child').first().textContent();
    await page.locator('#typing-input').focus();
    const typo = text.slice(0, 5) + 'x';
    await humanType(page, typo);
    await page.keyboard.press('Backspace');
    await humanType(page, text.slice(5));
    await expect(page.locator('#hud-state')).toHaveText('COMPLETE');
    await expect(page.locator('#report-link')).toBeVisible({ timeout: 10_000 });
    const run = await latestRun(page);
    expect(run.entries.length).toBeGreaterThan(text.length);
    const replayed = replayRun({ modeId: run.modeId, options: run.options, policy: run.policy, seed: run.seed, text: run.customText, entries: run.entries }).getSnapshot().result;
    expect(replayed).toEqual(run.result);
    expect(run.result.backspaces).toBe(1);
  });
}
