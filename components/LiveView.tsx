"use client";

import maplibregl, { GeoJSONSource, Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { LiveTrip } from "@/lib/live";
import { HelplineList } from "./Emergency";
import Icon from "./Icon";
import { fmtDistance } from "./format";

/** What a trusted contact sees from the live link: the person on their route, their ETA and status. */

const STYLE = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
};

const clock = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

export default function LiveView({ id }: { id: string }) {
  const [trip, setTrip] = useState<LiveTrip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const meMarker = useRef<Marker | null>(null);
  const framed = useRef(false);
  const userMovedAt = useRef(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/live/${id}`, { cache: "no-store" });
        const b = await r.json();
        if (stop) return;
        if (!r.ok) setError(b.error ?? "This link isn't working.");
        else {
          setTrip(b);
          setError(null);
        }
      } catch {
        if (!stop) setError("Can't reach Ghar Tak right now. Retrying…");
      }
    };
    poll();
    const t = setInterval(poll, 15_000); // each check is one Redis command; 15 s keeps the free plan roomy
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      clearInterval(t);
      clearInterval(c);
    };
  }, [id]);

  useEffect(() => {
    if (!el.current || map.current) return;
    const dark = document.documentElement.dataset.theme !== "light";
    const m = new maplibregl.Map({ container: el.current, style: dark ? STYLE.dark : STYLE.light, center: [77.2, 28.6], zoom: 10, attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("dragstart", () => (userMovedAt.current = Date.now()));
    m.on("load", () => {
      m.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addSource("trail", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "route-casing", type: "line", source: "route", paint: { "line-color": dark ? "#0b0d10" : "#ffffff", "line-width": 9 }, layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#f5b942", "line-width": 5 }, layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({ id: "trail", type: "line", source: "trail", paint: { "line-color": "#3b82f6", "line-width": 4, "line-opacity": 0.85 }, layout: { "line-cap": "round", "line-join": "round" } });
      map.current = m;
      setReady(true);
    });
    return () => m.remove();
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !trip) return;
    (m.getSource("route") as GeoJSONSource).setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: trip.route } });
    (m.getSource("trail") as GeoJSONSource).setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: trip.trail.map((p) => [p[0], p[1]]) } });
    if (!framed.current) {
      const b = new maplibregl.LngLatBounds();
      for (const c of trip.route) b.extend(c);
      m.fitBounds(b, { padding: { top: 200, bottom: 280, left: 40, right: 40 }, duration: 0 });
      for (const [i, c] of [trip.route[0], trip.route[trip.route.length - 1]].entries()) {
        const node = document.createElement("div");
        node.className = `pin ${i ? "pin-to" : "pin-from"}`;
        node.textContent = i ? "B" : "A";
        new maplibregl.Marker({ element: node }).setLngLat(c).addTo(m);
      }
      framed.current = true;
    }
    if (trip.pos) {
      if (!meMarker.current) {
        const node = document.createElement("div");
        node.className = "me-dot";
        meMarker.current = new maplibregl.Marker({ element: node }).setLngLat([trip.pos.lon, trip.pos.lat]).addTo(m);
      } else meMarker.current.setLngLat([trip.pos.lon, trip.pos.lat]);
      if (Date.now() - userMovedAt.current > 30_000) m.easeTo({ center: [trip.pos.lon, trip.pos.lat], zoom: Math.max(m.getZoom(), 14), padding: { top: 200, bottom: 280, left: 0, right: 0 } });
    }
  }, [trip, ready]);

  const who = trip?.name || "Your contact";
  // One clock for both "Live" and "Last update": when the server last heard from the phone.
  const lastSeen = trip?.updatedAt;
  const active = trip && (trip.status === "on_way" || trip.status === "check");
  const ageS = trip ? (now - Date.parse(trip.updatedAt)) / 1000 : 0;
  // Live only while updates keep arriving (the phone sends one every ~25 s while Ghar Tak is open).
  const live = active && ageS < 75;
  const stale = active && ageS > 180;
  const progress = trip ? Math.min(1, trip.along / Math.max(1, trip.distance)) : 0;

  let banner: React.ReactNode = null;
  if (trip?.status === "alert") {
    banner = (
      <div className="live-banner alert">
        <b>Alert at {clock(trip.statusAt)}</b>
        <span>{trip.reason ?? "They may need help."} Call {trip.name || "them"} now. If you can&apos;t reach them, call 112.</span>
        <a className="sos-call" href="tel:112">Call 112</a>
      </div>
    );
  } else if (trip?.status === "check") {
    banner = <div className="live-banner check"><b>Checking on {who}</b><span>{trip.reason} Ghar Tak asked if they&apos;re OK.</span></div>;
  } else if (stale) {
    banner = (
      <div className="live-banner check">
        <b>No update for {ago(trip!.updatedAt, now).replace(" ago", "")}</b>
        <span>Their phone may be locked, offline or out of battery. Try calling them.</span>
      </div>
    );
  } else if (trip?.status === "arrived") {
    banner = <div className="live-banner ok"><b>{who} reached {trip.to}</b><span>at {clock(trip.statusAt)} ✅</span></div>;
  } else if (trip?.status === "ended") {
    banner = <div className="live-banner"><b>This trip has ended</b><span>at {clock(trip.statusAt)}</span></div>;
  }

  return (
    <div className="live-page">
      <div ref={el} className="live-map" />
      <header className="live-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/logo.svg" alt="" width={26} height={26} />
        <div>
          <b>{trip ? `${who} is ${trip.status === "arrived" ? "home" : trip.status === "ended" ? "off the trip" : "on the way"}` : "Live trip"}</b>
          {trip && <span className="muted">{trip.mode === "metro" ? "By metro" : trip.mode === "walk" ? "Walking" : "By cab"} · {trip.from} → {trip.to}</span>}
        </div>
      </header>
      <section className="live-card">
        {error && !trip && <p className="error">{error}</p>}
        {!error && !trip && <p className="muted">Loading the trip…</p>}
        {banner}
        {trip && trip.status !== "arrived" && trip.status !== "ended" && (
          <>
            <div className="trip-eta">
              <div><b>Arrives ~{clock(trip.eta)}</b><span className="muted"> · {fmtDistance(Math.max(0, trip.distance - trip.along))} left</span></div>
              {lastSeen && (
                <span className={live ? "fresh live" : "fresh"}><i />{live ? "Live" : `Last update ${ago(lastSeen, now)}`}</span>
              )}
            </div>
            <div className="trip-progress"><i style={{ width: `${progress * 100}%` }} /></div>
            {trip.pos?.src === "estimate" && <p className="small muted">On the metro underground: position estimated from the timetable.</p>}
            {trip.pos?.src === "network" && <p className="small muted">Approximate location (±{fmtDistance(trip.pos.acc)}): GPS is weak, using the phone network.</p>}
            <p className="muted small">
              <Icon name="info" size={13} /> Blue line: where they have been. Amber: the route they planned. Started {clock(trip.startedAt)}.
            </p>
          </>
        )}
        <details className="how">
          <summary>Emergency numbers</summary>
          <HelplineList />
        </details>
        {trip && <p className="note">This page shows {trip.name || "your contact"}&apos;s location, sent from their phone. It never uses yours.</p>}
        <p className="note">Shared from Ghar Tak, night routes for Delhi NCR. This link stops working an hour after the trip ends.</p>
      </section>
    </div>
  );
}
