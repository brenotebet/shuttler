// backend/wipe-non-admin-users.js
//
// Removes all non-admin users from every org:
//   - Deletes their Firestore user doc (orgs/{orgId}/users/{uid})
//   - Deletes their public profile (orgs/{orgId}/publicUsers/{uid})
//   - Deletes their Firebase Auth account (so they can't just sign back in)
//
// Admins (role === 'admin') and superAdmins are always preserved.
// A UID is only removed from Firebase Auth if it has no admin role in any org.
// Stop requests and other historical records are left untouched.
//
// Dry-run by default — pass --execute to actually delete:
//   node wipe-non-admin-users.js              # preview only
//   node wipe-non-admin-users.js --execute    # for real
//
// Run from the backend/ directory.

const admin = require('firebase-admin');
const path = require('path');

const DRY_RUN = !process.argv.includes('--execute');

const serviceAccountPath =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
  path.join(__dirname, '../serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

const db = admin.firestore();
const BATCH_SIZE = 400; // stay safely under the 500-op Firestore limit

async function commitBatch(batch, count) {
  if (count === 0) return;
  if (!DRY_RUN) await batch.commit();
}

async function run() {
  console.log(DRY_RUN
    ? '\n[DRY RUN] No changes will be made. Pass --execute to apply.\n'
    : '\n[EXECUTE] Deleting users...\n'
  );

  const orgsSnap = await db.collection('orgs').get();
  if (orgsSnap.empty) {
    console.log('No orgs found.');
    process.exit(0);
  }

  // First pass: collect admin UIDs across ALL orgs so we never delete
  // a Firebase Auth account that still has an admin role somewhere.
  const adminUids = new Set();
  const toDeleteByOrg = []; // [{ orgId, orgName, docs: [...] }]

  for (const orgDoc of orgsSnap.docs) {
    const orgId = orgDoc.id;
    const orgName = orgDoc.data().name ?? orgId;

    const usersSnap = await db.collection('orgs').doc(orgId).collection('users').get();
    if (usersSnap.empty) continue;

    for (const d of usersSnap.docs) {
      if (d.data().role === 'admin') adminUids.add(d.id);
    }

    const toDelete = usersSnap.docs.filter((d) => d.data().role !== 'admin');
    const kept = usersSnap.docs.filter((d) => d.data().role === 'admin');

    toDeleteByOrg.push({ orgId, orgName, toDelete, kept });
  }

  // Second pass: delete Firestore docs per org.
  let totalFirestoreDeleted = 0;
  let totalKept = 0;
  const authUidsToDelete = new Set(); // UIDs with no admin role in any org

  for (const { orgId, orgName, toDelete, kept } of toDeleteByOrg) {
    console.log(`\n  ${orgName} (${orgId})`);
    console.log(`    Keeping  (${kept.length} admin${kept.length !== 1 ? 's' : ''}): ${kept.map((d) => d.data().email ?? d.id).join(', ') || 'none'}`);
    console.log(`    Deleting (${toDelete.length}): ${toDelete.map((d) => `${d.data().email ?? d.id} [${d.data().role ?? 'no role'}]`).join(', ') || 'none'}`);

    totalKept += kept.length;

    if (toDelete.length === 0) continue;

    let batch = db.batch();
    let batchCount = 0;

    for (const userDoc of toDelete) {
      const uid = userDoc.id;

      batch.delete(db.collection('orgs').doc(orgId).collection('users').doc(uid));
      batch.delete(db.collection('orgs').doc(orgId).collection('publicUsers').doc(uid));
      batchCount += 2;

      // Only queue for Auth deletion if not an admin in any org.
      if (!adminUids.has(uid)) authUidsToDelete.add(uid);

      if (batchCount >= BATCH_SIZE) {
        await commitBatch(batch, batchCount);
        batch = db.batch();
        batchCount = 0;
      }
    }

    await commitBatch(batch, batchCount);
    totalFirestoreDeleted += toDelete.length;
  }

  // Third pass: delete Firebase Auth accounts in batches of 1000.
  const authUids = [...authUidsToDelete];
  console.log(`\n  Firebase Auth: deleting ${authUids.length} account(s)...`);

  let authDeleted = 0;
  let authFailed = 0;

  for (let i = 0; i < authUids.length; i += 1000) {
    const chunk = authUids.slice(i, i + 1000);
    if (DRY_RUN) {
      console.log(`    [DRY RUN] Would delete Auth UIDs: ${chunk.join(', ')}`);
      authDeleted += chunk.length;
    } else {
      const result = await admin.auth().deleteUsers(chunk);
      authDeleted += result.successCount;
      authFailed += result.failureCount;
      if (result.errors.length > 0) {
        for (const err of result.errors) {
          console.warn(`    WARN: failed to delete Auth UID ${chunk[err.index]}: ${err.error.message}`);
        }
      }
    }
  }

  // Summary
  console.log(`\n${'─'.repeat(50)}`);
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would delete ${totalFirestoreDeleted} user membership(s) and ${authDeleted} Firebase Auth account(s).`);
    console.log(`          Would keep ${totalKept} admin(s).`);
    console.log('\nRe-run with --execute to apply.\n');
  } else {
    console.log(`Done.`);
    console.log(`  Firestore memberships deleted: ${totalFirestoreDeleted}`);
    console.log(`  Firebase Auth accounts deleted: ${authDeleted}${authFailed > 0 ? ` (${authFailed} failed — see warnings above)` : ''}`);
    console.log(`  Admins preserved: ${totalKept}\n`);
  }

  process.exit(0);
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
