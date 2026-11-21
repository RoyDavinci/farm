import { EMAIL_LOGO_PNG_BASE64 } from './email-logo.js';

/**
 * Branded Zuru emails. Table layout with inline styles, so they render the same in Gmail, Outlook,
 * Apple Mail and phone mail apps; every email also carries a plain-text version.
 */
export interface Email {
  subject: string;
  text: string;
  html: string;
}
export const EMAIL_LOGO_CID = 'zuru-logo@zuru';
export const emailLogoAttachment = () => ({
  filename: 'zuru.png',
  content: Buffer.from(EMAIL_LOGO_PNG_BASE64, 'base64'),
  cid: EMAIL_LOGO_CID,
  contentType: 'image/png',
});

const GREEN = '#365b38',
  INK = '#1f2a21',
  MUTED = '#6b7566',
  PAPER = '#f4f2ea',
  CREAM = '#f6f4ec',
  GOLD = '#e9b949';
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font:16px/1.6 ${FONT};color:${INK};">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');

interface Layout {
  /** Shown as the inbox preview line. */
  preheader: string;
  eyebrow: string;
  heading: string;
  /** Plain text; blank lines start new paragraphs. */
  body: string;
  code?: string;
  codeNote?: string;
  button?: { label: string; url: string };
  footnote: string;
}

function layout(l: Layout) {
  const code = l.code
    ? `<tr><td style="padding:4px 0 20px;">
         <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr>
           <td align="center" style="background:${CREAM};border:1px solid #e4e0d2;border-radius:14px;padding:22px 12px;">
             <div style="font:700 13px/1 ${FONT};letter-spacing:3px;text-transform:uppercase;color:${MUTED};margin-bottom:12px;">Your code</div>
             <div style="font:800 40px/1 'SF Mono',Menlo,Consolas,monospace;letter-spacing:10px;color:${GREEN};padding-left:10px;">${escapeHtml(l.code)}</div>
             ${l.codeNote ? `<div style="font:14px/1.5 ${FONT};color:${MUTED};margin-top:14px;">${escapeHtml(l.codeNote)}</div>` : ''}
           </td></tr></table>
       </td></tr>`
    : '';
  const button = l.button
    ? `<tr><td style="padding:6px 0 22px;">
         <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
           <td style="border-radius:12px;background:${GREEN};">
             <a href="${escapeHtml(l.button.url)}" style="display:inline-block;padding:14px 26px;font:700 16px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:12px;">${escapeHtml(l.button.label)} &rarr;</a>
           </td></tr></table>
       </td></tr>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>${escapeHtml(l.heading)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPER};">${escapeHtml(l.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${PAPER};">
  <tr><td align="center" style="padding:28px 14px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
      <tr><td style="background:${GREEN};border-radius:20px 20px 0 0;padding:22px 28px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
          <td style="vertical-align:middle;"><img src="cid:${EMAIL_LOGO_CID}" width="44" height="44" alt="Zuru" style="display:block;border:0;border-radius:11px;"></td>
          <td style="vertical-align:middle;padding-left:12px;">
            <div style="font:800 24px/1 ${FONT};color:#ffffff;letter-spacing:-0.5px;">Zuru</div>
            <div style="font:600 12px/1.4 ${FONT};color:#d8e4d3;letter-spacing:0.5px;margin-top:4px;">Shop. Send. Receive.</div>
          </td></tr></table>
      </td></tr>
      <tr><td style="height:4px;background:${GOLD};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="background:#ffffff;padding:30px 28px 10px;border-radius:0 0 20px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr><td style="font:700 12px/1 ${FONT};letter-spacing:2.5px;text-transform:uppercase;color:${MUTED};padding-bottom:12px;">${escapeHtml(l.eyebrow)}</td></tr>
          <tr><td style="font:800 26px/1.25 ${FONT};color:${INK};letter-spacing:-0.4px;padding-bottom:16px;">${escapeHtml(l.heading)}</td></tr>
          <tr><td>${paragraphs(l.body)}</td></tr>
          ${code}${button}
          <tr><td style="border-top:1px solid #ece9df;padding:16px 0 20px;font:13px/1.6 ${FONT};color:${MUTED};">${escapeHtml(l.footnote)}</td></tr>
        </table>
      </td></tr>
      <tr><td align="center" style="padding:18px 10px 0;font:12px/1.6 ${FONT};color:#9a9f92;">
        Zuru · Buy, sell and deliver near you<br>This is an automated message; replies aren’t monitored.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

const plain = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join('\n\n') + '\n\n— Zuru · Shop. Send. Receive.';

/** Sign-in, registration and password reset codes. */
export function codeEmail(purpose: 'login' | 'register' | 'reset' | string, code: string): Email {
  const what =
    purpose === 'reset'
      ? 'reset your password'
      : purpose === 'register'
        ? 'verify your email'
        : 'sign in';
  const heading =
    purpose === 'reset'
      ? 'Reset your password'
      : purpose === 'register'
        ? 'Confirm your email'
        : 'Your sign-in code';
  const body = `Use this code to ${what} on Zuru.`;
  const note = 'Expires in 10 minutes · can only be used once';
  const footnote =
    'Never share this code. Zuru staff will never ask for it. If you didn’t request it, you can ignore this email; your account is safe.';
  return {
    subject: `${code} is your Zuru ${purpose === 'reset' ? 'password reset' : purpose === 'register' ? 'verification' : 'sign-in'} code`,
    // Keep the sentence "… code is 123456." in the text version: scripts and tests read it.
    text: plain(
      `Your Zuru ${purpose === 'reset' ? 'password reset' : purpose === 'register' ? 'email verification' : 'sign-in'} code is ${code}.`,
      `${body} (${note})`,
      footnote,
    ),
    html: layout({
      preheader: `${code} · ${note}`,
      eyebrow: purpose === 'reset' ? 'Account security' : 'Welcome to Zuru',
      heading,
      body,
      code,
      codeNote: note,
      footnote,
    }),
  };
}

/** Reset requested for an address with no account. */
export function noAccountEmail(email: string): Email {
  const body = `Someone asked to reset the Zuru password for ${email}, but no Zuru account uses this email address.\n\nIf that was you, create an account in the Zuru app, or reset the password for the email address you signed up with.`;
  const footnote = 'If you didn’t ask for this, you can ignore this email.';
  return {
    subject: 'Zuru password reset',
    text: plain('No Zuru account for this email', body, footnote),
    html: layout({
      preheader: 'No Zuru account uses this email address',
      eyebrow: 'Account security',
      heading: 'No account for this email',
      body,
      footnote,
    }),
  };
}

/** Order, delivery, payment and message updates. */
export function notificationEmail(title: string, body: string, webUrl?: string): Email {
  const footnote =
    'You’re getting this because email alerts are on. Manage them in Account → Notifications.';
  return {
    subject: `Zuru: ${title}`,
    text: plain(
      title,
      body,
      webUrl ? `Open Zuru: ${webUrl}` : 'Open the Zuru app for details.',
      footnote,
    ),
    html: layout({
      preheader: body.slice(0, 120),
      eyebrow: 'Update',
      heading: title,
      body: webUrl ? body : `${body}\n\nOpen the Zuru app for details.`,
      button: webUrl ? { label: 'Open Zuru', url: webUrl } : undefined,
      footnote,
    }),
  };
}
