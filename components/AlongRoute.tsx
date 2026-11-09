"use client";

import type { ScoredRoute } from "@/lib/score";
import { t } from "@/lib/i18n";
import Icon from "./Icon";

const SHOP_KINDS = new Set(["shop", "grocery", "food", "pharmacy", "mall", "fuel"]);

/**
 * "Rush" is an estimate, not live crowd data: open places per km beside the route, plus how many
 * major bus routes run along it. Thresholds are deliberately coarse (Quiet / Some / Busy).
 */
export function rushLevel(r: ScoredRoute): { label: string; detail: string; cls: string } {
  const km = Math.max(0.3, r.distance / 1000);
  const openPerKm = r.stats.openPlaces / km;
  const buses = r.buses.length;
  const level = openPerKm >= 10 || (openPerKm >= 6 && buses >= 3) ? "Busy" : openPerKm >= 3 || buses >= 2 ? "Some people" : "Quiet";
  const cls = level === "Busy" ? "good" : level === "Some people" ? "mid" : "quiet";
  return { label: level, detail: t("{p} open places per km · {b} bus routes", { p: openPerKm.toFixed(1), b: buses }), cls };
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
  const lightPct = Math.round(s.litTaggedShare * 100);
  const radianceLevel = s.meanRadiance >= 30 ? "bright" : s.meanRadiance >= 15 ? "moderate" : "dim";
  const lightCls = (r.components.light ?? 0) >= 0.8 ? "good" : (r.components.light ?? 0) >= 0.5 ? "mid" : "bad";

  return (
    <section className="along" aria-label="Along this route">
      <div className="along-head">
        <div className="along-title-group">
          <span className="along-badge">LIVE NIGHT TELEMETRY</span>
          <h3>{t("Along this route")}</h3>
        </div>
        <span className="along-subtitle">{t("Real-time safety sensors & open street presence")}</span>
      </div>

      <div className="along-tiles">
        {/* Street Lighting Card */}
        <div className={`along-tile tile-${lightCls}`}>
          <div className="along-tile-top">
            <span className="along-ic"><Icon name="bulb" size={18} /></span>
            <span className="along-k">{t("Street lights")}</span>
            <span className={`along-tag tag-${lightCls}`}>{t(lightLabel(r))}</span>
          </div>
          <div className="along-tile-value">
            <b>{t(lightLabel(r))}</b>
            <span className="along-substat">{s.lamps} {t("lamps mapped")}</span>
          </div>
          <div className="along-meter" aria-hidden>
            <div className="along-meter-track">
              <div className="along-meter-fill" style={{ width: `${Math.min(100, Math.max(12, lightPct))}%` }} />
            </div>
            <div className="along-meter-labels">
              <span>{lightPct}% tagged lit</span>
              <span>NASA: {t(radianceLevel)}</span>
            </div>
          </div>
        </div>

        {/* Rush & People Activity */}
        <div className={`along-tile tile-${rush.cls}`}>
          <div className="along-tile-top">
            <span className="along-ic"><Icon name="users" size={18} /></span>
            <span className="along-k">{t("Rush (estimate)")}</span>
            <span className={`along-tag tag-${rush.cls}`}>{t(rush.label)}</span>
          </div>
          <div className="along-tile-value">
            <b>{t(rush.label)}</b>
            <span className="along-substat">{(s.openPlaces / Math.max(0.3, r.distance / 1000)).toFixed(1)}/km</span>
          </div>
          <p className="along-d">{rush.detail}</p>
        </div>

        {/* CCTV Surveillance */}
        <div className="along-tile tile-cam">
          <div className="along-tile-top">
            <span className="along-ic"><Icon name="cam" size={18} /></span>
            <span className="along-k">CCTV</span>
            <span className="along-tag tag-cam">{r.components.cameras === null ? t("Unverified") : t("OSM Mapped")}</span>
          </div>
          <div className="along-tile-value">
            <b>{r.components.cameras === null ? t("Not mapped") : s.cameras}</b>
            <span className="along-substat">{r.components.cameras !== null && s.cameras > 0 ? t("active points") : ""}</span>
          </div>
          <p className="along-d">
            {r.components.cameras === null
              ? t("No cameras mapped nearby in OpenStreetMap")
              : t("cameras mapped beside the route")}
          </p>
        </div>

        {/* Open Commercial Hubs / Shops */}
        <div className="along-tile tile-shop">
          <div className="along-tile-top">
            <span className="along-ic"><Icon name="store" size={18} /></span>
            <span className="along-k">{t("Open shops")}</span>
            <span className="along-tag tag-shop">{openShops > 0 ? t("Active Corridor") : t("Quiet")}</span>
          </div>
          <div className="along-tile-value">
            <b>{openShops}</b>
            <span className="along-substat">{t("open now")}</span>
          </div>
          <p className="along-d">{t("shops, eateries, chemists and pumps open when you pass")}</p>
        </div>
      </div>

      {r.buses.length > 0 && (
        <div className="along-buses">
          <div className="buses-head">
            <Icon name="road" size={15} />
            <span className="along-k">{t("Buses along the way")}</span>
            <span className="bus-count">{r.buses.length} {t("routes")}</span>
          </div>
          <div className="bus-chips">
            {r.buses.map((b) => (
              <span key={b.ref} className="bus-chip" title={`${b.name} · runs along ${(b.along / 1000).toFixed(1)} km of this route`}>
                <span className="bus-dot" />
                <span className="bus-ref">{b.ref}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
