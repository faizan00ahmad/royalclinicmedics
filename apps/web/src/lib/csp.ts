/**
 * Content Security Policy (SEC-01). Built per request with a fresh nonce, so only scripts Next.js itself emits
 * (and scripts those load, via 'strict-dynamic') can run. Injected markup cannot run script.
 *
 * Third parties allowed, and why:
 *  - Stripe: card, Apple Pay and Google Pay form and 3-D Secure.
 *  - Google Tag Manager / Analytics: only loaded after the visitor accepts cookies.
 *  - Google Maps: the embedded map on the Contact page.
 *  - Cloudflare Turnstile: spam protection on forms.
 */
export function buildCsp(nonce: string, dev = false): string {
  const scriptSrc = [
    "'self'", `'nonce-${nonce}'`, "'strict-dynamic'",
    "https://js.stripe.com", "https://www.googletagmanager.com", "https://challenges.cloudflare.com",
    ...(dev ? ["'unsafe-eval'"] : []), // React refresh in development only
  ];
  const connectSrc = [
    "'self'", "https://api.stripe.com", "https://www.googletagmanager.com", "https://*.google-analytics.com",
    "https://*.analytics.google.com", "https://challenges.cloudflare.com",
    ...(dev ? ["ws://localhost:*", "http://localhost:*"] : []),
  ];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "https://*.stripe.com", "https://www.google-analytics.com", "https://*.googletagmanager.com"],
    "font-src": ["'self'"],
    "connect-src": connectSrc,
    "frame-src": ["https://js.stripe.com", "https://hooks.stripe.com", "https://www.google.com", "https://challenges.cloudflare.com"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
