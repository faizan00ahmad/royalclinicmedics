// Headers that never change per request. The Content Security Policy needs a fresh nonce each time,
// so it is set in src/middleware.ts (rules in src/lib/csp.ts).
const STATIC_SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")' },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@rmc/core", "@rmc/db", "@rmc/auth"],
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: STATIC_SECURITY_HEADERS },
      // Private areas are never cached by browsers or shared proxies.
      { source: "/admin/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
      { source: "/booking/:path*", headers: [{ key: "Cache-Control", value: "no-store" }, { key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
