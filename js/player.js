// Playback engine: ONE <audio> element (no Web Audio) for reliable iOS background playback
import * as db from './db.js';
import { lib, artUrl, markPlayed, cleanTitle, splitArtists } from './library.js';

const audio = new Audio();
audio.preload = 'auto';
audio.setAttribute('playsinline', '');

const listeners = new Set();
export const state = { queue: [], index: -1, playing: false, shuffle: false, repeat: 'off', order: [] };
let currentUrl = null;
let saveTimer = 0;

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => fn(state)); }

export function current() { return lib.byId.get(state.queue[state.index]); }
export function getAudio() { return audio; }

async function load(index, autoplay = true, startAt = 0) {
  const id = state.queue[index];
  const t = lib.byId.get(id);
  if (!t) return;
  state.index = index;
  const blob = await db.get('blobs', id);
  if (!blob) return;
  const old = currentUrl;
  currentUrl = URL.createObjectURL(blob);
  audio.src = currentUrl;
  if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
  if (startAt) {
    const seek = () => { audio.currentTime = startAt; audio.removeEventListener('loadedmetadata', seek); };
    audio.addEventListener('loadedmetadata', seek);
  }
  updateMediaSession(t);
  if (autoplay) {
    try { await audio.play(); } catch (e) { console.warn('play blocked', e); }
    markPlayed(id);
  }
  emit();
  persist();
}

export async function playList(ids, startIndex = 0) {
  state.queue = [...ids];
  if (state.shuffle) { shuffleQueue(startIndex); await load(0); }
  else await load(startIndex);
}

function shuffleQueue(keepIndex) {
  const first = state.queue[keepIndex];
  const rest = state.queue.filter((_, i) => i !== keepIndex);
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  state.queue = first !== undefined ? [first, ...rest] : rest;
}

export function toggle() {
  if (!audio.src) { if (state.queue.length) load(Math.max(0, state.index)); return; }
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}

export async function next(auto = false) {
  if (!state.queue.length) return;
  if (auto && state.repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
  let i = state.index + 1;
  if (i >= state.queue.length) {
    if (state.repeat === 'all' || !auto) i = 0;
    else { emit(); return; }
  }
  await load(i);
}

export async function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const i = state.index > 0 ? state.index - 1 : (state.repeat === 'all' ? state.queue.length - 1 : 0);
  await load(i);
}

export function seek(sec) { if (isFinite(sec)) audio.currentTime = Math.max(0, Math.min(sec, audio.duration || sec)); }

export function setShuffle(on) {
  state.shuffle = on;
  if (on && state.queue.length) { shuffleQueue(state.index); state.index = 0; }
  emit(); persist();
}

export function cycleRepeat() {
  state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
  emit(); persist();
}

export function playNext(ids) {
  state.queue.splice(state.index + 1, 0, ...ids);
  if (state.index < 0) load(0); else emit();
  persist();
}

async function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  const artwork = [];
  if (t.artId) {
    const s = await artUrl(t.artId, 'small');
    const l = await artUrl(t.artId, 'large');
    if (s) artwork.push({ src: s, sizes: '96x96', type: 'image/jpeg' });
    if (l) artwork.push({ src: l, sizes: '512x512', type: 'image/jpeg' });
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: cleanTitle(t.title),
    artist: t.artist || splitArtists(t.albumArtist)[0] || '',
    album: t.album || '',
    artwork,
  });
}

function updatePosition() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!isFinite(audio.duration) || !audio.duration) return;
  try { navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, audio.duration) }); } catch (_) { /* ignore */ }
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch (_) { /* unsupported */ } };
  set('play', () => audio.play());
  set('pause', () => audio.pause());
  set('previoustrack', () => prev());
  set('nexttrack', () => next());
  set('seekto', d => { if (d.fastSeek && audio.fastSeek) audio.fastSeek(d.seekTime); else seek(d.seekTime); updatePosition(); });
}

audio.addEventListener('play', () => { state.playing = true; if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; emit(); });
audio.addEventListener('pause', () => { state.playing = false; if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; emit(); persist(); });
audio.addEventListener('ended', () => next(true));
audio.addEventListener('loadedmetadata', updatePosition);
audio.addEventListener('timeupdate', () => {
  listeners.forEach(fn => fn(state, 'time'));
  if (Math.floor(audio.currentTime) % 5 === 0) updatePosition();
  clearTimeout(saveTimer); saveTimer = setTimeout(persist, 2000);
});

function persist() {
  db.setSetting('playerState', { queue: state.queue, index: state.index, time: audio.currentTime || 0, shuffle: state.shuffle, repeat: state.repeat });
}

export async function restore() {
  const s = await db.getSetting('playerState', null);
  if (!s || !s.queue || !s.queue.length) return;
  state.queue = s.queue.filter(id => lib.byId.has(id));
  state.shuffle = !!s.shuffle; state.repeat = s.repeat || 'off';
  const idx = Math.min(Math.max(0, s.index), state.queue.length - 1);
  if (state.queue.length) await load(idx, false, s.time || 0);
}
