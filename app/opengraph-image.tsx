import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

/** The picture shown when ghartak.space is shared on WhatsApp, X, LinkedIn and others. */
export const alt = "Ghar Tak: the safer way home at night, for women in Delhi NCR";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const logo = await readFile(path.join(process.cwd(), "public/icons/icon-512.png"));
  const src = `data:image/png;base64,${logo.toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center",
          padding: "0 90px", background: "radial-gradient(circle at 20% 30%, #3a2a0c 0%, #0e1116 55%)", color: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} width={120} height={120} alt="" style={{ borderRadius: 28 }} />
          <div style={{ fontSize: 84, fontWeight: 800, letterSpacing: -2 }}>Ghar Tak</div>
        </div>
        <div style={{ fontSize: 54, fontWeight: 700, marginTop: 44, lineHeight: 1.15, maxWidth: 1000 }}>
          The safer way home at night, not just the fastest.
        </div>
        <div style={{ fontSize: 30, color: "#c3c9d1", marginTop: 28 }}>
          Lit roads · open shops · metro timings · live location for family · SOS
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 44, fontSize: 28 }}>
          <div style={{ background: "#f5b942", color: "#0e1116", padding: "10px 22px", borderRadius: 999, fontWeight: 700 }}>
            ghartak.space
          </div>
          <div style={{ border: "2px solid #4a5260", padding: "8px 22px", borderRadius: 999, color: "#e8eaed" }}>
            Free · No login · Delhi NCR
          </div>
        </div>
      </div>
    ),
    size,
  );
}
