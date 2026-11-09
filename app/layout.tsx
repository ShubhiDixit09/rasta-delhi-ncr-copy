import type { Metadata, Viewport } from "next";
import SiteAnalytics from "@/components/SiteAnalytics";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ghar Tak: night routes for Delhi NCR",
  description:
    "Compare routes across Delhi NCR by how open, lit and busy they are at the hour you travel.",
  applicationName: "Ghar Tak",
  appleWebApp: { capable: true, title: "Ghar Tak", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
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
