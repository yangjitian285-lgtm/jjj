// App icon: iOS uses <link rel="apple-touch-icon"> at the moment you "Add to Home Screen".
import * as db from './db.js';

export async function applyIcon() {
  const url = await db.getSetting('iconDataUrl', '');
  const link = document.querySelector('link[rel="apple-touch-icon"]');
  link.href = url || 'icons/icon-180.png';
}

export async function chooseIcon(file) {
  const bmp = await createImageBitmap(file);
  const size = 180;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = Math.min(bmp.width, bmp.height);
  g.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  const url = c.toDataURL('image/png');
  await db.setSetting('iconDataUrl', url);
  await applyIcon();
}
