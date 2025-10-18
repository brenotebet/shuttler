import { GOOGLE_MAPS_API_KEY } from '../../config';
const polyline = require('@mapbox/polyline');

export type LatLng = { latitude: number; longitude: number };

type DirectionsResult = { coords: LatLng[]; eta: string | null };

const buildFallbackRoute = (origin: LatLng, destination: LatLng): DirectionsResult => ({
  coords: [
    { latitude: origin.latitude, longitude: origin.longitude },
    { latitude: destination.latitude, longitude: destination.longitude },
  ],
  eta: null,
});

export async function fetchDirections(origin: LatLng, destination: LatLng): Promise<DirectionsResult> {
  const url =
    `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.latitude},${origin.longitude}` +
    `&destination=${destination.latitude},${destination.longitude}&key=${GOOGLE_MAPS_API_KEY}`;

  try {
    const res = await fetch(url);

    if (!res.ok) {
      console.warn(`Directions request failed with status ${res.status}`);
      return buildFallbackRoute(origin, destination);
    }

    const json = await res.json();

    if (!json.routes?.length) {
      console.warn('Directions API returned no routes; using fallback polyline.');
      return buildFallbackRoute(origin, destination);
    }

    const route = json.routes[0];
    const points = polyline.decode(route.overview_polyline.points);
    const coords = points.map(([lat, lng]: [number, number]) => ({ latitude: lat, longitude: lng }));

    if (!coords.length) {
      console.warn('Decoded polyline was empty; using fallback polyline.');
      return buildFallbackRoute(origin, destination);
    }

    const eta = route.legs?.[0]?.duration?.text ?? null;
    return { coords, eta };
  } catch (error) {
    console.error('Directions request failed; using fallback polyline.', error);
    return buildFallbackRoute(origin, destination);
  }
}
