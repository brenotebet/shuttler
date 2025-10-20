import polyline from '@mapbox/polyline';
import { GOOGLE_MAPS_API_KEY } from '../../config';

// Metro still prefers CommonJS for this dependency, so we use the TS "import =" syntax
// to keep the statement at the top level while preserving compatibility.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import polyline = require('@mapbox/polyline');

export type LatLng = { latitude: number; longitude: number };

export type DirectionsResult = { coords: LatLng[]; eta: string | null };

const GOOGLE_DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const OSRM_DIRECTIONS_URL = 'https://router.project-osrm.org/route/v1/driving';

const toCoordinateArray = (points: [number, number][]): LatLng[] =>
  points.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));

const decodeGoogleRoute = (route: any): DirectionsResult | null => {
  const overview = route?.overview_polyline?.points;
  if (!overview) {
    console.warn('Google Directions response did not include an overview polyline.');
    return null;
  }

  const coords = toCoordinateArray(polyline.decode(overview));
  if (!coords.length) {
    console.warn('Google Directions polyline decoded to 0 coordinates.');
    return null;
  }

  return { coords, eta: route.legs?.[0]?.duration?.text ?? null };
};

const formatEtaFromSeconds = (seconds: unknown): string | null => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return null;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes <= 0) {
    return '< 1 min';
  }
  if (minutes < 60) {
    return `${minutes} min${minutes === 1 ? '' : 's'}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} hr${hours === 1 ? '' : 's'}`;
  }
  return `${hours} hr ${remainingMinutes} min${remainingMinutes === 1 ? '' : 's'}`;
};

const fetchGoogleRoute = async (
  origin: LatLng,
  destination: LatLng
): Promise<DirectionsResult | null> => {
  const url =
    `${GOOGLE_DIRECTIONS_URL}?origin=${origin.latitude},${origin.longitude}` +
    `&destination=${destination.latitude},${destination.longitude}&mode=driving&key=${GOOGLE_MAPS_API_KEY}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`Google Directions request failed with status ${res.status}`);
      return null;
    }

    const json = await res.json();
    if (json.status !== 'OK') {
      console.warn(
        `Google Directions responded with status ${json.status}${json.error_message ? `: ${json.error_message}` : ''}`
      );
      return null;
    }

    if (!json.routes?.length) {
      console.warn('Google Directions returned no routes.');
      return null;
    }

    return decodeGoogleRoute(json.routes[0]);
  } catch (error) {
    console.error('Google Directions request failed.', error);
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
