import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 32768; // 2^15
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 128 * N * R * 2;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, keylen, opts, (e, k) => (e ? reject(e) : resolve(k))));
}

/** Format: scrypt$N$r$p$salt$hash (base64). The parameters travel with the hash so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Spent against a missing user so "no such account" takes as long as "wrong password". */
let dummy: Promise<string> | undefined;
export async function burnPasswordTime(password: string): Promise<void> {
  dummy ??= hashPassword("not-a-real-password");
  await verifyPassword(password, await dummy);
}

const COMMON = new Set([
  "password1234", "123456789012", "qwertyuiop12", "administrator", "welcome12345", "letmein12345", "password12345",
  "iloveyou1234", "changeme1234", "clinic123456",
]);

/** SEC-02: at least 12 characters. Returns an error message or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 200) return "That password is too long.";
  if (COMMON.has(password.toLowerCase())) return "That password is too easy to guess.";
  if (/^(.)\1+$/.test(password)) return "Use a mix of different characters.";
  return null;
}
