// scripts/reset-firestore.js
//
// Pre-launch cleanup: batch-deletes all documents in buses, stopRequests,
// boardingCounts, and publicUsers for a given org.
//
// Usage:
//   node scripts/reset-firestore.js <orgId>
//   DRY_RUN=true node scripts/reset-firestore.js <orgId>
//
// Requires scripts/serviceAccountKey.json (do NOT commit this file).

const admin = require('firebase-admin');
const path = require('path');

const KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');
const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 400;
const ABORT_DELAY_MS = 5000;

const orgId = process.argv[2];
if (!orgId) {
  console.error('Usage: node scripts/reset-firestore.js <orgId>');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const COLLECTIONS = ['buses', 'stopRequests', 'boardingCounts', 'publicUsers'];

async function deleteCollection(collRef) {
  let total = 0;
  let snap;
  do {
    snap = await collRef.limit(BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    if (!DRY_RUN) await batch.commit();
    total += snap.docs.length;
    console.log(`  deleted ${total} docs so far…`);
  } while (snap.docs.length === BATCH_SIZE);
  return total;
}

async function main() {
  console.log(`\n🎯 Target org: ${orgId}`);
  console.log(`📋 Collections: ${COLLECTIONS.join(', ')}`);
  if (DRY_RUN) {
    console.log('🟡 DRY RUN — no documents will be deleted.\n');
  } else {
    console.log(`\n⚠️  This will permanently delete data. Starting in ${ABORT_DELAY_MS / 1000}s…`);
    console.log('   Press Ctrl+C to abort.\n');
    await new Promise((r) => setTimeout(r, ABORT_DELAY_MS));
  }

  for (const col of COLLECTIONS) {
    const ref = db.collection(`orgs/${orgId}/${col}`);
    console.log(`Clearing ${col}…`);
    const count = await deleteCollection(ref);
    console.log(`  ✓ ${count} docs ${DRY_RUN ? '(dry run)' : 'deleted'}\n`);
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
