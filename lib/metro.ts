import { Dataset, MetroLine } from "./data";
import { LngLat, M_PER_DEG_LAT, M_PER_DEG_LON, flatDist } from "./geo";
import { Candidate, singleRoute } from "./routing";
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
  /** Waiting for a train each time you board, by day (7 am-10 pm) and late at night. */
  waitDayMin: 5,
  waitNightMin: 8,
  /** Waiting for a train each time you board, for this trip (set per trip from the two above). */
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
  /** [to, seconds, kind]: 0 ride, 1 change of line (+ change time and a wait), 2 same line's branch. */
  adj: [number, number, 0 | 1 | 2][][];
  speedMps: number;
}

let graph: Graph | null = null;

/** "Green Line (Kirti Nagar => Ashok Park Main)" -> "green line". */
const family = (name: string) => name.replace(/\s*\(.*\)$/, "").replace(/:.*$/, "").trim().toLowerCase();

/** Seconds a transfer edge really costs on this trip. */
const transferS = (kind: 0 | 1 | 2, waitS: number) => (kind === 1 ? ASSUMPTIONS.changeMin * 60 + waitS : kind === 2 ? 60 : 0);

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
        // Branches and directions of one line (OSM maps the Green Line as several routes) are the same
        // trains: crossing between them is not a real change of line.
        adj[a].push([b, d / ASSUMPTIONS.walkMps, family(ds.metro.lines[nodes[a].line].name) === family(ds.metro.lines[nodes[b].line].name) ? 2 : 1]);
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
  /** The line's terminal in the direction of travel: "towards Noida Electronic City". */
  towards: string;
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
 * The walk between a place and a station. A station's mapped point often sits over a road or rail
 * line that people can't walk on (Mundka is above Rohtak Road), and the foot router then snaps it to
 * the wrong side and invents a detour: 8 km to reach a station 230 m away. When the walk is far longer
 * than the distance, try points around the station and keep the shortest walk that ends near it.
 */
async function stationWalk(place: LngLat, station: LngLat, dir: "to" | "from"): Promise<Candidate | null> {
  const route = (p: LngLat) => (dir === "to" ? singleRoute("walk", place, p) : singleRoute("walk", p, place));
  const straight = flatDist(place[0], place[1], station[0], station[1]);
  const direct = await route(station).catch(() => null);
  if (direct && direct.distance <= straight * 2.2 + 500) return direct;
  let best = direct;
  // Test 4 cardinal offsets (80m) to clear railway embankments / overpasses without overloading router
  const offsets: LngLat[] = [
    [station[0], station[1] + 80 / M_PER_DEG_LAT],
    [station[0], station[1] - 80 / M_PER_DEG_LAT],
    [station[0] + 80 / M_PER_DEG_LON, station[1]],
    [station[0] - 80 / M_PER_DEG_LON, station[1]],
  ];
  const tries = await Promise.allSettled(offsets.map(route));
  for (const t of tries) {
    if (t.status !== "fulfilled" || !t.value) continue;
    if (!best || t.value.duration < best.duration) best = t.value;
  }
  return best;
}

/**
 * Up to three walk + metro + walk options, fastest first: the quickest ride, the one with fewest line
 * changes, and one that changes somewhere else. Each must beat walking, and the alternatives must be
 * within 25 minutes of the fastest. Empty when there is no station within walking range at both ends.
 */
export async function planMetroOptions(
  ds: Dataset, from: LngLat, to: LngLat, depart: Date, fastestWalkS: number, teen = false,
): Promise<MetroOption[]> {
  const g = buildGraph(ds);
  const istH = ((depart.getTime() / 3_600_000 + 5.5) % 24 + 24) % 24;
  const waitMin = istH >= 7 && istH < 22 ? ASSUMPTIONS.waitDayMin : ASSUMPTIONS.waitNightMin;
  const waitS = waitMin * 60;
  if (flatDist(from[0], from[1], to[0], to[1]) < 1500) return [];
  const access = nearStations(g, from);
  const egress = nearStations(g, to);
  if (!access.length || !egress.length) return [];

  /** Dijkstra from all access stations at once; extraChangeS penalises changes, banned names can't be changed at. */
  const search = (extraChangeS: number, banned: Set<string>) => {
    const n = g.nodes.length;
    const cost = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    for (const st of access) for (const v of st.nodes) cost[v] = Math.min(cost[v], estWalk(st.d) + waitS);
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && cost[i] < Infinity && (u < 0 || cost[i] < cost[u])) u = i;
      if (u < 0) break;
      done[u] = 1;
      for (const [v, w, kind] of g.adj[u]) {
        if (kind === 1 && banned.has(g.nodes[u].name)) continue;
        const step = w + transferS(kind, waitS) + (kind === 1 ? extraChangeS : 0);
        if (cost[u] + step < cost[v]) {
          cost[v] = cost[u] + step;
          prev[v] = u;
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
    if (best < 0) return null;
    const path: number[] = [];
    for (let v = best; v >= 0; v = prev[v]) path.unshift(v);
    return path;
  };

  const changesOf = (path: number[]) => {
    const out: string[] = [];
    for (let i = 1; i < path.length; i++) {
      const e = g.adj[path[i - 1]].find(([v]) => v === path[i]);
      if (e && e[2] === 1) out.push(g.nodes[path[i - 1]].name);
    }
    return out;
  };
  const signature = (path: number[]) =>
    [g.nodes[path[0]].name, ...path.map((v) => family(ds.metro.lines[g.nodes[v].line].name)).filter((f, i, a) => f !== a[i - 1]),
      g.nodes[path[path.length - 1]].name].join("|");

  const first = search(0, new Set());
  if (!first) return [];
  const paths = [first];
  const fewest = search(15 * 60, new Set());
  const elsewhere = changesOf(first).length ? search(0, new Set(changesOf(first))) : null;
  for (const p of [fewest, elsewhere]) {
    if (p && !paths.some((q) => signature(q) === signature(p))) paths.push(p);
  }

  // Walking legs are shared between options that use the same stations.
  const walks = new Map<string, Promise<Candidate | null>>();
  const walk = (place: LngLat, nd: Node, dir: "to" | "from") => {
    const key = `${dir}|${nd.name}`;
    if (!walks.has(key)) walks.set(key, stationWalk(place, [nd.lon, nd.lat], dir));
    return walks.get(key)!;
  };

  const built = await Promise.all(paths.map((path, idx) => buildOption(path, METRO_OPTION_ID + idx * 10)));
  const options = built.filter((o): o is MetroOption => o !== null).sort((a, b) => a.duration - b.duration);
  if (!options.length || !(options[0].duration < fastestWalkS * 0.9)) return [];
  const fastest = options[0].duration;
  return options
    .filter((o, i) => i === 0 || o.duration <= fastest + 25 * 60)
    .map((o, i) => {
      const id = METRO_OPTION_ID + i * 10;
      return { ...o, id, legs: [{ ...o.legs[0], id: id + 1 }, { ...o.legs[1], id: id + 2 }] as [ScoredRoute, ScoredRoute] };
    });

  async function buildOption(path: number[], id: number): Promise<MetroOption | null> {
    const boardNode = g.nodes[path[0]];
    const alightNode = g.nodes[path[path.length - 1]];
    if (boardNode.name.toLowerCase() === alightNode.name.toLowerCase()) return null;
    const [leg1, leg2] = await Promise.all([walk(from, boardNode, "to"), walk(to, alightNode, "from")]);
    if (!leg1 || !leg2) return null;
    const segments: RideSegment[] = [];
    let rideS = 0;
    for (let i = 0; i < path.length; i++) {
      const nd = g.nodes[path[i]];
      let kind: 0 | 1 | 2 = 0;
      if (i > 0) {
        const edge = g.adj[path[i - 1]].find(([v]) => v === path[i]);
        if (edge) {
          rideS += edge[1] + transferS(edge[2], waitS);
          kind = edge[2];
        }
      }
      const line: MetroLine = ds.metro.lines[nd.line];
      const last = segments[segments.length - 1];
      const station = { name: nd.name, at: [nd.lon, nd.lat] as LngLat, t: Math.round(rideS) };
      if (kind === 2 && last) {
        // Same line, other branch: carry on in the same segment; the interchange node repeats the station.
        last.towards = line.stops[line.stops.length - 1].name;
        if (last.stations[last.stations.length - 1].name !== nd.name) {
          last.to = nd.name;
          last.stops++;
          last.coords.push([nd.lon, nd.lat]);
          last.stations.push(station);
        }
      } else if (!last || i === 0 || kind === 1) {
        segments.push({
          line: line.name.replace(/\s*\(.*\)$/, "").replace(/:.*$/, ""), ref: line.ref, colour: line.colour,
          operator: line.operator, from: nd.name, to: nd.name, stops: 0, coords: [[nd.lon, nd.lat]], stations: [station],
          towards: line.stops[line.stops.length - 1].name,
        });
      } else {
        last.to = nd.name;
        last.stops++;
        last.coords.push([nd.lon, nd.lat]);
        last.stations.push(station);
      }
    }
    const rideSegments = segments.filter((s) => s.stops > 0);
    rideS += waitS;

    const boardAt = new Date(depart.getTime() + leg1.duration * 1000);
    const alightAt = new Date(boardAt.getTime() + rideS * 1000);
    const arrive = new Date(alightAt.getTime() + leg2.duration * 1000);
    const s1 = scoreRoute(ds, leg1, "walk", depart, id + 1, teen);
    const s2 = scoreRoute(ds, leg2, "walk", alightAt, id + 2, teen);
    const walked = leg1.distance + leg2.distance;
    const score =
      s1.score === null || s2.score === null
        ? null
        : Math.round((s1.score * leg1.distance + s2.score * leg2.distance) / Math.max(1, walked));

    return {
      id,
      score,
      duration: Math.round((arrive.getTime() - depart.getTime()) / 1000),
      walkDistance: Math.round(walked),
      legs: [s1, s2],
      ride: { segments: rideSegments, seconds: Math.round(rideS) },
      board: { station: boardNode.name, at: boardAt.toISOString() },
      alight: { station: alightNode.name, at: alightAt.toISOString(), arrive: arrive.toISOString() },
      assumptions: {
        ...ASSUMPTIONS,
        waitMin,
        speedKmh: ds.metro.speedKmh ?? FALLBACK_SPEED_KMH,
        speedSource: ds.metro.speedSource,
      },
    };
  }
}

/** The fastest walk + metro option, or null. */
export async function planMetro(
  ds: Dataset, from: LngLat, to: LngLat, depart: Date, fastestWalkS: number, teen = false,
): Promise<MetroOption | null> {
  return (await planMetroOptions(ds, from, to, depart, fastestWalkS, teen))[0] ?? null;
}
