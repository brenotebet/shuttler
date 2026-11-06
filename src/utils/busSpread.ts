// src/utils/busSpread.ts
// Keeps overlapping bus markers apart on the rider map. Buses parked at the
// same stop (a layover) are drawn on top of each other at their true GPS
// positions, and only the top one can be tapped. This nudges each group of
// overlapping buses into a small ring around the group's centre, sized in
// screen points so the nudge shrinks as the rider zooms in. It only changes
// where the icon is drawn — never the position used for ETAs or next stop.

export type SpreadBus = { id: string; latitude: number; longitude: number };
export type SpreadRegion = { latitudeDelta: number; longitudeDelta: number };
export type Offset = { dLat: number; dLng: number };

/**
 * Minimum on-screen distance between two bus icons' centres, in points.
 * The marker image is 70×70 pt but the bus drawn in it is only ~13×28 pt
 * (assets/bus-icon.png is mostly transparent padding), so buses only touch
 * within about one bus length. 30 pt = that plus a small gap; anything
 * farther apart is already visibly separate and is left where it is.
 */
export const BUS_MIN_SEPARATION_PT = 30;

/**
 * Display offsets (in degrees) for every bus. Buses not overlapping anything
 * get { dLat: 0, dLng: 0 }. Buses in a group are placed evenly on a circle
 * around the group's centre, ordered by id so their slots stay put between
 * updates.
 */
export function spreadOffsets(
  buses: SpreadBus[],
  region: SpreadRegion,
  mapSizePt: { width: number; height: number },
  minSepPt = BUS_MIN_SEPARATION_PT,
): Record<string, Offset> {
  const result: Record<string, Offset> = {};
  buses.forEach((b) => { result[b.id] = { dLat: 0, dLng: 0 }; });
  if (buses.length < 2 || region.latitudeDelta <= 0 || region.longitudeDelta <= 0) return result;

  const degPerPtLat = region.latitudeDelta / mapSizePt.height;
  const degPerPtLng = region.longitudeDelta / mapSizePt.width;
  const toPt = (b: SpreadBus) => ({ x: b.longitude / degPerPtLng, y: -b.latitude / degPerPtLat });

  // Union buses that would overlap, so chains (A near B near C) form one group.
  const parent = buses.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const pts = buses.map(toPt);
  for (let i = 0; i < buses.length; i++) {
    for (let j = i + 1; j < buses.length; j++) {
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < minSepPt) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, number[]>();
  buses.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  });

  groups.forEach((members) => {
    if (members.length < 2) return;
    const k = members.length;
    const cx = members.reduce((s, i) => s + pts[i].x, 0) / k;
    const cy = members.reduce((s, i) => s + pts[i].y, 0) / k;
    // Radius so neighbours on the ring sit minSepPt apart.
    const radius = minSepPt / (2 * Math.sin(Math.PI / k));
    const ordered = [...members].sort((a, b) => (buses[a].id < buses[b].id ? -1 : 1));
    ordered.forEach((i, slot) => {
      // Start on the left and go clockwise; for two buses: side by side.
      const angle = Math.PI + (2 * Math.PI * slot) / k;
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      result[buses[i].id] = {
        dLng: (x - pts[i].x) * degPerPtLng,
        dLat: -(y - pts[i].y) * degPerPtLat,
      };
    });
  });
  return result;
}

export function sameOffsets(a: Record<string, Offset>, b: Record<string, Offset>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => b[k] && Math.abs(a[k].dLat - b[k].dLat) < 1e-9 && Math.abs(a[k].dLng - b[k].dLng) < 1e-9);
}
