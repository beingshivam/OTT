/**
 * The one poster design, so everything posted looks like the same product.
 *
 * Lifted out of build-social when a second weekly builder needed it. Copying
 * the stylesheet would have been the quick way and the wrong one: the comment
 * it carries — "the same two-corner wash as the site and the share card, so a
 * poster and the page it points at read as one product" — stops being true the
 * first time one copy is adjusted and the other is not.
 *
 * Everything that varies between posts is an argument. What does not vary is
 * the wash, the wordmark, the footer and the way the list absorbs the space
 * left over, because those are the things that make two different posts
 * recognisably from one place.
 */

import { BRAND } from './brand.mjs';

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * How many rows each crop carries before the type shrinks past the point where
 * it reads in a feed at thumbnail size. Fewer, bigger, legible beats a complete
 * list nobody can read.
 */
export const SIZES = [
  // Instagram feed. 4:5 is the tallest crop the feed allows, so it takes the
  // most screen on a scroll.
  { name: 'instagram-4x5', w: 1080, h: 1350, items: 8, title: 40, head: 92 },
  // WhatsApp chat. A 9:16 gets aggressively cropped in the message thumbnail
  // and the URL is what gets cut, so forwards get a square that cannot lose it.
  { name: 'whatsapp-1x1', w: 1080, h: 1080, items: 6, title: 40, head: 84 },
  // Stories, Reels covers, WhatsApp status.
  { name: 'story-9x16', w: 1080, h: 1920, items: 11, title: 42, head: 104 },
];

/**
 * @param size     one of SIZES
 * @param kicker   the small uppercase line top-right — the week, usually
 * @param headline HTML, with <em> for the warm gradient word
 * @param standfirst the line under the headline: counts, never adjectives
 * @param rows     [{ label, note, accent }] — already sliced to size.items
 * @param more     the "+ n more" line, or ''
 * @param footnote the line under the URL
 * @param site     the address, which is the only thing the post is really for
 */
export function card({ size, kicker, headline, standfirst, rows, more = '', footnote, site }) {
  const { w, h, title, head } = size;

  return `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:${w}px; height:${h}px; position:relative; overflow:hidden;
    background:#06070a; color:#f2f4f9;
    font-family:Inter,system-ui,sans-serif;
    display:flex; flex-direction:column;
    padding:${Math.round(h * 0.062)}px 72px;
  }
  /* The same two-corner wash as the site and the share card, so a poster and
     the page it points at read as one product. */
  body::before, body::after {
    content:''; position:absolute; width:1100px; height:1100px; border-radius:50%; pointer-events:none;
  }
  body::before { top:-680px; left:-300px; background:radial-gradient(circle, rgba(255,61,61,.34), transparent 62%); }
  body::after  { bottom:-780px; right:-320px; background:radial-gradient(circle, rgba(126,78,255,.26), transparent 64%); }

  .top { display:flex; align-items:center; gap:16px; position:relative; }
  .mark { width:44px; height:44px; border-radius:13px; display:grid; place-items:center;
          background:linear-gradient(135deg,#ff4d4d,#ffb03a); }
  .mark svg { width:19px; height:19px; fill:#fff; }
  .brand { font-size:31px; font-weight:700; letter-spacing:-.02em; }
  .week { margin-left:auto; font-size:23px; font-weight:700; letter-spacing:.13em;
          text-transform:uppercase; color:#8d94a4; }

  h1 { position:relative; flex:none; margin-top:${Math.round(h * 0.038)}px;
       font-size:${head}px; line-height:1.02; font-weight:900; letter-spacing:-.045em; }
  /* Warm the whole way, no blue stop. Clipped to a short word the red→gold→blue
     ramp desaturates mid-letter: "week." came out with a grey "k" and a grey
     full stop, which reads as a broken render rather than a colour choice. Same
     ramp as the play mark, so wordmark and headline agree. */
  h1 em { font-style:normal;
          background:linear-gradient(100deg,#ff4d4d,#ff7a3d 42%,#ffb03a);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .count { position:relative; margin-top:20px; font-size:27px; font-weight:500; color:#b6bdcc; }

  /* The list absorbs whatever is left rather than being sized by a guess.
     Computing row padding as a fraction of the canvas overflowed the footer off
     the bottom — and the footer carries the URL, which is the only thing the
     post is actually for. */
  ul { position:relative; list-style:none; margin-top:${Math.round(h * 0.035)}px;
       flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }
  li { flex:1 1 0; min-height:0; display:flex; align-items:center; gap:16px;
       border-bottom:1px solid rgba(255,255,255,.08); }
  li:last-child { border-bottom:0; }
  .dot { width:11px; height:11px; border-radius:50%; flex:none; }
  .t { font-size:${title}px; font-weight:700; letter-spacing:-.028em; flex:1;
       white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .p { font-size:${Math.round(title * 0.62)}px; font-weight:650; flex:none; }

  .more { position:relative; flex:none; margin-top:20px; font-size:26px; font-weight:500; color:#7d8494; }

  .foot { position:relative; flex:none; margin-top:${Math.round(h * 0.028)}px; padding-top:28px;
          border-top:1px solid rgba(255,255,255,.12); }
  .url { font-size:${Math.round(head * 0.56)}px; font-weight:800; letter-spacing:-.035em;
         background:linear-gradient(100deg,#ffb03a,#ff4d4d); -webkit-background-clip:text;
         -webkit-text-fill-color:transparent; }
  .kicker { margin-top:12px; font-size:25px; font-weight:500; color:#8d94a4; }
</style>
<div class="top">
  <span class="mark"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
  <span class="brand">${esc(BRAND)}</span>
  <span class="week">${esc(kicker)}</span>
</div>

<h1>${headline}</h1>
<div class="count">${esc(standfirst)}</div>

<ul>
  ${rows
    .map(
      (r) => `<li>
    <span class="dot" style="background:${r.accent}"></span>
    <span class="t">${esc(r.label)}</span>
    <span class="p" style="color:${r.accent}">${esc(r.note)}</span>
  </li>`,
    )
    .join('\n  ')}
</ul>
${more ? `<div class="more">${esc(more)}</div>` : ''}

<div class="foot">
  <div class="url">${esc(site)}</div>
  <div class="kicker">${esc(footnote)}</div>
</div>
`;
}
