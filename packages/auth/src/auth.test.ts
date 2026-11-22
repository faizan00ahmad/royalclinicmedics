import { randomBytes } from "node:crypto";
import { schema } from "@rmc/db";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@rmc/core/src/test-utils/pglite";
import { decryptSecret, encryptSecret } from "./crypto";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { assertCan, can, ForbiddenError, type Principal } from "./permissions";
import {
  AuthError, IDLE_MINUTES, MAX_FAILED_LOGINS, attemptLogin, beginEnrolment, changePassword, createStaffUser,
  destroySession, getSessionUser, resetTwoFactor, setStaffActive, verifySecondFactor,
} from "./session";
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, stepAt, totpAt, verifyTotp } from "./totp";

beforeAll(() => { process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("base64"); });

describe("passwords", () => {
  it("hash and verify", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong horse battery", h)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("salts every hash", async () => {
    expect(await hashPassword("same password 123")).not.toBe(await hashPassword("same password 123"));
  });
  it("enforces 12 characters and rejects weak ones", () => {
    expect(passwordProblem("short")).toMatch(/12/);
    expect(passwordProblem("aaaaaaaaaaaaaa")).not.toBeNull();
    expect(passwordProblem("Password12345")).not.toBeNull();
    expect(passwordProblem("a-long-enough-phrase")).toBeNull();
  });
});

describe("TOTP (RFC 6238)", () => {
  const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the RFC test vectors (8 digit)", () => {
    expect(totpAt(rfcSecret, 1, 8)).toBe("94287082");
    expect(totpAt(rfcSecret, 37037036, 8)).toBe("07081804");
    expect(totpAt(rfcSecret, 37037037, 8)).toBe("14050471");
  });
  it("base32 round trips", () => {
    const b = Buffer.from("hello world");
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });
  it("accepts the current code and one step of drift, rejects others", () => {
    const now = new Date(1_700_000_000_000);
    const step = stepAt(now);
    expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step), now)).toBe(step);
    expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step + 2), now)).toBeNull();
    expect(verifyTotp(rfcSecret, "12345", now)).toBeNull();
    expect(verifyTotp(rfcSecret, "abcdef", now)).toBeNull();
  });
  it("rejects a code that was already used", () => {
    const now = new Date(1_700_000_000_000);
    const step = stepAt(now);
    expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step), now, step)).toBeNull();
    expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step), now, step - 1)).toBe(step);
  });
  it("builds an authenticator URI", () => {
    expect(otpauthUri("ABC", "a@b.ie")).toContain("otpauth://totp/Royal%20Medics%20Clinic%3Aa%40b.ie?secret=ABC");
  });
});

describe("encryption", () => {
  it("round trips and uses a fresh IV each time", () => {
    const a = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(a).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(a)).toBe("JBSWY3DPEHPK3PXP");
    expect(encryptSecret("JBSWY3DPEHPK3PXP")).not.toBe(a);
  });
  it("detects tampering", () => {
    const [iv, tag, enc] = encryptSecret("secret").split(".");
    const bad = `${iv}.${tag}.${Buffer.from("x" + Buffer.from(enc!, "base64url").toString("latin1")).toString("base64url")}`;
    expect(() => decryptSecret(bad)).toThrow();
  });
});

describe("permissions (can)", () => {
  const admin: Principal = { id: "a", role: "ADMIN" };
  const recep: Principal = { id: "r", role: "RECEPTIONIST" };
  const doc: Principal = { id: "d", role: "DOCTOR", doctorId: "doc-1" };

  it("admin can do everything", () => {
    for (const a of ["settings:write", "staff:write", "export:run", "audit:read", "services:write", "privacy:manage"] as const) expect(can(admin, a)).toBe(true);
  });
  it("receptionist: no settings, staff, exports, services, audit, refunds (SRS section 2)", () => {
    for (const a of ["settings:write", "staff:write", "export:run", "audit:read", "services:write", "payments:refund", "doctors:write", "privacy:manage"] as const) {
      expect(can(recep, a)).toBe(false);
    }
    for (const a of ["appointments:write", "walkin:create", "schedules:write", "enquiries:write", "content:write", "payments:markPaid"] as const) {
      expect(can(recep, a)).toBe(true);
    }
  });
  it("doctors only reach their own rows", () => {
    expect(can(doc, "appointments:read", { doctorId: "doc-1" })).toBe(true);
    expect(can(doc, "appointments:read", { doctorId: "doc-2" })).toBe(false);
    expect(can(doc, "appointments:questionnaire", { doctorId: "doc-2" })).toBe(false);
    expect(can(doc, "schedules:writeOwn", { doctorId: "doc-1" })).toBe(true);
    expect(can(doc, "appointments:write", { doctorId: "doc-1" })).toBe(false);
    expect(can(doc, "walkin:create", { doctorId: "doc-1" })).toBe(false);
  });
  it("doctors cannot manage privacy requests", () => {
    expect(can(doc, "privacy:manage", { doctorId: "doc-1" })).toBe(false);
  });
  it("a doctor login not linked to a doctor can do nothing", () => {
    expect(can({ id: "x", role: "DOCTOR" }, "appointments:read", { doctorId: "doc-1" })).toBe(false);
  });
  it("anonymous can do nothing, and assertCan throws", () => {
    expect(can(null, "dashboard:read")).toBe(false);
    expect(() => assertCan(recep, "export:run")).toThrow(ForbiddenError);
  });
});

describe("sign in", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>["db"];
  const PW = "a-long-enough-phrase";
  const NOW = new Date("2026-11-22T10:00:00Z");
  const min = (m: number) => new Date(NOW.getTime() + m * 60_000);

  beforeEach(async () => {
    ({ db } = await createTestDb());
    await createStaffUser(db, { email: "Admin@Clinic.ie", name: "Dr Admin", role: "ADMIN", password: PW });
  });

  const login = (password = PW, email = "admin@clinic.ie", now = NOW) => attemptLogin(db, { email, password, ip: "1.2.3.4", now });

  async function fullSignIn() {
    const r = await login();
    if (!r.ok) throw new Error("login failed");
    const user = (await getSessionUser(db, r.token, NOW))!;
    const { secret } = await beginEnrolment(db, user.id);
    const ok = await verifySecondFactor(db, { userId: user.id, sessionId: user.sessionId, code: totpAt(secret, stepAt(NOW)), now: NOW });
    return { token: r.token, user, secret, ok };
  }

  it("wrong password, unknown email and inactive users all get the same plain failure", async () => {
    expect(await login("nope nope nope nope")).toEqual({ ok: false });
    expect(await login(PW, "nobody@clinic.ie")).toEqual({ ok: false });
    const [u] = await db.select().from(schema.users);
    await setStaffActive(db, u!.id, false);
    expect(await login()).toEqual({ ok: false });
  });

  it("a password-only session is not verified and needs 2FA set up", async () => {
    const r = await login();
    expect(r.ok && r.needsEnrolment).toBe(true);
    const user = await getSessionUser(db, r.ok ? r.token : "", NOW);
    expect(user?.mfaVerified).toBe(false);
    expect(user?.totpConfirmed).toBe(false);
  });

  it("enrolment: first valid code verifies the session and turns 2FA on", async () => {
    const { ok, token } = await fullSignIn();
    expect(ok).toBe(true);
    const user = await getSessionUser(db, token, NOW);
    expect(user?.mfaVerified).toBe(true);
    expect(user?.totpConfirmed).toBe(true);
  });

  it("stores the 2FA secret encrypted", async () => {
    const { secret } = await fullSignIn();
    const [u] = await db.select().from(schema.users);
    expect(u!.totpSecretEnc).not.toContain(secret);
    expect(decryptSecret(u!.totpSecretEnc!)).toBe(secret);
  });

  it("a wrong 2FA code is refused, and a code cannot be used twice", async () => {
    const { secret, user } = await fullSignIn();
    const r2 = await login(PW, "admin@clinic.ie", min(2)); // later sign in, new session
    const u2 = (await getSessionUser(db, r2.ok ? r2.token : "", min(2)))!;
    expect(await verifySecondFactor(db, { userId: u2.id, sessionId: u2.sessionId, code: "000000", now: min(2) })).toBe(false);
    // same time step as the code used at enrolment: replay is refused
    const replay = totpAt(secret, stepAt(NOW));
    expect(await verifySecondFactor(db, { userId: u2.id, sessionId: u2.sessionId, code: replay, now: NOW })).toBe(false);
    // a fresh step works
    expect(await verifySecondFactor(db, { userId: user.id, sessionId: u2.sessionId, code: totpAt(secret, stepAt(min(2)) + 1), now: min(2) })).toBe(true);
  });

  it(`locks the account after ${MAX_FAILED_LOGINS} wrong passwords, even for the right password`, async () => {
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await login("wrong wrong wrong!");
    expect(await login(PW)).toEqual({ ok: false });
    const [u] = await db.select().from(schema.users);
    expect(u!.lockedUntil).not.toBeNull();
    // unlocks after the lockout period
    expect((await login(PW, "admin@clinic.ie", min(20))).ok).toBe(true);
  });

  it("wrong 2FA codes also count toward the lockout", async () => {
    const r = await login();
    const user = (await getSessionUser(db, r.ok ? r.token : "", NOW))!;
    await beginEnrolment(db, user.id);
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await verifySecondFactor(db, { userId: user.id, sessionId: user.sessionId, code: "111111", now: NOW });
    const [u] = await db.select().from(schema.users);
    expect(u!.lockedUntil).not.toBeNull();
  });

  it(`ends the session after ${IDLE_MINUTES} idle minutes`, async () => {
    const r = await login();
    const token = r.ok ? r.token : "";
    expect(await getSessionUser(db, token, min(IDLE_MINUTES - 1))).not.toBeNull();
    // that call refreshed last-seen; now 31 idle minutes from it
    expect(await getSessionUser(db, token, min(IDLE_MINUTES - 1 + IDLE_MINUTES + 1))).toBeNull();
    expect(await db.select().from(schema.sessions)).toHaveLength(0);
  });

  it("ends the session after 12 hours even if active", async () => {
    const r = await login();
    const token = r.ok ? r.token : "";
    for (let m = 20; m < 12 * 60; m += 20) expect(await getSessionUser(db, token, min(m))).not.toBeNull();
    expect(await getSessionUser(db, token, min(12 * 60))).toBeNull(); // expires exactly at 12 hours
  });

  it("logout and bad tokens", async () => {
    const r = await login();
    const token = r.ok ? r.token : "";
    await destroySession(db, token);
    expect(await getSessionUser(db, token, NOW)).toBeNull();
    expect(await getSessionUser(db, "short", NOW)).toBeNull();
    expect(await getSessionUser(db, undefined, NOW)).toBeNull();
  });

  it("stores only a hash of the session token", async () => {
    const r = await login();
    const [s] = await db.select().from(schema.sessions);
    expect(r.ok && s!.tokenHash).not.toBe(r.ok && r.token);
    expect(s!.tokenHash).toHaveLength(64);
  });

  it("resetting 2FA signs the member out and requires enrolment again", async () => {
    const { user } = await fullSignIn();
    await resetTwoFactor(db, user.id);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, user.id))).toHaveLength(0);
    const r = await login();
    expect(r.ok && r.needsEnrolment).toBe(true);
  });

  it("deactivating a member ends their sessions", async () => {
    const r = await login();
    const user = (await getSessionUser(db, r.ok ? r.token : "", NOW))!;
    await setStaffActive(db, user.id, false);
    expect(await getSessionUser(db, r.ok ? r.token : "", NOW)).toBeNull();
  });

  it("rejects weak passwords and duplicate emails when creating staff", async () => {
    await expect(createStaffUser(db, { email: "x@clinic.ie", name: "X", role: "RECEPTIONIST", password: "short" })).rejects.toBeInstanceOf(AuthError);
    await expect(createStaffUser(db, { email: "admin@clinic.ie", name: "Dup", role: "RECEPTIONIST", password: PW })).rejects.toBeInstanceOf(AuthError);
  });

  it("changes a password only with the current one", async () => {
    const [u] = await db.select().from(schema.users);
    await expect(changePassword(db, u!.id, "not the password", "another-long-phrase")).rejects.toBeInstanceOf(AuthError);
    await changePassword(db, u!.id, PW, "another-long-phrase");
    expect((await login("another-long-phrase")).ok).toBe(true);
    expect((await login(PW)).ok).toBe(false);
  });

  it("writes audit entries without passwords or secrets", async () => {
    await login("wrong wrong wrong!");
    await fullSignIn();
    const logs = JSON.stringify(await db.select().from(schema.auditLogs));
    expect(logs).toContain("auth.login_failed");
    expect(logs).not.toContain(PW);
    expect(logs).not.toContain("wrong wrong wrong!");
  });

  it("generated secrets are random base32", () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});
