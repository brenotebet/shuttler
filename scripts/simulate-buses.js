#!/usr/bin/env node
// scripts/simulate-buses.js
//
// Simulates multiple shuttle buses at St. Louis Lambert International Airport (STL).
// Writes to Firestore using the exact same fields as LocationContext.writeBusDoc.
//
// Usage:
//   ORG_ID=your-org-id node scripts/simulate-buses.js
//   ORG_ID=your-org-id SPEED=3 node scripts/simulate-buses.js   # 3x speed
//   ORG_ID=your-org-id BUSES=2 node scripts/simulate-buses.js   # only 2 buses
//
// Requirements:
//   - serviceAccount.json in project root  (or FIREBASE_SERVICE_ACCOUNT_JSON env var)
//   - firebase-admin is already a backend dependency

'use strict';

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const ORG_ID = process.env.ORG_ID;
if (!ORG_ID) {
  console.error('ERROR: ORG_ID environment variable is required.');
  console.error('Usage: ORG_ID=your-org-id node scripts/simulate-buses.js');
  process.exit(1);
}

const SPEED            = parseFloat(process.env.SPEED  ?? '1');  // 1 = real-time, 2 = 2x faster
const BUS_COUNT        = parseInt(process.env.BUSES    ?? '3');  // how many buses to run (1–3)
const UPDATE_INTERVAL  = 1000;                                   // ms between Firestore writes
const STEPS_PER_SEG    = 80;                                     // interpolation steps between waypoints

// ── Firebase init ─────────────────────────────────────────────────────────────

const SA_PATH = path.join(__dirname, '..', 'serviceAccount.json');
const SA_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (admin.apps.length === 0) {
  if (SA_JSON) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA_JSON)) });
  } else if (fs.existsSync(SA_PATH)) {
    admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
  } else {
    console.error('ERROR: No service account found.');
    console.error('  Place serviceAccount.json in the project root, or set FIREBASE_SERVICE_ACCOUNT_JSON.');
    process.exit(1);
  }
}

const db = admin.firestore();

// ── STL Lambert International Airport stops ───────────────────────────────────
//
// Coordinates follow the real airport layout:
//   Terminal 1 (west) and Terminal 2 (east) are connected by Lambert
//   International Blvd running ~1.7 miles east-west. Economy and long-term
//   lots sit north of the terminals; the rental car center is south-east;
//   cell-phone waiting lots are on the outer edges.
//
// To wire up your actual Firestore stop IDs, set routeId on each bus below
// to match the route document ID in orgs/{orgId}/routes.

const S = {
  TERM_1:       { lat: 38.7490, lng: -90.3700 },  // Terminal 1 — arrivals/departures (west)
  TERM_2:       { lat: 38.7484, lng: -90.3520 },  // Terminal 2 — arrivals/departures (east)
  ECONOMY_LOT:  { lat: 38.7545, lng: -90.3615 },  // Economy / long-term parking (north)
  LONG_TERM:    { lat: 38.7530, lng: -90.3680 },  // Long-term lot (north-west)
  RENTAL_CAR:   { lat: 38.7455, lng: -90.3575 },  // Rental car center (south-east)
  CELL_LOT_W:   { lat: 38.7438, lng: -90.3740 },  // Cell-phone waiting lot (west, near T1)
  CELL_LOT_E:   { lat: 38.7508, lng: -90.3478 },  // Cell-phone waiting lot (east, near T2)
};

// ── Bus route definitions ─────────────────────────────────────────────────────
//
// Each bus follows a looping list of GPS waypoints. Intermediate points between
// stops are placed to approximate the actual airport service-road geometry.
//
// routeId: set this to your actual Firestore route document ID if you want
//          the route-aware bus-matching logic in MapScreen to engage.
//          Leave null to fall back to "closest bus overall".

const BUS_DEFINITIONS = [
  {
    //
    // Route A — Economy Loop
    // Terminal 1 → Long-term lot → Economy lot → Terminal 2 → Economy lot → Terminal 1
    // Full circuit: covers both terminals and the main parking areas.
    //
    id:          'sim-bus-1',
    label:       'Bus 1 · Economy Loop',
    routeId:     null,
    phaseOffset: 0.00,
    waypoints: [
      S.TERM_1,
      { lat: 38.7495, lng: -90.3700 },  // exit T1 heading north
      { lat: 38.7510, lng: -90.3690 },
      S.LONG_TERM,
      { lat: 38.7538, lng: -90.3650 },  // sweeping east along north perimeter
      S.ECONOMY_LOT,
      { lat: 38.7540, lng: -90.3580 },  // continue east toward T2
      { lat: 38.7520, lng: -90.3535 },
      { lat: 38.7500, lng: -90.3520 },
      S.TERM_2,
      { lat: 38.7500, lng: -90.3535 },  // exit T2 heading north again
      { lat: 38.7525, lng: -90.3560 },
      S.ECONOMY_LOT,
      { lat: 38.7538, lng: -90.3630 },  // sweeping back west
      { lat: 38.7525, lng: -90.3670 },
      S.LONG_TERM,
      { lat: 38.7510, lng: -90.3692 },
      { lat: 38.7495, lng: -90.3700 },
      S.TERM_1,
    ],
  },
  {
    //
    // Route B — Rental Car Express
    // Terminal 1 → Rental Car Center → Terminal 2 → Rental Car Center → Terminal 1
    // Shorter loop focused on car-rental passengers.
    //
    id:          'sim-bus-2',
    label:       'Bus 2 · Rental Car',
    routeId:     null,
    phaseOffset: 0.50,  // offset so this bus isn't on top of Bus 1 at start
    waypoints: [
      S.TERM_1,
      { lat: 38.7480, lng: -90.3690 },  // exit T1 south-east on Lambert Int'l Blvd
      { lat: 38.7468, lng: -90.3645 },
      { lat: 38.7458, lng: -90.3605 },
      S.RENTAL_CAR,
      { lat: 38.7460, lng: -90.3560 },  // continue east toward T2
      { lat: 38.7468, lng: -90.3535 },
      S.TERM_2,
      { lat: 38.7468, lng: -90.3550 },  // head back west
      { lat: 38.7460, lng: -90.3565 },
      S.RENTAL_CAR,
      { lat: 38.7458, lng: -90.3610 },
      { lat: 38.7468, lng: -90.3655 },
      { lat: 38.7480, lng: -90.3690 },
      S.TERM_1,
    ],
  },
  {
    //
    // Route C — Cell-phone / Waiting Lots
    // Terminal 1 → Cell Lot West → Terminal 2 → Cell Lot East → Terminal 1
    // Services the waiting areas on both ends of the airport.
    //
    id:          'sim-bus-3',
    label:       'Bus 3 · Waiting Lots',
    routeId:     null,
    phaseOffset: 0.33,
    waypoints: [
      S.TERM_1,
      { lat: 38.7448, lng: -90.3720 },  // exit T1 south-west to cell lot
      S.CELL_LOT_W,
      { lat: 38.7445, lng: -90.3710 },  // U-turn and head east on Lambert Blvd
      { lat: 38.7452, lng: -90.3680 },
      { lat: 38.7460, lng: -90.3640 },
      { lat: 38.7468, lng: -90.3590 },
      { lat: 38.7474, lng: -90.3548 },
      S.TERM_2,
      { lat: 38.7492, lng: -90.3505 },  // exit T2 north-east to cell lot
      { lat: 38.7502, lng: -90.3490 },
      S.CELL_LOT_E,
      { lat: 38.7500, lng: -90.3502 },  // U-turn back west
      { lat: 38.7488, lng: -90.3520 },
      { lat: 38.7474, lng: -90.3548 },
      { lat: 38.7462, lng: -90.3600 },
      { lat: 38.7455, lng: -90.3650 },
      { lat: 38.7448, lng: -90.3700 },
      S.TERM_1,
    ],
  },
];

// ── Path builder ──────────────────────────────────────────────────────────────
// Linearly interpolates between each pair of waypoints.

function buildPath(waypoints) {
  const pts = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    for (let s = 0; s < STEPS_PER_SEG; s++) {
      const t = s / STEPS_PER_SEG;
      pts.push({
        latitude:  a.lat + (b.lat - a.lat) * t,
        longitude: a.lng + (b.lng - a.lng) * t,
      });
    }
  }
  return pts;
}

// ── Build live state for each active bus ──────────────────────────────────────

const activeBuses = BUS_DEFINITIONS.slice(0, BUS_COUNT).map((def) => {
  const path  = buildPath(def.waypoints);
  const start = Math.floor(def.phaseOffset * path.length) % path.length;
  return { ...def, path, index: start };
});

// ── Firestore helpers ─────────────────────────────────────────────────────────

async function writeBus(bus) {
  const coords = bus.path[bus.index];
  await db.doc(`orgs/${ORG_ID}/buses/${bus.id}`).set(
    {
      driverUid:  bus.id,
      latitude:   coords.latitude,
      longitude:  coords.longitude,
      online:     true,
      lastSeen:   admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
      routeId:    bus.routeId ?? null,
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

// ── Tick ──────────────────────────────────────────────────────────────────────

let tick = 0;

async function step() {
  const writes = activeBuses.map(async (bus) => {
    try {
      await writeBus(bus);
    } catch (err) {
      console.error(`[${bus.label}] write failed: ${err.message}`);
    }
    // Advance along the path; SPEED allows fast-forwarding the simulation
    bus.index = (bus.index + Math.max(1, Math.round(SPEED))) % bus.path.length;
  });

  await Promise.all(writes);
  tick++;

  // Log position every 10 ticks so the terminal doesn't flood
  if (tick % 10 === 0) {
    const lines = activeBuses.map((b) => {
      const c = b.path[b.index];
      return `  ${b.label.padEnd(22)} ${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`;
    });
    console.log(`[tick ${String(tick).padStart(4)}]\n${lines.join('\n')}`);
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown() {
  console.log('\nShutting down — taking all buses offline...');
  await Promise.all(activeBuses.map(takeBusOffline));
  console.log('All buses set offline. Goodbye.');
  process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

// ── Start ─────────────────────────────────────────────────────────────────────

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' Shuttler Bus Simulator');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(` Org ID : ${ORG_ID}`);
console.log(` Buses  : ${activeBuses.map((b) => b.label).join(', ')}`);
console.log(` Speed  : ${SPEED}x  (interval: ${Math.round(UPDATE_INTERVAL / SPEED)}ms)`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Press Ctrl-C to stop and take all buses offline.\n');

// Fire immediately, then on the interval
step();
setInterval(step, Math.round(UPDATE_INTERVAL / SPEED));
