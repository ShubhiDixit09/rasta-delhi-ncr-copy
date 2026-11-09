import type { Metadata } from "next";
import LiveView from "@/components/LiveView";

export const metadata: Metadata = {
  title: "Live trip · Ghar Tak",
  description: "Follow a trip home, live.",
  robots: { index: false, follow: false },
  // Not the home page: own preview text when the link is shared, and no canonical pointing home.
  alternates: { canonical: null },
  openGraph: { title: "Live trip · Ghar Tak", description: "Follow a trip home, live.", images: ["/opengraph-image"] },
  twitter: { card: "summary_large_image", title: "Live trip · Ghar Tak", description: "Follow a trip home, live.", images: ["/twitter-image"] },
};

export default async function LiveTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LiveView id={id} />;
}
