import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Back shortly | Ghar Tak",
  description: "Ghar Tak is briefly unavailable while we make improvements.",
  robots: { index: false, follow: false },
};

export default function MaintenancePage() {
  return (
    <main className="maintenance-page">
      <div className="maintenance-glow maintenance-glow-one" aria-hidden="true" />
      <div className="maintenance-glow maintenance-glow-two" aria-hidden="true" />

      <section className="maintenance-card" aria-labelledby="maintenance-title">
        <div className="maintenance-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo.svg" alt="" width={38} height={38} />
          <span>Ghar Tak</span>
        </div>

        <div className="maintenance-status">
          <span className="maintenance-status-dot" aria-hidden="true" />
          Scheduled maintenance
        </div>

        <div className="maintenance-icon" aria-hidden="true">
          <span className="maintenance-icon-sun" />
          <span className="maintenance-icon-ray ray-one" />
          <span className="maintenance-icon-ray ray-two" />
          <span className="maintenance-icon-ray ray-three" />
          <span className="maintenance-icon-ray ray-four" />
          <span className="maintenance-icon-horizon" />
        </div>

        <p className="maintenance-eyebrow">We will be back soon</p>
        <h1 id="maintenance-title">Making the way home even better.</h1>
        <p className="maintenance-copy">
          Ghar Tak is taking a brief pause while we make improvements. Your safer routes, local
          places, and emergency tools will be back soon.
        </p>

        <div className="maintenance-note">
          <span className="maintenance-note-mark" aria-hidden="true">
            !
          </span>
          <span>In an emergency, call <a href="tel:112">112</a>.</span>
        </div>

        <Link className="btn primary maintenance-link" href="/">
          Try Ghar Tak again
          <span aria-hidden="true">→</span>
        </Link>
      </section>

      <p className="maintenance-footer">Built for getting home with a little more confidence.</p>
    </main>
  );
}
