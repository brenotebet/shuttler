// backend/migrate-clear-stripe.js
//
// Stripe account migration helper.
//
// When billing is switched to a new Stripe account (e.g. the Tebet LLC account),
// any stripeCustomerId / stripeSubscriptionId stored on an org doc still points
// at the OLD account. Stripe then rejects portal/checkout calls with
// "No such customer", and the org can't manage or re-subscribe.
//
// This clears those stale IDs so the next checkout creates a fresh customer in
// the now-active Stripe account. By default it also resets subscriptionStatus
// to 'trialing', because an org with no Stripe customer should not present as
// 'active' (the Manage/Cancel portal button would 500). Pass --keep-status if
// you are instead recreating the subscription directly in the new Stripe
// Dashboard and will write the new IDs/status back yourself.
//
// Usage (run from the backend/ directory):
//   node migrate-clear-stripe.js <orgId>                 # dry run, by org id
//   node migrate-clear-stripe.js --slug <slug>           # dry run, by slug
//   node migrate-clear-stripe.js <orgId> --commit        # apply the change
//   node migrate-clear-stripe.js <orgId> --commit --keep-status
//
// Dry run is the default — nothing is written until you pass --commit.

const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  || path.join(__dirname, '../serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

const db = admin.firestore();

async function resolveOrgId(args) {
  const slugIdx = args.indexOf('--slug');
  if (slugIdx !== -1) {
    const slug = args[slugIdx + 1];
    if (!slug) throw new Error('--slug requires a value');
    const slugDoc = await db.collection('orgSlugs').doc(slug).get();
    if (!slugDoc.exists) throw new Error(`No org found for slug "${slug}"`);
    return slugDoc.data().orgId;
  }
  // First positional arg that isn't a flag is the orgId
  const positional = args.find((a) => !a.startsWith('--'));
  if (!positional) throw new Error('Provide an <orgId> or --slug <slug>');
  return positional;
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const keepStatus = args.includes('--keep-status');

  const orgId = await resolveOrgId(args);
  const ref = db.collection('orgs').doc(orgId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Org doc "${orgId}" not found`);

  const data = snap.data();
  console.log(`\nOrg: ${orgId} (${data.name ?? 'unnamed'})`);
  console.log(`  stripeCustomerId:     ${data.stripeCustomerId ?? '(none)'}`);
  console.log(`  stripeSubscriptionId: ${data.stripeSubscriptionId ?? '(none)'}`);
  console.log(`  subscriptionStatus:   ${data.subscriptionStatus ?? '(none)'}`);
  console.log(`  subscriptionPlan:     ${data.subscriptionPlan ?? '(none)'}`);

  const update = {
    stripeCustomerId: admin.firestore.FieldValue.delete(),
    stripeSubscriptionId: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (!keepStatus) {
    update.subscriptionStatus = 'trialing';
  }

  console.log('\nWill clear stripeCustomerId + stripeSubscriptionId' +
    (keepStatus ? ' (keeping subscriptionStatus).' : ' and reset subscriptionStatus → trialing.'));

  if (!commit) {
    console.log('\nDry run — no changes written. Re-run with --commit to apply.\n');
    return;
  }

  await ref.update(update);
  console.log('\n✅ Done. The org can now re-subscribe in the active Stripe account.\n');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('\n❌', e.message ?? e);
  process.exit(1);
});
