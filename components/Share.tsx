"use client";

import { useState } from "react";
import type { Mode } from "@/lib/routing";
import type { MetroOption } from "@/lib/metro";
import type { ScoredRoute } from "@/lib/score";
import { fmtDistance, fmtDuration } from "./format";
import Icon from "./Icon";
import TrustedContacts from "./TrustedContacts";
import { t } from "@/lib/i18n";

interface TripText {
  route: ScoredRoute;
  mode: Mode;
  fromLabel: string;
  toLabel: string;
  depart: string;
  url: string;
}

const time = (ms: number) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(new Date(ms));

export function shareText({ route, mode, fromLabel, toLabel, depart, url }: TripText): string {
  const start = new Date(depart).getTime();
  const eta = start + route.duration * 1000;
  const how = mode === "walk" ? t("walking") : t("taking a cab");
  const via = route.via ? " " + t("via {v}", { v: route.via }) : "";
  return (
    t("I'm {how} from {a} to {b}. Leaving {s}, should reach around {e}", { how, a: fromLabel, b: toLabel, s: time(start), e: time(eta) }) +
    ` (${fmtDuration(route.duration)}, ${fmtDistance(route.distance)}${via}).\n` +
    t("My planned route (not live location): {u}", { u: url })
  );
}

export function metroShareText({ metro, fromLabel, toLabel, depart, url }: {
  metro: MetroOption; fromLabel: string; toLabel: string; depart: string; url: string;
}): string {
  const rides = metro.ride.segments.map((s) => t("{l} to {s}", { l: s.line, s: s.to })).join(", ");
  return (
    t("I'm going from {a} to {b}: walking to {st} metro, {rides}, then walking {d}. Leaving {s}, should reach around {e}.", {
      a: fromLabel, b: toLabel, st: metro.board.station, rides, d: fmtDistance(metro.legs[1].distance),
      s: time(new Date(depart).getTime()), e: time(new Date(metro.alight.arrive).getTime()),
    }) + "\n" + t("My planned route (not live location): {u}", { u: url })
  );
}

/**
 * The trip's two actions: message every trusted contact at once (primary), and a Share button that opens
 * WhatsApp, the system share sheet or copy.
 */
export default function Share({ text, onImage }: { text: string; onImage?: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [making, setMaking] = useState(false);
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t("Copy this message:"), text);
    }
  };

  return (
    <div className="share-block">
      <div className="share-main">
        <button type="button" className={`btn share-toggle-btn ${open ? "on" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name="share" size={16} />
          <span>{t("Share Route")}</span>
        </button>
        <TrustedContacts text={text} />
      </div>
      {open && (
        <div className="share-more">
          <a className="btn share-btn-wa" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
            <span>💬 WhatsApp</span>
          </a>
          {canNativeShare && (
            <button type="button" className="btn share-btn-native" onClick={() => navigator.share({ text }).catch(() => undefined)}>
              <Icon name="arrowUpRight" size={14} />
              <span>{t("More apps…")}</span>
            </button>
          )}
          <button type="button" className="btn share-btn-copy" onClick={copy}>
            <Icon name={copied ? "check" : "share"} size={14} />
            <span>{copied ? t("Copied!") : t("Copy message")}</span>
          </button>
          {onImage && (
            <button
              type="button" className="btn share-btn-img" disabled={making}
              onClick={async () => {
                setMaking(true);
                await onImage().catch(() => undefined);
                setMaking(false);
              }}
            >
              <Icon name="sparkles" size={14} />
              <span>{making ? t("Making image…") : t("Route image")}</span>
            </button>
          )}
          {canNativeShare && (
            <p className="note share-hint">{t("For several WhatsApp chats at once, tap More apps…, choose WhatsApp, and select the chats.")}</p>
          )}
        </div>
      )}
    </div>
  );
}
