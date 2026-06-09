#!/usr/bin/env node
// scripts/test-gps.js
//
// GPS accuracy and live location diagnostics for Shuttler.
//
// Three independent modes:
//
//   latency   Measures Firestore write→read round-trip. Writes a probe doc, times
//             how long until the onSnapshot listener fires. Runs 20 probes then prints stats.
//
//   watch     Live monitor of the buses collection. Prints update frequency, position
//             deltas, and stale-bus alerts for every driver currently online.
//
//   accuracy  Offline algorithm tests — no Firebase needed. Runs the EMA smoother and
//             accuracy filter against synthetic noisy GPS data and prints raw vs smoothed.
//             Also validates the arrival-radius math used by DriverScreen.
//
// Usage:
//   ORG_ID=your-org-id node scripts/test-gps.js latency
//   ORG_ID=your-org-id node scripts/test-gps.js watch
//   node scripts/test-gps.js accuracy
//
// Requirements:
//   serviceAccount.json in project root  (or FIREBASE_SERVICE_ACCOUNT_JSON env var)

'use strict';

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

// ── Constants (must match LocationContext.tsx / DriverScreen.tsx) ─────────────

const GPS_ACCURACY_MAX_M  = 80;
const EMA_ALPHA           = 0.4;
const WRITE_MIN_INTERVAL  = 4000;   // ms
const WRITE_MIN_DISTANCE  = 8;      // metres
const ARRIVE_RADIUS_M     = 75 * 0.3048;   // 75 ft → m  ≈ 22.86 m
const EXIT_RADIUS_M       = 180 * 0.3048;  // 180 ft → m ≈ 54.86 m
const DWELL_SECONDS       = 30;
const FRESHNESS_WINDOW_S  = 30;     // bus goes stale after this
const STALE_WARN_S        = 60;

// ── Haversine distance ────────────────────────────────────────────────────────

function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.latitude  - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// ── Firebase init (skipped for accuracy mode) ─────────────────────────────────

function initFirebase() {
  if (admin.apps.length > 0) return admin.firestore();
  const SA_PATH = path.join(__dirname, '..', 'serviceAccount.json');
  const SA_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (SA_JSON) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA_JSON)) });
  } else if (fs.existsSync(SA_PATH)) {
    admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
  } else {
    console.error('ERROR: serviceAccount.json not found in project root.');
    process.exit(1);
  }
  return admin.firestore();
}

function requireOrgId() {
  const id = process.env.ORG_ID;
  if (!id) { console.error('ERROR: ORG_ID env var required for this mode.'); process.exit(1); }
  return id;
}

// ══════════════════════════════════════════════════════════════════════════════
// MODE 1 — latency
// ══════════════════════════════════════════════════════════════════════════════

async function runLatency() {
  const ORG_ID  = requireOrgId();
  const db      = initFirebase();
  const PROBES  = 20;
  const PROBE_DOC = `orgs/${ORG_ID}/buses/__gps-latency-probe__`;
  const latencies = [];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Shuttler — Firestore Latency Test');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` Org: ${ORG_ID}   Probes: ${PROBES}`);
  console.log(' Writing probe doc and timing onSnapshot callback...\n');

  await new Promise((resolve) => {
    let remaining = PROBES;
    let pendingWriteMs = null;

    const unsub = db.doc(PROBE_DOC).onSnapshot((snap) => {
      if (!snap.exists) return;
      if (pendingWriteMs === null) return;  // first snapshot before first write

      const latencyMs = Date.now() - pendingWriteMs;
      latencies.push(latencyMs);
      pendingWriteMs = null;

      const probe = PROBES - remaining + 1;
      process.stdout.write(`  Probe ${String(probe).padStart(2)}/${PROBES}  →  ${latencyMs} ms\n`);

      remaining--;
      if (remaining === 0) {
        unsub();
        resolve();
        return;
      }

      // Wait 500 ms between probes to avoid batching
      setTimeout(fireProbe, 500);
    });

    const fireProbe = async () => {
      pendingWriteMs = Date.now();
      await db.doc(PROBE_DOC).set({
        probe: PROBES - remaining,
        clientTs: pendingWriteMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    };

    // Kick off first probe after the listener is registered
    setTimeout(fireProbe, 300);
  });

  // Cleanup probe doc
  await db.doc(PROBE_DOC).delete().catch(() => {});

  // Stats
  latencies.sort((a, b) => a - b);
  const sum  = latencies.reduce((s, v) => s + v, 0);
  const avg  = Math.round(sum / latencies.length);
  const med  = latencies[Math.floor(latencies.length / 2)];
  const p95  = latencies[Math.floor(latencies.length * 0.95)];
  const min  = latencies[0];
  const max  = latencies[latencies.length - 1];

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Results');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` Min    ${min} ms`);
  console.log(` Median ${med} ms`);
  console.log(` Avg    ${avg} ms`);
  console.log(` p95    ${p95} ms`);
  console.log(` Max    ${max} ms`);

  const verdict = med < 300  ? '✅ Excellent (<300 ms)' :
                  med < 800  ? '✅ Good (<800 ms)' :
                  med < 1500 ? '⚠️  Acceptable (<1.5 s)' :
                               '❌ Slow — check network or Firestore region';
  console.log(`\n ${verdict}`);
  console.log('\n Expectation: students see bus move within ~1-2 s of the driver moving.');
  console.log(` App write throttle: every ${WRITE_MIN_INTERVAL / 1000}s or ${WRITE_MIN_DISTANCE}m, whichever comes first.\n`);

  process.exit(0);
}

// ══════════════════════════════════════════════════════════════════════════════
// MODE 2 — watch
// ══════════════════════════════════════════════════════════════════════════════

function runWatch() {
  const ORG_ID = requireOrgId();
  const db     = initFirebase();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Shuttler — Live Bus Monitor');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` Org: ${ORG_ID}   (Ctrl-C to stop)\n`);

  // Per-bus tracking: last position, timestamps, update count
  const state = {};

  const printStatus = () => {
    const now = Date.now();
    const ids  = Object.keys(state);
    if (ids.length === 0) { console.log('  (no buses seen yet)\n'); return; }

    console.log(`\n[${new Date().toLocaleTimeString()}] ── Bus Status ──`);
    for (const id of ids) {
      const s = state[id];
      if (!s.online) { console.log(`  ${id.slice(-8).padEnd(12)}  OFFLINE`); continue; }

      const ageMs  = now - s.lastUpdateMs;
      const ageS   = (ageMs / 1000).toFixed(1);
      const freq   = s.updateCount > 1 ? `${(s.totalIntervalMs / (s.updateCount - 1) / 1000).toFixed(1)}s avg` : 'first update';
      const delta  = s.lastDeltaM !== null ? `${s.lastDeltaM.toFixed(1)}m moved` : '—';
      const freshTag = ageMs / 1000 > STALE_WARN_S ? '❌ STALE' :
                       ageMs / 1000 > FRESHNESS_WINDOW_S ? '⚠️  FADING' : '✅';

      console.log(
        `  ${(s.label ?? id).slice(0, 20).padEnd(20)}  ` +
        `lat ${s.lat.toFixed(5)}  lng ${s.lng.toFixed(5)}  ` +
        `age ${ageS}s  ${freq}  ${delta}  ${freshTag}`
      );
    }
  };

  const unsubBuses = db.collection(`orgs/${ORG_ID}/buses`).onSnapshot((snap) => {
    const now = Date.now();
    snap.docChanges().forEach((change) => {
      const id   = change.doc.id;
      const data = change.doc.data();

      if (change.type === 'removed') { delete state[id]; return; }

      const lat = data.latitude;
      const lng = data.longitude;
      const online = data.online === true;
      const tsMs = data.updatedAt?.toMillis?.() ?? data.lastSeen?.toMillis?.() ?? now;

      if (!state[id]) {
        state[id] = { label: data.displayName ?? id, lat, lng, online, lastUpdateMs: tsMs,
                      updateCount: 1, totalIntervalMs: 0, lastDeltaM: null };
        console.log(`  Bus detected: ${id.slice(-8)} — ${online ? 'ONLINE' : 'offline'}`);
        return;
      }

      const prev = state[id];
      const intervalMs = tsMs - prev.lastUpdateMs;
      const deltaM = online && prev.online && typeof lat === 'number'
        ? distanceMeters({ latitude: prev.lat, longitude: prev.lng }, { latitude: lat, longitude: lng })
        : null;

      state[id] = {
        ...prev,
        lat: lat ?? prev.lat,
        lng: lng ?? prev.lng,
        online,
        lastUpdateMs: tsMs,
        updateCount: prev.updateCount + 1,
        totalIntervalMs: intervalMs > 0 ? prev.totalIntervalMs + intervalMs : prev.totalIntervalMs,
        lastDeltaM: deltaM,
      };
    });
  }, (err) => console.error('Snapshot error:', err.message));

  const printInterval = setInterval(printStatus, 5000);
  printStatus();

  const cleanup = () => {
    clearInterval(printInterval);
    unsubBuses();
    console.log('\nMonitor stopped.');
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

// ══════════════════════════════════════════════════════════════════════════════
// MODE 3 — accuracy (offline, no Firebase)
// ══════════════════════════════════════════════════════════════════════════════

function runAccuracy() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Shuttler — GPS Algorithm Validation (offline)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  let passed = 0;
  let failed = 0;

  function assert(label, condition, extra = '') {
    if (condition) {
      console.log(`  ✅  ${label}${extra ? '  ' + extra : ''}`);
      passed++;
    } else {
      console.log(`  ❌  ${label}${extra ? '  ' + extra : ''}`);
      failed++;
    }
  }

  // ── 1. Accuracy filter ──────────────────────────────────────────────────────
  console.log('\n── 1. Accuracy filter (GPS_ACCURACY_MAX_M = ' + GPS_ACCURACY_MAX_M + ' m) ──');

  const testReadings = [
    { accuracy: 5,   expected: true,  label: '5 m (perfect GPS)' },
    { accuracy: 20,  expected: true,  label: '20 m (good GPS)' },
    { accuracy: 79,  expected: true,  label: '79 m (borderline, just under)' },
    { accuracy: 80,  expected: true,  label: '80 m (exactly at limit, passes)' },
    { accuracy: 81,  expected: false, label: '81 m (just over limit, skipped)' },
    { accuracy: 150, expected: false, label: '150 m (poor GPS, skipped)' },
    { accuracy: null,expected: true,  label: 'null accuracy (passes — unknown is not bad)' },
  ];

  for (const r of testReadings) {
    const passes = r.accuracy === null || r.accuracy <= GPS_ACCURACY_MAX_M;
    assert(r.label, passes === r.expected, `accuracy=${r.accuracy}`);
  }

  // ── 2. EMA smoothing ────────────────────────────────────────────────────────
  console.log('\n── 2. EMA smoothing (α = ' + EMA_ALPHA + ') ──');

  // Simulate a straight east-bound path with noise
  const TRUE_LAT = 38.9500;
  const TRUE_LON = -89.0800;

  function addNoise(v, mag) { return v + (Math.random() * 2 - 1) * mag; }

  let smoothed = null;
  const rawReadings = [];
  const smoothedReadings = [];

  for (let i = 0; i < 20; i++) {
    const raw = {
      latitude:  TRUE_LAT + (i * 0.00002) + addNoise(0, 0.00003),
      longitude: TRUE_LON + (i * 0.00002) + addNoise(0, 0.00003),
    };
    rawReadings.push(raw);

    smoothed = smoothed
      ? { latitude:  EMA_ALPHA * raw.latitude  + (1 - EMA_ALPHA) * smoothed.latitude,
          longitude: EMA_ALPHA * raw.longitude + (1 - EMA_ALPHA) * smoothed.longitude }
      : raw;
    smoothedReadings.push(smoothed);
  }

  // EMA's job is to reduce jitter (step-to-step variance), not to eliminate lag error.
  // Compare the standard deviation of consecutive step sizes between raw and smoothed.
  function stepStdDev(readings) {
    const steps = [];
    for (let i = 1; i < readings.length; i++) {
      steps.push(distanceMeters(readings[i - 1], readings[i]));
    }
    const mean = steps.reduce((s, v) => s + v, 0) / steps.length;
    const variance = steps.reduce((s, v) => s + (v - mean) ** 2, 0) / steps.length;
    return Math.sqrt(variance);
  }

  const rawStdDev      = stepStdDev(rawReadings);
  const smoothedStdDev = stepStdDev(smoothedReadings);

  assert(
    `EMA reduces step-to-step jitter (std dev of step sizes)`,
    smoothedStdDev < rawStdDev,
    `raw σ=${rawStdDev.toFixed(2)}m  smoothed σ=${smoothedStdDev.toFixed(2)}m`,
  );
  assert(
    `Smoothed step std dev is under 4 m`,
    smoothedStdDev < 4,
    `σ=${smoothedStdDev.toFixed(2)}m`,
  );

  // ── 3. Arrival radius math ──────────────────────────────────────────────────
  console.log(`\n── 3. Arrival detection (arrive=${ARRIVE_RADIUS_M.toFixed(1)}m, exit=${EXIT_RADIUS_M.toFixed(1)}m) ──`);

  // McKendree-ish campus stop at 38.9500, -89.0800
  const STOP = { latitude: 38.9500, longitude: -89.0800 };

  // A point ~10 m north should be within arrive radius
  const veryClose  = { latitude: 38.95009, longitude: -89.0800 };   // ~10 m
  const justInside = { latitude: 38.95020, longitude: -89.0800 };   // ~22 m
  const justOut    = { latitude: 38.95026, longitude: -89.0800 };   // ~29 m — just outside arrive
  const exitZone   = { latitude: 38.95055, longitude: -89.0800 };   // ~61 m — outside exit radius
  const farAway    = { latitude: 38.9510,  longitude: -89.0800 };   // ~111 m — clearly outside

  assert('Very close (10 m) is within ARRIVE radius',
    distanceMeters(STOP, veryClose) <= ARRIVE_RADIUS_M,
    `d=${distanceMeters(STOP, veryClose).toFixed(1)}m`);

  assert('22 m point is within ARRIVE radius',
    distanceMeters(STOP, justInside) <= ARRIVE_RADIUS_M,
    `d=${distanceMeters(STOP, justInside).toFixed(1)}m`);

  assert('29 m point is outside ARRIVE radius but within EXIT radius',
    distanceMeters(STOP, justOut) > ARRIVE_RADIUS_M &&
    distanceMeters(STOP, justOut) < EXIT_RADIUS_M,
    `d=${distanceMeters(STOP, justOut).toFixed(1)}m`);

  assert('61 m point is outside EXIT radius (dwell can reset)',
    distanceMeters(STOP, exitZone) >= EXIT_RADIUS_M,
    `d=${distanceMeters(STOP, exitZone).toFixed(1)}m`);

  assert('111 m point is clearly not near the stop',
    distanceMeters(STOP, farAway) > EXIT_RADIUS_M,
    `d=${distanceMeters(STOP, farAway).toFixed(1)}m`);

  // ── 4. Write throttle simulation ────────────────────────────────────────────
  console.log('\n── 4. Write throttle logic ──');

  let lastWrittenMs    = 0;
  let lastWrittenCoords = null;
  let writesSimulated  = 0;
  let writesExpected   = 0;

  function shouldWrite(coords, nowMs) {
    const tooSoon    = nowMs - lastWrittenMs < WRITE_MIN_INTERVAL;
    const movedEnough = !lastWrittenCoords || distanceMeters(lastWrittenCoords, coords) >= WRITE_MIN_DISTANCE;
    return !tooSoon || movedEnough;
  }

  // Scenario A: standing still for 30 seconds — should write ~7 times (every 4s)
  writesSimulated = 0; writesExpected = 7;
  lastWrittenMs = 0; lastWrittenCoords = null;
  const STILL = { latitude: 38.9500, longitude: -89.0800 };
  for (let t = 0; t < 30000; t += 1000) {
    if (shouldWrite(STILL, t)) { writesSimulated++; lastWrittenMs = t; lastWrittenCoords = STILL; }
  }
  assert(
    `Standing still 30s: ~7 writes (one per 4s interval)`,
    writesSimulated >= 6 && writesSimulated <= 9,
    `got ${writesSimulated}`,
  );

  // Scenario B: moving fast (>8m per step) — should write on every step
  writesSimulated = 0;
  lastWrittenMs = 0; lastWrittenCoords = null;
  let movingPos = { latitude: 38.9500, longitude: -89.0800 };
  for (let i = 0; i < 10; i++) {
    movingPos = { latitude: movingPos.latitude + 0.0002, longitude: movingPos.longitude };
    const t = i * 500; // 0.5s between steps — below 4s interval
    if (shouldWrite(movingPos, t)) { writesSimulated++; lastWrittenMs = t; lastWrittenCoords = movingPos; }
  }
  assert(
    `Moving fast (>8m/step at 0.5s): writes every step despite short interval`,
    writesSimulated === 10,
    `got ${writesSimulated}`,
  );

  // ── 5. Dwell requirement ────────────────────────────────────────────────────
  console.log('\n── 5. Dwell requirement ──');

  // Simulate a bus arriving at a stop and staying there
  let dwellStartMs = null;
  let arrivedFired = false;
  let outsideMs    = null;

  for (let t = 0; t <= 60000; t += 1000) {
    const inRange = t >= 5000; // enters range at t=5s, stays
    if (inRange && dwellStartMs === null) dwellStartMs = t;
    if (!inRange && dwellStartMs !== null) { outsideMs = t; dwellStartMs = null; }

    if (dwellStartMs !== null && t - dwellStartMs >= DWELL_SECONDS * 1000 && !arrivedFired) {
      arrivedFired = true;
    }
  }

  assert(
    `Arrived fires after ${DWELL_SECONDS}s dwell inside ARRIVE radius`,
    arrivedFired,
  );

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const total = passed + failed;
  if (failed === 0) {
    console.log(` ✅  All ${total} assertions passed.\n`);
  } else {
    console.log(` ❌  ${failed}/${total} assertions failed. Review output above.\n`);
    process.exit(1);
  }

  process.exit(0);
}

// ══════════════════════════════════════════════════════════════════════════════
// Entry point
// ══════════════════════════════════════════════════════════════════════════════

const mode = process.argv[2] ?? 'accuracy';

switch (mode) {
  case 'latency':  runLatency();  break;
  case 'watch':    runWatch();    break;
  case 'accuracy': runAccuracy(); break;
  default:
    console.error(`Unknown mode "${mode}". Use: latency | watch | accuracy`);
    process.exit(1);
}
