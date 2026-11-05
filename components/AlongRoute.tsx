"use client";

import type { ScoredRoute } from "@/lib/score";
import { t } from "@/lib/i18n";

const SHOP_KINDS = new Set(["shop", "grocery", "food", "pharmacy", "mall", "fuel"]);

/**
 * "Rush" is an estimate, not live crowd data: open places per km beside the route, plus how many
 * major bus routes run along it. Thresholds are deliberately coarse (Quiet / Some / Busy).
 */
export function rushLevel(r: ScoredRoute): { label: string; detail: string } {
  const km = Math.max(0.3, r.distance / 1000);
  const openPerKm = r.stats.openPlaces / km;
  const buses = r.buses.length;
  const level = openPerKm >= 10 || (openPerKm >= 6 && buses >= 3) ? "Busy" : openPerKm >= 3 || buses >= 2 ? "Some people" : "Quiet";
  return { label: level, detail: t("{p} open places per km · {b} bus routes", { p: openPerKm.toFixed(1), b: buses }) };
}

export function lightLabel(r: ScoredRoute) {
  const l = r.components.light ?? 0;
  return l >= 0.8 ? "Well lit" : l >= 0.5 ? "Partly lit" : "Dark";
}

/** One panel for the questions people ask about a route at night. */
export default function AlongRoute({ r }: { r: ScoredRoute }) {
  const s = r.stats;
  const openShops = r.places.filter((p) => p.open && SHOP_KINDS.has(p.kind)).length;
  const rush = rushLevel(r);
  return (
    <section className="along" aria-label="Along this route">
      <h3>{t("Along this route")}</h3>
      <div className="along-tiles">
        <div className="along-tile">
          <span className="along-k">{t("Street lights")}</span>
          <b>{t(lightLabel(r))}</b>
          <span className="along-d">
            {t("{n} lamps mapped · {p}% of the way tagged lit · NASA night light: {lvl}", {
              n: s.lamps, p: Math.round(s.litTaggedShare * 100),
              lvl: t(s.meanRadiance >= 30 ? "bright" : s.meanRadiance >= 15 ? "moderate" : "dim"),
            })}
          </span>
        </div>
        <div className="along-tile" title={t("Estimate from open places and bus routes, not live crowd data")}>
          <span className="along-k">{t("Rush (estimate)")}</span>
          <b>{t(rush.label)}</b>
          <span className="along-d">{rush.detail}</span>
        </div>
        <div className="along-tile">
          <span className="along-k">CCTV</span>
          <b>{r.components.cameras === null ? t("Not mapped") : s.cameras}</b>
          <span className="along-d">
            {r.components.cameras === null ? t("No cameras mapped nearby in OpenStreetMap") : t("cameras mapped beside the route")}
          </span>
        </div>
        <div className="along-tile">
          <span className="along-k">{t("Open shops")}</span>
          <b>{openShops}</b>
          <span className="along-d">{t("shops, eateries, chemists and pumps open when you pass")}</span>
        </div>
      </div>
      {r.buses.length > 0 && (
        <div className="along-buses">
          <span className="along-k">{t("Buses along the way")}</span>
          <div className="bus-chips">
            {r.buses.map((b) => (
              <span key={b.ref} className="bus-chip" title={`${b.name} · runs along ${(b.along / 1000).toFixed(1)} km of this route`}>
                {b.ref}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
