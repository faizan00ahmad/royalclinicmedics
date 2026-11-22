"use server";

import { timingSafeEqual } from "node:crypto";
import { attemptLogin, createStaffUser, destroySession, verifySecondFactor } from "@rmc/auth";
import { schema } from "@rmc/db";
import { sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, currentUser, go, requestIp, sessionToken, str } from "@/lib/admin";
import { ApiError, rateLimitKey } from "@/lib/http";
import { db } from "@/lib/server";

const limited = (key: string, limit: number) => {
  try { rateLimitKey(key, limit); } catch (e) { if (e instanceof ApiError) return true; throw e; }
  return false;
};

export async function loginAction(form: FormData): Promise<void> {
  const ip = await requestIp();
  if (limited(`login:${ip}`, 10)) redirect("/admin/login?error=" + encodeURIComponent("Too many attempts. Please wait a minute."));

  const result = await attemptLogin(db(), {
    email: str(form, "email"), password: String(form.get("password") ?? ""), ip, userAgent: (await headers()).get("user-agent"),
  });
  if (!result.ok) {
    // One message for every kind of failure (no account enumeration).
    redirect("/admin/login?error=" + encodeURIComponent("Sign-in failed. Check your email and password. After several wrong tries the account is locked for 15 minutes."));
  }
  (await cookies()).set(COOKIE, result.token, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", expires: result.expiresAt,
  });
  redirect("/admin/verify");
}

export async function verifyAction(form: FormData): Promise<void> {
  const ip = await requestIp();
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  if (limited(`verify:${ip}`, 10)) redirect("/admin/verify?error=" + encodeURIComponent("Too many attempts. Please wait a minute."));

  const ok = await verifySecondFactor(db(), { userId: user.id, sessionId: user.sessionId, code: str(form, "code"), ip, userAgent: (await headers()).get("user-agent") });
  if (!ok) redirect("/admin/verify?error=" + encodeURIComponent("That code did not work. Check the time on your phone and try the newest code."));
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  await destroySession(db(), await sessionToken());
  (await cookies()).delete(COOKIE);
  redirect("/admin/login");
}

export async function staffCount(): Promise<number> {
  const [r] = await db().select({ n: sql<number>`count(*)::int` }).from(schema.users);
  return r?.n ?? 0;
}

/**
 * First-run only: creates the first administrator while there are NO staff accounts.
 * In production it also needs the SETUP_TOKEN environment variable, so a stranger cannot claim the site.
 */
export async function setupAction(form: FormData): Promise<void> {
  await go("/admin/setup", async () => {
    if ((await staffCount()) > 0) throw new Error("Setup is already done.");
    const expected = process.env.SETUP_TOKEN;
    if (process.env.NODE_ENV === "production") {
      const given = Buffer.from(String(form.get("setupToken") ?? ""));
      const want = Buffer.from(expected ?? "");
      if (!expected || given.length !== want.length || !timingSafeEqual(given, want)) throw new Error("The setup code is not correct.");
    }
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("password2") ?? "")) throw new Error("The two passwords do not match.");
    await createStaffUser(db(), { email: str(form, "email"), name: str(form, "name"), role: "ADMIN", password });
    return { to: "/admin/login", message: "Administrator created. Sign in to set up two-factor." };
  });
}
