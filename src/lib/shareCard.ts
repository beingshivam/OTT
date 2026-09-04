import { BRAND_MARKS } from '../data/brand-marks';
import { inkOn, platform } from '../data/platforms';
import { metaLine } from './format';
import { formatWeekRange } from './week';
import type { Release } from '../types';

/**
 * Renders the current week as a shareable PNG.
 *
 * The thing dropday competes with is an image people forward on WhatsApp. Rather
 * than fight that behaviour, this feeds it: export exactly what's on screen —
 * filters and all — as a card sized for a chat thread, with the URL on it. Every
 * forward is then a link back, which makes sharing the growth loop rather than a
 * leak.
 *
 * Drawn on a canvas rather than screenshotted so it composes for a phone screen
 * instead of reproducing a desktop layout, and so it works with no network.
 */

const W = 1080;
const PAD = 56;
const GAP = 24;
const COL_GAP = 28;
const SCALE = 2; // Retina-sharp in a chat thread.

interface Options {
  releases: Release[];
  weekId: string;
  /** e.g. "Tamil · Films" when filters are active; omitted when showing everything. */
  filterNote?: string;
  siteUrl: string;
}

interface Panel {
  id: string;
  releases: Release[];
  height: number;
}

const font = (size: number, weight = 400) =>
  `${weight} ${size}px Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

/** Trim to fit, with an ellipsis, so a long title never bleeds out of its column. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + '…').width > max) cut = cut.slice(0, -1);
  return cut + '…';
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** The platform mark, real glyph where we have one, monogram where we don't. */
function drawMark(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, size: number) {
  const p = platform(id);
  const grad = ctx.createLinearGradient(x, y, x + size, y + size);
  grad.addColorStop(0, p.accent);
  grad.addColorStop(1, p.accent2 ?? p.accent);
  ctx.fillStyle = grad;
  roundRect(ctx, x, y, size, size, size * 0.26);
  ctx.fill();

  const ink = inkOn(p.accent);
  const brand = BRAND_MARKS[id];
  if (brand) {
    ctx.save();
    const inset = size * 0.2;
    ctx.translate(x + inset, y + inset);
    ctx.scale((size - inset * 2) / 24, (size - inset * 2) / 24);
    ctx.fillStyle = ink;
    ctx.fill(new Path2D(brand.path));
    ctx.restore();
    return;
  }

  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(size * (p.mark.length > 2 ? 0.3 : 0.44), 800);
  ctx.fillText(p.mark, x + size / 2, y + size / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

const HEAD_H = 54;
const ROW_H = 62;

function measure(releases: Release[]): Panel[] {
  const byPlatform = new Map<string, Release[]>();
  for (const r of releases) {
    for (const id of r.platforms) {
      const list = byPlatform.get(id);
      if (list) list.push(r);
      else byPlatform.set(id, [r]);
    }
  }
  return [...byPlatform.entries()]
    .map(([id, list]) => ({ id, releases: list, height: HEAD_H + list.length * ROW_H + 18 }))
    .sort(
      (a, b) =>
        (platform(b.id).theatrical ? 1 : 0) - (platform(a.id).theatrical ? 1 : 0) ||
        b.releases.length - a.releases.length,
    );
}

/** Same shortest-column packing as the board, so the card mirrors the site. */
function pack(panels: Panel[], columns: number): Panel[][] {
  const cols: Panel[][] = Array.from({ length: columns }, () => []);
  const heights = new Array<number>(columns).fill(0);
  for (const panel of panels) {
    let shortest = 0;
    for (let i = 1; i < columns; i++) if (heights[i] < heights[shortest]) shortest = i;
    cols[shortest].push(panel);
    heights[shortest] += panel.height + GAP;
  }
  return cols;
}

export async function renderShareCard(opts: Options): Promise<Blob> {
  const { releases, weekId, filterNote, siteUrl } = opts;

  // One column reads better for a handful of titles; two keeps a full week from
  // becoming a scroll of its own.
  const columns = releases.length > 6 ? 2 : 1;
  const colW = (W - PAD * 2 - COL_GAP * (columns - 1)) / columns;

  const panels = measure(releases);
  const packed = pack(panels, columns);
  const bodyH = Math.max(
    ...packed.map((col) => col.reduce((h, p) => h + p.height + GAP, 0)),
    0,
  );

  const headerH = 296;
  const footerH = 116;
  const H = Math.round(headerH + bodyH + footerH);

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser.');
  ctx.scale(SCALE, SCALE);

  // Ground, matching the site rather than inventing a second identity.
  ctx.fillStyle = '#06070a';
  ctx.fillRect(0, 0, W, H);
  const wash = ctx.createRadialGradient(W * 0.15, 0, 0, W * 0.15, 0, W * 0.9);
  wash.addColorStop(0, 'rgba(255,61,61,0.20)');
  wash.addColorStop(0.55, 'rgba(126,78,255,0.10)');
  wash.addColorStop(1, 'rgba(0,0,0,0)');
  // Fill the whole canvas: clipping the rect left a hard edge where the
  // gradient had not yet reached transparent.
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  // ---- header -------------------------------------------------------------
  let y = PAD + 8;

  const logoGrad = ctx.createLinearGradient(PAD, y, PAD + 40, y + 40);
  logoGrad.addColorStop(0, '#ff4d4d');
  logoGrad.addColorStop(1, '#ffb03a');
  ctx.fillStyle = logoGrad;
  roundRect(ctx, PAD, y, 40, 40, 12);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(PAD + 15, y + 12);
  ctx.lineTo(PAD + 30, y + 20);
  ctx.lineTo(PAD + 15, y + 28);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#f2f4f9';
  ctx.font = font(30, 700);
  ctx.fillText('dropday', PAD + 54, y + 29);

  y += 92;
  ctx.fillStyle = '#7d8494';
  ctx.font = font(17, 700);
  ctx.fillText("YOUR GUIDE TO WHAT'S NEW".split('').join(' '), PAD, y);

  y += 54;
  ctx.fillStyle = '#ffffff';
  ctx.font = font(58, 700);
  ctx.fillText(formatWeekRange(weekId), PAD, y);

  y += 40;
  ctx.fillStyle = '#b6bdcc';
  ctx.font = font(21, 500);
  const platformCount = new Set(releases.flatMap((r) => r.platforms)).size;
  const summary = `${releases.length} ${releases.length === 1 ? 'release' : 'releases'} · ${platformCount} ${platformCount === 1 ? 'platform' : 'platforms'}`;
  ctx.fillText(filterNote ? `${summary}  ·  ${filterNote}` : summary, PAD, y);

  // ---- panels -------------------------------------------------------------
  const top = headerH;
  packed.forEach((col, ci) => {
    const x = PAD + ci * (colW + COL_GAP);
    let cy = top;

    for (const panel of col) {
      const p = platform(panel.id);

      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      roundRect(ctx, x, cy, colW, panel.height, 16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Accent edge, the board's own signature.
      ctx.fillStyle = p.accent;
      roundRect(ctx, x, cy, 4, HEAD_H, 2);
      ctx.fill();

      drawMark(ctx, panel.id, x + 18, cy + 13, 28);

      ctx.fillStyle = p.accent;
      ctx.font = font(21, 700);
      ctx.fillText(fit(ctx, p.name, colW - 110), x + 56, cy + 34);

      ctx.fillStyle = '#7d8494';
      ctx.font = font(17, 700);
      ctx.textAlign = 'right';
      ctx.fillText(String(panel.releases.length), x + colW - 18, cy + 34);
      ctx.textAlign = 'left';

      let ry = cy + HEAD_H + 8;
      for (const r of panel.releases) {
        ctx.fillStyle = '#f2f4f9';
        ctx.font = font(22, 600);
        const drop = r.drop
          ? [r.drop.season != null ? `S${r.drop.season}` : '', r.drop.episode != null ? `E${r.drop.episode}` : '']
              .filter(Boolean)
              .join(' ')
          : '';
        ctx.fillText(fit(ctx, r.title, colW - 40 - (drop ? 60 : 0)), x + 20, ry + 22);

        if (drop) {
          ctx.fillStyle = '#7d8494';
          ctx.font = font(16, 700);
          ctx.textAlign = 'right';
          ctx.fillText(drop, x + colW - 20, ry + 22);
          ctx.textAlign = 'left';
        }

        ctx.fillStyle = '#8d94a4';
        ctx.font = font(17, 500);
        ctx.fillText(fit(ctx, metaLine(r, 1), colW - 40), x + 20, ry + 46);

        ry += ROW_H;
      }

      cy += panel.height + GAP;
    }
  });

  // ---- footer -------------------------------------------------------------
  const fy = H - footerH;
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.moveTo(PAD, fy + 8);
  ctx.lineTo(W - PAD, fy + 8);
  ctx.stroke();

  ctx.fillStyle = '#f2f4f9';
  ctx.font = font(22, 650);
  ctx.fillText(siteUrl.replace(/^https?:\/\//, ''), PAD, fy + 52);

  ctx.fillStyle = '#7d8494';
  ctx.font = font(18, 500);
  ctx.textAlign = 'right';
  ctx.fillText('Every new release, every platform, one page.', W - PAD, fy + 52);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not render the card.'))),
      'image/png',
    );
  });
}
