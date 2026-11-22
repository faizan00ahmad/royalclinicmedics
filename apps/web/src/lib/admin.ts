import { assertCan, can, ForbiddenError, getSessionUser, AuthError, type Action, type Resource, type SessionUser } from "@rmc/auth";
import { BookingError, type Actor } from "@rmc/core";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { ZodError } from "zod";
import { db } from "./server";

/** `__Host-` makes browsers insist on Secure, path=/ and no Domain, so the cookie cannot be set from a sub-domain. */
export const COOKIE = process.env.NODE_ENV === "production" ? "__Host-rmc_admin" : "rmc_admin";

export async function requestIp(): Promise<string> {
  const h = await headers();
  return h.get("x-nf-client-connection-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE)?.value;
}

export async function currentUser(): Promise<SessionUser | null> {
  return getSessionUser(db(), await sessionToken());
}

/** Signed in AND past the second factor. Anything else goes to the sign-in pages. */
export async function requireVerified(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  if (!user.mfaVerified) redirect("/admin/verify");
  return user;
}

/** Use at the top of every page and every server action (SEC-03). */
export async function requireCan(action: Action, resource: Resource = {}): Promise<SessionUser> {
  const user = await requireVerified();
  if (!can(user, action, resource)) redirect("/admin?error=" + encodeURIComponent("You do not have permission to do that."));
  return user;
}

export async function actorOf(user: SessionUser): Promise<Actor> {
  return { id: user.id, role: user.role, ip: await requestIp() };
}

export { assertCan, can };

function friendly(err: unknown): string {
  if (err instanceof BookingError || err instanceof AuthError || err instanceof ForbiddenError) return err.message;
  if (err instanceof ZodError) {
    const fields = [...new Set(err.issues.map((i) => i.path.join(".") || "form"))].join(", ");
    return `Please check these fields: ${fields}.`;
  }
  // Only the error type is logged: messages from the database can contain patient details.
  console.error(`[admin] unexpected ${err instanceof Error ? err.name : typeof err}`);
  return "Something went wrong. Nothing was saved. Please try again.";
}

/**
 * Runs a server action body, then redirects with a plain message. `redirect()` works by throwing,
 * so it is called outside the try block.
 */
export async function go(path: string, body: () => Promise<string | { to?: string; message: string }>): Promise<never> {
  let target = path;
  let key: "ok" | "error" = "ok";
  let message = "";
  try {
    const r = await body();
    if (typeof r === "string") message = r;
    else { message = r.message; if (r.to) target = r.to; }
  } catch (err) {
    if (isRedirectError(err)) throw err;
    key = "error";
    message = friendly(err);
  }
  const sep = target.includes("?") ? "&" : "?";
  redirect(`${target}${sep}${key}=${encodeURIComponent(message)}`);
}

export const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export const opt = (f: FormData, k: string) => str(f, k) || undefined;
export const bool = (f: FormData, k: string) => f.get(k) === "on";
export const int = (f: FormData, k: string, fallback = 0) => {
  const n = Number(str(f, k));
  return Number.isFinite(n) && str(f, k) !== "" ? Math.trunc(n) : fallback;
};
/** "12.50" euros to 1250 cents without floating point surprises. */
export function cents(f: FormData, k: string): number {
  const m = str(f, k).replace(",", ".").match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) throw new BookingError("POLICY", "Enter a price like 60 or 60.00.");
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
}
