/**
 * IndexedDB persistence (offline-first local history). Stores:
 *   runs  - completed runs: result, analysis summary and (optionally) the keystroke log
 *   bio   - biometric feature vectors (statistics only, opt-in)
 *   kv    - small documents: player stats, biometric profile
 * Falls back to an in-memory store when IndexedDB is unavailable.
 */
const DB_NAME = 'keystroke-forensics';
const VERSION = 1;

let dbPromise = null;
const memory = { runs: new Map(), bio: new Map(), kv: new Map() };
let useMemory = false;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const runs = db.createObjectStore('runs', { keyPath: 'id' });
        runs.createIndex('createdAt', 'createdAt');
        runs.createIndex('boardKey', 'boardKey');
        db.createObjectStore('bio', { keyPath: 'id' });
        db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        useMemory = true;
        resolve(null);
      };
    } catch {
      useMemory = true;
      resolve(null);
    }
  });
  return dbPromise;
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function tx(store, mode, fn) {
  const db = await open();
  if (!db || useMemory) return fn(null, memory[store]);
  const t = db.transaction(store, mode);
  return fn(t.objectStore(store), null);
}

export const db = {
  async put(store, value, key) {
    return tx(store, 'readwrite', (os, mem) => {
      if (mem) {
        mem.set(key ?? value.id, value);
        return value;
      }
      return wrap(key === undefined ? os.put(value) : os.put(value, key));
    });
  },
  async get(store, key) {
    return tx(store, 'readonly', (os, mem) => (mem ? mem.get(key) : wrap(os.get(key))));
  },
  async all(store) {
    return tx(store, 'readonly', (os, mem) => (mem ? [...mem.values()] : wrap(os.getAll())));
  },
  async delete(store, key) {
    return tx(store, 'readwrite', (os, mem) => (mem ? mem.delete(key) : wrap(os.delete(key))));
  },
  async clear(store) {
    return tx(store, 'readwrite', (os, mem) => (mem ? mem.clear() : wrap(os.clear())));
  },
};

/** All runs, newest first. */
export async function listRuns() {
  const runs = (await db.all('runs')) || [];
  return runs.sort((a, b) => b.createdAt - a.createdAt);
}

/** Personal best run (highest score) on a board that still has a log (for ghosts). */
export async function personalBest(boardKey) {
  const runs = (await listRuns()).filter((r) => r.boardKey === boardKey && r.entries && !r.result.failed);
  return runs.sort((a, b) => b.result.score - a.result.score)[0] || null;
}
