// backend/mailer.ts
//
// Branded email sender using the Resend REST API.
// Requires RESEND_API_KEY in the environment.
// EMAIL_FROM defaults to "Shuttler <noreply@shuttler.net>".
//
// Usage:
//   import { sendEmail, emailVerificationTemplate, ... } from './mailer';
//   await sendEmail({ to, subject, html: emailVerificationTemplate({ ... }) });

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'Shuttler <noreply@shuttler.net>';
const PRIMARY = '#16a34a';
const PRIMARY_DARK = '#166534';

// ---------- Send ----------

interface SendOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendOptions): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn('[mailer] RESEND_API_KEY not set — skipping email to', to);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)');
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

// ---------- Shared layout & components ----------

function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Shuttler</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:580px;margin:0 auto;" cellpadding="0" cellspacing="0">

        <!-- Header -->
        <tr>
          <td style="background-color:${PRIMARY};border-radius:12px 12px 0 0;padding:28px 40px;text-align:center;">
            <span style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Shuttler</span>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background-color:#ffffff;padding:36px 40px 32px;">
            ${content}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background-color:#f9fafb;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
              Sent by Shuttler &middot; <a href="https://shuttler.net" style="color:#9ca3af;text-decoration:none;">shuttler.net</a>
            </p>
            <p style="margin:6px 0 0;font-size:11px;color:#d1d5db;">
              If you didn&rsquo;t request this, you can safely ignore it.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function ctaButton(label: string, url: string): string {
  return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
  <tr>
    <td align="center">
      <a href="${url}"
         style="display:inline-block;padding:14px 32px;background-color:${PRIMARY};color:#ffffff;
                text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;
                letter-spacing:0.2px;mso-padding-alt:0;">
        ${label}
      </a>
    </td>
  </tr>
</table>`;
}

function infoBox(title: string, bodyHtml: string, color = '#f0fdf4', borderColor = '#bbf7d0', titleColor = PRIMARY_DARK): string {
  return `
<table width="100%" cellpadding="0" cellspacing="0"
       style="background-color:${color};border-radius:8px;border:1px solid ${borderColor};
              padding:18px 20px;margin:20px 0;">
  <tr>
    <td style="padding:18px 20px;">
      <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:${titleColor};">${title}</p>
      ${bodyHtml}
    </td>
  </tr>
</table>`;
}

function fallbackLink(url: string): string {
  return `<p style="margin:24px 0 0;font-size:12px;color:#9ca3af;word-break:break-all;">
  Or paste this link into your browser:<br/>
  <a href="${url}" style="color:${PRIMARY};">${url}</a>
</p>`;
}

// ---------- Templates ----------

export function emailVerificationTemplate(opts: {
  name: string;
  verifyUrl: string;
  orgName: string;
}): string {
  const firstName = (opts.name.split(' ')[0] || opts.name).trim();
  return layout(`
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Verify your email address</h1>
    <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.7;">
      Hi ${firstName}, welcome to <strong>${opts.orgName}</strong> on Shuttler!
      Tap the button below to confirm your email and activate your account.
    </p>
    <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.6;">
      This link expires in <strong>24 hours</strong>.
    </p>
    ${ctaButton('Verify Email Address', opts.verifyUrl)}
    ${fallbackLink(opts.verifyUrl)}
  `);
}

export function passwordResetTemplate(opts: {
  name: string;
  resetUrl: string;
  orgName: string;
}): string {
  const firstName = (opts.name.split(' ')[0] || opts.name).trim();
  return layout(`
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Reset your password</h1>
    <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.7;">
      Hi ${firstName}, we received a request to reset the password for your
      <strong>${opts.orgName}</strong> Shuttler account.
    </p>
    <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.6;">
      This link expires in <strong>1 hour</strong>.
      If you didn&rsquo;t request a reset, your password won&rsquo;t change.
    </p>
    ${ctaButton('Reset My Password', opts.resetUrl)}
    ${fallbackLink(opts.resetUrl)}
  `);
}

export function welcomeTemplate(opts: {
  name: string;
  orgName: string;
  role: string;
}): string {
  const firstName = (opts.name.split(' ')[0] || opts.name).trim();
  const roleLabel = opts.role === 'admin' ? 'administrator' : opts.role;
  return layout(`
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Welcome to ${opts.orgName}!</h1>
    <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.7;">
      Hi ${firstName}, your account is set up. You&rsquo;ve been added as a
      <strong>${roleLabel}</strong> for <strong>${opts.orgName}</strong> on Shuttler.
    </p>
    ${infoBox('Getting started', `
      <ul style="margin:0;padding:0 0 0 18px;font-size:14px;color:#374151;line-height:2.1;">
        <li>Download or open the Shuttler app</li>
        <li>Select <strong>${opts.orgName}</strong> as your organisation</li>
        <li>Sign in with your email and password</li>
      </ul>
    `)}
    <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
      Questions? Reply to this email and we&rsquo;ll get back to you.
    </p>
  `);
}

export function orgApplicationReceivedTemplate(opts: {
  contactName: string;
  orgName: string;
}): string {
  const firstName = (opts.contactName.split(' ')[0] || opts.contactName).trim();
  return layout(`
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Application received</h1>
    <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.7;">
      Hi ${firstName}, thanks for applying to use Shuttler for <strong>${opts.orgName}</strong>.
      We&rsquo;ll review your application within <strong>1 business day</strong> and email you once it&rsquo;s approved.
    </p>
    ${infoBox('While you wait', `
      <p style="margin:0;font-size:14px;color:#374151;line-height:1.8;">
        Your account is on a <strong>free trial</strong> &mdash; you can already sign in to the
        app and explore the dashboard. Paid features unlock once approved.
      </p>
    `, '#fefce8', '#fde68a', '#92400e')}
    <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
      Questions before then? Just reply to this email.
    </p>
  `);
}

export function orgApprovedTemplate(opts: {
  contactName: string;
  orgName: string;
}): string {
  const firstName = (opts.contactName.split(' ')[0] || opts.contactName).trim();
  return layout(`
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">
      Your organisation is approved &#127881;
    </h1>
    <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.7;">
      Hi ${firstName}, great news &mdash; <strong>${opts.orgName}</strong> has been approved on
      Shuttler. Your account is fully active and ready for your riders.
    </p>
    ${infoBox('Next steps', `
      <ul style="margin:0;padding:0 0 0 18px;font-size:14px;color:#374151;line-height:2.1;">
        <li>Open the admin dashboard and configure your stops &amp; routes</li>
        <li>Add your drivers and assign their default routes</li>
        <li>Share your org sign-in link with riders</li>
      </ul>
    `)}
    <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
      Need setup help? Reply to this email anytime.
    </p>
  `);
}
