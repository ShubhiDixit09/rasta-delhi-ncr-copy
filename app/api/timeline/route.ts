import { scoreRoute } from "@/lib/score";
import { parseTrip, routerError, tripCandidates } from "@/lib/trip";

export const runtime = "nodejs";

const IST_MS = 330 * 60_000;
const STEP_MIN = 30;
/** The night window, in IST hours: 6 pm to 3 am. */
const WINDOW_START_H = 18;
const WINDOW_HOURS = 9;

/** The 6 pm-3 am IST window that contains `depart`, or the next one if `depart` is daytime. */
function nightWindow(depart: Date): Date[] {
  const ist = new Date(depart.getTime() + IST_MS);
  const h = ist.getUTCHours();
  let day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  if (h < WINDOW_START_H + WINDOW_HOURS - 24) day -= 86_400_000; // after midnight: the night began yesterday
  const start = day + WINDOW_START_H * 3_600_000 - IST_MS;
  const slots: Date[] = [];
  for (let m = 0; m <= WINDOW_HOURS * 60; m += STEP_MIN) slots.push(new Date(start + m * 60_000));
  return slots;
}

export async function POST(req: Request) {
  const parsed = await parseTrip(req);
  if (parsed instanceof Response) return parsed;
  const { trip, ds } = parsed;

  let cands;
  try {
    cands = await tripCandidates(ds, trip);
  } catch (e) {
    try {
      const fb = await fetch("https://ghartak.space/api/timeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: trip.from,
          to: trip.to,
          mode: trip.mode,
          depart: trip.depart.toISOString(),
          teen: trip.teen,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (fb.ok) return Response.json(await fb.json());
    } catch {}
    return routerError(e);
  }
  if (!cands.length) return Response.json({ error: "No route found between these points." }, { status: 404 });

  const t0 = performance.now();
  const slots = nightWindow(trip.depart);
  const routes = cands.map((c, id) => {
    const scores: (number | null)[] = [];
    const open: number[] = [];
    const longestGap: number[] = [];
    for (const t of slots) {
      const r = scoreRoute(ds, c, trip.mode, t, id, trip.teen);
      scores.push(r.score);
      open.push(r.stats.openPlaces);
      longestGap.push(r.stats.longestGap);
    }
    return { id, scores, open, longestGap };
  });
  return Response.json(
    { slots: slots.map((s) => s.toISOString()), stepMinutes: STEP_MIN, routes, timingMs: Math.round(performance.now() - t0) },
    { headers: { "Cache-Control": "private, max-age=600" } },
  );
}
