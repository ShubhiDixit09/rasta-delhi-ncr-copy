import { M_PER_DEG_LAT, M_PER_DEG_LON, type LngLat } from "./geo";
import { t } from "./i18n";

/**
 * Trip mode's judgement, kept free of React and the browser so it can be tested with simulated walks.
 *
 * Positions are matched to the planned route (distance along it, distance off it). From the recent
 * fixes it decides when something looks wrong enough to ask "Are you OK?":
 * - off the route for a while (beyond GPS error),
 * - not moving for several minutes before arriving,
 * - well past the expected arrival time,
 * - on foot but suddenly moving at vehicle speed.
 * Each check can be answered "I'm OK", which quiets that kind of check for a while.
 */

export type TripMode = "walk" | "drive";

export interface Rules {
  /** Off the route by more than this (and by more than the GPS error) counts as off route. */
  offRouteM: number;
  offRouteForS: number;
  /** Staying within this radius for stopForS counts as stopped. */
  stopRadiusM: number;
  stopForS: number;
  /** This close to the destination counts as arrived. */
  arriveM: number;
  /** Lateness allowed beyond the planned arrival: the larger of a fixed and a proportional margin. */
  lateMinS: number;
  lateShare: number;
  /** On foot, sustained speed above this suggests being in a vehicle. Null = not checked. */
  vehicleKmh: number | null;
  vehicleForS: number;
}

export const RULES: Record<TripMode, Rules> = {
  walk: {
    offRouteM: 120, offRouteForS: 60, stopRadiusM: 40, stopForS: 300, arriveM: 70,
    lateMinS: 600, lateShare: 0.25, vehicleKmh: 22, vehicleForS: 90,
  },
  drive: {
    // Jams and signals stop cars for minutes, and cab drivers take other roads: looser limits.
    offRouteM: 300, offRouteForS: 90, stopRadiusM: 80, stopForS: 480, arriveM: 150,
    lateMinS: 900, lateShare: 0.3, vehicleKmh: null, vehicleForS: 0,
  },
};

/** How long "I'm OK" quiets each kind of check. */
const SNOOZE_S = { off: 600, stopped: 300, late: 900, vehicle: Infinity } as const;

export type CheckKind = keyof typeof SNOOZE_S;

export interface Check {
  kind: CheckKind;
  reason: string;
}

export interface Fix {
  t: number;
  lon: number;
  lat: number;
  acc: number;
}

interface Matched extends Fix {
  along: number;
  off: number;
}

export interface Track {
  xs: number[];
  ys: number[];
  cum: number[];
  total: number;
  lon0: number;
  lat0: number;
}

const toXY = (t: Pick<Track, "lon0" | "lat0">, lon: number, lat: number): [number, number] => [
  (lon - t.lon0) * M_PER_DEG_LON,
  (lat - t.lat0) * M_PER_DEG_LAT,
];

export function makeTrack(coords: LngLat[]): Track {
  const lon0 = coords[0][0], lat0 = coords[0][1];
  const base = { lon0, lat0 };
  const xs: number[] = [], ys: number[] = [], cum: number[] = [];
  let total = 0;
  coords.forEach(([lon, lat], i) => {
    const [x, y] = toXY(base, lon, lat);
    if (i > 0) total += Math.hypot(x - xs[i - 1], y - ys[i - 1]);
    xs.push(x);
    ys.push(y);
    cum.push(total);
  });
  return { xs, ys, cum, total, lon0, lat0 };
}

/**
 * Distance along the route and off it for a position. Searches near the last known progress first,
 * so a route that doubles back on itself does not make progress jump ahead.
 */
export function locate(t: Track, lon: number, lat: number, hint: number | null = null): { along: number; off: number } {
  const [px, py] = toXY(t, lon, lat);
  const search = (lo: number, hi: number) => {
    let best = { along: 0, off: Infinity };
    for (let i = 1; i < t.xs.length; i++) {
      if (t.cum[i] < lo || t.cum[i - 1] > hi) continue;
      const ax = t.xs[i - 1], ay = t.ys[i - 1], dx = t.xs[i] - ax, dy = t.ys[i] - ay;
      const len2 = dx * dx + dy * dy;
      const k = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const off = Math.hypot(ax + k * dx - px, ay + k * dy - py);
      if (off < best.off) best = { along: t.cum[i - 1] + k * Math.sqrt(len2), off };
    }
    return best;
  };
  if (hint !== null) {
    const near = search(hint - 400, hint + 1500);
    if (near.off <= 80) return near;
  }
  return search(-Infinity, Infinity);
}

export class TripWatcher {
  readonly rules: Rules;
  private fixes: Matched[] = [];
  private snoozedUntil: Partial<Record<CheckKind, number>> = {};
  private lateAt: number;
  private progress: number | null = null;
  arrived = false;

  constructor(
    readonly track: Track,
    readonly mode: TripMode,
    readonly plannedS: number,
    readonly startMs: number,
  ) {
    this.rules = RULES[mode];
    const r = this.rules;
    this.lateAt = startMs + (plannedS + Math.max(r.lateMinS, plannedS * r.lateShare)) * 1000;
  }

  /** Adds a GPS fix. Returns where it is on the route. */
  add(f: Fix): { along: number; off: number; remaining: number; arrived: boolean } {
    const m = locate(this.track, f.lon, f.lat, this.progress);
    // Progress only moves forward, and only on fixes that are actually on the route.
    if (m.off <= Math.max(this.rules.offRouteM, f.acc)) this.progress = Math.max(this.progress ?? 0, m.along);
    this.fixes.push({ ...f, ...m });
    const cutoff = f.t - 15 * 60_000;
    while (this.fixes.length > 2 && this.fixes[0].t < cutoff) this.fixes.shift();
    const last = this.track.xs.length - 1;
    const end = { x: this.track.xs[last], y: this.track.ys[last] };
    const [px, py] = toXY(this.track, f.lon, f.lat);
    const toEnd = Math.hypot(end.x - px, end.y - py);
    if (toEnd <= this.rules.arriveM + Math.min(f.acc, 50)) this.arrived = true;
    return { along: this.progress ?? 0, off: m.off, remaining: this.remaining(), arrived: this.arrived };
  }

  remaining(): number {
    return Math.max(0, this.track.total - (this.progress ?? 0));
  }

  lastFix(): Fix | null {
    return this.fixes[this.fixes.length - 1] ?? null;
  }

  /** Expected arrival: remaining distance at the planned pace, or the pace of the last 5 minutes. */
  eta(now: number): number {
    const planned = this.track.total / Math.max(1, this.plannedS);
    const recent = this.fixes.filter((f) => f.t >= now - 5 * 60_000 && f.off <= this.rules.offRouteM);
    let pace = planned;
    if (recent.length >= 2) {
      const a = recent[0], b = recent[recent.length - 1];
      const dt = (b.t - a.t) / 1000;
      const moved = b.along - a.along;
      // Blend in the observed pace once there is enough of it; ignore stops (they show up as lateness).
      if (dt >= 120 && moved > 50) pace = 0.5 * planned + 0.5 * (moved / dt);
    }
    return now + (this.remaining() / Math.max(0.3, pace)) * 1000;
  }

  /** The most pressing check due now, or null. `skip` turns kinds off (e.g. on a metro ride). */
  evaluate(now: number, skip: CheckKind[] = []): Check | null {
    if (this.arrived) return null;
    const r = this.rules;
    const ok = (k: CheckKind) => (this.snoozedUntil[k] ?? 0) <= now && !skip.includes(k);
    const good = this.fixes.filter((f) => f.acc <= 100);
    const last = good[good.length - 1];
    if (!last) return null;

    // Off the route: every fix of the last offRouteForS seconds is clearly away from it.
    if (ok("off")) {
      const win = good.filter((f) => f.t >= now - r.offRouteForS * 1000);
      const span = win.length ? (win[win.length - 1].t - win[0].t) / 1000 : 0;
      const away = (f: Matched) => f.off > Math.max(r.offRouteM, 1.5 * f.acc);
      if (win.length >= 3 && span >= r.offRouteForS * 0.8 && win.every(away)) {
        return { kind: "off", reason: t("You're about {d} away from your route.", { d: roundM(last.off) }) };
      }
    }

    // On foot but moving like a vehicle.
    if (ok("vehicle") && r.vehicleKmh !== null) {
      const win = good.filter((f) => f.t >= now - r.vehicleForS * 1000 && f.acc <= 50);
      if (win.length >= 3) {
        const a = win[0], b = win[win.length - 1];
        const dt = (b.t - a.t) / 1000;
        const kmh = (dist(this.track, a, b) / Math.max(1, dt)) * 3.6;
        if (dt >= r.vehicleForS * 0.8 && kmh > r.vehicleKmh) {
          return { kind: "vehicle", reason: t("You're moving at about {k} km/h, faster than walking.", { k: Math.round(kmh) }) };
        }
      }
    }

    // Stopped: all fixes of the last stopForS seconds within a small circle, away from the destination.
    if (ok("stopped") && this.remaining() > r.arriveM * 2) {
      const since = Math.max(now - r.stopForS * 1000, this.snoozedUntil.stopped ?? 0);
      const win = good.filter((f) => f.t >= since);
      if (win.length >= 3 && (win[win.length - 1].t - win[0].t) / 1000 >= r.stopForS * 0.9) {
        const cx = win.reduce((s, f) => s + f.lon, 0) / win.length;
        const cy = win.reduce((s, f) => s + f.lat, 0) / win.length;
        const spread = Math.max(...win.map((f) => dist(this.track, f, { lon: cx, lat: cy })));
        if (spread <= r.stopRadiusM + Math.min(30, last.acc)) {
          return { kind: "stopped", reason: t("You haven't moved for {m} minutes.", { m: Math.round(r.stopForS / 60) }) };
        }
      }
    }

    if (ok("late") && now > this.lateAt) {
      const mins = Math.round((now - (this.startMs + this.plannedS * 1000)) / 60_000);
      return { kind: "late", reason: t("You're {m} minutes past the time you expected to arrive.", { m: mins }) };
    }
    return null;
  }

  /** "I'm OK": quiet this kind of check for a while. */
  snooze(kind: CheckKind, now: number) {
    this.snoozedUntil[kind] = now + SNOOZE_S[kind] * 1000;
    if (kind === "late") this.lateAt = now + SNOOZE_S.late * 1000;
  }
}

function dist(t: Track, a: { lon: number; lat: number }, b: { lon: number; lat: number }) {
  const [ax, ay] = toXY(t, a.lon, a.lat);
  const [bx, by] = toXY(t, b.lon, b.lat);
  return Math.hypot(bx - ax, by - ay);
}

const roundM = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

/** What is coming up: a stretch with nothing open, or the next hospital or police station. */
export function ahead(
  along: number,
  gaps: { startAt: number; length: number }[],
  help: { kind: "hospital" | "police"; name: string; at: number; phone: string | null }[],
): { tone: "warn" | "info"; text: string; phone?: string | null } | null {
  const inGap = gaps.find((g) => along >= g.startAt && along <= g.startAt + g.length);
  if (inGap) return { tone: "warn", text: t("Nothing open for the next {d}. Stay on the main road if you can.", { d: roundM(inGap.startAt + inGap.length - along) }) };
  const gap = gaps.filter((g) => g.startAt > along && g.startAt - along <= 600 && g.length >= 200).sort((a, b) => a.startAt - b.startAt)[0];
  if (gap) return { tone: "warn", text: t("In {a}: {d} with nothing open.", { a: roundM(gap.startAt - along), d: roundM(gap.length) }) };
  const h = help.filter((p) => p.at > along && p.at - along <= 2000).sort((a, b) => a.at - b.at)[0];
  if (h) return { tone: "info", text: t(h.kind === "police" ? "Police in {d}: {n}" : "Hospital in {d}: {n}", { d: roundM(h.at - along), n: h.name }), phone: h.phone };
  return null;
}
