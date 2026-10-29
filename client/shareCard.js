/**
 * Canvas-generated shareable result card (1200x630) with a QR link, plus Web Share API
 * delivery with a download fallback.
 * @module client/shareCard
 */
import { drawQr } from './qr.js';

const css = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

/**
 * Render a result card.
 * @param {{netWpm:number, finalAccuracy:number, consistency:number, burstWpm:number, boardKey:string, verified?:boolean}} r Result.
 * @param {string} url Link encoded in the QR code.
 * @returns {Promise<Blob>}
 */
export async function renderShareCard(r, url) {
  await document.fonts?.ready;
  const W = 1200;
  const H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const bg = css('--bg', '#0e0d0b');
  const text = css('--text', '#ede6da');
  const dim = css('--text-dim', '#a59a8c');
  const accent = css('--accent', '#ffb000');
  const correct = css('--correct', '#5fb3a8');
  const line = css('--line-strong', 'rgba(255,236,205,.16)');

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
    ctx.globalAlpha = 0.35;
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(72, 76, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = text;
  ctx.font = '600 30px Fraunces, Georgia, serif';
  ctx.fillText('KEYSTROKE FORENSICS', 92, 87);
  ctx.fillStyle = dim;
  ctx.font = '500 18px "IBM Plex Mono", monospace';
  ctx.fillText(`${r.boardKey.toUpperCase()}${r.verified ? '  ·  SERVER VERIFIED' : ''}`, 64, 140);

  ctx.fillStyle = dim;
  ctx.font = '500 20px "IBM Plex Mono", monospace';
  ctx.fillText('NET WPM', 64, 220);
  ctx.fillStyle = accent;
  ctx.font = '400 230px Fraunces, Georgia, serif';
  ctx.fillText(String(Math.round(r.netWpm)), 52, 430);

  const stats = [
    ['ACCURACY', `${r.finalAccuracy.toFixed(1)}%`],
    ['CONSISTENCY', `${r.consistency.toFixed(0)}%`],
    ['BURST', `${Math.round(r.burstWpm)} wpm`],
  ];
  stats.forEach(([k, v], i) => {
    const x = 64 + i * 230;
    ctx.fillStyle = dim;
    ctx.font = '500 16px "IBM Plex Mono", monospace';
    ctx.fillText(k, x, 510);
    ctx.fillStyle = i === 0 ? correct : text;
    ctx.font = '400 44px Fraunces, Georgia, serif';
    ctx.fillText(v, x, 560);
  });

  drawQr(ctx, url, W - 300, H - 340, 240, { dark: bg, light: text });
  ctx.fillStyle = dim;
  ctx.font = '500 15px "IBM Plex Mono", monospace';
  ctx.fillText('scan to race this score', W - 290, H - 70);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/**
 * Share via the Web Share API when files are supported; otherwise download the PNG.
 * @param {Blob} blob Card image.
 * @param {{title:string, text:string, url:string}} meta Share metadata.
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function shareCard(blob, meta) {
  const file = new File([blob], 'keystroke-forensics.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: meta.title, text: meta.text, url: meta.url });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'keystroke-forensics.png';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'downloaded';
}
