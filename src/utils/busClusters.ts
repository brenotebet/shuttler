// src/utils/busClusters.ts
// Groups bus markers that overlap on the rider map. Every bus stays at its
// true position; when buses overlap at the current zoom, one of them (the
// "lead") is shown with a count badge and the others are hidden, so nothing
// moves when the rider zooms — only which icons are visible changes.

export type ClusterBus = { id: string; latitude: number; longitude: number };
export type ClusterRegion = { latitudeDelta: number; longitudeDelta: number };
/** For every bus in a group of 2+: the lead's id and all member ids. */
export type BusGroups = Record<string, { lead: string; members: string[] }>;

/**
 * On-screen distance within which two bus icons overlap, in points. The
 * marker image is 70×70 pt but the bus drawn in it is only ~13×28 pt
 * (assets/bus-icon.png is mostly transparent padding).
 */
export const BUS_OVERLAP_PT = 30;

export function groupOverlappingBuses(
  buses: ClusterBus[],
  region: ClusterRegion,
  mapSizePt: { width: number; height: number },
  overlapPt = BUS_OVERLAP_PT,
): BusGroups {
  const result: BusGroups = {};
  if (buses.length < 2 || region.latitudeDelta <= 0 || region.longitudeDelta <= 0) return result;

  const degPerPtLat = region.latitudeDelta / mapSizePt.height;
  const degPerPtLng = region.longitudeDelta / mapSizePt.width;
  const pts = buses.map((b) => ({ x: b.longitude / degPerPtLng, y: b.latitude / degPerPtLat }));

  // Union-find, so chains (A overlaps B overlaps C) form one group.
  const parent = buses.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < buses.length; i++) {
    for (let j = i + 1; j < buses.length; j++) {
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < overlapPt) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, string[]>();
  buses.forEach((b, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(b.id);
  });
  groups.forEach((members) => {
    if (members.length < 2) return;
    // Sorted so the same bus leads every time — the visible icon doesn't swap.
    const sorted = [...members].sort();
    sorted.forEach((id) => { result[id] = { lead: sorted[0], members: sorted }; });
  });
  return result;
}

export function sameGroups(a: BusGroups, b: BusGroups): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => b[k] && b[k].lead === a[k].lead && b[k].members.join() === a[k].members.join());
}
