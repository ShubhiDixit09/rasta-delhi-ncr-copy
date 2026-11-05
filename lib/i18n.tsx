"use client";

import { Fragment, useEffect, useState } from "react";
import { HI } from "./i18n-hi";

/**
 * English / Hindi. Strings are written in English in the code and looked up in HI; anything not
 * translated yet simply stays English. The choice is kept on this device only.
 *
 * t("{n} places open", { n: 5 }) fills {placeholders}. rich() also turns **text** into bold, so a
 * translation can put the bold words wherever Hindi word order needs them.
 */
export type Lang = "en" | "hi";

const KEY = "ghartak-lang";
const EVENT = "ghartak-lang";
let current: Lang = "en";

function apply(l: Lang) {
  current = l;
  document.documentElement.lang = l === "hi" ? "hi" : "en";
}

export function getLang(): Lang {
  return current;
}

export function setLang(l: Lang) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    // storage blocked: the choice lasts for this page
  }
  apply(l);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** The current language; re-renders the component when it changes. */
export function useLang(): Lang {
  const [lang, setL] = useState<Lang>("en");
  useEffect(() => {
    try {
      apply(localStorage.getItem(KEY) === "hi" ? "hi" : "en");
    } catch {
      // ignore
    }
    setL(current);
    const on = () => setL(current);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return lang;
}

export function t(en: string, vars?: Record<string, string | number>): string {
  let s = current === "hi" ? (HI[en] ?? en) : en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** t() with **bold** support, for sentences that mix plain and bold text. */
export function rich(en: string, vars?: Record<string, string | number>) {
  return t(en, vars)
    .split("**")
    .map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <Fragment key={i}>{part}</Fragment>));
}

/** Plural pick for English; Hindi uses the same form. */
export const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);
