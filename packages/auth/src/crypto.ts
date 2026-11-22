import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM for secrets stored in the database (the 2FA secret). Key: DATA_ENCRYPTION_KEY, 32 bytes, base64. */
function key(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) throw new Error("DATA_ENCRYPTION_KEY is not set");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return k;
}

/** Format: iv.tag.ciphertext (base64url). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(stored: string): string {
  const [iv, tag, enc] = stored.split(".").map((p) => Buffer.from(p ?? "", "base64url"));
  if (!iv || !tag || !enc) throw new Error("Malformed encrypted value");
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
