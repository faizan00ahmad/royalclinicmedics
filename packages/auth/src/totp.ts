import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** RFC 6238 time-based one-time passwords (SHA-1, 6 digits, 30 seconds), compatible with Google Authenticator, Authy, 1Password. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase().replace(/\s/g, "")) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

export function totpAt(secret: string, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const off = h[h.length - 1]! & 0xf;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const stepAt = (date: Date) => Math.floor(date.getTime() / 1000 / TOTP_PERIOD);

/**
 * Returns the matching time step (so the caller can reject replays), or null.
 * Accepts the previous, current and next step to allow for clock drift.
 */
export function verifyTotp(secret: string, code: string, now: Date, lastUsedStep?: number | null): number | null {
  const cleaned = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return null;
  const current = stepAt(now);
  let match: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(totpAt(secret, step));
    const given = Buffer.from(cleaned);
    if (timingSafeEqual(expected, given) && match === null) match = step;
  }
  if (match === null) return null;
  if (lastUsedStep != null && match <= lastUsedStep) return null; // already used
  return match;
}

export function otpauthUri(secret: string, accountEmail: string, issuer = "Royal Medics Clinic"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_PERIOD}`;
}
