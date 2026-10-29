/** Learning hub: structured lessons, finger coach, goals, streak / XP / badges, AI coach. */
import { LESSONS } from '../../../core/lessons.js';
import { LAYOUT_NAMES } from '../../../core/layouts.js';
import { BADGES, emptyStats, levelFromXp, goalProgress } from '../../../core/gamification.js';
import { buildCoachPayload, offlinePlan } from '../../../core/coach.js';
import { progressRing } from '../../../client/charts.js';
import { db, listRuns } from '../../../client/db.js';
import { html, raw, fmt, toast } from '../dom.js';

export async function mount(el, app) {
  const { store, api } = app;
  const s = store.get();
  const stats = (await db.get('kv', 'stats')) || emptyStats();
  const lessonsDone = (await db.get('kv', 'lessons')) || {};
  const runs = await listRuns();
  const lv = levelFromXp(stats.xp);
  const goal = goalProgress(
    s.goal,
    runs.map((r) => r.result),
  );
  const analyses = runs.map((r) => r.analysis).filter((a) => a && a.metrics);
  const payload = buildCoachPayload(analyses);

  el.innerHTML = html` <div class="page-head">
      <div>
        <h2 id="learn-title">Learn</h2>
        <p>Home row to symbols with pass criteria, a finger coach, goals, and a practice plan built from your weakest transitions.</p>
      </div>
    </div>
    <div class="stat-strip">
      <div>
        <span class="label">Level</span>
        <div class="metric accent">${lv.level}</div>
        <span class="hint-line">${stats.xp} XP · ${Math.round(lv.progress * 100)}% to ${lv.level + 1}</span>
      </div>
      <div>
        <span class="label">Streak</span>
        <div class="metric">${stats.streak.current}<small>days</small></div>
        <span class="hint-line">best ${stats.streak.best}</span>
      </div>
      <div>
        <span class="label">Runs</span>
        <div class="metric">${stats.runs}</div>
        <span class="hint-line">${stats.cleanRuns} clean</span>
      </div>
      <div>
        <span class="label">Badges</span>
        <div class="metric">${stats.badges.length}<small>/ ${BADGES.length}</small></div>
      </div>
    </div>
    <div class="cards">
      <div class="card wide">
        <h3>Lessons</h3>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Lesson</th>
                <th>Pass at</th>
                <th>Best</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${raw(
                LESSONS.map((l) => {
                  const best = lessonsDone[l.id];
                  return html`<tr>
                    <td>
                      <b>${l.title}</b>
                      <div class="hint-line">${l.blurb}</div>
                    </td>
                    <td>${l.pass.minWpm} WPM · ${l.pass.minAccuracy}%</td>
                    <td>${best ? `passed · ${fmt.n(best)} WPM` : '--'}</td>
                    <td><button class="btn" type="button" data-lesson="${l.id}">Start</button></td>
                  </tr>`;
                }).join(''),
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h3>Touch-typing coach</h3>
        <label class="toggle"><input type="checkbox" id="coach-fingers" ${s.coachFingers ? 'checked' : ''} /> <span>Highlight the next key and the finger that should press it</span></label>
        <div class="field">
          <label for="layout">Keyboard layout</label
          ><select id="layout">
            ${raw(LAYOUT_NAMES.map((n) => html`<option value="${n}" ${n === s.layout ? ' selected' : ''}>${n}</option>`).join(''))}
          </select>
        </div>
        <p class="hint-line">Layout drives the finger map, heatmap and lesson key sets.</p>
      </div>
      <div class="card">
        <h3>Milestone goal</h3>
        <div class="btn-row">
          ${raw(progressRing(goal.wpmPct, { label: `Speed ${goal.wpmPct}% of goal` }))}${raw(progressRing(goal.accPct, { alt: true, label: `Accuracy ${goal.accPct}% of goal` }))}
        </div>
        <p>${s.goal.wpm} WPM at ${s.goal.accuracy}% accuracy ${goal.met ? '· reached' : ''}</p>
        <div class="btn-row">
          <label class="sr-only" for="goal-wpm">Goal WPM</label><input id="goal-wpm" type="number" min="10" max="250" value="${s.goal.wpm}" /><label class="sr-only" for="goal-acc">Goal accuracy</label
          ><input id="goal-acc" type="number" min="80" max="100" value="${s.goal.accuracy}" /><button class="btn" type="button" id="goal-save">Set goal</button>
        </div>
      </div>
      <div class="card wide">
        <h3>Badges</h3>
        <div class="badges">${raw(BADGES.map((b) => html`<div class="badge ${stats.badges.includes(b.id) ? '' : 'locked'}"><b>${b.label}</b><span>${b.description}</span></div>`).join(''))}</div>
      </div>
      <div class="card wide">
        <h3>AI coach</h3>
        <p class="notice">
          <strong>What is sent:</strong> only the aggregated statistics below (averages, slowest letter pairs, weakest keys). Never raw keystrokes, text, timings or identity. Off by default; without
          consent, or offline, a built-in plan is generated locally.
        </p>
        <label class="toggle"
          ><input type="checkbox" id="ai-optin" ${s.aiCoach ? 'checked' : ''} /> <span>Send these aggregated stats to the coach endpoint (Claude) for a personalised plan</span></label
        >
        <details>
          <summary class="hint-line">Exact payload</summary>
          <pre class="hint-line" id="payload">${JSON.stringify(payload, null, 2)}</pre>
        </details>
        <div class="btn-row">
          <button class="btn primary" type="button" id="plan" ${payload.runs ? '' : ' disabled'}>Build my practice plan</button
          ><button class="btn ghost" type="button" id="weak">Weak-key drill</button>
        </div>
        <div id="plan-out"></div>
      </div>
    </div>`;

  el.onchange = (e) => {
    if (e.target.id === 'coach-fingers') store.set({ coachFingers: e.target.checked });
    if (e.target.id === 'layout') store.set({ layout: e.target.value });
    if (e.target.id === 'ai-optin') store.set({ aiCoach: e.target.checked });
  };
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.lesson) {
      const all = { ...(store.get().modeOptions || {}), lesson: { lessonId: b.dataset.lesson } };
      store.set({ modeId: 'lesson', modeOptions: all });
      app.modebar.render();
      app.navigate('#/');
      app.controller.start();
    } else if (b.id === 'goal-save') {
      const wpm = Math.max(10, Math.min(250, Number(el.querySelector('#goal-wpm').value) || 80));
      const accuracy = Math.max(80, Math.min(100, Number(el.querySelector('#goal-acc').value) || 97));
      store.set({ goal: { wpm, accuracy } });
      mount(el, app);
    } else if (b.id === 'weak') {
      store.set({ modeId: 'weakkey' });
      app.modebar.render();
      app.navigate('#/');
      app.controller.start();
    } else if (b.id === 'plan') {
      const out = el.querySelector('#plan-out');
      out.innerHTML = '<p class="hint-line">Building plan...</p>';
      let plan;
      if (store.get().aiCoach && api.online) {
        try {
          plan = await api.coach(payload);
        } catch (err) {
          toast(`Coach unavailable (${err.message}); using the offline plan.`);
          plan = offlinePlan(payload);
        }
      } else plan = offlinePlan(payload);
      out.innerHTML = html`<p class="diagnosis">${plan.summary}</p>
        <p class="hint-line">Source: ${plan.source === 'claude' ? 'Claude (aggregated stats only)' : 'offline rules'}</p>
        <div class="cards">
          ${raw(
            plan.drills
              .map(
                (d, i) =>
                  html`<div class="card">
                    <h3>${d.title}</h3>
                    <p class="hint-line">${d.minutes} min/day</p>
                    <p>${d.text}</p>
                    <button class="btn" type="button" data-drill="${i}">Practise this</button>
                  </div>`,
              )
              .join(''),
          )}
        </div>
        ${raw(
          plan.tips.length
            ? html`<ul>
                ${raw(plan.tips.map((t) => html`<li>${t}</li>`).join(''))}
              </ul>`
            : '',
        )}`;
      out.onclick = (ev) => {
        const db2 = ev.target.closest('[data-drill]');
        if (!db2) return;
        const text = plan.drills[Number(db2.dataset.drill)].text;
        const all = { ...(store.get().modeOptions || {}), custom: { text } };
        store.set({ modeId: 'custom', modeOptions: all });
        app.modebar.render();
        app.navigate('#/');
        app.controller.start();
      };
    }
  };
}
