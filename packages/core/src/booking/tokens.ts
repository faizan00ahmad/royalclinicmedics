import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";

// No 0/O/1/I so references are easy to read out over the phone.
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateBookingRef(): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `RMC-${out}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function linkSecret(): string {
  const s = process.env.SIGNED_LINK_SECRET;
  if (!s || s.length < 16) throw new Error("SIGNED_LINK_SECRET is not set");
  return s;
}

/**
 * SEC-04. The manage token is an HMAC of the appointment id, so the same link can be rebuilt whenever an email is
 * sent (confirmation, reminders, changes) without storing the token. Only its SHA-256 hash is stored, and that
 * hash is what the manage page checks. Rotating the secret keeps links already sent working, but emails sent later for
 * older bookings would carry a link that no longer matches, so only rotate it on purpose.
 */
export function manageTokenFor(appointmentId: string): string {
  return createHmac("sha256", linkSecret()).update(`manage:${appointmentId}`).digest("base64url");
}

export function generateManageToken(appointmentId: string): { token: string; hash: string } {
  const token = manageTokenFor(appointmentId);
  return { token, hash: hashToken(token) };
}

export function verifyManageToken(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
