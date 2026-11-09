"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { LngLat } from "@/lib/geo";
import Icon from "./Icon";

export interface Picked {
  label: string;
  point: LngLat;
}

interface Hit extends Picked {
  detail: string;
}

interface PhotonFeature {
  geometry: { coordinates: LngLat };
  properties: Record<string, string | undefined>;
}

/** Photon (komoot) geocoder over OSM data, restricted to the coverage box. */
const PHOTON = "https://photon.komoot.io/api/";

function describe(p: PhotonFeature["properties"]): { label: string; detail: string } {
  const label = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || p.district || p.city || "Unnamed place";
  const detail = [p.street !== label ? p.street : null, p.district, p.locality, p.city]
    .filter((x, i, a): x is string => !!x && x !== label && a.indexOf(x) === i)
    .slice(0, 3)
    .join(", ");
  return { label, detail };
}

/** Curated transit and commerce hubs across Delhi NCR for quick 1-tap testing & routing. */
const POPULAR_HUBS: Hit[] = [
  { label: "Rajiv Chowk (Connaught Place)", detail: "Central Delhi · Yellow / Blue Line Interchange", point: [77.2183, 28.6328] },
  { label: "DLF Cyber Hub", detail: "Gurugram, Haryana · Rapid Metro / Cyber City", point: [77.0887, 28.4950] },
  { label: "Sector 18 Market (Atta)", detail: "Noida, Uttar Pradesh · Blue Line Metro", point: [77.3235, 28.5708] },
  { label: "Hauz Khas Village", detail: "South Delhi · Yellow / Magenta Line", point: [77.1950, 28.5535] },
  { label: "Indirapuram Habitat Centre", detail: "Ghaziabad, Uttar Pradesh", point: [77.3715, 28.6415] },
  { label: "Saket District Centre", detail: "South Delhi · Select Citywalk / Yellow Line", point: [77.2189, 28.5284] },
];

export async function reverseGeocode(p: LngLat): Promise<string> {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lon=${p[0]}&lat=${p[1]}&lang=en&limit=1`);
    const body = await res.json();
    const f: PhotonFeature | undefined = body.features?.[0];
    if (f) {
      const { label, detail } = describe(f.properties);
      return detail ? `${label}, ${detail.split(",")[0]}` : label;
    }
  } catch {
    // fall through to coordinates
  }
  return `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`;
}

interface Props {
  label: string;
  marker: "A" | "B";
  value: Picked | null;
  bbox: [number, number, number, number] | null;
  placeholder: string;
  onPick: (p: Picked | null) => void;
}

export default function PlaceSearch({ label, marker, value, bbox, placeholder, onPick }: Props) {
  const [text, setText] = useState(value?.label ?? "");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const abort = useRef<AbortController | null>(null);
  const typed = useRef(false);

  useEffect(() => {
    setText(value?.label ?? "");
  }, [value]);

  useEffect(() => {
    if (!typed.current) return;
    const q = text.trim();
    if (q.length < 3) {
      setHits([]);
      return;
    }
    // Accept raw "lat, lon" too.
    const coord = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
    if (coord) {
      const lat = +coord[1], lon = +coord[2];
      setHits([{ label: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, detail: "Coordinates", point: [lon, lat] }]);
      return;
    }
    const t = setTimeout(async () => {
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      const params = new URLSearchParams({ q, limit: "7", lang: "en", lat: "28.5", lon: "77.2" });
      if (bbox) params.set("bbox", bbox.join(","));
      try {
        // One quiet retry: flaky mobile connections drop the first request often enough to matter.
        const res = await fetch(`${PHOTON}?${params}`, { signal: ac.signal }).catch(async (e) => {
          if ((e as Error).name === "AbortError") throw e;
          await new Promise((r) => setTimeout(r, 600));
          return fetch(`${PHOTON}?${params}`, { signal: ac.signal });
        });
        const body = await res.json();
        const seen = new Set<string>();
        const list: Hit[] = [];
        for (const f of (body.features ?? []) as PhotonFeature[]) {
          const d = describe(f.properties);
          const key = `${d.label}|${d.detail}`;
          if (seen.has(key)) continue;
          seen.add(key);
          list.push({ ...d, point: f.geometry.coordinates });
        }
        setHits(list);
        setActive(0);
        setOpen(true);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setHits([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [text, bbox]);

  const choose = (h: Hit) => {
    typed.current = false;
    setOpen(false);
    setHits([]);
    onPick({ label: h.label, point: h.point });
  };

  const showList = open && (hits.length > 0 || !text.trim());
  const displayHits = hits.length > 0 ? hits : POPULAR_HUBS;

  return (
    <div className="search">
      <label className="search-label">
        <span className={`dot dot-${marker}`} aria-hidden>
          {marker === "A" ? (
            <span className="dot-inner">A</span>
          ) : (
            <span className="dot-inner">B</span>
          )}
        </span>
        <span className="sr-only">{label}</span>
        <input
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            typed.current = true;
            setText(e.target.value);
            if (!e.target.value) onPick(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          onKeyDown={(e) => {
            if (!open || !displayHits.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % displayHits.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + displayHits.length) % displayHits.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(displayHits[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {text ? (
          <button
            type="button"
            className="clear"
            aria-label={`Clear ${label}`}
            onClick={() => {
              setText("");
              setHits([]);
              onPick(null);
            }}
          >
            <Icon name="x" size={14} />
          </button>
        ) : (
          <span className="search-lead-ic" aria-hidden>
            <Icon name="search" size={14} />
          </span>
        )}
      </label>
      {showList && (
        <ul id={listId} role="listbox" className="suggestions">
          {!text.trim() && hits.length === 0 && (
            <li className="suggestions-category" aria-hidden>
              <Icon name="sparkles" size={13} />
              <span>POPULAR DESTINATIONS IN NCR</span>
            </li>
          )}
          {displayHits.map((h, i) => (
            <li
              key={`${h.label}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(h);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <div className="s-icon" aria-hidden>
                <Icon name={h.detail.toLowerCase().includes("metro") ? "train" : "locate"} size={14} />
              </div>
              <div className="s-text">
                <span className="s-label">{h.label}</span>
                {h.detail && <span className="s-detail">{h.detail}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
