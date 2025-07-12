import { GOOGLE_MAPS_API_KEY } from '../../config';
const polyline = require('@mapbox/polyline');

export type LatLng = { latitude: number; longitude: number };
export async function fetchDirections(origin: LatLng, destination: LatLng): Promise<{ coords: LatLng[]; eta: string | null }> {
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&key=${GOOGLE_MAPS_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Directions request failed with status ${res.status}`);
  }
  const json = await res.json();
  if (!json.routes?.length) {
    return { coords: [], eta: null };
  }
  const route = json.routes[0];
  const points = polyline.decode(route.overview_polyline.points);
  const coords = points.map(([lat, lng]: [number, number]) => ({ latitude: lat, longitude: lng }));
  const eta = route.legs?.[0]?.duration?.text ?? null;
  return { coords, eta };
}
