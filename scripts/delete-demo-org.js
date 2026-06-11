// scripts/delete-demo-org.js
//
// Completely removes the demo org created by create-demo-org.js:
//   - All Firestore subcollections under orgs/demo-appstore
//   - The org doc itself
//   - The orgSlugs lookup entry
//   - All four Firebase Auth accounts
//
// Dry-run by default — pass --execute to actually delete.
//
// Usage:
//   node scripts/delete-demo-org.js              # preview only
//   node scripts/delete-demo-org.js --execute    # for real
//
// Requires serviceAccount.json at the repo root.

const admin = require('firebase-admin');
const path  = require('path');

const DRY_RUN = !process.argv.includes('--execute');

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.join(__dirname, '../serviceAccount.json'))
  ),
});

const db   = admin.firestore();
const auth = admin.auth();

const ORG_ID   = 'demo-appstore';
const ORG_SLUG = 'demo-appstore';

const DEMO_EMAILS = [
  'demo-admin@shuttler.net',
  'demo-driver@shuttler.net',
  'demo-student@shuttler.net',
  'demo-parent@shuttler.net',
];

const SUBCOLLECTIONS = [
  'users',
  'publicUsers',
  'buses',
  'stopRequests',
  'boardingCounts',
  'announcements',
  'insights',
  'feedback',
];

const BATCH_SIZE = 400;

async function deleteCollection(collRef) {
  let total = 0;
  let snap;
  do {
    snap = await collRef.limit(BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (!DRY_RUN) await batch.commit();
    total += snap.docs.length;
  } while (snap.docs.length === BATCH_SIZE);
  return total;
}

async function main() {
  console.log(DRY_RUN
    ? '\n[DRY RUN] No changes will be made. Pass --execute to apply.\n'
    : '\n[EXECUTE] Deleting demo org...\n'
  );

  // 1. Confirm org exists
  const orgRef  = db.collection('orgs').doc(ORG_ID);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) {
    console.log(`Org "${ORG_ID}" not found — nothing to delete.`);
    process.exit(0);
  }
  console.log(`Found org: ${orgSnap.data().name} (${ORG_ID})\n`);

  // 2. Delete subcollections
  console.log('Deleting subcollections:');
  for (const col of SUBCOLLECTIONS) {
    const ref   = db.collection('orgs').doc(ORG_ID).collection(col);
    const count = await deleteCollection(ref);
    console.log(`  ${DRY_RUN ? '[DRY RUN] ' : ''}${col}: ${count} doc(s)`);
  }

  // 3. Delete org doc
  console.log(`\n${DRY_RUN ? '[DRY RUN] Would delete' : 'Deleting'} orgs/${ORG_ID}`);
  if (!DRY_RUN) await orgRef.delete();

  // 4. Delete orgSlugs entry
  console.log(`${DRY_RUN ? '[DRY RUN] Would delete' : 'Deleting'} orgSlugs/${ORG_SLUG}`);
  if (!DRY_RUN) await db.collection('orgSlugs').doc(ORG_SLUG).delete();

  // 5. Delete Firebase Auth accounts
  console.log('\nDeleting Firebase Auth accounts:');
  for (const email of DEMO_EMAILS) {
    try {
      const user = await auth.getUserByEmail(email);
      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would delete: ${email} (${user.uid})`);
      } else {
        await auth.deleteUser(user.uid);
        console.log(`  Deleted: ${email} (${user.uid})`);
      }
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        console.log(`  Not found (already gone): ${email}`);
      } else {
        throw err;
      }
    }
  }

  // 6. Summary
  console.log('\n' + '─'.repeat(60));
  if (DRY_RUN) {
    console.log('[DRY RUN] Nothing was deleted. Re-run with --execute to apply.');
  } else {
    console.log('Demo org fully deleted.');
  }
  console.log('─'.repeat(60) + '\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('\nScript failed:', err);
  process.exit(1);
});
