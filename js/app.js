import * as db from './db.js';
import * as L from './library.js';
import * as P from './player.js';
import { applyIcon, chooseIcon } from './icon.js';

const { lib } = L;
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = s => encodeURIComponent(s);
const ui = { decade: '', query: '' };

// ---------- icons ----------
const I = {
  sync: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/></svg>',
  back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M15 5l-7 7 7 7"/></svg>',
  down: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 9l7 7 7-7"/></svg>',
  play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>',
  playL: '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>',
  pause: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>',
  pauseL: '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>',
  prev: '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="2.4" height="14"/><path d="M19 5v14L8.5 12z"/></svg>',
  next: '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><rect x="16.6" y="5" width="2.4" height="14"/><path d="M5 5v14l10.5-7z"/></svg>',
  shuffle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h3l10 12h3"/><path d="M4 18h3l3-3.6"/><path d="M14 9.6L17 6h3"/><path d="M18 4l2 2-2 2"/><path d="M18 16l2 2-2 2"/></svg>',
  repeat: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 11V9a3 3 0 0 1 3-3h12"/><path d="M16 3l3 3-3 3"/><path d="M20 13v2a3 3 0 0 1-3 3H5"/><path d="M8 21l-3-3 3-3"/></svg>',
  crate: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="8" width="18" height="12"/><path d="M7 8V4h10v4"/><path d="M12 11v6M9 14h6"/></svg>',
  queue: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
};

// ---------- helpers ----------
function artBox(artId, name, color, size = 'small') {
  const bg = color ? `rgb(${color.map(c => Math.round(c * 0.6)).join(',')})` : '#1B1A17';
  return `<div class="art" style="background:${bg}">${artId ? `<img alt="" data-art="${esc(artId)}" data-size="${size}">` : `<div class="ph">${esc((name || '?').slice(0, 14))}</div>`}</div>`;
}
async function hydrateArt(root = document) {
  for (const img of root.querySelectorAll('img[data-art]:not([src])')) {
    img.src = await L.artUrl(img.dataset.art, img.dataset.size || 'small');
  }
}
function toast(msg, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function albumCard(a) {
  return `<a class="rec" href="#/album/${enc(a.key)}">${artBox(a.artId, a.title, a.color)}<span class="t">${esc(a.title)}</span><span class="a">${esc(a.artist)}${a.year ? ' · ' + a.year : ''}</span></a>`;
}
function filteredAlbums() {
  let as = lib.albums;
  if (ui.decade === 'JP') as = as.filter(a => a.tracks.some(t => /[぀-ヿ一-鿿]/.test(t.title + t.artist + t.album)) || a.tracks.some(t => /j-?hip|japan|日本/i.test(t.genre)));
  else if (ui.decade) as = as.filter(a => L.decadeOf(a.year) === ui.decade);
  return as;
}
function trackRows(tracks, { numbering = 'side', showArtist = false } = {}) {
  const cur = P.current();
  let side = 0;
  return tracks.map((t, i) => {
    let num;
    if (numbering === 'side') {
      const half = Math.ceil(tracks.length / 2);
      side = i < half ? 'A' : 'B'; num = side + (i < half ? i + 1 : i - half + 1);
    } else num = String(i + 1).padStart(2, '0');
    const feats = L.featOf(t);
    return `<button class="item${cur && cur.id === t.id ? ' now' : ''}" data-play="${i}">
      <span class="num">${num}</span>
      <span class="main"><b>${esc(L.cleanTitle(t.title))}${feats.length ? ` <span class="feat">feat. ${esc(feats.join(', '))}</span>` : ''}</b>${showArtist ? `<span>${esc(t.artist)} — ${esc(t.album)}</span>` : ''}</span>
      <span class="side">${L.fmtTime(t.duration)}</span></button>`;
  }).join('');
}
function bindTrackList(root, ids) {
  root.querySelectorAll('[data-play]').forEach(b => b.addEventListener('click', () => { P.playList(ids, +b.dataset.play); }));
}
function emptyState() {
  return `<div class="empty"><h2 class="sec">NO RECORDS YET</h2><p class="note">PC で sync.bat を実行したあと、SYNC タブから OneDrive の MusicPlayerSync フォルダを選ぶと曲が入ります。</p><a class="btn primary" href="#/sync">${I.sync}SYNC へ</a></div>`;
}
function nowStr() {
  const d = new Date();
  return `${['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()]} ${d.getDate()} ${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()]} / ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------- views ----------
function viewDig() {
  const decades = ['90s', '00s', '10s', '20s', 'JP'];
  const recent = [...lib.albums].sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0) || (b.addedAt - a.addedAt)).slice(0, 12);
  const albums = filteredAlbums();
  return `<div class="stack">
    <div class="between" style="align-items:flex-end">
      <div><div class="eyebrow">${nowStr()}</div><h1 class="big">DIG<span class="dot">.</span></h1></div>
      <a class="icon-btn ring" href="#/sync" aria-label="PCと同期">${I.sync}</a>
    </div>
    ${lib.tracks.length ? `
    <div class="chips">${decades.map(d => `<button class="chip${ui.decade === d ? ' on' : ''}" data-decade="${d}">${d}</button>`).join('')}</div>
    ${ui.decade ? '' : `<section class="stack" style="gap:12px"><div class="between"><h2 class="sec">RECENTLY DUG</h2><span class="eyebrow">${lib.albums.length} RECORDS</span></div><div class="shelf">${recent.map(albumCard).join('')}</div></section>`}
    ${lib.playlists.length && !ui.decade ? `<section><h2 class="sec" style="margin-bottom:8px">MY CRATES</h2><div class="list">${lib.playlists.slice(0, 4).map((p, i) => crateRow(p, i)).join('')}</div></section>` : ''}
    <section class="stack" style="gap:12px"><div class="between"><h2 class="sec">${ui.decade ? esc(ui.decade) : 'ALL RECORDS'}</h2><span class="eyebrow">${albums.length}</span></div>
      ${albums.length ? `<div class="grid">${albums.map(albumCard).join('')}</div>` : '<p class="note">この条件のアルバムはまだありません。</p>'}</section>
    ` : emptyState()}
  </div>`;
}
function bindDig() {
  $app.querySelectorAll('[data-decade]').forEach(b => b.addEventListener('click', () => { ui.decade = ui.decade === b.dataset.decade ? '' : b.dataset.decade; render(); }));
}
function crateRow(p, i) {
  const n = p.trackIds.filter(id => lib.byId.has(id)).length;
  const dur = p.trackIds.reduce((s, id) => s + (lib.byId.get(id)?.duration || 0), 0);
  return `<a class="item" href="#/crate/${enc(p.id)}"><span class="num">${String(i + 1).padStart(2, '0')}</span><span class="main"><b>${esc(p.name)}</b><span>${n} tracks · ${Math.floor(dur / 3600)}h ${String(Math.round(dur % 3600 / 60)).padStart(2, '0')}m</span></span><span class="side">${p.source === 'pc' ? 'PC' : 'MINE'}</span></a>`;
}

function viewAlbum(key) {
  const a = lib.albumByKey.get(key);
  if (!a) return `<p class="note">アルバムが見つかりません。</p>`;
  return `<div class="stack" style="gap:18px">
    <button class="icon-btn back" data-back aria-label="戻る">${I.back}</button>
    <div class="album-hero"><div class="vinyl"></div>${artBox(a.artId, a.title, a.color, 'large')}</div>
    <div><div class="eyebrow" style="color:var(--accent)">ALBUM${a.year ? ' · ' + a.year : ''} · ${a.tracks.length} TRACKS</div>
      <h1 class="big" style="font-size:40px;line-height:1.05;margin-top:4px">${esc(a.title)}</h1>
      <a href="#/artist/${enc(L.artistKey(a.artist))}" style="font-size:15px;font-weight:700;color:#C9C1B2">${esc(a.artist)}</a></div>
    <div class="row" style="gap:10px"><button class="btn primary" style="flex:1" data-playall>${I.play}PLAY SIDE A</button>
      <button class="btn sq" data-shuffle aria-label="シャッフル">${I.shuffle}</button>
      <button class="btn sq" data-crate aria-label="クレートに入れる">${I.crate}</button></div>
    <div class="list tracks">${trackRows(a.tracks)}</div>
  </div>`;
}
function bindAlbum(key) {
  const a = lib.albumByKey.get(key); if (!a) return;
  const ids = a.tracks.map(t => t.id);
  bindTrackList($app, ids);
  $app.querySelector('[data-playall]').onclick = () => { P.setShuffle(false); P.playList(ids, 0); };
  $app.querySelector('[data-shuffle]').onclick = () => { P.setShuffle(true); P.playList(ids, Math.floor(Math.random() * ids.length)); };
  $app.querySelector('[data-crate]').onclick = () => crateSheet(ids, a.title);
}

function viewArtists() {
  const q = ui.query.toLowerCase();
  const list = lib.artists.filter(a => !q || a.name.toLowerCase().includes(q));
  return `<div class="stack">
    <h1 class="big">ARTISTS<span class="dot">.</span></h1>
    <input class="search" type="search" placeholder="アーティストを検索" value="${esc(ui.query)}" data-q>
    <div class="list">${list.map(a => `<a class="item" href="#/artist/${enc(a.key)}"><span class="main"><b>${esc(a.name)}</b><span>${a.albumKeys.length} albums${a.featIds.length ? ` · 客演 ${a.featIds.length}` : ''}</span></span><span class="side">${a.trackIds.length}</span></a>`).join('') || '<p class="note">見つかりません。</p>'}</div>
  </div>`;
}
function bindArtists() {
  const inp = $app.querySelector('[data-q]');
  inp.addEventListener('input', () => { ui.query = inp.value; const pos = inp.selectionStart; render(); const n = $app.querySelector('[data-q]'); n.focus(); n.setSelectionRange(pos, pos); });
}

function viewArtist(key) {
  const ar = lib.artists.find(a => a.key === key);
  if (!ar) return `<p class="note">見つかりません。</p>`;
  const albums = ar.albumKeys.map(k => lib.albumByKey.get(k)).filter(Boolean).sort((a, b) => (a.year || 0) - (b.year || 0));
  const feats = ar.featIds.map(id => lib.byId.get(id)).filter(Boolean);
  return `<div class="stack">
    <button class="icon-btn back" data-back aria-label="戻る">${I.back}</button>
    <div><div class="eyebrow" style="color:var(--accent)">ARTIST · ${ar.trackIds.length} TRACKS</div><h1 class="big" style="font-size:48px;margin-top:4px">${esc(ar.name)}</h1></div>
    <button class="btn primary block" data-playall>${I.shuffle}SHUFFLE ALL</button>
    ${albums.length ? `<section class="stack" style="gap:12px"><h2 class="sec">DISCOGRAPHY</h2><div class="grid">${albums.map(albumCard).join('')}</div></section>` : ''}
    ${feats.length ? `<section class="stack" style="gap:8px"><h2 class="sec">FEATURED ON</h2><div class="list tracks">${trackRows(feats, { numbering: 'n', showArtist: true })}</div></section>` : ''}
  </div>`;
}
function bindArtist(key) {
  const ar = lib.artists.find(a => a.key === key); if (!ar) return;
  const feats = ar.featIds.filter(id => lib.byId.has(id));
  bindTrackList($app, feats);
  $app.querySelector('[data-playall]').onclick = () => { P.setShuffle(true); P.playList(ar.trackIds, Math.floor(Math.random() * ar.trackIds.length)); };
}

function viewCrates() {
  return `<div class="stack">
    <div class="between" style="align-items:flex-end"><h1 class="big">CRATES<span class="dot">.</span></h1><button class="btn" data-new>＋ NEW</button></div>
    <p class="note">PC で指定したフォルダは自動でクレートになります（PC）。アルバム画面の箱ボタンから自分のクレートに入れられます（MINE）。</p>
    ${lib.playlists.length ? `<div class="list">${lib.playlists.map(crateRow).join('')}</div>` : '<p class="note">まだクレートがありません。</p>'}
  </div>`;
}
function bindCrates() {
  $app.querySelector('[data-new]').onclick = async () => {
    const name = prompt('新しいクレートの名前'); if (!name) return;
    await L.savePlaylist({ id: 'mine:' + Date.now(), name, trackIds: [], source: 'mine', order: lib.playlists.length });
    render();
  };
}

function viewCrate(id) {
  const p = lib.playlists.find(x => x.id === id);
  if (!p) return `<p class="note">見つかりません。</p>`;
  const tracks = p.trackIds.map(i => lib.byId.get(i)).filter(Boolean);
  return `<div class="stack">
    <button class="icon-btn back" data-back aria-label="戻る">${I.back}</button>
    <div><div class="eyebrow" style="color:var(--accent)">CRATE · ${p.source === 'pc' ? 'FROM PC' : 'MINE'} · ${tracks.length} TRACKS</div><h1 class="big" style="font-size:44px;margin-top:4px">${esc(p.name)}</h1></div>
    <div class="row" style="gap:10px"><button class="btn primary" style="flex:1" data-playall>${I.play}PLAY</button><button class="btn sq" data-shuffle aria-label="シャッフル">${I.shuffle}</button>${p.source === 'mine' ? `<button class="btn" data-del>削除</button>` : ''}</div>
    <div class="list tracks">${trackRows(tracks, { numbering: 'n', showArtist: true })}</div>
  </div>`;
}
function bindCrate(id) {
  const p = lib.playlists.find(x => x.id === id); if (!p) return;
  const ids = p.trackIds.filter(i => lib.byId.has(i));
  bindTrackList($app, ids);
  $app.querySelector('[data-playall]').onclick = () => { P.setShuffle(false); P.playList(ids, 0); };
  $app.querySelector('[data-shuffle]').onclick = () => { P.setShuffle(true); P.playList(ids, Math.floor(Math.random() * ids.length)); };
  const d = $app.querySelector('[data-del]');
  if (d) d.onclick = async () => { if (confirm(`「${p.name}」を削除しますか？（曲は消えません）`)) { await L.deletePlaylist(id); location.hash = '#/crates'; } };
}

function crateSheet(ids, title) {
  const mine = lib.playlists.filter(p => p.source === 'mine');
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet"><div class="eyebrow">ADD TO CRATE</div><h2 class="sec">${esc(title)}</h2>
    <div class="list">${mine.map(p => `<button class="item" data-id="${esc(p.id)}"><span class="main"><b>${esc(p.name)}</b></span><span class="side">${p.trackIds.length}</span></button>`).join('')}</div>
    <input class="search" placeholder="新しいクレート名" data-name><button class="btn primary block" data-create>新しいクレートに入れる</button><button class="btn block" data-close>キャンセル</button></div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener('click', e => { if (e.target === bg) close(); });
  bg.querySelector('[data-close]').onclick = close;
  bg.querySelectorAll('[data-id]').forEach(b => b.onclick = async () => {
    const p = lib.playlists.find(x => x.id === b.dataset.id);
    await L.savePlaylist({ ...p, trackIds: [...p.trackIds, ...ids.filter(i => !p.trackIds.includes(i))] });
    close(); toast(`「${p.name}」に入れました`);
  });
  bg.querySelector('[data-create]').onclick = async () => {
    const name = bg.querySelector('[data-name]').value.trim(); if (!name) return;
    await L.savePlaylist({ id: 'mine:' + Date.now(), name, trackIds: [...ids], source: 'mine', order: lib.playlists.length });
    close(); toast(`「${name}」を作りました`);
  };
}

async function viewSync() {
  const last = await db.getSetting('lastSync', 0);
  let est = null, persisted = false;
  try { est = await navigator.storage.estimate(); persisted = await navigator.storage.persisted(); } catch (_) { /* */ }
  const used = lib.tracks.reduce((s, t) => s + (t.size || 0), 0);
  const gb = b => (b / 1e9).toFixed(b > 1e10 ? 0 : 1) + ' GB';
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const iconPreview = await db.getSetting('iconDataUrl', '');
  return `<div class="stack">
    <h1 class="big">SYNC<span class="dot">.</span></h1>
    ${standalone ? '' : `<div class="card"><div class="eyebrow" style="color:var(--accent)">FIRST</div><p class="note" style="color:var(--paper)">Safari の共有ボタン →「ホーム画面に追加」でアプリとして使ってください。ホーム画面版とSafari版は保存場所が別なので、曲の取り込みはホーム画面版で行ってください。</p></div>`}
    <div class="card">
      <div class="between"><span class="eyebrow">PC → PHONE</span><span class="eyebrow">${last ? '前回 ' + new Date(last).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '未同期'}</span></div>
      <div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="stat"><b>${lib.tracks.length}</b><span>保存済みの曲</span></div><div class="stat"><b>${lib.albums.length}</b><span>アルバム</span></div></div>
      <label class="btn primary block">${I.sync}PCと同期<input type="file" webkitdirectory multiple hidden data-sync></label>
      <p class="note">PC で sync.bat を実行してから押してください。ファイル → OneDrive → MusicPlayerSync フォルダを選ぶと、増えた曲だけ取り込みます。</p>
      <label class="btn block">MP3 を直接追加<input type="file" accept="audio/mpeg,audio/mp4,.mp3,.m4a" multiple hidden data-files></label>
    </div>
    <div class="stack" style="gap:10px">
      <span class="eyebrow">STORAGE</span>
      ${est ? `<div class="bar"><i style="width:${Math.min(100, used / est.quota * 100).toFixed(1)}%"></i></div><div class="between" style="font-size:12px"><span>CRATE ${gb(used)}</span><span class="muted">上限 ${gb(est.quota)}</span></div>` : ''}
      <div class="row" style="font-size:12px;gap:8px"><span style="width:8px;height:8px;border-radius:4px;background:${persisted ? 'var(--good)' : 'var(--mute)'}"></span>消えない保存: ${persisted ? 'オン' : 'オフ（ホーム画面版で取り込むとオンになりやすい）'}</div>
    </div>
    <div class="stack" style="gap:10px">
      <span class="eyebrow">APP ICON</span>
      <div class="row" style="gap:16px">
        <img src="${iconPreview || 'icons/icon-180.png'}" alt="" style="width:72px;height:72px;border-radius:16px;object-fit:cover;flex-shrink:0">
        <div class="stack" style="gap:8px;flex:1"><label class="btn block" style="height:40px;font-weight:400;font-family:var(--body);font-size:13px">好きな jpg を選ぶ<input type="file" accept="image/*" hidden data-icon></label>
        ${iconPreview ? '<button class="note" data-icon-reset style="text-align:left;text-decoration:underline">元のアイコンに戻す</button>' : ''}
        <span class="note">変更後は、ホーム画面のアイコンを削除してから Safari で開き直し「ホーム画面に追加」すると反映されます。</span></div>
      </div>
    </div>
    <div class="stack" style="gap:10px"><span class="eyebrow">DANGER</span><button class="btn block" data-wipe style="color:#FF8A6B">すべての曲を削除</button></div>
  </div>`;
}
function showProgress(label) {
  const el = document.createElement('div'); el.className = 'progress';
  el.innerHTML = `<div class="eyebrow">IMPORTING</div><h2 class="sec" data-l>${esc(label)}</h2><div class="bar"><i style="width:0%"></i></div><p class="note" data-n></p><p class="note">画面を閉じずにお待ちください。</p>`;
  document.body.appendChild(el);
  return {
    set(i, n, name) { el.querySelector('i').style.width = (i / n * 100) + '%'; el.querySelector('[data-n]').textContent = `${i} / ${n}  ${name || ''}`; },
    done() { el.remove(); },
  };
}
function bindSync() {
  $app.querySelector('[data-sync]').addEventListener('change', async e => {
    const files = e.target.files; if (!files || !files.length) return;
    let plan;
    try { plan = await L.analyseSyncFolder(files); } catch (err) { toast(err.message, 5000); return; }
    let removeOld = true;
    if (plan.toRemove.length) removeOld = confirm(`PC で外された曲が ${plan.toRemove.length} 曲あります。スマホからも削除しますか？`);
    if (!plan.toAdd.length && !(removeOld && plan.toRemove.length)) { await L.applySync(plan, null, false); toast('新しい曲はありませんでした'); render(); return; }
    const pr = showProgress(`${plan.toAdd.length} 曲を取り込み中`);
    try { await L.applySync(plan, (i, n, name) => pr.set(i, n, name), removeOld); }
    finally { pr.done(); }
    toast(`${plan.toAdd.length} 曲追加${removeOld && plan.toRemove.length ? ` / ${plan.toRemove.length} 曲削除` : ''}${plan.missing ? `（${plan.missing} 曲はフォルダ内に見つかりません）` : ''}`, 4000);
    render();
  });
  $app.querySelector('[data-files]').addEventListener('change', async e => {
    const files = e.target.files; if (!files || !files.length) return;
    const pr = showProgress(`${files.length} 曲を取り込み中`);
    try { await L.importFiles(files, (i, n, name) => pr.set(i, n, name)); } finally { pr.done(); }
    toast('追加しました'); render();
  });
  $app.querySelector('[data-icon]').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    await chooseIcon(f); toast('アイコンを変更しました。ホーム画面に追加し直してください', 4000); render();
  });
  const r = $app.querySelector('[data-icon-reset]');
  if (r) r.onclick = async () => { await db.setSetting('iconDataUrl', ''); await applyIcon(); render(); };
  $app.querySelector('[data-wipe]').onclick = async () => {
    if (!confirm('スマホに保存したすべての曲を削除します。PC 側のファイルは消えません。よろしいですか？')) return;
    for (const t of lib.tracks) await L.removeTrack(t.id);
    for (const p of lib.playlists) await db.del('playlists', p.id);
    await L.loadLibrary(); render();
  };
}

// ---------- router ----------
async function render() {
  const h = location.hash.replace(/^#\/?/, '') || 'dig';
  const [route, ...rest] = h.split('/');
  const arg = decodeURIComponent(rest.join('/'));
  const tab = { dig: 'dig', album: 'dig', artists: 'artists', artist: 'artists', crates: 'crates', crate: 'crates', sync: 'sync' }[route] || 'dig';
  document.querySelectorAll('nav.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  let html;
  switch (route) {
    case 'album': html = viewAlbum(arg); break;
    case 'artists': html = viewArtists(); break;
    case 'artist': html = viewArtist(arg); break;
    case 'crates': html = viewCrates(); break;
    case 'crate': html = viewCrate(arg); break;
    case 'sync': html = await viewSync(); break;
    default: html = viewDig();
  }
  $app.innerHTML = html;
  $app.querySelectorAll('[data-back]').forEach(b => b.onclick = () => history.length > 1 ? history.back() : (location.hash = '#/dig'));
  switch (route) {
    case 'album': bindAlbum(arg); break;
    case 'artists': bindArtists(); break;
    case 'artist': bindArtist(arg); break;
    case 'crates': bindCrates(); break;
    case 'crate': bindCrate(arg); break;
    case 'sync': bindSync(); break;
    default: bindDig();
  }
  hydrateArt($app);
}
let lastRoute = '';
window.addEventListener('hashchange', () => { const r = location.hash; render(); if (r !== lastRoute) window.scrollTo(0, 0); lastRoute = r; });

// ---------- mini player & now playing ----------
const $mini = document.getElementById('mini');
const $np = document.getElementById('np');
function renderMini() {
  const t = P.current();
  if (!t) { $mini.hidden = true; return; }
  $mini.hidden = false;
  $mini.innerHTML = `<button class="row" style="flex:1;min-width:0;gap:12px" data-open><div class="thumb">${artBox(t.artId, t.album, t.color)}</div><span class="meta"><b>${esc(L.cleanTitle(t.title))}</b><span>${esc(t.artist)}</span></span></button>
    <button class="icon-btn" data-toggle aria-label="${P.state.playing ? '一時停止' : '再生'}">${P.state.playing ? I.pause : I.play}</button><div class="prog"></div>`;
  $mini.querySelector('[data-open]').onclick = openNP;
  $mini.querySelector('[data-toggle]').onclick = P.toggle;
  hydrateArt($mini);
  updateTime();
}
function npBg(t) {
  if (!t || !t.color) return '#16222F';
  const [r, g, b] = t.color;
  const k = 0.42; // darken for contrast with light text
  return `rgb(${Math.round(r * k + 8)},${Math.round(g * k + 8)},${Math.round(b * k + 8)})`;
}
function renderNP() {
  const t = P.current();
  if (!t) { $np.classList.remove('open'); return; }
  const s = P.state;
  const nextT = lib.byId.get(s.queue[s.index + 1]);
  $np.style.setProperty('--np-bg', npBg(t));
  $np.classList.toggle('playing', s.playing);
  const feats = L.featOf(t);
  $np.innerHTML = `<div class="top"><button class="icon-btn" data-close aria-label="閉じる" style="margin-left:-10px">${I.down}</button><span class="eyebrow" style="color:rgba(237,230,216,.7)">NOW SPINNING · ${s.index + 1}/${s.queue.length}</span><button class="icon-btn" data-album aria-label="アルバムへ" style="margin-right:-10px">${I.queue}</button></div>
    <div class="stage"><div class="disc"><div class="label">CRATE · 33⅓</div></div>${artBox(t.artId, t.album, t.color, 'large')}</div>
    <h1>${esc(L.cleanTitle(t.title))}</h1>
    <div class="who">${esc(t.albumArtist || L.splitArtists(t.artist)[0] || '')}${feats.length ? ` <span>feat. ${esc(feats.join(', '))}</span>` : ''} <span>— ${esc(t.album)}</span></div>
    <div class="scrub" data-scrub><div class="rail"></div><div class="fill"></div><div class="knob"></div></div>
    <div class="times"><span data-cur>0:00</span><span data-left>-0:00</span></div>
    <div class="controls">
      <button class="icon-btn ctl${s.shuffle ? ' on' : ''}" data-shuf aria-label="シャッフル">${I.shuffle}</button>
      <button class="icon-btn" style="width:56px;height:56px" data-prev aria-label="前の曲">${I.prev}</button>
      <button class="play" data-toggle aria-label="${s.playing ? '一時停止' : '再生'}">${s.playing ? I.pauseL : I.playL}</button>
      <button class="icon-btn" style="width:56px;height:56px" data-next aria-label="次の曲">${I.next}</button>
      <button class="icon-btn ctl${s.repeat !== 'off' ? ' on' : ''}" data-rep aria-label="リピート" style="position:relative">${I.repeat}${s.repeat === 'one' ? '<span style="position:absolute;font:600 9px var(--mono);right:8px;top:8px">1</span>' : ''}</button>
    </div>
    <div class="next"><span class="eyebrow" style="color:rgba(237,230,216,.6)">UP NEXT</span><span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nextT ? esc(L.cleanTitle(nextT.title)) + ' <span style="opacity:.6">' + esc(nextT.artist) + '</span>' : '—'}</span></div>`;
  $np.querySelector('[data-close]').onclick = closeNP;
  $np.querySelector('[data-album]').onclick = () => { closeNP(); location.hash = '#/album/' + enc(L.albumKey(t)); };
  $np.querySelector('[data-toggle]').onclick = P.toggle;
  $np.querySelector('[data-prev]').onclick = P.prev;
  $np.querySelector('[data-next]').onclick = () => P.next();
  $np.querySelector('[data-shuf]').onclick = () => P.setShuffle(!P.state.shuffle);
  $np.querySelector('[data-rep]').onclick = P.cycleRepeat;
  bindScrub($np.querySelector('[data-scrub]'));
  hydrateArt($np);
  updateTime();
}
let scrubbing = false;
function bindScrub(el) {
  const pos = e => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  el.addEventListener('pointerdown', e => { scrubbing = true; el.setPointerCapture(e.pointerId); drawProgress(pos(e)); });
  el.addEventListener('pointermove', e => { if (scrubbing) drawProgress(pos(e)); });
  el.addEventListener('pointerup', e => { scrubbing = false; const a = P.getAudio(); P.seek(pos(e) * (a.duration || 0)); });
}
function drawProgress(f) {
  const a = P.getAudio(); const d = a.duration || 0;
  const fill = $np.querySelector('.fill'), knob = $np.querySelector('.knob');
  if (fill) { fill.style.width = (f * 100) + '%'; knob.style.left = (f * 100) + '%'; }
  const c = $np.querySelector('[data-cur]'), l = $np.querySelector('[data-left]');
  if (c) { c.textContent = L.fmtTime(f * d) === '--:--' ? '0:00' : L.fmtTime(f * d); l.textContent = '-' + L.fmtTime(Math.max(0, d - f * d)); }
}
function updateTime() {
  const a = P.getAudio(); const d = a.duration || 0; const f = d ? a.currentTime / d : 0;
  const p = $mini.querySelector('.prog'); if (p) p.style.width = (f * 100) + '%';
  if (!scrubbing && $np.classList.contains('open')) drawProgress(f);
}
function openNP() { renderNP(); $np.classList.add('open'); }
function closeNP() { $np.classList.remove('open'); }
let lastId = null;
P.onChange((s, kind) => {
  if (kind === 'time') { updateTime(); return; }
  renderMini();
  if ($np.classList.contains('open')) renderNP();
  const cur = P.current();
  if (cur && cur.id !== lastId) {
    lastId = cur.id;
    $app.querySelectorAll('.tracks .item.now').forEach(x => x.classList.remove('now'));
  }
});
// swipe down to close now playing
let y0 = null;
$np.addEventListener('touchstart', e => { if (!e.target.closest('[data-scrub]')) y0 = e.touches[0].clientY; }, { passive: true });
$np.addEventListener('touchend', e => { if (y0 !== null && e.changedTouches[0].clientY - y0 > 90) closeNP(); y0 = null; }, { passive: true });

// ---------- boot ----------
(async function boot() {
  await applyIcon();
  await L.loadLibrary();
  await render();
  await P.restore();
  renderMini();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e));
})();
