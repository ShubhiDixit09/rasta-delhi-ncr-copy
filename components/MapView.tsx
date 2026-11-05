"use client";

import maplibregl, { GeoJSONSource, LngLatLike, Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { LngLat } from "@/lib/geo";
import type { MetroOption } from "@/lib/metro";
import type { ScoredRoute } from "@/lib/score";
import type { Theme } from "@/lib/theme";
import { KIND_COLORS } from "./format";
const NCR_CENTER: LngLatLike = [77.2, 28.6];

interface Props {
  bbox: [number, number, number, number] | null;
  from: LngLat | null;
  to: LngLat | null;
  routes: ScoredRoute[];
  metro: MetroOption | null;
  selected: number;
  theme: Theme;
  /** Place kinds hidden by the person. CCTV ("camera") is never hidden. */
  hidden: string[];
  showBuses: boolean;
  /** Screen space covered by the floating panels, so routes are framed in the visible part of the map. */
  padding: { top: number; bottom: number; left: number; right: number };
  /** The person's live position during a trip (a blue dot the map follows). */
  me?: { lon: number; lat: number; acc: number } | null;
  /** Set to a function that renders the map around a route as an image, for route cards. */
  snapshot?: React.RefObject<((coords: LngLat[], aspect: number) => Promise<Snapshot>) | null>;
  onPick: (p: LngLat) => void;
  onMove: (which: "from" | "to", p: LngLat) => void;
  onSelect: (id: number) => void;
}

/** Fit padding: the panels' footprint plus a margin, shrunk if the visible area gets too small. */
function inset(p: Props["padding"]) {
  const el = document.querySelector(".maplibregl-canvas") as HTMLCanvasElement | null;
  const w = el?.clientWidth ?? 800, h = el?.clientHeight ?? 600;
  const m = 36;
  let { top, bottom, left, right } = { top: p.top + m, bottom: p.bottom + m, left: p.left + m, right: p.right + m };
  if (h - top - bottom < 120) {
    const k = Math.max(0, h - 120) / (top + bottom);
    top *= k;
    bottom *= k;
  }
  if (w - left - right < 120) {
    const k = Math.max(0, w - 120) / (left + right);
    left *= k;
    right *= k;
  }
  return { top, bottom, left, right };
}

/** A map image for a route card: the PNG, the crop to use, and where A and B are (0..1 of the crop). */
export interface Snapshot {
  url: string;
  crop: { x: number; y: number; w: number; h: number };
  start: [number, number];
  end: [number, number];
}

const PLACE_LAYERS = ["places-help", "places-open", "places-closed", "places-cam"];

const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export default function MapView({
  bbox, from, to, routes, metro, selected, theme, hidden, showBuses, padding, me = null, snapshot, onPick, onMove, onSelect,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const markers = useRef<{ from?: Marker; to?: Marker }>({});
  const handlers = useRef({ onPick, onMove, onSelect });
  handlers.current = { onPick, onMove, onSelect };
  const latest = useRef({ routes, metro, selected, theme, bbox, hidden, showBuses });
  latest.current = { routes, metro, selected, theme, bbox, hidden, showBuses };
  const styleTheme = useRef<Theme | null>(null);
  const pad = useRef(padding);
  const meMarker = useRef<Marker | null>(null);
  const userMovedAt = useRef(0);
  pad.current = padding;

  useEffect(() => {
    if (!el.current || map.current) return;
    // The map only renders in the browser, where the boot script has already set the real theme.
    const initial: Theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    styleTheme.current = initial;
    latest.current.theme = initial;
    const m = new maplibregl.Map({
      container: el.current,
      style: STYLES[initial],
      center: NCR_CENTER,
      zoom: 9.3,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(
      new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }),
      "top-right",
    );
    m.on("dragstart", () => (userMovedAt.current = Date.now()));
    m.on("load", () => {
      addOverlays(m, latest.current.theme);
      applyCoverage(m, latest.current.bbox);

      m.on("click", "ride", () => handlers.current.onSelect(100));
      m.on("click", "routes-alt", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id !== undefined) handlers.current.onSelect(Number(id));
      });
      m.on("mouseenter", "routes-alt", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "routes-alt", () => (m.getCanvas().style.cursor = ""));
      for (const id of PLACE_LAYERS) {
        m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
      }
      m.on("click", PLACE_LAYERS, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, string | boolean>;
        const status = p.open ? "Open" : "Closed";
        const basis =
          p.hours === "camera" ? "Mapped in OpenStreetMap (man_made=surveillance)"
          : p.hours === "tagged" ? `OSM hours: ${p.oh}`
          : "Hours not published; category default assumed";
        const line = p.hours === "camera" ? "CCTV camera" : `${p.label} · ${status} when you pass`;
        new maplibregl.Popup({ closeButton: false, offset: 8 })
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setDOMContent(popup(String(p.name || p.label), line, basis))
          .addTo(m);
      });
      m.on("click", (e) => {
        const hits = m.queryRenderedFeatures(e.point, { layers: [...PLACE_LAYERS, "routes-alt", "ride"] });
        if (!hits.length) handlers.current.onPick([e.lngLat.lng, e.lngLat.lat]);
      });

      ready.current = true;
      draw(m, latest.current.routes, latest.current.metro, latest.current.selected, latest.current.theme, latest.current.hidden);
      applyBuses(m, latest.current.showBuses);
    });
    // Every later basemap swap (theme change) wipes custom layers; put them back each time.
    m.on("style.load", () => {
      const l = latest.current;
      addOverlays(m, styleTheme.current ?? l.theme);
      applyCoverage(m, l.bbox);
      draw(m, l.routes, l.metro, l.selected, l.theme, l.hidden);
      applyBuses(m, l.showBuses);
      ready.current = true;
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      ready.current = false;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (m && ready.current) applyCoverage(m, bbox);
  }, [bbox]);

  // Theme change: swap the basemap, then put Ghar Tak's layers back on top of it.
  useEffect(() => {
    const m = map.current;
    // <html data-theme> is updated before React state, so it is the reliable value on first mount.
    const actual: Theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    if (!m || styleTheme.current === actual) return;
    styleTheme.current = actual;
    ready.current = false;
    // diff: false forces a full replace, so "style.load" fires and the handler set up at init
    // re-adds Ghar Tak's layers. A diffed update can drop custom layers without that event.
    m.setStyle(STYLES[actual], { diff: false });
  }, [theme]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const which of ["from", "to"] as const) {
      const p = which === "from" ? from : to;
      const existing = markers.current[which];
      if (!p) {
        existing?.remove();
        markers.current[which] = undefined;
        continue;
      }
      if (existing) {
        existing.setLngLat(p);
      } else {
        const node = document.createElement("div");
        node.className = `pin pin-${which}`;
        node.textContent = which === "from" ? "A" : "B";
        const mk = new maplibregl.Marker({ element: node, draggable: true }).setLngLat(p).addTo(m);
        mk.on("dragend", () => {
          const ll = mk.getLngLat();
          handlers.current.onMove(which, [ll.lng, ll.lat]);
        });
        markers.current[which] = mk;
      }
    }
    if (from && to && !routes.length) {
      m.fitBounds(new maplibregl.LngLatBounds(from, from).extend(to), { padding: inset(pad.current), maxZoom: 15, duration: 600 });
    } else if (from && !to) {
      m.easeTo({ center: from, zoom: Math.max(m.getZoom(), 13), padding: inset(pad.current) });
    }
  }, [from, to, routes.length]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    draw(m, routes, metro, selected, theme, hidden);
  }, [routes, metro, selected, theme, hidden]);

  useEffect(() => {
    const m = map.current;
    if (m && ready.current) applyBuses(m, showBuses);
  }, [showBuses]);

  useEffect(() => {
    const m = map.current;
    if (!m || !routes.length) return;
    const b = new maplibregl.LngLatBounds();
    for (const r of routes) for (const c of r.coords) b.extend(c);
    for (const l of metro?.legs ?? []) for (const c of l.coords) b.extend(c);
    for (const sg of metro?.ride.segments ?? []) for (const c of sg.coords) b.extend(c);
    // Wait a moment so the panels have settled (a phone's plan card collapses as results arrive).
    const t = setTimeout(() => m.fitBounds(b, { padding: inset(pad.current), maxZoom: 16, duration: 700 }), 120);
    return () => clearTimeout(t);
    // Re-frame when the panels change size (a phone's sheet snapping up or down), not on every pixel.
  }, [routes, metro, padding.top, padding.bottom, padding.left]);

  // Trip mode: the blue dot, and the map follows it unless the person has just panned around.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!me) {
      meMarker.current?.remove();
      meMarker.current = null;
      return;
    }
    if (!meMarker.current) {
      const node = document.createElement("div");
      node.className = "me-dot";
      node.setAttribute("aria-label", "You are here");
      meMarker.current = new maplibregl.Marker({ element: node }).setLngLat([me.lon, me.lat]).addTo(m);
    } else {
      meMarker.current.setLngLat([me.lon, me.lat]);
    }
    if (Date.now() - userMovedAt.current > 20_000) {
      m.easeTo({ center: [me.lon, me.lat], zoom: Math.max(m.getZoom(), 15), padding: inset(pad.current), duration: 800 });
    }
  }, [me]);

  useEffect(() => {
    if (!snapshot) return;
    snapshot.current = async (coords, aspect) => {
      const m = map.current;
      if (!m) throw new Error("map not ready");
      const camera = { center: m.getCenter(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() };
      const canvas = m.getCanvas();
      const W = canvas.clientWidth, H = canvas.clientHeight;
      // The largest box of the card's shape that fits on screen, with the route framed inside it.
      const bw = Math.min(W, H * aspect), bh = bw / aspect;
      const box = { x: (W - bw) / 2, y: (H - bh) / 2, w: bw, h: bh };
      const b = new maplibregl.LngLatBounds();
      for (const c of coords) b.extend(c);
      m.fitBounds(b, {
        padding: { top: box.y + bh * 0.12, bottom: box.y + bh * 0.12, left: box.x + bw * 0.1, right: box.x + bw * 0.1 },
        duration: 0, maxZoom: 16,
      });
      await new Promise((r) => m.once("idle", r));
      const url = await new Promise<string>((res) => {
        m.once("render", () => res(canvas.toDataURL("image/png")));
        m.triggerRepaint();
      });
      const k = canvas.width / W;
      const at = (c: LngLat) => {
        const p = m.project(c);
        return [(p.x - box.x) / bw, (p.y - box.y) / bh] as [number, number];
      };
      const out: Snapshot = {
        url, crop: { x: box.x * k, y: box.y * k, w: bw * k, h: bh * k },
        start: at(coords[0]), end: at(coords[coords.length - 1]),
      };
      m.jumpTo(camera);
      return out;
    };
    return () => {
      snapshot.current = null;
    };
  }, [snapshot]);

  return <div ref={el} className="map" />;
}

/** Basemaps from OpenFreeMap: a dark one, and Positron, a quiet light one that keeps overlays readable. */
const STYLES: Record<Theme, string> = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
};

const OVERLAY: Record<Theme, Record<string, string>> = {
  dark: { bus: "#2dd4bf", coverage: "#f5b942", alt: "#6b7480", casing: "#0b0d10", selected: "#e8eaed", hole: "#0e1116", label: "#e8eaed", gap: "#ff4d40" },
  light: { bus: "#0f766e", coverage: "#a85b06", alt: "#a3abb6", casing: "#ffffff", selected: "#1f2a37", hole: "#ffffff", label: "#121821", gap: "#e0362b" },
};

/** Sources and layers Ghar Tak draws on top of the basemap. setStyle() drops them, so this re-runs per style. */
function addOverlays(m: MlMap, theme: Theme) {
  if (m.getSource("routes")) return; // already on this style (initial load and style.load can both fire)
  const c = OVERLAY[theme];
  // Bus corridors sit underneath everything else and start hidden.
  m.addSource("bus", { type: "geojson", data: busData ?? empty });
  m.addLayer({
    id: "bus", type: "line", source: "bus", layout: { visibility: "none", "line-join": "round" },
    paint: { "line-color": c.bus, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 15, 3], "line-opacity": 0.6 },
  });
    m.addSource("routes", { type: "geojson", data: empty });
    m.addSource("gaps", { type: "geojson", data: empty });
    m.addSource("places", { type: "geojson", data: empty });
    m.addSource("coverage", { type: "geojson", data: empty });
    m.addSource("ride", { type: "geojson", data: empty });

    m.addLayer({
      id: "coverage", type: "line", source: "coverage",
      paint: { "line-color": c.coverage, "line-opacity": 0.5, "line-width": 1, "line-dasharray": [4, 4] },
    });
    m.addLayer({
      id: "routes-alt", type: "line", source: "routes", filter: ["!=", ["get", "selected"], true],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.alt, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 15, 4], "line-opacity": 0.45 },
    });
    m.addLayer({
      id: "places-closed", type: "circle", source: "places", minzoom: 15,
      filter: ["all", ["==", ["get", "cls"], "place"], ["!", ["get", "open"]]],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 2.5, 18, 5],
        "circle-color": c.hole, "circle-stroke-color": ["get", "color"], "circle-stroke-width": 1.2, "circle-opacity": 0.6,
        "circle-stroke-opacity": 0.6,
      },
    });
    m.addLayer({
      id: "places-open", type: "circle", source: "places", minzoom: 13,
      filter: ["all", ["==", ["get", "cls"], "place"], ["get", "open"]],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2.2, 16, 5],
        "circle-color": ["get", "color"], "circle-stroke-color": c.hole, "circle-stroke-width": 0.8,
      },
    });
    m.addLayer({
      id: "places-cam", type: "circle", source: "places", minzoom: 15,
      filter: ["==", ["get", "cls"], "cam"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 2, 18, 4],
        "circle-color": ["get", "color"], "circle-opacity": 0.85,
      },
    });
    m.addLayer({
      id: "routes-casing", type: "line", source: "routes", filter: ["==", ["get", "selected"], true],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.casing, "line-width": 9 },
    });
    m.addLayer({
      id: "routes-sel", type: "line", source: "routes", filter: ["==", ["get", "selected"], true],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.selected, "line-width": 5 },
    });
    m.addLayer({
      id: "ride", type: "line", source: "ride", filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "colour"],
        "line-width": ["case", ["get", "selected"], 5, 3],
        "line-opacity": ["case", ["get", "selected"], 1, 0.4],
      },
    });
    m.addLayer({
      id: "ride-stations", type: "circle", source: "ride", filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 5, "circle-color": c.hole,
        "circle-stroke-color": ["get", "colour"], "circle-stroke-width": 2.5,
        "circle-opacity": ["case", ["get", "selected"], 1, 0.4],
        "circle-stroke-opacity": ["case", ["get", "selected"], 1, 0.4],
      },
    });
    m.addLayer({
      id: "ride-labels", type: "symbol", source: "ride", minzoom: 11,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "selected"], true]],
      layout: {
        "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 12,
        "text-offset": [0, 1.1], "text-anchor": "top",
      },
      paint: { "text-color": c.label, "text-halo-color": c.hole, "text-halo-width": 1.5 },
    });
    m.addLayer({
      id: "gaps", type: "line", source: "gaps",
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": c.gap, "line-width": 5, "line-dasharray": [1, 1] },
    });
    // Help points (police, hospitals) on top and visible early; everything else reveals with zoom.
    m.addLayer({
      id: "places-help", type: "circle", source: "places", minzoom: 10,
      filter: ["==", ["get", "cls"], "help"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 15, 7.5],
        "circle-color": ["get", "color"],
        "circle-stroke-color": c.hole, "circle-stroke-width": 2,
        "circle-opacity": ["case", ["get", "open"], 1, 0.55],
      },
    });}

/** Major bus routes, fetched once on first use and kept for later style swaps. */
let busData: GeoJSON.FeatureCollection | null = null;
let busLoading: Promise<void> | null = null;

function applyBuses(m: MlMap, show: boolean) {
  if (!m.getLayer("bus")) return;
  m.setLayoutProperty("bus", "visibility", show ? "visible" : "none");
  if (!show || busData) return;
  busLoading ??= fetch("/api/bus")
    .then((r) => r.json())
    .then((d) => {
      busData = d;
    })
    .catch(() => {
      busLoading = null;
    });
  busLoading.then(() => {
    if (busData) (m.getSource("bus") as GeoJSONSource | undefined)?.setData(busData);
  });
}

function applyCoverage(m: MlMap, bbox: [number, number, number, number] | null) {
  if (!bbox) return;
  const [w, s, e, n] = bbox;
  (m.getSource("coverage") as GeoJSONSource | undefined)?.setData({
    type: "Feature", properties: {},
    geometry: { type: "LineString", coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] },
  });
}

function popup(title: string, line: string, note: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "popup";
  const t = document.createElement("strong");
  t.textContent = title;
  const l = document.createElement("div");
  l.textContent = line;
  const n = document.createElement("div");
  n.className = "popup-note";
  n.textContent = note;
  root.append(t, l, n);
  return root;
}

const KIND_LABEL: Record<string, string> = {
  hospital: "Hospital", police: "Police", fuel: "Petrol pump", pharmacy: "Pharmacy", food: "Food",
  grocery: "Grocery", shop: "Shop", mall: "Mall", hotel: "Hotel", atm: "ATM", metro: "Station",
};

function draw(
  m: MlMap, routes: ScoredRoute[], metro: MetroOption | null, selected: number, theme: Theme, hidden: string[],
) {
  const kindColor = KIND_COLORS[theme];
  const metroSel = metro !== null && selected === metro.id;
  // The metro option's walking legs are drawn like routes, all under the metro option's id.
  const lines = [...routes, ...(metro?.legs.map((l) => ({ ...l, id: metro.id })) ?? [])];
  const focus = lines.filter((r) => r.id === selected);
  // Draw the selected route last so it sits on top of the alternatives.
  const ordered = [...lines].sort((a, b) => Number(a.id === selected) - Number(b.id === selected));
  (m.getSource("routes") as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: ordered.map((r) => ({
      type: "Feature",
      properties: { id: r.id, selected: r.id === selected },
      geometry: { type: "LineString", coordinates: r.coords },
    })),
  });
  (m.getSource("ride") as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: (metro?.ride.segments ?? []).flatMap((sg) => [
      {
        type: "Feature" as const,
        properties: { colour: sg.colour, selected: metroSel },
        geometry: { type: "LineString" as const, coordinates: sg.coords },
      },
      ...[
        { name: sg.from, at: sg.coords[0] },
        { name: sg.to, at: sg.coords[sg.coords.length - 1] },
      ].map((st) => ({
        type: "Feature" as const,
        properties: { colour: sg.colour, selected: metroSel, name: st.name },
        geometry: { type: "Point" as const, coordinates: st.at },
      })),
    ]),
  });
  (m.getSource("gaps") as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: focus.flatMap((sel) => sel.gaps).map((g) => ({
      type: "Feature", properties: { length: g.length },
      geometry: { type: "LineString", coordinates: g.coords },
    })),
  });
  const places = focus.flatMap((sel) => [
    ...sel.places,
    ...sel.help.filter((h) => !sel.places.some((p) => p.lon === h.lon && p.lat === h.lat)),
  ]);
  (m.getSource("places") as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: [
      ...places.filter((p) => !hidden.includes(p.kind)).map((p) => ({
        type: "Feature" as const,
        properties: {
          name: p.name, label: KIND_LABEL[p.kind] ?? p.kind, open: p.open, hours: p.hours, oh: p.oh ?? "",
          color: kindColor[p.kind] ?? kindColor.atm, cls: p.kind === "hospital" || p.kind === "police" ? "help" : "place",
        },
        geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
      })),
      ...focus.flatMap((sel) => sel.cameras).map((c) => ({
        type: "Feature" as const,
        properties: { name: "CCTV camera", label: "Camera", open: true, hours: "camera", oh: "", color: kindColor.camera, cls: "cam" },
        geometry: { type: "Point" as const, coordinates: c },
      })),
    ],
  });
}
