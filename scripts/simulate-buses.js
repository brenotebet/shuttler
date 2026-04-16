#!/usr/bin/env node
// scripts/simulate-buses.js
//
// Simulates shuttle buses using your org's actual stops + real road geometry.
// Reads orgs/{ORG_ID} at startup, routes buses along actual streets via OSRM.
//
// Usage:
//   ORG_ID=your-org-id node scripts/simulate-buses.js
//   ORG_ID=your-org-id SPEED=3 node scripts/simulate-buses.js   # 3x speed
//   ORG_ID=your-org-id BUSES=5 node scripts/simulate-buses.js   # 5 buses
//
// Requirements:
//   - serviceAccount.json in project root  (or FIREBASE_SERVICE_ACCOUNT_JSON env var)
//   - Node 18+ (uses built-in fetch)

'use strict';

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const ORG_ID = process.env.ORG_ID;
if (!ORG_ID) {
  console.error('ERROR: ORG_ID environment variable is required.');
  process.exit(1);
}

const SPEED           = parseFloat(process.env.SPEED ?? '1');
const BUS_COUNT       = parseInt(process.env.BUSES  ?? '3');
const UPDATE_INTERVAL = 1000;

// ── Firebase init ─────────────────────────────────────────────────────────────

const SA_PATH = path.join(__dirname, '..', 'serviceAccount.json');
const SA_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (admin.apps.length === 0) {
  if (SA_JSON) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA_JSON)) });
  } else if (fs.existsSync(SA_PATH)) {
    admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
  } else {
    console.error('ERROR: serviceAccount.json not found in project root.');
    process.exit(1);
  }
}

const db = admin.firestore();

// ── Road routing via OSRM (free, no API key) ──────────────────────────────────

async function fetchRoadSegment(from, to) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.longitude},${from.latitude};${to.longitude},${to.latitude}` +
    `?overview=full&geometries=geojson`;

  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    if (!json.routes?.length) return null;
    return json.routes[0].geometry.coordinates.map(([lng, lat]) => ({
      latitude: lat,
      longitude: lng,
    }));
  } catch {
    return null;
  }
}

async function buildRoadPath(stops) {
  const points = [];
  for (let i = 0; i < stops.length; i++) {
    const from = stops[i];
    const to   = stops[(i + 1) % stops.length];
    process.stdout.write(`  Routing ${from.name} → ${to.name}... `);
    const seg = await fetchRoadSegment(from, to);
    if (seg && seg.length > 0) {
      console.log(`${seg.length} pts`);
      points.push(...seg);
    } else {
      console.log('fallback (straight line)');
      points.push({ latitude: from.latitude, longitude: from.longitude });
    }
  }
  return points;
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

async function writeBus(bus) {
  const c = bus.path[bus.index];
  await db.doc(`orgs/${ORG_ID}/buses/${bus.id}`).set(
    {
      driverUid: bus.id,
      latitude:  c.latitude,
      longitude: c.longitude,
      online:    true,
      lastSeen:  admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      routeId:   bus.routeId ?? null,
    },
    { merge: true },
  );
}

async function takeBusOffline(bus) {
  await db.doc(`orgs/${ORG_ID}/buses/${bus.id}`).set(
    { online: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  );
}

// ── Load org config ───────────────────────────────────────────────────────────

async function loadActiveBuses() {
  const orgSnap = await db.doc(`orgs/${ORG_ID}`).get();
  if (!orgSnap.exists) {
    console.error(`ERROR: Org "${ORG_ID}" not found.`);
    process.exit(1);
  }

  const org    = orgSnap.data();
  const stops  = org.stops  ?? [];
  const routes = org.routes ?? [];

  if (stops.length < 2) {
    console.error(`ERROR: Org needs at least 2 stops (found ${stops.length}).`);
    process.exit(1);
  }

  console.log(`\nStops: ${stops.map(s => s.name).join(' → ')}`);

  const stopById = new Map(stops.map(s => [s.id, s]));

  // Build one road path per route (or one shared path if no routes)
  const routeDefs = routes.length > 0
    ? routes.map(r => ({
        routeId:   r.id,
        routeName: r.name,
        stops:     (r.stopIds ?? []).map(id => stopById.get(id)).filter(Boolean),
      })).filter(r => r.stops.length >= 2)
    : [{ routeId: null, routeName: 'Loop', stops }];

  // Fetch road geometry for each route
  const paths = [];
  for (const rd of routeDefs) {
    console.log(`\nBuilding road path for "${rd.routeName}":`);
    const path = await buildRoadPath(rd.stops);
    paths.push({ ...rd, path });
  }

  // Spread BUS_COUNT buses evenly across routes, staggered within each route
  const activeBuses = [];
  for (let i = 0; i < BUS_COUNT; i++) {
    const rd          = paths[i % paths.length];
    const busesOnPath = paths.filter((_, j) => j % paths.length === i % paths.length).length;
    const slotInPath  = Math.floor(i / paths.length);
    const phaseOffset = slotInPath / Math.ceil(BUS_COUNT / paths.length);
    const startIdx    = Math.floor(phaseOffset * rd.path.length) % rd.path.length;

    activeBuses.push({
      id:       `sim-bus-${i + 1}`,
      label:    `Bus ${i + 1}${rd.routeName !== 'Loop' ? ` · ${rd.routeName}` : ''}`,
      routeId:  rd.routeId,
      path:     rd.path,
      index:    startIdx,
    });
  }

  return activeBuses;
}

// ── Tick ──────────────────────────────────────────────────────────────────────

let activeBuses = [];
let tick = 0;

async function step() {
  await Promise.all(activeBuses.map(async (bus) => {
    try { await writeBus(bus); }
    catch (err) { console.error(`[${bus.label}] write failed: ${err.message}`); }
    bus.index = (bus.index + Math.max(1, Math.round(SPEED))) % bus.path.length;
  }));

  tick++;
  if (tick % 10 === 0) {
    const lines = activeBuses.map(b => {
      const c = b.path[b.index];
      return `  ${b.label.padEnd(30)} ${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`;
    });
    console.log(`[tick ${String(tick).padStart(4)}]\n${lines.join('\n')}`);
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function cancelPendingRequests() {
  const snap = await db.collection(`orgs/${ORG_ID}/stopRequests`)
    .where('status', 'in', ['pending', 'accepted'])
    .get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((d) => {
    batch.update(d.ref, {
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      cancelledReason: 'no_buses_online',
    });
  });
  await batch.commit();
  console.log(`Cancelled ${snap.size} pending request(s).`);
}

async function shutdown() {
  console.log('\nShutting down — taking all buses offline...');
  await Promise.all(activeBuses.map(takeBusOffline));
  await cancelPendingRequests();
  console.log('Done. Goodbye.');
  process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

// ── Start ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Shuttler Bus Simulator');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` Org   : ${ORG_ID}`);
  console.log(` Buses : ${BUS_COUNT}   Speed : ${SPEED}x`);

  activeBuses = await loadActiveBuses();

  console.log(`\nRunning: ${activeBuses.map(b => b.label).join(', ')}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Ctrl-C to stop.\n');

  await step();
  setInterval(step, Math.round(UPDATE_INTERVAL / SPEED));
})();
