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
 */

export const MAIL_FROM = 'New on OTT <mail@newonott.in>';

export const mailConfigured = (env) => Boolean(env?.RESEND_API_KEY);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** A short message: a heading, a few lines, one button, and the way out. */
export function renderMail({ heading, lines, cta, unsubscribeUrl }) {
  const text = [heading, '', ...lines, '', cta ? `${cta.label}: ${cta.url}` : '', '', `Stop these emails: ${unsubscribeUrl}`]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n');
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">` +
    `<p style="font-size:13px;color:#888;margin:0 0 16px">New on OTT</p>` +
    `<h1 style="font-size:22px;line-height:1.3;margin:0 0 14px">${esc(heading)}</h1>` +
    lines.map((l) => `<p style="font-size:16px;line-height:1.55;margin:0 0 12px">${esc(l)}</p>`).join('') +
    (cta
      ? `<p style="margin:22px 0"><a href="${esc(cta.url)}" style="background:#ffb03a;color:#111;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:999px;display:inline-block">${esc(cta.label)}</a></p>`
      : '') +
    `<p style="font-size:12px;color:#888;margin-top:28px">You asked newonott.in to email you about this title. <a href="${esc(unsubscribeUrl)}" style="color:#888">Stop these emails</a>.</p>` +
    `</div>`;
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
