// src/utils/stopLabels.ts
// Decides which stop name labels to draw on the rider map so they never
// overlap: at the current zoom, a label is shown only if its box doesn't
// collide with a label already kept. Zooming in spreads stops apart and
// more names appear.

export type LabelStop = { id: string; name: string; latitude: number; longitude: number };
export type MapRegion = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

const LABEL_HEIGHT_PT = 26;
const LABEL_MAX_WIDTH_PT = 140; // matches MapMarker's chip maxWidth
const CHAR_WIDTH_PT = 6.5;
const LABEL_PADDING_PT = 18;
const GAP_PT = 4;

export function estimateLabelWidth(name: string): number {
  return Math.min(LABEL_MAX_WIDTH_PT, name.length * CHAR_WIDTH_PT + LABEL_PADDING_PT);
}

/**
 * Returns the ids of stops whose labels should be shown.
 * `priorityIds` (e.g. the rider's selected stop) are placed first so they
 * always win a collision.
 */
export function pickVisibleStopLabels(
  stops: LabelStop[],
  region: MapRegion,
  mapSizePt: { width: number; height: number },
  priorityIds: string[] = [],
): Set<string> {
  const ptPerDegX = mapSizePt.width / Math.max(region.longitudeDelta, 1e-9);
  const ptPerDegY = mapSizePt.height / Math.max(region.latitudeDelta, 1e-9);

  const ordered = [...stops].sort((a, b) => {
    const pa = priorityIds.includes(a.id) ? 0 : 1;
    const pb = priorityIds.includes(b.id) ? 0 : 1;
    return pa - pb;
  });

  const kept: { x: number; y: number; w: number }[] = [];
  const visible = new Set<string>();
  for (const s of ordered) {
    const x = (s.longitude - region.longitude) * ptPerDegX;
    const y = (region.latitude - s.latitude) * ptPerDegY;
    const w = estimateLabelWidth(s.name);
    const collides = kept.some(
      (k) => Math.abs(k.x - x) < (k.w + w) / 2 + GAP_PT && Math.abs(k.y - y) < LABEL_HEIGHT_PT + GAP_PT,
    );
    if (!collides) {
      kept.push({ x, y, w });
      visible.add(s.id);
    }
  }
  return visible;
}

export function sameIdSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
