"use client";

import { useEffect, useRef, useState } from "react";
import { loadContacts, sendToContacts } from "@/lib/contacts";
import type { HelpPoint } from "@/lib/score";
import { fmtDistance } from "./format";
import { t } from "@/lib/i18n";
import Icon from "./Icon";

/** National and NCR helplines. All are free to call from any phone. */
export const HELPLINES: { number: string; label: string; detail: string; primary?: boolean }[] = [
  { number: "112", label: "National Emergency", detail: "Police, fire & ambulance, all of India", primary: true },
  { number: "1091", label: "Delhi Police Women", detail: "Special women safety cell, 24×7" },
  { number: "181", label: "Women Helpline (National)", detail: "Toll-free 24×7 distress assistance" },
  { number: "1098", label: "Childline India", detail: "Teens & children in need of help, 24×7" },
  { number: "102", label: "Ambulance / Medical", detail: "Delhi (108 in UP & Haryana)" },
  { number: "1090", label: "UP Women Power Line", detail: "Noida, Greater Noida, Ghaziabad" },
];

export function HelplineList({ compact = false }: { compact?: boolean }) {
  const list = compact ? HELPLINES.filter((h) => ["112", "1091", "1098"].includes(h.number)) : HELPLINES;
  return (
    <ul className={compact ? "helplines-list compact" : "helplines-list"}>
      {list.map((h) => (
        <li key={h.number} className={h.primary ? "primary" : ""}>
          <a href={`tel:${h.number}`} aria-label={`${t("Call")} ${t(h.label)}, ${h.number}`}>
            <div className="hl-badge">
              <b>{h.number}</b>
            </div>
            <div className="hl-info">
              <span className="hl-title">{t(h.label)}</span>
              {!compact && <small className="hl-desc">{t(h.detail)}</small>}
            </div>
            <span className="hl-call-action" aria-hidden>
              <Icon name="phone" size={14} />
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Floating SOS button on every screen: call 112 and the helplines, or alert trusted contacts. */
export function SosButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  // The installed app's "SOS" home-screen shortcut opens /?sos=1.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("sos") === "1") dialog.current?.showModal();
  }, []);

  const alertContacts = async () => {
    const list = loadContacts();
    if (!list.length) {
      setStatus(t("No trusted contacts saved yet. Add them with “Send to my people” on any route."));
      return;
    }
    setStatus(t("Getting your location…"));
    const { located } = await sendToContacts(list, t("I need help. Please call me."));
    setStatus(
      t(
        located
          ? "Opening your messages app for {n} contacts with your location. Press send there."
          : "Opening your messages app for {n} contacts (location not available). Press send there.",
        { n: list.length },
      ),
    );
  };

  return (
    <>
      <button
        type="button"
        className="sos"
        onClick={() => {
          setStatus(null);
          dialog.current?.showModal();
        }}
        aria-haspopup="dialog"
      >
        <span className="sos-pulse" aria-hidden />
        <span className="sos-text">SOS</span>
      </button>
      <dialog ref={dialog} className="sos-sheet" aria-labelledby="sos-title">
        <form method="dialog" className="contacts-head">
          <div className="sos-header-left">
            <span className="sos-shield-icon" aria-hidden>
              <Icon name="alert" size={20} />
            </span>
            <div>
              <h2 id="sos-title">{t("Emergency Response")}</h2>
              <span className="sos-subtitle">{t("Direct police, ambulance & women helplines")}</span>
            </div>
          </div>
          <button className="link sos-close" aria-label="Close dialog">{t("Close")}</button>
        </form>

        <div className="sos-hero-card">
          <a className="sos-call" href="tel:112">
            <span className="sos-call-icon" aria-hidden>
              <Icon name="phone" size={22} />
            </span>
            <div className="sos-call-text">
              <strong>{t("Call 112")}</strong>
              <span>{t("All India Police, Ambulance & Fire")}</span>
            </div>
          </a>

          <button type="button" className="btn sos-alert" onClick={alertContacts}>
            <Icon name="users" size={17} />
            <span>{t("Message my trusted contacts with my location")}</span>
          </button>
        </div>

        {status && <p className="share-status" aria-live="polite">{status}</p>}

        <div className="sos-directory">
          <span className="sos-directory-label">{t("24×7 VERIFIED HELPLINES (TOLL-FREE)")}</span>
          <HelplineList />
        </div>

        <p className="note sos-footnote">{t("Calls go through your phone. On a computer, use your phone to call.")}</p>
      </dialog>
    </>
  );
}

/**
 * "Help along this route": the nearest hospitals and police stations, each with a bar showing where
 * along the trip it is, and its phone number where OSM or Overture lists one.
 */
export function RouteHelp({ points, total }: { points: HelpPoint[]; total: number }) {
  if (!points.length) {
    return (
      <section className="route-help">
        <div className="route-help-head">
          <Icon name="shield" size={18} />
          <h3>{t("Help along this route")}</h3>
        </div>
        <p className="note">{t("No hospital or police station mapped close to this route. Use 112 in an emergency.")}</p>
        <HelplineList compact />
      </section>
    );
  }

  return (
    <section className="route-help" aria-label="Help along this route">
      <div className="route-help-head">
        <div className="route-help-title">
          <span className="along-badge">SECURITY & MEDICAL</span>
          <h3>{t("Help along this route")}</h3>
        </div>
        <span className="help-points-count">{points.length} {t("stations nearby")}</span>
      </div>

      <ul className="help-points">
        {points.map((p, i) => (
          <li key={i} className={`hp-item hp-${p.kind}`}>
            <div className="hp-top">
              <span className={`hp-kind ${p.kind}`}>
                <Icon name={p.kind === "police" ? "police" : "hospital"} size={14} />
                <span>{p.kind === "police" ? t("Police") : t("Hospital")}</span>
              </span>
              <span className="hp-name">{p.name}</span>
              {p.phone ? (
                <a className="hp-call" href={`tel:${p.phone}`} aria-label={`${t("Call")} ${p.name}`}>
                  <Icon name="phone" size={13} />
                  <span>{t("Call")}</span>
                </a>
              ) : (
                <span className="hp-nophone muted">{t("no number")}</span>
              )}
            </div>
            <div className="hp-bar" role="img" aria-label={`${fmtDistance(p.at)} into the trip, ${fmtDistance(p.off)} off the route`}>
              <span className="hp-track" />
              <span className={`hp-mark ${p.kind}`} style={{ left: `${Math.min(100, (p.at / Math.max(1, total)) * 100)}%` }} />
            </div>
            <div className="hp-meta muted">
              <span>{t("{a} into trip · {o} off route", { a: fmtDistance(p.at), o: fmtDistance(p.off) })}</span>
              {p.open ? <span className="hp-open-tag">Open 24/7</span> : <span className="hp-closed-tag">{t("may be closed")}</span>}
              {p.phone && <span className="hp-phone-num">· {p.phone}</span>}
            </div>
          </li>
        ))}
      </ul>
      <HelplineList compact />
    </section>
  );
}
