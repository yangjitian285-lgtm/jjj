// Minimal ID3v2.2/2.3/2.4 + ID3v1 reader (title, artist, album, art, etc.)
const FRAMES = {
  TIT2: 'title', TT2: 'title',
  TPE1: 'artist', TP1: 'artist',
  TPE2: 'albumArtist', TP2: 'albumArtist',
  TALB: 'album', TAL: 'album',
  TRCK: 'track', TRK: 'track',
  TPOS: 'disc', TPA: 'disc',
  TYER: 'year', TYE: 'year', TDRC: 'year', TDOR: 'origYear',
  TCON: 'genre', TCO: 'genre',
};

function decodeLatin1OrSjis(bytes) {
  let high = false;
  for (const b of bytes) if (b >= 0x80) { high = true; break; }
  if (high) {
    try { return new TextDecoder('shift_jis', { fatal: true }).decode(bytes); } catch (_) { /* fall through */ }
  }
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

function decodeText(enc, bytes) {
  let s;
  if (enc === 0) s = decodeLatin1OrSjis(bytes);
  else if (enc === 1) s = new TextDecoder('utf-16').decode(bytes);
  else if (enc === 2) s = new TextDecoder('utf-16be').decode(bytes);
  else s = new TextDecoder('utf-8').decode(bytes);
  return s.replace(/\u0000+$/g, '').replace(/\u0000/g, ' / ').trim();
}

function syncsafe(b, o) { return (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3]; }

function findTerminator(bytes, start, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < bytes.length; i += 2) if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
  } else {
    for (let i = start; i < bytes.length; i++) if (bytes[i] === 0) return i;
  }
  return bytes.length;
}

function removeUnsync(b) {
  const out = [];
  for (let i = 0; i < b.length; i++) {
    out.push(b[i]);
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return Uint8Array.from(out);
}

function parsePicture(ver, data) {
  const enc = data[0];
  let p = 1, mime;
  if (ver === 2) { mime = 'image/' + String.fromCharCode(data[1], data[2], data[3]).toLowerCase().replace('jpg', 'jpeg'); p = 4; }
  else { const e = findTerminator(data, 1, 0); mime = decodeLatin1OrSjis(data.subarray(1, e)) || 'image/jpeg'; p = e + 1; }
  const picType = data[p]; p += 1;
  const dEnd = findTerminator(data, p, enc);
  p = dEnd + ((enc === 1 || enc === 2) ? 2 : 1);
  if (!mime.includes('/')) mime = 'image/' + mime.toLowerCase();
  return { mime, type: picType, bytes: data.slice(p) };
}

export async function readTags(file) {
  const tags = {};
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    const ver = head[3];
    const flags = head[5];
    const size = syncsafe(head, 6);
    let b = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
    if (flags & 0x80 && ver < 4) b = removeUnsync(b);
    let p = 0;
    if (flags & 0x40 && ver >= 3) {
      const ext = ver === 4 ? syncsafe(b, 0) : ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) + 4;
      p += ext;
    }
    const idLen = ver === 2 ? 3 : 4;
    const hdrLen = ver === 2 ? 6 : 10;
    let pictures = [];
    while (p + hdrLen <= b.length) {
      const id = String.fromCharCode(...b.subarray(p, p + idLen));
      if (!/^[A-Z0-9]+$/.test(id)) break;
      let fsize;
      if (ver === 2) fsize = (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5];
      else if (ver === 4) fsize = syncsafe(b, p + 4);
      else fsize = ((b[p + 4] << 24) | (b[p + 5] << 16) | (b[p + 6] << 8) | b[p + 7]) >>> 0;
      const fflags = ver === 2 ? 0 : b[p + 9];
      p += hdrLen;
      if (fsize <= 0 || p + fsize > b.length) break;
      let data = b.subarray(p, p + fsize);
      p += fsize;
      if (ver === 4) {
        if (fflags & 0x01) data = data.subarray(4); // data length indicator
        if (fflags & 0x02) data = removeUnsync(data);
        if (fflags & 0x0c) continue; // compressed / encrypted: skip
      }
      if (FRAMES[id]) {
        const key = FRAMES[id];
        if (!tags[key]) tags[key] = decodeText(data[0], data.subarray(1));
      } else if (id === 'APIC' || id === 'PIC') {
        pictures.push(parsePicture(ver, data));
      }
    }
    if (pictures.length) {
      const front = pictures.find(x => x.type === 3) || pictures[0];
      tags.picture = new Blob([front.bytes], { type: front.mime });
    }
  }
  if (!tags.title || !tags.artist) {
    try {
      const t = new Uint8Array(await file.slice(file.size - 128).arrayBuffer());
      if (t[0] === 0x54 && t[1] === 0x41 && t[2] === 0x47) {
        const f = (a, z) => decodeLatin1OrSjis(t.subarray(a, z)).replace(/\u0000.*$/, '').trim();
        tags.title ||= f(3, 33); tags.artist ||= f(33, 63); tags.album ||= f(63, 93); tags.year ||= f(93, 97);
        if (t[125] === 0 && t[126]) tags.track ||= String(t[126]);
      }
    } catch (_) { /* ignore */ }
  }
  // normalise
  const num = v => { const n = parseInt(String(v || '').split('/')[0], 10); return Number.isFinite(n) ? n : 0; };
  return {
    title: tags.title || '',
    artist: tags.artist || '',
    albumArtist: tags.albumArtist || '',
    album: tags.album || '',
    trackNo: num(tags.track),
    discNo: num(tags.disc) || 1,
    year: num((tags.year || tags.origYear || '').slice(0, 4)),
    genre: (tags.genre || '').replace(/^\((\d+)\)$/, ''),
    picture: tags.picture || null,
  };
}
