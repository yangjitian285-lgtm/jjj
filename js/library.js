// Library: import, grouping, artist normalisation
import * as db from './db.js';
import { readTags } from './id3.js';

const SPLIT_RE = /\s*(?:\bfeat\.?|\bft\.?|\bfeaturing\b|、|,|&|\/|;|\bx\b|×)\s*/i;

export function artistKey(name) {
  return (name || '').toLowerCase().normalize('NFKC').replace(/[\s.\-_'’!]/g, '');
}

// "A feat. B & C" -> ["A","B","C"]; also pulls "(feat. X)" from titles
export function splitArtists(artist, title) {
  const out = [];
  (artist || '').split(SPLIT_RE).forEach(a => { a = a.trim(); if (a) out.push(a); });
  const m = (title || '').match(/[\(\[](?:feat\.?|ft\.?|featuring)\s+([^\)\]]+)[\)\]]/i);
  if (m) m[1].split(SPLIT_RE).forEach(a => { a = a.trim(); if (a) out.push(a); });
  const seen = new Set();
  return out.filter(a => { const k = artistKey(a); if (seen.has(k)) return false; seen.add(k); return true; });
}

export function cleanTitle(title) {
  return (title || '').replace(/\s*[\(\[](?:feat\.?|ft\.?|featuring)\s+[^\)\]]+[\)\]]/i, '').trim();
}

export function featOf(track) {
  const all = splitArtists(track.artist, track.title);
  const primary = artistKey(track.albumArtist || all[0] || '');
  return all.filter(a => artistKey(a) !== primary);
}

export function albumKey(t) {
  return artistKey(t.albumArtist || splitArtists(t.artist)[0] || '') + '\u0001' + (t.album || '').toLowerCase().normalize('NFKC');
}

export function decadeOf(year) { return year ? `${String(year).slice(2, 3)}0s` : ''; }

export function fmtTime(s) {
  if (!s || !isFinite(s)) return '--:--';
  s = Math.round(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- in-memory model ----------
export const lib = { tracks: [], byId: new Map(), albums: [], albumByKey: new Map(), artists: [], playlists: [] };

export async function loadLibrary() {
  const tracks = await db.getAll('tracks');
  const playlists = await db.getAll('playlists');
  buildModel(tracks, playlists);
}

function buildModel(tracks, playlists) {
  lib.tracks = tracks;
  lib.byId = new Map(tracks.map(t => [t.id, t]));
  const albums = new Map();
  for (const t of tracks) {
    const k = albumKey(t);
    let a = albums.get(k);
    if (!a) {
      a = { key: k, title: t.album || '(アルバム不明)', artist: t.albumArtist || splitArtists(t.artist)[0] || '(アーティスト不明)', year: t.year, artId: t.artId, color: t.color, tracks: [], addedAt: t.addedAt, lastPlayedAt: 0 };
      albums.set(k, a);
    }
    a.tracks.push(t);
    if (!a.artId && t.artId) { a.artId = t.artId; a.color = t.color; }
    if (!a.year && t.year) a.year = t.year;
    a.addedAt = Math.max(a.addedAt || 0, t.addedAt || 0);
    a.lastPlayedAt = Math.max(a.lastPlayedAt, t.lastPlayedAt || 0);
  }
  for (const a of albums.values()) a.tracks.sort((x, y) => (x.discNo - y.discNo) || (x.trackNo - y.trackNo) || x.title.localeCompare(y.title));
  lib.albums = [...albums.values()].sort((x, y) => x.artist.localeCompare(y.artist, 'ja') || (x.year - y.year));
  lib.albumByKey = albums;

  // artists (incl. featured)
  const artists = new Map();
  const add = (name, t, role) => {
    const k = artistKey(name); if (!k) return;
    let a = artists.get(k);
    if (!a) { a = { key: k, names: new Map(), tracks: new Set(), albums: new Set(), feats: new Set() }; artists.set(k, a); }
    a.names.set(name, (a.names.get(name) || 0) + 1);
    a.tracks.add(t.id);
    if (role === 'main') a.albums.add(albumKey(t)); else a.feats.add(t.id);
  };
  for (const t of tracks) {
    const all = splitArtists(t.artist, t.title);
    const main = t.albumArtist || all[0];
    if (main) add(main, t, 'main');
    for (const f of featOf(t)) add(f, t, 'feat');
  }
  lib.artists = [...artists.values()].map(a => ({
    key: a.key,
    name: [...a.names.entries()].sort((x, y) => y[1] - x[1])[0][0],
    trackIds: [...a.tracks], albumKeys: [...a.albums], featIds: [...a.feats],
  })).sort((x, y) => x.name.localeCompare(y.name, 'ja'));
  lib.playlists = playlists.sort((x, y) => (x.order || 0) - (y.order || 0));
}

// ---------- artwork ----------
async function resizeImage(blob, size) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = Math.min(bmp.width, bmp.height);
  g.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  let color = null;
  if (size <= 96) {
    const d = g.getImageData(0, 0, size, size).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    color = [r / n, gg / n, b / n].map(Math.round);
  }
  const out = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.86));
  bmp.close && bmp.close();
  return { blob: out, color };
}

async function hashBlob(blob) {
  const buf = await blob.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function storeArt(picture) {
  if (!picture) return {};
  try {
    const id = await hashBlob(picture);
    const existing = await db.get('art', id);
    if (existing) return { artId: id, color: existing.color };
    const small = await resizeImage(picture, 96);
    const large = await resizeImage(picture, 512);
    await db.put('art', { id, small: small.blob, large: large.blob, color: small.color });
    return { artId: id, color: small.color };
  } catch (e) { console.warn('art failed', e); return {}; }
}

function readDuration(blob) {
  return new Promise(resolve => {
    const a = new Audio();
    const url = URL.createObjectURL(blob);
    const done = v => { URL.revokeObjectURL(url); a.src = ''; resolve(v); };
    const timer = setTimeout(() => done(0), 4000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => { clearTimeout(timer); done(isFinite(a.duration) ? a.duration : 0); };
    a.onerror = () => { clearTimeout(timer); done(0); };
    a.src = url;
  });
}

const artCache = new Map();
export async function artUrl(artId, size = 'small') {
  if (!artId) return '';
  const k = artId + size;
  if (artCache.has(k)) return artCache.get(k);
  const a = await db.get('art', artId);
  if (!a) return '';
  const url = URL.createObjectURL(a[size]);
  artCache.set(k, url);
  return url;
}

async function importOne(file, id, meta = {}) {
  const tags = await readTags(file);
  // copy into memory so it does not depend on the picked file staying available
  const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'audio/mpeg' });
  const art = await storeArt(tags.picture);
  const duration = await readDuration(blob);
  const baseName = (meta.name || file.name || '').replace(/\.[^.]+$/, '');
  const track = {
    id,
    title: tags.title || baseName,
    artist: tags.artist || '',
    albumArtist: tags.albumArtist || '',
    album: tags.album || meta.folder || '',
    trackNo: tags.trackNo, discNo: tags.discNo, year: tags.year, genre: tags.genre,
    duration, artId: art.artId || null, color: art.color || null,
    size: blob.size, addedAt: Date.now(), playCount: 0, lastPlayedAt: 0,
    source: meta.source || 'local',
  };
  await db.put('blobs', blob, id);
  await db.put('tracks', track);
  return track;
}

export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (_) { /* ignore */ }
  return false;
}

// Analyse a picked MusicPlayerSync folder (FileList from webkitdirectory)
export async function analyseSyncFolder(fileList) {
  const files = [...fileList];
  const libFile = files.find(f => /(^|\/)library\.json$/i.test(f.webkitRelativePath || f.name));
  if (!libFile) throw new Error('library.json が見つかりません。OneDrive の MusicPlayerSync フォルダを選んでください。');
  const json = JSON.parse(await libFile.text());
  const byName = new Map(files.map(f => [(f.webkitRelativePath || f.name).split('/').pop(), f]));
  const haveIds = new Set(await db.getAllKeys('tracks'));
  const remoteIds = new Set(json.tracks.map(t => t.id));
  const toAdd = json.tracks.filter(t => !haveIds.has(t.id)).map(t => ({ meta: t, file: byName.get(t.file.split('/').pop()) }));
  const missing = toAdd.filter(x => !x.file).length;
  const toRemove = lib.tracks.filter(t => t.source === 'pc' && !remoteIds.has(t.id));
  return { json, toAdd: toAdd.filter(x => x.file), missing, toRemove };
}

export async function applySync(plan, onProgress, removeOld = true) {
  let i = 0;
  for (const { meta, file } of plan.toAdd) {
    onProgress && onProgress(++i, plan.toAdd.length, meta.name);
    try { await importOne(file, meta.id, { name: meta.name, folder: meta.folder, source: 'pc' }); }
    catch (e) { console.warn('import failed', meta.name, e); }
  }
  if (removeOld) for (const t of plan.toRemove) await removeTrack(t.id);
  // PC playlists = one per source folder
  for (const old of (await db.getAll('playlists')).filter(p => p.source === 'pc')) await db.del('playlists', old.id);
  const pls = plan.json.playlists || [];
  for (let idx = 0; idx < pls.length; idx++) {
    const p = pls[idx];
    await db.put('playlists', { id: 'pc:' + p.name, name: p.name, trackIds: p.ids, source: 'pc', order: idx });
  }
  await db.setSetting('lastSync', Date.now());
  await requestPersist();
  await loadLibrary();
}

// Direct import of individual files
export async function importFiles(fileList, onProgress) {
  const files = [...fileList].filter(f => /\.(mp3|m4a|aac)$/i.test(f.name));
  let i = 0;
  for (const f of files) {
    onProgress && onProgress(++i, files.length, f.name);
    const id = await hashBlob(f);
    if (await db.get('tracks', id)) continue;
    await importOne(f, id, { source: 'local' });
  }
  await requestPersist();
  await loadLibrary();
  return files.length;
}

export async function removeTrack(id) {
  await db.del('tracks', id);
  await db.del('blobs', id);
}

export async function savePlaylist(p) { await db.put('playlists', p); await loadLibrary(); }
export async function deletePlaylist(id) { await db.del('playlists', id); await loadLibrary(); }

export async function markPlayed(id) {
  const t = lib.byId.get(id); if (!t) return;
  t.playCount = (t.playCount || 0) + 1; t.lastPlayedAt = Date.now();
  await db.put('tracks', t);
  const a = lib.albumByKey.get(albumKey(t)); if (a) a.lastPlayedAt = t.lastPlayedAt;
}
