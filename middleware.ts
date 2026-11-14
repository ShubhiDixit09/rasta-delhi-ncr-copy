import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const MAINTENANCE_MESSAGE = "Ghar Tak is temporarily unavailable for maintenance.";

/**
 * Maintenance switch. MAINTENANCE_MODE (Vercel → Settings → Environment Variables) wins when set:
 * "on"/"true"/"1" turns maintenance on, "off"/"false"/"0" turns it off. When it is not set,
 * MAINTENANCE_DEFAULT decides. To bring the site back: set MAINTENANCE_DEFAULT to false (or
 * MAINTENANCE_MODE=off in Vercel) and redeploy.
 */
const MAINTENANCE_DEFAULT = true;

const maintenanceOn = () => {
  const v = (process.env.MAINTENANCE_MODE ?? "").trim();
  if (/^(on|true|1)$/i.test(v)) return true;
  if (/^(off|false|0)$/i.test(v)) return false;
  return MAINTENANCE_DEFAULT;
};

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
