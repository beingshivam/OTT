/**
 * Transactional email through Resend — the "Email me when it streams" alerts.
 *
 * Configured by one Worker secret, RESEND_API_KEY, and nothing else. Without
 * it `mailConfigured` is false, the site hides the email option, and nothing
 * is ever promised that cannot be sent. Setup is in docs/email-setup.md.
 *
 * Every message carries List-Unsubscribe with a one-click https link
 * (RFC 8058): Gmail and Yahoo require it of bulk senders, and an alert nobody
 * can stop is how a domain ends up in spam.
 *
 * The look is the site's, not a generic receipt: the near-black page, the
 * orange play mark, the amber accent, the film's poster and the platform's own
 * app icon. Built from tables with inline styles because that is what every
 * mail client renders the same way; colours are set as both attributes and
 * styles so clients that strip one keep the other.
 */

export const MAIL_FROM = 'New on OTT <mail@newonott.in>';
const SITE = 'https://newonott.in';
const INSTAGRAM = 'https://www.instagram.com/newonott.in/';

export const mailConfigured = (env) => Boolean(env?.RESEND_API_KEY);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * A TMDB image as served through the site's own proxy, at the given size, or
 * null. Anything that is not a TMDB path is refused, so a request can never
 * put an arbitrary image into an email this domain sends.
 */
export function proxiedImage(url, size = 'w342') {
  const m = String(url ?? '').match(/^(?:https:\/\/image\.tmdb\.org\/t\/p|https:\/\/newonott\.in\/img|\/img)\/w\d+\/([A-Za-z0-9_-]+\.(?:jpg|jpeg|png))$/);
  return m ? `${SITE}/img/${size}/${m[1]}` : null;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const BG = '#06070a';
const CARD = '#10131c';
const LINE = '#1f2432';
const TEXT = '#f2f4f9';
const MUTED = '#9aa3b6';
const AMBER = '#ffb03a';

/**
 * One alert email.
 *
 *   kicker    small amber label above the title ("OTT alert")
 *   heading   the film's title
 *   status    the one line the email exists for ("Coming to Prime Video on 12 Nov")
 *   platform  { name, icon } — the app icon beside the status, when known
 *   poster    TMDB poster URL (proxied and validated here)
 *   lines     a sentence or two of context
 *   cta       { label, url }
 */
export function renderMail({ preheader, kicker, heading, status, platform, poster, lines = [], cta, unsubscribeUrl }) {
  const text = [
    `New on OTT — ${kicker ?? ''}`.trim(),
    '',
    heading,
    status ?? '',
    '',
    ...lines,
    '',
    cta ? `${cta.label}: ${cta.url}` : '',
    '',
    `newonott.in — every new release, every platform`,
    `Stop these emails: ${unsubscribeUrl}`,
  ]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n');

  const posterSrc = proxiedImage(poster, 'w342');
  const iconSrc = platform?.icon ? proxiedImage(platform.icon, 'w92') : null;

  const statusRow = status
    ? `<tr><td style="padding-top:14px;">
         <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
           ${iconSrc ? `<td style="padding-right:10px;vertical-align:middle;"><img src="${esc(iconSrc)}" width="28" height="28" alt="${esc(platform.name)}" style="display:block;width:28px;height:28px;border-radius:7px;border:0;"></td>` : ''}
           <td style="vertical-align:middle;font:600 16px/1.35 ${FONT};color:${TEXT};">${esc(status)}</td>
         </tr></table>
       </td></tr>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};" bgcolor="${BG}">
<div style="display:none;font-size:1px;color:${BG};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(preheader ?? status ?? '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" style="background:${BG};">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">

    <tr><td style="padding:0 4px 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;padding-right:10px;"><a href="${SITE}/"><img src="${SITE}/icon-192.png" width="34" height="34" alt="" style="display:block;width:34px;height:34px;border-radius:9px;border:0;"></a></td>
        <td style="vertical-align:middle;font:700 19px/1 ${FONT};color:${TEXT};letter-spacing:-0.2px;"><a href="${SITE}/" style="color:${TEXT};text-decoration:none;">New on OTT</a></td>
      </tr></table>
    </td></tr>

    <tr><td bgcolor="${CARD}" style="background:${CARD};border:1px solid ${LINE};border-radius:18px;padding:22px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        ${posterSrc ? `<td width="116" style="width:116px;vertical-align:top;padding-right:18px;"><a href="${esc(cta?.url ?? SITE)}"><img src="${esc(posterSrc)}" width="116" alt="${esc(heading)} poster" style="display:block;width:116px;height:auto;border-radius:12px;border:0;"></a></td>` : ''}
        <td style="vertical-align:top;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${kicker ? `<tr><td style="font:800 12px/1 ${FONT};letter-spacing:1.6px;text-transform:uppercase;color:${AMBER};padding-bottom:10px;">${esc(kicker)}</td></tr>` : ''}
            <tr><td style="font:800 26px/1.15 ${FONT};color:${TEXT};letter-spacing:-0.4px;">${esc(heading)}</td></tr>
            ${statusRow}
          </table>
        </td>
      </tr></table>

      ${lines.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;border-top:1px solid ${LINE};"><tr><td style="padding-top:16px;">
        ${lines.map((l) => `<p style="margin:0 0 10px;font:400 15px/1.6 ${FONT};color:${MUTED};">${esc(l)}</p>`).join('')}
      </td></tr></table>` : ''}

      ${cta ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;"><tr>
        <td bgcolor="${AMBER}" style="border-radius:999px;background:${AMBER};background-image:linear-gradient(90deg,#ff5a4d,#ffb03a);">
          <a href="${esc(cta.url)}" style="display:inline-block;padding:13px 22px;font:800 15px/1 ${FONT};color:#111111;text-decoration:none;border-radius:999px;">${esc(cta.label)} &rarr;</a>
        </td>
      </tr></table>` : ''}
    </td></tr>

    <tr><td style="padding:20px 6px 0;font:400 13px/1.6 ${FONT};color:${MUTED};">
      <a href="${SITE}/" style="color:${TEXT};text-decoration:none;font-weight:700;">newonott.in</a>
      &nbsp;·&nbsp; Every new release, every platform, one page.
      &nbsp;·&nbsp; <a href="${INSTAGRAM}" style="color:${MUTED};">Instagram</a>
    </td></tr>
    <tr><td style="padding:8px 6px 0;font:400 12px/1.6 ${FONT};color:#6b7385;">
      You asked newonott.in to email you about this title. <a href="${esc(unsubscribeUrl)}" style="color:#6b7385;">Stop these emails</a>.
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>`;
  return { text, html };
}

/** Sends one message. Resolves to true when Resend accepted it. */
export async function sendMail(env, { to, subject, text, html, unsubscribeUrl }, send = fetch) {
  if (!mailConfigured(env)) return false;
  const res = await send('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [to],
      subject,
      text,
      html,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });
  if (!res.ok) console.error('mail: resend refused', res.status, await res.text().catch(() => ''));
  return res.ok;
}
