import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Ghar Tak: night routes for Delhi NCR",
    short_name: "Ghar Tak",
    description: "Free women safety app for Delhi NCR: the safer way home at night, live location for family and SOS.",
    lang: "en-IN",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0e1116",
    theme_color: "#0e1116",
    categories: ["navigation", "travel", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/logo.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "SOS", short_name: "SOS", description: "Emergency numbers and alert your contacts", url: "/?sos=1",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
