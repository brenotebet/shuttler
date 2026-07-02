// backend/backfill-owner-uid.js
//
// One-time script: sets the `ownerUid` field on every org doc that is missing
// it. The owner is resolved in this priority order:
//   1. The Auth user whose email matches the org's `founderEmail`
//   2. The first entry in the org's `adminUids` array
//   3. The earliest-created admin in the org's `users` subcollection
//
// Why: `ownerUid` is only written at founder registration time. Orgs created
// before that logic existed (or whose founder never re-registered) have no
// ownerUid, which means the in-app "Delete Organization" danger zone falls back
// to permissive admin gating. Backfilling ownerUid makes ownership explicit.
//
// Run from the backend/ directory:
//   node backfill-owner-uid.js            # DRY RUN — prints what it would do
//   node backfill-owner-uid.js --execute  # actually writes the changes
//
// Safe to re-run — orgs that already have ownerUid are skipped.

const admin = require('firebase-admin');
const path = require('path');

const DRY_RUN = !process.argv.includes('--execute');

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  || path.join(__dirname, '../serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

async function resolveOwnerUid(db, auth, orgId, data) {
  // 1. founderEmail → Auth lookup
  const founderEmail = (data.founderEmail || '').trim().toLowerCase();
  if (founderEmail) {
    try {
      const user = await auth.getUserByEmail(founderEmail);
      return { uid: user.uid, source: `founderEmail (${founderEmail})` };
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err;
      // fall through to next strategy
    }
  }

  // 2. first adminUids entry
  if (Array.isArray(data.adminUids) && data.adminUids.length > 0) {
    return { uid: data.adminUids[0], source: 'adminUids[0]' };
  }

  // 3. earliest admin in users subcollection
  const usersSnap = await db.collection('orgs').doc(orgId).collection('users')
    .where('role', '==', 'admin')
    .get();
  if (!usersSnap.empty) {
    let earliest = null;
    for (const u of usersSnap.docs) {
      const createdAt = u.data().createdAt;
      const ms = createdAt && typeof createdAt.toMillis === 'function'
        ? createdAt.toMillis()
        : Number.POSITIVE_INFINITY;
      if (!earliest || ms < earliest.ms) {
        earliest = { uid: u.id, ms };
      }
    }
    if (earliest) {
      return { uid: earliest.uid, source: 'users subcollection (earliest admin)' };
    }
  }

  return null;
}

async function run() {
  const db = admin.firestore();
  const auth = admin.auth();
  const snap = await db.collection('orgs').get();

  if (snap.empty) {
    console.log('No orgs found.');
    process.exit(0);
  }

  console.log(`Found ${snap.size} org(s). ${DRY_RUN ? 'DRY RUN — no writes will be made.' : 'EXECUTING writes.'}\n`);

  let updated = 0;
  let skipped = 0;
  let unresolved = 0;

  const BATCH_SIZE = 500;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const label = data.name ?? 'unnamed';

    if (data.ownerUid) {
      console.log(`  SKIP   ${doc.id} (${label}) — ownerUid already set (${data.ownerUid})`);
      skipped++;
      continue;
    }

    let resolved;
    try {
      resolved = await resolveOwnerUid(db, auth, doc.id, data);
    } catch (err) {
      console.log(`  ERROR  ${doc.id} (${label}) — ${err.message}`);
      unresolved++;
      continue;
    }

    if (!resolved) {
      console.log(`  MISS   ${doc.id} (${label}) — could not resolve an owner (no founderEmail, adminUids, or admin users)`);
      unresolved++;
      continue;
    }

    console.log(`  SET    ${doc.id} (${label}) — ownerUid=${resolved.uid} via ${resolved.source}`);
    updated++;

    if (!DRY_RUN) {
      batch.update(doc.ref, {
        ownerUid: resolved.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      batchCount++;
      if (batchCount === BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }
  }

  if (!DRY_RUN && batchCount > 0) {
    await batch.commit();
  }

  console.log(`\nDone. ${updated} ${DRY_RUN ? 'would be updated' : 'updated'}, ${skipped} already set, ${unresolved} unresolved.`);
  if (DRY_RUN && updated > 0) {
    console.log('\nRe-run with --execute to apply these changes.');
  }
  process.exit(0);
}

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
