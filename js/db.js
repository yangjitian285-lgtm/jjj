// IndexedDB wrapper
const DB_NAME = 'crate';
const DB_VER = 1;
let dbp;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('tracks', { keyPath: 'id' });
      db.createObjectStore('blobs');
      db.createObjectStore('art', { keyPath: 'id' });
      db.createObjectStore('playlists', { keyPath: 'id' });
      db.createObjectStore('settings');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

async function store(name, mode = 'readonly') {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}

export async function get(name, key) { return wrap((await store(name)).get(key)); }
export async function getAll(name) { return wrap((await store(name)).getAll()); }
export async function getAllKeys(name) { return wrap((await store(name)).getAllKeys()); }
export async function put(name, value, key) {
  const s = await store(name, 'readwrite');
  return wrap(key === undefined ? s.put(value) : s.put(value, key));
}
export async function del(name, key) { return wrap((await store(name, 'readwrite')).delete(key)); }

export async function getSetting(key, fallback) {
  const v = await get('settings', key);
  return v === undefined ? fallback : v;
}
export function setSetting(key, value) { return put('settings', value, key); }
