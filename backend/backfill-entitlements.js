// backend/backfill-entitlements.js
//
// One-time script: sets the `entitlements` field on every org doc based on
// their current subscriptionPlan + dataAddonActive values.
//
// Run from the backend/ directory:
//   node backfill-entitlements.js
//
// Safe to re-run — it overwrites entitlements with the correct computed value
// each time, so running it twice is harmless.

const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  || path.join(__dirname, '../serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

function computeEntitlements(plan, dataAddonActive) {
  const dataUnlocked = dataAddonActive || plan === 'enterprise';
  return {
    aiAssistant: true,
    basicExport: true,
    dataApi: dataUnlocked,
    extendedRetention: dataUnlocked,
    scheduledExports: dataUnlocked,
  };
}

async function run() {
  const db = admin.firestore();
  const snap = await db.collection('orgs').get();

  if (snap.empty) {
    console.log('No orgs found.');
    process.exit(0);
  }

  console.log(`Found ${snap.size} org(s). Backfilling entitlements...\n`);

  let updated = 0;
  let skipped = 0;

  const BATCH_SIZE = 500;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const plan = data.subscriptionPlan ?? 'starter';
    const dataAddonActive = data.dataAddonActive ?? false;
    const entitlements = computeEntitlements(plan, dataAddonActive);

    const existing = data.entitlements;
    const alreadyCorrect = existing &&
      existing.aiAssistant === entitlements.aiAssistant &&
      existing.basicExport === entitlements.basicExport &&
      existing.dataApi === entitlements.dataApi &&
      existing.extendedRetention === entitlements.extendedRetention &&
      existing.scheduledExports === entitlements.scheduledExports;

    if (alreadyCorrect) {
      console.log(`  SKIP  ${doc.id} (${data.name ?? 'unnamed'}) — entitlements already correct`);
      skipped++;
      continue;
    }

    batch.update(doc.ref, {
      entitlements,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batchCount++;
    updated++;

    console.log(`  SET   ${doc.id} (${data.name ?? 'unnamed'}) — plan=${plan} dataAddon=${dataAddonActive} → dataApi=${entitlements.dataApi}`);

    if (batchCount === BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`\nDone. ${updated} updated, ${skipped} already correct.`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
