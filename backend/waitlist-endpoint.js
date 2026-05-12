// ─────────────────────────────────────────────
//  Shuttler Waitlist Endpoint
//  Drop this into your existing Express server
//  (or require it as a router)
// ─────────────────────────────────────────────
//
//  Required env vars (add to your .env):
//
//    RESEND_API_KEY=re_xxxxxxxxxxxx
//    FIREBASE_DATABASE_URL=https://YOUR_FIREBASE_PROJECT_ID-default-rtdb.firebaseio.com
//    FIREBASE_SERVICE_ACCOUNT=./serviceAccountKey.json   ← path to your downloaded key
//
// ─────────────────────────────────────────────

const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');

// ── Firebase init (safe to call multiple times — checks if already initialised) ──
if (!admin.apps.length) {
  const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT || './serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const db = admin.database();

// ── Simple email validator ──
const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).toLowerCase().trim());

// ─────────────────────────────────────────────
//  POST /api/waitlist
// ─────────────────────────────────────────────
router.post('/api/waitlist', async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();

  // ── Validate ──
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }

  try {
    // ── 1. Check for duplicates ──
    const snapshot = await db
      .ref('waitlist')
      .orderByChild('email')
      .equalTo(email)
      .once('value');

    if (snapshot.exists()) {
      return res.status(409).json({ error: 'already_registered' });
    }

    // ── 2. Write to Firebase ──
    const entry = {
      email,
      submittedAt: new Date().toISOString(),
      source: req.body?.source || 'website',
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null,
    };

    await db.ref('waitlist').push(entry);

    // ── 3. Send Resend notification to you ──
    await sendResendNotification(email);

    // ── 4. Send confirmation email to the user ──
    await sendResendConfirmation(email);

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[waitlist] Error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─────────────────────────────────────────────
//  Resend: notify YOU of a new signup
// ─────────────────────────────────────────────
async function sendResendNotification(email) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Shuttler Waitlist <waitlist@shuttler.net>',
      to: ['brenotebet@live.com'],
      subject: `🚌 New waitlist signup — ${email}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:24px;">
            <div style="width:10px;height:10px;border-radius:50%;background:#2DD68A;"></div>
            <span style="font-size:18px; font-weight:600;">Shuttler</span>
          </div>
          <h2 style="font-size:22px; font-weight:400; margin-bottom:8px;">New waitlist signup</h2>
          <p style="color:#666; margin-bottom:24px;">Someone just joined the Shuttler waitlist.</p>
          <div style="background:#f5f5f8; border-radius:10px; padding:20px 24px; margin-bottom:24px;">
            <p style="margin:0; font-size:13px; color:#888; font-family:monospace; letter-spacing:.05em; margin-bottom:4px;">EMAIL</p>
            <p style="margin:0; font-size:18px; font-weight:500;">${email}</p>
          </div>
          <p style="color:#888; font-size:13px;">Submitted at ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT</p>
          <p style="color:#888; font-size:13px;">View all leads in your <a href="https://console.firebase.google.com" style="color:#7B5CF0;">Firebase console</a> under <code>waitlist/</code>.</p>
        </div>
      `,
    }),
  });
  if (!res.ok) console.error('[waitlist] Resend notification failed:', await res.text());
}

// ─────────────────────────────────────────────
//  Resend: confirm to the USER they're on the list
// ─────────────────────────────────────────────
async function sendResendConfirmation(email) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Breno at Shuttler <breno@shuttler.net>',
      to: [email],
      subject: `You're on the Shuttler waitlist ✓`,
      html: `
        <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 32px; background:#08080f; color:#f0f0f8; border-radius:16px;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:32px;">
            <div style="width:10px;height:10px;border-radius:50%;background:#2DD68A;"></div>
            <span style="font-size:18px; font-weight:600; color:#f0f0f8;">Shuttler.</span>
          </div>
          <h1 style="font-size:28px; font-weight:300; letter-spacing:-0.02em; margin-bottom:16px; color:#f0f0f8;">You're on the list.</h1>
          <p style="color:#8888a8; font-size:16px; line-height:1.7; margin-bottom:28px;">
            Thanks for your interest in Shuttler. I'll reach out personally when we're ready to onboard your institution — no mass emails, just a real conversation.
          </p>
          <div style="background:#0e0e1a; border:1px solid rgba(255,255,255,0.07); border-radius:10px; padding:20px 24px; margin-bottom:28px;">
            <p style="margin:0; font-size:13px; color:#555570; font-family:monospace; letter-spacing:.08em; text-transform:uppercase; margin-bottom:8px;">What happens next</p>
            <p style="margin:0 0 8px; font-size:14px; color:#8888a8;">→ I review your submission and reach out directly.</p>
            <p style="margin:0 0 8px; font-size:14px; color:#8888a8;">→ We schedule a short call to understand your operation.</p>
            <p style="margin:0; font-size:14px; color:#8888a8;">→ You get early access + locked-in founder pricing.</p>
          </div>
          <p style="color:#555570; font-size:13px; margin-bottom:4px;">In the meantime, feel free to reply to this email with any questions.</p>
          <p style="color:#555570; font-size:13px;">— Breno, Founder of Shuttler</p>
          <div style="margin-top:32px; padding-top:24px; border-top:1px solid rgba(255,255,255,0.06);">
            <a href="https://shuttler.net" style="color:#7B5CF0; font-size:13px; text-decoration:none;">shuttler.net</a>
          </div>
        </div>
      `,
    }),
  });
  if (!res.ok) console.error('[waitlist] Resend confirmation failed:', await res.text());
}

module.exports = router;
