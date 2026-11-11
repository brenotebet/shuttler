// backend/report-trial-expiry.js
//
// Read-only pre-deploy check for trial-expiry enforcement. Lists every org
// still on the free trial ('trialing') and whether its trialEndsAt has passed.
// Once the trial-expiry rules deploy, an EXPIRED org's buses go offline and its
// riders see the "Free Trial Ended" screen, so look at this list first and, for
// any live customer (e.g. McKendree) that should keep running, either move it
// to a real subscription or extend its trial in the super-admin panel.
//
// Run from the backend/ directory:
//   node report-trial-expiry.js
//
// Writes nothing.

const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  || path.join(__dirname, '../serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

async function main() {
  const snap = await admin.firestore().collection('orgs').where('subscriptionStatus', '==', 'trialing').get();
  const now = Date.now();
  const rows = snap.docs.map((d) => {
    const o = d.data();
    const endsMs = o.trialEndsAt?.toMillis?.() ?? null;
    const state = endsMs === null ? 'no end date (never expires)'
      : endsMs <= now ? `EXPIRED ${Math.floor((now - endsMs) / 86_400_000)}d ago`
      : `ends in ${Math.ceil((endsMs - now) / 86_400_000)}d`;
    return { endsMs, line: `${o.name ?? d.id} (${o.slug ?? d.id}) · approved=${o.approved === true} · ${state}` };
  });
  rows.sort((a, b) => (a.endsMs ?? Infinity) - (b.endsMs ?? Infinity));

  console.log(`${rows.length} org(s) on the free trial:\n`);
  for (const r of rows) console.log(`  ${r.line}`);
  const expired = rows.filter((r) => r.endsMs !== null && r.endsMs <= now).length;
  console.log(`\n${expired} would be locked out as soon as the new rules deploy.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
