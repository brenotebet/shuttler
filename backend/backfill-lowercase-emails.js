// backend/backfill-lowercase-emails.js
//
// One-time script: lowercases the `email` field on every org member doc
// (orgs/{orgId}/users/{uid}) that has uppercase letters in it.
//
// Why: the backend now writes member emails lowercase, and /saml/exchange
// matches an SSO sign-in to the person's pre-SSO account (to carry over their
// admin/driver role) by email. A member who registered as "John@school.edu"
// wouldn't match an IdP that sends "john@school.edu" until their stored email
// is normalized.
//
// Run from the backend/ directory:
//   node backfill-lowercase-emails.js            # DRY RUN — prints what it would do
//   node backfill-lowercase-emails.js --execute  # actually writes the changes
//
// Safe to re-run — docs whose email is already lowercase are skipped.

const admin = require('firebase-admin');
const path = require('path');

const DRY_RUN = !process.argv.includes('--execute');

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  || path.join(__dirname, '../serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

async function run() {
  const db = admin.firestore();
  const orgsSnap = await db.collection('orgs').get();

  if (orgsSnap.empty) {
    console.log('No orgs found.');
    process.exit(0);
  }

  console.log(`Found ${orgsSnap.size} org(s). ${DRY_RUN ? 'DRY RUN — no writes will be made.' : 'EXECUTING writes.'}\n`);

  let updated = 0;
  let scanned = 0;

  const BATCH_SIZE = 500;
  let batch = db.batch();
  let batchCount = 0;

  for (const orgDoc of orgsSnap.docs) {
    const label = orgDoc.data().name ?? 'unnamed';
    const usersSnap = await orgDoc.ref.collection('users').get();

    for (const userDoc of usersSnap.docs) {
      scanned++;
      const email = userDoc.data().email;
      if (typeof email !== 'string') continue;
      const normalized = email.trim().toLowerCase();
      if (normalized === email) continue;

      console.log(`  SET    ${orgDoc.id} (${label}) / ${userDoc.id} — "${email}" → "${normalized}"`);
      updated++;

      if (!DRY_RUN) {
        batch.update(userDoc.ref, { email: normalized });
        batchCount++;
        if (batchCount === BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }
  }

  if (!DRY_RUN && batchCount > 0) {
    await batch.commit();
  }

  console.log(`\nDone. Scanned ${scanned} member doc(s); ${updated} ${DRY_RUN ? 'would be updated' : 'updated'}.`);
  if (DRY_RUN && updated > 0) {
    console.log('Re-run with --execute to apply.');
  }
  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
