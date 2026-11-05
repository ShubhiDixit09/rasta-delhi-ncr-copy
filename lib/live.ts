import crypto from "node:crypto";

/**
 * Live trip links. While a trip is on, the phone sends its position here every ~25 s, and anyone with
 * the link (the person's trusted contacts) can watch it on /t/<id>. Stored in Upstash Redis (the same
 * store the feedback answers can use) and deleted automatically: 12 hours after the last update, or
 * 1 hour after the trip ends.
 *
 * The link id is public; a separate random key, known only to the phone, is needed to update it.
 */
const REDIS_URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

export const liveEnabled = Boolean(REDIS_URL && REDIS_TOKEN);

const TTL_ACTIVE = 12 * 3600;
const TTL_DONE = 3600;
const MAX_TRAIL = 90;

export type LiveStatus = "on_way" | "check" | "alert" | "arrived" | "ended";

export interface LivePos {
  lon: number;
  lat: number;
  acc: number;
  at: string;
  /** Where the position came from: gps, network (cell towers / Wi-Fi) or estimate (metro timetable). */
  src?: "gps" | "network" | "estimate";
}

export interface LiveTrip {
  name: string;
  mode: "walk" | "drive" | "metro";
  from: string;
  to: string;
  /** The planned route, [lon, lat] rounded to 5 decimals. */
  route: [number, number][];
  distance: number;
  startedAt: string;
  eta: string;
  status: LiveStatus;
  statusAt: string;
  /** Why the status is check or alert, in plain words ("Stopped for 5 minutes"). */
  reason: string | null;
  pos: LivePos | null;
  along: number;
  trail: [number, number, number][];
  updatedAt: string;
}

interface Stored extends LiveTrip {
  keyHash: string;
}

async function redis(command: (string | number)[]): Promise<unknown> {
  const res = await fetch(REDIS_URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? `redis ${res.status}`);
  return body.result;
}

const keyOf = (id: string) => `ghartak:live:${id}`;
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("base64url");
const token = (bytes: number) => crypto.randomBytes(bytes).toString("base64url");
export const validId = (id: string) => /^[A-Za-z0-9_-]{16}$/.test(id);

const num = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const inNcr = (lon: unknown, lat: unknown) => num(lon, 75.5, 79.5) && num(lat, 27, 30.5);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

async function save(id: string, rec: Stored) {
  const done = rec.status === "arrived" || rec.status === "ended";
  await redis(["SET", keyOf(id), JSON.stringify(rec), "EX", done ? TTL_DONE : TTL_ACTIVE]);
}

async function load(id: string): Promise<Stored | null> {
  const raw = (await redis(["GET", keyOf(id)])) as string | null;
  return raw ? (JSON.parse(raw) as Stored) : null;
}

export function publicView(rec: Stored): LiveTrip {
  const { keyHash: _drop, ...rest } = rec;
  void _drop;
  return rest;
}

/** Creates a live link. Returns null if the body is not a sensible trip. */
export async function createLive(body: Record<string, unknown>): Promise<{ id: string; key: string } | null> {
  const route = Array.isArray(body.route) ? body.route : [];
  if (route.length < 2 || route.length > 3000) return null;
  const pts: [number, number][] = [];
  for (const p of route) {
    if (!Array.isArray(p) || !inNcr(p[0], p[1])) return null;
    pts.push([Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
  }
  const eta = iso(body.eta);
  if (!eta || !num(body.distance, 1, 300_000)) return null;
  const now = new Date().toISOString();
  const id = token(12);
  const key = token(24);
  await save(id, {
    name: text(body.name, 40),
    mode: body.mode === "drive" ? "drive" : body.mode === "metro" ? "metro" : "walk",
    from: text(body.from, 120),
    to: text(body.to, 120),
    route: pts,
    distance: Math.round(body.distance as number),
    startedAt: now,
    eta,
    status: "on_way",
    statusAt: now,
    reason: null,
    pos: null,
    along: 0,
    trail: [],
    updatedAt: now,
    keyHash: hash(key),
  });
  return { id, key };
}

export async function readLive(id: string): Promise<LiveTrip | null> {
  const rec = await load(id);
  return rec ? publicView(rec) : null;
}

const STATUSES: LiveStatus[] = ["on_way", "check", "alert", "arrived", "ended"];

/** Applies an update from the phone. "forbidden" if the key is wrong, null if the trip is gone. */
export async function updateLive(id: string, body: Record<string, unknown>): Promise<LiveTrip | "forbidden" | null> {
  const rec = await load(id);
  if (!rec) return null;
  if (typeof body.key !== "string" || hash(body.key) !== rec.keyHash) return "forbidden";
  const now = new Date();
  const p = body.pos as Record<string, unknown> | undefined;
  if (p && inNcr(p.lon, p.lat) && num(p.acc, 0, 5000)) {
    const at = iso(p.at) ?? now.toISOString();
    const src = p.src === "network" || p.src === "estimate" ? p.src : "gps";
    rec.pos = { lon: Math.round((p.lon as number) * 1e5) / 1e5, lat: Math.round((p.lat as number) * 1e5) / 1e5, acc: Math.round(p.acc as number), at, src };
    rec.trail.push([rec.pos.lon, rec.pos.lat, Date.parse(at)]);
    if (rec.trail.length > MAX_TRAIL) rec.trail = rec.trail.slice(-MAX_TRAIL);
  }
  if (num(body.along, 0, 300_000)) rec.along = Math.round(body.along as number);
  const eta = iso(body.eta);
  if (eta) rec.eta = eta;
  if (typeof body.status === "string" && STATUSES.includes(body.status as LiveStatus) && body.status !== rec.status) {
    // A finished trip stays finished.
    if (rec.status !== "ended" && rec.status !== "arrived") {
      rec.status = body.status as LiveStatus;
      rec.statusAt = now.toISOString();
    }
  }
  if (body.reason !== undefined) rec.reason = text(body.reason, 160) || null;
  rec.updatedAt = now.toISOString();
  await save(id, rec);
  return publicView(rec);
}
