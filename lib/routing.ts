import { LngLat, M_PER_DEG_LAT, M_PER_DEG_LON, haversine, resample } from "./geo";

export type Mode = "walk" | "drive";

export interface Candidate {
  coords: LngLat[];
  distance: number; // m
  duration: number; // s
  /** Main roads OSRM names for this route, e.g. "Golf Course Road, MG Road". */
  via: string;
  /** How the candidate was generated: the router's own alternatives, or a detour through a via point. */
  origin: "osrm" | "via";
}

/**
 * FOSSGIS's public OSRM instances (routing.openstreetmap.de) serve separate car and foot graphs
 * built from current OSM data. They allow light, non-commercial use with an identifying UA; for
 * real traffic, run your own OSRM and point OSRM_CAR_URL / OSRM_FOOT_URL at it.
 */
const PROFILES: Record<Mode, string> = {
  drive: process.env.OSRM_CAR_URL ?? "https://routing.openstreetmap.de/routed-car/route/v1/driving",
  walk: process.env.OSRM_FOOT_URL ?? "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
};

const UA = process.env.ROUTER_USER_AGENT ?? "ghartak/0.1 (night-safety route comparison; NCR)";

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { coordinates: LngLat[] };
  legs: { summary: string }[];
}

const osrmCache = new Map<string, { at: number; data: OsrmRoute[] }>();
const OSRM_CACHE_TTL = 30 * 60_000;

/** One retry after a short pause for timeouts, network errors, 429 and 5xx from the shared router. */
async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6_000) });
      if ((res.status === 429 || res.status >= 500) && attempt < 1) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      return res;
    } catch (e) {
      if (attempt >= 1) throw e;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw new Error("Router connection timed out");
}

async function osrm(mode: Mode, points: LngLat[], alternatives: boolean): Promise<OsrmRoute[]> {
  const coords = points.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(";");
  const url =
    `${PROFILES[mode]}/${coords}?overview=full&geometries=geojson&steps=true` +
    (alternatives ? "&alternatives=3" : "") +
    (points.length > 2 ? "&continue_straight=true" : "");

  const now = Date.now();
  const cached = osrmCache.get(url);
  if (cached && now - cached.at < OSRM_CACHE_TTL) {
    return cached.data;
  }

  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`router ${res.status}`);
  const body = await res.json();
  if (body.code !== "Ok") {
    if (body.code === "NoRoute" || body.code === "NoSegment") return [];
    throw new Error(`router ${body.code}`);
  }
  const routes = body.routes as OsrmRoute[];
  osrmCache.set(url, { at: now, data: routes });
  if (osrmCache.size > 500) {
    for (const [k, v] of osrmCache) if (now - v.at >= OSRM_CACHE_TTL || osrmCache.size > 500) osrmCache.delete(k);
  }
  return routes;
}

function toCandidate(r: OsrmRoute, origin: Candidate["origin"]): Candidate {
  const via = [...new Set(r.legs.flatMap((l) => l.summary.split(",").map((s) => s.trim())).filter(Boolean))]
    .slice(0, 3)
    .join(", ");
  return { coords: r.geometry.coordinates, distance: r.distance, duration: r.duration, via, origin };
}

/** The router's single best route between two points, or null if there is none. */
export async function singleRoute(mode: Mode, from: LngLat, to: LngLat): Promise<Candidate | null> {
  const r = (await osrm(mode, [from, to], false))[0];
  return r ? toCandidate(r, "osrm") : null;
}

/** Share of a's length lying within tolM of b. Used to drop near-duplicate candidates. */
function overlap(a: LngLat[], b: LngLat[], tolM = 35): number {
  const sa = resample(a, 40);
  const sb = resample(b, 20);
  const cell = 0.0005;
  const grid = new Map<string, LngLat[]>();
  for (const p of sb) {
    const k = `${Math.floor(p.lon / cell)},${Math.floor(p.lat / cell)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push([p.lon, p.lat]);
  }
  let hit = 0;
  for (const p of sa) {
    const cx = Math.floor(p.lon / cell);
    const cy = Math.floor(p.lat / cell);
    let found = false;
    for (let dx = -1; dx <= 1 && !found; dx++) {
      for (let dy = -1; dy <= 1 && !found; dy++) {
        for (const q of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const d = Math.hypot((q[0] - p.lon) * M_PER_DEG_LON, (q[1] - p.lat) * M_PER_DEG_LAT);
          if (d < tolM) {
            found = true;
            break;
          }
        }
      }
    }
    if (found) hit++;
  }
  return sa.length ? hit / sa.length : 1;
}

/**
 * Points either side of the straight line between from and to, to coax out genuinely different
 * routes. `snap` moves each onto a nearby main road; a via point left in the middle of a sector
 * tends to land on a dead-end lane and produce an out-and-back detour nobody would take.
 */
function viaPoints(from: LngLat, to: LngLat, mode: Mode, snap: (p: LngLat) => LngLat | null): LngLat[] {
  const straight = haversine(from, to);
  const fx = from[0] * M_PER_DEG_LON, fy = from[1] * M_PER_DEG_LAT;
  const tx = to[0] * M_PER_DEG_LON, ty = to[1] * M_PER_DEG_LAT;
  const len = Math.hypot(tx - fx, ty - fy) || 1;
  const nx = -(ty - fy) / len, ny = (tx - fx) / len;
  const cap = mode === "walk" ? 700 : 3000;
  const out: LngLat[] = [];
  // Two distances on each side of the straight line: a near and a wider detour.
  for (const share of [0.2, 0.38]) {
    const off = Math.min(straight * share, cap * (share / 0.2));
    for (const side of [1, -1]) {
      const x = fx + (tx - fx) * 0.5 + nx * off * side;
      const y = fy + (ty - fy) * 0.5 + ny * off * side;
      const p = snap([x / M_PER_DEG_LON, y / M_PER_DEG_LAT]);
      if (p && !out.some((q) => haversine(p, q) < 150)) out.push(p);
    }
  }
  return out;
}

/**
 * Up to `max` distinct candidate routes: the router's own alternatives first, then detours
 * through via points. Candidates much slower than the fastest are dropped -- the point is to
 * surface a few realistic trade-offs, not every possible path.
 */
export async function candidates(
  from: LngLat, to: LngLat, mode: Mode, snap: (p: LngLat) => LngLat | null, max = 3,
): Promise<Candidate[]> {
  const primary = (await osrm(mode, [from, to], true)).map((r) => toCandidate(r, "osrm"));
  if (!primary.length) return [];
  const detours = await Promise.allSettled(
    viaPoints(from, to, mode, snap).map((v) => osrm(mode, [from, v, to], false)),
  );
  const pool = [...primary];
  for (const d of detours) {
    if (d.status === "fulfilled" && d.value[0]) pool.push(removeSpurs(toCandidate(d.value[0], "via")));
  }

  const fastest = Math.min(...pool.map((c) => c.duration));
  const slack = mode === "walk" ? 1.45 : 1.5;
  const kept: Candidate[] = [];
  for (const c of pool.sort((a, b) => a.duration - b.duration)) {
    if (c.duration > fastest * slack + 120) continue;
    // Loop and overshoot checks are only for our own via-point detours. The router's routes keep
    // their loops: a car on a divided road often has to pass the start or the destination and
    // U-turn, and rejecting that left driving trips with no route at all.
    if (c.origin === "via" && (hasLoop(c.coords) || overshoots(c.coords, from, to))) continue;
    // Different enough if either route has >15% of its length away from the other.
    if (kept.some((k) => overlap(c.coords, k.coords) > 0.85 && overlap(k.coords, c.coords) > 0.85)) continue;
    kept.push(c);
    if (kept.length === max) break;
  }
  return kept;
}

/**
 * Forcing a route through a via point often adds an out-and-back spur or a loop round a block (a
 * car on a divided road has to U-turn to reach the point). When the route comes back within ~20 m
 * of where it already was, within 2.5 km of travel, the part in between is cut out. What remains is
 * still a continuous path on real roads; distance and time are reduced in proportion.
 */
function removeSpurs(c: Candidate): Candidate {
  const cell = (p: LngLat) => `${Math.round(p[0] / 0.0002)},${Math.round(p[1] / 0.0002)}`;
  const out: LngLat[] = [];
  const at: number[] = []; // distance along the original route for each kept point
  const seen = new Map<string, number>(); // cell -> index in out
  let along = 0;
  let cut = false;
  for (let i = 0; i < c.coords.length; i++) {
    const p = c.coords[i];
    if (i > 0) along += haversine(c.coords[i - 1], p);
    const k = cell(p);
    const j = seen.get(k);
    if (j !== undefined && j < out.length - 1 && along - at[j] > 60 && along - at[j] < 2500) {
      for (let q = j + 1; q < out.length; q++) if (seen.get(cell(out[q])) === q) seen.delete(cell(out[q]));
      out.length = j + 1;
      at.length = j + 1;
      cut = true;
      continue;
    }
    out.push(p);
    at.push(along);
    if (!seen.has(k)) seen.set(k, out.length - 1);
  }
  if (!cut || out.length < 2) return c;
  // Scale distance and time by the length actually kept (measured on the final path, so
  // spurs removed in several steps are not counted twice).
  let kept = 0;
  for (let i = 1; i < out.length; i++) kept += haversine(out[i - 1], out[i]);
  const ratio = Math.min(1, kept / Math.max(1, along));
  return { ...c, coords: out, distance: c.distance * ratio, duration: c.duration * ratio };
}

/** Via-point detours sometimes go out and back along the same street; those are not real options. */
function hasLoop(coords: LngLat[]): boolean {
  const s = resample(coords, 30);
  const seen = new Map<string, number>();
  let back = 0;
  for (let i = 0; i < s.length; i++) {
    const k = `${Math.round(s[i].lon / 0.0003)},${Math.round(s[i].lat / 0.0003)}`;
    const j = seen.get(k);
    if (j !== undefined && i - j > 6) back++;
    else if (j === undefined) seen.set(k, i);
  }
  return back * 30 > 250;
}

/** A detour that passes the destination (or the start) and then doubles back to it. */
function overshoots(coords: LngLat[], from: LngLat, to: LngLat): boolean {
  const s = resample(coords, 25);
  const total = s[s.length - 1].at;
  return s.some(
    (p) =>
      (p.at < total - 400 && haversine([p.lon, p.lat], to) < 120) ||
      (p.at > 400 && haversine([p.lon, p.lat], from) < 120),
  );
}
