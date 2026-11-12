export type LngLat = [number, number];

const R = 6371008.8;
const RAD = Math.PI / 180;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}



/** Metres per degree at NCR's latitude. Good to well under 1% across the coverage box. */
export const M_PER_DEG_LAT = 110_950;
export const M_PER_DEG_LON = 111_320 * Math.cos(28.5 * RAD);

/** Fast planar distance in metres; fine for the sub-2 km radii used in scoring. */
export function flatDist(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dx = (lon2 - lon1) * M_PER_DEG_LON;
  const dy = (lat2 - lat1) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distance from point p to segment ab, all planar metres relative to p. */
export function pointSegDist(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return Math.sqrt(x * x + y * y);
}

/** Bearing in degrees [0, 180): undirected, since a road and a route can run either way. */
export function axis(dxM: number, dyM: number): number {
  const deg = (Math.atan2(dxM, dyM) / RAD + 360) % 180;
  return deg;
}

export function axisDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
}

export interface Sample {
  lon: number;
  lat: number;
  /** Distance along the route, metres. */
  at: number;
  /** Undirected bearing of the route here. */
  axis: number;
}

/** Points every `step` metres along a polyline (plus the final vertex). */
export function resample(coords: LngLat[], step: number): Sample[] {
  const out: Sample[] = [];
  let next = 0;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1];
    const [lon2, lat2] = coords[i];
    const dx = (lon2 - lon1) * M_PER_DEG_LON;
    const dy = (lat2 - lat1) * M_PER_DEG_LAT;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) continue;
    const ax = axis(dx, dy);
    while (next <= total + len) {
      const t = (next - total) / len;
      out.push({ lon: lon1 + t * (lon2 - lon1), lat: lat1 + t * (lat2 - lat1), at: next, axis: ax });
      next += step;
    }
    total += len;
  }
  const last = coords[coords.length - 1];
  if (out.length === 0 || out[out.length - 1].at < total - 1) {
    const prev = out[out.length - 1];
    out.push({ lon: last[0], lat: last[1], at: total, axis: prev ? prev.axis : 0 });
  }
  return out;
}

/** Douglas-Peucker in planar metres, for shipping lighter geometry to the browser. */
export function simplify(coords: LngLat[], tolM: number): LngLat[] {
  if (coords.length < 3) return coords;
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [ax, ay] = [coords[s][0] * M_PER_DEG_LON, coords[s][1] * M_PER_DEG_LAT];
    const [bx, by] = [coords[e][0] * M_PER_DEG_LON, coords[e][1] * M_PER_DEG_LAT];
    let best = -1;
    let bestD = tolM;
    for (let i = s + 1; i < e; i++) {
      const d = pointSegDist(coords[i][0] * M_PER_DEG_LON, coords[i][1] * M_PER_DEG_LAT, ax, ay, bx, by);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}
