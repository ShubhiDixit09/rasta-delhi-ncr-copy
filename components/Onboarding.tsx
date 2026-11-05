"use client";

import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";

/**
 * First-run: a short splash, then "Who's using Ghar Tak?". The choice is kept in this browser only
 * and shapes the app (see PERSONAS); it can be changed any time from the chip in the trip card.
 */
export type Persona = "me" | "teen" | "parent" | "senior";

export const PERSONAS: { id: Persona; emoji: string; title: string; detail: string }[] = [
  { id: "me", emoji: "🙋‍♀️", title: "Me", detail: "I travel late and want the safer way home" },
  { id: "teen", emoji: "🎒", title: "A teen", detail: "Stricter routes, guardians in the loop" },
  { id: "parent", emoji: "👨‍👩‍👧", title: "A parent", detail: "I want to follow my family's trips" },
  { id: "senior", emoji: "👵", title: "An elder", detail: "Bigger text, cab-first, fewer options" },
];

const KEY = "ghartak-persona";

export function loadPersona(): Persona | null {
  try {
    const v = localStorage.getItem(KEY);
    return PERSONAS.some((p) => p.id === v) ? (v as Persona) : null;
  } catch {
    return null;
  }
}

export function savePersona(p: Persona) {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    // storage blocked: the choice lasts for this visit
  }
}

/**
 * splash: play the intro first. ask: then ask who is using Ghar Tak (otherwise the intro just closes,
 * via onDone, and the app shows underneath). Tapping the intro skips it.
 */
export default function Onboarding({ splash, ask, current, onPick, onDone }: {
  splash: boolean;
  ask: boolean;
  current: Persona | null;
  onPick: (p: Persona) => void;
  onDone: () => void;
}) {
  const [stage, setStage] = useState<"splash" | "ask" | "out">(splash ? "splash" : "ask");
  const next = () => {
    if (ask) setStage("ask");
    else {
      setStage("out");
      setTimeout(onDone, 280);
    }
  };
  useEffect(() => {
    if (stage !== "splash") return;
    // The full intro the first time; a quicker one on later visits.
    const t = setTimeout(next, ask ? 2100 : 1900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  return (
    <div className={`onboard ${stage}`} role={stage === "ask" ? "dialog" : undefined} aria-hidden={stage !== "ask" ? true : undefined} aria-modal={stage === "ask" ? true : undefined} aria-label="Welcome to Ghar Tak">
      {stage === "splash" || stage === "out" ? (
        <div className="ob-splash" onClick={next}>
          <svg className="ob-road" viewBox="0 0 300 120" aria-hidden>
            <path d="M10 100 C 80 100, 90 30, 160 40 S 250 90, 290 20" />
          </svg>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="ob-logo" src="/icons/logo.svg" alt="" width={88} height={88} />
          <h1 className="ob-name">Ghar Tak</h1>
          <p className="ob-deva">घर तक</p>
          <p className="ob-tag">{t("The way home that still has people around.")}</p>
        </div>
      ) : (
        <div className="ob-ask">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo.svg" alt="" width={44} height={44} />
          <h2>{t("Who's using Ghar Tak?")}</h2>
          <p className="muted">{t("We'll keep things simple for you. You can change this any time.")}</p>
          <div className="ob-options">
            {PERSONAS.map((p, i) => (
              <button
                key={p.id} type="button" className={current === p.id ? "ob-opt on" : "ob-opt"}
                style={{ animationDelay: `${i * 70}ms` }} onClick={() => onPick(p.id)}
              >
                <span className="ob-emoji" aria-hidden>{p.emoji}</span>
                <span><b>{t(p.title)}</b><small>{t(p.detail)}</small></span>
              </button>
            ))}
          </div>
          <p className="small muted">{t("Saved only on this device.")}</p>
        </div>
      )}
    </div>
  );
}
