/**
 * Duel (1v1): shared room code -> same seeded text for both players, live opponent caret
 * and progress over a realtime broadcast channel (Supabase Realtime in production).
 */
import { html, raw, toast, $ } from '../dom.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const me = { id: Math.random().toString(36).slice(2, 10) };
let duel = null;

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

function leave() {
  if (!duel) return;
  clearInterval(duel.helloTimer);
  duel.channel.send('bye', { id: me.id });
  duel.channel.leave();
  duel = null;
}

function renderRail(snap) {
  const block = $('#rail-duel');
  if (!duel || !block) return;
  const myPct = snap && snap.text.length ? (snap.caret / snap.text.length) * 100 : 0;
  const op = duel.opponent || {};
  const opPct = op.len ? (op.caret / op.len) * 100 : 0;
  let status = op.id ? 'racing' : 'waiting for opponent';
  if (duel.result) status = duel.result;
  block.innerHTML = html`<span class="label">Duel · room ${duel.code}</span>
    <div class="opponent">
      <div class="rail-row"><span>You</span><span>${duel.myWpm ?? 0} wpm</span></div>
      <div class="bar me"><i></i></div>
    </div>
    <div class="opponent">
      <div class="rail-row"><span>${op.handle || 'Opponent'}</span><span>${op.wpm ?? 0} wpm</span></div>
      <div class="bar"><i></i></div>
    </div>
    <div class="hint-line">${status}</div>`;
  const [mine, theirs] = block.querySelectorAll('.bar i');
  mine.style.width = `${Math.min(100, myPct).toFixed(1)}%`;
  theirs.style.width = `${Math.min(100, opPct).toFixed(1)}%`;
}

function startRace(app) {
  const blockUntil = performance.now() + 3000;
  duel.result = null;
  duel.done = false;
  let lastSend = 0;
  const race = {
    kind: 'duel',
    blockUntil,
    caretAt: () => (duel && duel.opponent ? duel.opponent.caret : null),
    render(snap, live) {
      if (!duel) return;
      duel.myWpm = Math.round(live.netWpm);
      const now = performance.now();
      if (now - lastSend > 120) {
        lastSend = now;
        duel.channel.send('progress', { id: me.id, caret: snap.caret, len: snap.text.length, wpm: duel.myWpm });
      }
      renderRail(snap);
    },
    onFinish(result) {
      if (!duel) return;
      duel.done = true;
      duel.channel.send('done', { id: me.id, netWpm: result.netWpm, accuracy: result.finalAccuracy, caret: result.typed.length, len: result.text.length });
      duel.result =
        duel.opponent && duel.opponent.done
          ? `${duel.opponent.handle || 'Opponent'} finished first (${duel.opponent.netWpm} wpm). You: ${result.netWpm} wpm.`
          : `You finished first: ${result.netWpm} wpm at ${result.finalAccuracy}%.`;
      renderRail(app.controller.engine.getSnapshot());
      toast(duel.result, 6000);
    },
  };
  app.navigate('#/');
  app.controller.start({ modeId: 'duel', options: { room: duel.code }, race }).then(() => renderRail(app.controller.engine.getSnapshot()));
  const meta = $('#typing-meta-left');
  const tick = () => {
    const left = Math.ceil((blockUntil - performance.now()) / 1000);
    if (left > 0) {
      meta.textContent = `Duel ${duel ? duel.code : ''} · starting in ${left}...`;
      setTimeout(tick, 200);
    } else meta.textContent = `Duel ${duel ? duel.code : ''} · GO`;
  };
  setTimeout(tick, 50);
}

function join(app, code, host) {
  leave();
  const channel = app.api.channel(`duel-${code}`);
  duel = { code, host, channel, opponent: null, myWpm: 0, result: null };
  const handle = app.store.get().handle || `typist-${me.id.slice(0, 4)}`;
  const hello = () => channel.send('hello', { id: me.id, handle });
  channel.on('hello', (p) => {
    if (!duel || p.id === me.id) return;
    const first = !duel.opponent;
    duel.opponent = { ...(duel.opponent || {}), id: p.id, handle: p.handle, caret: 0, len: 0, wpm: 0 };
    if (first) {
      hello();
      toast(`${p.handle} joined room ${code}`);
    }
    refresh(app);
  });
  channel.on('start', (p) => {
    if (!duel || p.id === me.id) return;
    startRace(app);
  });
  channel.on('progress', (p) => {
    if (!duel || p.id === me.id) return;
    duel.opponent = { ...(duel.opponent || {}), caret: p.caret, len: p.len, wpm: p.wpm };
    renderRail(app.controller.engine.getSnapshot());
    app.controller.syncRace();
  });
  channel.on('done', (p) => {
    if (!duel || p.id === me.id) return;
    duel.opponent = { ...(duel.opponent || {}), done: true, netWpm: p.netWpm, caret: p.caret, len: p.len };
    if (!duel.done) duel.result = `${duel.opponent.handle || 'Opponent'} finished first at ${p.netWpm} wpm.`;
    renderRail(app.controller.engine.getSnapshot());
  });
  channel.on('bye', (p) => {
    if (!duel || p.id === me.id) return;
    duel.opponent = null;
    toast('Opponent left the room.');
    refresh(app);
  });
  hello();
  duel.helloTimer = setInterval(() => {
    if (duel && !duel.opponent) hello();
  }, 1500);
  refresh(app);
}

let mounted = null;
function refresh(app) {
  if (mounted && mounted.isConnected) render(mounted, app);
}

function render(el, app) {
  const transport = duel ? duel.channel.transport : app.api.online ? (app.api.mode === 'supabase' ? 'Supabase Realtime' : 'dev relay') : 'same-browser tabs (offline)';
  el.innerHTML = html` <div class="page-head">
      <div>
        <h2 id="duel-title">Duel</h2>
        <p>Race one opponent on the same text. Share the room code; both players see each other's caret live. Transport: ${transport}.</p>
      </div>
    </div>
    ${raw(
      duel
        ? html`<div class="cards">
            <div class="card">
              <span class="label">Room code</span>
              <div class="room-code" id="room-code">${duel.code}</div>
              <p class="hint-line">${duel.opponent ? `Opponent: ${duel.opponent.handle}` : 'Waiting for an opponent to join...'}</p>
              <div class="btn-row">
                ${raw(duel.host ? html`<button class="btn primary" type="button" id="duel-start" ${duel.opponent ? '' : ' disabled'}>Start race</button>` : '<span class="hint-line">The host starts the race.</span>')}<button
                  class="btn ghost"
                  type="button"
                  id="duel-leave"
                >
                  Leave
                </button>
              </div>
            </div>
          </div>`
        : html`<div class="cards">
            <div class="card">
              <h3>Host</h3>
              <p class="hint-line">Create a room and send the code to your opponent.</p>
              <button class="btn primary" type="button" id="duel-create">Create room</button>
            </div>
            <div class="card">
              <h3>Join</h3>
              <div class="field"><label for="duel-code">Room code</label><input id="duel-code" maxlength="6" autocapitalize="characters" autocomplete="off" /></div>
              <button class="btn" type="button" id="duel-join">Join room</button>
            </div>
          </div>`,
    )}`;
}

export function mount(el, app) {
  mounted = el;
  render(el, app);
  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'duel-create') join(app, newCode(), true);
    else if (b.id === 'duel-join') {
      const code = el.querySelector('#duel-code').value.trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) {
        toast('Room codes are 6 characters.');
        return;
      }
      join(app, code, false);
    } else if (b.id === 'duel-start' && duel) {
      duel.channel.send('start', { id: me.id });
      startRace(app);
    } else if (b.id === 'duel-leave') {
      leave();
      render(el, app);
    }
  };
}
