import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const MAINTENANCE_MESSAGE = "Ghar Tak is temporarily unavailable for maintenance.";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
