/**
 * Realtime broadcast channels with three transports, chosen automatically:
 *   1. Supabase Realtime (Phoenix websocket protocol) when a Supabase project is configured
 *   2. Local dev relay (Server-Sent Events + POST) when served by tools/serve.mjs
 *   3. BroadcastChannel (same browser, other tabs) as an offline fallback
 * Zero dependencies so the vanilla build keeps its no-runtime-deps guarantee.
 * @module client/realtime
 */

/**
 * @typedef {Object} Channel
 * @property {(event:string, fn:(payload:Object)=>void)=>void} on
 * @property {(event:string, payload:Object)=>void} send
 * @property {()=>void} leave
 * @property {string} transport
 */

function supabaseSocket(url, anonKey, getToken) {
  const wsUrl = `${url.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`;
  let ws = null;
  let ref = 0;
  let heartbeat = null;
  const topics = new Map();
  const queue = [];
  const sendRaw = (msg) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    else queue.push(msg);
  };
  const connect = () => {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      for (const t of topics.values()) t.join();
      while (queue.length) ws.send(JSON.stringify(queue.shift()));
      heartbeat = setInterval(() => sendRaw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }), 25000);
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      const t = topics.get(msg.topic);
      if (t && msg.event === 'broadcast' && msg.payload) t.emit(msg.payload.event, msg.payload.payload);
    };
    ws.onclose = () => {
      clearInterval(heartbeat);
      if (topics.size) setTimeout(connect, 1500);
    };
  };
  return {
    channel(name) {
      const topic = `realtime:${name}`;
      const handlers = new Map();
      let joinRef = null;
      const t = {
        join() {
          joinRef = String(++ref);
          sendRaw({
            topic,
            event: 'phx_join',
            payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, private: false }, access_token: getToken() || anonKey },
            ref: joinRef,
            join_ref: joinRef,
          });
        },
        emit(event, payload) {
          for (const fn of handlers.get(event) || []) fn(payload || {});
        },
      };
      topics.set(topic, t);
      if (!ws) connect();
      else if (ws.readyState === 1) t.join();
      return {
        transport: 'supabase',
        on(event, fn) {
          if (!handlers.has(event)) handlers.set(event, new Set());
          handlers.get(event).add(fn);
        },
        send(event, payload) {
          sendRaw({ topic, event: 'broadcast', payload: { type: 'broadcast', event, payload }, ref: String(++ref), join_ref: joinRef });
        },
        leave() {
          sendRaw({ topic, event: 'phx_leave', payload: {}, ref: String(++ref), join_ref: joinRef });
          topics.delete(topic);
          if (!topics.size && ws) ws.close();
        },
      };
    },
  };
}

function relayChannel(name) {
  const handlers = new Map();
  const id = Math.random().toString(36).slice(2);
  const es = new EventSource(`/api/relay/${encodeURIComponent(name)}?client=${id}`);
  es.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.from === id) return;
    for (const fn of handlers.get(msg.event) || []) fn(msg.payload || {});
  };
  return {
    transport: 'relay',
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
    },
    send(event, payload) {
      fetch(`/api/relay/${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: id, event, payload }) }).catch(() => {});
    },
    leave: () => es.close(),
  };
}

function localChannel(name) {
  const bc = new BroadcastChannel(`kf:${name}`);
  const handlers = new Map();
  bc.onmessage = (e) => {
    for (const fn of handlers.get(e.data.event) || []) fn(e.data.payload || {});
  };
  return {
    transport: 'tabs',
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
    },
    send: (event, payload) => bc.postMessage({ event, payload }),
    leave: () => bc.close(),
  };
}

/**
 * Create a realtime hub bound to the detected backend.
 * @param {{mode:'supabase'|'local'|'offline', supabaseUrl?:string, supabaseAnonKey?:string, getToken?:()=>string|null}} o
 */
export function createRealtime(o) {
  let sb = null;
  return {
    /** @returns {Channel} */
    channel(name) {
      if (o.mode === 'supabase') {
        sb ||= supabaseSocket(o.supabaseUrl, o.supabaseAnonKey, o.getToken || (() => null));
        return sb.channel(name);
      }
      if (o.mode === 'local' && typeof EventSource !== 'undefined') return relayChannel(name);
      return localChannel(name);
    },
  };
}
