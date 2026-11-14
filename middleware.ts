import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const MAINTENANCE_MESSAGE = "Ghar Tak is temporarily unavailable for maintenance.";

/**
 * Maintenance mode is OFF unless the MAINTENANCE_MODE environment variable is "on" (or "true"/"1").
 * Turn it on in Vercel (Settings → Environment Variables) and redeploy; remove it and redeploy to turn it off.
 */
const maintenanceOn = () => /^(on|true|1)$/i.test(process.env.MAINTENANCE_MODE ?? "");

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!maintenanceOn()) {
    // Nobody should land on the maintenance page while the site is up.
    if (pathname === "/maintenance") {
      const home = request.nextUrl.clone();
      home.pathname = "/";
      home.search = "";
      return NextResponse.redirect(home);
    }
    return NextResponse.next();
  }

  if (pathname === "/maintenance" || pathname.startsWith("/_next/") || pathname.includes(".")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { maintenance: true, message: MAINTENANCE_MESSAGE },
      { status: 503, headers: { "Retry-After": "3600" } },
    );
  }

  const maintenanceUrl = request.nextUrl.clone();
  maintenanceUrl.pathname = "/maintenance";
  maintenanceUrl.search = "";
  return NextResponse.redirect(maintenanceUrl);
}

export const config = {
  matcher: ["/:path*"],
};
