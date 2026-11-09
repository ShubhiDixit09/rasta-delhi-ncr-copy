import type { Metadata, Viewport } from "next";
import SiteAnalytics from "@/components/SiteAnalytics";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  applicationName: SITE_NAME,
  category: "travel",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_IN",
  },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
  appleWebApp: { capable: true, title: "Ghar Tak", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

/** Structured data (invisible) so search engines know what Ghar Tak is and where it works. */
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: SITE_NAME,
      alternateName: "घर तक",
      url: `${SITE_URL}/`,
      description: SITE_DESCRIPTION,
      applicationCategory: "TravelApplication",
      operatingSystem: "Any (web browser, installable on Android and iPhone)",
      inLanguage: ["en-IN", "hi-IN"],
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
      areaServed: ["Delhi", "Gurugram", "Noida", "Greater Noida", "Ghaziabad", "Faridabad", "Sonipat", "Bahadurgarh", "Bhiwadi"]
        .map((name) => ({ "@type": "City", name })),
      featureList: [
        "Night score for every route at the hour you travel",
        "Shows which shops will still be open and which roads are lit",
        "Warns about empty stretches with nothing open",
        "Police stations and hospitals on the way with one-tap calling",
        "Delhi Metro routes with interchanges and service hours",
        "Trip mode with Are you OK? check-ins and a live location link for family",
        "SOS with Indian emergency helplines 112, 1091, 181 and 1098",
        "English and Hindi",
      ],
    },
    { "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: `${SITE_URL}/`, name: SITE_NAME, inLanguage: "en-IN" },
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#07090e" },
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set before hydration by the boot script, so React must not complain about it.
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
        <script
          type="text/javascript"
          dangerouslySetInnerHTML={{
            __html: `(function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "z6dllsj2u3");`,
          }}
        />
      </head>
      <body>
        {children}
        <SiteAnalytics />
      </body>
    </html>
  );
}
