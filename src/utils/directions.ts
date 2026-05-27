import { GOOGLE_MAPS_API_KEY } from '../../config';

import * as polyline from '@mapbox/polyline';

export type LatLng = { latitude: number; longitude: number };

export type DirectionsResult = { coords: LatLng[]; eta: string | null };

const GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const OSRM_DIRECTIONS_URL = 'https://router.project-osrm.org/route/v1/driving';

const formatEtaFromSeconds = (seconds: unknown): string | null => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return null;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes <= 0) return '< 1 min';
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'}`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours} hr${hours === 1 ? '' : 's'}`;
  return `${hours} hr ${remainingMinutes} min${remainingMinutes === 1 ? '' : 's'}`;
};

const fetchGoogleRoute = async (
  origin: LatLng,
  destination: LatLng,
): Promise<DirectionsResult | null> => {
  try {
    const res = await fetch(GOOGLE_ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } },
        destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } },
        travelMode: 'DRIVE',
      }),
    });

    if (!res.ok) {
      console.warn(`Google Routes API request failed with status ${res.status}`);
      return null;
    }

    const json = await res.json();
    const route = json.routes?.[0];
    if (!route) {
      console.warn('Google Routes API returned no routes.');
      return null;
    }

    const encoded = route.polyline?.encodedPolyline;
    if (!encoded) return null;

    const coords = (polyline.decode(encoded) as [number, number][]).map(
      ([lat, lng]) => ({ latitude: lat, longitude: lng }),
    );
    if (!coords.length) return null;

    const durationSeconds = route.duration ? parseInt(route.duration, 10) : null;
    const eta = formatEtaFromSeconds(durationSeconds);

    return { coords, eta };
  } catch (error) {
    console.error('Google Routes API request failed.', error);
    return null;
  }
};

const fetchOsrmRoute = async (
  origin: LatLng,
  destination: LatLng
): Promise<DirectionsResult | null> => {
  const url =
    `${OSRM_DIRECTIONS_URL}/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}` +
    '?overview=full&geometries=geojson';

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`OSRM directions request failed with status ${res.status}`);
      return null;
    }

    const json = await res.json();
    if (!json.routes?.length) {
      console.warn('OSRM directions returned no routes.');
      return null;
    }

    const geometry = json.routes[0]?.geometry?.coordinates;
    if (!geometry?.length) {
      console.warn('OSRM directions geometry was empty.');
      return null;
    }

    const coords = geometry.map(([lng, lat]: [number, number]) => ({ latitude: lat, longitude: lng }));
    if (!coords.length) {
      return null;
    }

    return { coords, eta: formatEtaFromSeconds(json.routes[0]?.duration) };
  } catch (error) {
    console.error('OSRM directions request failed.', error);
    return null;
  }
};

export async function fetchDirections(
  origin: LatLng,
  destination: LatLng
): Promise<DirectionsResult> {
  const googleRoute = await fetchGoogleRoute(origin, destination);
  if (googleRoute) {
    return googleRoute;
  }

  const osrmRoute = await fetchOsrmRoute(origin, destination);
  if (osrmRoute) {
    return osrmRoute;
  }

  return { coords: [], eta: null };
}
