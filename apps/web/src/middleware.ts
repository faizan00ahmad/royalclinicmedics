import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";

/** Adds a per-request Content Security Policy nonce (SEC-01). */
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp); // Next.js reads the nonce from here and applies it to its own scripts

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // Pages only. API routes return JSON, and Stripe's webhook must stay untouched.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
