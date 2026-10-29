/** Settings: themes (with unlocks), accessibility, layout, sound, policy, privacy and data controls. */
import { THEMES, unlockedThemes, levelFromXp, emptyStats } from '../../../core/gamification.js';
import { LAYOUT_NAMES } from '../../../core/layouts.js';
import { SOUND_PACKS, feedback } from '../../../client/sound.js';
import { db, listRuns } from '../../../client/db.js';
import { toCsv } from './history.js';
import { html, raw, toast, download } from '../dom.js';

const select = (id, label, value, options) =>
  html`<div class="field">
    <label for="${id}">${label}</label
    ><select id="${id}">
      ${raw(options.map(([v, l, disabled]) => html`<option value="${v}" ${v === value ? ' selected' : ''}${disabled ? ' disabled' : ''}>${l}</option>`).join(''))}
    </select>
  </div>`;
const toggle = (id, label, checked) => html`<label class="toggle"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} /> <span>${label}</span></label>`;

export async function mount(el, app) {
  const { store, api } = app;
  const s = store.get();
  const stats = (await db.get('kv', 'stats')) || emptyStats();
  const level = levelFromXp(stats.xp).level;
  const unlocked = unlockedThemes(level);
  const embedCode = `<iframe src="${location.origin}${location.pathname.replace(/index\.html$/, '')}embed.html" title="Keystroke Forensics" width="360" height="220" loading="lazy" style="border:0"></iframe>`;

  el.innerHTML = html` <div class="page-head">
      <div>
        <h2 id="settings-title">Settings</h2>
        <p>Saved in this browser only.</p>
      </div>
    </div>
    <div class="cards">
      <div class="card">
        <h3>Appearance</h3>
        ${raw(select('theme', 'Theme', s.theme, [['auto', 'Follow system'], ...THEMES.map((t) => [t.id, unlocked.includes(t.id) ? t.label : `${t.label} (unlocks at level ${t.unlockLevel})`, !unlocked.includes(t.id)])]))}
        ${raw(
          select('contrast', 'Contrast', s.contrast, [
            ['normal', 'Normal'],
            ['high', 'High contrast'],
          ]),
        )}
        ${raw(
          select('font', 'Typing font', s.font, [
            ['mono', 'IBM Plex Mono'],
            ['dyslexic', 'OpenDyslexic (dyslexia-friendly)'],
          ]),
        )}
        ${raw(
          select('size', 'Text size', s.size, [
            ['s', 'Small'],
            ['m', 'Medium'],
            ['l', 'Large'],
            ['xl', 'Extra large'],
          ]),
        )}
        ${raw(
          select('motion', 'Motion', s.motion, [
            ['system', 'Follow system'],
            ['reduce', 'Reduce motion'],
            ['full', 'Full motion'],
          ]),
        )}
      </div>
      <div class="card">
        <h3>Typing</h3>
        ${raw(
          select(
            'layout',
            'Keyboard layout',
            s.layout,
            LAYOUT_NAMES.map((n) => [n, n]),
          ),
        )}
        ${raw(
          select('policy', 'Backspace policy', s.policy, [
            ['free', 'Free: errors may stay'],
            ['strict', 'Strict: fix errors to advance'],
          ]),
        )}
        ${raw(
          select(
            'sound',
            'Sound pack',
            s.sound,
            SOUND_PACKS.map((p) => [p, p]),
          ),
        )}
        ${raw(toggle('haptics', 'Vibrate on errors (supported phones)', s.haptics))} ${raw(toggle('showKeyboard', 'Show on-screen keyboard heatmap', s.showKeyboard))}
        ${raw(toggle('coachFingers', 'Finger coach (highlight next key)', s.coachFingers))} ${raw(toggle('ranked', 'Request ranked (server-verified) runs when online', s.ranked))}
      </div>
      <div class="card">
        <h3>Privacy &amp; data</h3>
        <p class="hint-line">No analytics, no trackers, no third-party requests. Fonts are self-hosted. Ranked runs send only the keystroke log of that run to the leaderboard server.</p>
        ${raw(toggle('keepLogs', 'Keep keystroke logs locally (needed for replay and ghost races)', s.keepLogs))}
        <div class="btn-row">
          <button class="btn" type="button" id="exp-csv">Export CSV</button>
          <button class="btn" type="button" id="exp-json">Export JSON</button>
        </div>
        <div class="btn-row spaced">
          <button class="btn ghost" type="button" id="del-local">Delete local history</button>
          <button class="btn ghost" type="button" id="del-bio">Delete biometric data</button>
          ${raw(api.online ? '<button class="btn ghost" type="button" id="del-server">Delete my server data</button>' : '')}
          <button class="btn ghost" type="button" id="reset">Reset settings</button>
        </div>
      </div>
      <div class="card">
        <h3>Embed on your portfolio</h3>
        <p class="hint-line">A self-contained widget showing your personal bests. Paste this into any page:</p>
        <pre class="hint-line" id="embed-code">${embedCode}</pre>
        <p class="hint-line">Or use the web component: <code>&lt;script type="module" src=".../src/widget.js"&gt;&lt;/script&gt;&lt;keystroke-widget&gt;&lt;/keystroke-widget&gt;</code></p>
        <button class="btn" type="button" id="copy-embed">Copy snippet</button>
      </div>
    </div>`;

  el.onchange = (e) => {
    const t = e.target;
    if (!t.id) return;
    const value = t.type === 'checkbox' ? t.checked : t.value;
    store.set({ [t.id]: value });
    if (t.id === 'sound' && value !== 'silent') feedback(value, 'key');
  };
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'exp-csv') download('keystroke-forensics-history.csv', toCsv(await listRuns()), 'text/csv');
    if (b.id === 'exp-json') download('keystroke-forensics-history.json', JSON.stringify(await listRuns(), null, 2), 'application/json');
    if (b.id === 'del-local' && confirm('Delete all runs, stats and lesson progress stored in this browser?')) {
      await Promise.all([db.clear('runs'), db.delete('kv', 'stats'), db.delete('kv', 'lessons')]);
      toast('Local history deleted.');
    }
    if (b.id === 'del-bio') {
      await db.clear('bio');
      await db.delete('kv', 'bioProfile');
      store.set({ biometrics: false });
      toast('Biometric data deleted.');
    }
    if (b.id === 'del-server' && confirm('Delete your runs, handle and cohort memberships from the leaderboard server?')) {
      try {
        await api.deleteMyData();
        api.signOut();
        toast('Server data deleted.');
      } catch (err) {
        toast(err.message);
      }
    }
    if (b.id === 'reset') {
      store.reset();
      mount(el, app);
    }
    if (b.id === 'copy-embed') {
      try {
        await navigator.clipboard.writeText(embedCode);
        toast('Snippet copied.');
      } catch {
        toast('Copy failed; select the snippet manually.');
      }
    }
  };
}
