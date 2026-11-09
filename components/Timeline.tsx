"use client";

import { useState } from "react";
import { t as tr } from "@/lib/i18n";
import Icon from "./Icon";

export interface TimelineData {
  slots: string[];
  stepMinutes: number;
  routes: { id: number; scores: (number | null)[]; open: number[]; longestGap: number[] }[];
}

interface Props {
  data: TimelineData;
  routeId: number;
  depart: string;
  onPick: (iso: string) => void;
}

const fmt = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })
    .format(new Date(iso))
    .replace(":00", "")
    .replace(" ", " ");

/** Contiguous run of slots around `i` scoring within 2 points of the best. */
function bestRun(scores: (number | null)[]): [number, number, number] | null {
  let best = -1;
  let at = -1;
  scores.forEach((s, i) => {
    if (s !== null && s > best) {
      best = s;
      at = i;
    }
  });
  if (at < 0) return null;
  let a = at, b = at;
  while (a > 0 && (scores[a - 1] ?? -1) >= best - 2) a--;
  while (b < scores.length - 1 && (scores[b + 1] ?? -1) >= best - 2) b++;
  return [a, b, best];
}

export default function Timeline({ data, routeId, depart, onPick }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const route = data.routes.find((r) => r.id === routeId);
  if (!route) return null;

  const t = new Date(depart).getTime();
  const current = data.slots.reduce(
    (best, s, i) => (Math.abs(new Date(s).getTime() - t) < Math.abs(new Date(data.slots[best]).getTime() - t) ? i : best),
    0,
  );
  const inWindow = Math.abs(new Date(data.slots[current]).getTime() - t) <= data.stepMinutes * 30_000;
  const run = bestRun(route.scores);
  const cur = inWindow ? route.scores[current] : null;

  const W = 360, H = 104, padB = 22, padT = 10;
  const n = data.slots.length;
  const slot = W / n;
  const bar = Math.max(5, slot - 3); // bar width with clean gap
  const y = (v: number) => padT + (H - padB - padT) * (1 - v / 100);

  let line = "";
  let bestWindowText = "";
  if (run) {
    const [a, b, best] = run;
    const window = a === b ? fmt(data.slots[a]) : `${fmt(data.slots[a])}–${fmt(data.slots[b])}`;
    bestWindowText = tr("Safest window: {w} (Score {s})", { w: window, s: best });
    line = tr("Best to leave {w} (score {s}).", { w: window, s: best });
    if (cur !== null && cur < best - 2) line += " " + tr("Leaving at {w} scores {s}.", { w: fmt(data.slots[current]), s: cur });
  }

  const h = hover;

  return (
    <figure className="timeline">
      <figcaption>
        <div className="tl-head-title">
          <Icon name="clock" size={15} />
          <span>{tr("Night score by departure time")}</span>
        </div>
        <span className="muted">{tr("every {m} min · tap bar to select", { m: data.stepMinutes })}</span>
      </figcaption>

      {bestWindowText && (
        <div className="timeline-recom">
          <span className="recom-badge" aria-hidden>
            <Icon name="sparkles" size={13} />
          </span>
          <span className="recom-text">{bestWindowText}</span>
        </div>
      )}

      <div className="timeline-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Night score for this route from ${fmt(data.slots[0])} to ${fmt(data.slots[n - 1])}. ${line}`}>
          <defs>
            <linearGradient id="barCurGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-fill)" />
              <stop offset="100%" stopColor="var(--accent)" />
            </linearGradient>
            <linearGradient id="barHovGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-fill)" stopOpacity="0.8" />
              <stop offset="100%" stopColor="var(--accent-fill)" stopOpacity="0.4" />
            </linearGradient>
          </defs>

          {[50, 100].map((g) => (
            <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} className="grid" />
          ))}
          <text x={W} y={y(50) - 3} className="axis" textAnchor="end">50</text>

          {route.scores.map((s, i) => {
            const v = s ?? 0;
            const x = i * slot + (slot - bar) / 2;
            const top = y(v);
            const base = H - padB;
            const r = Math.min(3, bar / 2, base - top);
            const isCur = i === current && inWindow;
            const isHov = i === hover;
            return (
              <g key={i}>
                <path
                  className={isCur ? "bar cur" : isHov ? "bar hov" : "bar"}
                  fill={isCur ? "url(#barCurGrad)" : isHov ? "url(#barHovGrad)" : undefined}
                  d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bar - r} Q${x + bar},${top} ${x + bar},${top + r} V${base} Z`}
                />
                {/* Hit target: the whole column, not just the bar. */}
                <rect
                  x={i * slot} y={0} width={slot} height={H} fill="transparent"
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                  onClick={() => onPick(data.slots[i])} style={{ cursor: "pointer" }}
                />
              </g>
            );
          })}
          <line x1={0} x2={W} y1={H - padB} y2={H - padB} className="baseline" />
          {data.slots.map((s, i) =>
            i % 3 === 0 ? (
              <text key={s} x={i * slot + slot / 2} y={H - 4} className="axis" textAnchor="middle">{fmt(s)}</text>
            ) : null,
          )}
        </svg>
      </div>

      <div className="timeline-line-card" aria-live="polite">
        <span className="tl-info-ic" aria-hidden>
          <Icon name="info" size={14} />
        </span>
        <span className="tl-info-text">
          {h !== null ? (
            <>
              <strong>{fmt(data.slots[h])}</strong>: {tr("score {s}, {n} open beside route", { s: route.scores[h] ?? "–", n: route.open[h] })}
              {route.longestGap[h] >= 100 && <>, {tr("longest empty stretch {d} km", { d: (route.longestGap[h] / 1000).toFixed(1) })}</>}
            </>
          ) : (
            line
          )}
        </span>
      </div>
    </figure>
  );
}
