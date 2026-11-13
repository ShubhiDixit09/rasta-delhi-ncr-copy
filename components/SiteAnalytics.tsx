"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

let lastPathname: string | null = null;

/**
 * Vercel Web Analytics (cookieless page views). A shared route's URL holds the whole trip, so only the
 * path is sent, never the query string or hash, and /admin is not tracked.
 * Deduplicates events so that history.replaceState updates (e.g. changing routes, presets or travel modes)
 * do not re-trigger redundant "collect" network calls.
 */
function redact(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = new URL(event.url);
  if (url.pathname.startsWith("/admin")) return null;
  if (url.pathname === lastPathname) return null;
  lastPathname = url.pathname;
  return { ...event, url: url.origin + url.pathname };
}

export default function SiteAnalytics() {
  return <Analytics beforeSend={redact} />;
}
