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
        <li>Select <strong>${opts.orgName}</strong> as your organization</li>
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

export function orgRejectedTemplate(opts: {
  contactName: string;
  orgName: string;
  reason?: string | null;
}): string {
  const firstName = (opts.contactName.split(' ')[0] || opts.contactName).trim();
  return layout(`
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">
      Application update for ${opts.orgName}
    </h1>
    <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.7;">
      Hi ${firstName}, thank you for applying to Shuttler. After reviewing your application
      for <strong>${opts.orgName}</strong>, we&rsquo;re unable to approve it at this time.
    </p>
    ${opts.reason ? infoBox('Reason', `<p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">${opts.reason}</p>`, '#fef2f2', '#fecaca', '#991b1b') : ''}
    <p style="margin:0 0 16px;font-size:14px;color:#6b7280;line-height:1.7;">
      If you believe this is a mistake or would like to discuss your application, please
      reply to this email and we&rsquo;ll get back to you.
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
      Your organization is approved &#127881;
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

export function subscriptionConfirmedTemplate(opts: {
  contactName: string;
  orgName: string;
  planLabel: string;
  amount: string;
}): string {
  const firstName = (opts.contactName.split(' ')[0] || opts.contactName).trim();
  return layout(`
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">
      Payment confirmed &#9989;
    </h1>
    <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.7;">
      Hi ${firstName}, your <strong>${opts.planLabel}</strong> subscription for
      <strong>${opts.orgName}</strong> is now active. Thank you for subscribing to Shuttler!
    </p>
    ${infoBox('Subscription details', `
      <table cellpadding="0" cellspacing="0" style="width:100%;">
        <tr>
          <td style="font-size:14px;color:#6b7280;padding:4px 0;">Plan</td>
          <td style="font-size:14px;color:#111827;font-weight:600;text-align:right;">${opts.planLabel}</td>
        </tr>
        <tr>
          <td style="font-size:14px;color:#6b7280;padding:4px 0;">Organisation</td>
          <td style="font-size:14px;color:#111827;font-weight:600;text-align:right;">${opts.orgName}</td>
        </tr>
        <tr>
          <td style="font-size:14px;color:#6b7280;padding:4px 0;">Amount</td>
          <td style="font-size:14px;color:#111827;font-weight:600;text-align:right;">${opts.amount}/month</td>
        </tr>
      </table>
    `)}
    <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
      You can manage your subscription, update payment details, or view invoices from the
      Billing tab in the app. Questions? Reply to this email anytime.
    </p>
  `);
}

export function weeklyDigestTemplate(opts: {
  adminName: string;
  orgName: string;
  totalBoardings: number;
  activeDrivers: number;
  topStop: string | null;
  narrative: string;
}): string {
  const firstName = (opts.adminName.split(' ')[0] || opts.adminName).trim();
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const topStopLabel = opts.topStop ? opts.topStop.split(' (')[0].trim() : '&mdash;';

  return layout(`
    <h1 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111827;">Your weekly summary</h1>
    <p style="margin:0 0 24px;font-size:13px;color:#9ca3af;">Week ending ${today}</p>
    <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.7;">
      Hi ${firstName}, here&rsquo;s what happened at <strong>${opts.orgName}</strong> this week.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-collapse:separate;border-spacing:8px 0;">
      <tr>
        <td style="width:33%;vertical-align:top;">
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 12px;text-align:center;">
            <p style="margin:0;font-size:30px;font-weight:800;color:${PRIMARY};">${opts.totalBoardings}</p>
            <p style="margin:6px 0 0;font-size:11px;color:#166534;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Boardings</p>
          </div>
        </td>
        <td style="width:33%;vertical-align:top;">
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px 12px;text-align:center;">
            <p style="margin:0;font-size:30px;font-weight:800;color:#2563eb;">${opts.activeDrivers}</p>
            <p style="margin:6px 0 0;font-size:11px;color:#1d4ed8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Active Drivers</p>
          </div>
        </td>
        <td style="width:33%;vertical-align:top;">
          <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:16px 12px;text-align:center;">
            <p style="margin:0;font-size:13px;font-weight:700;color:#7c3aed;line-height:1.4;">${topStopLabel}</p>
            <p style="margin:6px 0 0;font-size:11px;color:#6d28d9;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Top Stop</p>
          </div>
        </td>
      </tr>
    </table>

    ${opts.narrative ? infoBox('AI Insights', `<p style="margin:0;font-size:14px;color:#374151;line-height:1.8;">${opts.narrative}</p>`) : ''}

    <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;line-height:1.6;">
      View full analytics in the Shuttler app under <strong>Dashboard</strong>.
      Questions? Reply to this email anytime.
    </p>
  `);
}
