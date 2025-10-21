declare module '@mapbox/polyline' {
  type LatLngTuple = [number, number];

  export function decode(text: string, precision?: number): LatLngTuple[];
  export function encode(coordinates: LatLngTuple[], precision?: number): string;
}
