/**
 * Keystroke-dynamics biometrics demo: consent, enrollment status, profile summary,
 * evaluation (FAR / FRR / EER / ROC) on genuine vs impostor runs, one-click delete.
 */
import { enrollProfile, distance, evaluateVerifier, syntheticImpostors, MIN_ENROLL_RUNS, FEATURE_NAMES } from '../../../core/dynamics.js';
import { rocChart, barChart } from '../../../client/charts.js';
import { db } from '../../../client/db.js';
import { html, raw, fmt, toast } from '../dom.js';

export async function mount(el, app) {
  const { store } = app;
  const s = store.get();
  const all = ((await db.all('bio')) || []).sort((a, b) => a.createdAt - b.createdAt);
  const genuine = all.filter((b) => b.label === 'genuine');
  const impostors = all.filter((b) => b.label === 'impostor');
  const doc = await db.get('kv', 'bioProfile');
  const profile = doc && doc.profile;

  let evalHtml = '<p class="empty">Enroll at least five runs to evaluate the verifier.</p>';
  if (profile && genuine.length >= MIN_ENROLL_RUNS) {
    const real = impostors.map((b) => distance(profile, b.vector, profile.method));
    const synth =
      s.bioSynthetic !== false
        ? syntheticImpostors(
            genuine.map((g) => g.vector),
            7,
            20,
          ).map((v) => distance(profile, v, profile.method))
        : [];
    const imp = [...real, ...synth].filter(Number.isFinite);
    const ev = evaluateVerifier(profile.genuine, imp);
    const at = ev.roc.find((p) => p.threshold >= profile.threshold) || ev.roc[ev.roc.length - 1];
    evalHtml = imp.length
      ? html`<div class="stat-strip">
            <div>
              <span class="label">EER</span>
              <div class="metric accent">${fmt.n(ev.eer, 1)}<small>%</small></div>
            </div>
            <div>
              <span class="label">FAR @ threshold</span>
              <div class="metric">${fmt.n(at.far * 100, 1)}<small>%</small></div>
            </div>
            <div>
              <span class="label">FRR @ threshold</span>
              <div class="metric">${fmt.n(at.frr * 100, 1)}<small>%</small></div>
            </div>
            <div>
              <span class="label">AUC</span>
              <div class="metric">${fmt.n(ev.auc, 3)}</div>
            </div>
          </div>
          <div class="cards">
            <div class="card">${raw(rocChart(ev))}</div>
            <div class="card">
              <h3>Samples</h3>
              <div class="rail-row"><span>Genuine (leave-one-out)</span><span>${profile.genuine.length}</span></div>
              <div class="rail-row"><span>Real impostor sessions</span><span>${real.length}</span></div>
              <div class="rail-row"><span>Synthetic impostors</span><span>${synth.length}</span></div>
              <div class="rail-row"><span>Threshold</span><span>${profile.threshold}</span></div>
              <p class="hint-line">
                Synthetic impostors rescale your own timings (documented baseline). Real impostor sessions are far more meaningful: hand the keyboard to someone else and record a run.
              </p>
            </div>
          </div>`
      : '<p class="empty">No impostor samples. Enable synthetic impostors or record an impostor session.</p>';
  }

  const dwellIdx = FEATURE_NAMES.map((n, i) => [n, i]).filter(([n]) => n.startsWith('dwell:') && n.length === 7);
  const profileChart = profile
    ? barChart({
        title: 'Mean dwell per key',
        items: dwellIdx.filter(([, i]) => Number.isFinite(profile.mu[i])).map(([n, i]) => ({ label: n.slice(6), value: Math.round(profile.mu[i]) })),
        unit: 'ms',
      })
    : '';

  el.innerHTML = html` <div class="page-head">
      <div>
        <h2 id="bio-title">Keystroke biometrics</h2>
        <p>A research demo of continuous authentication from typing rhythm: dwell time (how long a key is held) and flight time (gap between keys).</p>
      </div>
    </div>
    <div class="notice">
      <strong>Privacy notice.</strong> Off by default. When enabled, each finished run adds one statistical feature vector (average dwell and flight times for common keys and letter pairs) to this
      browser's storage. No text, no raw keystroke log and nothing identifying is stored for biometrics, and nothing is uploaded. You can delete it all with one click below. Typing rhythm is biometric
      data: read BIOMETRICS.md for limits and ethics before relying on any of this.
    </div>
    <div class="cards">
      <div class="card">
        <h3>Consent</h3>
        <label class="toggle"><input type="checkbox" id="bio-consent" ${s.biometrics ? 'checked' : ''} /> <span>I consent to storing typing-rhythm statistics locally for this demo</span></label>
        <label class="toggle"><input type="checkbox" id="bio-synth" ${s.bioSynthetic !== false ? 'checked' : ''} /> <span>Use synthetic impostors in the evaluation</span></label>
        <label class="toggle"
          ><input type="checkbox" id="bio-impostor" ${s.bioNextLabel === 'impostor' ? 'checked' : ''} /> <span>Label my next run as an <b>impostor</b> session (someone else typing)</span></label
        >
        <button class="btn ghost" type="button" id="bio-delete">Delete all biometric data</button>
      </div>
      <div class="card">
        <h3>Enrollment</h3>
        <div class="metric">${Math.min(genuine.length, MIN_ENROLL_RUNS)}<small>/ ${MIN_ENROLL_RUNS} runs</small></div>
        <p class="hint-line">
          ${profile ? `Profile enrolled from ${profile.n} runs (${profile.method} distance). The identity meter appears on the test screen while you type.` : `Finish ${Math.max(0, MIN_ENROLL_RUNS - genuine.length)} more run(s) with consent on to enroll.`}
        </p>
        <div class="field">
          <label for="bio-method">Distance</label
          ><select id="bio-method">
            <option value="manhattan" ${!profile || profile.method === 'manhattan' ? ' selected' : ''}>scaled Manhattan</option>
            <option value="mahalanobis" ${profile && profile.method === 'mahalanobis' ? ' selected' : ''}>diagonal Mahalanobis</option>
          </select>
        </div>
      </div>
      <div class="card">${raw(profileChart || '<p class="empty">Profile appears after enrollment.</p>')}</div>
    </div>
    <h3 class="section">Evaluation</h3>
    ${raw(evalHtml)}`;

  el.onchange = async (e) => {
    if (e.target.id === 'bio-consent') store.set({ biometrics: e.target.checked });
    if (e.target.id === 'bio-synth') store.set({ bioSynthetic: e.target.checked });
    if (e.target.id === 'bio-impostor') store.set({ bioNextLabel: e.target.checked ? 'impostor' : 'genuine' });
    if (e.target.id === 'bio-method' && genuine.length >= MIN_ENROLL_RUNS) {
      await db.put(
        'kv',
        {
          profile: enrollProfile(
            genuine.map((g) => g.vector),
            e.target.value,
          ),
          updatedAt: Date.now(),
        },
        'bioProfile',
      );
    }
    mount(el, app);
  };
  el.onclick = async (e) => {
    if (e.target.id !== 'bio-delete') return;
    await db.clear('bio');
    await db.delete('kv', 'bioProfile');
    store.set({ biometrics: false, bioNextLabel: 'genuine' });
    toast('All biometric data deleted.');
    mount(el, app);
  };
}
