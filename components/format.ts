import type { Component, ScoredRoute } from "@/lib/score";
import type { Theme } from "@/lib/theme";
import { t } from "@/lib/i18n";

/** Place colours per theme: the light set is darker so pins stay visible on a light basemap. */
export const KIND_COLORS: Record<Theme, Record<string, string>> = {
  dark: {
    hospital: "#ff6b6b", police: "#5aa9ff", fuel: "#f5b942", pharmacy: "#4fd1a5", food: "#ff9f43",
    grocery: "#c3e86b", shop: "#b79cff", mall: "#e58fe0", hotel: "#7fd3e6", atm: "#9aa3ad",
    metro: "#ffffff", camera: "#ffd84d",
  },
  light: {
    hospital: "#d92d20", police: "#1d5fd1", fuel: "#c77700", pharmacy: "#0b8a66", food: "#d9480f",
    grocery: "#4d7c0f", shop: "#7c3aed", mall: "#b5179e", hotel: "#0e7490", atm: "#5b6472",
    metro: "#121821", camera: "#a16207",
  },
};

export const LEGEND: { kind: string; label: string }[] = [
  { kind: "food", label: "Food" },
  { kind: "grocery", label: "Grocery" },
  { kind: "shop", label: "Shop" },
  { kind: "pharmacy", label: "Pharmacy" },
  { kind: "fuel", label: "Petrol pump" },
  { kind: "hospital", label: "Hospital" },
  { kind: "police", label: "Police" },
  { kind: "hotel", label: "Hotel" },
  { kind: "metro", label: "Metro / rail" },
  { kind: "camera", label: "CCTV" },
];

export const COMPONENT_LABEL: Record<Component, { label: string; help: string }> = {
  activity: { label: "Open places", help: "Share of the route with an open shop, eatery, pump, chemist or similar right beside it when you pass." },
  gaps: { label: "No long empty stretch", help: "Penalises the longest stretch with nothing open. Dark stretches count fully, well-lit ones at half." },
  light: { label: "Light", help: "NASA VIIRS night radiance along the route (last 15 nights, both satellites), plus OSM lit=yes/no and street lamps." },
  roads: { label: "Road type", help: "Main roads score higher than internal lanes, service roads and unpaved tracks." },
  help: { label: "Help nearby", help: "Share of the route with an open hospital or police station within reach." },
  cameras: { label: "CCTV", help: "Cameras mapped in OpenStreetMap per km of route. Shown as no data where none are mapped nearby." },
  transit: { label: "Transit points", help: "Metro, rail and bus stops beside a walking route: places with people and a way out." },
};

/** CSS colour for a score, from the theme's --good / --mid / --bad tokens. */
/** User-friendly safety status label. */
export function scoreRating(score: number | null): string {
  if (score === null) return t("Not scored");
  if (score >= 75) return t("High safety");
  if (score >= 60) return t("Moderate safety");
  if (score >= 45) return t("Caution advised");
  return t("Quiet / Low lit");
}

export function scoreColor(score: number | null): string {
  if (score === null) return "var(--muted)";
  if (score >= 65) return "var(--good)";
  if (score >= 45) return "var(--mid)";
  return "var(--bad)";
}

export function fmtDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export function fmtDuration(s: number): string {
  const min = Math.round(s / 60);
  if (min < 60) return t("{m} min", { m: min });
  return t("{h} h {m} min", { h: Math.floor(min / 60), m: min % 60 });
}

/** One plain sentence per route, built only from measured stats. */
export function summary(r: ScoredRoute): string[] {
  const s = r.stats;
  const out: string[] = [];
  out.push(`${s.openPlaces} open place${s.openPlaces === 1 ? "" : "s"} beside the route, ${s.closedPlaces} closed`);
  if (s.longestGap >= 100) {
    out.push(`Longest stretch with nothing open: ${fmtDistance(s.longestGap)}${s.longestGapDark ? ", and it is dark" : ""}`);
  }
  out.push(`${Math.round(s.mainRoadShare * 100)}% on main roads, ${Math.round(s.smallRoadShare * 100)}% on internal lanes or service roads`);
  if (r.components.cameras !== null) out.push(`${s.cameras} mapped CCTV camera${s.cameras === 1 ? "" : "s"} along the way`);
  const first = r.coords[0], last = r.coords[r.coords.length - 1];
  const straight = Math.hypot((last[0] - first[0]) * 97_900, (last[1] - first[1]) * 110_950);
  if (straight > 500 && r.distance > straight * 2.2) {
    out.push(
      `This route is ${(r.distance / straight).toFixed(1)}× the straight-line distance: the router found no more direct ` +
        `path (often a river, rail line or expressway without a crossing)`,
    );
  }
  if (s.coverage < 1) out.push(`${Math.round((1 - s.coverage) * 100)}% of this route is outside Ghar Tak's data area and is not scored`);
  return out;
}
