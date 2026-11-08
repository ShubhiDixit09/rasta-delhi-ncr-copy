"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Meta } from "@/lib/data";
import type { LngLat } from "@/lib/geo";
import type { Mode } from "@/lib/routing";
import type { MetroOption } from "@/lib/metro";
import type { Component, ScoredRoute } from "@/lib/score";
import { useTheme } from "@/lib/theme";
import { COMPONENT_LABEL, KIND_COLORS, LEGEND, fmtDistance, fmtDuration, scoreColor, scoreRating, summary } from "./format";
import PlaceSearch, { Picked, reverseGeocode } from "./PlaceSearch";
import AlongRoute, { lightLabel } from "./AlongRoute";
import Icon, { IconName } from "./Icon";
import { pl, rich, setLang, t, useLang } from "@/lib/i18n";
import InstallApp from "./InstallApp";
import { HelplineList, RouteHelp, SosButton } from "./Emergency";
import Feedback, { FeedbackNudge } from "./Feedback";
import Share, { metroShareText, shareText } from "./Share";
import ThemeToggle from "./ThemeToggle";
import Timeline, { TimelineData } from "./Timeline";
import { TripPanel, TripSession, TripStart, loadTrip, metroTrip } from "./Trip";
import Onboarding, { PERSONAS, Persona, loadPersona, savePersona } from "./Onboarding";
import { MAP_ASPECT, routeCard } from "./routeCard";
import type { Snapshot } from "./MapView";

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <div className="map" /> });

interface ApiResult {
  mode: Mode;
  depart: string;
  routes: ScoredRoute[];
  metro: MetroOption | null;
  /** Other walk + metro options: fewest changes, or changing somewhere else. */
  metroAlts?: MetroOption[];
  /** Why there is no walk + metro option (the metro is not running then), if that is the reason. */
  metroClosed?: string | null;
}

/** Wall-clock presets in IST; each resolves to its next occurrence. */
const PRESETS = [
  { id: "now", label: "Now" },
  { id: "21", label: "9 pm" },
  { id: "23", label: "11 pm" },
  { id: "1", label: "1 am" },
] as const;
type Preset = (typeof PRESETS)[number]["id"] | "custom";

const IST_MS = 330 * 60_000;

function nextIst(hour: number): Date {
  const now = Date.now();
  const ist = new Date(now + IST_MS);
  const target = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hour) - IST_MS;
  return new Date(target > now ? target : target + 86_400_000);
}

function istInputValue(d: Date): string {
  return new Date(d.getTime() + IST_MS).toISOString().slice(0, 16);
}

/**
 * The trip lives in the URL so it can be shared and reopened:
 * ?a=lon,lat&an=label&b=lon,lat&bn=label&m=walk|drive&t=ISO&r=routeIndex  (no t = leave now)
 */
function readUrl() {
  const q = new URLSearchParams(window.location.search);
  const pt = (v: string | null, label: string | null): Picked | null => {
    const m = v?.split(",").map(Number);
    if (!m || m.length !== 2 || m.some((x) => !Number.isFinite(x))) return null;
    return { point: [m[0], m[1]], label: label || `${m[1].toFixed(5)}, ${m[0].toFixed(5)}` };
  };
  const t = q.get("t");
  const r = q.get("r");
  return {
    from: pt(q.get("a"), q.get("an")),
    to: pt(q.get("b"), q.get("bn")),
    mode: q.get("m") === "drive" ? ("drive" as const) : q.get("m") === "walk" || q.get("m") === "metro" ? ("walk" as const) : null,
    metro: q.get("m") === "metro",
    shared: q.get("sh") === "1",
    depart: t && !Number.isNaN(Date.parse(t)) ? new Date(t) : null,
    route: r !== null && /^\d{1,3}$/.test(r) ? Number(r) : null, // 0-2 routes, 100 = walk + metro
    teen: q.get("teen") === "1",
  };
}

function tripUrl(
  from: Picked | null, to: Picked | null, mode: Mode | "metro", depart: string | null, route: number | null, teen = false,
  shared = false,
): string {
  const q = new URLSearchParams();
  const ll = (p: Picked) => `${p.point[0].toFixed(5)},${p.point[1].toFixed(5)}`;
  if (from) q.set("a", ll(from)), q.set("an", from.label);
  if (to) q.set("b", ll(to)), q.set("bn", to.label);
  q.set("m", mode);
  if (depart) q.set("t", new Date(depart).toISOString().replace(/:00\.000Z$/, "Z"));
  if (route !== null) q.set("r", String(route));
  if (teen) q.set("teen", "1");
  if (shared) q.set("sh", "1");
  return `${window.location.origin}${window.location.pathname}?${q}`;
}

/** Per-device UI preferences (teen mode, hidden layers, details). Never sent anywhere. */
function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setV(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, [key]);
  const set = useCallback((next: T) => {
    setV(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, [key]);
  return [v, set];
}

/** Kinds the person can hide on the map. CCTV is deliberately not in this list: it always shows. */
const HIDEABLE = ["food", "grocery", "shop", "pharmacy", "fuel", "hospital", "police", "hotel", "metro"];

function fmtIst(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", weekday: "short", hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

type Snap = "peek" | "half" | "full";
type Tab = "overview" | "along" | "help" | "time";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "along", label: "Along the way" },
  { id: "help", label: "Help" },
  { id: "time", label: "Best time" },
];

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatch(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return match;
}

/** Height of an element, kept up to date. */
function useHeight<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setH(Math.round(e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, h];
}

function useViewportHeight(): number {
  const [vh, setVh] = useState(800);
  useEffect(() => {
    const update = () => setVh(window.visualViewport?.height ?? window.innerHeight);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return vh;
}

/** First part of a place label ("Lajpat Nagar Central Market, New Delhi" → "Lajpat Nagar Central Market"). */
const short = (p: Picked | null) => (p?.label ?? "").split(",")[0];

/** "11 pm", "10:30 pm", or "Tue 11 pm" when it is not within the next day. */
function shortTime(iso: string): string {
  const t = new Date(iso).getTime();
  const opts: Intl.DateTimeFormatOptions = { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" };
  if (Math.abs(t - Date.now()) > 20 * 3_600_000) opts.weekday = "short";
  return new Intl.DateTimeFormat("en-IN", opts).format(t).replace(":00", "").replace(",", "");
}

export default function App() {
  const { theme } = useTheme();
  const lang = useLang();
  const desktop = useMedia("(min-width: 900px)");
  const vh = useViewportHeight();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [from, setFrom] = useState<Picked | null>(null);
  const [to, setTo] = useState<Picked | null>(null);
  const [mode, setMode] = useState<Mode>("walk");
  // Metro mode plans on foot and puts walk + metro first; the API itself only knows walk and drive.
  const [metroMode, setMetroMode] = useState(false);
  const [sharedView, setSharedView] = useState(false);
  const [persona, setPersonaState] = useState<Persona | null | undefined>(undefined);
  const [askPersona, setAskPersona] = useState(false);
  // The intro plays on every launch, except for shared links and the SOS shortcut.
  const [intro, setIntro] = useState(false);
  const metroRef = useRef(false);
  useEffect(() => {
    if (persona !== undefined) document.documentElement.dataset.persona = persona ?? "";
  }, [persona]);
  const pickPersona = (p: Persona) => {
    savePersona(p);
    if (p === "teen") setTeen(true);
    else if (persona === "teen") setTeen(false);
    if (p === "senior") {
      setMode("drive");
      setMetroMode(false);
    }
    setPersonaState(p);
    setAskPersona(false);
  };
  metroRef.current = metroMode;
  const [preset, setPreset] = useState<Preset>("now");
  const [custom, setCustom] = useState(() => istInputValue(nextIst(23)));
  const [result, setResult] = useState<ApiResult | null>(null);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [about, setAbout] = useState(false);
  const [teen, setTeen] = usePref<boolean>("ghartak-teen", false);
  const [hidden, setHidden] = usePref<string[]>("ghartak-hidden-kinds", []);
  const [showBuses, setShowBuses] = usePref<boolean>("ghartak-bus-layer", false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  // Layout: the plan card (top), the sheet (bottom on phones, side panel on desktop) and its views.
  const [planOpen, setPlanOpen] = useState(true);
  const [timeOpen, setTimeOpen] = useState(false);
  const [detail, setDetail] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [snap, setSnap] = useState<Snap>("peek");
  const [dragH, setDragH] = useState<number | null>(null);
  const [planRef, planH] = useHeight<HTMLElement>();
  const bodyRef = useRef<HTMLDivElement>(null);
  // Trip mode: the start screen, the running trip (survives a reload) and the live position.
  const [tripStart, setTripStart] = useState(false);
  const [session, setSession] = useState<TripSession | null>(null);
  const [me, setMe] = useState<{ lon: number; lat: number; acc: number } | null>(null);
  const snapRef = useRef<((coords: LngLat[], aspect: number) => Promise<Snapshot>) | null>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const wantRoute = useRef<number | null>(null);
  const restored = useRef(false);
  const skipPickerSync = useRef(false);

  useEffect(() => {
    const s = loadTrip();
    if (s) {
      setSession(s);
      setSnap("half");
    }
  }, []);

  // Restore a shared trip from the URL once, on first load.
  useEffect(() => {
    const u = readUrl();
    if (u.from) setFrom(u.from);
    if (u.to) setTo(u.to);
    if (u.mode) setMode(u.mode);
    if (u.metro) setMetroMode(true);
    if (u.shared) setSharedView(true);
    const p = loadPersona();
    setPersonaState(p);
    // First visit: ask who is using Ghar Tak. Never in front of a shared link or the SOS shortcut.
    const plainLaunch = !u.from && !u.to && !window.location.search.includes("sos=1");
    if (plainLaunch) setIntro(true);
    if (!p && plainLaunch) setAskPersona(true);
    if (u.depart) {
      setPreset("custom");
      setCustom(istInputValue(u.depart));
      skipPickerSync.current = true;
    }
    wantRoute.current = u.route;
    if (u.teen) setTeen(true);
    restored.current = true;
  }, []);

  useEffect(() => {
    fetch("/api/meta").then((r) => r.json()).then(setMeta).catch(() => setMeta(null));
  }, []);

  const depart = useMemo(() => {
    if (preset === "now") return null;
    if (preset === "custom") return `${custom}:00+05:30`;
    return nextIst(Number(preset)).toISOString();
  }, [preset, custom]);

  // Keep the custom picker showing the time actually being scored.
  useEffect(() => {
    // On the very first pass this would overwrite a time just restored from a shared link.
    if (skipPickerSync.current) {
      skipPickerSync.current = false;
      return;
    }
    if (preset !== "custom") setCustom(istInputValue(depart ? new Date(depart) : new Date()));
  }, [preset, depart]);

  // Mirror the trip into the address bar (without adding history entries).
  useEffect(() => {
    if (!restored.current) return;
    window.history.replaceState(null, "", tripUrl(from, to, metroMode ? "metro" : mode, depart, result ? selected : null, teen, sharedView));
  }, [from, to, mode, metroMode, depart, selected, result, teen, sharedView]);

  useEffect(() => {
    if (!from || !to) {
      setResult(null);
      setDetail(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetch("/api/routes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: from.point, to: to.point, mode, teen, depart: depart ?? new Date().toISOString() }),
      signal: ac.signal,
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
        return body as ApiResult;
      })
      .then((body) => {
        setResult(body);
        const best = [...body.routes].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];
        const want = wantRoute.current;
        wantRoute.current = null;
        const valid = want !== null && (body.routes.some((r) => r.id === want) || body.metro?.id === want ||
          (body.metroAlts ?? []).some((m) => m.id === want));
        setSelected(valid ? want : metroRef.current && body.metro ? body.metro.id : (best?.id ?? 0));
        // A shared link opens straight on its route; a new search shows the list to compare.
        setDetail(valid);
        setTab("overview");
        setTimeOpen(false);
        setPlanOpen(false);
        setSnap("half");
        setLoading(false);
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setResult(null);
        setError(e.message);
        setLoading(false);
      });
    return () => ac.abort();
  }, [from, to, mode, depart, teen]);

  // The departure-time chart: same routes, scored across the evening. Fetched after the routes
  // so the cards never wait on it.
  useEffect(() => {
    setTimeline(null);
    if (!result || !from || !to) return;
    const ac = new AbortController();
    fetch("/api/timeline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: from.point, to: to.point, mode: result.mode, teen, depart: result.depart }),
      signal: ac.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => body && setTimeline(body))
      .catch(() => undefined);
    return () => ac.abort();
  }, [result, from, to, teen]);

  // "Help other women" nudge: back to the list, then bring the questions into view and highlight them.
  const [askFeedback, setAskFeedback] = useState(0);
  useEffect(() => {
    if (!askFeedback) return;
    const t = setTimeout(() => {
      const el = document.querySelector(".sheet-body .feedback");
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.remove("flash");
      void (el as HTMLElement).offsetWidth;
      el.classList.add("flash");
    }, 320);
    return () => clearTimeout(t);
  }, [askFeedback]);
  const openFeedback = () => {
    setDetail(false);
    setSnap((s) => (s === "peek" ? "half" : s));
    setAskFeedback(Date.now());
  };

  // A new view starts at the top of the sheet.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [detail, tab, about, selected]);

  const pickTime = useCallback((iso: string) => {
    setPreset("custom");
    setCustom(istInputValue(new Date(iso)));
  }, []);

  const pickOnMap = useCallback(
    async (p: LngLat) => {
      const which = !from ? "from" : !to ? "to" : null;
      if (!which) return;
      const set = which === "from" ? setFrom : setTo;
      set({ label: "Locating…", point: p });
      set({ label: await reverseGeocode(p), point: p });
    },
    [from, to],
  );

  const moveMarker = useCallback(async (which: "from" | "to", p: LngLat) => {
    const set = which === "from" ? setFrom : setTo;
    set({ label: await reverseGeocode(p), point: p });
  }, []);

  const openRoute = useCallback((id: number) => {
    setSelected(id);
    setDetail(true);
    setAbout(false);
    setSnap((s) => (s === "peek" ? "half" : s));
  }, []);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError("This browser does not share location.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const p: LngLat = [pos.coords.longitude, pos.coords.latitude];
        setFrom({ label: await reverseGeocode(p), point: p });
      },
      () => setError("Location permission was denied."),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const routes = result?.routes ?? [];
  const fastest = routes.length ? Math.min(...routes.map((r) => r.duration)) : 0;
  const fastestRoute = routes.find((r) => r.duration === fastest) ?? null;
  const bestScore = routes.length ? Math.max(...routes.map((r) => r.score ?? -1)) : 0;
  const metro = result?.metro ?? null;
  const selRoute = routes.find((r) => r.id === selected) ?? null;
  const metros = metro ? [metro, ...(result?.metroAlts ?? [])] : [];
  const selMetro = metros.find((m) => m.id === selected) ?? null;
  const fewestChanges = metros.length > 1 ? Math.min(...metros.map((m) => m.ride.segments.length)) : -1;
  const timeLabel =
    preset === "now" ? t("Now") : preset === "custom" ? shortTime(`${custom}:00+05:30`) : t(PRESETS.find((p) => p.id === preset)!.label);
  const scoreName = teen ? t("teen score") : t("night score");

  // Sheet geometry (phones). The plan card's bottom edge and the sheet's height also frame the map.
  const planBottom = 12 + planH;
  const peekH = !from || !to ? 250 : 210;
  const fullH = Math.max(320, vh - planBottom - 76);
  const halfH = Math.min(fullH, Math.max(peekH + 60, Math.round(vh * 0.48)));
  const heights: Record<Snap, number> = { peek: Math.min(peekH, fullH), half: halfH, full: fullH };
  const sheetH = dragH ?? heights[snap];
  const padding = desktop
    ? { top: 24, bottom: 24, left: 384, right: 56 }
    : { top: planBottom, bottom: heights[snap], left: 0, right: 44 };
  const planCollapsed = (!desktop && !planOpen && Boolean(from && to)) || Boolean(session);

  const onGrabDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, h: sheetH, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onGrabMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 5) d.moved = true;
    if (d.moved) setDragH(Math.max(120, Math.min(heights.full, d.h + dy)));
  };
  const onGrabUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      setSnap(snap === "peek" ? "half" : snap === "half" ? "full" : "half");
    } else {
      const h = dragH ?? d.h;
      const order: Snap[] = ["peek", "half", "full"];
      setSnap(order.reduce((a, b) => (Math.abs(heights[b] - h) < Math.abs(heights[a] - h) ? b : a)));
    }
    setDragH(null);
  };

  const shareFor = (id: number) => {
    if (!result || !from || !to) return "";
    const r = routes.find((x) => x.id === id);
    if (r) {
      return shareText({
        route: r, mode: result.mode, fromLabel: from.label, toLabel: to.label, depart: result.depart,
        url: tripUrl(from, to, result.mode, result.depart, r.id, teen, true),
      });
    }
    const m = metros.find((x) => x.id === id) ?? metro;
    return m
      ? metroShareText({
          metro: m, fromLabel: from.label, toLabel: to.label, depart: result.depart,
          url: tripUrl(from, to, "metro", result.depart, m.id, teen, true),
        })
      : "";
  };

  /** Makes a picture of the route (real map, score, facts) and shares it, or downloads it. */
  const shareImage = async (r: ScoredRoute) => {
    if (!snapRef.current || !result || !from || !to) return;
    const snapshot = await snapRef.current(r.coords, MAP_ASPECT);
    const blob = await routeCard({
      snap: snapshot, route: r, mode: result.mode, from: short(from), to: short(to),
      when: shortTime(result.depart), teen, host: window.location.host,
    });
    const file = new File([blob], "ghar-tak-route.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: shareFor(r.id) }).catch(() => undefined);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const contactUs = (
    <p className="contact-dev">
      <a href="mailto:swayamgupta999@gmail.com">{t("Contact us")}</a>
    </p>
  );

  const metroCard = metros.length ? (
    <>
      {metros.map((m, i) => {
        const changes = m.ride.segments.length - 1;
        const label = i === 0 ? t("Fastest by metro") : m.ride.segments.length === fewestChanges ? t("Fewest changes") : t("Change at {s}", { s: m.ride.segments[1]?.from ?? "" });
        return (
          <li key={m.id}>
            <button type="button" className={selected === m.id ? "rcard sel" : "rcard"} onClick={() => openRoute(m.id)}>
              <Ring score={m.score} label={t("walk parts")} />
              <span className="rc-main">
                <span className="rc-top">
                  <span className="rc-timing">
                    <strong className="rc-duration">~{fmtDuration(m.duration)}</strong>
                    <span className="rc-dist-badge">{changes === 0 ? t("direct") : t(pl(changes, "{n} change", "{n} changes"), { n: changes })}</span>
                  </span>
                  <span className="rc-badges">
                    <span className={i === 0 ? "rc-badge blue" : "rc-badge"}>{label}</span>
                    {i === 0 && m.duration < fastest && <span className="rc-badge good">{t("Faster than walking")}</span>}
                  </span>
                </span>
                <span className="rc-why lines">
                  {m.ride.segments.map((sg, k) => (
                    <span key={k} className="line-chip"><i style={{ background: sg.colour }} />{sg.line.replace(/ Line$/, "")}</span>
                  ))}
                </span>
              </span>
              <div className="chev-wrap"><Icon name="right" className="chev" /></div>
            </button>
          </li>
        );
      })}
    </>
  ) : null;

  // The two-tap route questions: under the route list, and again on the trip screens.
  const feedbackFor = (selectedId: number) =>
    result && from && to ? (
      <Feedback
        tripKey={`${result.mode}|${from.point.join(",")}|${to.point.join(",")}`}
        mode={result.mode}
        depart={result.depart}
        from={from.point}
        to={to.point}
        routes={routes}
        metro={metro}
        teen={teen}
        selectedId={selectedId}
      />
    ) : null;

  let body: React.ReactNode;
  if (session) {
    body = (
      <TripPanel
        session={session} onPosition={setMe} feedback={feedbackFor(session.route.id)}
        onEnd={() => {
          setSession(null);
          setMe(null);
          setDetail(true);
        }}
      />
    );
  } else if (tripStart && result && (selRoute || selMetro) && from && to) {
    const mt = selMetro ? metroTrip(selMetro) : null;
    body = (
      <TripStart
        route={mt ? mt.route : selRoute!} metro={mt?.metro} mode={result.mode} from={short(from)} to={short(to)}
        onCancel={() => setTripStart(false)}
        onStart={(s) => {
          setTripStart(false);
          setSession(s);
          setSnap("half");
        }}
      />
    );
  } else if (about) {
    body = (
      <div className="view">
        <div className="view-head">
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => setAbout(false)}><Icon name="left" /></button>
          <h2>{t("How Ghar Tak works")}</h2>
        </div>
        <About meta={meta} />
        <h3 className="section-title">{t("Helplines")}</h3>
        <HelplineList />
        {contactUs}
      </div>
    );
  } else if (!from || !to) {
    body = (
      <div className="view home">
        <h2>{t("Where to tonight?")}</h2>
        {persona === "parent" && (
          <div className="persona-tip">
            {rich("**Following your child or family?** Ask them to open Ghar Tak, pick their route and tap **Start trip**. You'll get a live link that shows where they are, and turns red if they don't answer a check-in.")}
          </div>
        )}
        {persona === "teen" && (
          <div className="persona-tip">
            {rich("**Teen mode is on.** Routes favour busy main roads, and **Start trip** keeps your guardians in the loop.")}
          </div>
        )}
        <p className="lead">
          {t("Search two places, or tap the map to drop A, then B. Ghar Tak checks every route for the hour you'll be on it: what's open, how lit and busy it is, and where help is.")}
        </p>
        <h3 className="section-title">{t("Emergency helplines")}</h3>
        <HelplineList />
        <p className="note">
          Covers Delhi, Gurugram and Manesar, Faridabad, Noida and Greater Noida, Ghaziabad, Sonipat, Bahadurgarh and
          Bhiwadi (the dashed box on the map).
        </p>
        <button type="button" className="link" onClick={() => setAbout(true)}>How the score works and where the data comes from</button>
        {contactUs}
      </div>
    );
  } else if (loading) {
    body = (
      <div className="view" aria-busy="true">
        <div className="list-head"><h2>Finding routes…</h2><span className="muted">checking what&apos;s open along each</span></div>
        <div className="skeleton" /><div className="skeleton" /><div className="skeleton" />
      </div>
    );
  } else if (error) {
    body = <div className="view"><div className="error">{error}</div></div>;
  } else if (result && detail && selRoute) {
    const r = selRoute;
    body = (
      <div className="view detail">
        <div className="detail-head">
          <button type="button" className="icon-btn" aria-label="Back to all routes" onClick={() => setDetail(false)}><Icon name="left" /></button>
          <Ring score={r.score} label={scoreName} />
          <div className="detail-title">
            <h2>{fmtDuration(r.duration)} · {fmtDistance(r.distance)}</h2>
            <p className="muted">{r.via ? t("via {v}", { v: r.via }) : scoreName}</p>
          </div>
        </div>
        {sharedView && (
          <div className="shared-note">
            <Icon name="info" size={16} />
            <span>{rich("**Someone shared this route with you.** It's their plan, not their live location. To follow them live, ask them to tap **Start trip** and send you the link.")}</span>
          </div>
        )}
        <div className="tabs" role="tablist" aria-label="Route details">
          {TABS.map((tb) => (
            <button
              key={tb.id} type="button" role="tab" aria-selected={tab === tb.id} className={tab === tb.id ? "on" : ""}
              onClick={() => setTab(tb.id)}
            >
              {t(tb.label)}
            </button>
          ))}
        </div>
        <div className="tab-body" role="tabpanel">
          {tab === "overview" && (
            <>
              {teen && <TeenBox r={r} mode={result.mode} depart={result.depart} />}
              <WhyList r={r} fastest={fastestRoute} mode={result.mode} onHelp={() => setTab("help")} />
              <FeedbackNudge tripKey={`${result.mode}|${from.point.join(",")}|${to.point.join(",")}`} onOpen={openFeedback} />
              <details className="how">
                <summary>{t("How this score is made")}</summary>
                <ScoreDetails r={r} mode={result.mode} />
              </details>
            </>
          )}
          {tab === "along" && <AlongRoute r={r} />}
          {tab === "help" && <RouteHelp points={r.emergency} total={r.distance} />}
          {tab === "time" &&
            (timeline ? (
              <Timeline data={timeline} routeId={r.id} depart={result.depart} onPick={pickTime} />
            ) : (
              <p className="note">Checking how this route changes through the evening…</p>
            ))}
          {contactUs}
        </div>
        <div className="actions">
          <button type="button" className="btn start-trip" onClick={() => setTripStart(true)}>
            <Icon name="walk" />
            {t("Start trip")}
            <small>{t("check-ins and live location for your people")}</small>
          </button>
          <Share text={shareFor(r.id)} onImage={() => shareImage(r)} />
        </div>
      </div>
    );
  } else if (result && detail && selMetro) {
    body = (
      <div className="view detail">
        <div className="detail-head">
          <button type="button" className="icon-btn" aria-label="Back to all routes" onClick={() => setDetail(false)}><Icon name="left" /></button>
          <Ring score={selMetro.score} label={t("walk parts")} />
          <div className="detail-title">
            <h2>~{fmtDuration(selMetro.duration)} · {t("walk + metro")}</h2>
            <p className="muted">
              {selMetro.ride.segments.length === 1 ? t("Direct") : t(pl(selMetro.ride.segments.length - 1, "{n} change at {s}", "{n} changes at {s}"), { n: selMetro.ride.segments.length - 1, s: selMetro.ride.segments.slice(1).map((sg) => sg.from.replace(/\s*\(.*\)$/, "")).join(", ") })}
              {" · "}{t("{d} on foot", { d: fmtDistance(selMetro.walkDistance) })}
            </p>
          </div>
        </div>
        <div className="tab-body">
          <MetroBreakdown m={selMetro} />
          <FeedbackNudge tripKey={`${result.mode}|${from.point.join(",")}|${to.point.join(",")}`} onOpen={openFeedback} />
          {contactUs}
        </div>
        <div className="actions">
          <button type="button" className="btn start-trip" onClick={() => setTripStart(true)}>
            <Icon name="train" />
            {t("Start metro trip")}
            <small>{t("tracks your stations even underground")}</small>
          </button>
          <Share text={shareFor(selMetro.id)} />
        </div>
      </div>
    );
  } else if (result) {
    body = (
      <div className="view">
        {sharedView && (
          <div className="shared-note">
            <Icon name="info" size={16} />
            <span><b>Someone shared this route with you.</b> It&apos;s their plan, not their live location. To follow them live, ask them to tap <b>Start trip</b> and send you the link.</span>
          </div>
        )}
        <div className="list-head">
          <h2>{t(pl(routes.length + metros.length, "{n} way home", "{n} ways home"), { n: routes.length + metros.length })}</h2>
          <span className="muted">{t("scored for {w}", { w: fmtIst(result.depart) })}</span>
        </div>
        {metroMode && !metro && (
          <div className="shared-note warn">
            <Icon name="train" size={16} />
            <span><b>{t("No metro option for this trip.")}</b> {result.metroClosed ? (lang === "hi" ? t("The metro isn't running for the whole ride at this time.") : result.metroClosed) : t("There's no station within walking distance at both ends, or the metro isn't faster than walking.")} {t("Walking routes below.")}</span>
          </div>
        )}
        <ol className="cards">
          {metroMode && metroCard}
          {routes.map((r) => {
            const tags = [
              r.duration === fastest && { t: t("Fastest"), c: "amber", icon: "sparkles" as const },
              r.score === bestScore && routes.length > 1 && { t: teen ? t("Top teen score") : t("Top night score"), c: "good", icon: "shieldCheck" as const },
            ].filter(Boolean) as { t: string; c: string; icon?: IconName }[];
            const s = r.stats;
            const litPct = Math.round(s.litTaggedShare * 100);
            return (
              <li key={r.id}>
                <button type="button" className={r.id === selected ? "rcard sel" : "rcard"} onClick={() => openRoute(r.id)}>
                  <Ring score={r.score} label={scoreName} />
                  <span className="rc-main">
                    <span className="rc-top">
                      <span className="rc-timing">
                        <strong className="rc-duration">{fmtDuration(r.duration)}</strong>
                        <span className="rc-dist-badge">
                          {r.duration > fastest + 30 ? `+${t("{m} min", { m: Math.round((r.duration - fastest) / 60) })}` : fmtDistance(r.distance)}
                        </span>
                      </span>
                      {tags.length > 0 && (
                        <span className="rc-badges">
                          {tags.map((tg) => (
                            <span key={tg.t} className={`rc-badge ${tg.c}`}>
                              {tg.icon && <Icon name={tg.icon} size={11} />}
                              {tg.t}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="rc-telemetry-row">
                      <span className="rc-stat" title={`${litPct}% tagged lit`}>
                        <Icon name="bulb" size={12} className="stat-ico" />
                        <span className="stat-num">{litPct}%</span>
                        <span className="stat-unit">{t("lit")}</span>
                      </span>
                      <span className="rc-stat-sep" />
                      <span className="rc-stat" title={`${s.openPlaces} open places`}>
                        <Icon name="store" size={12} className="stat-ico" />
                        <span className="stat-num">{s.openPlaces}</span>
                        <span className="stat-unit">{t("open")}</span>
                      </span>
                      {s.cameras > 0 && (
                        <>
                          <span className="rc-stat-sep" />
                          <span className="rc-stat" title={`${s.cameras} mapped CCTV cameras`}>
                            <Icon name="cam" size={12} className="stat-ico" />
                            <span className="stat-num">{s.cameras}</span>
                            <span className="stat-unit">CCTV</span>
                          </span>
                        </>
                      )}
                      {s.longestGap >= 100 && (
                        <>
                          <span className="rc-stat-sep" />
                          <span className="rc-stat rc-stat-quiet" title={`Dark or quiet stretch: ${fmtDistance(s.longestGap)}`}>
                            <Icon name="alert" size={11} className="stat-ico" />
                            <span className="stat-num">{fmtDistance(s.longestGap)}</span>
                            <span className="stat-unit">quiet</span>
                          </span>
                        </>
                      )}
                    </span>
                  </span>
                  <div className="chev-wrap">
                    <Icon name="right" className="chev" />
                  </div>
                </button>
              </li>
            );
          })}
          {!metroMode && metroCard}
        </ol>
        {result.metroClosed && (
          <p className="metro-closed">
            <Icon name="train" size={16} />
            <span><b>{t("No walk + metro option.")}</b> {lang === "hi" ? t("The metro isn't running for the whole ride at this time.") : result.metroClosed}</span>
          </p>
        )}
        <div className="actions inline"><Share text={shareFor(selected)} /></div>
        {feedbackFor(selected)}
        <p className="disclaimer">
          Ghar Tak compares routes using public data; it cannot see what is happening on a street tonight. Use it to
          weigh options, not as a guarantee. In an emergency call <a href="tel:112">112</a>.{" "}
          <button type="button" className="link" onClick={() => setAbout(true)}>How the score works</button>
        </p>
        {contactUs}
      </div>
    );
  }

  return (
    <div
      className={desktop ? "app desk" : "app mob"}
      style={{ "--plan-b": `${planBottom}px`, "--sheet-h": `${sheetH}px` } as React.CSSProperties}
    >
      <main className="stage">
        <MapView
          bbox={meta?.bbox ?? null}
          from={from?.point ?? null}
          to={to?.point ?? null}
          routes={session ? [session.route] : routes}
          metro={session ? null : (selMetro ?? metro)}
          theme={theme}
          hidden={hidden}
          showBuses={showBuses}
          selected={session ? session.route.id : selected}
          padding={padding}
          me={me}
          snapshot={snapRef}
          onPick={pickOnMap}
          onMove={moveMarker}
          onSelect={(id) => (result ? openRoute(id) : setSelected(id))}
        />
      </main>

      <div className="dock">
        <section ref={planRef} className={planCollapsed ? "plan collapsed" : "plan"} aria-label="Trip">
          {session ? (
            <div className="plan-mini trip-banner">
              <span className="mini-route">
                <span className="live-dot" />
                <b>{t("On your way to {p}", { p: session.to })}</b>
              </span>
              <span className="chip"><Icon name={session.mode === "walk" ? "walk" : "car"} size={15} />{t("Trip")}</span>
            </div>
          ) : planCollapsed ? (
            <button
              type="button" className="plan-mini" aria-label="Edit trip"
              onClick={() => {
                setPlanOpen(true);
                setSnap("peek");
              }}
            >
              <span className="mini-route">
                <span className="mini-pin a" />
                <b>{short(from)}</b>
                <Icon name="right" size={13} className="mini-arrow" />
                <span className="mini-pin b" />
                <b>{short(to)}</b>
              </span>
              <span className="chip">
                <Icon name={metroMode ? "train" : mode === "walk" ? "walk" : "car"} size={15} />
                {timeLabel}
                {teen && " · Teen"}
              </span>
            </button>
          ) : (
            <>
              <div className="plan-head">
                <div className="brand-group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icons/logo.svg" alt="" width={26} height={26} className="brand-logo" />
                  <div className="brand-info">
                    <h1 className="brand-title">Ghar Tak</h1>
                    <span className="brand-badge">
                      <span className="live-dot-pulse" />
                      Delhi NCR · Night Safety
                    </span>
                  </div>
                </div>
                <div className="plan-actions">
                  <button
                    type="button" className="persona-chip" onClick={() => setAskPersona(true)}
                    aria-label={`Using Ghar Tak as: ${PERSONAS.find((x) => x.id === persona)?.title ?? "not set"}. Change`}
                    title="Who's using Ghar Tak?"
                  >
                    <span aria-hidden>{PERSONAS.find((x) => x.id === persona)?.emoji ?? "👤"}</span>
                  </button>
                  <button
                    type="button" className="lang-chip" onClick={() => setLang(lang === "hi" ? "en" : "hi")}
                    aria-label={lang === "hi" ? "Switch to English" : "हिन्दी में देखें"} title={lang === "hi" ? "English" : "हिन्दी"}
                  >
                    {lang === "hi" ? "EN" : "हिं"}
                  </button>
                  <InstallApp />
                  <ThemeToggle iconOnly />
                  <button type="button" className="icon-btn" aria-label="How Ghar Tak works" onClick={() => setAbout(true)}>
                    <Icon name="info" />
                  </button>
                  {!desktop && result && (
                    <button type="button" className="icon-btn" aria-label="Done" onClick={() => setPlanOpen(false)}>
                      <Icon name="x" />
                    </button>
                  )}
                </div>
              </div>
              <div className="plan-fields">
                <PlaceSearch
                  label="From" marker="A" value={from} bbox={meta?.bbox ?? null}
                  placeholder={t("From: office, metro station, sector…")} onPick={setFrom}
                />
                <PlaceSearch
                  label="To" marker="B" value={to} bbox={meta?.bbox ?? null}
                  placeholder={t("To: home, PG, hotel…")} onPick={setTo}
                />
                <button
                  type="button" className="swap" aria-label="Swap start and destination" disabled={!from && !to}
                  onClick={() => {
                    setFrom(to);
                    setTo(from);
                  }}
                >
                  <Icon name="swap" size={17} />
                </button>
              </div>
              {!from && (
                <button type="button" className="link locate-link" onClick={useMyLocation}>
                  <Icon name="locate" size={15} />
                  {t("Use my location as the start")}
                </button>
              )}
              <div className="plan-opts">
                <div className="seg" role="radiogroup" aria-label="Travel mode">
                  {(["walk", "metro", "drive"] as const).map((m) => {
                    const on = m === "metro" ? metroMode : !metroMode && mode === m;
                    return (
                      <button
                        key={m} type="button" role="radio" aria-checked={on} className={on ? "on" : ""}
                        onClick={() => {
                          setMetroMode(m === "metro");
                          setMode(m === "drive" ? "drive" : "walk");
                          if (m === "metro" && result?.metro) setSelected(result.metro.id);
                        }}
                      >
                        <Icon name={m === "walk" ? "walk" : m === "metro" ? "train" : "car"} size={16} />
                        {m === "walk" ? t("Walk") : m === "metro" ? t("Metro") : t("Cab")}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button" className={preset !== "now" || timeOpen ? "chip on" : "chip"}
                  onClick={() => setTimeOpen(!timeOpen)} aria-expanded={timeOpen} aria-label={`Leaving: ${timeLabel}. Change time`}
                >
                  <Icon name="clock" size={15} />
                  {timeLabel}
                </button>
                <button
                  type="button" className={teen ? "chip on" : "chip"} aria-pressed={teen} onClick={() => setTeen(!teen)}
                  title="Teen mode: stricter ranking. Open, busy main roads first; short empty stretches only"
                >
                  <Icon name="teen" size={15} />
                  {t("Teen")}
                </button>
              </div>
              {timeOpen && (
                <div className="time-pop">
                  <span className="row-label">Leaving</span>
                  <div className="chips">
                    {PRESETS.map((p) => (
                      <button
                        key={p.id} type="button" className={preset === p.id ? "chip on" : "chip"}
                        onClick={() => {
                          setPreset(p.id);
                          setTimeOpen(false);
                        }}
                      >
                        {t(p.label)}
                      </button>
                    ))}
                    <input
                      type="datetime-local" aria-label="Custom departure time (IST)"
                      className={preset === "custom" ? "on" : ""} value={custom}
                      onChange={(e) => {
                        setCustom(e.target.value);
                        setPreset("custom");
                      }}
                    />
                  </div>
                </div>
              )}
              {teen && (
                <p className="teen-note">
                  {rich("**Teen mode is on:** open, busy main roads rank first, and long empty stretches count more.")}
                </p>
              )}
            </>
          )}
        </section>

        <section
          className={dragH !== null ? "sheet dragging" : `sheet ${snap}`}
          style={desktop ? undefined : { height: sheetH }}
          aria-label="Routes"
        >
          {!desktop && (
            <div
              className="grab" onPointerDown={onGrabDown} onPointerMove={onGrabMove} onPointerUp={onGrabUp}
              onPointerCancel={onGrabUp} role="button" tabIndex={0}
              aria-label={snap === "full" ? "Make the panel smaller" : "Make the panel bigger"}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSnap(snap === "full" ? "half" : snap === "half" ? "full" : "half");
                }
              }}
            >
              <span className="handle" />
            </div>
          )}
          <div className="sheet-body" ref={bodyRef} aria-live="polite">{body}</div>
        </section>
      </div>

      <div className="map-tools">
        <ThemeToggle className="fab theme-fab" iconOnly />
        <button
          type="button" className={layersOpen ? "fab on" : "fab"} aria-label="Map layers" aria-expanded={layersOpen}
          onClick={() => setLayersOpen(!layersOpen)}
        >
          <Icon name="layers" size={19} />
        </button>
        {layersOpen && (
          <div className="layers" aria-label="Map layers">
            <div className="layers-head">
              <b>{t("Show on map")}</b>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setLayersOpen(false)}><Icon name="x" size={16} /></button>
            </div>
            <div className="layers-grid">
              {LEGEND.map((l) => {
                const lockedOn = l.kind === "camera";
                const on = lockedOn || !hidden.includes(l.kind);
                return (
                  <button
                    key={l.kind} type="button" className={on ? "layer on" : "layer"} aria-pressed={on} disabled={lockedOn}
                    title={lockedOn ? "CCTV points are always shown" : on ? `Hide ${l.label}` : `Show ${l.label}`}
                    onClick={() => setHidden(on ? [...hidden, l.kind] : hidden.filter((k) => k !== l.kind))}
                  >
                    <i style={{ background: KIND_COLORS[theme][l.kind] }} />
                    {l.label}
                    {lockedOn && <small>always on</small>}
                  </button>
                );
              })}
              <button type="button" className={showBuses ? "layer on" : "layer"} aria-pressed={showBuses} onClick={() => setShowBuses(!showBuses)}>
                <i className="bus" />
                Bus routes
              </button>
            </div>
            <div className="layers-key">
              <span><i className="hollow" />Hollow: closed when you pass</span>
              <span><i className="gap" />Red dashes: nothing open</span>
            </div>
            {HIDEABLE.some((k) => hidden.includes(k)) && (
              <button type="button" className="link" onClick={() => setHidden([])}>Show all</button>
            )}
          </div>
        )}
      </div>
      <SosButton />
      {(askPersona || intro) && (
        <Onboarding
          splash={intro} ask={askPersona} current={persona ?? null}
          onPick={(p) => {
            pickPersona(p);
            setIntro(false);
          }}
          onDone={() => setIntro(false)}
        />
      )}
    </div>
  );
}

/** A score in a ring that fills to the score, coloured like the map. */
function Ring({ score, label }: { score: number | null; label: string }) {
  const col = scoreColor(score);
  return (
    <div className="ring-container">
      <span
        className="ring" role="img" aria-label={`${label} ${score ?? "not available"}`}
        style={{ "--p": score ?? 0, "--c": col } as React.CSSProperties}
      >
        <span className="ring-glow" style={{ background: col }} aria-hidden />
        <b className="ring-score">{score ?? "–"}</b>
      </span>
      <span className="ring-label">{scoreRating(score)}</span>
    </div>
  );
}

/** "Why this route", in plain words, each line backed by the route's own numbers. */
function WhyList({ r, fastest, mode, onHelp }: { r: ScoredRoute; fastest: ScoredRoute | null; mode: Mode; onHelp: () => void }) {
  const s = r.stats;
  const quiet = mode === "walk" ? 300 : 2500;
  const light = r.components.light ?? 0;
  const first = [...r.emergency].sort((a, b) => a.at - b.at)[0];
  const items: { tone: "good" | "warn" | "bad"; icon: IconName; b: string; t: string }[] = [];
  items.push({
    tone: s.openPlaces >= (fastest?.stats.openPlaces ?? 0) ? "good" : "warn", icon: "store",
    b: t(pl(s.openPlaces, "{n} place open", "{n} places open"), { n: s.openPlaces }),
    t: fastest && fastest.id !== r.id ? t(" when you pass, vs {n} on the fastest route", { n: fastest.stats.openPlaces }) : t(" when you pass"),
  });
  items.push({
    tone: s.longestGap > quiet * 4 ? "bad" : s.longestGap > quiet ? "warn" : "good", icon: s.longestGap > quiet ? "alert" : "check",
    b: s.longestGap >= 100 ? t("Longest empty stretch: {d}", { d: fmtDistance(s.longestGap) }) : t("No long empty stretch"),
    t: s.longestGap >= 100 ? (s.longestGapDark ? t(", and it's dark") : "") + t(". Red dashes on the map") : "",
  });
  items.push({
    tone: light >= 0.8 ? "good" : light >= 0.5 ? "warn" : "bad", icon: "bulb", b: t(lightLabel(r)),
    t: t(": {n} street lamps mapped, {lvl} on satellite", { n: s.lamps, lvl: t(s.meanRadiance >= 30 ? "bright" : s.meanRadiance >= 15 ? "moderate" : "dim") }),
  });
  items.push({
    tone: s.mainRoadShare >= 0.4 ? "good" : "warn", icon: "road", b: t("{p}% on main roads", { p: Math.round(s.mainRoadShare * 100) }),
    t: s.smallRoadShare >= 0.5 ? t(", {p}% internal lanes", { p: Math.round(s.smallRoadShare * 100) }) : "",
  });
  if (r.components.cameras !== null) {
    items.push({ tone: "good", icon: "cam", b: t("{n} CCTV cameras", { n: s.cameras }), t: t(" mapped beside the route") });
  }
  return (
    <>
      <ul className="why">
        {items.map((it) => (
          <li key={it.b}>
            <span className={`why-ic ${it.tone}`}><Icon name={it.icon} size={15} /></span>
            <span><b>{it.b}</b>{it.t}</span>
          </li>
        ))}
      </ul>
      {first ? (
        <div className="help-peek">
          <span className={`why-ic ${first.kind}`}><Icon name="shield" size={15} /></span>
          <span className="hp-text">
            <b>{first.name}</b>
            <span className="muted">
              {first.kind === "police" ? t("Police") : t("Hospital")} · {t("{d} into the trip", { d: fmtDistance(first.at) })}
            </span>
          </span>
          {first.phone && <a className="hp-call" href={`tel:${first.phone}`}><Icon name="phone" size={14} />{t("Call")}</a>}
          <button type="button" className="link" onClick={onHelp}>{t("All help")}</button>
        </div>
      ) : (
        <p className="note">{t("No hospital or police station mapped close to this route. In an emergency, call 112.")}</p>
      )}
    </>
  );
}

function TeenBox({ r, mode, depart }: { r: ScoredRoute; mode: Mode; depart: string }) {
  const s = r.stats;
  const istHour = (new Date(depart).getTime() / 3_600_000 + 5.5) % 24;
  const late = istHour >= 21 || istHour < 5;
  const quietLimit = mode === "walk" ? 300 : 2500;
  return (
    <div className="teen-box">
      <b>{t("Teen mode")}</b>
      <ul>
        {s.longestGap > quietLimit && (
          <li>{t("This route has a {d} stretch with nothing open. Prefer a route with a higher teen score, or a cab.", { d: fmtDistance(s.longestGap) })}</li>
        )}
        {late && <li>{t("It's late. Ask a parent or guardian to pick you up, or send them your trip before you leave.")}</li>}
        <li>{t("Use the button below to send your route and location to your guardians.")}</li>
      </ul>
      <HelplineList compact />
    </div>
  );
}

const clock = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function MetroBreakdown({ m }: { m: MetroOption }) {
  const [leg1, leg2] = m.legs;
  // Any part of the ride between 10:30 pm and 6 am IST: last/first trains matter.
  const istH = (iso: string) => (new Date(iso).getTime() / 3_600_000 + 5.5) % 24;
  const isLate = (h: number) => h >= 22.5 || h < 6;
  const late = isLate(istH(m.board.at)) || isLate(istH(m.alight.at));
  const operators = [...new Set(m.ride.segments.map((s) => s.operator).filter(Boolean))];
  const a = m.assumptions;
  return (
    <div className="breakdown">
      {late && (
        <div className="warn">
          This ride runs late at night. Ghar Tak has no train times, so check the last train from{" "}
          <b>{m.board.station}</b>
          {m.ride.segments.length > 1 && <> and the connections at {m.ride.segments.slice(1).map((s) => s.from).join(", ")}</>}{" "}
          with {operators.join(" / ") || "the operator"} before you rely on this.
        </div>
      )}
      <ol className="journey">
        <li className="walk">
          <span className="j-dot" />
          <div>{rich("**Walk {d}** to **{s}** station", { d: fmtDistance(leg1.distance), s: m.board.station })}
            <div className="muted small">{fmtDuration(leg1.duration)} · {t("night score {s}", { s: leg1.score ?? "–" })} · {summary(leg1)[0]}</div></div>
        </li>
        {m.ride.segments.map((sg, i) => (
          <li key={i} className="ride" style={{ "--lc": sg.colour } as React.CSSProperties}>
            <span className="j-dot" />
            <div>
              {i > 0 && <div className="j-change"><Icon name="swap" size={14} />{rich("Change at **{s}**", { s: sg.from })}</div>}
              <div><span className="line-chip"><i style={{ background: sg.colour }} />{sg.line}</span> {rich("towards **{d}**", { d: sg.towards })}</div>
              <div className="muted small">
                {rich("Board at {a} · {n} stops · get off at **{b}**", { a: sg.from, n: sg.stops, b: sg.to })}
              </div>
              {sg.stations.length > 2 && (
                <details className="j-stops">
                  <summary>{t("{n} stops in between", { n: sg.stations.length - 2 })}</summary>
                  <ol>{sg.stations.slice(1, -1).map((st) => <li key={st.name}>{st.name}</li>)}</ol>
                </details>
              )}
            </div>
          </li>
        ))}
        <li className="walk">
          <span className="j-dot" />
          <div>{rich("**Walk {d}** from {s} station, around {t}", { d: fmtDistance(leg2.distance), s: m.alight.station, t: clock(m.alight.at) })}
            <div className="muted small">{fmtDuration(leg2.duration)} · {t("night score {s}", { s: leg2.score ?? "–" })} · {summary(leg2)[0]}</div></div>
        </li>
        <li className="end">
          <span className="j-dot" />
          <div><b>{t("Arrive around {t}", { t: clock(m.alight.arrive) })}</b></div>
        </li>
      </ol>
      <p className="note">
        Arrive around <b>{clock(m.alight.arrive)}</b> (estimate). Train times are not openly published, so the ride is
        estimated at {a.speedKmh} km/h between stations ({a.speedSource[0] ?? "default"} in OpenStreetMap), plus{" "}
        {a.waitMin} min waiting each time you board and {a.changeMin} min per change. The score covers only the walking
        parts, each checked at the time you&apos;d be on it.
      </p>
    </div>
  );
}

/** The score's ingredients: plain facts, then each factor's value and weight. */
function ScoreDetails({ r, mode }: { r: ScoredRoute; mode: Mode }) {
  const order: Component[] = ["activity", "gaps", "light", "roads", "help", "cameras", "transit"];
  const s = r.stats;
  return (
    <div className="breakdown">
      <ul className="facts">
        {summary(r).map((line) => <li key={line}>{line}</li>)}
      </ul>
      <table className="bars">
        <tbody>
          {order
            .filter((k) => !(k === "transit" && mode === "drive"))
            .map((k) => {
              const v = r.components[k];
              const w = r.weights[k];
              return (
                <tr key={k} title={COMPONENT_LABEL[k].help}>
                  <th scope="row">{COMPONENT_LABEL[k].label}</th>
                  <td className="bar-cell">
                    {v === null ? (
                      <span className="nodata">no data here</span>
                    ) : (
                      <span className="bar"><span style={{ width: `${Math.round(v * 100)}%` }} /></span>
                    )}
                  </td>
                  <td className="num">{v === null ? "" : Math.round(v * 100)}</td>
                  <td className="num muted">{w ? `×${Math.round(w * 100)}%` : ""}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
      <p className="note">
        {s.openPlaces + s.closedPlaces - s.assumedHours} of {s.openPlaces + s.closedPlaces} places along this route
        publish opening hours in OpenStreetMap; the rest use category defaults (e.g. eateries 11 am–11 pm), so treat
        their open/closed state as an estimate. Tap any pin for details.
      </p>
    </div>
  );
}

function About({ meta }: { meta: Meta | null }) {
  return (
    <div className="about">
      <h2>What the night score measures</h2>
      <p>
        Each route is sampled every 15 m (walking) or 25 m (driving). At each point Ghar Tak checks, for the time you
        would actually reach it:
      </p>
      <ul>
        <li><b>Open places</b> within 45 m (walking) or 70 m (driving): eateries, grocery stores, chemists, petrol pumps, hospitals, police, hotels, malls, stations.</li>
        <li><b>Empty stretches</b>: the longest run with nothing open, counted in full if dark and at half if well lit.</li>
        <li><b>Light</b> from NASA's VIIRS night-time radiance, plus OSM <code>lit</code> tags and mapped street lamps.</li>
        <li><b>Road type</b> from OpenStreetMap: main roads over internal lanes, service roads and tracks.</li>
        <li><b>Help nearby</b>: an open hospital or police station within 500 m (walking) or 1 km (driving).</li>
        <li><b>CCTV</b> mapped in OSM, and <b>transit points</b> for walking routes.</li>
      </ul>
      <p>
        Walking and driving use different weights; each route card shows them. Methodology and all thresholds are in
        the project README.
      </p>
      <h2>Data</h2>
      <ul>
        <li>
          Roads, hours, cameras, lamps: © OpenStreetMap contributors (ODbL), extracts of{" "}
          {meta ? Object.values(meta.osmExtracts)[0] : "…"}.
        </li>
        <li>Places: Overture Maps Foundation, release {meta?.overtureRelease ?? "…"} (confidence ≥ {meta?.overtureMinConfidence ?? 0.65}).</li>
        <li>
          Night light: NASA Black Marble VNP46A2/VJ146A2 via NASA GIBS, median of {meta?.lightNights.length ?? 30}{" "}
          satellite passes up to {meta?.lightNights[0]?.split(":")[1] ?? "…"}.
        </li>
        <li>Metro and RRTS lines and stops: OpenStreetMap route relations. No train times; ride times are estimates.</li>
        <li>Routing: OSRM on FOSSGIS servers. Search: Photon by komoot. Map: OpenFreeMap.</li>
      </ul>
      <h2>Known limits</h2>
      <ul>
        <li>Most places in NCR do not publish hours, so many open/closed states are category defaults.</li>
        <li>Satellite light is ~500 m per pixel and saturates in bright sectors: good at spotting dark belts (the Aravallis, the Yamuna floodplain), not single dark lanes.</li>
        <li>CCTV mapping is dense in central and south Delhi and sparse elsewhere in NCR; where none is mapped, that factor is left out rather than scored as zero.</li>
        <li>Public holidays are not modelled.</li>
      </ul>
    </div>
  );
}
