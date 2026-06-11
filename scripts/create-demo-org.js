// scripts/create-demo-org.js
//
// Creates a demo org + one account per role for App Store reviewers.
// Run once; safe to re-run — it will error if the org already exists.
//
// Usage:
//   node scripts/create-demo-org.js              # dry run (preview only)
//   node scripts/create-demo-org.js --execute    # actually create
//
// Credentials are printed at the end. Save them in your App Store review notes.
//
// Requires scripts/serviceAccountKey.json (never commit this file).

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

// ── Demo org config ──────────────────────────────────────────────────────────

const ORG_ID   = 'demo-appstore';
const ORG_SLUG = 'demo-appstore';

const ORG_DOC = {
  orgId:              ORG_ID,
  name:               'Shuttler Demo',
  slug:               ORG_SLUG,
  authMethod:         'email',
  primaryColor:       '#2563eb',
  subscriptionStatus: 'active',
  reviewStatus:       'approved',
  mapCenter:          { latitude: 38.6270, longitude: -90.1994 }, // St. Louis
  mapBoundingBox: {
    ne: { latitude: 38.6370, longitude: -90.1894 },
    sw: { latitude: 38.6170, longitude: -90.2094 },
  },
  stops: [
    { id: 'stop-main',    name: 'Main Entrance',    latitude: 38.6280, longitude: -90.1994 },
    { id: 'stop-library', name: 'Library',          latitude: 38.6265, longitude: -90.2010 },
    { id: 'stop-dorms',   name: 'Residence Halls',  latitude: 38.6255, longitude: -90.1980 },
    { id: 'stop-gym',     name: 'Recreation Center', latitude: 38.6290, longitude: -90.1975 },
  ],
  routes: [
    {
      id:       'route-main',
      name:     'Campus Loop',
      color:    '#2563eb',
      stopIds:  ['stop-main', 'stop-library', 'stop-dorms', 'stop-gym'],
    },
  ],
  timezone:  'America/Chicago',
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
};

// ── Demo accounts ─────────────────────────────────────────────────────────────

const DEMO_USERS = [
  {
    email:       'demo-admin@shuttler.net',
    password:    'ShuttlerDemo2026!',
    displayName: 'Demo Admin',
    role:        'admin',
  },
  {
    email:       'demo-driver@shuttler.net',
    password:    'ShuttlerDemo2026!',
    displayName: 'Demo Driver',
    role:        'driver',
  },
  {
    email:       'demo-student@shuttler.net',
    password:    'ShuttlerDemo2026!',
    displayName: 'Demo Student',
    role:        'student',
  },
  {
    email:       'demo-parent@shuttler.net',
    password:    'ShuttlerDemo2026!',
    displayName: 'Demo Parent',
    role:        'parent',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getOrCreateAuthUser(email, password, displayName) {
  try {
    const existing = await auth.getUserByEmail(email);
    console.log(`  Auth user already exists: ${email} (${existing.uid})`);
    return existing.uid;
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would create Auth user: ${email}`);
      return `dry-run-uid-${email.split('@')[0]}`;
    }
    const user = await auth.createUser({ email, password, displayName, emailVerified: true });
    console.log(`  Created Auth user: ${email} (${user.uid})`);
    return user.uid;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(DRY_RUN
    ? '\n[DRY RUN] No changes will be made. Pass --execute to apply.\n'
    : '\n[EXECUTE] Creating demo org and accounts...\n'
  );

  // 1. Check org doesn't already exist
  const orgRef   = db.collection('orgs').doc(ORG_ID);
  const orgSnap  = await orgRef.get();
  if (orgSnap.exists) {
    console.error(`ERROR: org "${ORG_ID}" already exists. Delete it first or change ORG_ID.`);
    process.exit(1);
  }

  // 2. Create org doc
  console.log(`\nCreating org: ${ORG_DOC.name} (${ORG_ID})`);
  if (!DRY_RUN) {
    await orgRef.set(ORG_DOC);
    await db.collection('orgSlugs').doc(ORG_SLUG).set({ orgId: ORG_ID });
  } else {
    console.log(`  [DRY RUN] Would write orgs/${ORG_ID}`);
    console.log(`  [DRY RUN] Would write orgSlugs/${ORG_SLUG}`);
  }

  // 3. Create each demo user
  console.log('\nCreating demo accounts:');
  const createdUsers = [];

  for (const u of DEMO_USERS) {
    const uid = await getOrCreateAuthUser(u.email, u.password, u.displayName);

    const userDoc = {
      orgId:       ORG_ID,
      role:        u.role,
      email:       u.email,
      displayName: u.displayName,
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    };

    const publicDoc = {
      displayName: u.displayName,
      orgId:       ORG_ID,
    };

    if (!DRY_RUN) {
      await db.collection('orgs').doc(ORG_ID).collection('users').doc(uid).set(userDoc);
      await db.collection('orgs').doc(ORG_ID).collection('publicUsers').doc(uid).set(publicDoc);

      // Set orgId custom claim so the app can gate navigation immediately on login
      await auth.setCustomUserClaims(uid, { orgId: ORG_ID, role: u.role });

      console.log(`  [${u.role.padEnd(7)}] ${u.email}`);
    } else {
      console.log(`  [DRY RUN] Would create user doc for ${u.email} as ${u.role}`);
    }

    createdUsers.push({ ...u, uid });
  }

  // 4. Set ownerUid on org to the admin account
  const adminUser = createdUsers.find((u) => u.role === 'admin');
  if (adminUser && !DRY_RUN) {
    await orgRef.update({ ownerUid: adminUser.uid });
  }

  // 5. Print credentials summary
  console.log('\n' + '─'.repeat(60));
  if (DRY_RUN) {
    console.log('[DRY RUN] Nothing was written. Re-run with --execute to apply.');
  } else {
    console.log('Demo org created successfully!\n');
    console.log(`  Org ID / search slug: ${ORG_SLUG}`);
    console.log(`  Org name:             ${ORG_DOC.name}\n`);
    console.log('  App Store reviewer credentials:');
    console.log('  ' + '─'.repeat(56));
    for (const u of DEMO_USERS) {
      console.log(`  [${u.role.padEnd(7)}]  ${u.email.padEnd(30)}  ${u.password}`);
    }
    console.log('\n  All accounts use the same password: ShuttlerDemo2026!');
    console.log('\n  In the app: search for "Shuttler Demo" or enter org ID: demo-appstore');
  }
  console.log('─'.repeat(60) + '\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('\nScript failed:', err);
  process.exit(1);
});
