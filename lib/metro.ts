import { Dataset, MetroLine } from "./data";
import { LngLat, flatDist } from "./geo";
import { singleRoute } from "./routing";
import { ScoredRoute, scoreRoute } from "./score";

/**
 * Walk + metro + walk trips over the metro network mapped in OpenStreetMap.
 *
 * OSM has the lines and their ordered stops but no timetables, and DMRC's official GTFS is not
 * openly licensed. Ride times are therefore ESTIMATES: straight-line distance between stops at the
 * average speed implied by the one complete OSM line that carries a `duration` tag (computed in the
 * data build), plus fixed allowances for waiting and changing lines. The app labels them as such.
 */
export const ASSUMPTIONS = {
  /** Waiting for a train each time you board. Night headways are longer than daytime ones. */
  waitMin: 8,
  /** Changing lines inside an interchange, on top of the walk between the two stops. */
  changeMin: 3,
  /** Stops of different lines this close count as one interchange. */
  interchangeM: 350,
  /** Walking-leg limits for considering a station. */
  maxWalkM: 2000,
  candidateStations: 4,
  /** Walking speed used only to shortlist stations; the real legs come from the foot router. */
  walkMps: 1.25,
  detour: 1.3,
};

const FALLBACK_SPEED_KMH = 32;

/**
 * When each network runs, in IST minutes after midnight. Walk + metro is only offered when the whole
 * ride fits inside these hours. They are deliberately the usual published hours, not the latest
 * train at any one station:
 * - Noida Metro (NMRC) and Namo Bharat (NCRTC): 6 am Monday–Saturday, 8 am Sunday, last train 10 pm
 *   (nmrcnoida.com train timings; NCRTC service notices).
 * - Delhi Metro (DMRC) publishes times per station; trains run from about 6 am, and the routine last
 *   trains leave the terminals around 11 pm.
 * - Rapid Metro Gurugram: about 6 am to 10 pm.
 * Event days (IPL matches, Diwali, exams) change these; the app still says to check the last train.
 */
export interface ServiceHours {
  network: string;
  operator: RegExp;
  first: number;
  sundayFirst: number;
  last: number;
}

export const SERVICE_HOURS: ServiceHours[] = [
  { network: "Noida Metro", operator: /NMRC|Noida Metro/i, first: 6 * 60, sundayFirst: 8 * 60, last: 22 * 60 },
  { network: "Namo Bharat", operator: /NCRTC|National Capital Region Transport/i, first: 6 * 60, sundayFirst: 8 * 60, last: 22 * 60 },
  { network: "Rapid Metro Gurugram", operator: /Rapid Metro/i, first: 6 * 60, sundayFirst: 6 * 60, last: 22 * 60 },
  { network: "Delhi Metro", operator: /.*/, first: 6 * 60, sundayFirst: 6 * 60, last: 23 * 60 },
];

const hoursFor = (operator: string) => SERVICE_HOURS.find((h) => h.operator.test(operator))!;

const clockText = (min: number) => {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
};

/** IST minutes after midnight and weekday (0 = Sunday) of a moment. */
function ist(t: Date): { min: number; day: number } {
  const local = new Date(t.getTime() + 330 * 60_000);
  return { min: local.getUTCHours() * 60 + local.getUTCMinutes(), day: local.getUTCDay() };
}

/**
 * Why this walk + metro trip cannot run at its time, or null if every line on it is running from
 * boarding until the last stop.
 */
export function outsideServiceHours(m: MetroOption): string | null {
  const board = ist(new Date(m.board.at));
  const alight = ist(new Date(m.alight.at));
  const crossesMidnight = alight.min < board.min;
  const used = [...new Set(m.ride.segments.map((s) => hoursFor(s.operator)))];
  for (const h of used) {
    const first = board.day === 0 ? h.sundayFirst : h.first;
    const early = board.min < first;
    if (early || alight.min > h.last || crossesMidnight) {
      const sunday = h.sundayFirst !== h.first ? ` (from ${clockText(h.sundayFirst)} on Sundays)` : "";
      const when = early && !crossesMidnight
        ? `you would board around ${clockText(board.min)}`
        : `this ride would end around ${clockText(alight.min)}`;
      return `${h.network} runs from about ${clockText(h.first)}${sunday} to ${clockText(h.last)}, and ${when}.`;
    }
  }
  return null;
}

interface Node {
  line: number;
  stop: number;
  lon: number;
  lat: number;
  name: string;
}

interface Graph {
  nodes: Node[];
  /** adjacency: [to, seconds, kind] with kind 0 = ride, 1 = change */
  adj: [number, number, 0 | 1][][];
  speedMps: number;
}

let graph: Graph | null = null;

function buildGraph(ds: Dataset): Graph {
  if (graph) return graph;
  const speedMps = ((ds.metro.speedKmh ?? FALLBACK_SPEED_KMH) * 1000) / 3600;
  const nodes: Node[] = [];
  const first: number[] = [];
  ds.metro.lines.forEach((l, li) => {
    first.push(nodes.length);
    l.stops.forEach((s, si) => nodes.push({ line: li, stop: si, lon: s.lon, lat: s.lat, name: s.name }));
  });
  const adj: Graph["adj"] = nodes.map(() => []);
  ds.metro.lines.forEach((l, li) => {
    for (let i = 0; i + 1 < l.stops.length; i++) {
      const a = first[li] + i;
      const d = flatDist(nodes[a].lon, nodes[a].lat, nodes[a + 1].lon, nodes[a + 1].lat);
      adj[a].push([a + 1, d / speedMps, 0]);
    }
  });
  // Interchanges: any two stops on different lines within interchangeM of each other.
  for (let a = 0; a < nodes.length; a++) {
    for (let b = 0; b < nodes.length; b++) {
      if (nodes[a].line === nodes[b].line) continue;
      const d = flatDist(nodes[a].lon, nodes[a].lat, nodes[b].lon, nodes[b].lat);
      if (d <= ASSUMPTIONS.interchangeM) {
        adj[a].push([b, d / ASSUMPTIONS.walkMps + (ASSUMPTIONS.changeMin + ASSUMPTIONS.waitMin) * 60, 1]);
      }
    }
  }
  graph = { nodes, adj, speedMps };
  return graph;
}

/** Nearest stations to p, one node set per distinct station name, by straight-line distance. */
function nearStations(g: Graph, p: LngLat): { name: string; nodes: number[]; d: number; at: LngLat }[] {
  const by = new Map<string, { name: string; nodes: number[]; d: number; at: LngLat }>();
  g.nodes.forEach((n, i) => {
    const d = flatDist(p[0], p[1], n.lon, n.lat);
    if (d > ASSUMPTIONS.maxWalkM) return;
    const key = n.name.toLowerCase();
    const cur = by.get(key);
    if (!cur) by.set(key, { name: n.name, nodes: [i], d, at: [n.lon, n.lat] });
    else {
      cur.nodes.push(i);
      if (d < cur.d) {
        cur.d = d;
        cur.at = [n.lon, n.lat];
      }
    }
  });
  return [...by.values()].sort((a, b) => a.d - b.d).slice(0, ASSUMPTIONS.candidateStations);
}

const estWalk = (d: number) => (d * ASSUMPTIONS.detour) / ASSUMPTIONS.walkMps;

export interface RideSegment {
  line: string;
  ref: string;
  colour: string;
  operator: string;
  from: string;
  to: string;
  stops: number;
  coords: LngLat[];
  /** Every station on this ride, in order, with the estimated seconds after boarding the train. */
  stations: { name: string; at: LngLat; t: number }[];
}

export interface MetroOption {
  id: number;
  score: number | null;
  duration: number;
  walkDistance: number;
  legs: [ScoredRoute, ScoredRoute];
  ride: { segments: RideSegment[]; seconds: number };
  board: { station: string; at: string };
  alight: { station: string; at: string; arrive: string };
  assumptions: typeof ASSUMPTIONS & { speedKmh: number; speedSource: string[] };
}

export const METRO_OPTION_ID = 100;

/**
 * Best estimated walk + metro + walk trip, or null when there is no station within walking range
 * at both ends or the metro would not beat walking.
 */
export async function planMetro(
  ds: Dataset, from: LngLat, to: LngLat, depart: Date, fastestWalkS: number, teen = false,
): Promise<MetroOption | null> {
  const g = buildGraph(ds);
  if (flatDist(from[0], from[1], to[0], to[1]) < 1500) return null;
  const access = nearStations(g, from);
  const egress = nearStations(g, to);
  if (!access.length || !egress.length) return null;

  // Dijkstra from all access stations at once; each starts with its estimated walk + a wait.
  const n = g.nodes.length;
  const cost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const origin = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  access.forEach((st, ai) => {
    for (const v of st.nodes) {
      const c = estWalk(st.d) + ASSUMPTIONS.waitMin * 60;
      if (c < cost[v]) {
        cost[v] = c;
        origin[v] = ai;
      }
    }
  });
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && cost[i] < Infinity && (u < 0 || cost[i] < cost[u])) u = i;
    if (u < 0) break;
    done[u] = 1;
    for (const [v, w] of g.adj[u]) {
      if (cost[u] + w < cost[v]) {
        cost[v] = cost[u] + w;
        prev[v] = u;
        origin[v] = origin[u];
      }
    }
  }
  let best = -1, bestTotal = Infinity;
  for (const st of egress) {
    for (const v of st.nodes) {
      const total = cost[v] + estWalk(st.d);
      if (total < bestTotal) {
        bestTotal = total;
        best = v;
      }
    }
  }
  if (best < 0 || !(bestTotal < fastestWalkS * 0.9)) return null;

  // Reconstruct the ride, then fetch the real walking legs from the foot router.
  const path: number[] = [];
  for (let v = best; v >= 0; v = prev[v]) path.unshift(v);
  const boardNode = g.nodes[path[0]];
  const alightNode = g.nodes[path[path.length - 1]];
  if (boardNode.name.toLowerCase() === alightNode.name.toLowerCase()) return null;

  const [leg1, leg2] = await Promise.all([
    singleRoute("walk", from, [boardNode.lon, boardNode.lat]),
    singleRoute("walk", [alightNode.lon, alightNode.lat], to),
  ]);
  if (!leg1 || !leg2) return null;

  const segments: RideSegment[] = [];
  let rideS = 0;
  for (let i = 0; i < path.length; i++) {
    const nd = g.nodes[path[i]];
    if (i > 0) {
      const edge = g.adj[path[i - 1]].find(([v]) => v === path[i]);
      if (edge) rideS += edge[1];
    }
    const line: MetroLine = ds.metro.lines[nd.line];
    const last = segments[segments.length - 1];
    const station = { name: nd.name, at: [nd.lon, nd.lat] as LngLat, t: Math.round(rideS) };
    if (!last || i === 0 || g.nodes[path[i - 1]].line !== nd.line) {
      segments.push({
        line: line.name.replace(/\s*\(.*\)$/, "").replace(/:.*$/, ""), ref: line.ref, colour: line.colour,
        operator: line.operator, from: nd.name, to: nd.name, stops: 0, coords: [[nd.lon, nd.lat]], stations: [station],
      });
    } else {
      last.to = nd.name;
      last.stops++;
      last.coords.push([nd.lon, nd.lat]);
      last.stations.push(station);
    }
  }
  const rideSegments = segments.filter((s) => s.stops > 0);
  rideS += ASSUMPTIONS.waitMin * 60;

  const boardAt = new Date(depart.getTime() + leg1.duration * 1000);
  const alightAt = new Date(boardAt.getTime() + rideS * 1000);
  const arrive = new Date(alightAt.getTime() + leg2.duration * 1000);
  const s1 = scoreRoute(ds, leg1, "walk", depart, METRO_OPTION_ID + 1, teen);
  const s2 = scoreRoute(ds, leg2, "walk", alightAt, METRO_OPTION_ID + 2, teen);
  const walked = leg1.distance + leg2.distance;
  const score =
    s1.score === null || s2.score === null
      ? null
      : Math.round((s1.score * leg1.distance + s2.score * leg2.distance) / Math.max(1, walked));

  return {
    id: METRO_OPTION_ID,
    score,
    duration: Math.round((arrive.getTime() - depart.getTime()) / 1000),
    walkDistance: Math.round(walked),
    legs: [s1, s2],
    ride: { segments: rideSegments, seconds: Math.round(rideS) },
    board: { station: boardNode.name, at: boardAt.toISOString() },
    alight: { station: alightNode.name, at: alightAt.toISOString(), arrive: arrive.toISOString() },
    assumptions: {
      ...ASSUMPTIONS,
      speedKmh: ds.metro.speedKmh ?? FALLBACK_SPEED_KMH,
      speedSource: ds.metro.speedSource,
    },
  };
}
