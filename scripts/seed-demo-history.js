// scripts/seed-demo-history.js
//
// Seeds ~3 weeks of plausible ridership history into the App Store demo org
// so Analytics (wait times, busiest hours, boardings) and CSV exports have
// real content for reviewers. Idempotent-ish: refuses to run if the org
// already has boardingCounts docs, so it won't stack duplicate history.
//
// Usage (from repo root):
//   node scripts/seed-demo-history.js              # dry run (prints plan)
//   node scripts/seed-demo-history.js --execute    # actually write
//
// Only ever writes to ORG_ID below. Safe to re-run after delete-demo-org.

const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  || path.join(__dirname, '../serviceAccount.json');

admin.initializeApp({ credential: admin.credential.cert(require(serviceAccountPath)) });
const db = admin.firestore();

const ORG_ID = 'demo-appstore';
const DAYS = 21;

const STOPS = [
  { id: 'stop-main',    name: 'Main Entrance',    latitude: 38.6280, longitude: -90.1994 },
  { id: 'stop-library', name: 'Library',          latitude: 38.6265, longitude: -90.2010 },
  { id: 'stop-dorms',   name: 'Residence Halls',  latitude: 38.6255, longitude: -90.1980 },
  { id: 'stop-gym',     name: 'Recreation Center', latitude: 38.6290, longitude: -90.1975 },
];

// Campus rhythm: busy at class-change hours, quiet middays/weekends.
const HOUR_WEIGHTS = { 8: 4, 9: 3, 10: 2, 12: 3, 13: 2, 15: 3, 17: 4, 18: 2, 21: 1 };

function rand(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rand(arr.length)]; }

async function main() {
  const execute = process.argv.includes('--execute');

  const orgRef = db.collection('orgs').doc(ORG_ID);
  const org = await orgRef.get();
  if (!org.exists) throw new Error(`Org ${ORG_ID} not found — run create-demo-org.js first`);

  const existing = await orgRef.collection('boardingCounts').limit(1).get();
  if (!existing.empty) throw new Error('Demo org already has boarding history — aborting to avoid duplicates.');

  const driverUid = (await admin.auth().getUserByEmail('demo-driver@shuttler.net')).uid;
  const studentUid = (await admin.auth().getUserByEmail('demo-student@shuttler.net')).uid;

  const boardings = [];
  const requests = [];
  const now = new Date();

  for (let day = DAYS; day >= 1; day--) {
    const d = new Date(now.getTime() - day * 24 * 3600 * 1000);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    for (const [hour, weight] of Object.entries(HOUR_WEIGHTS)) {
      const runs = weekend ? (rand(2) ? 0 : 1) : 1 + rand(weight);
      for (let i = 0; i < runs; i++) {
        const stop = pick(STOPS);
        const t = new Date(d); t.setHours(Number(hour), rand(55), 0, 0);
        boardings.push({
          driverUid,
          stopId: stop.id, stopName: stop.name,
          stopLat: stop.latitude, stopLng: stop.longitude,
          count: 1 + rand(6),
          completedRequestIds: [],
          createdAt: admin.firestore.Timestamp.fromDate(t),
        });
        // ~40% of runs originate from an in-app stop request
        if (rand(10) < 4) {
          const created = new Date(t.getTime() - (4 + rand(11)) * 60 * 1000);
          const cancelled = rand(10) === 0; // ~10% cancelled by rider
          requests.push({
            orgId: ORG_ID,
            studentUid,
            studentEmail: 'demo-student@shuttler.net',
            stopId: stop.id,
            stop: { id: stop.id, name: stop.name, latitude: stop.latitude, longitude: stop.longitude },
            status: cancelled ? 'cancelled' : 'completed',
            driverUid,
            routeId: 'route-campus-loop',
            createdAt: admin.firestore.Timestamp.fromDate(created),
            ...(cancelled
              ? { cancelledAt: admin.firestore.Timestamp.fromDate(t), cancelledReason: 'student_cancelled' }
              : { arrivedAt: admin.firestore.Timestamp.fromDate(t), completedAt: admin.firestore.Timestamp.fromDate(t) }),
          });
        }
      }
    }
  }

  console.log(`Plan: ${boardings.length} boardingCounts + ${requests.length} stopRequests over ${DAYS} days`);
  if (!execute) { console.log('Dry run — re-run with --execute to write.'); return; }

  let batch = db.batch(); let ops = 0;
  const flush = async () => { await batch.commit(); batch = db.batch(); ops = 0; };
  for (const b of boardings) {
    batch.set(orgRef.collection('boardingCounts').doc(), b);
    if (++ops >= 450) await flush();
  }
  for (const r of requests) {
    batch.set(orgRef.collection('stopRequests').doc(), r);
    if (++ops >= 450) await flush();
  }
  if (ops) await batch.commit();
  console.log('✅ Seeded demo ridership history.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message ?? e); process.exit(1); });
