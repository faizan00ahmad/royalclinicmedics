import { ApiError } from "./http";

/**
 * Cloudflare Turnstile (SEC-06): a free, privacy-friendly "are you human" check on checkout and the contact form.
 * In production a missing secret is an error (fail closed). In development without keys the check is skipped.
 */
export async function verifyTurnstile(token: string | undefined, ip: string, fetcher: typeof fetch = fetch): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") throw new Error("TURNSTILE_SECRET_KEY is not set");
    return;
  }
  if (!token) throw new ApiError(400, "CAPTCHA", "Please complete the check to show you are not a robot.");

  let ok = false;
  try {
    const res = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      body: new URLSearchParams({ secret, response: token, ...(ip !== "unknown" ? { remoteip: ip } : {}) }),
    });
    ok = res.ok && ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    throw new ApiError(503, "CAPTCHA_UNAVAILABLE", "The spam check is unavailable. Please try again, or phone the clinic.");
  }
  if (!ok) throw new ApiError(400, "CAPTCHA", "The check did not pass. Please try again.");
}
