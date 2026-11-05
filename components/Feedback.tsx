"use client";

import { useEffect, useState } from "react";
import { CHOICES, LABELS } from "@/lib/feedback";
import type { LngLat } from "@/lib/geo";
import type { MetroOption } from "@/lib/metro";
import type { Mode } from "@/lib/routing";
import type { ScoredRoute } from "@/lib/score";
import { fmtDuration } from "./format";
import { t } from "@/lib/i18n";

interface Props {
  tripKey: string;
  mode: Mode;
  depart: string;
  from: LngLat;
  to: LngLat;
  routes: ScoredRoute[];
  metro: MetroOption | null;
  teen: boolean;
  /** The route selected on screen right now (route id, or the walk + metro option's id). */
  selectedId: number;
}

let enabled: Promise<boolean> | null = null;
const isEnabled = () =>
  (enabled ??= fetch("/api/feedback").then((r) => r.json()).then((b) => Boolean(b.enabled)).catch(() => false));

/**
 * A small invitation shown inside a route's details, where people actually look. It opens the
 * questions below the route list, and disappears once they are answered or dismissed for this trip.
 */
export function FeedbackNudge({ tripKey, onOpen }: { tripKey: string; onOpen: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(`ghartak-fb:${tripKey}`) !== null;
    } catch {
      // storage unavailable: still ask
    }
    if (seen) return setShow(false);
    isEnabled().then(setShow);
  }, [tripKey]);
  if (!show) return null;
  return (
    <button type="button" className="fb-nudge" onClick={onOpen}>
      <span className="fb-nudge-ic" aria-hidden>💛</span>
      <span>
        <b>{t("Help other women get home safer")}</b>
        <small>{t("Which route would you take? 2 taps · anonymous")}</small>
      </span>
      <span className="fb-nudge-go" aria-hidden>›</span>
    </button>
  );
}

/**
 * Two required taps and one optional, asked once per trip. Answers are anonymous (see
 * app/api/feedback/route.ts) and are used to check the score's weights against what people
 * actually choose and how streets feel to people who know them.
 */
export default function Feedback({ tripKey, mode, depart, from, to, routes, metro, teen, selectedId }: Props) {
  const [on, setOn] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [feel, setFeel] = useState<string | null>(null);
  const [state, setState] = useState<"ask" | "sending" | "done" | "hidden">("ask");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isEnabled().then(setOn);
  }, []);

  useEffect(() => {
    setChosen(null);
    setPriority(null);
    setFeel(null);
    setError(null);
    let seen = false;
    try {
      seen = sessionStorage.getItem(`ghartak-fb:${tripKey}`) !== null;
    } catch {
      // storage unavailable: just ask
    }
    setState(seen ? "hidden" : "ask");
  }, [tripKey]);

  if (!on || state === "hidden") return null;
  if (state === "done") return <div className="feedback done">{t("Thanks, that helps tune the score.")}</div>;

  const remember = () => {
    try {
      sessionStorage.setItem(`ghartak-fb:${tripKey}`, "1");
    } catch {
      // ignore
    }
  };

  const options = [
    ...routes.map((r, i) => ({ id: `r${i}`, label: t("Route {i}: {d}, score {s}", { i: i + 1, d: fmtDuration(r.duration), s: r.score ?? "–" }) })),
    ...(metro ? [{ id: "metro", label: t("Walk + metro: ~{d}", { d: fmtDuration(metro.duration) }) }] : []),
    { id: "none", label: t("None of these") },
  ];

  /** What was on screen: the selected route's numbers and shape (the server trims the ends). */
  const selectedPayload = () => {
    if (metro && selectedId === metro.id) {
      return {
        id: "metro", distance: metro.walkDistance, duration: metro.duration, score: metro.score,
        lines: metro.ride.segments.map((s) => s.line),
        coords: [...metro.legs[0].coords, ...metro.ride.segments.flatMap((s) => s.coords), ...metro.legs[1].coords],
      };
    }
    const i = routes.findIndex((r) => r.id === selectedId);
    const r = routes[i];
    if (!r) return null;
    return {
      id: `r${i}`, via: r.via, distance: r.distance, duration: r.duration, score: r.score,
      components: r.components, stats: r.stats, buses: r.buses.map((b) => b.ref), coords: r.coords,
    };
  };

  const submit = async () => {
    setState("sending");
    setError(null);
    const summary = (r: { score: number | null; duration: number; components?: unknown }) => ({
      score: r.score, duration: r.duration, components: r.components,
    });
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode, depart, from, to, chosen, priority, feel, teen,
          selected: selectedPayload(),
          routes: routes.map(summary),
          metro: metro ? { score: metro.score, duration: metro.duration } : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      remember();
      setState("done");
    } catch (e) {
      setError((e as Error).message);
      setState("ask");
    }
  };

  // A plain render helper, not a component, so the buttons are not remounted on every tap.
  const group = ({ name, value, set, items }: {
    name: string; value: string | null; set: (v: string) => void; items: { id: string; label: string }[];
  }) => (
    <div className="fb-options" role="radiogroup" aria-label={name}>
      {items.map((o) => (
        <button
          key={o.id} type="button" role="radio" aria-checked={value === o.id}
          className={value === o.id ? "chip on" : "chip"} onClick={() => set(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <section className="feedback" aria-label="Quick feedback">
      <div className="fb-head">
        <strong>💛 {t("Help other women get home safer")}</strong>
        <span className="muted">{t("anonymous, 2 taps")}</span>
        <button type="button" className="link" onClick={() => { remember(); setState("hidden"); }}>{t("Not now")}</button>
      </div>
      <p className="fb-q">1. {t("Which of these would you actually take?")}</p>
      {group({ name: "Route you would take", value: chosen, set: setChosen, items: options })}
      <p className="fb-q">2. {t("What matters most to you on this trip?")}</p>
      {group({
        name: "What matters most", value: priority, set: setPriority,
        items: CHOICES.priority.map((id) => ({ id, label: t(LABELS[id]) })),
      })}
      <p className="fb-q">3. {t("Do you know this area at night?")} <span className="muted">({t("optional")})</span></p>
      {group({
        name: "Area at night", value: feel, set: setFeel,
        items: CHOICES.feel.map((id) => ({ id, label: t(LABELS[id]) })),
      })}
      {error && <p className="error-inline">{error}</p>}
      <button type="button" className="btn primary" disabled={!chosen || !priority || state === "sending"} onClick={submit}>
        {state === "sending" ? t("Sending…") : t("Send")}
      </button>
      <p className="note">
        {t("Saved: your answers, the routes' scores and times, the hour, and start/end rounded to about 1 km. No names, exact addresses or IPs.")}
      </p>
    </section>
  );
}
