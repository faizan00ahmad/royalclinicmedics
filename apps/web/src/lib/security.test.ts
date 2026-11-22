import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as holdPOST } from "@/app/api/bookings/hold/route";
import { POST as contactPOST } from "@/app/api/contact/route";
import { buildCsp } from "./csp";
import { ApiError, requireSameOrigin } from "./http";
import { verifyTurnstile } from "./turnstile";

afterEach(() => { vi.unstubAllEnvs(); });

describe("Content Security Policy", () => {
  const prod = buildCsp("abc123", false);
  const dev = buildCsp("abc123", true);

  it("allows only nonce-marked scripts, never 'unsafe-inline' scripts", () => {
    const script = prod.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });
  it("blocks plugins, framing, and form posts to other sites", () => {
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("form-action 'self'");
    expect(prod).toContain("base-uri 'self'");
  });
  it("upgrades to https in production only; eval is development only", () => {
    expect(prod).toContain("upgrade-insecure-requests");
    expect(dev).not.toContain("upgrade-insecure-requests");
    expect(dev).toContain("'unsafe-eval'");
  });
  it("allows exactly the third parties the site uses", () => {
    expect(prod).toContain("https://js.stripe.com");
    expect(prod).toContain("https://challenges.cloudflare.com");
    expect(prod).toContain("https://www.google.com"); // map frame
    expect(prod).not.toMatch(/\*(?!\.)/); // no bare wildcard sources
  });
});

describe("same-origin check for public POST routes", () => {
  const req = (origin?: string, host = "clinic.example") =>
    new Request("https://clinic.example/api/x", { method: "POST", headers: { host, ...(origin ? { origin } : {}) } });

  it("accepts the same site and requests with no Origin header", () => {
    expect(() => requireSameOrigin(req("https://clinic.example"))).not.toThrow();
    expect(() => requireSameOrigin(req())).not.toThrow();
  });
  it("refuses another site or a malformed Origin", () => {
    expect(() => requireSameOrigin(req("https://evil.example"))).toThrowError(ApiError);
    expect(() => requireSameOrigin(req("null"))).toThrowError(ApiError);
    expect(() => requireSameOrigin(req("https://clinic.example.evil.com"))).toThrowError(ApiError);
  });
  it("is enforced by the booking and contact routes before anything else runs", async () => {
    const evil = (path: string) => new Request(`https://clinic.example${path}`, {
      method: "POST", headers: { host: "clinic.example", origin: "https://evil.example", "content-type": "application/json" }, body: "{}",
    });
    expect((await holdPOST(evil("/api/bookings/hold"), undefined)).status).toBe(403);
    expect((await contactPOST(evil("/api/contact"), undefined)).status).toBe(403);
  });
});

describe("Turnstile verification", () => {
  const ok = () => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }) as unknown as typeof fetch;

  it("is skipped in development when no secret is set", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    await expect(verifyTurnstile(undefined, "1.1.1.1")).resolves.toBeUndefined();
  });
  it("fails closed in production when the secret is missing", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(verifyTurnstile("t", "1.1.1.1")).rejects.toThrow("TURNSTILE_SECRET_KEY is not set");
  });
  it("requires a token once configured", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    await expect(verifyTurnstile(undefined, "1.1.1.1", ok())).rejects.toMatchObject({ status: 400, code: "CAPTCHA" });
  });
  it("accepts a token Cloudflare approves, and sends the secret and the visitor's IP", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const f = ok();
    await expect(verifyTurnstile("tok", "9.9.9.9", f)).resolves.toBeUndefined();
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(String((init as RequestInit).body)).toContain("remoteip=9.9.9.9");
    expect(String((init as RequestInit).body)).toContain("response=tok");
  });
  it("rejects a token Cloudflare refuses", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }) as unknown as typeof fetch;
    await expect(verifyTurnstile("bad", "1.1.1.1", f)).rejects.toMatchObject({ status: 400, code: "CAPTCHA" });
  });
  it("reports 'unavailable' (not a pass) when Cloudflare cannot be reached", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const f = vi.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    await expect(verifyTurnstile("tok", "1.1.1.1", f)).rejects.toMatchObject({ status: 503, code: "CAPTCHA_UNAVAILABLE" });
  });
});
