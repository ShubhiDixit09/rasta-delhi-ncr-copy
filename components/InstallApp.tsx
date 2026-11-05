"use client";

import { useEffect, useState } from "react";
import { rich, t } from "@/lib/i18n";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Registers the service worker and offers "Install app": the browser's own prompt on Android and
 * desktop Chrome/Edge, and a short how-to on iPhone, where Safari has no install prompt.
 */
export default function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false);
  const [tip, setTip] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", () => setPrompt(null));
    setIos(/iPhone|iPad|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent));
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (prompt) {
    return (
      <button
        type="button" className="install-btn"
        onClick={async () => {
          await prompt.prompt();
          await prompt.userChoice.catch(() => undefined);
          setPrompt(null);
        }}
      >
        {t("Install app")}
      </button>
    );
  }
  if (!ios) return null;
  return (
    <>
      <button type="button" className="install-btn" onClick={() => setTip(!tip)} aria-expanded={tip}>
        {t("Install app")}
      </button>
      {tip && (
        <p className="install-tip">
          {rich("In Safari, tap the Share button, then **Add to Home Screen**.")}
        </p>
      )}
    </>
  );
}
