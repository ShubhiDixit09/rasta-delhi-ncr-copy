/** Small stroke icons (24 × 24 grid, drawn in currentColor). */
const PATHS = {
  walk: "M12 3.4a1.4 1.4 0 1 0 0 .01M9 21l3-6.5 3 6.5M7 10.5 12 8l5 2.5M12 8v6.5",
  car: "M5 17H3v-5l2.2-4.6A2 2 0 0 1 7 6.2h10a2 2 0 0 1 1.8 1.2L21 12v5h-2M3 12h18M9 17h6M5 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0M15 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 7v5l3 2",
  swap: "m17 20 4-4-4-4M21 16H7M7 4 3 8l4 4M3 8h14",
  share: "M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13",
  phone:
    "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z",
  check: "M20 6 9 17l-5-5",
  alert: "m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3ZM12 9v4M12 17h.01",
  store: "m2 7 4.4-4.4A2 2 0 0 1 7.8 2h8.4a2 2 0 0 1 1.4.6L22 7M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M2 7h20M9 22v-6h6v6",
  bulb: "M15 14c.2-1 .7-1.7 1.5-2.5A5.5 5.5 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4",
  cam: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3zM12 10a3 3 0 1 0 0 6 3 3 0 1 0 0-6",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 1 0 0-8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  shield:
    "M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z",
  road: "M4 21 9 3M20 21 15 3M12 6v2M12 11v2M12 16v2",
  x: "M18 6 6 18M6 6l12 12",
  left: "m15 18-6-6 6-6",
  right: "m9 18 6-6-6-6",
  down: "m6 9 6 6 6-6",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 16v-4M12 8h.01",
  layers:
    "M12.8 2.2a2 2 0 0 0-1.6 0L2.6 6.1a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0l8.6-3.9a1 1 0 0 0 0-1.8ZM22 17.6l-9.2 4.2a2 2 0 0 1-1.6 0L2 17.6M22 12.6l-9.2 4.2a2 2 0 0 1-1.6 0L2 12.6",
  locate: "M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16M12 2v2M12 20v2M2 12h2M20 12h2",
  teen: "M12 4a4 4 0 1 0 0 8 4 4 0 1 0 0-8M5 21a7 7 0 0 1 14 0",
  train: "M7 3h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2M5 10h14M8 21l2-4M16 21l-2-4",
  bars: "M3 3v18h18M7 16v-4M11 16V8M15 16v-6M19 16V6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35",
  shieldCheck: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4",
  hospital: "M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M10 9h4M12 7v4",
  police: "M12 2 4 5v6.5C4 17 8 21 12 22c4-1 8-5 8-10.5V5l-8-3zM12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm-4 10c0-1.8 1.8-3 4-3s4 1.2 4 3",
  sparkles: "m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z",
  navigation: "m3 11 19-9-9 19-2-8-8-2Z",
  arrowUpRight: "M7 17 17 7M7 7h10v10",
  eye: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
