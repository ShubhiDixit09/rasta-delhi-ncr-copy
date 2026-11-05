"use client";

import { useState } from "react";
import type { Mode } from "@/lib/routing";
import type { MetroOption } from "@/lib/metro";
import type { ScoredRoute } from "@/lib/score";
import { fmtDistance, fmtDuration } from "./format";
import Icon from "./Icon";
import TrustedContacts from "./TrustedContacts";

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
  const how = mode === "walk" ? "walking" : "taking a cab";
  const via = route.via ? ` via ${route.via}` : "";
  return (
    `I'm ${how} from ${fromLabel} to ${toLabel}. Leaving ${time(start)}, should reach around ${time(eta)} ` +
    `(${fmtDuration(route.duration)}, ${fmtDistance(route.distance)}${via}).\n` +
    `My planned route (not live location): ${url}`
  );
}

export function metroShareText({ metro, fromLabel, toLabel, depart, url }: {
  metro: MetroOption; fromLabel: string; toLabel: string; depart: string; url: string;
}): string {
  const rides = metro.ride.segments.map((s) => `${s.line} to ${s.to}`).join(", then ");
  return (
    `I'm going from ${fromLabel} to ${toLabel}: walking to ${metro.board.station} metro, ${rides}, then walking ` +
    `${fmtDistance(metro.legs[1].distance)}. Leaving ${time(new Date(depart).getTime())}, should reach around ` +
    `${time(new Date(metro.alight.arrive).getTime())}.\nMy planned route (not live location): ${url}`
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
      window.prompt("Copy this message:", text);
    }
  };

  return (
    <div className="share-block">
      <div className="share-main">
        <button type="button" className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name="share" />
          Share
        </button>
        <TrustedContacts text={text} />
      </div>
      {open && (
        <div className="share-more">
          <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>
          {canNativeShare && (
            <button type="button" className="btn" onClick={() => navigator.share({ text }).catch(() => undefined)}>
              More apps…
            </button>
          )}
          <button type="button" className="btn" onClick={copy}>
            {copied ? "Copied" : "Copy message"}
          </button>
          {onImage && (
            <button
              type="button" className="btn" disabled={making}
              onClick={async () => {
                setMaking(true);
                await onImage().catch(() => undefined);
                setMaking(false);
              }}
            >
              {making ? "Making image…" : "Route image"}
            </button>
          )}
          {canNativeShare && (
            <p className="note share-hint">For several WhatsApp chats at once, tap More apps…, choose WhatsApp, and select the chats.</p>
          )}
        </div>
      )}
    </div>
  );
}
