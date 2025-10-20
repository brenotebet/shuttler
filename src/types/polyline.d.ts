declare module '@mapbox/polyline' {
  type LatLngTuple = [number, number];
  interface Polyline {
    decode(text: string, precision?: number): LatLngTuple[];
    encode(coordinates: LatLngTuple[], precision?: number): string;
  }
  const polyline: Polyline;
  export = polyline;
}
