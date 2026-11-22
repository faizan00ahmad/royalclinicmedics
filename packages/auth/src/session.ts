import { createHash, randomBytes } from "node:crypto";
import { audit, type Database } from "@rmc/core";
import { schema } from "@rmc/db";
import { eq, lt } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "./crypto";
import { burnPasswordTime, hashPassword, passwordProblem, verifyPassword } from "./password";
import type { Role } from "./permissions";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
export const IDLE_MINUTES = 30; // SEC-02
export const SESSION_HOURS = 12;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const MIN = 60_000;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  doctorId: string | null;
  mfaVerified: boolean;
  totpConfirmed: boolean;
  sessionId: string;
}

export type LoginResult = { ok: false } | { ok: true; token: string; expiresAt: Date; needsEnrolment: boolean };

interface Ctx { ip?: string | null; userAgent?: string | null; now?: Date }

/**
 * Step one of sign-in. The reply never says whether the email exists or the account is locked,
 * and a missing account takes as long as a wrong password (no account enumeration).
 */
export async function attemptLogin(db: Database, input: { email: string; password: string } & Ctx): Promise<LoginResult> {
  const now = input.now ?? new Date();
  const email = input.email.trim().toLowerCase();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));

  if (!user || !user.isActive) {
    await burnPasswordTime(input.password);
    await audit(db, { action: "auth.login_failed", entityType: "user", ip: input.ip, userAgent: input.userAgent, changes: { reason: "unknown_or_inactive" } });
    return { ok: false };
  }
  if (user.lockedUntil && user.lockedUntil > now) {
    await burnPasswordTime(input.password);
    await audit(db, { actorUserId: user.id, action: "auth.login_blocked", entityType: "user", entityId: user.id, ip: input.ip, changes: { reason: "locked" } });
    return { ok: false };
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    await registerFailure(db, user.id, user.failedLogins, now, input.ip, "bad_password");
    return { ok: false };
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 60 * MIN);
  await db.insert(schema.sessions).values({
    userId: user.id, tokenHash: hashToken(token), expiresAt, lastSeenAt: now, ip: input.ip ?? null, userAgent: input.userAgent?.slice(0, 300) ?? null,
  });
  return { ok: true, token, expiresAt, needsEnrolment: !user.totpConfirmedAt };
}

async function registerFailure(db: Database, userId: string, current: number, now: Date, ip: string | null | undefined, reason: string) {
  const failed = current + 1;
  const locked = failed >= MAX_FAILED_LOGINS;
  await db.update(schema.users).set({
    failedLogins: locked ? 0 : failed,
    lockedUntil: locked ? new Date(now.getTime() + LOCKOUT_MINUTES * MIN) : null,
  }).where(eq(schema.users.id, userId));
  await audit(db, { actorUserId: userId, action: locked ? "auth.locked" : "auth.login_failed", entityType: "user", entityId: userId, ip, changes: { reason } });
}

/** Returns the signed-in user, or null. Enforces the 30 minute idle timeout and the 12 hour limit. */
export async function getSessionUser(db: Database, token: string | undefined, now: Date = new Date()): Promise<SessionUser | null> {
  if (!token || token.length < 20) return null;
  const [row] = await db
    .select({ s: schema.sessions, u: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.tokenHash, hashToken(token)));
  if (!row) return null;

  const idleFor = now.getTime() - row.s.lastSeenAt.getTime();
  if (!row.u.isActive || row.s.expiresAt <= now || idleFor > IDLE_MINUTES * MIN) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, row.s.id));
    return null;
  }
  if (idleFor > MIN) await db.update(schema.sessions).set({ lastSeenAt: now }).where(eq(schema.sessions.id, row.s.id));

  const [doctor] = await db.select({ id: schema.doctors.id }).from(schema.doctors).where(eq(schema.doctors.userId, row.u.id));
  return {
    id: row.u.id, email: row.u.email, name: row.u.name, role: row.u.role, doctorId: doctor?.id ?? null,
    mfaVerified: row.s.mfaVerified, totpConfirmed: Boolean(row.u.totpConfirmedAt), sessionId: row.s.id,
  };
}

export async function destroySession(db: Database, token: string | undefined): Promise<void> {
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
}

export async function purgeExpiredSessions(db: Database, now: Date = new Date()): Promise<void> {
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now));
}

// ---------------------------------------------------------------- 2FA

/** First sign-in: create (or reuse) a pending secret and return what the authenticator app needs. */
export async function beginEnrolment(db: Database, userId: string): Promise<{ secret: string; uri: string }> {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u) throw new Error("User not found");
  if (u.totpConfirmedAt) throw new Error("Two-factor sign-in is already set up");
  const secret = u.totpSecretEnc ? decryptSecret(u.totpSecretEnc) : generateTotpSecret();
  if (!u.totpSecretEnc) await db.update(schema.users).set({ totpSecretEnc: encryptSecret(secret) }).where(eq(schema.users.id, userId));
  return { secret, uri: otpauthUri(secret, u.email) };
}

/** Used for both enrolment (confirm the first code) and normal sign-in. Wrong codes count toward the lockout. */
export async function verifySecondFactor(
  db: Database, input: { userId: string; sessionId: string; code: string } & Ctx,
): Promise<boolean> {
  const now = input.now ?? new Date();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, input.userId));
  if (!u?.totpSecretEnc) return false;
  if (u.lockedUntil && u.lockedUntil > now) return false;

  const step = verifyTotp(decryptSecret(u.totpSecretEnc), input.code, now, u.totpLastStep);
  if (step === null) {
    await registerFailure(db, u.id, u.failedLogins, now, input.ip, "bad_second_factor");
    return false;
  }

  await db.update(schema.users).set({
    totpLastStep: step, failedLogins: 0, lockedUntil: null, lastLoginAt: now,
    ...(u.totpConfirmedAt ? {} : { totpConfirmedAt: now }),
  }).where(eq(schema.users.id, u.id));
  await db.update(schema.sessions).set({ mfaVerified: true, lastSeenAt: now }).where(eq(schema.sessions.id, input.sessionId));
  await audit(db, { actorUserId: u.id, actorRole: u.role, action: u.totpConfirmedAt ? "auth.login" : "auth.2fa_enrolled", entityType: "user", entityId: u.id, ip: input.ip, userAgent: input.userAgent });
  return true;
}

// ---------------------------------------------------------- staff admin

export class AuthError extends Error {}

export async function createStaffUser(
  db: Database, input: { email: string; name: string; role: Role; password: string; createdBy?: string },
) {
  const email = input.email.trim().toLowerCase();
  const problem = passwordProblem(input.password);
  if (problem) throw new AuthError(problem);
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  if (existing) throw new AuthError("A staff account with that email already exists.");
  const [user] = await db.insert(schema.users).values({
    email, name: input.name.trim(), role: input.role, passwordHash: await hashPassword(input.password),
  }).returning();
  await audit(db, { actorUserId: input.createdBy, action: "staff.create", entityType: "user", entityId: user!.id, changes: { role: input.role } });
  return user!;
}

/** AD-13. The member must set up their authenticator app again at next sign-in, and every session ends. */
export async function resetTwoFactor(db: Database, userId: string, actorId?: string): Promise<void> {
  await db.update(schema.users).set({ totpSecretEnc: null, totpConfirmedAt: null, totpLastStep: null }).where(eq(schema.users.id, userId));
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  await audit(db, { actorUserId: actorId, action: "staff.reset_2fa", entityType: "user", entityId: userId });
}

export async function setStaffActive(db: Database, userId: string, active: boolean, actorId?: string): Promise<void> {
  await db.update(schema.users).set({ isActive: active }).where(eq(schema.users.id, userId));
  if (!active) await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  await audit(db, { actorUserId: actorId, action: active ? "staff.activate" : "staff.deactivate", entityType: "user", entityId: userId });
}

export async function changePassword(db: Database, userId: string, current: string, next: string): Promise<void> {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u || !(await verifyPassword(current, u.passwordHash))) throw new AuthError("Your current password is not correct.");
  const problem = passwordProblem(next);
  if (problem) throw new AuthError(problem);
  await db.update(schema.users).set({ passwordHash: await hashPassword(next) }).where(eq(schema.users.id, userId));
  await audit(db, { actorUserId: userId, action: "auth.password_changed", entityType: "user", entityId: userId });
}
