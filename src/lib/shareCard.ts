import { BRAND, TAGLINE } from '../data/brand';
import { BRAND_MARKS } from '../data/brand-marks';
import { inkOn, platform } from '../data/platforms';
import { metaLine } from './format';
import { formatWeekRange } from './week';
import type { Release } from '../types';

/**
 * Renders the current week as a shareable PNG.
 *
 * The thing this competes with is an image people forward on WhatsApp. Rather
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

/** Just the host — the scheme is noise on a card and "https://" costs width
 *  that the name itself should be spending. */
const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

const font = (size: number, weight = 400) =>
  `${weight} ${size}px Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

/** Trim to fit, with an ellipsis, so a long title never bleeds out of its column. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + '…').width > max) cut = cut.slice(0, -1);
  return cut + '…';
}

/**
 * Canvas `roundRect` only landed in Safari 16.4, and this is a share feature
 * aimed squarely at phones — so on anything older it would throw and the button
 * would just say "Try again" forever. Trace the path by hand instead.
 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
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
  ctx.fillText(BRAND, PAD + 54, y + 29);

  /**
   * The address, beside the name rather than only in the footer.
   *
   * A card forwarded on WhatsApp is met first as a thumbnail, and read at that
   * size the footer is a grey line nobody resolves. Whoever crops it — and
   * people crop — takes the top. So the URL sits where the eye lands and where
   * a crop is least likely to remove it, and stays in the footer as well: the
   * whole point of putting the week in a picture is that the picture says where
   * the rest of it lives.
   */
  ctx.fillStyle = '#ff8f6b';
  ctx.font = font(24, 650);
  ctx.fillText(host(siteUrl), PAD + 54 + ctx.measureText(BRAND).width + 84, y + 29);

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
  ctx.font = font(30, 700);
  ctx.fillText(host(siteUrl), PAD, fy + 56);

  ctx.fillStyle = '#7d8494';
  ctx.font = font(18, 500);
  ctx.textAlign = 'right';
  ctx.fillText(TAGLINE[0].toUpperCase() + TAGLINE.slice(1), W - PAD, fy + 52);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not render the card.'))),
      'image/png',
    );
  });
}

/* -------------------------------------------------------- the poster card ---- */

/**
 * The same week as artwork.
 *
 * The board card is a schedule and reads like one — dense, scannable, honest,
 * and completely unlike what people actually forward. On WhatsApp and Instagram
 * an image competes on the first glance, and a wall of posters wins that glance
 * against a list of titles every time. Same week, same URL, different argument.
 *
 * The two exist together rather than one replacing the other because they are
 * for different moments: the board is for someone deciding what to watch, the
 * posters are for someone deciding whether to look.
 */

const GRID_COLS = 4;
/** Four rows. Past this the image is taller than anything a chat thread will
 *  show without a tap, and the tail is titles nobody scrolled to anyway. */
const GRID_MAX = GRID_COLS * 4;

/**
 * TMDB's artwork, loaded so a canvas can keep it.
 *
 * `crossOrigin` is what makes this safe rather than what makes it work: an
 * image drawn without it taints the canvas and `toBlob` throws a SecurityError
 * at the end, after all the work. With it, a server that refuses CORS fails the
 * *load* instead, which is a failure this can see and answer with the generated
 * art the app already falls back to on screen. Either way a card comes out.
 */
/**
 * TMDB artwork, asked for from our own origin.
 *
 * image.tmdb.org does not send Access-Control-Allow-Origin, so a canvas that
 * has drawn one of its images cannot be read back — which is why the first
 * poster cards came out as coloured gradients. The Worker re-serves the same
 * bytes from this origin (see worker/index.js), where the question does not
 * arise. Anything that is not a TMDB URL is left exactly as it is.
 */
function sameOrigin(url: string): string {
  const m = url.match(/^https?:\/\/image\.tmdb\.org\/t\/p\/([^/]+)\/(.+)$/);
  return m ? `/img/${m[1]}/${m[2]}` : url;
}

function loadPoster(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    // A share that hangs is worse than one that renders without a picture.
    const timer = setTimeout(() => resolve(null), 6000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = sameOrigin(url);
  });
}

/** The same deterministic fallback the cards on screen use, so a title looks
 *  like itself whether or not its artwork arrived. */
function fallbackArt(ctx: CanvasRenderingContext2D, r: Release, x: number, y: number, w: number, h: number) {
  let hash = 2166136261;
  for (let i = 0; i < r.title.length; i++) {
    hash ^= r.title.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash = Math.abs(hash);

  /**
   * Hue from the title, not from the platform.
   *
   * The first version tinted each card with its service's accent, which sounds
   * right and produced a grid of near-identical dark red rectangles: Netflix,
   * Sun NXT and hoichoi are all red, and half a week's releases are on one of
   * them. Seeded from the title instead, every card is its own colour and the
   * badge in the corner is what says whose it is — which is the badge's job
   * anyway. Drawn at full strength: the previous 55% opacity over a near-black
   * ground turned all of them to mud.
   */
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, `hsl(${hash % 360}deg 52% 32%)`);
  grad.addColorStop(1, `hsl(${(hash * 7) % 360}deg 46% 15%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
}

export async function renderPosterCard({
  releases,
  weekId,
  filterNote,
  siteUrl,
  heading,
}: Options & { heading?: string }): Promise<Blob> {
  const shown = releases.slice(0, GRID_MAX);
  const rest = releases.length - shown.length;

  const cellW = (W - PAD * 2 - COL_GAP * (GRID_COLS - 1)) / GRID_COLS;
  const artH = Math.round(cellW * 1.5);
  const cellH = artH + 76;
  const rows = Math.ceil(shown.length / GRID_COLS);

  const headerH = 268;
  const footerH = rest > 0 ? 150 : 116;
  const H = Math.round(headerH + rows * cellH + (rows - 1) * GAP + footerH);

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not render the card.');
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';

  const wash = ctx.createLinearGradient(0, 0, W, H);
  wash.addColorStop(0, '#0a0710');
  wash.addColorStop(0.5, '#06070a');
  wash.addColorStop(1, '#0b0a14');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  // ---- header ---------------------------------------------------------------
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
  ctx.fillText(BRAND, PAD + 54, y + 29);
  ctx.fillStyle = '#ff8f6b';
  ctx.font = font(24, 650);
  ctx.fillText(host(siteUrl), PAD + 54 + ctx.measureText(BRAND).width + 84, y + 29);

  y += 96;
  ctx.fillStyle = '#ffffff';
  ctx.font = font(54, 700);
  ctx.fillText(heading ?? formatWeekRange(weekId), PAD, y);

  y += 38;
  ctx.fillStyle = '#b6bdcc';
  ctx.font = font(21, 500);
  const summary = `${releases.length} ${releases.length === 1 ? 'title' : 'titles'}`;
  ctx.fillText(filterNote ? `${summary}  ·  ${filterNote}` : summary, PAD, y);

  // ---- grid -----------------------------------------------------------------
  const art = await Promise.all(shown.map((r) => (r.posterUrl ? loadPoster(r.posterUrl) : null)));

  shown.forEach((r, i) => {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    const x = PAD + col * (cellW + COL_GAP);
    const top = headerH + row * (cellH + GAP);

    ctx.save();
    roundRect(ctx, x, top, cellW, artH, 16);
    ctx.clip();
    ctx.fillStyle = '#12141c';
    ctx.fillRect(x, top, cellW, artH);
    const img = art[i];
    if (img) {
      // Cover, not stretch: posters vary a little and a squashed face is the
      // one thing a reader notices instantly.
      const scale = Math.max(cellW / img.width, artH / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, x + (cellW - dw) / 2, top + (artH - dh) / 2, dw, dh);
    } else {
      fallbackArt(ctx, r, x, top, cellW, artH);
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    roundRect(ctx, x, top, cellW, artH, 16);
    ctx.stroke();

    // The platform, on the poster, because a wall of artwork with no badges is
    // pretty and answers nothing.
    drawMark(ctx, r.platforms[0], x + 12, top + 12, 34);

    ctx.fillStyle = '#f2f4f9';
    ctx.font = font(20, 650);
    ctx.fillText(fit(ctx, r.title, cellW), x, top + artH + 30);
    ctx.fillStyle = '#7d8494';
    ctx.font = font(17, 500);
    ctx.fillText(fit(ctx, metaLine(r, 1), cellW), x, top + artH + 54);
  });

  // ---- footer ---------------------------------------------------------------
  const fy = H - footerH;
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.moveTo(PAD, fy + 8);
  ctx.lineTo(W - PAD, fy + 8);
  ctx.stroke();

  if (rest > 0) {
    ctx.fillStyle = '#b6bdcc';
    ctx.font = font(21, 500);
    ctx.fillText(`+ ${rest} more this week`, PAD, fy + 48);
  }

  ctx.fillStyle = '#f2f4f9';
  ctx.font = font(30, 700);
  ctx.fillText(host(siteUrl), PAD, fy + (rest > 0 ? 96 : 56));

  ctx.fillStyle = '#7d8494';
  ctx.font = font(18, 500);
  ctx.textAlign = 'right';
  ctx.fillText(TAGLINE[0].toUpperCase() + TAGLINE.slice(1), W - PAD, fy + (rest > 0 ? 96 : 56));
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not render the card.'))),
      'image/png',
    );
  });
}
