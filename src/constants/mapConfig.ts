import { MapStyleElement } from 'react-native-maps';

export const campusCoords = [
  { latitude: 38.59678, longitude: -89.82788 },
  { latitude: 38.59667, longitude: -89.79585 },
  { latitude: 38.61627, longitude: -89.80259 },
  { latitude: 38.61775, longitude: -89.82802 },
];

export const outerRing = [
  { latitude: 90, longitude: -180 },
  { latitude: 90, longitude: 180 },
  { latitude: -90, longitude: 180 },
  { latitude: -90, longitude: -180 },
];

export const grayscaleMapStyle: MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f5f5f5' }] },
  {
    featureType: 'administrative.land_parcel',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#bdbdbd' }],
  },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#eeeeee' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  {
    featureType: 'road.arterial',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#757575' }],
  },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#dadada' }] },
  {
    featureType: 'road.highway',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#616161' }],
  },
  { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
  { featureType: 'transit.line', elementType: 'geometry', stylers: [{ color: '#e5e5e5' }] },
  { featureType: 'transit.station', elementType: 'geometry', stylers: [{ color: '#eeeeee' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9c9c9' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
];

export const MIN_LAT_DELTA = 0.005;
export const MAX_LAT_DELTA = 0.1;
export const MIN_LON_DELTA = 0.005;
export const MAX_LON_DELTA = 0.02;
